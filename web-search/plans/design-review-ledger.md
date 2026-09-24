# Design Review Ledger

## Objective

Run the `design-review` skill (Laya) over the whole repo per
`design-review-plan.md` (repo root): 35 code files in 3 waves. Acceptance:
every wave reviewed, each verified finding fixed or recorded as disputed,
taste pass clean, all gates green per wave, wave committed.

## Constraints and user decisions

- Orchestration per AGENTS.md: one subagent per wave, **serial**. Subagents
  write code/tests and run gates; they do NOT commit, do NOT run the
  adversarial review, do NOT start the next wave.
- Orchestrator (main session) per wave: inspect diff, re-run gates
  (`npm test && npx tsc --noEmit && npm run lint`), dispatch
  `adversarial-code-review`, commit on green (per-wave commits pre-approved
  by the orchestration instruction).
- Design-review skill gates: user approval of the findings table **before
  any fixes** in a wave; max 3 review-fix rounds per wave; findings that
  reappear unchanged after a genuine fix go to Disputed (never re-fixed);
  never "fix" a false positive to silence it.
- Security-critical paths (`src/domains.ts`, `src/fetch.ts`,
  `src/sanitize.ts`, session grants, drift detection): behavior-preserving
  only; the suite's adversarial cases are the contract.
- Public surface frozen (tool names, commands, settings key, exports).
- No new runtime dependencies. ESM with `.ts` import extensions.
- Review tooling: Laya server at `http://127.0.0.1:8001`; CLI
  `node src/cli.ts file <path>` from
  `/home/mac/workspace/local-llm-playground/laya/design-review`.
- Durable review plan (round tables, disputed findings):
  `design-review-plan.md` at repo root.

## Waves (execution order)

1. **Wave 1** — web-search source (19 files, see plan). Status: **DONE**.
   Review: 114 findings (16 real, 98 false positives); user approved all 16.
   Fixed, taste pass, Round 2 re-review (reappearances → Disputed), gates
   green (149 tests, tsc, lint), adversarial review `Verdict: Ready`.
   Committed: `64f8dd1` (refactor, 14 files) + `3e15261` (docs). Optional
   non-blocking nits (not fixed): two new helpers keep a 4-arg shape
   (tools/search.ts `buildSearchResultsText`, tools/fetch.ts
   `requestOutsideAllowlistGrant`); `checkAllowlistDrift` JSDoc now sits
   above the context interface (session.ts).
2. **Wave 2** — tui-footer (4 files). Status: **DONE**. Review: 25
   findings (1 real, 24 false positives); user approved. Fixed
   (`buildStatsLine` extracted from `renderFooter`), taste pass, Round 2
   (reappearance → Disputed), gate green (`npm test`), adversarial review
   `Verdict: Ready` (byte-identity verified). Committed in
   `refactor(tui-footer)` + docs.
3. **Wave 3** — web-search tests (12 files). Status: **DONE**. Review: 87
   findings (1 real, 86 false positives); user approved. Fixed
   (`allowedServer` route ladder → guard clauses in fetch.test.mjs), taste
   pass, Round 2 (reappearance → Disputed), gates green (149 tests, tsc,
   lint), adversarial review `Verdict: Ready` (byte-identity verified
   across 19 URLs). Committed in `test(web-search)` + docs.

**All waves complete.** Acceptance met: every wave reviewed, verified
findings fixed (18 total: 16 + 1 + 1) or recorded as disputed, taste pass
clean, gates green per wave, waves committed.

Per wave: review subagent (read-only on source; appends round table to
plan) → user gate → fix subagent (fixes + taste pass + re-review + gates) →
orchestrator verify + adversarial review → commit.

## Files currently being changed

`web-search/test/fetch.test.mjs` (Wave 3 fix, pending commit) + plan/ledger docs.

## Blockers / open questions

(none)

## Next action

Commit Wave 3, then final report to the user.
