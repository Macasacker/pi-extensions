# web-search — Refactor plan (code-design audit)

> **STATUS: Phase 3 committed.** Phases 0–3 are committed (see git log).
> Phases 4–7 are in progress — executing per the Orchestration Convention
> (see `plans/refactor-ledger.md`).

Date: 2026-09-13. Method: full audit of all 10 source files (~1,560 lines) against the
`code-design` skill (SRP, variable design, function design, purity, control flow,
hygiene, SOLID, error handling, formatting, structure).

**Prime directive: this extension is security-critical. Every phase is
behavior-preserving — the 97-test suite (including the adversarial bypass cases)
must stay green after each phase, and the phase-5/6 work ends with a live
`pi -p` smoke test plus a fresh adversarial review pass. No security behavior
changes ride along with this refactor.**

## Audit findings

### F1. `index.ts` is a god file (SRP, one level of abstraction) — the big one

530 lines containing nine distinct concerns: session state, provider selection,
allowlist-drift detection, enablement guard, banner building, the full
`web_search` pipeline (~60 lines: provider call → filter → format → log), the full
`web_fetch` pipeline (~120 lines: permission/confirm → fetch → content-type sniff →
extract → truncate → temp-file → low-content → banner → redirects → log), the
`/web-search-domains` handler (~70 lines, with near-duplicate add/remove branches),
the `/web-search-status` handler, and the entry renderer.

Each `execute` body mixes 5–8 abstractions in one narrative; the add and remove
branches of the command handler duplicate their validation sequence
(multi-token check → sanitize → trust check → update → note → notify) verbatim.

### F2. Dead code & misleading APIs (hygiene)

- **`updateSettingsDomains(file, domains, mutate)` — the `domains` parameter is
  never read** (config.ts:206). Both call sites pass `[domain]` and the value is
  silently ignored. A reader will believe the list is passed in; it isn't.
- **`combinedSignal()` returns `cleanup: () => {}`** (fetch.ts:60-63) — a no-op
  invoked at 4 call sites (fetch.ts:140,153,166 + the redirect path). It looks like
  resource cleanup and does nothing (`AbortSignal.timeout` cannot be cancelled).
- **`truncateText(text, maxChars, maxLines = 2000)`** (extract.ts:96) — no caller
  passes `maxLines`; the 2000 default is an unexplained magic number.

### F3. Type-safety holes

- `let raw;` (index.ts:230) and `let res;` (index.ts:338) are implicit `any` —
  the two most important values in the extension (search results, fetch result)
  carry no type from their assignment to their use.

### F4. Naming (zero abbreviations, names say what they do)

- `const s = sanitizeForTui` alias (render.ts:12) — one-letter alias for the
  security-critical sanitizer.
- Abbreviated locals throughout: `res` (Response), `raw` (search results),
  `trunc` (Truncation), `u` (parsed URL), `e` (allowlist entry), `d` (details),
  `r` (result), `c` (content), `w`/`ws` (settings / webSearch key), `m` (regex
  match), `cc` (char code), `v6` (IPv6 address), `next` (redirect target URL).
- `noteSession` (index.ts:117) doesn't say what it does — it increments a call
  counter and updates the footer status.
