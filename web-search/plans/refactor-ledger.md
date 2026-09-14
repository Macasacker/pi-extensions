# Ledger: web-search code-design refactor

Status: **PAUSED at the phase 5 boundary (user instruction, 2026-09-14).**
Phases 0–4 are committed (phase 4: `b9145a1` code, `e9e75aa` docs). Phases
5–7 are approved but not started. Orchestrator: main session.
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

- Phases 5–7 of `plans/refactor-code-design.md` (index.ts decomposition,
  control-flow polish, hygiene sweep). Phases 5 and 6 additionally end with a
  live `pi -p` smoke test; phase 6 with a fresh adversarial review pass.

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

## Next action (paused)

Phase 5 (index.ts decomposition, items 16–21): per-file worklist for
`src/tools/search.ts`, `src/tools/fetch.ts`, `src/commands/domains.ts`,
`src/commands/status.ts`, shrunk index.ts (≤ ~150 lines); ends with full
`npm test` + live `pi -p` smoke test. Smoke prerequisites verified at pause:
`pi` binary at `/home/mac/.local/share/pi-node/node-v22.22.3-linux-x64/bin/pi`,
extension registered in `~/.pi/agent/settings.json` (`webSearch.allowedDomains`
non-empty). Awaiting the user's go-ahead before dispatching the first phase-5
subagent.
