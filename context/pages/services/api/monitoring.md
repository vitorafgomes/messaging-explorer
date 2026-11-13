---
title: "Api: Monitoring"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Api service page"
page_type: service
status: active
description: "Read when a change touches MonitoringBackgroundService, its poll period and failures, MonitoringStore, or the monitoring routes."
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

# Api: Monitoring

One topic of [[pages/services/api|Api]]; the map lists the others.

## Monitoring

**The poll.** `MonitoringBackgroundService` starts a poll at startup and then on every tick of a `PeriodicTimer` (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#ExecuteAsync`). The period is `Monitoring:PollIntervalSeconds` in whole seconds, raised to a floor of 30 seconds and lowered to a ceiling of one hour; an absent or unparsable value is the floor (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#MonitoringBackgroundService`). No `appsettings` file sets the key, so the period is 30 seconds unless the environment says otherwise (`Monitoring__PollIntervalSeconds`). The floor is the proposal of the monitoring artboard: the tool must not hammer a production namespace. The timer takes a `TimeProvider`, the system clock outside tests. The poll runs whenever a broker is connected, whether or not the screen is open ([[pages/roadmap/followups]]). A tick that finds the previous poll still running is skipped and logged at Warning (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#StartCycle`), so a slow namespace never has two polls in flight. A tick after the connection changed does not wait for a poll of the previous connection: it cancels that poll, whose subscription reads stop between topics and whose answer is discarded, and polls the current connection at once (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#StartCycle`).

A poll reads the current provider, clears the store when the provider reference changed (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#RunCycleAsync`), returns if none or disconnected (`:121`), then calls `GetQueuesAsync` and `GetTopicsAsync` once each and `GetSubscriptionsAsync` per topic, at most four topics at a time (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#MaxConcurrentSubscriptionReads`, `src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#CollectAsync`): on Azure each is one management request, so four keeps a namespace of many topics from costing one round trip after another while never holding more than four requests open against it. On RabbitMQ each topic costs one request for its bindings and then two per queue it binds (the queue and its `.dlq`), one after another: still at most four requests open, but many more round trips per poll; a binding to another exchange is skipped (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#GetSubscriptionsAsync`, [[pages/roadmap/followups]]). The subscriptions are kept in topic order. One failing call fails the whole poll: no partial snapshot is stored, the exception is logged at Error and the store records the time of the failure (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#RunCycleAsync`); the next tick polls again, and its snapshot clears the failure. A poll that ends after the connection changed stores nothing (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs#RunCycleAsync`).

**The counts.** Each queue and subscription carries active, dead-letter, transfer, scheduled and transfer dead-letter counts. A count the broker does not count is `null`, never 0 (`src/ServiceBusExplorer.Api/Monitoring/MonitoringModels.cs#FromQueue`): the scheduled count of a subscription always, because `SubscriptionRuntimeProperties` in `Azure.Messaging.ServiceBus` 7.21 has no scheduled count (read in the installed package: total, active, dead-letter, transfer and transfer dead-letter only); the scheduled count of a provider without `SupportsScheduledMessages` and the transfer dead-letter count of a provider without `SupportsTransferDeadLetter`, both RabbitMQ. The web app says "Not counted".

**The routes.** `MonitoringStore` is a `ConcurrentQueue` capped at 120 snapshots (`src/ServiceBusExplorer.Api/Monitoring/MonitoringStore.cs#MaxEntries`) plus the time of the last failed poll. `GET api/monitoring/snapshot` answers `{ snapshot, pollIntervalSeconds, lastPollFailedAt }` (`src/ServiceBusExplorer.Api/Controllers/MonitoringController.cs#MonitoringController`): `snapshot` is `null` until a poll has stored one, where it used to be an empty snapshot stamped now that read like an empty namespace, and `lastPollFailedAt` is the time of the last failed poll, `null` once a later poll succeeded; nothing of the exception reaches the answer. `GET api/monitoring/counts?queue={name}` or `?topic={topic}&subscription={subscription}` reads one entity's counts from the broker now, outside the poll, in the snapshot's shape, and writes nothing to the store (`src/ServiceBusExplorer.Api/Controllers/MonitoringController.cs#GetHistory`). One route takes both kinds as query values, so a name with `/` needs no raw-target decoding. It answers 400 `Name either a queue, or a topic and one of its subscriptions.` when it names neither or both, without calling the provider (`:51`); 400 with no provider connected; 404 `The queue was not found.` or `The subscription was not found.`; the constant 500 for any other failure, logged with the entity path (`:73`). It hands the provider the request token through `GetQueueCountsAsync` and `GetSubscriptionCountsAsync`, one runtime-properties call each on Azure ([[pages/services/core]]).
