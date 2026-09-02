# tui-footer

A readable, labeled replacement for pi's built-in TUI footer. Replaces the
cryptic token soup with:

```
~/workspace/local-llm-playground (master)
↑451k ↓39k cached 1.3M cache hit 64.1% $0.412 ctx 85k/262k (auto)   chat • xhigh
MCP: 1 server enabled
```

Reading the stats line (left to right):

| Part | Meaning |
|------|---------|
| `↑N` | tokens sent to the model this session (prompt tokens, session total) |
| `↓N` | tokens received from the model this session (completion tokens) |
| `cached N` | tokens served from the prompt cache (cheap input) |
| `cache-write N` | tokens written to the prompt cache |
| `cache hit X%` | cache-read share of the latest prompt |
| `$X.XXX` | total session cost (only shown when > $0) |
| `ctx N/M` | current context tokens / model context window — token amounts, not a percentage. Yellow above 70%, red above 90% |
| `(auto)` | auto-compaction is enabled |

Right side: model id + thinking level (+ provider when several are configured).
The working-directory line stays dim; the stats line uses the normal text color
so it stands out. Extension status lines (e.g. `MCP: 1 server enabled`) are
passed through unchanged, including any colors they set.

On narrow terminals the least-essential stats are dropped right-to-left, with
the `ctx` gauge going first — same behavior as pi's built-in footer.

## Install

The extension is wired up via the global pi settings
(`~/.pi/agent/settings.json`):

```json
{
  "extensions": ["~/workspace/pi-extensions/tui-footer/index.ts"]
}
```

Restart pi (or `/reload`) to pick up changes.

## Commands

- `/tui-footer` — (re)apply this footer
- `/footer-default` — restore pi's built-in footer

## Notes

- Works in TUI mode only; in print/JSON/RPC modes it installs nothing.
- Mirrors the built-in footer's usage accounting (assistant messages, tool
  results, compaction and branch-summary entries).
- After compaction the context gauge briefly shows `ctx ?/…` until the next
  LLM response, matching pi's built-in behavior.
- This extension survives `pi update` (it lives outside the pi package). A
  matching patch to the built-in footer in the installed pi package exists as
  a fallback for when this extension is disabled — re-apply it after updates
  if you ever run without this extension.

## Development

```sh
npm test   # mock-based render tests (node, no pi needed)
```
