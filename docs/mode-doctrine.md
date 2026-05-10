# Mode Doctrine

Each Housekeeper mode has strict behavior limits.

## 1. Safe Mode

Purpose:

- recover orientation when Claude may be broken

Allowed:

- parse bounded files
- inspect metadata
- check direct path existence
- classify surfaces structurally
- produce report

Forbidden:

- call Claude live commands
- run hooks
- start MCP servers
- execute plugin code
- mutate files
- claim live health

## 2. Diagnose

Purpose:

- produce read-only structural report

Allowed:

- broader structural scan
- classify surfaces
- collect structural and ownership evidence
- suggest probes

Forbidden:

- mutation
- live execution unless explicitly live diagnose
- "fixed" language

## 3. Live Diagnose

Purpose:

- collect loader and behavioral keys

Allowed with consent:

- Claude truth probes
- hook debug traces
- MCP status
- clean-config comparison

Forbidden:

- mutation
- hidden live probes
- broad action based on one probe

## 4. Plan

Purpose:

- produce reviewable operation candidates

Allowed:

- group findings by stance
- propose exact targets
- list preconditions
- list rollback requirements
- ask for consent

Forbidden:

- treating plan as permission
- bundling protected or blocked items

## 5. Act

Purpose:

- execute one approved operation

Required:

- exact consent
- surface classification
- evidence keys
- snapshot
- rollback manifest
- verification plan

Forbidden:

- broad cleanup
- checkpoint-only rollback
- action with stale preconditions

## 6. Verify

Purpose:

- prove outcome or name residual risk

Allowed:

- targeted probes
- smoke tests
- report residual risk

Forbidden:

- claiming done because a write succeeded
- continuing after first dependency failure as if success

## 7. Harden

Purpose:

- install prevention only after review

Allowed:

- propose guards
- show hook/policy additions
- require consent

Forbidden:

- silently adding SessionStart hooks
- broad policy changes
- hidden background automation

