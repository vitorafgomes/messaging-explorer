---
title: "Api: The batch send of a queue and a topic"
version: "1.0"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.0: split out of the routes of entities and messages"
page_type: service
status: active
description: "Read when a change touches POST queues or topics {name}/messages/batch: its limits, its partial result, its token, and how the import dialog uses it."
source:
  - src/ServiceBusExplorer.Api/Controllers/QueuesController.cs
  - src/ServiceBusExplorer.Api/Controllers/TopicsController.cs
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs
  - src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs
reliability: high
---

# Api: The batch send of a queue and a topic

The other message routes are on [[pages/services/api/routes-entities-and-messages]]; what a bulk operation promises is on [[pages/invariants/bulk-operations-are-at-least-once]].

**Batch send (2026-11-14).** `POST api/queues/{name}/messages/batch` and `POST api/topics/{name}/messages/batch` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#SendMessages`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#SendMessages`) share one action (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#SendBatch`): 1 to 1000 messages (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#MaxSendBatch`), refused with 400 before the provider is called; 409 for a disabled entity and the constant 500 for a failure before anything was sent; otherwise 200 `{ success, count, failures: [{ index, error }] }`, each message not sent named by its position with a fixed text, and the request token reaching the provider. The Azure provider splits by size (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#SendInBatchesAsync`) and refuses a message too large for an empty batch by its position. What was sent stays sent: once a batch was accepted, the caller's cancellation and a broker failure end the send in that result rather than an error, unlike delete, resubmit and move. The topic route did not exist before, so importing into a topic always failed. Pinned by `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs#A_batch_send_to_a_queue_or_a_topic_reaches_the_provider_and_answers_the_count_sent_and_each_failure`, `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs#A_batch_send_outside_1_to_1000_messages_is_refused_with_400_before_the_provider_is_called` , `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSendBatchTests.cs#The_broker_failing_on_the_second_batch_returns_the_count_sent_so_far_and_each_message_not_sent_without_its_text` and, for RabbitMQ, which checks the token before every publish, `src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQSendBatchTests.cs#A_publish_failing_after_the_first_returns_the_count_published_the_failing_message_as_possibly_sent_and_the_rest_as_not_sent` and `src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQSendBatchTests.cs#A_token_cancelled_before_the_first_publish_publishes_nothing_and_propagates`. The import dialog sends a file in requests of 1000 and stops at the first that is not whole, saying how many were sent and not (`web-app/src/app/features/messages/import-messages-dialog.component.ts#finishImport`).
