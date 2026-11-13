---
title: "Tooling"
version: "1.1"
date: 2026-11-12
changes: "v1.1 (2026-11-13): the pipeline sized by risk, rules files per part of the project, two new hooks and two renamed, unit and web tests in a container, check-hidden-text and token-usage. Earlier on 2026-11-13: the private-names check. Earlier on 2026-11-13: removed the stale line that CI runs no web test; CI runs them since 2026-11-12. Founded with the harness on 2026-11-12"
page_type: convention
status: active
description: "Who runs on which model and writes what, what lives in .claude/ and tools/, what each hook does, and how the review workflow fits the gates."
updated: 2026-11-13
source:
  - ".claude/"
  - "tools/"
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

The single source of the pipeline. `SKILL.md` holds the order of work and three sizes of process,
chosen by risk: a **fast path** (the session edits and checks, no agent), **standard** (a plan, the
session implements when the plan edits one project and `explorer-implementer` when it edits two or
more, one review with the `invariants` lens) and **sensitive** (the whole process, every lens its
row names). Proof follows [[pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk]].
What makes a change sensitive, which tests it runs, what it records, how to build what an artboard
draws, the dispatch forms and which superpowers skills apply live in `reference/`, read when the
step needs them; the widest test-surface rule is also in `SKILL.md`, because the evals read only
that file. The four lanes give the order per kind of task.

## `.claude/rules/`

