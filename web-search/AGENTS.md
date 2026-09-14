# AGENTS.md

Instructions for any AI agent making changes in this repository.

## Repository Layout

```
pi-extensions/            # repo root (git)
├── tui-footer/           # sibling pi extension (out of scope unless asked)
└── web-search/           # THIS package — pi extension for safe, allowlist-gated web search
    ├── index.ts          # extension entry: registers tools, commands, events
    ├── src/              # config, domains, fetch, extract, sanitize, render, providers/
    ├── test/             # custom-harness test suite (harness.mjs, run.mjs, *.test.mjs)
    ├── plans/            # plan files + durable task ledgers (see conventions below)
    ├── package.json      # name pi-web-search, type module
    └── tsconfig.json     # typecheck-only (noEmit)
```

This is a **pi coding-agent extension**, not a service: it runs inside the pi process
(Node ≥ 22, TypeScript executed via `--experimental-strip-types`). There is no build
step, no Docker, no frontend, no API. The pi runtime and its type declarations come
from the local pi install (see Gate 3).

Always run commands **inside the `web-search/` package directory** unless noted otherwise.

> This file was adapted from a different project's AGENTS.md (transaction-tracker
> monorepo). Conventions that don't apply here (Docker/Compose, Playwright e2e,
> OpenAPI, Express/React gates) were dropped; the validation-loop, plan, ledger,
> commit, orchestration, and context-hygiene conventions were kept and re-pointed
> at this package's real tooling.

---

## Mandatory Validation Loop

**Every change must pass the applicable validation gates before it is considered
complete.** For this package, all gates below apply to any change to `index.ts`,
`src/`, or `test/`.

### Gate 1: Tests Added (via add-unit-test skill)

- **You MUST load and follow the `add-unit-test` skill** when writing or modifying
  tests. Its Jest/Vitest-specific mechanics (mock APIs, `expect.assertions`) don't
  apply — this package uses a custom harness — but its principles are mandatory:
  GWT structure with blank-line phase separation, intent-driven test names
  (`should [outcome] when [condition]`), zero abbreviations in test code, no real
  network/FS side effects without capture-and-restore, and explicit failure-mode
  coverage (not just happy paths).
- Any new or modified logic requires corresponding tests.
- Test files live in `test/` as `*.test.mjs`, built on `test/harness.mjs`
  (`test(name, fn)` + `finish()`). Run a single file:
  ```bash
  node --experimental-strip-types --import ./test/setup.mjs test/domains.test.mjs
  ```

### Gate 2: All Tests Pass

- **ALL existing tests must continue to pass.** The suite includes the adversarial
  bypass/regression cases from the security reviews — never weaken or delete a
  failing test to get green; fix the code (or the test, with justification, if the
  test itself is wrong).
  ```bash
  npm test
  ```

### Gate 3: Typecheck Passes

- No TypeScript errors:
  ```bash
  npx tsc --noEmit
  ```
- `tsconfig.json` is typecheck-only (`noEmit`). The pi runtime packages
  (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) are provided by
  the pi install, not npm — they are symlinked into `node_modules/@earendil-works/`
  (see "Tooling setup" below). Recreate the symlinks if `node_modules` is
  reinstalled.
- ESM project — import paths use **`.ts` extensions** (Node type stripping
  requires explicit extensions). Never convert them to `.js`.

### Gate 4: Lint Passes

```bash
npm run lint
```

Flat ESLint config (`eslint.config.mjs`) with `typescript-eslint` recommended rules.
Fix findings rather than disabling rules; a rule disable requires a comment
explaining why.

### Gate 5: Docs Updated (if applicable)

- Update `README.md` when behavior, config keys, commands, or the safety model
  change.
- Update the `web-research` skill (canonical:
  `~/knowledge-base/99_System/skills/web-research/SKILL.md`, symlinked into the
  agent skill dirs) when tool behavior, site quirks, or allowlist guardrails
  change.
- Keep `plans/` ledgers current per the Plan Execution Convention.

### Gate 6: Independent Code Quality and Adversarial Review

- **You MUST load and follow the `adversarial-code-review` skill** after Gates 1–5
  pass.
- Dispatch a fresh, read-only reviewer subagent scoped to the changed files.
  Security-critical paths (allowlist matching, redirect re-validation, sanitization,
  grants, drift detection) always warrant this gate, even for small changes.
- `Critical` and `Important` findings block completion.
- This gate passes only with `Verdict: Ready` and no unresolved blocking findings.

### Validation Checklist Summary

```bash
# Any change to this package
npm test && npx tsc --noEmit && npm run lint
# Then: Gate 5 (docs/skill if applicable) + Gate 6 (adversarial review)
```

### Tooling setup (once per machine / fresh checkout)

```bash
npm install
# pi runtime type declarations (paths from `which pi` / the pi node install):
PI_NODE=/home/mac/.local/share/pi-node/node-v22.22.3-linux-x64/lib/node_modules
mkdir -p node_modules/@earendil-works
ln -sfnT $PI_NODE/@earendil-works/pi-coding-agent node_modules/@earendil-works/pi-coding-agent
ln -sfnT $PI_NODE/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui \
  node_modules/@earendil-works/pi-tui
```

---

## Commit Convention

- **When the user asks to commit changes**, load and follow the `commit-message`
  skill.
- Stage the relevant files, generate a commitizen-formatted message from the diff,
  and present it to the user.
