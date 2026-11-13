---
paths:
  - "src/ServiceBusExplorer.Core/**"
  - "src/ServiceBusExplorer.Core.Tests/**"
---

# ServiceBusExplorer.Core

Owns the provider contract and both implementations, the bulk delete / resubmit / move algorithms, `workspace.json` persistence and masking of stored connections, and the Azure Monitor metrics reader. Does not own HTTP routes, auth middleware, CORS or the monitoring poller (`context/pages/services/api.md`), nor any UI (`context/pages/services/web-app.md`, `context/pages/services/electron-shell.md`).

## Rules this project must keep

- `context/pages/invariants/provider-boundaries.md` - vendor SDK types stay under `Providers/<Provider>/`
- `context/pages/invariants/secrets-masked-at-the-api-boundary.md` - masked reads, sentinel on write, raw only via `GetConnectionWithSecretAsync`
- `context/pages/invariants/bulk-operations-are-at-least-once.md` - `ResubmitCoreAsync` and `MoveCoreAsync` send before they complete
- `context/pages/invariants/a-guard-must-be-able-to-fire.md` - the no-progress and safety-timeout exits in `DeleteMessagesCoreAsync`

Each rule in full, with the code and tests that keep it: `context/pages/services/core/how-the-rules-are-kept.md`.

A gap written on `context/pages/services/core/known-gaps.md` or `known-gaps-more.md` may stay as it was found.
A change never adds a gap and never widens one.

## Read before you change

- `context/pages/invariants/provider-boundaries.md` - what may live outside `Providers/<Provider>/`
- `context/pages/invariants/secrets-masked-at-the-api-boundary.md` - masking, the `***` sentinel, who may call `GetConnectionWithSecretAsync`
- `context/pages/invariants/bulk-operations-are-at-least-once.md` - send before complete, possible duplicates are reported, never resent
- `context/pages/invariants/a-guard-must-be-able-to-fire.md` - the safety timeout and no-progress guards in the scan loops
- `context/pages/services/api.md` - the only caller of this library
- `context/pages/architecture/project-map.md` - which tests to run when this project changes
- `context/pages/conventions/testing.md`

## Hot spots

- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeleteMessagesCoreAsync` - 2382 lines; `DeleteMessagesCoreAsync`, `ResubmitCoreAsync` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ResubmitCoreAsync`) and `MoveCoreAsync` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#MoveCoreAsync`) repeat one scan loop three times with small differences; a fix to one belongs in all three.
- `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#GetMessagesAsync` - 1193 lines of HTTP plumbing and response DTOs; `GetMessagesAsync` with `ack_requeue_false` is the destructive read every RabbitMQ bulk call relies on.
- `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync` - 1150 lines; the three bulk methods (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ResubmitDeadLetterMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#MoveMessagesAsync`) are the least safe code in the library.
- `src/ServiceBusExplorer.Core/Services/ServiceBusService.cs#ServiceBusService` - 780 lines of legacy code that is effectively unused.
- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#SaveConnectionAsync` - the one write path that stores a connection a caller sent (`ClearAllAsync` only empties the file) and the place masking rules meet persistence.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#TryPurgeServerSideAsync` - reflection call to an internal SDK method; breaks silently to the slow drain when the SDK changes.

## Commands

| When | Run |
|---|---|
| Test | `tools/checks/in-docker.sh dotnet test src/ServiceBusExplorer.Core.Tests`, and the Api tests too: the Api references Core |
| A provider or a broker call changed | also `dotnet test src/ServiceBusExplorer.IntegrationTests`, on the machine, with Docker |

## What to read for a change

Read the one row your change matches. Pages are under `context/pages/services/core/`; the map, `context/pages/services/core.md`, lists them all.

| If the change touches | Read |
|---|---|
| `IMessagingProvider`, capabilities, `ProviderFactory`, the entity types | `public-contract.md` |
| Azure clients, credentials, search, entity administration, counts | `azure-provider.md` |
| A sub-queue, scheduled messages, a disabled entity | `azure-sub-queues.md` |
| Azure sessions | `azure-sessions.md` |
| Export or import of entity definitions | `azure-definitions.md` |
| Purge, bulk delete, resubmit or move on Azure | `azure-bulk-operations.md` |
| `RabbitMQProvider`, `RabbitMQManagementClient`, `ServiceBusService` | `rabbitmq-and-legacy.md` |
| `FileWorkspaceManager`, the metrics services | `workspace-and-metrics.md` |
| A test in `ServiceBusExplorer.Core.Tests` | `tests-unit-azure.md`, `tests-unit-definitions-and-workspace.md` |
| A test in `ServiceBusExplorer.IntegrationTests` | `tests-integration.md` |
