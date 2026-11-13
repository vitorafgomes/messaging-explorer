---
paths:
  - "src/<Project>/**"
  - "src/<Project>.Tests/**"
---

# <Project>

REQUIRED. Two or three sentences: what the project owns and what it does not, naming the page
of the project that does.

This file is saved as `.claude/rules/<project>.md`, not in the context folder: Claude Code loads
it whenever a task touches the paths above, so every line is paid for often. Keep it under 6,000
characters (`tools/checks/check-doc-sizes.sh`). A rule is one sentence that says what holds; the
proof goes on `context/pages/services/<project>/how-the-rules-are-kept.md`.

## Rules this project must keep

REQUIRED. One line per rule: the invariant or decision it comes from, then how this project keeps it.

- `context/pages/invariants/<rule>.md` - <what holds in this project, in one sentence>

Each rule in full, with the code and tests that keep it:
`context/pages/services/<project>/how-the-rules-are-kept.md`.

A gap written on `context/pages/services/<project>/known-gaps.md` may stay as it was found.
A change never adds a gap and never widens one.

## Read before you change

- `context/pages/invariants/<rule>.md` - <which part of the project it governs>
- `context/pages/decisions/<NNNN-slug>.md` - <which part of the project it governs>

## Commands

| When | Run |
|---|---|
| Test | `tools/checks/in-docker.sh <command>` |

## What to read for a change

REQUIRED. One row per topic page. The left column names something a reader can see in the change:
a type, a folder, a configuration key, a screen.

| If the change touches | Read |
|---|---|
| <what in the code> | `<topic>.md` |