- `allowlistOpts` (index.ts:108) — a builder with a noun name.
- `UNTRUSTED_BANNER_HEAD` (index.ts:183) — the `HEAD` suffix is unexplained
  jargon (it builds the banner's opening line).

### F5. Function signatures (two-or-fewer args, no flag parameters)

- `guardEnabled(config, ctx, kind, target, pi)` — **5 arguments** and two jobs
  (throw when disabled *and* notify when the allowlist is empty).
- `logCall(pi, ctx, entry)` / `checkAllowlistDrift(pi, ctx, config)` — 3 args;
  `pi`+`ctx` travel together everywhere and should be one unit.
- `loadConfig(cwd, projectTrusted, home)` — 3 args, the third a test-only seam.
- `clampInt(v, min, max, fallback)` — 4 args, called 6× with per-key literals;
  the merge block (config.ts:141-147) is six near-identical lines.
- `SearchProvider.search(query, limit, signal, fetchImpl)` — 4 args; `fetchImpl`
  is a test seam leaking into the production interface.

### F6. Module-level mutable state (purity)

Six module-level `let`s in index.ts (lines 69-78): `sessionGrants`,
`sessionCalls`, `warnedBrave`, `warnedEmptyAllowlist`, `lastAllowlist`,
`providerOverride`. The first five are session state that could live in a closure
created at registration time instead of in module scope; they're reset by
`resetSessionState()` called from three event sites, which is a scattering of the
same concern. (`providerOverride` is a deliberate test seam — keep, but isolate.)

### F7. Control flow

- `checkUrl` (domains.ts:127-163) is one 37-line function with three distinct
  regimes (scheme, IP-literal host, domain host) inlined.
- `safeFetch` (fetch.ts:86-183) — the `for(;;)` body mixes allowlist check,
  redirect resolution, error mapping, and body reading (~60 lines).
- `duckduckgo.search` / `brave.search` — each inlines fetch + cancel-check +
  status-check + parse; the fetch/error preamble is near-identical between the
  two providers.
- The `web_fetch` execute body's permission block (index.ts:298-345) mixes
  URL parsing, allowlist check, confirm dialog, grant bookkeeping.
- The command handler's add/remove branches (F1) are a duplicated sequence.

### F8. Error handling

- Intentional swallows without comments: `noteAllowlistChange`'s catch
  (index.ts:159-162, resets drift tracking), `reader.cancel().catch(() => {})`
  (fetch.ts:92,153), `res.body?.cancel().catch(() => {})` (fetch.ts:153).
- `readSettingsJson` (config.ts:88-96) treats a **malformed** settings file
  identically to a missing one — a user typo in `settings.json` is invisible.
  The config load should surface a warning so the user knows their `webSearch`
  key is being ignored.

### F9. Duplicated literals

- `MAX_BODY_BYTES = 1024 * 1024` defined separately in duckduckgo.ts:17 and
  brave.ts:12.
- The "cancelled" detection in index.ts:352 (`msg === "cancelled" ||
  msg.includes("cancelled")`) string-matches on error messages instead of using
  the `FetchError`/signal state that `safeFetch` already distinguishes.

### F10. Formatting

- `// ---- section ----` banners in index.ts (and light use in src files):
  the skill says to drop them; after the F1 split, index.ts shrinks enough that
  they're unnecessary, and the small src files don't need them either.

## Deliberate non-changes (judgment calls)

- **No folder reorganization beyond adding `src/tools/`, `src/commands/`,
  `src/session.ts`.** The skill's "structure by self-contained components" is
  overkill for a 1,560-line extension whose files are already 100-220 lines each;
  the problem is concentration in index.ts, not the layout. The skill itself says
  not to reorganize working code more than the findings require.
- **`sanitizeForTui`'s character-scanning state machine stays imperative** — it
  is a state machine; a functional rewrite would be worse.
- **The `providerOverride` test seam stays** (pi extensions are singletons per
  process; DI through the tool-registration API isn't available). It moves to
  its own tiny module so production code doesn't import test machinery.
- **`isPrivateIp`'s if-ladder stays** — each branch is a named, commented range;
  a table would trade clarity for extensibility we don't need.
- **Security "why" comments stay** — they are business logic (threat rationale),
  not apologies.
- **The e2e test surface is frozen**: `index.ts` must keep exporting the default
  extension function and `setTestProvider`.

## Phases

Each phase ends with `npm test` (98/98) green, plus `npx tsc --noEmit` and
`npm run lint` (gates per AGENTS.md). Phases 5 and 6 additionally end
with a live smoke test (`pi -p` in `/tmp/websearch-smoke`: search + fetch + a
blocked domain) and, after phase 6, a fresh adversarial review pass.

### Phase 0 — Validation infrastructure + pre-refactor fixes [DONE 2026-09-14]

- [x] Adapted `AGENTS.md` (from transaction-tracker monorepo) to this package:
  gates re-pointed at the real tooling (custom test harness, tsc, eslint,
  README/skill docs, adversarial review); plan/ledger/commit/orchestration/
  context-hygiene conventions kept.
- [x] Tooling: devDeps (typescript ~5.9, @types/node, eslint 9, typescript-eslint),
  `tsconfig.json` (noEmit, nodenext, strict), `eslint.config.mjs` (flat, TS
  recommended), npm scripts `typecheck`/`lint`, pi-runtime symlinks into
  `node_modules/@earendil-works/` for type resolution.
- [x] Typecheck gate found and fixed real defects in the pre-refactor code:
  - **Bug:** `/web-search-domains` TUI dialog assigned a non-existent `onKey`
    property — pi-tui dispatches keys via `handleInput(data)`, so the dialog
    could never be dismissed. Replaced with `DismissableText extends Text`
    implementing `handleInput` via `matchesKey` (escape/return/ctrl+c).
  - `onUpdate` progress calls were missing the required `details` field.
  - `provider.search` received `AbortSignal | undefined`; now
    `signal ?? new AbortController().signal`.
  - `extract.ts` element branch now narrows via `instanceof HTMLElement`
    instead of an untyped `nodeType === 1`.
- [x] Regression test added for the dialog fix (e2e: component implements
  `handleInput`; escape/enter/ctrl+c each resolve the custom prompt).
- [x] Baseline green: 98/98 tests, tsc clean, eslint clean.

### Phase 1 — Dead code & type holes (zero behavior change) [DONE]

- [x] 1. Remove the unused `domains` parameter from `updateSettingsDomains`
   (config.ts:204-220); update both call sites in index.ts (+ test call sites).
- [x] 2. Remove the no-op `cleanup` from `combinedSignal` (fetch.ts:60-63) and its
   four call sites; the function returns just `AbortSignal`.
- [x] 3. `truncateText`: **deviation** — plan said to drop `maxLines`, but
   `test/extract.test.mjs` exercises it (`truncateText(input, 200, 5)`), so it
   stays as an optional parameter; the magic default is now the named constant
   `DEFAULT_MAX_LINES = 2000`.
- [x] 4. Type the implicit anys: `let raw: SearchResult[]` (index.ts:230),
   `let res: SafeFetchResult` (index.ts:338).

### Phase 2 — Naming pass (zero behavior change) [DONE 2026-09-14]

- [x] 5. render.ts: delete `const s = sanitizeForTui`; call `sanitizeForTui` directly.
- [x] 6. Rename abbreviated locals across all files (per-file subagents, 16 files):
   `res`→`response`, `raw`→`searchResults`/`fileContents`, `trunc`→`truncation`,
   `u`→`parsedUrl`, `e`→`entry`/`error`/`normalizedEntry`, `d`→`domain`/`details`,
   `r`→`result`/`searchResult`/`redirect`, `c`→`content`/`chunk`/`charCode`,
   `w`→`webSearchSettings`, `ws`→`webSearchSection`, `m`→`mappedMatch`/`challengeMarker`,
   `cc`→`charCode` (**deviation** from `codePoint` — `charCodeAt` yields UTF-16 code
   units, not code points; more accurate), `v6`→`ipv6Address`, `next`→`nextUrl`/
   `nextCharCode`/`extended`, `loaded`→`loadedConfig`, plus other abbreviated locals
   found per file (`i`/`j`/`n`→`charIndex`/`sequenceIndex`/`inputLength`, `h`→
   `normalizedHost`, `el`→`element`, `out`→`textFragments`, `opts`→`options`/…,
   `err`→`error`, `msg`→`errorMessage`, `t`→`responseBody`/`token`, `p`→`provider`,
   `a`/`b`→`firstOctet`/`secondOctet`, `hi`/`lo`→`highWord`/`lowWord`, `n`→`octet`,
   `urlEl`→`resultHref`, `DDG_FIXTURE`→`DUCKDUCKGO_HTML_FIXTURE`, `serverA`/`serverB`
   →`allowedServer`/`disallowedServer`, `extModule`→`extensionModule`, `pi`→
   `mockExtensionApi`, `ctx`→`mockContext`, …). `src/providers/types.ts` needed no
   changes (`fetchImpl` deferred to item 11).
- [x] 7. Rename functions: `noteSession`→`recordSessionCall`,
   `allowlistOpts`→`buildAllowlistOptions`, `UNTRUSTED_BANNER_HEAD`→
   `buildUntrustedBannerHead` (no full-banner counterpart exists — the full banner
   is assembled inline at the call site).

### Phase 3 — Signature cleanup [DONE 2026-09-14]

- [x] 8. Split `guardEnabled` into `assertEnabled(config)` (throws) and
   `warnIfAllowlistEmpty(config, ctx)` (one-time notify); call sites log the
   disabled entry and re-throw the same Error instance (byte-identical log
   entry and throw message; ordering preserved).
- [x] 9. `loadConfig({ cwd, projectTrusted, homeDir })` — options object; `homeDir`
   defaults to `os.homedir()` (destructured default). Call sites: index.ts ×5
   (the audit's "2" undercounted — `noteAllowlistChange` and both command
   handlers also call it), test/config.test.mjs ×8 (explicit homeDir kept).
- [x] 10. `NUMERIC_LIMITS` declarative spec (`as const` + `NumericConfigKey`,
   module scope after `BUILTIN_DEFAULTS`) iterated in one loop in the merge;
   `clampInt` kept as the loop helper. **Deviation:** the audit's "six calls"
   was a miscount — 5 per-key lines, all in the merge.
- [x] 11. Provider interface: `search(query, limit, signal)`; `fetchImpl` moves to
   the factories (`createDuckDuckGoProvider({ fetchImpl })`,
   `createBraveProvider(apiKey, { fetchImpl })`). `duckduckgoProvider` is
   `createDuckDuckGoProvider()`'s default instance. `test/providers.test.mjs`
   call sites updated; `index.ts` `getProvider` and the e2e zero-arg `search`
   mocks verified unchanged.

### Phase 4 — Session state encapsulation

- [ ] 12. `src/session.ts`: `createSessionState()` factory returning
    `{ grants, callCount, warnedBrave, warnedEmptyAllowlist, lastAllowlist }`;
    the state object is created inside the extension's default export (closure
    scope, not module scope) and passed to the helpers. `resetSessionState()`
    becomes `session = createSessionState()`.
- [ ] 13. Split `checkAllowlistDrift` into pure `diffAllowlists(previous, current)`
    (returns `{added, removed}`) + `reportAllowlistDrift(...)` (notify + log).
- [ ] 14. `logCall`, `recordSessionCall`, `warnIfAllowlistEmpty` take the session
    object; `pi`/`ctx` pairs that always travel together stay as-is (they're the
    API surface, not our state).
- [ ] 15. Move `setTestProvider`/`providerOverride` to `src/test-seam.ts` (or keep in
    session.ts with a clear comment); index.ts re-exports `setTestProvider` so
    the e2e surface is unchanged.

### Phase 5 — Decompose index.ts (the structural fix)

- [ ] 16. `src/tools/search.ts`: `executeWebSearch(params, deps)` where `deps` bundles
    `{ config, session, provider, signal, ctx, pi }`; internal named steps
    `runProviderSearch`, `filterResultsByAllowlist`, `formatSearchResults`.
- [ ] 17. `src/tools/fetch.ts`: `executeWebFetch(params, deps)` with named steps
    `resolveFetchPermission` (allowlist check + confirm + grant bookkeeping),
    `buildFetchOutput` (banner + truncation + temp file + redirect + low-content
    notes), `detectLowContent(response, extracted)`, `saveFullTextToTempFile`.
- [ ] 18. `src/commands/domains.ts`: `parseDomainCommandArgs(tokens)`,
    `applyDomainChange(ctx, { action, domain, projectScope })` (the shared
    validation sequence, once), `showDomainList(loadedConfig)`;
    `src/commands/status.ts`: `buildStatusReport(loadedConfig, session)`.
- [ ] 19. index.ts shrinks to registration only: events, `registerTool` ×2 (thin
    wrappers calling the execute functions), `registerCommand` ×2, entry
    renderer. Target: ≤ ~150 lines.
- [ ] 20. Update test imports where paths moved; e2e keeps importing `../index.ts`.
- [ ] 21. **Gate: full `npm test` + live `pi -p` smoke test.**

### Phase 6 — Control-flow polish in leaf modules

- [ ] 22. `checkUrl` → thin dispatcher: `checkUrlScheme`, `checkIpLiteralHost`,
    `checkDomainHost` (domains.ts).
- [ ] 23. `safeFetch` loop body → `fetchOneHop(url, signal)` and
    `resolveRedirectTarget(response, currentUrl)` (fetch.ts).
- [ ] 24. Providers → shared `fetchProviderResponse(url, { signal, headers })`
    (fetch + cancel-check + status errors) and `parseDuckDuckGoResults` /
    `parseBraveResults` (providers/).
- [ ] 25. `loadConfig`'s `merge` closure → named `mergeSettingsFile(loaded, file)`
    operating on explicit values; collect `configWarnings: string[]` in
    `LoadedConfig` (malformed JSON, ignored keys) and surface them via a
    one-time `ctx.ui.notify` in the tool execute paths (F8).
- [ ] 26. Replace the string-matched cancelled check (index.ts:352) with
    `signal?.aborted` + `err instanceof FetchError && err.message ===
    "cancelled"` — `safeFetch` already throws a distinct `FetchError(current,
    "cancelled")`, so match on the error type, not the message text.
- [ ] 27. Hoist `PROVIDER_MAX_BODY_BYTES` to `providers/types.ts` (F9).
- [ ] 28. **Gate: full `npm test` + live smoke + fresh adversarial review pass**
    (same method as the original two rounds; the refactor touched the security
    paths' shape, so the bypass matrix gets re-verified).

### Phase 7 — Hygiene sweep

- [ ] 29. Drop `// ---- section ----` banners from index.ts and src files; keep the
    file-header doc comments (they carry the security model).
- [ ] 30. Add the missing "why" comments on intentional swallows: best-effort
    `body.cancel()`, `noteAllowlistChange`'s reset-on-unreadable-settings.
- [ ] 31. Final `npm test`, live smoke, README touch-ups only if a renamed public
    symbol is documented there (none expected — the public surface is tools,
    commands, and the `webSearch` settings key, all unchanged).

## Definition of done

- 97/97 tests green (plus any new tests the phases add).
- Live smoke: search, allowed fetch, blocked fetch, and a `/web-search-domains`
  round-trip all behave exactly as before.
- Fresh adversarial review reports no new Critical/Important findings.
- `index.ts` ≤ ~150 lines; no function > ~40 lines; no implicit `any`; no
  dead parameters; no module-level mutable state outside the documented test
  seam.
