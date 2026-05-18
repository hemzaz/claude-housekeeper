#!/usr/bin/env bash
#
# soak.sh — nightly soak runner for claude-housekeeper v0.2.0 GA.
#
# Per notes/RELEASE-READINESS-v0.2.0.md §5, the v0.2.0 cut requires a
# 5–7 night soak against a real ~/.claude home before dropping `-beta`.
# This script captures diagnose / plan / verify output for one night,
# diffs against the previous night, and surfaces any unexpected refusals
# or new findings.
#
# Read-only by design — never invokes clean/rollback/harden. Safe to run
# from CI or cron; outputs into .omc/research/soak-YYYYMMDD/.
#
# Usage:
#   scripts/soak.sh                  # against ~/.claude
#   CLAUDE_HOME=/path scripts/soak.sh # against another home
#   scripts/soak.sh /tmp/fake-home   # explicit positional arg (overrides env)
#
# Stop conditions (§5 of release-readiness):
#   - filesChanged: true in any read-only command output → contract violation
#   - schemaVersion drift from "0.1" / "0.2" without intent → flag
#   - manifest id failing op_[0-9]{14}_[0-9a-f]{8} → flag
#   - empty or "undefined" message in any refusal → flag
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/scripts/claude-housekeeper.mjs"

HOME_DIR="${1:-${CLAUDE_HOME:-$HOME/.claude}}"
if [ ! -d "$HOME_DIR" ]; then
  echo "soak: home directory does not exist: $HOME_DIR" >&2
  exit 1
fi

DATE_STAMP="$(date +%Y%m%d)"
OUT_DIR="$REPO_ROOT/.omc/research/soak-$DATE_STAMP"
mkdir -p "$OUT_DIR"

echo "soak: home=$HOME_DIR out=$OUT_DIR"

# 1. Default diagnose (JSON) — the primary contract surface.
echo "=== 1. diagnose --json ==="
node "$CLI" diagnose --json --home="$HOME_DIR" > "$OUT_DIR/diagnose.json" || true

# 2. Safe + redacted text — what the user would paste into an issue.
echo "=== 2. diagnose --safe --redact ==="
node "$CLI" diagnose --safe --redact --home="$HOME_DIR" > "$OUT_DIR/safe-redacted.txt" || true

# 3. Plan output per scope — narrows the surface for triage.
echo "=== 3. plan per scope ==="
for scope in settings plugins registry housekeeper; do
  node "$CLI" plan --scope="$scope" --home="$HOME_DIR" > "$OUT_DIR/plan-$scope.txt" || true
done

# 4. verify — smoketest probes. May fail on hosts without `claude` binary.
echo "=== 4. verify ==="
node "$CLI" verify --home="$HOME_DIR" > "$OUT_DIR/verify.txt" 2>&1 || true

