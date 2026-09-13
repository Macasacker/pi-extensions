# web-search

Safe, allowlist-gated web search and fetch for the [pi](https://github.com/earendil-works/pi-mono) coding agent.

Gives the agent a way to pull in external context when the local codebase is not enough — while keeping the network surface explicitly under your control via an **allowed list of domains**.

## Tools

| Tool | What it does |
|---|---|
| `web_search` | Searches the web. **Only results from allowed domains are returned**; results from other domains are hidden (you see a count, never the content). |
| `web_fetch` | Fetches a page on an allowed domain and returns its readable text, wrapped in explicit "untrusted content" delimiters. |

## Commands

| Command | What it does |
|---|---|
| `/web-search-domains` | Show the effective allowlist (with sources: built-in / global / project) |
| `/web-search-domains add <domain> [--project]` | Add a domain (global by default; `--project` requires a trusted project) |
| `/web-search-domains remove <domain> [--project]` | Remove a domain |
| `/web-search-status` | Show provider, limits, and session usage (call count, granted hosts) |

## Install

```bash
cd <this directory>
npm install
```

Enable in `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["~/workspace/pi-extensions/web-search/index.ts"]
}
```

Or drop/copy the directory into `~/.pi/agent/extensions/` (or a project's `.pi/extensions/`).

## Configuration

All options live under the `webSearch` key in `~/.pi/agent/settings.json` (global) and, for trusted projects, `.pi/settings.json` (project). Project settings **extend** the global list — they never replace it.

```jsonc
{
  "webSearch": {
    "enabled": true,                    // false → both tools refuse to run
    "provider": "duckduckgo",           // "duckduckgo" (default, zero-config) | "brave"
    "braveApiKey": "$BRAVE_API_KEY",    // literal or $ENV_VAR; only for "brave"
    "allowedDomains": ["example.com"],  // unioned with built-ins and other sources
    "useBuiltins": true,                // false → drop the built-in default list
    "allowSubdomains": true,            // entry example.com also matches a.example.com
    "confirmOutsideAllowlist": false,   // true → prompt (UI modes) to fetch other domains,
                                         //   granting a session-scoped, host-limited exception
    "maxResults": 8,                    // 1..20
    "maxContentChars": 20000,           // 1000..100000, per fetch
    "maxDownloadBytes": 2097152,        // 1KB..10MB download cap
    "timeoutMs": 15000,                 // 1000..120000 per request
    "maxRedirects": 5,                  // 0..10
    "blockPrivateNetworks": true        // block loopback/RFC1918/link-local/ULA even if listed
  }
}
```

### Built-in default allowlist

`developer.mozilla.org`, `docs.python.org`, `docs.nodejs.org`, `nodejs.org`, `typescriptlang.org`, `github.com`, `stackoverflow.com`, `en.wikipedia.org`, `crates.io`, `pypi.org`, `npmjs.com`, `kubernetes.io`, `docs.docker.com`

Set `"useBuiltins": false` to start from an empty list.

## Safety model

- **Fail-closed.** Anything not on the allowlist is blocked. Non-interactive modes (`-p`, json, rpc) never prompt — they block.
- **Hostname-only matching.** URLs are parsed with `new URL()` and matched on the normalized hostname (lowercased, default port and `www.` stripped, IDN → punycode). This defeats `http://allowed.com@evil.com/`, `http://evil.com/allowed.com`, `http://allowed.com.evil.com/`, and lookalike IDN hosts. Entries match a host or its subdomains — never a substring of the URL.
- **SSRF guards.** Only `http:`/`https:`. IP-literal hosts never match a domain entry; private/reserved ranges (loopback, RFC1918, link-local incl. cloud metadata, ULA, CGNAT) are blocked by default.
- **Redirects re-validated at every hop** (max `maxRedirects`). A redirect that leaves the allowlist aborts the fetch.
- **Prompt-injection framing.** Fetched text is wrapped in `<<< UNTRUSTED WEB CONTENT … >>>` delimiters and the tool descriptions instruct the model to treat results as untrusted data.
- **Terminal-escape sanitization.** All web-derived and LLM-supplied strings (titles, snippets, URLs, extracted text) are stripped of OSC/CSI/escape sequences and control characters before reaching the TUI — a fetched page (or a prompt-injected model echoing one) cannot write to your clipboard (OSC 52) or repaint the screen.
- **Resource caps.** Per-request timeout, download byte cap, extracted-text char cap (truncated output is saved to a temp file and referenced), redirect cap.
- **Audit trail.** Every call is logged as a TUI-only session entry (`[web-search] fetch …`) and in the footer status.
- **Project trust.** Project `.pi/settings.json` allowlist entries are only honored when the project is trusted.
- **Allowlist is user-owned.** The extension's tools can never modify the allowlist — only the user's `/web-search-domains` command can. The agent is instructed (via the web-research skill) to never expand the allowlist on its own judgment and to surface the exact command instead. As defense in depth, the extension snapshots the effective allowlist on every tool call and warns (footer notification + session log entry) if it changed out-of-band mid-session — e.g. the agent editing `settings.json` with the built-in file tools.

Known limits: this is an input/output guard, not a sandbox. `bash` + `curl` can still reach any host — pi has no built-in sandbox by design. For unattended or untrusted work, run pi in a container/VM with restricted network access. The allowlist checks hostnames, not resolved addresses: a domain you allow that later resolves to an internal IP (DNS rebinding/hijack, or wildcard services like `nip.io` if you allow them) is not caught. On pages without `<article>`/`<main>` markers, extraction falls back to `<body>` and may include header/TOC text.

## Search providers

- **DuckDuckGo (default)** — scrapes the `html.duckduckgo.com` endpoint. Zero-config, unofficial; under heavy load or from datacenter IPs DDG may serve a challenge page, in which case the tool reports it and suggests Brave.
- **Brave** — official API, reliable. Free tier: 2,000 queries/month. Get a key at https://api-dashboard.search.brave.com, then set `"provider": "brave"` and `"braveApiKey": "$BRAVE_API_KEY"` (or a literal). If the key is missing the extension falls back to DuckDuckGo with a warning.

## Site quirks (verified 2026-09-13)

Some sites block or login-wall anonymous non-browser clients: pages come back as JavaScript shells, or endpoints redirect to a login page. `web_fetch` flags pages that return little readable text, telling the model to try an alternate endpoint. Every built-in allowlist domain was probed with the extension's exact User-Agent/headers; results from this machine (a datacenter IP):

| Domain | Status | Workaround / notes |
|---|---|---|
| `developer.mozilla.org` | ✅ clean | — |
| `docs.python.org` | ✅ clean | — |
| `docs.nodejs.org` | ⚠️ redirect | Redirects to `nodejs.org` but **drops the page path** (lands on the API index). Use `https://nodejs.org/docs/latest/api/<page>.html` directly |
| `nodejs.org` | ✅ clean | Pages are large (~850KB); fine under the default 2MB download cap |
| `typescriptlang.org` | ⚠️ JS redirect | Old handbook URLs (e.g. `/docs/handbook/modules.html`) return an 80-byte JS-redirect shell. Use the new URL form (e.g. `/docs/handbook/modules/introduction.html`) which serves full content |
| Sports scores (ESPN) | ⚠️ JS shell on HTML | `www.espn.com/soccer/scoreboard/...` and BBC's scores/fixtures pages render scores client-side (static HTML has no data). Use ESPN's JSON API: `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=YYYYMMDD` (add `espn.com` to the allowlist) — clean JSON with scores, scorers, cards, and status. `prod-public-api.premierleague.com` failed DNS on this machine; `api.premierleague.com` endpoints 404 |
| `github.com` | ✅ clean | — |
| `stackoverflow.com` | ❌ 403 | Blocks datacenter IPs; no same-domain anonymous workaround (`api.stackexchange.com` is a different domain — add it to the allowlist if needed) |
| `en.wikipedia.org` | ✅ clean | ~1MB per article |
| `crates.io` | ⚠️ 404 on HTML | HTML pages 404 for bot clients; use the JSON API: `https://crates.io/api/v1/crates/<name>` |
| `pypi.org` | ✅ clean | Server-rendered; code samples may carry inline `<span>` markup artifacts |
| `npmjs.com` | ❌ 403 (www) | `www.npmjs.com` blocks datacenter clients; use `https://registry.npmjs.org/<package>` (same allowlist entry via subdomain) — clean JSON with versions and dist-tags |
| `kubernetes.io` | ✅ clean | ~500KB per page |
| `docs.docker.com` | ✅ clean | — |
| `reddit.com` (user-added) | ⚠️ login wall | `.json` and gateway API endpoints redirect to `/login/` or serve JS shells; use `https://www.reddit.com/r/<sub>/new/.rss` (or `/hot/.rss`) — server-rendered, full post text |

General patterns when a site walls you off: `old.` variants, `?format=json` / `.rss` endpoints, or vendor JSON APIs (registry.npmjs.org, crates.io/api, api.stackexchange.com). If a site you use regularly keeps blocking, consider a reader proxy on the allowlist. Results are time-dependent — bot-blocking rules change; re-probe if a ✅ site starts failing.

## Configuration notes

- The allowlist and all `webSearch` settings are re-read on **every tool call** — changes via `/web-search-domains` or by editing `settings.json` take effect immediately, no restart or `/reload` needed.
- The agent never adds domains on its own judgment — it surfaces the exact `/web-search-domains add <domain>` command and waits for your decision. If the allowlist changes out-of-band mid-session (e.g. the agent editing `settings.json` with the built-in file tools), the extension warns you and logs it.
- `web_search` hides results from non-allowed domains entirely (you see a count, never the content). If a search returns "No results from allowed domains", the information exists but lives on domains you haven't allowed — widen the list with `/web-search-domains add <domain>`.

## Development

```bash
npm test
```

Runs the full suite (no network): domain-matcher bypass matrix, config precedence/trust gating, HTML extraction, provider parsing (fixtures), safe-fetch integration tests against local HTTP servers (redirects, loops, caps, timeouts, cancellation), and an end-to-end test that loads the real extension with a mocked `ExtensionAPI`.

Layout:

```
index.ts            extension entry: tools, commands, session state
src/domains.ts      allowlist matcher (pure, security-critical)
src/config.ts       settings loading/merging/validation
src/fetch.ts        safe fetch: redirect re-validation, caps, timeouts
src/extract.ts      HTML → readable text, truncation
src/providers/      duckduckgo.ts, brave.ts, types.ts
src/render.ts       TUI rendering for tool calls/results
test/               harness + unit/integration/e2e tests
```
