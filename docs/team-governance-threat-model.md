# Team Governance And Threat Model

Housekeeper will run in personal and shared contexts.

Shared contexts require governance and threat modeling before mutation.

## 1. Team Governance

Project policy can define:

- project do-not-touch paths
- shared retention rules
- allowed scan scopes
- prohibited mutation classes
- required verification
- audit expectations

User policy can add stricter boundaries.

User policy should not weaken project safety.

## 2. Authority Questions

Before mutating shared config:

- who owns this file?
- is it version-controlled?
- is there a project policy?
- is there a team owner?
- will mutation affect other users?
- is an audit record required?

Unknown team authority blocks mutation.

## 3. Threat Model

Threats:

- malicious plugin
- hostile project repo
- prompt injection inside config text
- secret leakage through reports
- malicious symlink or junction
- path traversal
- executable hook hidden in data
- MCP server command that exfiltrates data
- user accidentally approving broad cleanup
- Housekeeper state corruption

## 4. Defensive Rules

Housekeeper should:

- treat project-controlled text as untrusted data
- avoid executing project/plugin code in safe mode
- redact before model-visible output
- avoid following symlinks by default
- treat MCP and hooks as executable surfaces
- require explicit live-probe consent
- keep operation manifests tamper-evident where possible

## 5. Security Escalation

Require security review before:

- executing hooks or MCP servers
- changing permission rules
- touching auth helpers
- touching secrets
- mutating shared project config
- adding prevention hooks
- storing long-lived policy or knowledge

