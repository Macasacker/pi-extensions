# Design Review Plan — pi-extensions (whole repo)

Started: 2026-09-24

## Scope

**In scope (35 code files):**

| Batch | Package | Files |
|-------|---------|-------|
| 1 | web-search source | 19 files (below) |
| 2 | tui-footer | 4 files |
| 3 | web-search tests | 12 files |

**Out of scope:** docs (`README.md`, `AGENTS.md`, `plans/`, `archive/`), configs
(`package.json`, `tsconfig.json`, `eslint.config.mjs`), `package-lock.json`,
untracked files (`.gitignore`, `bears-2026-viewing-plan.md`, `web-search-session.txt`).

## Batch 1 — web-search source (19 files)

Order: entry point → core pipeline → providers → tools/commands → small helpers.

| # | File | Lines |
|---|------|-------|
| 1 | `web-search/index.ts` | 143 |
| 2 | `web-search/src/config.ts` | 297 |
| 3 | `web-search/src/domains.ts` | 222 |
| 4 | `web-search/src/fetch.ts` | 204 |
| 5 | `web-search/src/tools/fetch.ts` | 251 |
| 6 | `web-search/src/tools/search.ts` | 132 |
| 7 | `web-search/src/tools/common.ts` | 57 |
| 8 | `web-search/src/commands/domains.ts` | 182 |
| 9 | `web-search/src/commands/status.ts` | 21 |
| 10 | `web-search/src/extract.ts` | 113 |
| 11 | `web-search/src/sanitize.ts` | 79 |
| 12 | `web-search/src/render.ts` | 93 |
| 13 | `web-search/src/session.ts` | 124 |
| 14 | `web-search/src/providers/types.ts` | 19 |
| 15 | `web-search/src/providers/common.ts` | 31 |
| 16 | `web-search/src/providers/brave.ts` | 82 |
| 17 | `web-search/src/providers/duckduckgo.ts` | 97 |
| 18 | `web-search/src/log.ts` | 31 |
| 19 | `web-search/src/test-seam.ts` | 24 |

## Batch 2 — tui-footer (4 files)

| # | File | Lines |
|---|------|-------|
| 1 | `tui-footer/index.ts` | 261 |
| 2 | `tui-footer/test/footer.test.mjs` | 147 |
| 3 | `tui-footer/test/setup.mjs` | 27 |
| 4 | `tui-footer/test/hooks.mjs` | 7 |

## Batch 3 — web-search tests (12 files)

| # | File | Lines |
|---|------|-------|
| 1 | `web-search/test/e2e.test.mjs` | 584 |
| 2 | `web-search/test/commands.test.mjs` | 448 |
| 3 | `web-search/test/config.test.mjs` | 272 |
| 4 | `web-search/test/domains.test.mjs` | 263 |
| 5 | `web-search/test/fetch.test.mjs` | 208 |
| 6 | `web-search/test/providers.test.mjs` | 103 |
| 7 | `web-search/test/extract.test.mjs` | 66 |
| 8 | `web-search/test/sanitize.test.mjs` | 60 |
| 9 | `web-search/test/harness.mjs` | 23 |
| 10 | `web-search/test/run.mjs` | 19 |
| 11 | `web-search/test/setup.mjs` | 27 |
| 12 | `web-search/test/hooks.mjs` | 7 |

## Procedure (per batch)

1. Ensure Laya server: `serve_laya_node.sh`, verify `curl -s http://127.0.0.1:8001/health`.
2. Review each file: `node src/cli.ts file <path>` (5–20 s/file on CPU).
3. Verify every finding against the code — `real` vs `false positive` (record why).
4. Append the round table below; **user gate** before any fixes.
5. Fix approved findings + `code-design` taste pass (always, even with zero findings).
6. Re-review changed files; append round; gate again. Max **3 rounds per batch**.
7. Findings that reappear unchanged after a genuine fix → Disputed, do not re-fix.

Estimate: 35 files × 5–20 s ≈ 3–12 min of review time per full pass, plus verification.

## Rounds

