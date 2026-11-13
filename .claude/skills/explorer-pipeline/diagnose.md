# Diagnose / investigate lane

**No code edits in this lane; the only writes are the context crystallization in step 5.** The
deliverable is a cited answer; a fix is a separate task through the bug-fix lane with the
requirement-to-test map this lane hands over.

1. **Invoke `superpowers:systematic-debugging`** and follow it: reproduce before theorising, one
   hypothesis at a time, evidence before explanation, and no fix proposed before the cause is shown.
   This lane adds the repo's reading order to that method, nothing else.
2. **Context first** - the project's "To change here, read" set and "Known gaps"
   (`context/pages/services/<project>.md`), its flows and `context/pages/history/<project>.md`; the
   incidents under `context/pages/incidents/` for a similar failure.
3. **Evidence second** - the API's console output (the Electron shell echoes the child's stdout and
   stderr) before source; a survey past three queries goes to one `Explore` subagent. Symbol
   questions use the Roslyn LSP, not grep. A hang, a leak or a slow path is traced with
   `dotnet-diag` (`dotnet-trace-collect`, `dump-collect`, `analyzing-dotnet-performance`), not
   reasoned about. Never point a reproduction at a production broker: a peek is safe, a receive, a
   purge and every bulk operation are not.
4. **Answer with citations** - `[[context/pages/...]]` where a page exists, else `path#Member`; verified
   facts apart from hypotheses; per Rule D, anything recommended is read in current code first.
   When the diagnosis hands off a fix, carry the user's wording and a requirement-to-test map
   (`new behaviour` | `behaviour lock` | `mutation proof`) into the bug-fix lane.
5. **Crystallize** - an incident page (`context/templates/_incident.md`) when a user's broker was
   affected, otherwise the finding on the project's history page or its "Known gaps"; one
   `context/log.md` line.
