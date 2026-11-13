# Which tests a change must run

Find the first row the diff matches. Unit and web tests go through `tools/checks/in-docker.sh`.
Each project reports its own count.

| The diff touches | Run |
|---|---|
| `src/ServiceBusExplorer.Core` | `dotnet test src/ServiceBusExplorer.Core.Tests` and `dotnet test src/ServiceBusExplorer.Api.Tests`: the Api references Core, and `FileWorkspaceManager` is exercised only through the Api tests |
| `src/ServiceBusExplorer.Core/Providers/**`, or any broker, management-API or emulator call | Add `dotnet test src/ServiceBusExplorer.IntegrationTests`, on the machine (Docker); only then |
| `src/ServiceBusExplorer.Api` | `dotnet test src/ServiceBusExplorer.Api.Tests` |
| A JSON contract the Angular app reads: a controller route, a DTO, an enum | The row above and the `web-app/**` row |
| `web-app/src/**`, `web-app/electron/**` | In `web-app/`: `npm test -- --watch=false` and `npm run build`. Never plain `npx vitest` |
| `web-app/**` with a visible change | Add `npx playwright test -c e2e` in `web-app/`, on the machine, once, at the end |
| `.claude/hooks/**` | Every `.claude/hooks/*.test.sh`; each prints `ALL CASES PASS` |
| `.claude/workflows/explorer-review.js` | `.claude/workflows/explorer-review.test.sh` |
| `tools/**` | The script's own `.test.sh`, and one run of the script on the real tree |
| Only text: `context/**`, `*.md`, and `.claude/**` paths no row above matches | Nothing executable. Say so, and why |

The surface runs once, at the end of the lane, and again only after a fix that touched code.
Skipped is 0 in the .NET projects. In the web suite the only skips allowed are the 8 in
`metrics.service.spec.ts`; a new one fails the check. No test counts go into the context; CI
shows them.

`src/ServiceBusExplorer.IntegrationTests` starts its brokers in Docker, so it cannot run inside
the container, which has no Docker on purpose. It is run by name on the machine, or by CI:
`dotnet test src/ServiceBusExplorer.IntegrationTests`. The hook lets that one command through.