- Prefix the scope with the affected package: `feat(web-search): ...`,
  `fix(web-search): ...`, `test(web-search): ...`, `docs(web-search): ...`,
  `refactor(web-search): ...`.
- Only run `git commit` after the user confirms the message.
- If the user also asks to push, run `git push` immediately after committing.

---

## Plan Execution Convention

- **When executing a step from a plan file**, update the plan to reflect progress.
- Mark each step as **`[DONE]`** once its validation loop passes and all gates are green.
- Add brief notes if the implementation diverged from the original plan.
- Plans live in `plans/` (package-specific), named after the task, e.g.
  `plans/refactor-code-design.md`.

---

## Durable Task Continuity

For substantial work that has multiple steps, is likely to span a long session, or
may exceed the available context window, maintain a durable task ledger in `plans/`.

The ledger must remain concise and contain:

- the objective and acceptance criteria;
- important constraints and user decisions;
- implementation decisions that must not be reconsidered without new evidence;
- completed work and its validation status;
- remaining work in execution order;
- files currently being changed;
- blockers, failures, and unresolved questions;
- the exact next action or command.

Update the ledger:

- after each meaningful implementation or validation milestone;
- whenever the planned approach changes;
- before beginning another large independent workstream;
- before context compaction when advance notice is available;
- before stopping with incomplete work.

After context compaction or when resuming an existing task:

1. Re-read this `AGENTS.md`.
2. Read the active task ledger.
3. Inspect `git status` and the relevant diff.
4. Verify the recorded state against the workspace.
5. Continue from the recorded next action without repeating completed work.

Keep the ledger as a state checkpoint, not a transcript. Do not include secrets,
large command outputs, speculative notes, or information recoverable immediately
from the code.

Use task-specific ledger names, for example:

```text
plans/refactor-code-design.md   # the plan itself (with [DONE] markers)
plans/refactor-ledger.md        # its durable task ledger
```

---

## Orchestration Convention

- **When the user instructs to orchestrate** a multi-wave or multi-step plan (e.g.
  "orchestrate the waves", "run the plan with subagents"), run this loop:
  1. **Ledger first.** Create or update the durable task ledger (`plans/`) per the
     Durable Task Continuity section before dispatching any subagent.
  2. **One subagent per wave, serially.** Never run two waves in parallel. Each
     implementation subagent is scoped to exactly one wave: it writes the
     code/tests, runs the package validation gates (`npm test && npx tsc --noEmit
     && npm run lint`), and reports. Subagents do not commit, do not run the
     adversarial review, and do not start the next wave.
  3. **Review every wave.** On each wave's completion, inspect the actual diff
     (trust but verify), re-run the applicable gates yourself, and dispatch the
     independent `adversarial-code-review` skill over that wave's changes.
  4. **Commit on green.** If the wave passes (all gates green, `Verdict: Ready`),
     stage it and commit using the `commit-message` skill. In orchestration mode,
     per-wave commits are pre-approved by the orchestration instruction itself —
     do not re-confirm each message (the sole exception to the Commit
     Convention's confirmation rule). Push only if the user asks.
  5. **Fix on red.** If the wave fails any gate or has blocking review findings,
     fix the findings (directly or via a focused fix subagent), re-validate, and
     only then commit.
  6. **Update the ledger** after each wave (completed work, validation status,
     next action), then dispatch the next wave's subagent.

---

## Context Hygiene Between Workstreams

Before beginning a new major workstream, determine whether detailed context from
the completed workstream is still needed.

- If the next workstream depends only on its outcomes, first update the durable
  task ledger with those outcomes. When running under Pi, then recommend focused
  compaction.
- Preserve decisions, constraints, changed files, validation results, unresolved
  issues, and the next action.
- Discard exploratory reasoning, superseded approaches, repetitive command output,
  and details already represented accurately in the workspace.
- If the next task is independent of the current objective, recommend starting a
  new session instead of carrying unrelated context.

When running under Pi and recommending compaction:

1. Reach a safe boundary: finish the current edit, update the task ledger, and
   record validation status.
2. Provide a ready-to-paste `/compact` command containing task-specific
   preservation instructions.
3. Name the task ledger that must be re-read after compaction.
4. Explain in one sentence why the completed context is no longer useful.
5. Do not begin the next major workstream until the user invokes compaction or
   explicitly declines.

---

## Package-Specific Notes (web-search)

- **Security-critical code.** The allowlist matcher (`src/domains.ts`), redirect
  re-validation (`src/fetch.ts`), terminal-escape sanitization (`src/sanitize.ts`),
  session grants, and allowlist-drift detection are the product's core value.
  Refactors must be behavior-preserving; the test suite's adversarial cases are
  the contract. When in doubt, add a regression test before changing behavior.
- **Public surface is frozen** unless the user asks: tool names `web_search` /
  `web_fetch`, commands `/web-search-domains` / `/web-search-status`, the
  `webSearch` settings key, the `web-search-log` session entry type, and the
  `index.ts` exports (`default`, `setTestProvider`) used by `test/e2e.test.mjs`.
- **No new runtime dependencies** without user approval (current:
  `node-html-parser`, `typebox`). Dev dependencies for the validation gates
  (typescript, @types/node, eslint, typescript-eslint) are pre-approved.
- The extension is enabled in `~/.pi/agent/settings.json`; a running pi session
  holds the pre-change code until restarted or `/reload`ed — validate with a
  fresh `pi -p` process, not the live session.