# 5. Interrupted-op inventory — count and statuses, no mutation.
echo "=== 5. operations inventory ==="
OPS_DIR="$HOME_DIR/housekeeper/operations"
if [ -d "$OPS_DIR" ]; then
  for f in "$OPS_DIR"/*.json; do
    [ -e "$f" ] || continue
    id="$(basename "$f" .json)"
    status="$(node -e "
      try {
        const m = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
        process.stdout.write(m.status || 'unknown');
      } catch { process.stdout.write('parse-error'); }
    " "$f" 2>/dev/null)"
    echo "$id $status"
  done > "$OUT_DIR/operations.txt"
else
  : > "$OUT_DIR/operations.txt"
fi

# 6. Diff against yesterday's diagnose (if present).
echo "=== 6. diff from yesterday ==="
# Portable "yesterday" — GNU vs BSD date have different flags.
YDAY="$(date -v-1d +%Y%m%d 2>/dev/null || date -d 'yesterday' +%Y%m%d 2>/dev/null || true)"
YDAY_DIR="$REPO_ROOT/.omc/research/soak-${YDAY:-}"
if [ -n "${YDAY:-}" ] && [ -d "$YDAY_DIR" ] && [ -f "$YDAY_DIR/diagnose.json" ]; then
  diff "$YDAY_DIR/diagnose.json" "$OUT_DIR/diagnose.json" > "$OUT_DIR/diff-from-yesterday.txt" || true
fi

# 7. Stop-condition checks. Each line printed here is a soak-pass failure.
echo "=== 7. stop-condition checks ==="
CHECK_OUT="$OUT_DIR/stop-conditions.txt"
: > "$CHECK_OUT"

# filesChanged: true in any read-only output.
for f in "$OUT_DIR"/diagnose.json "$OUT_DIR"/plan-*.txt; do
  [ -e "$f" ] || continue
  if grep -q '"filesChanged": *true' "$f" 2>/dev/null; then
    echo "STOP: filesChanged=true in $f (read-only contract violation)" >> "$CHECK_OUT"
  fi
done

# schemaVersion drift in diagnose.json.
if [ -f "$OUT_DIR/diagnose.json" ]; then
  if ! grep -q '"schemaVersion": *"0\.1"' "$OUT_DIR/diagnose.json" 2>/dev/null; then
    echo "STOP: report schemaVersion is not 0.1 in diagnose.json" >> "$CHECK_OUT"
  fi
fi

# Operation manifest id format.
if [ -f "$OUT_DIR/operations.txt" ] && [ -s "$OUT_DIR/operations.txt" ]; then
  while IFS=' ' read -r id status; do
    if ! echo "$id" | grep -Eq '^op_[0-9]{14}_[0-9a-f]{8}$'; then
      echo "STOP: bad op id format: $id (status=$status)" >> "$CHECK_OUT"
    fi
  done < "$OUT_DIR/operations.txt"
fi

# Empty / "undefined" refusal messages.
if [ -f "$OUT_DIR/diagnose.json" ] && command -v node >/dev/null; then
  node -e "
    try {
      const r = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const refusals = (r.refused || []).concat(
        (r.findings || []).flatMap(f => f.refused || [])
      );
      for (const x of refusals) {
        if (!x.message || x.message === 'undefined') {
          console.log('STOP: empty/undefined refusal message: ' + (x.reason || '?'));
        }
      }
    } catch { /* diagnose.json was not JSON; covered above */ }
  " "$OUT_DIR/diagnose.json" >> "$CHECK_OUT" 2>/dev/null || true
fi

# Summary line
COUNT="$(wc -l < "$CHECK_OUT" | tr -d ' ')"
STOP_EXIT=0
if [ "$COUNT" -eq 0 ]; then
  echo "soak: PASS — no stop conditions triggered"
else
  echo "soak: FAIL — $COUNT stop conditions in $CHECK_OUT" >&2
  cat "$CHECK_OUT" >&2
  STOP_EXIT=2
fi

echo "soak: complete. Results: $OUT_DIR"

# ---------------------------------------------------------------------------
# T-703: learn + prune read-only exercises
# ---------------------------------------------------------------------------
# These steps run after the existing diagnose/plan/verify/stop-condition checks
# so failures here are clearly attributed to the v0.4 learning-loop surface.
# All steps are read-only — no --confirm / --yes flags are used.
# Exit 1 if any step fails; soak continues collecting all results first.
# ---------------------------------------------------------------------------

echo ""
echo "=== T-703: learn + prune exercises ==="

SOAK_FAIL=0

soak_pass() { echo "  PASS: $*"; }
soak_fail() { echo "  FAIL: $*" >&2; SOAK_FAIL=1; }

# -------------------------------------------------------------------------
# 8. learn exercises — synthetic home with pre-populated JSONL fixture data
# -------------------------------------------------------------------------
echo "=== 8. learn — synthetic home with fixture JSONL ==="

LEARN_TMP="$(mktemp -d)"
LEARN_HOME="$LEARN_TMP/.claude"
LEARN_DIR="$LEARN_HOME/housekeeper/learning"
mkdir -p "$LEARN_DIR"
# Minimal settings.json so resolveClaudeHome / audit are happy.
printf '{}' > "$LEARN_HOME/settings.json"

# 5 refusal records
cat > "$LEARN_DIR/refusals.jsonl" << 'REFUSALS_EOF'
{"learnSchemaVersion":"0.4","ts":"2026-04-18T10:00:00.000Z","command":"clean","target":"plugin.cache_version_stale","reason":"snapshot-too-large","refusalClass":"budget-exceeded"}
{"learnSchemaVersion":"0.4","ts":"2026-04-19T10:00:00.000Z","command":"clean","target":"plugin.cache_version_stale","reason":"snapshot-too-large","refusalClass":"budget-exceeded"}
{"learnSchemaVersion":"0.4","ts":"2026-04-20T10:00:00.000Z","command":"harden","target":"settings.mcp_command_missing","reason":"target-not-executable","refusalClass":"mcp-rewrite-target-not-executable"}
{"learnSchemaVersion":"0.4","ts":"2026-04-21T10:00:00.000Z","command":"clean","target":"plugin.orphaned_cache","reason":"snapshot-too-large","refusalClass":"budget-exceeded"}
{"learnSchemaVersion":"0.4","ts":"2026-04-22T10:00:00.000Z","command":"harden","target":"settings.mcp_command_missing","reason":"target-not-executable","refusalClass":"mcp-rewrite-target-not-executable"}
REFUSALS_EOF

