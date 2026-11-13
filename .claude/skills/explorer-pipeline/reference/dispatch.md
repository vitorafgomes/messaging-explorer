# Dispatch forms

Copy, fill in, send unchanged.

## To `explorer-implementer`

```text
Project: <project>   Worktree: <path>   Lane: feature | bugfix | refactor
1. Files      EDIT: <paths, context pages included>   READ: <paths>
2. Steps      <in order, with the test class of each>
3. Rules at risk   <invariant page -> the test that pins it>
   API surface: <none | endpoint, middleware or IPC channel>
   Secret: <none | which field, and where it is masked>
   Messages: <none | which operation, in which order>
4. Acceptance <literal commands>
5. Out of scope <...>
6. Requirements   <requirement, in the user's words> -> <test path::name> [new behaviour | behaviour lock | mutation proof]
```

## To the `explorer-review` workflow, as its `dispatch` argument

```text
Project: <project>   Diff: working tree of <worktree> (or <range>)
Lenses: invariants[, api-surface][, secrets][, message-safety][, boundaries]   (the row of reference/sensitive.md that names each)
Requirements: <rows with their kind>
Proof: <per row: the mutation, the quoted failure, the restore; or the runs before and after>
Test quality: test-anti-patterns <result>; assertion-quality <result>
```

Call it once per change:
`Workflow({ name: "explorer-review", args: { module: "<project>", lenses: [...], dispatch: "<the form above, filled>" } })`.
When the Workflow tool is not available, send the same form to `explorer-reviewer` directly, once
per lens.
