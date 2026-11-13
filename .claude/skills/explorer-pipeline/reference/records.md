# What a change records, and where

Every row that applies is written, in the same commit as the code. A change that leaves one out
is not finished. These pages are part of the plan's edit list, so whoever implements writes them
while the lines are still in front of them.

| What happened | Where it is recorded |
|---|---|
| Behaviour changed | A dated entry in `context/pages/history/<project>.md`: what it was, what it is, which tests changed on purpose |
| The code a page describes changed | The project's service page, with its `updated` date and its `changes` note |
| A test was added | The testing section of the project's service page, beside the tests of the same behaviour |
| A decision was amended | A dated amendment in the decision page that names the earlier text it replaces; the earlier text stays |
| A follow-up was closed | Its entry removed from `context/pages/roadmap/followups.md` |
| A "Known gaps" entry was closed | Removed from the project page and from `context/pages/roadmap/followups.md`, in the same commit |
| Any of the above | One line at the top of `context/log.md` |

A decision keeps its original text. The amendment is added below it, says which sentence of the
original it replaces, quotes the new one and names every place it now holds, so it can be read
without opening another page.

Every page touched, a history page included, gets its `version`, `updated` and `changes` fields
brought up to date. A service or topic page says how things are now; "since" and "until" belong
in the history page.

Code is cited by name, `path#Member` (a member, a type, a test title or a key that occurs in the
file), never by line number (`context/pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk.md`).
`tools/checks/check-context-refs.sh` refuses a line number. A citation that resolves proves the anchor
is in the file, not that the page still says what the code does: read each one you rewrite.

No test counts go into the context; CI shows them.

## Before the commit message

- After a change to `src/`, `web-app/` or `context/`, run `tools/checks/check-context-refs.sh` and fix
  every citation it reports.
- The pull request body uses `.github/PULL_REQUEST_TEMPLATE.md` and carries the line
  `Review: applied N, rejected M`. Its three safety boxes (API surface, secrets, message
  safety) are ticked only after the matching lens, or the plan's statement that the change
  touches none, says so.

## Spending less

- A check that passed is not run again on an unchanged diff.
- A long search goes to one `Explore` agent; a follow-up goes to the agent that has the context.
