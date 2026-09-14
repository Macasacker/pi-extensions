# Ledger: web-search code-design refactor

Status: **PHASE 2 COMPLETE — committed; phase 3 (signature cleanup) next.**
Phases 0–2 committed and pushed. Orchestrator: main session.
Loop per phase (per AGENTS.md Orchestration Convention): one implementation
subagent scoped to the phase (follows the `code-design` skill, runs the
validation gates, no commits) → orchestrator verifies the diff and re-runs the
gates → independent `adversarial-code-review` subagent → fix subagent +
re-validate + re-review until `Verdict: Ready` → per-phase commit (pre-approved
by the orchestration instruction) → update plan + ledger → next phase.

## Agreed scope (complete)

- Adapt the transaction-tracker `AGENTS.md` to this package: done.
  `web-search/AGENTS.md` (untracked new file) — gates re-pointed at the real
  tooling (custom test harness, tsc, eslint, README/skill docs, adversarial
  review); plan/ledger/commit/orchestration/context-hygiene conventions kept.

## Executed without approval (accepted 2026-09-14 — history)

All changes below were uncommitted at the pause; the user accepted the work.
Baseline at pause: commit `d69a101`. Verified at pause: 98/98 tests,
`npx tsc --noEmit` clean, `npm run lint` clean.

1. **Validation tooling**: devDeps (typescript ~5.9, @types/node, eslint 9,
   typescript-eslint) + `typecheck`/`lint` scripts; `tsconfig.json`,
   `eslint.config.mjs`; pi-runtime symlinks into `node_modules/@earendil-works/`.
2. **Phase 0 — real defects found by the new typecheck gate** (bug fixes):
   - **Bug fixed:** `/web-search-domains` TUI dialog assigned a non-existent
     `onKey` property; pi-tui dispatches keys via `handleInput(data)`, so the
     dialog could never be dismissed. Now `DismissableText extends Text`
     (index.ts) using `matchesKey` (escape/return/ctrl+c).
   - `onUpdate` progress calls were missing the required `details` field
     (index.ts, 2 sites); `provider.search` now receives
     `signal ?? new AbortController().signal`; `extract.ts` element branch
     narrows via `instanceof HTMLElement`.
   - Regression test for the dialog fix + mock `custom` capture
     (`test/e2e.test.mjs`).
3. **Phase 1 — dead code & type holes** (pure refactor, behavior-preserving):
   - `updateSettingsDomains`: removed the never-read `domains` parameter
     (src/config.ts + call sites in index.ts, test/config.test.mjs)
   - `combinedSignal`: removed the no-op `cleanup` (src/fetch.ts, 4 call sites)
   - `truncateText`: magic `2000` → `DEFAULT_MAX_LINES` (src/extract.ts; the
     `maxLines` param was kept — tests exercise it; deviation noted in plan)
   - Typed implicit anys: `let raw: SearchResult[]`, `let res: SafeFetchResult`
     (index.ts)

## Orchestration state (2026-09-14, resume)

- Baseline at resume: 98/98 tests, `npx tsc --noEmit` clean, `npm run lint`
  clean; worktree clean (only pre-existing untracked files at repo root,
  out of scope: `.gitignore`, `.lsp_logs.txt`, `web-search-session.txt`).
- A whole-phase implementer subagent failed (output-token limit) and a retry
  was stopped by the user with no code changes left behind. Per user
  instruction, phase 2 is broken down **per affected file**: one
  implementation subagent per file, serially, each running the gates.
- Phases 3–7: not started.

### Phase 2 per-file worklist (items 5–7; `[ ]` = pending, `[x]` = gates green)

Source (leaf-first order):
1. [x] `src/render.ts` — item 5 (delete `const s = sanitizeForTui`) + locals
    (gates green; `r`→`searchResult` to avoid shadowing the `result` param)
2. [x] `src/sanitize.ts` — `cc`/`c`→`charCode`, `next`→`nextCharCode`, `i`→`charIndex`, `j`→`sequenceIndex`, `n`→`inputLength` (gates green)
3. [x] `src/domains.ts` — `h`→`normalizedHost`, `m`→`mappedMatch`, `hi`/`lo`→`highWord`/`lowWord`, octets→`firstOctet`/`secondOctet`, `v6`→`ipv6Address`, `url`→`parsedUrl`, `e`→`entry`/`normalizedEntry`, `allowSub`→`subdomainsAllowed` (gates green)
4. [x] `src/extract.ts` — `el`→`element`, `out`→`textFragments`, `l`→`line` (gates green)
5. [x] `src/config.ts` — `raw`→`fileContents`, `v`→`value` (params), `e`→`normalizedEntry`, `ws`→`webSearchSection`, `w`→`webSearchSettings`, `d`→`domain`/`sanitizedDomain`, `next`→`nextDomains`, `nextWs`→`nextWebSearchSection` (gates green)
6. [x] `src/fetch.ts` — `res`→`response`, `opts`→`options`, `err`→`error`, `next`→`nextUrl`/`extended`, `c`→`chunk` (gates green)
7. [x] `src/providers/duckduckgo.ts` — `u`→`parsedUrl`, `res`→`response`, `err`→`error`, `m`→`challengeMarker`, `a`→`resultLink`, `urlEl`→`resultHref` (gates green)
8. [x] `src/providers/brave.ts` — `res`→`response`, `r`→`result`, `t`→`responseBody`, `err`→`error` (gates green)
9. [x] `src/providers/types.ts` — no renames needed (`fetchImpl` deferred to phase 3 item 11; frozen public surface)
10. [x] `index.ts` — item 6 locals (`res`→`response`, `raw`→`searchResults`, `trunc`→`truncation`, `u`→`parsedUrl`, `loaded`→`loadedConfig`, `opts`→`allowlistOptions`, `err`→`error`, `msg`→`errorMessage`, `r`→`result`/`redirect`, `d`→`domain`/`existingDomain`/`details`, `ok`→`userConfirmed`, `list`→`allowlist`, …) + item 7 (`noteSession`→`recordSessionCall`, `allowlistOpts`→`buildAllowlistOptions`, `UNTRUSTED_BANNER_HEAD`→`buildUntrustedBannerHead`) (gates green; frozen surface verified intact)

