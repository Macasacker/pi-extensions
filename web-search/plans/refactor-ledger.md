# Ledger: web-search code-design refactor

Status: **IN PROGRESS — phase 6 starting (phase 5 complete, 2026-09-14).**
Phases 0–5 are committed (phase 5: `49a97e0`, `9a21473`, `95623a3` code +
docs commits; 140/140 tests; live `pi -p` smoke green). Phase 6 is approved
and executing. Orchestrator: main session.
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

- Phase 6 (control-flow polish, items 22–28) — wave plan above; ends with
  full `npm test` + live `pi -p` smoke + a fresh adversarial review pass
  (bypass matrix re-verified).
- Phase 7 (hygiene sweep, items 29–31) — wave plan above; ends with final
  `npm test` + live smoke.

## Decision (resolved 2026-09-14)

User accepted the Phase 0–1 work (committed as separate logical commits and
pushed to master) and **approved phases 2–7**. Executing per the Orchestration
Convention above.

### Phase 3 worklist (items 8–11; per-item waves, serial)

1. [x] **3a — item 8**: split `guardEnabled` (index.ts:172) into
   `assertEnabled(config)` (throws) + `warnIfAllowlistEmpty(config, ctx)`
   (one-time notify). Behavior must stay byte-identical: throw message
   `"web-search is disabled (webSearch.enabled: false). Re-enable it in settings
   to use web_search/web_fetch."`, log entry
   `{ kind, target, ok: false, detail: "disabled (webSearch.enabled: false)" }`.
   Recommended call-site shape: `try { assertEnabled(config); } catch (error) {
   logCall(pi, ctx, { kind, target, ok: false, detail: "disabled (webSearch.
   enabled: false)" }); throw error; } warnIfAllowlistEmpty(config, ctx);`
   (implementer may choose an equivalent clean shape; both functions ≤2 args).
   — done: recommended shape used verbatim at both call sites; gates green.
2. [x] **3b — item 9**: `loadConfig({ cwd, projectTrusted, homeDir })` options
   object; `homeDir` defaults to `os.homedir()`. Call sites: index.ts (5, not 2 —
   noteAllowlistChange + both command handlers also call it),
   test/config.test.mjs (9, explicit homeDir kept). — done; gates green.
