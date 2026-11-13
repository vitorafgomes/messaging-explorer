---
title: "Api: Hot spots and known gaps"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Api service page"
page_type: service
status: active
description: "Read when a change touches a hot spot of the Api project or a gap recorded as it was found."
source:
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/Controllers/
  - src/ServiceBusExplorer.Api/Monitoring/
  - src/ServiceBusExplorer.Api/appsettings.json
  - src/ServiceBusExplorer.Api.Tests/
  - src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs
  - src/ServiceBusExplorer.Core/Services/UnconfiguredMetricsService.cs
  - web-app/electron/main.js
reliability: high
---

# Api: Hot spots and known gaps

One topic of [[pages/services/api|Api]]; the map lists the others.

## Hot spots

- `src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager` - the auth middleware; hand-rolled, ordering relative to `MapGet("/health")` and CORS matters.
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#_currentProvider` - the static provider slot and `SetCurrentProviderAsync` (`:59`).
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection` - `SaveConnection` merge logic and the metadata-only shortcut.
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ImportFullConfiguration` - `clear-all`.
- `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ResubmitDeadLetterMessage` and `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#ResubmitDeadLetterMessage` - batch DLQ resubmit entry points; queue and topic copies are hand-duplicated, so a change must be made twice.

## Known gaps

- Static process-wide provider slot with no lease on in-flight calls: `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#_currentProvider`, `:73-74`.
- 503 detection by substring of an exception message: `src/ServiceBusExplorer.Api/Controllers/MetricsController.cs#GetQueueMetrics`, `src/ServiceBusExplorer.Core/Services/UnconfiguredMetricsService.cs#UnconfiguredMetricsService`.
- CORS allows origin `null`, which any `file://` or sandboxed page also sends; the API key is the real control: `src/ServiceBusExplorer.Api/Program.cs#"null")`.
- Metadata-only detection ignores `AuthType`, tenant, namespace and client secret, so changing only those skips the connection test: `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection`.
- `import-full` is not atomic (groups then connections): `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ImportFullConfiguration`.
- Receive (destructive) and single resubmit ignore the request token: `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ReceiveMessages`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ResubmitDeadLetterMessage`.
- Monitoring polls whether or not anyone is looking; the queue and topic lists take no token, so the stopping token stops only the subscription reads between topics; the poll keeps a reference to the last (possibly disposed) provider; a failed poll is shown to the app only by its time, never by its cause: `src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#_timeProvider`, `src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#CollectAsync`.
- Legacy `IServiceBusService` is still registered and consulted by `status`, `disconnect` and `clear-all`: `src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`, `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#Disconnect`, `:326`.
- Untested controllers listed under Testing footprint ([[pages/services/api/tests]]); the largest surface (queues, topics) has its 500 body, the name each route hands the provider, the entity administration routes and, since 2026-11-12, the message routes pinned; the entity reads and deletes are not.
