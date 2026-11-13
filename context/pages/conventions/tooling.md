---
title: "Tooling"
version: "1.0"
date: 2026-11-12
changes: "2026-11-13: the private-names check. Earlier on 2026-11-13: removed the stale line that CI runs no web test; CI runs them since 2026-11-12. Founded with the harness on 2026-11-12"
page_type: convention
status: active
description: "Who runs on which model and writes what, what lives in .claude/ and scripts/, what each hook does, and how the review workflow fits the gates."
updated: 2026-11-13
source:
  - ".claude/"
  - "scripts/"
  - ".github/workflows/ci.yml"
reliability: high
---

# Tooling

The harness was founded on 2026-11-12: sh + jq hooks with case-matrix self-tests, one pipeline skill, a review workflow, an in-repo context ([[pages/decisions/0001-in-repo-vault-and-agent-harness]]). What it deliberately does not have yet is at the end of this page. Root `CLAUDE.md` names this page; the `explorer-pipeline` skill dispatches by it.

## Model routing

The session model does every survey, plan and check; Opus implements and reviews what can hurt a user (who reaches the API, credentials, message loss); Sonnet reviews the rest and does the simple work; Haiku runs the gates.

| Who | Model, effort | Writes code? |
|---|---|---|
| **The manager** (the session thread): classifies, reads the context, states the six-part plan, dispatches, checks the result against the plan line by line, owns `context/index.md`, `context/log.md`, the conventions and the process ADRs. | session model | Context, docs, `.claude/**`, fast-path one-liners only. |
| **`explorer-implementer`**: implements a non-trivial change from the plan, Rule B per edit, and proves gate 5 itself: a targeted mutation per `new behaviour` entry with the failure quoted, the file restored from a backup copy and rebuilt; behaviour locks green before and after. | opus, high | **Yes**: `src/**` and `web-app/**` of the named project(s), plus the context pages the plan names. Never git history. |
| Any simple, mechanical, well-specified task (`general-purpose` on `model: sonnet`). | sonnet, medium | **Yes**, the named files only. |
| **`explorer-mechanic`**: runs build and test commands exactly as dispatched, reports per project with warning and skipped counts, never fixes. | haiku, low | No. |
| **`explorer-reviewer`**: gate 6, dispatched by the `explorer-review` workflow one instance per lens (`api-surface`, `secrets`, `message-safety`, `boundaries`, `invariants`); checks the gate 5 evidence the dispatch carries; each finding then faces a refute pass. | opus, high on `api-surface`, `secrets` and `message-safety`; sonnet, high on `invariants` and `boundaries`; refute pass: sonnet, high | No. |
| **`explorer-optimizer`**: the `performance` lens, mandatory on a diff touching a bulk operation, a scan loop, the monitoring service, the RabbitMQ management client, the metrics service or an Angular polling or large-list path. | opus, high | No. |
| Review gate, generic lens (`/code-review`) | Built-in skill, `medium`, never `--fix`; only when the diff touches `Program.cs`, `IMessagingProvider`, or the owner asks. | No. |
| Surveys past a handful of targeted reads | `Explore` subagent. | No. |

## `.claude/skills/explorer-pipeline`

The single source of the pipeline: gate 0 (classify from `git status --porcelain` and `git diff HEAD --stat`, written as an instruction and never as a dynamic shell block), classification (fast path or full), the never-list, the ladder (`ponytail` after the context, before the edit), the six-part plan, the nine gates, the two dispatch templates. Lane files `feature.md`, `bugfix.md`, `refactor.md`, `diagnose.md` carry only the stage order.

## `.claude/workflows/explorer-review.js`

Gate 6 as a `Workflow` script: `Workflow({ name: "explorer-review", args: { module, lenses, dispatch, range? } })`. `invariants` always runs and also owns regression coverage, Rules I and J and generic correctness; the other lenses come from the gate 6 table, each on its own `explorer-reviewer`. A lens reports at most five findings and an empty list on a sound diff is the right answer. Every finding then goes to an independent `explorer-reviewer` on sonnet whose only job is to refute it. The result is `{ confirmed, refuted, unresolved, unresolvedLenses, checked, uncited }`: a finding whose refuter returned nothing goes to `unresolved`, which the manager verifies and treats like `confirmed` (the gate fails closed); a lens whose review returned nothing is named in `unresolvedLenses` and blocks until it is run again. `.claude/workflows/explorer-review.test.sh` runs the real script under node with stub agents and checks the three lists, a silent lens, and the model each lens runs on. Without the Workflow tool the fallback is the direct `explorer-reviewer` dispatch.

## `.claude/skills/wiki-*`

The five wiki skills (`wiki-crystallize`, `wiki-ingest`, `wiki-integrate`, `wiki-lint`, `wiki-query`) and their shared references. They read `context/wiki-config.md` and `context/wiki-schema.md`; the operation contract is `context/CLAUDE.md`.

## `.claude/hooks/`

All seven fail open: a missing `jq`, malformed JSON, or any error exits 0 having written nothing, so a broken hook can never block work. That is why the first one exists.

