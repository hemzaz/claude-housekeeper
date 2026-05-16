# Versioning Policy

`claude-housekeeper` follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for the package version, with two pinned caveats already noted in
[`CHANGELOG.md`](../CHANGELOG.md). This document defines what counts as a
breaking change, what is stable within a major, and what triggers the next
minor (v0.3) versus the next major (v1.0).

The companion documents are
[`docs/schema-stability.md`](./schema-stability.md) for the field-level
stability classes and
[`docs/threat-model.md`](./threat-model.md) for the trust boundaries that
back any change to the mutation surface.

---

## 1. What is stable within a major

The following surfaces are stable across every release within a major line
(e.g. `0.2.0` → `0.2.1` → `0.2.x`). Renaming, removing, or breaking the
meaning of any of these is a major-version bump.

### 1.1 Detector ids

Detector ids — strings like `plugin.cache_unreferenced`,
`registry.local_command_identical`, `housekeeper.interrupted_operation` —
are stable within a major. The current set is enumerated in the
"Current Checks" table of [`README.md`](../README.md). Within a major:

- Renaming a detector id (e.g. `plugin.cache_unreferenced` →
  `plugin.unreferenced_cache`) is **breaking**.
- Removing a detector id is **breaking** (consumers may be filtering on it).
- Adding a new detector id is **additive** and ships in a minor.

Test pin: `test/schema-stability.test.mjs` exercises the stable ids
through fixture goldens.

### 1.2 Refusal `class` and `reason` strings

The clean refusal taxonomy (see
[`docs/design/clean-design.md §2`](./design/clean-design.md) and the
12-rule classifier in `scripts/lib/clean-plan.mjs`) emits refusals shaped
as `{ class, reason, message, exitCode, ... }`. Within a major:

- `class` enum values (e.g. `"scope"`, `"protection"`, `"shape"`,
  `"manifest"`, `"snapshot"`) are stable.
- `reason` string values (e.g. `"detector-not-cleanable"`,
  `"path-outside-home"`, `"symlink-refused"`,
  `"manifest-not-rollbackable"`) are stable. Scripts may grep them.
- `message` text is **not** part of the contract; phrasing may improve.
- `exitCode` values are stable per [`docs/protocol-spec.md`](./protocol-spec.md).

Adding a new refusal `class` or `reason` is additive. Renaming an existing
one is breaking.

### 1.3 Report `schemaVersion: "0.1"`