### Batch 1 — Round 1
| File | Dimension | Mechanism | Prob | Verdict | Action |
|------|-----------|-----------|------|---------|--------|
| index.ts | singleResponsibility | mixedAbstraction | 0.9042 | real | Extract the entry-renderer text construction into render.ts as `renderLogEntry(entry, expanded, theme)` |
| index.ts | functionDesign | tooManyArguments | 0.7618 | false positive (framework-mandated execute/renderResult callback signatures) | |
| index.ts | formattingComments | commentedOutCode | 0.6751 | false positive (no commented-out code; only short section-label comments) | |
| index.ts | projectStructure | frameworkTopLevel | 0.8524 | false positive (top-level names are domain-oriented) | |
| config.ts | singleResponsibility | mixedAbstraction | 0.9801 | real | Extract the allowedDomains dedup/merge loop in `mergeSettingsFile` into a named helper (e.g. `mergeDomainEntries`) |
| config.ts | functionDesign | tooManyArguments | 0.8708 | real | Consolidate `clampInt`'s min/max/fallback into a single bounds-object argument |
| config.ts | sideEffects | inputMutation | 0.7837 | real | Stop mutating the `config` parameter in `applyWebSearchSettings` — return the merged config instead |
| config.ts | controlFlow | negativePhrasing | 0.7814 | false positive (no negated predicate names; only sanctioned guard-clause negations) | |
| config.ts | classDesign | hasAInheritance | 0.7581 | false positive (no classes/inheritance in this file) | |
| config.ts | errorHandling | callbackChaining | 0.6832 | false positive (no async code/callbacks) | |
| config.ts | formattingComments | commentedOutCode | 0.6903 | false positive (no commented-out code) | |
| config.ts | projectStructure | frameworkTopLevel | 0.8442 | false positive (domain-oriented names) | |
| domains.ts | singleResponsibility | mixedAbstraction | 0.8299 | real | Split `isPrivateIp` into `isPrivateIpv4`/`isPrivateIpv6` helpers, keeping only family dispatch in the body |
| domains.ts | functionDesign | tooManyArguments | 0.6234 | false positive (all functions take ≤2 args) | |
| domains.ts | controlFlow | negativePhrasing | 0.6706 | false positive (no negated predicate names) | |
| domains.ts | projectStructure | frameworkTopLevel | 0.7124 | false positive (domain-oriented names) | |
| fetch.ts | singleResponsibility | mixedAbstraction | 1.0 | real | Extract the manual Uint8Array merge loop in `readBodyCapped` into a named helper (e.g. `mergeChunksCapped(chunks, maxBytes)`) |
| fetch.ts | functionDesign | opaqueName | 0.8951 | false positive (all call sites are self-explanatory) | |
| fetch.ts | sideEffects | globalState | 0.8096 | false positive (no module-level mutable state) | |
| fetch.ts | controlFlow | nestedConditionals | 0.7886 | false positive (nesting is shallow; stream-read loop is idiomatic) | |
| fetch.ts | classDesign | hasAInheritance | 0.8716 | false positive (extending Error is canonical is-a) | |
| fetch.ts | errorHandling | callbackChaining | 0.7264 | false positive (async/await throughout; only `.catch()` on best-effort cancels) | |
| fetch.ts | projectStructure | frameworkTopLevel | 0.8594 | false positive (domain-oriented names) | |
| tools/fetch.ts | singleResponsibility | mixedAbstraction | 0.8771 | real | Extract the confirm-outside-allowlist branch in `resolveFetchPermission` into a named helper |
| tools/fetch.ts | functionDesign | tooManyArguments | 0.8484 | real | Consolidate `buildFetchOutput`'s four arguments into a single context object |
| tools/fetch.ts | classDesign | publicState | 0.6513 | false positive (no classes/public mutable state) | |
| tools/fetch.ts | errorHandling | callbackChaining | 0.6234 | false positive (async/await; `onUpdate` is a framework callback) | |
| tools/fetch.ts | projectStructure | frameworkTopLevel | 0.6533 | false positive (domain-oriented names) | |
| search.ts | singleResponsibility | mixedAbstraction | 0.8699 | real | Extract the result-list text formatting in `formatSearchResults` into a named helper |
| search.ts | functionDesign | tooManyArguments | 0.8848 | real | Consolidate `formatSearchResults`'s four arguments into a single context object |
| search.ts | sideEffects | globalState | 0.6406 | false positive (no module-level mutable state) | |
| search.ts | controlFlow | negativePhrasing | 0.6146 | false positive (no negated predicate names) | |
| search.ts | classDesign | publicState | 0.7589 | false positive (no classes) | |
| search.ts | errorHandling | callbackChaining | 0.6104 | false positive (async/await; `onUpdate` is a framework callback) | |
| search.ts | projectStructure | frameworkTopLevel | 0.863 | false positive (domain-oriented names) | |
| tools/common.ts | singleResponsibility | mixedAbstraction | 0.8108 | false positive (`prepareToolExecution` is a flat sequence of named guard calls) | |
| tools/common.ts | controlFlow | elseIfChain | 0.7136 | false positive (no else-if chain) | |
| tools/common.ts | classDesign | es5Constructor | 0.8397 | false positive (no classes/constructor functions) | |
| tools/common.ts | errorHandling | ignoredError | 0.6552 | false positive (the only catch logs and re-throws) | |
| tools/common.ts | projectStructure | frameworkTopLevel | 0.7833 | false positive (domain-oriented names) | |
| commands/domains.ts | singleResponsibility | mixedAbstraction | 0.8953 | false positive (`applyDomainChange` is a flat guard-clause sequence) | |
| commands/domains.ts | functionDesign | tooManyArguments | 0.8482 | false positive (all functions take ≤2 args) | |
| commands/domains.ts | sideEffects | prototypeExtension | 0.7126 | false positive (no prototype/global extensions) | |
| commands/domains.ts | classDesign | publicState | 0.8729 | false positive (only class field is already `private readonly`) | |
| commands/domains.ts | errorHandling | callbackChaining | 0.7656 | false positive (only callback is a framework TUI component factory) | |
| commands/domains.ts | projectStructure | frameworkTopLevel | 0.8958 | false positive (domain-oriented names) | |
| status.ts | singleResponsibility | mixedConcerns | 0.808 | false positive (`buildStatusReport` does one job) | |
| status.ts | functionDesign | tooManyArguments | 0.8083 | false positive (only function takes 2 args) | |
| status.ts | controlFlow | negativePhrasing | 0.6703 | false positive (no negated predicate names) | |
| status.ts | errorHandling | ignoredError | 0.7109 | false positive (no catch blocks) | |
| status.ts | formattingComments | commentedOutCode | 0.627 | false positive (no commented-out code) | |
| status.ts | projectStructure | frameworkTopLevel | 0.677 | false positive (domain-oriented names) | |
| extract.ts | singleResponsibility | mixedAbstraction | 0.9879 | real | Extract the whitespace-normalization chain in `extractReadableText` into a named helper (e.g. `normalizeWhitespace(text)`) |
| extract.ts | variableDesign | unneededContext | 0.8369 | false positive (no owner-repeated member names) | |
| extract.ts | functionDesign | tooManyArguments | 0.9817 | real | Consolidate `truncateText`'s maxChars/maxLines into a single options argument |
| extract.ts | sideEffects | prototypeExtension | 0.8313 | false positive (no prototype/global extensions) | |
| extract.ts | controlFlow | nestedConditionals | 0.8691 | false positive (nesting is shallow) | |
| extract.ts | codeHygiene | overOptimization | 0.7957 | false positive (no micro-optimizations) | |
| extract.ts | classDesign | hasAInheritance | 0.8735 | false positive (no classes) | |
| extract.ts | errorHandling | callbackChaining | 0.9162 | false positive (no async code) | |
| extract.ts | formattingComments | commentedOutCode | 0.8173 | false positive (no commented-out code) | |
| extract.ts | projectStructure | frameworkTopLevel | 0.8635 | false positive (domain-oriented names) | |
| sanitize.ts | singleResponsibility | mixedAbstraction | 0.8552 | false positive (single char-scanning loop; escape branches are its core) | |
| sanitize.ts | controlFlow | elseIfChain | 0.6341 | false positive (independent `if`+`continue` guards, not an else-if chain) | |
| sanitize.ts | errorHandling | callbackChaining | 0.7047 | false positive (no async code) | |
| sanitize.ts | formattingComments | commentedOutCode | 0.7312 | false positive (no commented-out code) | |
| sanitize.ts | projectStructure | frameworkTopLevel | 0.7501 | false positive (domain-oriented names) | |
| render.ts | singleResponsibility | mixedAbstraction | 0.9994 | false positive (render functions do one job with early-return guards) | |
| render.ts | functionDesign | tooManyArguments | 0.9394 | false positive (framework-mandated `(result, options, theme)` callback signatures) | |
| render.ts | sideEffects | prototypeExtension | 0.8469 | false positive (no prototype/global extensions) | |
| render.ts | controlFlow | nestedConditionals | 0.9161 | false positive (nesting is shallow) | |
| render.ts | classDesign | es5Constructor | 0.8655 | false positive (no classes/constructor functions) | |
| render.ts | errorHandling | callbackChaining | 1.0 | false positive (no async code) | |
| render.ts | formattingComments | commentedOutCode | 0.6082 | false positive (no commented-out code) | |
| render.ts | projectStructure | frameworkTopLevel | 0.898 | false positive (domain-oriented names) | |
| session.ts | singleResponsibility | mixedAbstraction | 0.8976 | false positive (session helpers are flat, single-level sequences) | |
| session.ts | functionDesign | tooManyArguments | 0.6441 | real | Consolidate `checkAllowlistDrift`'s four arguments (pi, ctx, config, session) into a single context object |
| session.ts | sideEffects | globalState | 0.6469 | false positive (no module-level mutable state) | |
| session.ts | classDesign | publicState | 0.7271 | false positive (SessionState is a plain data interface) | |
| types.ts | singleResponsibility | mixedAbstraction | 0.8924 | false positive (types-only file; no function bodies) | |
| types.ts | variableDesign | unneededContext | 0.7897 | false positive (no owner-repeated member names) | |
| types.ts | functionDesign | opaqueName | 0.8279 | false positive (types-only file; no call sites) | |
| types.ts | errorHandling | callbackChaining | 0.891 | false positive (no async code) | |
| types.ts | projectStructure | frameworkTopLevel | 0.9079 | false positive (domain-oriented names) | |
| providers/common.ts | singleResponsibility | mixedAbstraction | 0.8863 | false positive (single fetch+error-map; one level) | |
| providers/common.ts | functionDesign | tooManyArguments | 0.879 | false positive (2 args) | |
| providers/common.ts | controlFlow | nestedConditionals | 0.8408 | false positive (no deep nesting) | |
| providers/common.ts | codeHygiene | duplication | 0.7618 | false positive (single function; no in-file duplication) | |
| providers/common.ts | classDesign | hasAInheritance | 0.7466 | false positive (no classes) | |
| providers/common.ts | errorHandling | callbackChaining | 0.782 | false positive (async/await) | |
| providers/common.ts | projectStructure | frameworkTopLevel | 0.7989 | false positive (domain-oriented names) | |
| brave.ts | singleResponsibility | mixedAbstraction | 0.8562 | real | Extract the Brave HTTP status-code error mapping in `search` into a named helper (e.g. `assertBraveResponseOk(response)`) |
| brave.ts | functionDesign | tooManyArguments | 0.726 | false positive (`search`'s 3-arg signature is the SearchProvider interface contract) | |
| brave.ts | sideEffects | prototypeExtension | 0.7163 | false positive (no prototype/global extensions) | |
| brave.ts | classDesign | publicState | 0.7153 | false positive (no mutable public state) | |
| brave.ts | projectStructure | frameworkTopLevel | 0.8124 | false positive (domain-oriented names) | |
| duckduckgo.ts | singleResponsibility | mixedAbstraction | 0.9356 | real | Extract the DuckDuckGo challenge-page detection in `search` into a named helper (e.g. `isDuckDuckGoChallengePage(html)`) |
| duckduckgo.ts | functionDesign | tooManyArguments | 0.844 | false positive (`search`'s 3-arg signature is the SearchProvider interface contract) | |
| duckduckgo.ts | controlFlow | elseIfChain | 0.8933 | false positive (only a 2-branch if/else-if; not a long chain) | |
| duckduckgo.ts | classDesign | publicState | 0.7404 | false positive (no mutable public state) | |
| duckduckgo.ts | errorHandling | callbackChaining | 0.8124 | false positive (async/await) | |
| duckduckgo.ts | formattingComments | commentedOutCode | 0.6144 | false positive (no commented-out code) | |
| duckduckgo.ts | projectStructure | frameworkTopLevel | 0.8659 | false positive (domain-oriented names) | |
| log.ts | singleResponsibility | mixedAbstraction | 0.874 | false positive (`logCall` is a single sanitize+append; one level) | |
| log.ts | functionDesign | tooManyArguments | 0.8691 | real | Consolidate `logCall`'s three arguments (pi, ctx, entry) into a single context object |
| log.ts | sideEffects | globalState | 0.8205 | false positive (no module-level mutable state) | |
| log.ts | controlFlow | nestedConditionals | 0.7992 | false positive (no deep nesting) | |
| log.ts | classDesign | publicState | 0.8545 | false positive (no classes) | |
| log.ts | errorHandling | callbackChaining | 0.8829 | false positive (no async code) | |
| log.ts | projectStructure | frameworkTopLevel | 0.7915 | false positive (domain-oriented names) | |
| test-seam.ts | singleResponsibility | mixedAbstraction | 0.7674 | false positive (trivial one-liners) | |
| test-seam.ts | functionDesign | opaqueName | 0.7831 | false positive (clear names) | |
| test-seam.ts | sideEffects | globalState | 0.6939 | false positive (documented test seam; module state is the only mechanism given pi's singleton API) | |
| test-seam.ts | classDesign | es5Constructor | 0.7471 | false positive (no classes/constructor functions) | |

### Batch 1 — Round 2
Re-review of the 14 files changed by the Round 1 fixes (13 source + test/extract.test.mjs).
All 16 approved findings were fixed; gates green (149 tests, tsc, lint). The model
re-flagged the same file-level dimensions at near-identical probabilities; every
reappearance was verified against the code and moved to Disputed (see below). No new
real findings.

| File | Dimension | Mechanism | Prob | Verdict | Action |
|------|-----------|-----------|------|---------|--------|
| index.ts | singleResponsibility | mixedAbstraction | 0.9036 | disputed — fixed in R1 (`renderLogEntry` extracted); body is now a flat registration sequence; reappears unchanged | moved to Disputed |
| index.ts | functionDesign | tooManyArguments | 0.797 | disputed — R1 false positive (framework-mandated execute/render callback signatures); reappears | moved to Disputed |
| index.ts | sideEffects | prototypeExtension | 0.6165 | false positive (no prototype/global extensions) | |
| index.ts | errorHandling | callbackChaining | 0.6228 | false positive (async/await; framework callbacks only) | |
| index.ts | formattingComments | commentedOutCode | 0.6197 | disputed — R1 false positive; reappears | moved to Disputed |
| index.ts | projectStructure | frameworkTopLevel | 0.8502 | disputed — R1 false positive (domain-oriented names); reappears | moved to Disputed |
| config.ts | singleResponsibility | mixedAbstraction | 0.98 | disputed — fixed in R1 (`mergeDomainEntries` extracted, `applyWebSearchSettings` returns merged config); reappears unchanged | moved to Disputed |
| config.ts | functionDesign | tooManyArguments | 0.87 | disputed — fixed in R1 (`clampInt` bounds object); reappears unchanged | moved to Disputed |
| config.ts | sideEffects | inputMutation | 0.78 | disputed — fixed in R1 (no more `config` mutation); reappears unchanged | moved to Disputed |
| config.ts | controlFlow | negativePhrasing | 0.78 | disputed — R1 false positive; reappears | moved to Disputed |
| config.ts | classDesign | hasAInheritance | 0.76 | disputed — R1 false positive (no classes); reappears | moved to Disputed |
| config.ts | errorHandling | callbackChaining | 0.68 | disputed — R1 false positive (no async); reappears | moved to Disputed |
| config.ts | formattingComments | commentedOutCode | 0.69 | disputed — R1 false positive; reappears | moved to Disputed |
| config.ts | projectStructure | frameworkTopLevel | 0.84 | disputed — R1 false positive; reappears | moved to Disputed |
| domains.ts | singleResponsibility | mixedAbstraction | 0.83 | disputed — fixed in R1 (`isPrivateIpv4`/`isPrivateIpv6` split); reappears unchanged | moved to Disputed |
| domains.ts | functionDesign | tooManyArguments | 0.62 | disputed — R1 false positive (≤2 args); reappears | moved to Disputed |
| domains.ts | controlFlow | negativePhrasing | 0.67 | disputed — R1 false positive; reappears | moved to Disputed |
| domains.ts | projectStructure | frameworkTopLevel | 0.71 | disputed — R1 false positive; reappears | moved to Disputed |
| fetch.ts | singleResponsibility | mixedAbstraction | 1.0 | disputed — fixed in R1 (`mergeChunksCapped` extracted); reappears unchanged | moved to Disputed |
| fetch.ts | functionDesign | opaqueName | 0.90 | disputed — R1 false positive; reappears | moved to Disputed |
| fetch.ts | sideEffects | globalState | 0.81 | disputed — R1 false positive; reappears | moved to Disputed |
| fetch.ts | controlFlow | nestedConditionals | 0.79 | disputed — R1 false positive; reappears | moved to Disputed |
| fetch.ts | classDesign | hasAInheritance | 0.87 | disputed — R1 false positive (extending Error is canonical); reappears | moved to Disputed |
| fetch.ts | errorHandling | callbackChaining | 0.73 | disputed — R1 false positive; reappears | moved to Disputed |
| fetch.ts | projectStructure | frameworkTopLevel | 0.86 | disputed — R1 false positive; reappears | moved to Disputed |
| tools/fetch.ts | singleResponsibility | mixedAbstraction | 0.88 | disputed — fixed in R1 (`requestOutsideAllowlistGrant` extracted); reappears unchanged | moved to Disputed |
| tools/fetch.ts | functionDesign | tooManyArguments | 0.85 | disputed — fixed in R1 (`buildFetchOutput` context object); reappears unchanged | moved to Disputed |
| tools/fetch.ts | classDesign | publicState | 0.65 | disputed — R1 false positive; reappears | moved to Disputed |
| tools/fetch.ts | errorHandling | callbackChaining | 0.62 | disputed — R1 false positive; reappears | moved to Disputed |
| tools/fetch.ts | projectStructure | frameworkTopLevel | 0.65 | disputed — R1 false positive; reappears | moved to Disputed |
| search.ts | singleResponsibility | mixedAbstraction | 0.87 | disputed — fixed in R1 (`buildSearchResultsText` extracted); reappears unchanged | moved to Disputed |
| search.ts | functionDesign | tooManyArguments | 0.88 | disputed — fixed in R1 (`formatSearchResults` context object); reappears unchanged | moved to Disputed |
| search.ts | sideEffects | globalState | 0.64 | disputed — R1 false positive; reappears | moved to Disputed |
| search.ts | controlFlow | negativePhrasing | 0.61 | disputed — R1 false positive; reappears | moved to Disputed |
| search.ts | classDesign | publicState | 0.76 | disputed — R1 false positive; reappears | moved to Disputed |
| search.ts | errorHandling | callbackChaining | 0.61 | disputed — R1 false positive; reappears | moved to Disputed |
| search.ts | projectStructure | frameworkTopLevel | 0.86 | disputed — R1 false positive; reappears | moved to Disputed |
| tools/common.ts | singleResponsibility | mixedAbstraction | 0.81 | disputed — R1 false positive (flat guard sequence); reappears | moved to Disputed |
| tools/common.ts | controlFlow | elseIfChain | 0.71 | disputed — R1 false positive; reappears | moved to Disputed |
| tools/common.ts | classDesign | es5Constructor | 0.84 | disputed — R1 false positive; reappears | moved to Disputed |
| tools/common.ts | errorHandling | ignoredError | 0.66 | disputed — R1 false positive (catch logs + re-throws); reappears | moved to Disputed |
| tools/common.ts | projectStructure | frameworkTopLevel | 0.78 | disputed — R1 false positive; reappears | moved to Disputed |
| extract.ts | singleResponsibility | mixedAbstraction | 0.99 | disputed — fixed in R1 (`normalizeWhitespace` extracted); reappears unchanged | moved to Disputed |
| extract.ts | variableDesign | unneededContext | 0.84 | disputed — R1 false positive; reappears | moved to Disputed |
| extract.ts | functionDesign | tooManyArguments | 0.98 | disputed — fixed in R1 (`truncateText` options argument); reappears unchanged | moved to Disputed |
| extract.ts | sideEffects | prototypeExtension | 0.83 | disputed — R1 false positive; reappears | moved to Disputed |
| extract.ts | controlFlow | nestedConditionals | 0.87 | disputed — R1 false positive; reappears | moved to Disputed |
| extract.ts | codeHygiene | overOptimization | 0.80 | disputed — R1 false positive; reappears | moved to Disputed |
| extract.ts | classDesign | hasAInheritance | 0.87 | disputed — R1 false positive; reappears | moved to Disputed |
| extract.ts | errorHandling | callbackChaining | 0.92 | disputed — R1 false positive; reappears | moved to Disputed |
| extract.ts | formattingComments | commentedOutCode | 0.82 | disputed — R1 false positive; reappears | moved to Disputed |
| extract.ts | projectStructure | frameworkTopLevel | 0.86 | disputed — R1 false positive; reappears | moved to Disputed |
| render.ts | singleResponsibility | mixedAbstraction | 1.0 | disputed — R1 false positive; reappears | moved to Disputed |
| render.ts | functionDesign | tooManyArguments | 0.89 | disputed — R1 false positive (framework callback signatures); reappears | moved to Disputed |
| render.ts | controlFlow | nestedConditionals | 0.90 | disputed — R1 false positive; reappears | moved to Disputed |
| render.ts | errorHandling | callbackChaining | 0.96 | disputed — R1 false positive; reappears | moved to Disputed |
| render.ts | sideEffects | inputMutation | 0.79 | false positive (pure render functions, no mutation) | |
| render.ts | classDesign | es5Constructor | 0.78 | disputed — R1 false positive; reappears | moved to Disputed |
| render.ts | projectStructure | frameworkTopLevel | 0.84 | disputed — R1 false positive; reappears | moved to Disputed |
| session.ts | singleResponsibility | mixedAbstraction | 0.90 | disputed — R1 false positive (flat sequences); reappears | moved to Disputed |
| session.ts | functionDesign | tooManyArguments | 0.64 | disputed — fixed in R1 (`checkAllowlistDrift` context object); reappears unchanged | moved to Disputed |
| session.ts | sideEffects | globalState | 0.65 | disputed — R1 false positive; reappears | moved to Disputed |
| session.ts | classDesign | publicState | 0.73 | disputed — R1 false positive; reappears | moved to Disputed |
| brave.ts | singleResponsibility | mixedAbstraction | 0.86 | disputed — fixed in R1 (`assertBraveResponseOk` extracted); reappears unchanged | moved to Disputed |
| brave.ts | functionDesign | opaqueName | 0.63 | false positive (clear domain names) | |
| brave.ts | sideEffects | globalState | 0.63 | false positive (no module-level mutable state) | |
| brave.ts | controlFlow | negativePhrasing | 0.81 | false positive (no negated predicate names) | |
| brave.ts | classDesign | publicState | 0.62 | disputed — R1 false positive; reappears | moved to Disputed |
| brave.ts | errorHandling | ignoredError | 0.62 | false positive (no catch blocks in this file) | |
| brave.ts | projectStructure | frameworkTopLevel | 0.80 | disputed — R1 false positive; reappears | moved to Disputed |
| duckduckgo.ts | singleResponsibility | mixedAbstraction | 0.94 | disputed — fixed in R1 (`isDuckDuckGoChallengePage` extracted); reappears unchanged | moved to Disputed |
| duckduckgo.ts | controlFlow | elseIfChain | 0.89 | disputed — R1 false positive; reappears | moved to Disputed |
| duckduckgo.ts | projectStructure | frameworkTopLevel | 0.87 | disputed — R1 false positive; reappears | moved to Disputed |
| duckduckgo.ts | functionDesign | tooManyArguments | 0.84 | disputed — R1 false positive (SearchProvider interface contract); reappears | moved to Disputed |
| duckduckgo.ts | classDesign | publicState | 0.74 | disputed — R1 false positive; reappears | moved to Disputed |
| duckduckgo.ts | errorHandling | callbackChaining | 0.81 | disputed — R1 false positive; reappears | moved to Disputed |
| duckduckgo.ts | formattingComments | commentedOutCode | 0.61 | disputed — R1 false positive; reappears | moved to Disputed |
| log.ts | singleResponsibility | mixedAbstraction | 0.87 | disputed — R1 false positive; reappears | moved to Disputed |
| log.ts | functionDesign | tooManyArguments | 0.88 | disputed — fixed in R1 (`logCall` context object); reappears unchanged | moved to Disputed |
| log.ts | sideEffects | globalState | 0.76 | disputed — R1 false positive; reappears | moved to Disputed |
| log.ts | controlFlow | nestedConditionals | 0.63 | disputed — R1 false positive; reappears | moved to Disputed |
| log.ts | classDesign | es5Constructor | 0.83 | false positive (no classes/constructor functions) | |
| log.ts | errorHandling | callbackChaining | 0.82 | disputed — R1 false positive; reappears | moved to Disputed |
| log.ts | projectStructure | frameworkTopLevel | 0.66 | disputed — R1 false positive; reappears | moved to Disputed |
| test/extract.test.mjs | singleResponsibility | mixedConcerns | 0.96 | false positive (flat sequence of single-purpose `test()` calls) | |
| test/extract.test.mjs | functionDesign | tooManyArguments | 0.92 | false positive (`test(name, fn)` is the harness contract; `truncateText` takes 2 args) | |
| test/extract.test.mjs | controlFlow | elseIfChain | 0.91 | false positive (no else-if chains) | |
| test/extract.test.mjs | errorHandling | callbackChaining | 0.88 | false positive (async/await; harness callbacks by design) | |
| test/extract.test.mjs | variableDesign | unneededContext | 0.80 | false positive (no owner-repeated names) | |
| test/extract.test.mjs | sideEffects | inputMutation | 0.80 | false positive (tests do not mutate inputs) | |
| test/extract.test.mjs | codeHygiene | overOptimization | 0.77 | false positive (no micro-optimizations) | |
| test/extract.test.mjs | classDesign | hasAInheritance | 0.79 | false positive (no classes) | |
| test/extract.test.mjs | formattingComments | commentedOutCode | 0.65 | false positive (no commented-out code) | |
| test/extract.test.mjs | projectStructure | frameworkTopLevel | 0.82 | false positive (domain-oriented test file name) | |

### Batch 2 — Round 1
| File | Dimension | Mechanism | Prob | Verdict | Action |
|------|-----------|-----------|------|---------|--------|

### Batch 3 — Round 1
| File | Dimension | Mechanism | Prob | Verdict | Action |
|------|-----------|-----------|------|---------|--------|

## Disputed findings (never fix)
Findings that reappeared unchanged after a genuine R1 fix (or a R1 false positive),
verified against the code in R2. The model over-flags file-level dimensions with
stable probabilities; do not re-fix.

- index.ts — singleResponsibility/mixedAbstraction (fixed in R1: `renderLogEntry` extracted; body is a flat registration sequence), functionDesign/tooManyArguments (framework callback signatures), formattingComments/commentedOutCode, projectStructure/frameworkTopLevel (domain-oriented names)
- config.ts — singleResponsibility/mixedAbstraction (fixed in R1: `mergeDomainEntries` extracted, `applyWebSearchSettings` returns merged config), functionDesign/tooManyArguments (fixed in R1: `clampInt` bounds object), sideEffects/inputMutation (fixed in R1: no `config` mutation), controlFlow/negativePhrasing, classDesign/hasAInheritance (no classes), errorHandling/callbackChaining (no async), formattingComments/commentedOutCode, projectStructure/frameworkTopLevel
- domains.ts — singleResponsibility/mixedAbstraction (fixed in R1: `isPrivateIpv4`/`isPrivateIpv6` split), functionDesign/tooManyArguments (≤2 args), controlFlow/negativePhrasing, projectStructure/frameworkTopLevel
- fetch.ts — singleResponsibility/mixedAbstraction (fixed in R1: `mergeChunksCapped` extracted), functionDesign/opaqueName, sideEffects/globalState, controlFlow/nestedConditionals (shallow), classDesign/hasAInheritance (extending Error is canonical), errorHandling/callbackChaining (async/await; best-effort `.catch()` cancels), projectStructure/frameworkTopLevel
- tools/fetch.ts — singleResponsibility/mixedAbstraction (fixed in R1: `requestOutsideAllowlistGrant` extracted), functionDesign/tooManyArguments (fixed in R1: `buildFetchOutput` context object), classDesign/publicState (no classes), errorHandling/callbackChaining (framework `onUpdate`), projectStructure/frameworkTopLevel
- tools/search.ts — singleResponsibility/mixedAbstraction (fixed in R1: `buildSearchResultsText` extracted), functionDesign/tooManyArguments (fixed in R1: `formatSearchResults` context object), sideEffects/globalState, controlFlow/negativePhrasing, classDesign/publicState, errorHandling/callbackChaining (framework `onUpdate`), projectStructure/frameworkTopLevel
- tools/common.ts — singleResponsibility/mixedAbstraction (flat guard sequence), controlFlow/elseIfChain, classDesign/es5Constructor (no classes), errorHandling/ignoredError (catch logs + re-throws), projectStructure/frameworkTopLevel
- extract.ts — singleResponsibility/mixedAbstraction (fixed in R1: `normalizeWhitespace` extracted), variableDesign/unneededContext, functionDesign/tooManyArguments (fixed in R1: `truncateText` options argument), sideEffects/prototypeExtension, controlFlow/nestedConditionals (shallow), codeHygiene/overOptimization, classDesign/hasAInheritance, errorHandling/callbackChaining (no async), formattingComments/commentedOutCode, projectStructure/frameworkTopLevel
- render.ts — singleResponsibility/mixedAbstraction, functionDesign/tooManyArguments (framework callback signatures), controlFlow/nestedConditionals (shallow), classDesign/es5Constructor (no classes), errorHandling/callbackChaining (no async), projectStructure/frameworkTopLevel
- session.ts — singleResponsibility/mixedAbstraction (flat sequences), functionDesign/tooManyArguments (fixed in R1: `checkAllowlistDrift` context object), sideEffects/globalState, classDesign/publicState (plain data interface)
- brave.ts — singleResponsibility/mixedAbstraction (fixed in R1: `assertBraveResponseOk` extracted), classDesign/publicState, projectStructure/frameworkTopLevel
- duckduckgo.ts — singleResponsibility/mixedAbstraction (fixed in R1: `isDuckDuckGoChallengePage` extracted), functionDesign/tooManyArguments (SearchProvider interface contract), controlFlow/elseIfChain (2-branch), classDesign/publicState, errorHandling/callbackChaining (async/await), formattingComments/commentedOutCode, projectStructure/frameworkTopLevel
- log.ts — singleResponsibility/mixedAbstraction (single sanitize+append), functionDesign/tooManyArguments (fixed in R1: `logCall` context object), sideEffects/globalState, controlFlow/nestedConditionals, errorHandling/callbackChaining (no async), projectStructure/frameworkTopLevel