| Hook | Event | What it does |
|---|---|---|
| `session-start.sh` | SessionStart | Proves the hook runtime works, loudly: checks `jq` is on PATH and pipes `git commit -m x` through `pre-git-guard.sh`; when either fails it emits a `systemMessage` saying the hooks are dead and which gates are silent. |
| `prompt-router.sh` | UserPromptSubmit | One line reminding that a code task routes through `explorer-pipeline` first and that a change to the API surface, to secret handling or to a bulk message operation is a review lens, never a fast path. |
| `pre-git-guard.sh` | PreToolUse (Bash) | Turns Rule E into a permission **ask**: history-writing git (`commit`, `push`, `merge`, `rebase`, `revert`, `cherry-pick`, `pull`, `am`, a moving `reset`, `tag` creation or deletion, `branch -D/-m`, an alias, a `git stash` that moves work), every `gh` command that writes to GitHub, a `gh` subcommand it does not know, `docker push`, `wrangler deploy/publish/secret`, `dotnet ef database update/drop`. "Ask" not "deny": "commit this for me" still works, it cannot happen silently. Read-only git and `gh` reads pass. |
| `post-edit-rule-b.sh` | PostToolUse (Edit\|Write) | On `src/**/*.cs` outside the `*.Tests` projects: the edit needs its test now, the build at 0 warnings, the gate 4 surface, and Rules A, G and H in one sentence each. On `web-app/src/**/*.ts` that is not a spec and on `web-app/electron/*.js`: a spec now, then `npm test -- --watch=false` (never plain `npx vitest`) and `npm run build`. |
| `post-edit-oracle-note.sh` | PostToolUse (Edit\|Write) | On `.github/workflows/**`, `web-app/angular.json`, `web-app/tsconfig*.json`, `Directory.Build.props`, `Directory.Packages.props`, `.editorconfig` and `global.json`: these files grade a change and are not part of it; the reply must say why the task needed the edit. |
| `stop-review-gate.sh` | Stop | **Blocks** the turn once when the session edited production code (`src/**/*.cs` outside `*.Tests`, `web-app/src/**/*.ts` that is not a spec, `web-app/electron/*.js`) without dispatching `explorer-reviewer` (an `Agent` call or a `Workflow` run of `explorer-review`). `stop_hook_active` passes on the continuation, so no loop. Keyed on what *this* session edited, in `<session>.jsonl` and every `<session>/subagents/*.jsonl`. |
| `session-end-metrics.sh` | SessionEnd | Appends one JSON line per session to `.claude/metrics/sessions.jsonl` (gitignored): production and test edits, reviewer dispatches, review workflow runs, pipeline invocations, agents, tool calls, `endedUnreviewed`. |

Every hook carries a case-matrix self-test (`<hook>.test.sh`, prints `ALL CASES PASS`). The `harness` job of `.github/workflows/ci.yml` runs all seven plus `.claude/workflows/explorer-review.test.sh`, `scripts/check-context-refs.test.sh` and a real `scripts/check-context-refs.sh` run.

## `scripts/check-context-refs.sh`

Resolves every code citation in `context/pages` against the working tree. A citation is `path#anchor` (paths under `src`, `web-app`, `scripts`, `docs`, `.claude`, `.github`, written in full): the anchor is a member, a type, a test title or a key that occurs in the file, so an edit elsewhere in the file never breaks it. It fails on a missing file, an anchor the file does not contain, a citation by line number (`path:12`, refused since 2026-11-13, [[pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk]]) and a missing `context/pages`. It proves the anchor exists, never that the page still describes it truly; that part is read. Pages whose `status` marks them as a record are skipped. Runs in gate 7b and in CI.

## `scripts/check-private-names.sh`

Fails when a private name appears in the tracked files (`--tree`) or in text on stdin (`--stdin`): names the owner keeps out of this public repository, such as other projects and employers. The names are never written in the repository; the script reads them from the `PRIVATE_NAMES` secret in CI and from `~/.config/messaging-explorer/private-names` on a workstation. A name matches in any case and with one separator between its letters, and the report gives the file and line or the text line, never the matched text, because CI logs are public. `.github/workflows/private-names.yml` runs it on every push to `main` and on every pull request, opened, edited or pushed, over the tree, the title and body, and every commit message of the range, and is a required check of `main`; `--require` there turns a missing secret into a failure. A pull request from a fork has no secret and is checked again by the push that merges it. Before a commit, a pull request or a release note, the manager runs it locally. Its case matrix is `scripts/check-private-names.test.sh`, run by the `harness` job with made-up names.

## Permissions

`.claude/settings.json` allows without a prompt the read-only commands the gates need: `dotnet build|test`, `npm test -- --watch=false`, read-only git, `scripts/check-context-refs.sh` and every self-test. Everything Rule E covers is a permission ask whatever the allow list says.

## What the build does not enforce

Stated so no gate claims more than runs:

- No `Directory.Build.props`, no `TreatWarningsAsErrors`, no analyzers beyond the SDK defaults, no `.editorconfig`, no `dotnet format` gate, no `global.json`. The solution builds at 0 warnings on 2026-11-12 and the pipeline holds that line by reading the summary.
- No lint or format script in `web-app/package.json`.

Each is an entry in [[pages/roadmap/followups]].

## Not part of the harness yet

- A diagnostics script, a per-project test runner and an architecture-test project: they rest on build strictness this repo does not have yet. With two test projects the mechanic runs each by name.
- Release-version scripts and knowledge-graph git hooks: this repo tags by hand and has no knowledge graph.
- Whole-project mutation testing: Stryker.NET is not installed; gate 5's targeted mutation is the proof.
- `evals/` for the pipeline skill, and project slash commands.

## Related

- [[pages/conventions/testing]]
- [[pages/architecture/project-map]]
- Root `CLAUDE.md`, `AGENTS.md`, `.claude/skills/explorer-pipeline/SKILL.md`
