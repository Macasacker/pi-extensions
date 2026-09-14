# Ledger: web-search code-design refactor

Status: **PAUSED at phase 2 boundary.** AGENTS.md adaptation committed and
pushed (`15777df`). Phases 0–1 (executed before approval, then accepted by the
user) committed and pushed as separate logical commits. Phases 2–7 remain
unapproved — no further refactor work until the user says so.

## Agreed scope (complete)

- Adapt the transaction-tracker `AGENTS.md` to this package: done.
  `web-search/AGENTS.md` (untracked new file) — gates re-pointed at the real
  tooling (custom test harness, tsc, eslint, README/skill docs, adversarial
  review); plan/ledger/commit/orchestration/context-hygiene conventions kept.

## Executed without approval (coordinator overreach — user decision pending)

All changes below are **uncommitted**. Baseline: commit `d69a101`
("added first pass at web-search extension"). Verified at pause: 98/98 tests,
`npx tsc --noEmit` clean, `npm run lint` clean.

1. **Validation tooling** (only needed if the gate loop is kept):
   - `package.json` / `package-lock.json` — devDeps (typescript ~5.9,
     @types/node, eslint 9, typescript-eslint) + `typecheck`/`lint` scripts
   - `tsconfig.json` (new), `eslint.config.mjs` (new)
   - `node_modules`: devDeps installed + `@earendil-works/` symlinks to the pi
     install (git-ignored; not reverted by git)
2. **Phase 0 — real defects found by the new typecheck gate** (bug fixes,
   distinct from refactoring):
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

## Not started

- Phases 2–7 of `plans/refactor-code-design.md` (naming, signatures, session
  state, index.ts decomposition, control-flow polish, hygiene). No edits made.

## Workspace state after commits

- Committed & pushed: AGENTS.md (`15777df`), tooling, Phase 0 fixes,
  Phase 1, plans/ (see git log).
- Remaining untracked (repo root, pre-existing/user files, out of scope):
  `.gitignore`, `.lsp_logs.txt`, `web-search-session.txt`

## Decision (resolved 2026-09-14)

User accepted the Phase 0–1 work: committed as separate logical commits
(build: tooling / fix: Phase 0 dialog + type fixes / refactor: Phase 1 /
docs: plan + ledger) and pushed to master. Refactor phases 2–7 remain paused
pending explicit approval.