The JSON report (`--json`) shape is pinned at `schemaVersion: "0.1"` and
moves on its **own line**, independent of the package version. The
exhaustive list of stable fields lives in
[`docs/schema-stability.md`](./schema-stability.md#stable-fields-for-01).

- A bump to `"0.2"` will accompany a removed/renamed/repurposed stable
  field and a migration guide.
- Adding optional fields is additive and does not bump `schemaVersion`.
- Within a `schemaVersion`, readers MUST tolerate unknown fields and
  unknown enum values.

### 1.4 Manifest `schemaVersion: "0.2"`

The operation manifest written by `clean --confirm` and consumed by
`rollback`/`rollback --abort` is pinned at `schemaVersion: "0.2"` and
moves on its **own line**, independent of the package version and
independent of the report's `schemaVersion`. The exhaustive list of
stable manifest fields lives in
[`docs/schema-stability.md §Stable Fields For 0.2`](./schema-stability.md#stable-fields-for-02-operation-manifest)
with the full schema in
[`docs/rollback-contracts.md §3`](./rollback-contracts.md#3-manifest-schema).

- A bump to `"0.3"` will accompany a migration guide and a
  backward-compatibility reader (same pattern as
  [`docs/rollback-contracts.md §6`](./rollback-contracts.md#6-migration-path-for-v01x-manifests)).
- Status enum values (`planned`, `snapshot_taken`, `applied`,
  `verified`, `rolled_back`, `aborted`) are stable; readers MUST
  tolerate future additions.

### 1.5 Bin name and plugin command

- The npm package name `claude-housekeeper` is stable across majors
  until the package itself is renamed.
- The bin name `claude-housekeeper` (per `package.json` `bin`) is
  stable within a major.
- The slash command `/claude-housekeeper:housekeep` (per
  `.claude-plugin/plugin.json`) is stable within a major.

### 1.6 Public flags and command surface

The flags documented in the CLI `--help` and in the README "Command Surface"
section (`diagnose`, `plan`, `verify`, `clean`, `rollback`, `--scope`,
`--target`, `--path`, `--confirm`, `--yes`, `--abort`, `--dry-run`,
`--safe`, `--redact`, `--json`, `--home`, `--config`) are stable within a
major. Adding a new flag is additive. Removing one or changing its
semantics is breaking.

---

## 2. What triggers a v0.3 (minor) vs v1.0 (major)

### v0.3 — minor, additive only

A minor release adds capability without breaking existing consumers. Any
of the following on its own justifies v0.3:

- **A new detector id.** E.g. `settings.invalid_json` becomes cleanable.
- **A new mutation kind** added to `MUTATION_REGISTRY`. E.g. a
  `settings-rewrite` kind joining today's `dir-rmtree` and `file-unlink`.
- **A new flag** added to the CLI (e.g. `--timeout`, `--quiet`).
- **A new optional field** on the report or manifest (consumers ignore
  unknown fields per §1.3 and §1.4).
- **A new refusal `class` or `reason`** value.
- **A new status enum value** on the manifest (readers tolerate per §1.4).
- **A new top-level command** added alongside `clean` / `rollback` /
  `diagnose` / `plan` / `verify` (e.g. `harden`). New commands extend
  the surface; existing commands keep their flags and semantics.

### v0.3 confirmation: `harden` and `settings-rewrite` are additive

The v0.3 release line adds two surfaces. Both are additive under §2.1
and the bullets above; neither triggers a v1.0:

1. **`settings-rewrite` mutation kind.** A new entry in
   `MUTATION_REGISTRY` per
   [`docs/design/v0.3-design.md §3.1`](./design/v0.3-design.md#31-settings-rewrite-mutation-kind).
   Joins `dir-rmtree` and `file-unlink` without renaming or removing
   either. Manifest `schemaVersion` stays `"0.2"`; readers MUST
   tolerate the new `mutationKind` value per §1.4. Documented in
   [`schema-stability.md` documented mutation kinds](./schema-stability.md#documented-mutation-kinds).

2. **`harden --confirm` command.** A new top-level command mirroring
   `clean --confirm`'s flag set (`--confirm`, `--yes`, `--target=`,
   `--path=`, `--dry-run`, `--timeout=`, `--json`, `--safe`) per
   [`docs/design/v0.3-design.md §3.6`](./design/v0.3-design.md#36-harden-cli-surface).
   No existing flag's semantics change; the `command` field in the
   operation manifest already enumerates `"harden"` as a stable value
   per §1.4 of this doc and the schema-stability table.

Per §1.6, adding a new command and adding new flags to that new command
are additive. Existing commands' help text, exit codes, and
refusal-classifier behavior are unchanged. The 12-rule classifier in
`scripts/lib/clean-plan.mjs` is shared between `clean` and `harden`
(per design §3.2) and gains new refusal `reason` values
(`settings-jsonc-detected`, `settings-shape-unknown`,
`patch-not-idempotent`, `patch-produces-invalid-json`,
`settings-network-filesystem`, `batch-exceeds-aggregate-budget`) —
adding a new `reason` is explicitly additive per §1.2.

The corresponding `clean --batch` extension (multiple `--target=` /
`--path=` pairs aggregated into one operation manifest, per design
§3 and the Q3 ruling in design §2.3) is also additive: `--batch` is a
new flag, repeated pair parsing is a parser-only addition, and the
manifest carries one or many `files[]` entries the same way it
already does. No `schemaVersion` bump.

The `schemaVersion` "own line" rule from §1.3 and §1.4 still binds —
v0.3 does not touch either schema version. A future release that
needs to break either line will move the package to v1.0 in the same
release per §2.

### v1.0 — major, breaking change required

A major release is justified when a stable surface needs to change in a
way consumers cannot tolerate. Any of the following triggers v1.0:

- **Renaming a detector id** (e.g. consolidating two detectors into one
  under a new name).
- **Removing a detector id** that consumers depend on.
- **Changing a refusal `class` or `reason` string.**
- **Changing the report shape** beyond what `schemaVersion: "0.1"`
  permits (would also bump the report `schemaVersion` to `"0.2"`).
- **Changing the manifest shape** beyond what `schemaVersion: "0.2"`
  permits (would also bump the manifest `schemaVersion` to `"0.3"`).
- **Removing a flag** from the CLI surface, or changing the semantics
  of an existing flag.
- **Renaming the bin** `claude-housekeeper` or the slash command
  `/claude-housekeeper:housekeep`.

The two `schemaVersion` values move on their own lines, but a bump in
either is a project-level signal serious enough that the package
version moves to v1.0 in the same release.

---

## 3. Pre-1.0 caveat

This project is pre-1.0. Per semver §4, anything MAY change in a 0.x →
0.y transition. The policy above is the contract this project chooses
to enforce despite that latitude:

- Detector ids, refusal `class`/`reason`, schema versions, and the bin
  name are treated as stable within a major **starting with v0.2.0**.
- v0.1 → v0.2 was the last release that took advantage of pre-1.0
  latitude (added mutation, manifests, snapshots, rollback). The
  v0.1 → v0.2 migration is documented in
  [`docs/migration-v0.1-to-v0.2.md`](./migration-v0.1-to-v0.2.md).

---

## 4. The two pinned semver caveats

Repeated here for visibility — these also live in the
[`CHANGELOG.md`](../CHANGELOG.md) header:

1. **Detector ids are stable within a major.** Renaming `plugin.cache_unreferenced`
   to `plugin.unreferenced_cache` requires a major bump even if the
   detection logic is otherwise unchanged.
2. **Report `schemaVersion` (`"0.1"`) and operation-manifest
   `schemaVersion` (`"0.2"`) each move on their own line.** Neither
   is tied to the package version. A package version bump (e.g.
   v0.2.0 → v0.2.1) does not imply either schema moved; a schema
   bump (e.g. report `"0.1"` → `"0.2"`) implies a coordinated v1.0
   package bump per §2.

---

## 5. See also

- [`docs/schema-stability.md`](./schema-stability.md) — exhaustive
  stable-field reference for both `schemaVersion` lines.
- [`docs/rollback-contracts.md`](./rollback-contracts.md) — manifest
  schema, status enum, legacy-manifest migration rules.
- [`docs/threat-model.md`](./threat-model.md) — trust boundaries that
  back any change to the mutation surface.
- [`CHANGELOG.md`](../CHANGELOG.md) — per-tag delta and the two pinned
  semver caveats in the header.