3. [x] **3c — item 10**: `NUMERIC_LIMITS` declarative spec iterated in the merge
   (one loop, one source of truth); replace the per-key `clampInt` calls
   (5 in the merge — the plan's "6" audit count was off; verify and report).
   — done: `NUMERIC_LIMITS` at module scope after BUILTIN_DEFAULTS
   (`as const` + `NumericConfigKey`), single loop in the merge, `clampInt`
   kept as the loop helper; confirmed 5 call sites (plan's "6×" was a
   miscount); gates green.
4. [x] **3d — item 11**: `SearchProvider.search(query, limit, signal)`; `fetchImpl`
   moves to factories `createDuckDuckGoProvider({ fetchImpl })` /
   `createBraveProvider(apiKey, { fetchImpl })`; `duckduckgoProvider` is
   `createDuckDuckGoProvider()`'s default instance. test/providers.test.mjs
   call sites updated; index.ts `getProvider` + e2e zero-arg `search` mocks
   verified unchanged. — done; gates green.

**Phase 3 complete.** Orchestrator re-ran gates (98/98, tsc clean, lint
clean) and verified the diff (factory bodies unchanged, 1:1 test swaps,
no positional `loadConfig` calls remain). Independent adversarial review:
**Verdict: Ready** — no Critical/Important findings. Carry-overs:
- [Optional, pre-existing] no test for Brave's 429 rate-limit branch
  (brave.ts:52-54) — add in phase 6 (item 24 touches the providers).
- Handoff accuracy notes: config.test.mjs had 8 (not 9) `loadConfig` sites;
  the "429" failure mode was never actually tested.

### Phase 4 worklist (items 12–15; per-item waves, serial)

1. [x] **4a — items 12 + 14**: new `src/session.ts` with `SessionState`
   interface (`{ grants, callCount, warnedBrave, warnedEmptyAllowlist,
   lastAllowlist }`) + `createSessionState()` factory. Inside the default
   export: `let session = createSessionState();` (closure scope); the three
   event-site resets become `session = createSessionState()`. Helpers that
   read/write session state take the object: `buildAllowlistOptions(config,
   session)`, `recordSessionCall(session, ctx)`, `warnIfAllowlistEmpty(config,
   session)`, `getProvider(config, session, ctx?)`, `checkAllowlistDrift(pi,
   ctx, config, session)`, `noteAllowlistChange(ctx, session)`, status report
   + `sessionGrants.add` site in web_fetch execute. **Pitfall:** every use
   site must read the closure `session` variable at call time and pass it in —
   never capture the object in a long-lived closure, or a reset rebind goes
   stale. `logCall` takes session only if it uses it (no dead params —
   report if the plan's list is wrong).
   — done; `logCall` uses no session state (left param-less, plan list
   corrected); `warnIfAllowlistEmpty` is `(config, session, ctx)` — 3 args,
   all needed (notify needs ctx); gates green.
2. [x] **4b — item 13**: split `checkAllowlistDrift` into pure
   `diffAllowlists(previous, current)` (returns `{ added, removed }`) +
   `reportAllowlistDrift(...)` (notify + log). `diffAllowlists` lives in
   `src/session.ts` or `src/domains.ts` (implementer's judgment); add unit
   tests for it (add-unit-test skill principles: GWT, failure modes).
   — done: `diffAllowlists` in `src/domains.ts` (allowlist-domain module,
   already imported by index.ts); 7 new unit tests in test/domains.test.mjs
   (baseline null, identical, grow, shrink, both, unsorted inputs,
   duplicates); suite now 105 tests; gates green.
3. [x] **4c — item 15**: move `setTestProvider`/`providerOverride` to
   `src/test-seam.ts` (module-level `let` + `getTestProvider()` accessor,
   clear "documented test seam" comment); index.ts re-exports
   `setTestProvider` (e2e surface unchanged) and `getProvider` uses
   `getTestProvider()`.
   — done; test-seam.ts is now the only module-level mutable `let` in the
   package; gates green.

**Phase 4 complete.** Orchestrator re-ran gates (105/105, tsc clean, lint
clean) and verified the diff (rebind pattern, grants Set identity, drift
semantics, seam re-export). Independent adversarial review: **Verdict:
Ready** — no Critical/Important findings; traced all 47 `session` references
for reset-rebind staleness (holds). Two Optional findings fixed by a focused
fix subagent before commit:
- e2e mock now records `session_start`/`session_shutdown` handlers; new test
  `should clear session grants and call counts when session_shutdown fires`
  pins the reset-rebind invariant (mutation-verified by the fixer: capturing
  the object at registration makes exactly this test fail).
- the "unsorted inputs" `diffAllowlists` test de-degenerated (genuinely
  unsorted inputs, ≥2 added/removed, compared as sets).
Suite is now 106 tests; all gates re-run green after the fixes. Phase 4
committed as `b9145a1` (code + tests) and `e9e75aa` (plan + ledger).

## Phase 5 wave plan (items 16–21; per-wave loop: implement → verify+gates →
## adversarial review → fix if needed → commit → ledger)

Phase 5 is broken into per-module waves (each wave keeps all gates green):

1. [x] **5a — item 16**: `src/tools/search.ts` — `executeWebSearch(params, deps)`
   (`deps` bundles `{ config, session, provider, signal, ctx, pi, onUpdate }`);
   named steps `runProviderSearch`, `filterResultsByAllowlist`,
   `formatSearchResults`. Shared helpers moved: `logCall`/`LogData` →
   `src/log.ts`; `prepareToolExecution` (new shared pre-flight) +
   `assertEnabled` → `src/tools/common.ts`; `getProvider`,
   `recordSessionCall`, `warnIfAllowlistEmpty`, `checkAllowlistDrift`,
   `reportAllowlistDrift` → `src/session.ts`; `buildAllowlistOptions` →
   `src/domains.ts` (type-only `SessionState` import — no runtime cycle).
   — done: committed `49a97e0`; gates green (106/106, tsc, lint); adversarial
   review **Verdict: Ready** (helpers byte-identical, disabled-case ordering
   pinned, surface intact). Optional carry-overs folded into 5b: (a) pin the
   disabled-case log entry (`kind`/`detail`) with test assertions for both
   tools; (b) add e2e coverage for web_search cancel (aborting signal) and
   provider-error (throwing fake provider) paths.
2. [x] **5b — item 17**: `src/tools/fetch.ts` — `executeWebFetch(params, deps)`
   (`deps` = `{ toolCallId, config, session, signal, ctx, pi, onUpdate }`);
   named steps `resolveFetchPermission` (returns `{ check, allowlistOptions }`),
   `handleFetchFailure` (5th step, keeps execute ≤ ~40 lines),
   `buildFetchOutput` (returns `{ result, outputChars }`), `detectLowContent`,
   `saveFullTextToTempFile` (+ pure helpers `isHttpUrl`, `isHtmlContentType`);
   `buildUntrustedBannerHead` moved here. `web_fetch` execute is now a thin
   wrapper on `prepareToolExecution` — the 5a transitional inline pre-flight
   is gone, both tools share it. Carry-overs from 5a review added as tests:
   disabled-case log entry pinned for both tools; web_search cancel
   (aborted signal) + provider-error (rejecting fake provider) e2e tests.
   — done: committed `9a21473`; gates green (108/108, tsc, lint); adversarial
   review **Verdict: Ready** (byte-identity of all output branches verified
   literal-by-literal; confirm/grant flow + failure ordering intact). Optional
   carry-overs folded into 5c: (a) e2e pin for truncation-note variants
   (small `max_chars` on a long page) and the `[Redirects: …]` note
   (redirecting e2e endpoint); (b) aborted-signal test should also assert the
   fake provider was actually invoked (pins post-settle vs pre-call branch).
3. [x] **5c — item 18**: `src/commands/domains.ts` — `parseDomainCommandArgs`
   (pure; discriminated union `DomainChangeCommand | DomainListCommand`;
   returns `domainTokens: string[]` not a single `domain` — the multi-token
   check needs the raw token count), `applyDomainChange(command, deps)`
   (the shared add/remove validation sequence ONCE — audit F1 fixed; the
   add/remove difference is a `DOMAIN_CHANGE_STRATEGIES` data table:
   untrusted-project message, allowlist mutation, success message — frozen
   message asymmetry preserved: add carries the "Use global scope" suffix,
   remove does not), `showDomainList` + pure `buildDomainListSummary`;
   `DismissableText` (exported) and `noteAllowlistChange` (module-private)
   moved here. `src/commands/status.ts` — `buildStatusReport(config, session)`
   (takes the narrower `WebSearchConfig`, not `LoadedConfig` — the report
   never reads domainSources). Deviation: the domains handler loads config
   only on the list path (loadConfig is total/read-only — no observable
   change). — done: gates green (110/110 at review time; 140/140 after the
   fixer below); adversarial review **Verdict: Ready** (strategy table
   literal-identical to the original branches; parse edge cases exercised).
   Review's Optional finding (frozen command strings under-pinned) fixed by a
   focused fix subagent before commit: new `test/commands.test.mjs` (30
   tests, registered in run.mjs after config.test.mjs) pins all five frozen
   notification strings exactly, parse edge cases, list-view summary,
   status-report lines, drift-baseline refresh; `withTempHome` helper
   saves/restores `process.env.HOME` per test (run.mjs runs all files in one
   process — a leak would corrupt e2e). Fixer also surfaced a **pre-existing
   quirk, pinned as-is**: a *leading* `--project` is consumed as the
   (unknown) action word, so `/web-search-domains --project add x` silently
   degrades to the list view (identical in the pre-refactor code; changing
   it would be a behavior change, out of scope — candidate for a future
   feature decision).
4. [x] **5d — items 19+20**: satisfied by 5c's work — index.ts is 147 lines
   (≤ ~150 target), registration-only (events, registerTool ×2 thin
   wrappers, registerCommand ×2, entry renderer); no test import updates
   needed (verified: every test import still resolves; e2e keeps
   `../index.ts`). No separate subagent required — orchestrator verified
   directly from the 5c diff.
5. [x] **5e — item 21**: gate — full `npm test` + live `pi -p` smoke test.
   — done (orchestrator, 2026-09-14): 140/140 tests green; live smoke in
   /tmp/websearch-smoke via `pi -p --no-builtin-tools --no-session` (local
   llama model `chat`): (a) `web_search "TypeScript 5.9 release notes"`
   → 4 real DDG results, all allowlisted, "(4 result(s) hidden)"; (b)
   `web_fetch https://en.wikipedia.org/wiki/TypeScript` max_chars 2000 →
   `<<< UNTRUSTED WEB CONTENT` banner, HTTP 200, truncation note with temp
   file `pi-web-search-call_791ee3b1eb78995e.txt` (toolCallId naming works
   live); (c) `web_fetch https://example.com/` → `Blocked: … Domain
   example.com is not in the allowlist. Allowed domains: …` (fail-closed,
   built-ins + user global settings unioned). **Phase 5 complete.**

## Phase 6 wave plan (items 22–28)

Phase 5 complete (waves 5a–5e; code commits `49a97e0`, `9a21473`,
`95623a3` + docs commits; 140/140 tests; live smoke green).

1. [x] **6a — item 22**: `checkUrl` → thin dispatcher (`checkUrlScheme`,
   `checkIpLiteralHost`, `checkDomainHost` in domains.ts). Dispatcher owns
   parse → scheme → normalize → empty-host/leading-dot guards → regime
   dispatch on `isIpLiteral(normalizedHost)`; regime functions are
   module-private and take `(host, allowlistOptions)` (reuses the existing
   bag — no new type). Declared deviation: `checkUrl`'s 2nd param renamed
   `opts` → `allowlistOptions` (closes the phase-2 options-bag vocabulary
   carry-over; positional-safe for all consumers). — done: committed
   `43bcafc`; gates green (140/140, tsc, lint); adversarial review
   **Verdict: Ready** — reviewer ran an independent 97,920-case differential
   (85 URLs × 1,152 option sets, superset of the implementer's 2,552), all
   byte-identical; bypass matrix re-verified (userinfo, IDN, IPv4-mapped
   IPv6, zone IDs, decimal IPs, IP grants, `allowSubdomains: false`
   boundaries). No carry-overs.
2. [x] **6b — item 23**: `safeFetch` loop body → `fetchOneHop(url, deps)`
   (`deps` = `{ doFetch, callerSignal, timeoutMs }` — the plan's shorthand
   `fetchOneHop(url, signal)` became a deps bag per the code-design ≤2-args
   rule; `callerSignal` carries the plan's `signal`) +
   `resolveRedirectTarget(response, currentUrl)` (fetch.ts). Both
   module-private. Loop keeps: per-hop `checkUrl` re-validation (first
   statement), `hop > maxRedirects` before the fetch, `redirects`/`current`/
   `hop` state, the ≥400 branch, and the `readBodyCapped` + result
   construction. Per-hop `combinedSignal` semantics preserved (fresh
   `AbortSignal.timeout` each hop). Declared deviation: a two-line "why"
   comment added on the redirect body-cancel swallow (comment-only; the
   ≥400 branch's identical cancel left for phase 7 item 30). — done:
   committed `359e1c1`; gates green (140/140, tsc, lint); adversarial
   review **Verdict: Ready** — no findings of any severity (path-by-path
   control-flow comparison vs pre-wave; targeted 12/12 fetch-suite run;
   export surface frozen).
3. [x] **6c — item 24**: providers → shared `fetchProviderResponse(url,
   { doFetch, signal, headers, providerName })` in new `src/providers/
   common.ts` (fetch + cancel-check + request-failed mapping; providerName
   parameterizes the message; NO `redirect` option — default follow
   preserved) + `parseDuckDuckGoResults(html, limit)` /
   `parseBraveResults(data, limit)` (module-private, verbatim moves; Brave's
   inline `as {…}` cast became the named `BraveWebSearchResponse` interface).
   Provider-specific status checks (DDG `!ok`; Brave 401/403/429/`!ok`
   ladder), the DDG challenge check, and the Brave no-key pre-check stayed
   inline, byte-identical. — done: committed `f35748c`; gates green
   (140/140, tsc, lint); adversarial review **Verdict: Ready** (mechanical
   byte-identity of the shared preamble vs both original catch blocks;
   parse moves verbatim; frozen surface intact). Pre-existing coverage gaps
   confirmed unchanged (incl. the Brave 429 gap — ledger carry-over).
4. [x] **6d — item 25 (part 1, config.ts only)**: `loadConfig`'s `merge`
   closure → named `mergeSettingsFile(state, file)` on an explicit
   `ConfigLoadState` bag `{ config, domainSources, configWarnings }` (scalar
   block lifted verbatim into `applyWebSearchSettings`); `configWarnings:
   string[]` added to `LoadedConfig`; warnings for (a) file not a usable JSON
   object, (b) `webSearch` present but not a plain object, (c) unknown
   `webSearch` keys (one warning, via `KNOWN_WEBSEARCH_KEYS` single source of
   truth); missing file does NOT warn; `readSettingsJson` → discriminated
   union (`missing`/`malformed`/`ok`); `updateSettingsDomains` maps
   missing/malformed → `{}` as before. — done: committed `2d45887`; gates
   green (146/146, tsc, lint); adversarial review **Verdict: Ready** (22-case
   differential byte-identity of config/domainSources; KNOWN_WEBSEARCH_KEYS
   exact-match cross-check; `webSearch: null` deviation adjudicated within
   F8's intent — kept). Optional note folded into 6d-notify: reword the
   "not valid JSON" message for valid-JSON top-level non-objects (e.g.
   `[1,2,3]`) while shaping it for display.
5. [x] **6d-notify — item 25 (part 2, session.ts + tools/common.ts + config.ts)**:
   one-shot `warnedConfig` flag on `SessionState` (+ `createSessionState`),
   `warnIfConfigWarnings(ctx, configWarnings, session)` helper in session.ts
   (notify-only, joined with `\n`, flag set before the `ctx.hasUI` check —
   matches the `warnIfAllowlistEmpty` pre-flight sibling), called in
   `prepareToolExecution` after `assertEnabled` and before
   `warnIfAllowlistEmpty` (both tools' pre-flight; a disabled extension
   short-circuits before it). Also reworded the malformed message to be
   accurate now that it is user-visible: `readSettingsJson`'s `malformed`
   status carries `reason: "invalid-json" | "not-an-object"`, so a valid-JSON
   top-level non-object reads `is not a JSON object` (the `invalid-json`
   message is unchanged). — done: committed `2a99b80`; gates green (149/149,
   tsc, lint; verified in an isolated worktree with only its 5 files);
   adversarial review **Verdict: Ready** (one-shot dedupe/reset, disabled
   short-circuit, malformed classification, updateSettingsDomains
   reason-independence, frozen surface all verified). Optional notes:
   `mergeSettingsFile` now 41 lines (edge of the ~40 guideline); pre-existing
   one-shot flag pattern split (`warnedBrave` is the odd one out, not this
   wave). 6f gate should confirm the one-time notify renders in a real TUI
   smoke (multi-line `\n` join untested against real TUI wrapping).
6. [x] **6e — items 26+27**: cancelled check → `signal?.aborted` (no string
   matching); hoist `PROVIDER_MAX_BODY_BYTES` to `providers/types.ts`.
   — done: committed `73730a4` (+ fix `d9e43c4`); gates green (149/149, tsc,
   lint, verified standalone on a clean tree); adversarial review **Verdict:
   Ready** with one Minor finding: the type-based clause
   `(error instanceof FetchError && error.message === "cancelled")` was
   **dead code** — the `FetchError` constructor prefixes its message
   (`Fetch failed: <url> — <message>`), so `.message` can never equal the
   bare `"cancelled"`. The effective check was `signal?.aborted` alone (which
   the reviewer verified covers every real abort path; a timeout correctly
   does not abort the caller's signal). Fixed in `d9e43c4`: dropped the inert
   clause, kept `signal?.aborted` with a why-comment (behavior-preserving —
   the clause was never true); `errorMessage` + `FetchError` import retained
   for the log detail + final throw. Note: the plan text's premise (that
   `FetchError(current, "cancelled")` is matchable via `.message`) was wrong;
   `signal?.aborted` is the sole effective check. Pre-existing (not a 6e
   regression): on the *search* path, a mid-fetch abort in the real providers
   throws `Error("Search cancelled")` from `providers/common.ts` which
   `runProviderSearch` rethrows as a tool error (only abort-after-settle maps
   to "Cancelled") — a candidate follow-up, not a gate blocker.
7. [x] **6f — item 28**: gate — full `npm test` + live smoke + fresh adversarial
   review pass (bypass matrix re-verified). — done: **6f-smoke** green
   (149/149, tsc, lint; all 6 live `pi -p` scenarios PASS — search allowlist
   filtering, allowed fetch untrusted banner, blocked non-allowlisted
   fail-closed, blocked private-IP fail-closed, subdomain allowed, F8
   config-warning notify rendered in a real TUI with one-shot dedupe
   confirmed live; multi-line `\n` join wrapping resolved). **6f-review
   Verdict: Ready** (49 adversarial probes; allowlist matching / redirect
   re-validation / sanitization / grants / drift detection all INTACT; F8
   confirmed the sole behavior delta; frozen surface byte-identical to
   pre-refactor baseline `d69a101`; no exploitable bypass gap). Non-blocking
   pre-existing observations (byte-preserved, not refactor defects): non-HTML
   fetch body + raw `redirect.from` reach the LLM context unsanitized (no TUI
   injection — the sanitizing renderers are the TUI sink); search mid-fetch
   abort surfaces as a tool error; no Brave 429 test; user-confirmed grants
   intentionally override `blockPrivateNetworks` for IP-literal hosts
   (documented + tested). Phase 6 CLOSED.

## Phase 7 wave plan (items 29–31)

1. [ ] **7a — items 29+30**: drop `// ---- section ----` banners (keep
   file-header doc comments); add "why" comments on intentional swallows
   (best-effort `body.cancel()`, `noteAllowlistChange` reset-on-unreadable).
2. [ ] **7b — item 31**: final `npm test` + live smoke; README touch-ups only
   if a renamed public symbol is documented (none expected).

## Next action

Phase 6 is CLOSED. Wave 7a (items 29+30): implementation subagent — drop
`// ---- section ----` banners from index.ts + src files (keep file-header doc
comments) and add the missing "why" comments on intentional swallows (best-effort
`body.cancel()`, `noteAllowlistChange` reset-on-unreadable-settings). Behavior-
preserving (comments only). After it reports: orchestrator verifies diff +
re-runs gates → adversarial review subagent → fix subagent if findings → commit
→ ledger → wave 7b (item 31 final gate). One agent at a time.
