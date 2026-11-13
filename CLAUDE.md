@AGENTS.md

# Claude Code in this repo

Everything above holds here. What follows is how this repo uses Claude Code.

## Before you edit code

Use the `explorer-pipeline` skill first, for every code task. It classifies the task by risk and
says what the change needs: a one-line edit needs a build, and a change to the API surface, to
secrets or to anything that moves messages needs a plan, proof and a review.

## What loads without being asked

Opening a file loads the rules of the part of the project it belongs to: what that part must keep,
what to read before changing it, and its commands.

| A file under | Loads |
|---|---|
| `src/ServiceBusExplorer.Core/` and its tests | `.claude/rules/core.md` |
| `src/ServiceBusExplorer.Api/` and its tests | `.claude/rules/api.md` |
| `src/ServiceBusExplorer.IntegrationTests/` | `.claude/rules/integration-tests.md` |
| `web-app/src/`, `web-app/e2e/` | `.claude/rules/web-app.md`, with the tools for Angular work |
| `web-app/electron/` | `.claude/rules/electron-shell.md` |
| any `.cs` or `.csproj` | `.claude/rules/dotnet-skills.md` |
| `context/` | `context/CLAUDE.md`, the contract of the documentation folder |

For where a type lives or who calls it, ask the code graph before reading files:
`graphify explain "<Type>"`, `graphify affected "<Type>" --depth 1`.

## One task per session

Start a new session for each task. A session that carries many tasks reads its whole history
again on every request: the largest one measured here made 758 requests with over a million
tokens of context, and that alone was a third of what the session cost.

## What a hook already enforces

You do not need to remember these; a hook stops or flags them.

| Enforced | By |
|---|---|
| Git that writes history, discards work or changes where a push goes; a write to GitHub; a publish: asks first | `pre-git-guard` |
| A unit or web test run outside the container: denied, with the command to use | `pre-test-in-docker` |
| A reviewing agent's shell: read-only git | `agent-read-only-bash` |
| Code edited and no review ran: blocks the reply once | `stop-review-gate` |

## Working with other sessions

- Start a session with `scripts/claude-session.sh` (`worker`, or `ui` for the web app): it leaves
  out the servers and plugins this repo does not use.
- Ask the `explorer-meter` agent where a session spent its tokens.

- One git worktree per piece of work running at the same time. An agent never edits the owner's
  checkout while the owner has uncommitted work in the same files.
- When a session found something worth keeping, run `/wiki-crystallize` and add one line at the
  top of `context/log.md`.
- The owner's private notes are outside this repository. Nothing from them is copied here without
  the owner's word: this repository is public.
