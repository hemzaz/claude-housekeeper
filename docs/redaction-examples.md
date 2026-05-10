# Redaction Examples

Housekeeper must make reports useful without leaking secrets or private
environment details.

Default shareable reports should redact before output reaches a model, issue
tracker, or public channel.

## Path Prefixes

Before:

```text
/Users/elad/.claude/settings.json
```

After:

```text
~/.claude/settings.json
```

Before:

```text
/Users/elad/work/customer-bank/.claude/settings.json
```

After:

```text
<project>/.claude/settings.json
```

## Command Strings

Before:

```text
ANTHROPIC_API_KEY=sk-ant-... node /Users/elad/.claude/hooks/notify.js
```

After:

```text
<redacted-env>=<redacted> node ~/.claude/hooks/notify.js
```

Before:

```text
npx -y @vendor/server --token abc123 --workspace acme-prod
```

After:

```text
npx -y @vendor/server --token <redacted> --workspace <redacted-name>
```

## MCP Config

Before:

```json
{
  "mcpServers": {
    "prod-db": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "DATABASE_URL": "postgres://user:pass@host/db"
      }
    }
  }
}
```

After:

```json
{
  "mcpServers": {
    "<redacted-name>": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "DATABASE_URL": "<redacted>"
      }
    }
  }
}
```

## Secret-Adjacent Files

Report structure:

```text
path: ~/.env
surface: secret-adjacent
content: not read
stance: protect
```

Do not print:

- secret values
- private key material
- full `.env` content
- auth helper output
- raw shell history

## Hashes

Hashes may be useful for duplicate detection, but can become identifiers.

Default:

- local report: full hash allowed
- shareable report: shortened hash
- privacy mode: hash optional or omitted

Example:

```text
sha256: 4b7f2c1a...
```

## Redaction Failure Rule

If Housekeeper is not confident it can redact safely, it should degrade output
instead of printing raw content.

