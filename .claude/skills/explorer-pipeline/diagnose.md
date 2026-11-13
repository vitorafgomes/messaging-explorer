# Diagnose lane

This lane edits no code. Its result is an answer with citations; a fix is a separate task on the
bug-fix lane, started from the requirement table this lane hands over.

1. **Follow `superpowers:systematic-debugging`**: reproduce before theorising, one hypothesis at a
   time, evidence before explanation, and the cause shown before any fix is proposed.
2. **Read the project first.** Its service page, the sections for the code in question, and `context/pages/history/<project>.md` for a similar failure.
3. **Then the evidence.** The worker's logs and OpenTelemetry output before source; the runbooks
   under `context/pages/runbooks/` say where they are. A survey past three searches goes to one
   `Explore` agent. A question about a symbol goes to the code graph or the language server. A
   hang, a leak or a slow path is measured with `dotnet-diag`.
4. **Answer with citations.** A context page where one exists, otherwise `path#Member`. Keep what
   you verified apart from what you suppose, and read anything you recommend in the current code
   first. When the answer leads to a fix, hand over the user's wording and a requirement table.
5. **Record it.** An incident page from `context/templates/_incident.md` when a user's broker
   was affected, otherwise the finding on the project's history page, and one line in
   `context/log.md`.
