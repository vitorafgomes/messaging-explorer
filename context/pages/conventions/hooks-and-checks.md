---
title: "Hooks and checks"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the tooling page"
page_type: convention
status: active
description: "Read when a change touches a hook under .claude/hooks/, a script under tools/, or what the harness job of CI runs."
source:
  - ".claude/hooks/"
  - "tools/"
  - ".github/workflows/ci.yml"
reliability: high
---

# Hooks and checks

What runs without being asked: the hooks of `.claude/hooks/` and the scripts under `tools/`. Who runs on which model, the pipeline and the review workflow are on [[pages/conventions/tooling]].

## `.claude/hooks/`

All nine fail open: a missing `jq`, malformed JSON, or any error exits 0 having written nothing, so a broken hook can never block work. That is why the first one exists.

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

Every hook carries a case-matrix self-test (`<hook>.test.sh`, prints `ALL CASES PASS`). The `harness` job of `.github/workflows/ci.yml` runs every `.claude/hooks/*.test.sh`, `.claude/workflows/*.test.sh` and `tools/*/*.test.sh`, then real runs of `check-context-refs.sh`, `check-hidden-text.sh`, `check-harness-requirements.sh` and `check-doc-sizes.sh`; each fails the job.

## `tools/checks/check-context-refs.sh`

Resolves every code citation in `context/pages` against the working tree. A citation is `path#anchor` (paths under `src`, `web-app`, `scripts`, `docs`, `.claude`, `.github`, written in full): the anchor is a member, a type, a test title or a key that occurs in the file, so an edit elsewhere in the file never breaks it. It fails on a missing file, an anchor the file does not contain, a citation by line number (`path:12`, refused since 2026-11-13, [[pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk]]) and a missing `context/pages`. It proves the anchor exists, never that the page still describes it truly; that part is read. Pages whose `status` marks them as a record are skipped. Runs in the Record step and in CI.

## `tools/checks/in-docker.sh`

Runs a command in the image `tools/docker/Dockerfile` builds (the .NET 10 SDK, Node 22, git, jq,
perl). The container sees the repository at its own path and a volume for its caches, runs as the
calling user with every capability dropped, sees 8 processors (`EXPLORER_CPUS`), and has no Docker
socket; `EXPLORER_OFFLINE=1` takes its network away. When Docker does not answer it runs nothing
and exits 2. The unit projects and the web tests run through it; the integration suite and the
end-to-end suite run on the machine.

## `tools/checks/check-diagnostics.sh`, `tools/checks/test-per-project.sh`, `tools/checks/check-harness-requirements.sh`

`check-diagnostics.sh <.csproj>` rebuilds one project with every analyzer reporting and the
documentation file on, which the plain build does not, and fails on what is left: the Check step
runs it per touched project. `test-per-project.sh` runs every unit test project one at a time and
fails when one fails, skips a test or runs nothing; the integration suite is not one of them.
`check-harness-requirements.sh` fails when a harness document no longer states a requirement it
carries: each row names a document and one phrase of it.

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
grew. CI runs it as a blocking check.

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

Fails when a private name appears in the tracked files (`--tree`) or in text on stdin (`--stdin`): names the owner keeps out of this public repository, such as other projects and employers. The names are never written in the repository; the script reads them from the `PRIVATE_NAMES` secret in CI and from `~/.config/messaging-explorer/private-names` on a workstation. A name matches in any case and with one separator between its letters, and the report gives the file and line or the text line, never the matched text, because CI logs are public. `.github/workflows/private-names.yml` runs it on every push to `main` and on every pull request, opened, edited or pushed, over the tree, the title and body, and every commit message of the range, and is a required check of `main`; `--require` there turns a missing secret into a failure. A pull request from a fork has no secret and is checked again by the push that merges it. Before a commit, a pull request or a release note, the session runs it locally. Its case matrix is `tools/checks/check-private-names.test.sh`, run by the `harness` job with made-up names.

## Related

- [[pages/conventions/tooling]]
- [[pages/conventions/testing]]