Loaded by Claude Code when a file of the matching paths is opened, and by a subagent that opens
one: `core.md`, `api.md`, `integration-tests.md`, `web-app.md` (with the tools for Angular work:
the Angular CLI's own server, registered read-only in `.mcp.json`), `electron-shell.md` and
`dotnet-skills.md`. Each holds the part's responsibility, the invariants it keeps, what to read
before changing it and its commands, taken from its service page; the service page stays the full
account.

## `.claude/workflows/explorer-review.js`

Gate 6 as a `Workflow` script: `Workflow({ name: "explorer-review", args: { module, lenses, dispatch, range? } })`. `invariants` always runs and also owns regression coverage, Rules I and J and generic correctness; the other lenses come from the gate 6 table, each on its own `explorer-reviewer`. A lens reports at most five findings and an empty list on a sound diff is the right answer. Every finding then goes to an independent `explorer-reviewer` on sonnet whose only job is to refute it. The result is `{ confirmed, refuted, unresolved, unresolvedLenses, checked, uncited }`: a finding whose refuter returned nothing goes to `unresolved`, which the manager verifies and treats like `confirmed` (the gate fails closed); a lens whose review returned nothing is named in `unresolvedLenses` and blocks until it is run again. `.claude/workflows/explorer-review.test.sh` runs the real script under node with stub agents and checks the three lists, a silent lens, and the model each lens runs on. Without the Workflow tool the fallback is the direct `explorer-reviewer` dispatch.

## `.claude/skills/wiki-*`

The five wiki skills (`wiki-crystallize`, `wiki-ingest`, `wiki-integrate`, `wiki-lint`, `wiki-query`) and their shared references. They read `context/wiki-config.md` and `context/wiki-schema.md`; the operation contract is `context/CLAUDE.md`.

## `.claude/hooks/`

All seven fail open: a missing `jq`, malformed JSON, or any error exits 0 having written nothing, so a broken hook can never block work. That is why the first one exists.

| Hook | Event | What it does |
|---|---|---|
| `session-start.sh` | SessionStart | Proves the hook runtime works: checks `jq` is on PATH and pipes `git commit -m x` through `pre-git-guard.sh`; when either fails it emits a `systemMessage` saying the hooks are dead and which gates are silent. |
| `prompt-router.sh` | UserPromptSubmit | One line, under 320 characters: a code task routes through `explorer-pipeline` first, and a change to the API surface, a secret or a message operation is never a fast path. |
| `pre-git-guard.sh` | PreToolUse (Bash) | A permission **ask** for git that writes history, discards work (`git clean -f`, `git restore`, `git checkout --`, `rm -rf .git`) or changes where a push goes, every `gh` command that writes to GitHub, a publish and `docker push`. Read-only git passes. |
| `pre-test-in-docker.sh` | PreToolUse (Bash) | **Denies** a unit or web test run (`dotnet test`, `npm test`, `ng test`, `vitest`) that does not go through `tools/checks/in-docker.sh`, and names the command to use. `dotnet test src/ServiceBusExplorer.IntegrationTests` passes: it starts brokers in Docker, which the container has no access to. |
| `agent-read-only-bash.sh` | PreToolUse (Bash) | **Denies** `explorer-reviewer` and `explorer-optimizer` any shell command other than read-only git, and any redirect into a file. The session and the implementer are not bound by it. |
| `post-edit-test-reminder.sh` | PostToolUse (Edit\|Write) | Two sentences, under 340 characters, after an edit to `src/**/*.cs` outside the test projects, to `web-app/src/**` or to `web-app/electron/**`: the test now, through the container, and the checks before a report. |
| `post-edit-build-rules-note.sh` | PostToolUse (Edit\|Write) | On a `.csproj`, `ServiceBusExplorer.slnx`, `Directory.Build.props`, `Directory.Packages.props`, `.editorconfig`, `global.json`, `web-app/angular.json`, `web-app/tsconfig*.json` and `.github/workflows/**`: these judge a change and are not part of it; the reply must say why the task needed the edit. |
| `stop-review-gate.sh` | Stop | **Blocks** the turn once when the session edited production code (`src/**/*.cs` outside `*.Tests`, `web-app/src/**/*.ts` that is not a spec, `web-app/electron/*.js`) without dispatching `explorer-reviewer` (an `Agent` call or a `Workflow` run of `explorer-review`). `stop_hook_active` passes on the continuation, so no loop. Keyed on what *this* session edited, in `<session>.jsonl` and every `<session>/subagents/*.jsonl`. |
| `session-end-metrics.sh` | SessionEnd | Appends one JSON line per session to `.claude/metrics/sessions.jsonl` (gitignored): production and test edits, reviewer dispatches, review workflow runs, pipeline invocations, agents, tool calls, `endedUnreviewed`. It parses only the lines that hold a tool call. |

Every hook carries a case-matrix self-test (`<hook>.test.sh`, prints `ALL CASES PASS`). The `harness` job of `.github/workflows/ci.yml` runs all seven plus `.claude/workflows/explorer-review.test.sh`, `tools/checks/check-context-refs.test.sh` and a real `tools/checks/check-context-refs.sh` run.

## `tools/checks/check-context-refs.sh`

Resolves every code citation in `context/pages` against the working tree. A citation is `path#anchor` (paths under `src`, `web-app`, `scripts`, `docs`, `.claude`, `.github`, written in full): the anchor is a member, a type, a test title or a key that occurs in the file, so an edit elsewhere in the file never breaks it. It fails on a missing file, an anchor the file does not contain, a citation by line number (`path:12`, refused since 2026-11-13, [[pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk]]) and a missing `context/pages`. It proves the anchor exists, never that the page still describes it truly; that part is read. Pages whose `status` marks them as a record are skipped. Runs in gate 7b and in CI.

## `tools/checks/in-docker.sh`

Runs a command in the image `tools/docker/Dockerfile` builds (the .NET 10 SDK, Node 22, git, jq,
perl). The container sees the repository at its own path and a volume for its caches, runs as the
calling user with every capability dropped, sees 8 processors (`EXPLORER_CPUS`), and has no Docker
socket; `EXPLORER_OFFLINE=1` takes its network away. When Docker does not answer it runs nothing
and exits 2. The unit projects and the web tests run through it; the integration suite and the
end-to-end suite run on the machine.

## `tools/checks/check-hidden-text.sh`, `tools/dev/token-usage.sh`

`check-hidden-text.sh [paths]` finds text a person does not see but a model reads: zero-width and
direction characters, control characters, HTML comments and hidden HTML in Markdown, words mixing
Latin with Cyrillic or Greek letters. CI runs it on the repository. `token-usage.sh [transcript]`
and `token-usage.sh docs` report the tokens a session used per agent type, and the size of every
document a model reads here.

## `tools/checks/check-doc-sizes.sh`, `tools/dev/claude-session.sh`, `tools/dev/try-harness.sh`

`check-doc-sizes.sh` keeps the documents a model reads from growing back: each kind has a ceiling
in characters (6,000 for `CLAUDE.md`, `AGENTS.md`, a rules file or an agent file; 12,000 for a
context page outside the roadmap and the history), and a file over it fails unless
`tools/checks/doc-size-baseline.txt` lists it with the size it had, in which case it fails only if it
grew. CI reports it as a warning while the service pages are still over their ceiling.

`claude-session.sh [worker|ui]` opens Claude Code with only the servers this work needs (Rider;
for `ui` also WebStorm and the Angular CLI's server) and without the plugins this repo has no use
for. Nothing in the user's own configuration changes.

`try-harness.sh` copies the repo to a throwaway folder under `~/.cache`, opens six short sessions
in it and checks eleven facts: what loads at the start and on opening a file, that a rules file
reaches a subagent, that a unit test run is denied outside the container and passes through it,
and that a reviewing agent's shell reads git only. It spends about one US dollar.

The `explorer-meter` agent answers where a session spent its tokens and what would lower that,
from `token-usage.sh` and from reading the documents themselves.

## `tools/checks/check-private-names.sh`

Fails when a private name appears in the tracked files (`--tree`) or in text on stdin (`--stdin`): names the owner keeps out of this public repository, such as other projects and employers. The names are never written in the repository; the script reads them from the `PRIVATE_NAMES` secret in CI and from `~/.config/messaging-explorer/private-names` on a workstation. A name matches in any case and with one separator between its letters, and the report gives the file and line or the text line, never the matched text, because CI logs are public. `.github/workflows/private-names.yml` runs it on every push to `main` and on every pull request, opened, edited or pushed, over the tree, the title and body, and every commit message of the range, and is a required check of `main`; `--require` there turns a missing secret into a failure. A pull request from a fork has no secret and is checked again by the push that merges it. Before a commit, a pull request or a release note, the manager runs it locally. Its case matrix is `tools/checks/check-private-names.test.sh`, run by the `harness` job with made-up names.

## Permissions

`.claude/settings.json` allows without a prompt the read-only commands the gates need: `dotnet build|test`, `npm test -- --watch=false`, read-only git, `tools/checks/check-context-refs.sh` and every self-test. Everything Rule E covers is a permission ask whatever the allow list says.

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
