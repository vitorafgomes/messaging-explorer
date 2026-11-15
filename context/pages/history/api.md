---
title: "Api history"
version: "1.1"
date: 2026-11-13
updated: 2026-11-14
changes: "v1.1: dated entries above the version notes"
page_type: reference
status: active
description: "What changed in the Api project and when, newest first, as the service page header recorded it until 2026-11-13."
source:
  - context/pages/services/api.md
reliability: high
---

# Api history

What changed when in the project [[pages/services/api|Api]] describes, newest first.

## 2026-11-15

- `POST api/connections/test` of a stored connection tests with its stored secret when the dialog sends the mask; it always failed before ([[pages/services/api/connections-and-secrets]]). Found in the owner's hand test.
- `GET api/connections` and `GET api/connections/{id}` carry the endpoint host of a connection string as `namespace`, so the list shows its target ([[pages/services/api/connections-and-secrets]]).

## 2026-11-14

- `messages/deadletter-batch` and `messages/defer-batch` on queues and subscriptions, and `bodyEncoding` on the send routes ([[pages/services/api/routes-single-message-actions]]); an import-full with a resource ID out of format is refused before anything is stored, pinned by `src/ServiceBusExplorer.Api.Tests/ConnectionFailureLogTests.cs#An_import_full_with_one_resource_id_out_of_format_is_refused_with_the_fixed_text_and_imports_no_group_and_no_connection`.
- **`GET /api/metrics/connections/{id}`** answers the namespace metrics of a stored connection, 409 or 502 with a fixed `message` and a `code`, the constant 500 otherwise (`src/ServiceBusExplorer.Api/Controllers/MetricsController.cs#GetNamespaceMetrics`); a connection save or import refuses an Azure resource ID out of format with `ResourceIdRefusal`. [[pages/services/api/monitoring]].
- **`POST api/topics/{name}/messages/cancel-scheduled`**, sharing `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#CancelScheduled` with the queue route; the send routes answer `sequenceNumber`. [[pages/services/api/routes-entities-and-messages]].
- **A proxy is refused on every save and on `import-full` before anything is stored.** `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection` answers 400 with the fixed `src/ServiceBusExplorer.Core/Models/ServiceBusConnection.cs#ProxyRefusal` before the connection test, for every provider; a RabbitMQ connection carries no proxy. `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ImportFullConfiguration` checks every connection before the first group and imports nothing; it used to save the groups and answer the constant 500. The abandoned namespace properties read is pinned by `src/ServiceBusExplorer.Api.Tests/SessionCancelTests.cs#A_namespace_properties_read_the_caller_abandons_reaches_the_provider_cancelled_and_logs_no_error` ([[pages/services/api/connections-and-secrets]]).
- **`GET api/namespace/properties`** answers the connected namespace's tier, units, alias, times and largest message, with the request token (`src/ServiceBusExplorer.Api/Controllers/NamespaceController.cs#Properties`); 400 with "This provider has no namespace properties." for RabbitMQ, the constant 500 on a failed read. The capabilities answer carries `supportsNamespaceProperties`.
- **A transport or proxy edit is tested before it is saved.** The metadata-only check of `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection` compares `UseWebSockets` and `ProxyAddress`, null and empty alike; pinned by `src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#An_edit_that_changes_only_the_transport_or_the_proxy_is_tested_before_it_is_saved` ([[pages/services/api/connections-and-secrets]]).

- **The active peek pages and deferred messages have routes.** `GET .../messages` of a queue and a subscription takes `fromSequenceNumber` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#PeekMessages`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#PeekMessages`); `PeekPosition` names the queue or the dead-letter queue in its refusal. `POST .../deferred/delete-batch`, `resubmit-batch` and `deadletter-batch` on queues and subscriptions (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#DeferredBatch`); the capabilities answer `supportsDeferral: true` for Azure. [[pages/services/core/azure-deferred]].

