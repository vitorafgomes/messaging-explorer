---
name: explorer-pipeline
description: Use when a request in this repo would write or edit code - a fix ("fix", "broken", "error", "doesn't work"), a feature ("add", "implement", "create", "new provider", "new endpoint", "new screen"), a refactor ("clean up", "restructure", "rename", "extract") or a diagnosis ("why", "investigate", "debug") - even as a plain one-line request, and when it is unclear whether code is being asked for.
---

# Explorer task pipeline

How a code task goes from request to a proposed commit message. The size of the process follows
the risk of the change. A broker here is usually someone's production.

The rules are in `CLAUDE.md` and `.claude/rules/<project>.md`; this file is the order of work.

## 1. Look at the tree, then classify

Run `git status --porcelain` and `git diff HEAD --stat` and classify from what they list.

Say the kind (**Feature**, **Bug**, **Refactor**, **Investigate**), the size from the table below
with the row that decided it, and each installed skill that applies and whether you use it.

| Size | The change | What runs |
|---|---|---|
| **Fast path** | Only comments or documentation; or only an inert file (`.md`, `.txt`, a raster image); or one line of `.cs` or `.ts` with no effect on logic, a signature, a query or registration. | You edit. Build and diagnostics for the touched project. No agent. |
| **Standard** | Anything that is neither fast path nor sensitive. | A plan. You implement when the plan edits files of one project; `explorer-implementer` when it edits two or more. Checks, proof, and one review with the `invariants` lens. |
| **Sensitive** | Any row of `reference/sensitive.md` matches. | A plan, `explorer-implementer`, checks, proof, a review with every lens that file names, `explorer-optimizer` when it names it. |

Two rows override the first: a file on the never-fast-path list in `reference/sensitive.md` is at
least Standard, and a match in its table is Sensitive however small the diff.

Which skills of the superpowers plugin to use here, and which to leave out: `reference/superpowers.md`.

## 2. Read the lane

Exactly one file of this folder: `feature.md`, `bugfix.md`, `refactor.md` or `diagnose.md`.

## 3. Plan (Standard and Sensitive)

Six parts, no narrative. It goes word for word to whoever implements, and the result is checked
against it line by line.

1. **Files**: paths to edit and paths to read. The edit list includes every page of
   `reference/records.md` that applies: the history page, the topic page, the testing page.
2. **Steps**: in order, each naming its test class. For a bug or a refactor, step one is the
   failing or pinning test.
3. **Rules at risk**: the invariant pages the change could break, and the test that pins
   each. A step that would break one is not a step: a superseding decision comes first.
4. **Acceptance**: the literal commands, from `reference/test-surface.md`.
5. **Out of scope**: nearby work this change leaves alone. The "Known gaps" of the project
   page are out of scope unless the request names one.
6. **Requirement table**: each requirement in the user's words, the test path and name that prove
   it, and its kind. Add a row for each behaviour the change implements beyond the request: a
   limit, a reset, a failure path. A request to build what an artboard draws follows
   `reference/prototype.md`: one row per thing the artboard draws.

| Kind | Use it for | The proof |
|---|---|---|
| `new behaviour` | New or changed behaviour | The test fails when the behaviour is removed |
| `behaviour lock` | A refactor that keeps behaviour | The test is green before and after |
| `mutation proof` | A new project or slice, where nothing compiles without the change | The test fails on one targeted mutation |

The plan always states three things outright: whether the change touches the API surface
(endpoint, middleware, IPC, or none), whether it touches a secret (which field and where it is
masked, or none), and whether it receives, completes or sends a message (which operation, in
which order, or none). A plan that leaves
whoever implements searching the repo was stated too fast: name the files and fix the plan.

Before the first edit, use the `ponytail` skill to find the smallest change. It does not replace
the xUnit test, nor a documented abstraction (the provider interface, capabilities, the factory).

## 4. Build

Edit, then the test for that edit, step by step. When the
result departs from the plan, tell the owner; do not patch it over.

Unit and web tests run in the container: `tools/checks/in-docker.sh <command>`. Dispatch forms for
the implementer and the reviewer are in `reference/dispatch.md`. At most two heavy lanes run at
once on the owner's machine: a lane that starts brokers in Docker, or the end-to-end suite.

## 5. Check

- `dotnet build ServiceBusExplorer.slnx` with 0 warnings on the summary line (the build does not
  fail on a warning), and `npm run build` in `web-app/` for a web change.
- `tools/checks/check-diagnostics.sh <touched .csproj>`, clean, one project per run: it rebuilds
  with every analyzer and the documentation file on, which the plain build does not.
- The test surface from `reference/test-surface.md`, with a count per project and 0 skipped. It
  runs once, at the end of the lane, and again only after a fix that touched code. A change to
  `ServiceBusExplorer.Core` runs both unit projects; a provider or broker call adds the
  integration suite; a visible web change adds the end-to-end suite, once, at the end. Every
  unit project at once: `tools/checks/in-docker.sh bash tools/checks/test-per-project.sh`.

## 6. Prove (Standard and Sensitive)

In proportion to the risk (`context/pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk.md`):

| The row | Its proof |
|---|---|
| Under the rules on the API, providers, secrets, message safety or an external call, or a new guard | A mutation that makes its test fail, the assertion message quoted, the file restored from a backup copy |
| Any other new behaviour: a screen, layout, wiring, a label | A spec that fails first and asserts what the user sees |
| A visual refactor | The existing specs and end-to-end flows, green before and after |

A row without its proof blocks the commit message.

## 7. Review (Standard and Sensitive)

One run of the `explorer-review` workflow with the lenses for the size. It sends one
`explorer-reviewer` per lens, then has an independent reviewer try to refute each finding.

| The workflow returns | You do |
|---|---|
| `confirmed` | Read the line it cites, apply it, run the checks again, and send the new diff to review |
| `unresolved` (the refuter returned nothing, or could not find it) | Verify it yourself; it blocks like a confirmed one until you have |
| `refuted` | Record it with the reason |
| `unresolvedLenses` | Run that lens again; it blocks until it returns |

One round of fix and review; a second only for a confirmed P1. A third means the change is not
understood: stop and hand the rest to the owner.

## 8. Record, then stop

- Context pages change in the same commit as the code they describe. `reference/records.md`
  lists what a change records and where; every row that applies is written.
- The repo's own skills do the page work:

  | When | Skill |
  |---|---|
  | The session found something no page says | `wiki-crystallize` |
  | A page was created | `wiki-integrate`, for the index and the links back |
  | Pages changed | `wiki-lint`, then `tools/checks/check-context-refs.sh`; read every citation you rewrote |
- The size check and the pull request body: `reference/records.md`.
- Propose one conventional commit message in a code block, and stop. The owner decides about git;
  a commit the owner asks for goes on a `feat/`, `fix/`, `chore/` or `docs/` branch.
