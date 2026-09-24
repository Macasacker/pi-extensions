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

1. **Wave 1** — web-search source (19 files, see plan). Status: review done
   (114 findings: 16 real, 98 false positives; table in plan). User approved
   all 16 on 2026-09-24. Fix subagent dispatched.
2. **Wave 2** — tui-footer (4 files). Status: pending.
3. **Wave 3** — web-search tests (12 files). Status: pending.

Per wave: review subagent (read-only on source; appends round table to
plan) → user gate → fix subagent (fixes + taste pass + re-review + gates) →
orchestrator verify + adversarial review → commit.

## Files currently being changed

Wave 1 fixes (behavior-preserving refactors): `index.ts`, `src/config.ts`,
`src/domains.ts`, `src/fetch.ts`, `src/tools/fetch.ts`, `src/tools/search.ts`,
`src/extract.ts`, `src/session.ts`, `src/providers/brave.ts`,
`src/providers/duckduckgo.ts`, `src/log.ts`, plus `src/render.ts` (receives
`renderLogEntry` from `index.ts`).

## Blockers / open questions

(none)

## Next action

Wave 1 fix subagent running. On completion: inspect diff, re-run gates
(`npm test && npx tsc --noEmit && npm run lint` in `web-search/`), dispatch
adversarial-code-review over the wave's changes, commit on green
(scope `refactor(web-search):`), update ledger, dispatch Wave 2.
