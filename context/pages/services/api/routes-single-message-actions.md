---
title: "Api: Single-message actions and binary bodies"
version: "1.0"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.0: the deadletter-batch and defer-batch routes of active messages, the bodyEncoding checks on send, the two capability fields"
page_type: service
status: active
description: "Read when a change touches messages/deadletter-batch or messages/defer-batch on a queue or a subscription, the bodyEncoding of a send, or supportsManualDeadLetter and supportsBinaryBody in the capabilities answer."
source:
  - src/ServiceBusExplorer.Api/Controllers/QueuesController.cs
  - src/ServiceBusExplorer.Api/Controllers/TopicsController.cs
  - src/ServiceBusExplorer.Api/Controllers/EntityAdministrationResults.cs
  - src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs
  - src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs
reliability: high
---

# Api: Single-message actions and binary bodies

One topic of [[pages/services/api|Api]]; the provider side is on [[pages/services/core/azure-single-message-actions]] and [[pages/services/core/message-bodies]].

## Dead-letter and defer of active messages

`POST api/queues/{name}/messages/deadletter-batch` and `POST api/queues/{name}/messages/defer-batch`, and the same under `api/topics/{topic}/subscriptions/{subscription}` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#DeadLetterMessages`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#DeferMessages`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#DeadLetterMessages`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#DeferMessages`), take the body of the deferred routes, `{ sequenceNumbers, reason?, description? }` (`src/ServiceBusExplorer.Core/Models/DeferredBatchRequest.cs#DeferredBatchRequest`), and answer the result per sequence number in the delete-batch shape. The four share `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ActiveBatch`:

- **400, capability.** Before the provider is called: "This provider does not support dead-lettering a message by sequence number." without `SupportsManualDeadLetter` (`src/ServiceBusExplorer.Api/Controllers/EntityAdministrationResults.cs#ManualDeadLetterNotSupported`), "This provider does not support deferred messages." without `SupportsDeferral` (`src/ServiceBusExplorer.Api/Controllers/EntityAdministrationResults.cs#DeferralNotSupported`).
- **400, count.** "sequenceNumbers must hold 1 to 1000 sequence numbers." for none or more than 1000, before the provider is called.
- **200** with the result, refusals included: a number not found, the delivery-limit stop and a settle the broker refused are failures of the result, not error codes. The request token reaches the provider.
- **409** "The entity is disabled for this operation." for a disabled entity.
- **500**, the constant `{ "message": "An internal error occurred." }` for anything else, the cause logged.
- **401** without the `X-Api-Key`, as on every route.

Pinned in `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs`: `An_active_dead_letter_or_defer_route_hands_the_provider_the_entity_the_numbers_and_the_request_token_and_answers_the_result_per_sequence_number`, `An_active_dead_letter_hands_the_provider_the_reason_and_the_description`, `A_provider_that_declares_no_dead_letter_or_deferral_answers_400_to_an_active_settle_and_is_never_called`, `An_active_settle_above_1000_or_without_a_number_answers_400_and_is_never_called`, `An_active_settle_on_a_disabled_entity_answers_409_and_another_failure_the_constant_500`, `An_active_settle_without_the_api_key_is_refused_with_401`. Removing the capability check of `ActiveBatch` fails the third on its four routes.

The delete of one message has no route of its own: the web app calls `messages/delete-batch` with one number and `all: false` ([[pages/services/api/routes-entities-and-messages]]).

## bodyEncoding on send

The single send and the batch send of a queue and of a topic carry `bodyEncoding` on each message, `text` (or absent) or `base64` (`src/ServiceBusExplorer.Core/Models/SendMessageRequest.cs#BodyEncoding`). `src/ServiceBusExplorer.Api/Controllers/EntityAdministrationResults.cs#BodyNotAccepted` checks every message before the provider is called and answers 400 with the first refusal:

- "bodyEncoding must be text or base64." for any other value;
- "This provider does not support a binary body." for `base64` to a provider without `SupportsBinaryBody`, so a base64 body is never sent as its text;
- "A base64 body must be valid base64." for a body that does not decode.

The peek, search and receive answers carry `bodyEncoding` beside `body`. Pinned in `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs`: `A_base64_body_reaches_the_provider_with_its_flag_on_a_provider_that_declares_binary_bodies`, `A_base64_body_to_a_provider_without_binary_bodies_answers_400_and_is_never_sent`, `A_body_with_an_unknown_encoding_or_invalid_base64_answers_400_and_is_never_sent`, `A_peeked_binary_body_reaches_the_web_app_with_its_base64_flag`. Removing the capability check fails the second on the four send routes.

## Capabilities

`GET api/connections/providers/{providerType}/capabilities` carries `supportsManualDeadLetter` and `supportsBinaryBody` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#GetProviderCapabilities`): true for Azure, false for RabbitMQ. The web app shows the dead-letter action and the base64 choice only when the field is `true`. No route test reads these two fields yet.
