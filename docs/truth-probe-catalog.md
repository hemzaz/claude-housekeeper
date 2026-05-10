# Truth-Probe Catalog

Truth probes are live keys.

They are stronger than structural evidence, but they may load Claude, run hooks,
start MCP servers, use credentials, or write logs. They are never safe-mode
operations.

## Probe Classes

- `structural`: parse or inspect files only
- `loader`: ask Claude what it resolved
- `behavioral`: run a bounded action
- `environment`: inspect runtime availability

## Catalog

| Probe | Class | Proves | May execute | Consent |
| --- | --- | --- | --- | --- |
| `claude --version` | environment | Claude binary exists and starts enough to print version | Claude binary startup | low |
| `/doctor` | loader | config/schema/install warnings Claude can see | Claude session load | medium |
| `/status` | loader | active settings sources and managed status | Claude session load | medium |
| `/context` | loader | current context composition | Claude session load | medium |
| `/memory` | loader | loaded memory files and rules | Claude session load | medium |
| `/skills` | loader | resolved skill sources | Claude session load, skill registry load | medium |
| `/agents` | loader | configured subagents | Claude session load | medium |
| `/hooks` | loader | active hook configurations | Claude session load, hook registry load | medium |
| `/mcp` | loader | MCP server status | may start or contact MCP depending behavior | high |
| `/permissions` | loader | resolved allow and deny rules | Claude session load | medium |
| `claude --debug hooks` | behavioral | hook matching and execution traces | may run hooks | high |
| `claude --debug mcp` | behavioral | MCP startup and errors | may start MCP servers | high |
| bare prompt | behavioral | Claude binary can complete without registry load assumptions | Claude process, auth | medium |
| full registry prompt | behavioral | registry loads end to end | hooks/plugins may load | high |
| tool-use prompt | behavioral | tool layer works | tool execution | high |
| subagent prompt | behavioral | agent dispatch works | agent harness | high |

## Safe-Mode Rule

Safe mode may recommend truth probes, but must not run them.

## Probe Output Contract

Each proposed probe should say:

- what it may prove
- what it may execute
- whether credentials may be used
- whether hooks or MCP may start
- what result would change the finding
- what remains unknown even if it passes

