# Building what an artboard draws

Use this when the request is to build a screen from, or bring a screen up to, an artboard under
`context/prototypes/web-app/`. The artboard is the spec: what it draws and the app lacks is owed.

"Everything in the prototype" is never one requirement. The work is finished when every row of
the inventory has evidence, and it is reported as a count. The inventory itself goes in
the report, numbered, so that someone else can check it against the artboard.

## 1. Write the inventory before the plan

Open the artboard file itself and list what it draws, one row per thing one can point at:

| For each | List |
|---|---|
| Screen | Every state the artboard draws: empty, loading, filled, error, disabled, selected |
| State | Every element in it: a button, a field, a label with its exact words, a link, a notice, an icon |
| Element that acts | What it does and what it leads to |

Say the count: "Meetings.dc.html: 4 states, 23 rows". A list written from memory, or from a page
about the artboard, is not the inventory.

## 2. Decide the size before building

When the inventory covers more than one screen, or is more than one change can carry, say so
before the first edit and split it: one screen per change. Tell the owner which rows this change
takes and which stay. A change that starts on everything and stops partway is the failure to avoid.

## 3. One requirement row per inventory row

| The row is | Its evidence |
|---|---|
| An element and its words | A spec that renders the state and asserts the element and its exact text |
| A state | A spec that puts the screen in that state and asserts what the artboard draws there |
| An action | A spec that performs it and asserts the outcome |
| Layout, spacing or colour only | A screenshot of the running app in that state beside the artboard; one row per state, no mutation |

A spec is evidence for a row only when it asserts the thing the artboard draws: the exact
words, the condition under which it shows, the place it sits. A spec that only finds the element
does not prove where it is or when it appears.

## 4. Check against the artboard, not against the plan

After building, go down the inventory with the artboard open and mark each row from the spec or
the screenshot that shows it. The reviewer does the same on its own: it receives the inventory,
opens the artboard, and marks each row from the diff.

## 5. Report the count

```text
PROTOTYPE COVERAGE: <done> of <total> rows
<artboard> | <state> | <row> | done: <spec path::name, or screenshot> | not verified: <what was not checked> | not done: <why>
```

A row whose evidence was not produced is `not verified`, never `done`: a layout row with no
screenshot, a row whose spec does not assert what the artboard draws. Only `done` rows count.

The word "finished" is for `<total> of <total>`. Anything less is reported as "N of M done", with
each row left listed, and those rows go to `context/pages/roadmap/ui-material-migration.md`.
