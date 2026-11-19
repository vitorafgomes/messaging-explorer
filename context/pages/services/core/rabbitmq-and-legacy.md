---
title: "Core: RabbitMQ provider and the legacy service"
version: "1.6"
date: 2026-11-13
updated: 2026-11-16
changes: "v1.6: the message operations moved to their own page. v1.5: receive and purge on a stream; search declared unsupported. v1.4: a confirmed send; a refused peek and a stream. v1.3: bulk delete and move run on the resubmit's path. v1.2: a close that throws leaves a removal unproven; a cancelled or failed resubmit unticks the messages and reads the queue again. v1.1: the topic read builds its subscriptions from the queue listing"
page_type: service
status: active
description: "Read when a change touches RabbitMQProvider: AMQP, RabbitMQManagementClient, the topic and subscription mapping, RabbitMQPatternDetector; or the legacy ServiceBusService."
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

- **AMQP** through `RabbitMQ.Client` (`IConnection`, `IModel`): publish, `BasicGet` for receive and peek, `QueuePurge`. Peek is a `BasicGet` followed by `BasicNack` with requeue (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#PeekMessagesAsync`); receive acks (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ReceiveMessagesAsync`). Since 2026-11-15 a peek holds what it reads and requeues it all with one nack at the end, so it returns each message once in queue order, and it numbers each message with its position (1, 2, 3…), the key the bulk operations address it by (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs#Peeked_messages_carry_their_position_and_a_delete_of_one_position_deletes_only_that_message`). A position holds only while nothing else takes messages from the head of the queue: RabbitMQ has no stable sequence number.
- **HTTP management API** through `RabbitMQManagementClient` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#RabbitMQManagementClient`, 1193 lines, own `HttpClient` with Basic auth `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#_httpClient`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#ConfigureAuthentication`): queue, exchange and binding CRUD, overview, `GetMessagesAsync` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#GetMessagesAsync`) and publish (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#PublishMessageAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#PublishToQueueAsync`). It has an internal constructor taking an `HttpClient` for tests (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#RabbitMQManagementClient`).
- **Mapping:** exchanges are "topics", bound queues are "subscriptions", and the dead-letter queue is the convention `<queue>.dlq` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ResubmitDeadLetterMessageAsync`, and for the message operations one helper, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#QueueOf`). RabbitMQ has no sequence numbers, so the bulk calls treat `sequenceNumbers` as 1-based positions in a destructive read (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync`).
- **`RabbitMQPatternDetector`** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs#RabbitMQPatternDetector`, `DetectExchangePattern` `src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs#DetectExchangePattern`, `DetectQueuePattern` `src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs#DetectQueuePattern`) classifies exchanges into `MessagingPattern` values (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Models/MessagingPattern.cs#MessagingPattern`) with a confidence. The provider calls it while listing and fetching exchanges (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#GetTopicsAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#GetTopicAsync`).
- **Send, peek, receive, purge, search and the three bulk calls** are on [[pages/services/core/rabbitmq-message-operations]]: what each does on the broker, what it refuses and what it reports.

## Legacy `ServiceBusService`

`Services/ServiceBusService.cs` (780 lines, `src/ServiceBusExplorer.Core/Services/ServiceBusService.cs#ServiceBusService`) is the pre-provider Azure-only service behind `IServiceBusService` (`src/ServiceBusExplorer.Core/Services/IServiceBusService.cs#IServiceBusService`). It is still registered as a singleton (`src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`) and injected into `ConnectionsController` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#_serviceBusService`), but the controller only reads `IsConnected` and `CurrentNamespace` and calls `DisconnectAsync` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#Disconnect`, `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#GetStatus`, `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ClearAllData`). Nothing in `src/ServiceBusExplorer.Api` calls `ConnectAsync` or any entity method on it, so `IsConnected` is always false at run time and the status endpoint reports it. No other project references the class. Its operations are served by `AzureServiceBusProvider`.

**The topic read (2026-11-14)** builds its subscriptions from the one queue listing it already makes, with each bound queue's state and counts, and no rule count, as `SupportsSubscriptionRules` is false (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#GetTopicAsync`). A failed listing fails the read instead of showing invented statuses. Only queue bindings are listed; `SubscriptionCount` still counts every binding.
