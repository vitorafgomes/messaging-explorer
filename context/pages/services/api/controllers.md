---
title: "Api: Controllers"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Api service page"
page_type: service
status: active
description: "Read when a change touches which controller owns a route, the static active-provider slot and its lock, or how an entity name travels in the path."
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

# Api: Controllers

One topic of [[pages/services/api|Api]]; the map lists the others.

## Controllers

All controllers are `[ApiController]`, transient; all but `SessionsController` carry `[Route("api/[controller]")]`.

| Controller | Route groups | Provider source |
|---|---|---|
| `ConnectionsController` (`.../ConnectionsController.cs:11`) | saved-connection CRUD (`GET`, `GET {id}`, `POST`, `DELETE {id}`), `test`, lifecycle (`{id}/connect`, `disconnect`, `status`), `providers`, `providers/{type}/capabilities`, `export`, `import`, `export-full`, `import-full`, `DELETE clear-all` | Owns the slot |
| `ConnectionGroupsController` (`.../ConnectionGroupsController.cs:9`) | group CRUD (client / environment tree) | none (uses `IConnectionGroupManager`) |
| `QueuesController` (`.../QueuesController.cs:9`) | entity CRUD, peek (`messages`, `deadletter`, `transferdeadletter`), search (`messages/search`, `deadletter/search`, `transferdeadletter/search`), send (single and `messages/batch`), receive (`messages/receive`), `messages/cancel-scheduled`, DLQ resubmit (single and `resubmit-batch`, the batch also for `transferdeadletter`), purge (`DELETE messages`, `DELETE deadletter`), `delete-batch` (main, dead-letter and transfer dead-letter), `move-batch` (main and dead-letter) | `ConnectionsController.GetCurrentProvider()` |
| `TopicsController` (`.../TopicsController.cs:9`) | topic CRUD, send to topic, subscription CRUD, then the same peek/search/receive/resubmit/purge/delete-batch/move-batch groups under `{topic}/subscriptions/{sub}/...`, without cancel-scheduled | same |
| `SessionsController` (`.../SessionsController.cs:15`) | under a queue or a subscription: list sessions (passive), one session's detail, its messages, its state write (`PUT`) | same |
| `NamespaceController` (`.../NamespaceController.cs:16`) | `export` and `import` of the entity definitions | `ConnectionsController.GetCurrentProvider()` |
| `MetricsController` (`.../MetricsController.cs:12`) | Azure Monitor series for `queues/{q}`, `topics/{t}`, `topics/{t}/subscriptions/{s}` | none (uses `IMetricsService`) |
| `MonitoringController` (`.../MonitoringController.cs:8`) | `snapshot`, `history`, `counts` (one entity now) | `MonitoringStore`; `counts` reads `ConnectionsController.GetCurrentProvider()` |

Paths in the table abbreviate `src/ServiceBusExplorer.Api/Controllers/`.

### How the active provider is obtained

`QueuesController`, `TopicsController` and `SessionsController` take only a logger. Each declares a private static `GetProvider()` that returns `ConnectionsController.GetCurrentProvider()` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#GetProvider`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#GetProvider`, `src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#GetProvider`). That is a public static read of `ConnectionsController._currentProvider`, a static field guarded by a lock for reads and swaps (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#_currentProvider`, `:50-53`, `:411`). `MonitoringBackgroundService` reads the same slot (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#StartCycle`).
`QueuesController`, `TopicsController` and `SessionsController` take only a logger. Each declares a private static `GetProvider()` that returns `ConnectionsController.GetCurrentProvider()` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#GetProvider`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#GetProvider`, `src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#GetProvider`). That is a public static read of `ConnectionsController._currentProvider`, a static field guarded by a lock for reads and swaps (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#_currentProvider`, `:50-53`, `:410`). `MonitoringBackgroundService` and the `counts` route of `MonitoringController` read the same slot (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#StartCycle`, `src/ServiceBusExplorer.Api/Controllers/MonitoringController.cs#GetCounts`).

Consequences:

- One active connection per process, shared by every client of the API. Connecting replaces it for everyone ([[pages/invariants/provider-boundaries]]).
- With no connection, every provider-backed action returns 400 `{message:"No messaging provider connected..."}` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#NoProviderConnected`), the same text duplicated in each of the three controllers.
- The lock covers only the field. `SetCurrentProviderAsync` swaps under the lock, then disconnects and disposes the old provider outside it (`.../ConnectionsController.cs:59-80`). An action that already read the old reference at its start (for example `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#GetQueues`) keeps using it with no lease, so a concurrent `connect`, `disconnect` or `clear-all` can dispose the provider under a running call. No test covers it.
- `Connect` creates and connects the new provider before the swap (`.../ConnectionsController.cs:240-243`); if creation throws, the previous provider stays active and the caller gets 500.
- `GetStatus` falls back to the legacy `IServiceBusService` when no provider is set (`.../ConnectionsController.cs:326-332`).

### Entity names in the path

An entity, topic, subscription or session name is one path segment, sent percent-encoded by the web app ([[pages/services/web-app]]). Kestrel decodes every escape in the path except `%2F`, so by default the route value of `/api/queues/a%2Fmessages` is the literal `a%2Fmessages`, while `%25`, `%23`, `%3F` and `%20` are decoded: a raw `a%252Fb` and a raw `a%2Fb` both reach the action as `a%2Fb`. Decoding the route value again would turn the first into `a/b`, so the route value alone cannot be fixed.

`RawTargetRouteValuesAttribute` (`src/ServiceBusExplorer.Api/Controllers/RawTargetRouteValuesAttribute.cs#RawTargetRouteValuesAttribute`), a resource filter on `QueuesController`, `TopicsController`, `SessionsController` and `MetricsController` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#[ApiController, RawTargetRouteValues]`), runs before model binding and replaces each whole-segment route value with the matching segment of the raw request target, decoded once (`src/ServiceBusExplorer.Api/Controllers/RawTargetRouteValuesAttribute.cs#Apply`): `a%2Fmessages` reaches the provider as `a/messages`, `a%252Fb` as `a%2Fb`, `50%25off` as `50%off`. It replaces a value only when the raw target is an origin-form path with as many segments as the route pattern (`:47`) and the raw segment decodes, `%2F` kept, to the value routing produced (`:57`); otherwise, for example a raw target with dot segments that Kestrel normalised, the routed value is left as it was. Routes are unchanged. `ConnectionsController` and `ConnectionGroupsController` carry ids, not names, and do not use it.

Pinned through Kestrel (`WebApplicationFactory.UseKestrel`) by `src/ServiceBusExplorer.Api.Tests/EntityNameRoutingTests.cs`: deleting the queue `a/messages` calls `DeleteQueueAsync("a/messages")` and nothing else (`:98`); purging `orders#1` calls `PurgeMessagesAsync("orders#1")` and nothing else (`:106`); eight queue names on six queue operations (`:122`), a topic and subscription with `/` (`:144`), a session id with `/` and a space on the six session-id routes and the two lists (`:248`) and the three metrics routes (`:176`) reach the provider or the metrics service unchanged; the fallback branches are driven directly (`:197`, `:210`).
