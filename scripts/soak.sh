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
if [ "$COUNT" -eq 0 ]; then
  echo "soak: PASS — no stop conditions triggered"
else
  echo "soak: FAIL — $COUNT stop conditions in $CHECK_OUT" >&2
  cat "$CHECK_OUT" >&2
  exit 2
fi

echo "soak: complete. Results: $OUT_DIR"