Tests (identifier renames only; test names/assertions untouched):
11. [x] `test/sanitize.test.mjs` — `s`→`plainText` (gates green)
12. [x] `test/providers.test.mjs` — `DDG_FIXTURE`→`DUCKDUCKGO_HTML_FIXTURE` (gates green)
13. [x] `test/config.test.mjs` — `makeEnv`→`makeEnvironment`, `env`→`environment`, `root`→`tempDir`, `obj`→`settings`, `s`→`globalSettings`/`domainSource`, `d`→`domain`, `list`→`allowedDomains`, `file`→`settingsFile`, `trusted`/`untrusted`→`trustedConfig`/`untrustedConfig` (gates green)
14. [x] `test/domains.test.mjs` — `base`→`baseSettings`, `r`→`checkResult`, `url`→`testUrl`, `opts`→`settings`, `optIn`/`obfuscated`→`explicitOptInSettings`/`obfuscatedSettings` (gates green)
15. [x] `test/fetch.test.mjs` — `req`/`res`→`request`/`response`, `res`→`fetchResult`, `serverA`/`serverB`→`allowedServer`/`disallowedServer` (+ports), `i`→`chunkIndex`, `p`→`fetchPromise`, `err`→`error`, `base`→`defaultFetchOptions` (gates green)
16. [x] `test/e2e.test.mjs` — `extModule`→`extensionModule`, `ext`→`extension`, `pi`→`mockExtensionApi`, `ctx`→`mockContext`, `req`/`res`→`request`/`response`, `r`→`resolve`, `result`→`fetchResult`/`searchResult`, `r1`/`r2`→`firstFetchResult`/`secondFetchResult`, `err`→`error`, `lines`→`renderedLines`, `s`→`settings`, `n`→`notification`, `e`→`logEntry`, `d`→`domain`, `notifsBefore`/`newNotifs`/`logIdx`→`notificationsBefore`/`newNotifications`/`logStartIndex` (gates green; 103/103 line pairs identifier-only)

**All 16 files green.** Phase 2 completed: orchestrator re-ran gates
(98/98, tsc clean, lint clean), `git diff --numstat` confirmed 1:1 line swaps
everywhere except render.ts (deleted alias line, item 5). Independent
adversarial review (fresh read-only subagent, AST-level literal/comment
identity checks, export-surface verification, own 98/98 run): **Verdict:
Ready** — no Critical/Important findings.

Review carry-overs (non-blocking):
- [Optional] options-bag vocabulary drift: `checkUrl(rawUrl, opts)` still says
  `opts` while `safeFetch` says `options` and index.ts says `allowlistOptions` —
  fold into phase 6 (item 22 touches `checkUrl`'s shape).
- [Pre-existing] `src/sanitize.ts` header comment says CSI final byte
  `0x40-0x5E` but the code checks `0x40-0x7E` — fix in phase 7 (hygiene).
- Accepted deviation: `cc`→`charCode` (not `codePoint` — `charCodeAt` yields
  UTF-16 code units).

(`test/extract.test.mjs` scanned clean — no abbreviated locals.)

Rename table (defaults; agents use judgment per occurrence — name after the
domain concept, e.g. `e` in a catch clause → `error`): `res`→`response`,
`raw`→`searchResults`, `trunc`→`truncation`, `u`→`parsedUrl`, `e`→`entry`,
`d`→`details`, `r`→`result`, `c`→`content`, `w`→`webSearchSettings`,
`ws`→`webSearchSection`, `m`→`mappedMatch`, `cc`→`codePoint`,
`v6`→`ipv6Address`, `next`→`nextUrl`, `loaded`→`loadedConfig`.

## Not started

- Phases 3–7 of `plans/refactor-code-design.md` (signature cleanup, session
  state encapsulation, index.ts decomposition, control-flow polish, hygiene
  sweep). Phases 5 and 6 additionally end with a live `pi -p` smoke test;
  phase 6 with a fresh adversarial review pass.

## Decision (resolved 2026-09-14)

User accepted the Phase 0–1 work (committed as separate logical commits and
pushed to master) and **approved phases 2–7**. Executing per the Orchestration
Convention above.

## Next action

Phase 3 (signature cleanup, items 8–11): update ledger with the phase-3
worklist, then dispatch implementation subagents (per-file or per-item as
sized), verify + adversarial review + fix loop, commit, mark plan items
8–11 `[DONE]`, then phase 4 (session state encapsulation, items 12–15).
