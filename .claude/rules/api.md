---
paths:
  - "src/ServiceBusExplorer.Api/**"
  - "src/ServiceBusExplorer.Api.Tests/**"
---

# ServiceBusExplorer.Api

Owns the HTTP surface: startup configuration, the auth/CORS/host-filter pipeline, route shape, request clamping, error-to-status mapping, and the one slot that holds the active provider. Does not own broker behaviour, bulk-operation semantics or connection persistence; those live in `context/pages/services/core.md`. Does not serve the UI (`context/pages/services/web-app.md`) and does not start itself (`context/pages/services/electron-shell.md`). See `context/pages/architecture/project-map.md`.

## Rules this project must keep

- `context/pages/invariants/local-authenticated-api.md`: loopback only plus `X-Api-Key` on everything but `/health` and preflight (`src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`; pinned by `src/ServiceBusExplorer.Api.Tests/AuthMiddlewareTests.cs#Request_without_api_key_returns_401`, `:20`, `:29`, `:38`).
- `context/pages/invariants/secrets-masked-at-the-api-boundary.md`: only `includeSecrets` exports and internal `WithSecret` calls see raw secrets.
- `context/pages/invariants/provider-boundaries.md`: controllers talk to `IMessagingProvider`, never to a broker SDK; the slot is process-wide.
- `context/pages/invariants/bulk-operations-are-at-least-once.md`: the controllers only forward the request token; delivery semantics are in `context/pages/services/core.md`.
- `context/pages/invariants/a-guard-must-be-able-to-fire.md`: the Host filter and the `API_SECRET` fail-fast are made to fire by `src/ServiceBusExplorer.Api.Tests/BoundaryGuardTests.cs#A_foreign_Host_is_refused` and `:29`; the Kestrel loopback binding has no test that makes it fire (see Testing and Known gaps).

A gap written under "Known gaps" on `context/pages/services/api.md` may stay as it was found.
A change never adds a gap and never widens one.

## Read before you change

- `context/pages/invariants/local-authenticated-api.md`
- `context/pages/invariants/secrets-masked-at-the-api-boundary.md`
- `context/pages/invariants/provider-boundaries.md`
- `context/pages/invariants/bulk-operations-are-at-least-once.md`
- `context/pages/invariants/a-guard-must-be-able-to-fire.md`
- `context/pages/services/core.md` (the provider contract every controller calls)
- `context/pages/services/web-app.md` and `context/pages/services/electron-shell.md` (the only callers; Electron mints the secret)
- `context/pages/conventions/testing.md`

## Hot spots

- `src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager` - the auth middleware; hand-rolled, ordering relative to `MapGet("/health")` and CORS matters.
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#_currentProvider` - the static provider slot and `SetCurrentProviderAsync` (`:59`).
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection` - `SaveConnection` merge logic and the metadata-only shortcut.
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ImportFullConfiguration` - `clear-all`.
- `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ResubmitDeadLetterMessage` and `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#ResubmitDeadLetterMessage` - batch DLQ resubmit entry points; queue and topic copies are hand-duplicated, so a change must be made twice.

## Commands

| When | Run |
|---|---|
| Test | `tools/checks/in-docker.sh dotnet test src/ServiceBusExplorer.Api.Tests` |
| A JSON contract the web app reads changed | also the web tests, `../tools/checks/in-docker.sh npm test -- --watch=false` in `web-app/` |

How the project works, its tests and its known gaps: `context/pages/services/api.md`.