- The single resubmit routes of a queue and a subscription take an optional body `ResubmitMessageRequest` with `newMessageIdOnDuplicateDetection` (default false, no body allowed) and answer a refused resubmit with 400 and the fixed text (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#ResubmitDeadLetterMessage`, `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs#A_refused_single_resubmit_answers_400_with_the_fixed_refusal_text`). [[pages/services/api/routes-entities-and-messages]].
- The resubmit-batch and move-batch routes accept an optional `newMessageIdOnDuplicateDetection` (default false) and hand it to the provider; every batch result carries `newMessageIds`, `unselectedDeliveryCountRaised` and `unselectedDeadLettered` (`src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs#A_resubmit_or_move_batch_hands_the_provider_the_new_message_id_choice_and_leaves_it_off_when_the_body_omits_it`).
- `POST topics/{name}/messages/batch` added; both batch routes take 1 to 1000 messages (400 otherwise), pass the request token and answer `{ success, count, failures[{index,error}] }`, `count` being the number actually sent (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#SendBatch`). `supportsTransactions` is false for both providers.
- **2026-11-14** `POST connections/{id}/connect` answers a failed connect with a reason it could classify: 500 `{message, code}`, `code` one of `connection-refused`, `host-not-found`, `timeout`, `tls`, each with a fixed sentence, read from the BCL exceptions in the chain (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ConnectFailureReason`); any other failure keeps `{message:"An internal error occurred."}`. The exception text never reaches the body (`src/ServiceBusExplorer.Api.Tests/ConnectFailureReasonTests.cs#A_failed_connect_answers_its_reason_as_a_fixed_code_and_sentence_and_never_the_exception_text`). Additive.
- A session read the caller abandoned no longer answers 500 and writes an error log: `src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#Run` ends it with no body when the request token fired. Before, each List again, change of entity or 10-second cut of the web app's session listing logged up to four errors with a stack trace.
- **2026-11-14** `POST namespace/export` answers `source`, the connection target, never the connection string; the dry run's items carry `differences: [{ field, current, inFile }]` beside `differingFields`. Additive.
- **2026-11-14** `GET topics/{name}` answers `subscriptions[].status` and `subscriptions[].ruleCount` and passes the request token to the read.
- **2026-11-14** `POST connections/import/preview`, a dry run of the import that writes nothing and carries no secret; an edit save keeps a masked client secret; connect records its last use through `MarkUsedAsync` and survives a failed write.

## Version notes until 2026-11-13

The `changes` field of the service page header as it stood when the page became a map, cut at each "Earlier", in its words.

- 2026-11-13: the four dead-letter and transfer dead-letter peek routes take an optional includeBody, false answering each message with body null, anything but true or false refused with 400.
- Earlier on 2026-11-13: the four dead-letter and transfer dead-letter peek routes take an optional fromSequenceNumber, refused with 400 when it is not a whole number of 0 or more or the provider cannot read from a position; the capabilities answer carries supportsPeekFromSequenceNumber.
- Earlier on 2026-11-13: the session detail takes messageCount and answers messages under one accept; eight session routes under the queue and subscription bases replace api/sessions; the list locks nothing; state and expectedState both required; a disabled entity answers 409; SessionRouteTests added. 2026-11-12: entity names in the path are decoded once from the raw target by RawTargetRouteValuesAttribute; EntityNameRoutingTests added.
- Earlier: one exception handler answers a constant 500 in every environment; every 500 body is {message}; import never returns an exception message; the Host filter and the API_SECRET fail-fast are pinned by tests; four Known gaps closed; ErrorBodyTests and BoundaryGuardTests added; also on 2026-11-13: 2026-11-13: POST api/namespace/export and POST api/namespace/import (dryRun, a 10 MB body bound, fixed bodies) and supportsDefinitions in the capabilities answer; DefinitionsRouteTests added.
- Earlier on 2026-11-13: the session detail takes messageCount and answers messages under one accept; eight session routes under the queue and subscription bases replace api/sessions; the list locks nothing; state and expectedState both required; a disabled entity answers 409; SessionRouteTests added. 2026-11-12: entity names in the path are decoded once from the raw target by RawTargetRouteValuesAttribute; EntityNameRoutingTests added.
- Earlier: one exception handler answers a constant 500 in every environment; every 500 body is {message}; import never returns an exception message; the Host filter and the API_SECRET fail-fast are pinned by tests; four Known gaps closed; ErrorBodyTests and BoundaryGuardTests added; also on 2026-11-13: 2026-11-13: monitoring polls on a configured period with a 30-second floor and a one-hour ceiling, skips a tick while the previous poll runs, lists subscriptions four topics at a time, carries the transfer dead-letter count and null for a count that is not counted, answers its snapshot with the period and the last failed poll; GET api/monitoring/counts reads one queue or subscription now; MonitoringBackgroundServiceTests added.
- Earlier on 2026-11-13: the session detail takes messageCount and answers messages under one accept; eight session routes under the queue and subscription bases replace api/sessions; the list locks nothing; state and expectedState both required; a disabled entity answers 409; SessionRouteTests added. 2026-11-12: entity names in the path are decoded once from the raw target by RawTargetRouteValuesAttribute; EntityNameRoutingTests added.
- Earlier: one exception handler answers a constant 500 in every environment; every 500 body is {message}; import never returns an exception message; the Host filter and the API_SECRET fail-fast are pinned by tests; four Known gaps closed; ErrorBodyTests and BoundaryGuardTests added
