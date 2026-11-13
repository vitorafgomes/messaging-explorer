# Skills from the superpowers plugin

That plugin asks for a skill to be used whenever one might apply. In this repo:

| Use | When |
|---|---|
| `superpowers:brainstorming` | A feature request with no spec (feature lane) |
| `superpowers:systematic-debugging` | A diagnosis (diagnose lane) |
| `superpowers:test-driven-development` | A bug fix: the failing test comes first (bug-fix lane) |
| `superpowers:receiving-code-review` | Before applying a finding of the review |
| `superpowers:verification-before-completion` | Before saying a step is done: run the check and show its output |
| `superpowers:writing-skills` | A change to an agent, a skill, a rules file or this file |

| Leave out | Because |
|---|---|
| `writing-plans`, `executing-plans` | The plan here has six parts and lives in the conversation; a plan file outside `context/` is not allowed |
| `subagent-driven-development`, `dispatching-parallel-agents` | How many agents a change gets is the size table above |
| `requesting-code-review` | The review is the `explorer-review` workflow |
| `finishing-a-development-branch`, `using-git-worktrees` | Git belongs to the owner, and the implementer already gets its own worktree |
