---
title: "Core: RabbitMQ provider and the legacy service"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Core service page"
page_type: service
status: active
description: "Read when a change touches RabbitMQProvider: AMQP, RabbitMQManagementClient, the topic and subscription mapping, RabbitMQPatternDetector, RabbitMQ bulk operations; or the legacy ServiceBusService."
source:
  - src/ServiceBusExplorer.Core/
  - src/ServiceBusExplorer.Core.Tests/
  - src/ServiceBusExplorer.IntegrationTests/
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs
  - src/ServiceBusExplorer.Api.Tests/ApiFactory.cs
reliability: high
---

# Core: RabbitMQ provider and the legacy service

One topic of [[pages/services/core|Core]]; the map lists the others.

## RabbitMQ provider

`RabbitMQProvider` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#RabbitMQProvider`, 1150 lines) uses two channels to the broker (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#_connection` to `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#_managementClient`, connect at `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ConnectAsync`, management client at `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ConnectAsync`):

- **AMQP** through `RabbitMQ.Client` (`IConnection`, `IModel`): publish, `BasicGet` for receive and peek, `QueuePurge`. Peek is a `BasicGet` followed by `BasicNack` with requeue (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#PeekMessagesAsync`); receive acks (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ReceiveMessagesAsync`).
- **HTTP management API** through `RabbitMQManagementClient` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#RabbitMQManagementClient`, 1193 lines, own `HttpClient` with Basic auth `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#_httpClient`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#ConfigureAuthentication`): queue, exchange and binding CRUD, overview, `GetMessagesAsync` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#GetMessagesAsync`) and publish (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#PublishMessageAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#PublishToQueueAsync`). It has an internal constructor taking an `HttpClient` for tests (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#RabbitMQManagementClient`).
- **Mapping:** exchanges are "topics", bound queues are "subscriptions", and the dead-letter queue is the convention `<queue>.dlq` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ResubmitDeadLetterMessageAsync`, and for the message operations one helper, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#QueueOf`). RabbitMQ has no sequence numbers, so the bulk calls treat `sequenceNumbers` as 1-based positions in a destructive read (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync`).
- **`RabbitMQPatternDetector`** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs#RabbitMQPatternDetector`, `DetectExchangePattern` `src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs#DetectExchangePattern`, `DetectQueuePattern` `src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs#DetectQueuePattern`) classifies exchanges into `MessagingPattern` values (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Models/MessagingPattern.cs#MessagingPattern`) with a confidence. The provider calls it while listing and fetching exchanges (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#GetTopicsAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#GetTopicAsync`).
- **Bulk operations are not the Azure algorithm.** `DeleteMessagesAsync`, `ResubmitDeadLetterMessagesAsync` and `MoveMessagesAsync` consume up to the largest position through the management API with `ack_requeue_false` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ResubmitDeadLetterMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#MoveMessagesAsync`), then republish: targets to their destination, non-targets back to the source (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ResubmitDeadLetterMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#MoveMessagesAsync`). The messages are already gone from the broker before the republish, so a failed republish loses the message and is recorded as a failure; the order is consume-then-publish, the opposite of Azure's send-then-complete. Non-targets return at the tail of the queue. `all` maps to `QueuePurge` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync`). The `CancellationToken` parameters of these four are accepted and never read; only the peek reads its token, between two messages (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#PeekMessagesAsync`) (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ResubmitDeadLetterMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#MoveMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#PurgeMessagesAsync`).

## Legacy `ServiceBusService`

`Services/ServiceBusService.cs` (780 lines, `src/ServiceBusExplorer.Core/Services/ServiceBusService.cs#ServiceBusService`) is the pre-provider Azure-only service behind `IServiceBusService` (`src/ServiceBusExplorer.Core/Services/IServiceBusService.cs#IServiceBusService`). It is still registered as a singleton (`src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`) and injected into `ConnectionsController` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#_serviceBusService`), but the controller only reads `IsConnected` and `CurrentNamespace` and calls `DisconnectAsync` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#Disconnect`, `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#GetStatus`, `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ClearAllData`). Nothing in `src/ServiceBusExplorer.Api` calls `ConnectAsync` or any entity method on it, so `IsConnected` is always false at run time and the status endpoint reports it. No other project references the class. Its operations are served by `AzureServiceBusProvider`.