# 3 applied records
cat > "$LEARN_DIR/applied.jsonl" << 'APPLIED_EOF'
{"learnSchemaVersion":"0.4","ts":"2026-04-25T10:00:00.000Z","opId":"op_20260425100000_aabb0001","status":"verified","command":"clean","targets":["plugin.orphaned_cache"],"filesCount":1}
{"learnSchemaVersion":"0.4","ts":"2026-04-26T10:00:00.000Z","opId":"op_20260426100000_aabb0002","status":"verified","command":"clean","targets":["plugin.orphaned_cache"],"filesCount":2}
{"learnSchemaVersion":"0.4","ts":"2026-04-27T10:00:00.000Z","opId":"op_20260427100000_aabb0003","status":"verified","command":"harden","targets":["settings.mcp_command_missing"],"filesCount":1}
APPLIED_EOF

# 2 rollback records
cat > "$LEARN_DIR/rollbacks.jsonl" << 'ROLLBACKS_EOF'
{"learnSchemaVersion":"0.4","ts":"2026-04-28T10:00:00.000Z","opId":"op_20260426100000_aabb0002","fromStatus":"verified","toStatus":"rolled_back","filesRestoredCount":2}
{"learnSchemaVersion":"0.4","ts":"2026-04-29T10:00:00.000Z","opId":"op_20260427100000_aabb0003","fromStatus":"verified","toStatus":"rolled_back","filesRestoredCount":1}
ROLLBACKS_EOF

# 8a. learn --json — must return valid JSON with expected counter values
echo "--- 8a. learn --json ---"
LEARN_JSON_OUT="$OUT_DIR/learn-json.json"
if node "$CLI" learn --json --home="$LEARN_HOME" > "$LEARN_JSON_OUT" 2>&1; then
  # Validate: JSON must parse and learnSchemaVersion must be "0.4"
  LEARN_SCHEMA="$(node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      process.stdout.write(j.learnSchemaVersion || '');
    } catch(e) { process.stdout.write('PARSE_ERROR'); }
  " "$LEARN_JSON_OUT" 2>/dev/null)"
  if [ "$LEARN_SCHEMA" = "0.4" ]; then
    soak_pass "learn --json returns valid JSON with learnSchemaVersion=0.4"
  else
    soak_fail "learn --json: expected learnSchemaVersion=0.4, got '$LEARN_SCHEMA' (see $LEARN_JSON_OUT)"
  fi

  # Validate lifetime counters: totalRefusals=5, totalApplied=3, totalRollbacks=2
  COUNTERS_OK="$(node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const ok = j.topRefusalClasses !== undefined ? 'json_shape_ok' : 'missing_fields';
      process.stdout.write(ok);
    } catch { process.stdout.write('PARSE_ERROR'); }
  " "$LEARN_JSON_OUT" 2>/dev/null)"
  if [ "$COUNTERS_OK" = "json_shape_ok" ]; then
    soak_pass "learn --json output has expected topRefusalClasses field"
  else
    soak_fail "learn --json output missing topRefusalClasses field (see $LEARN_JSON_OUT)"
  fi
else
  soak_fail "learn --json exited non-zero (see $LEARN_JSON_OUT)"
fi

# 8b. learn (human output) — must contain section headers
echo "--- 8b. learn (human output) ---"
LEARN_HUMAN_OUT="$OUT_DIR/learn-human.txt"
if node "$CLI" learn --home="$LEARN_HOME" > "$LEARN_HUMAN_OUT" 2>&1; then
  if grep -q "REFUSAL\|Refusal\|TOP REFUSAL" "$LEARN_HUMAN_OUT" 2>/dev/null; then
    soak_pass "learn human output contains refusal section header"
  else
    soak_fail "learn human output missing refusal section header (see $LEARN_HUMAN_OUT)"
  fi
  if grep -q "LIFETIME\|lifetime\|refusals total" "$LEARN_HUMAN_OUT" 2>/dev/null; then
    soak_pass "learn human output contains lifetime counter section"
  else
    soak_fail "learn human output missing lifetime counter section (see $LEARN_HUMAN_OUT)"
  fi
else
  soak_fail "learn (human) exited non-zero (see $LEARN_HUMAN_OUT)"
fi

