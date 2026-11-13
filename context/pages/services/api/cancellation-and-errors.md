---
title: "Api: Cancellation and error mapping"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Api service page"
page_type: service
status: active
description: "Read when a change touches the request token a bulk or destructive action passes on, a status code or error body, the 500 body, a clamp on a count."
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

# Api: Cancellation and error mapping

One topic of [[pages/services/api|Api]]; the map lists the others.

## Controllers

### Cancellation

The bulk and destructive actions pass `HttpContext.RequestAborted` to the provider: purge (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#Purge`), delete-batch (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#DeleteBatch`), move-batch (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#MoveBatch`), resubmit-batch (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ResubmitBatch`) and cancel-scheduled (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#CancelScheduledMessages`), and the same four under a subscription (`src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#Purge`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#DeleteBatch`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#MoveBatch`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#ResubmitBatch`). A client abort therefore cancels the Core loop between batches ([[pages/invariants/bulk-operations-are-at-least-once]]: messages already moved or completed before the abort stay done). Since 2026-11-12 peek and search pass it too (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#Peek`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#Search`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#Peek`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#Search`). Not cancellable from the request: receive (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ReceiveMessages`), send, single resubmit (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ResubmitDeadLetterMessage`) and entity create/delete. `MetricsController` and the `counts` route of `MonitoringController` model-bind a `CancellationToken` parameter (`src/ServiceBusExplorer.Api/Controllers/MetricsController.cs#GetQueueMetrics`, `src/ServiceBusExplorer.Api/Controllers/MonitoringController.cs#GetCounts`).

### Error mapping

Two layers, one body. Most actions catch `Exception`, log it and return a constant 500; an exception no action catches reaches the exception handler, the outermost middleware (`src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`), which answers the same 500 `{message:"An internal error occurred."}` as JSON in every environment, Development included. The framework's `ExceptionHandlerMiddleware` logs that exception once at Error; the handler logs nothing itself, and no exception text reaches the client.

- Every 500 body is `{message:"An internal error occurred."}`: Queues/Topics/Sessions (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#Search`), Connections/Groups (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#GetConnections`) and the handler. Pinned by `src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs#A_caught_provider_failure_answers_500_with_the_message_key` for one caught failure in each of Queues, Topics and Sessions, and by `src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs#An_unhandled_exception_answers_a_constant_500_body_and_never_the_exception_text` for the handler under Development and Production.
- Metrics: 503 `{message, configurationRequired:true}` when the exception text contains "not properly configured" (`src/ServiceBusExplorer.Api/Controllers/MetricsController.cs#GetQueueMetrics`), else 500 `{message:"Failed to fetch queue metrics."}` (`:58`).
- Sessions map their refusals to 400, 404 and two 409s with a `code` (see Sessions on [[pages/services/api/routes-sessions-and-definitions]]); `SessionsController` and `Capabilities` clamp or reject inputs (`src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#List`, `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#GetProviderCapabilities`).
- A disabled entity is not a 500: every message route catches `EntityDisabledException` and answers 409 with the fixed text (`src/ServiceBusExplorer.Api/Controllers/EntityAdministrationResults.cs#EntityDisabled`, for example `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#Search`).
- Counts are clamped to 1..1000 on peek (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#Peek`) and receive (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ReceiveMessages`) and monitoring history to 1..120 (`src/ServiceBusExplorer.Api/Controllers/MonitoringController.cs#GetHistory`).
- No controller returns an exception message. `ImportConfiguration` answers an `ArgumentException` with 400 and the constant `{message:"Invalid or empty configuration data"}` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ImportConfiguration`): the two `ArgumentException`s Core throws there carry literal text, but the catch also takes any framework `ArgumentException`, which the action cannot tell apart, so it never echoes `ex.Message`. Pinned by `src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs#Import_never_returns_the_message_of_an_argument_exception`. `TestConnection` returns 200 with `success:false` and an `error` text it builds itself rather than an error status (`:223`); that 200 body is not a 500 and keeps its `error` key, which the add-connection dialog reads.
- Counts are clamped to 1..1000 on peek (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#Peek`) and receive (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ReceiveMessages`) and monitoring history to 1..120 (`src/ServiceBusExplorer.Api/Controllers/MonitoringController.cs#GetHistory`).
- Actions that catch no general failure reach the exception handler and answer the constant 500: the reads (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#GetQueues`, all `GetX`), entity delete, and peek, send, batch send and receive, which catch only the disabled entity (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#Peek`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#SendMessage`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#SendMessages`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ReceiveMessages`, topic send `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#DeleteTopic`).