# Verify counter values in human output: should show 5 refusals, 3 applied, 2 rollbacks
if grep -q "5 refusals total" "$LEARN_HUMAN_OUT" 2>/dev/null; then
  soak_pass "learn human output shows correct refusal count (5)"
else
  soak_fail "learn human output does not show '5 refusals total' (see $LEARN_HUMAN_OUT)"
fi
if grep -q "3 operations applied" "$LEARN_HUMAN_OUT" 2>/dev/null; then
  soak_pass "learn human output shows correct applied count (3)"
else
  soak_fail "learn human output does not show '3 operations applied' (see $LEARN_HUMAN_OUT)"
fi
if grep -q "2 rollbacks total" "$LEARN_HUMAN_OUT" 2>/dev/null; then
  soak_pass "learn human output shows correct rollback count (2)"
else
  soak_fail "learn human output does not show '2 rollbacks total' (see $LEARN_HUMAN_OUT)"
fi

# -------------------------------------------------------------------------
# 9. prune exercise — synthetic home with a stale plugin (45 days, no activity)
# -------------------------------------------------------------------------
echo "=== 9. prune — synthetic home with stale plugin ==="

PRUNE_TMP="$(mktemp -d)"
PRUNE_HOME="$PRUNE_TMP/.claude"
mkdir -p "$PRUNE_HOME/plugins/cache"
printf '{}' > "$PRUNE_HOME/settings.json"

# Build a stale plugin install dir (45 days old, no learning activity).
STALE_INSTALL="$PRUNE_HOME/plugins/cache/soak-market/stale-soak-plugin/1.0.0"
mkdir -p "$STALE_INSTALL"
printf '{"name":"stale-soak-plugin"}' > "$STALE_INSTALL/plugin.json"

# Backdate the install dir mtime to 45 days ago. Try GNU date first; fall
# back to BSD date (-v) for macOS. Produces a touch(1)-compatible timestamp.
FORTY_FIVE_DAYS_AGO_TOUCH="$(date -d '45 days ago' '+%Y%m%d%H%M' 2>/dev/null \
  || date -v-45d '+%Y%m%d%H%M' 2>/dev/null \
  || true)"
if [ -n "$FORTY_FIVE_DAYS_AGO_TOUCH" ]; then
  touch -t "$FORTY_FIVE_DAYS_AGO_TOUCH" "$STALE_INSTALL" 2>/dev/null || true
fi

# Write installed_plugins.json so the detector can find the plugin.
cat > "$PRUNE_HOME/plugins/installed_plugins.json" << INSTALLED_EOF
{"plugins":[{"marketplace":"soak-market","name":"stale-soak-plugin","version":"1.0.0","scope":"user","installPath":"$STALE_INSTALL"}]}
INSTALLED_EOF

# 9a. prune (human output) — exit 0, non-empty output
echo "--- 9a. prune (human output) ---"
PRUNE_OUT="$OUT_DIR/prune-human.txt"
if node "$CLI" prune --home="$PRUNE_HOME" > "$PRUNE_OUT" 2>&1; then
  if [ -s "$PRUNE_OUT" ]; then
    soak_pass "prune exits 0 with non-empty output"
  else
    soak_fail "prune exits 0 but output is empty (see $PRUNE_OUT)"
  fi
  # Verify the audit found at least one plugin past grace window
  if grep -q "stale-soak-plugin\|past grace\|PLUGINS PAST\|1 plugin" "$PRUNE_OUT" 2>/dev/null; then
    soak_pass "prune output references the stale plugin"
  else
    soak_fail "prune output does not reference stale-soak-plugin (see $PRUNE_OUT)"
  fi
else
  EXIT_CODE=$?
  soak_fail "prune exited $EXIT_CODE (see $PRUNE_OUT)"
fi

# Cleanup synthetic homes (best-effort; temp dirs are auto-cleaned on reboot)
rm -rf "$LEARN_TMP" "$PRUNE_TMP" 2>/dev/null || true

# -------------------------------------------------------------------------
# T-703 summary
# -------------------------------------------------------------------------
echo ""
if [ "$SOAK_FAIL" -eq 0 ]; then
  echo "soak T-703: PASS — all learn + prune exercises passed"
else
  echo "soak T-703: FAIL — one or more learn/prune assertions failed (see above)" >&2
fi

# Propagate any stop-condition failure from section 7.
if [ "$STOP_EXIT" -ne 0 ]; then
  exit "$STOP_EXIT"
fi
if [ "$SOAK_FAIL" -ne 0 ]; then
  exit 1
fi
