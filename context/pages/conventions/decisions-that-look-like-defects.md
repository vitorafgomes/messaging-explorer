---
title: "Decisions that look like defects"
version: "1.0"
date: 2026-11-12
changes: "2026-11-13: the monitoring history count. Founded on 2026-11-12 with the entries the founding survey could back with a test"
page_type: established-patterns
status: active
description: "Behaviour in Messaging Explorer that reads as a bug and is intended: what it is, why it is right, where it lives and the test that locks it. A reviewer checks this page before reporting."
updated: 2026-11-13
source:
  - "src/ServiceBusExplorer.Api/Program.cs"
  - "src/ServiceBusExplorer.Api.Tests/"
  - "src/ServiceBusExplorer.Core.Tests/"
reliability: medium
---

# Decisions that look like defects

> Behaviour that reads as a bug and is intended. Check here before reporting a finding; add an entry when a finding is answered "not a defect", in the change that answers it.

An entry is a claim about the code today: when the code under it changes, the entry is checked again, and an entry with no test behind it is weaker than one with a test. **Not on this page:** a limitation that is real and accepted for now. Those are the "Known gaps" of each service page and [[pages/roadmap/followups]]. Most of what the founding survey found belongs there, not here.

## API

- **`/health` answers without the API key.** The Electron shell and a developer need to know the process is up before a key exchange is possible; the route returns a constant. `src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`, locked by `src/ServiceBusExplorer.Api.Tests/AuthMiddlewareTests.cs#Health_endpoint_is_public`.
- **`OPTIONS` passes the key middleware.** A CORS preflight never carries custom headers; the CORS middleware before it decides, and the real request still needs the key. `src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`, locked by `src/ServiceBusExplorer.Api.Tests/CorsTests.cs#Preflight_from_configured_frontend_is_allowed`.
- **An export with `includeSecrets=true` returns raw secrets.** It is the user's backup of their own connections, asked for explicitly, and it logs a warning. `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ExportConfiguration`, locked by `src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#Export_with_includeSecrets_true_returns_raw`.
- **`MonitoringStore.GetHistory` throws on a negative count.** Its one caller clamps the query to 1 to 120 before the call (`src/ServiceBusExplorer.Api/Controllers/MonitoringController.cs#GetHistory`), so `GET /api/monitoring/history?count=-5` answers the history; the store is not guarded twice. Locked by `src/ServiceBusExplorer.Api.Tests/MonitoringControllerTests.cs#A_history_count_below_one_answers_the_history_instead_of_failing_the_request` (2026-11-13). A second caller of the store needs its own clamp.
- **Enums travel as strings.** The Angular client sends `"AzureServiceBus"`, not `0`. `src/ServiceBusExplorer.Api/Program.cs#options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());`.

## Bulk operations

- **A bulk operation can report a possible duplicate and still be correct.** Operations are at-least-once by design ([[pages/invariants/bulk-operations-are-at-least-once]]); the alternative is completing before the send, which can lose the message. Locked by `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs#ResubmitCore_records_duplicate_warning_and_does_not_resend_on_complete_failure`.
- **A selected message can come back "Not found within scan window".** The scan is bounded on purpose; an unbounded scan of a large dead-letter queue holds locks until they expire. Measured on the emulator on 2026-11-13, the bound is shallow: the scan receives from the head and abandons what it does not send, an abandoned message is delivered again first, so it gets past the head only through its 250-message prefetch, about 250 to 500 messages deep; and right after one call, the next call's targets can come back not found until the previous call's prefetched messages are released. Not yet measured on a real namespace. A change to the scan supersedes this decision and needs an ADR ([[pages/roadmap/followups]]). Locked by `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs#DeleteMessagesCore_reports_not_found_for_target_beyond_window_and_terminates`.
- **An empty selection returns an empty result, not an error.** Locked by `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs#DeleteMessages_and_Resubmit_with_empty_input_return_empty_without_throw`.

## RabbitMQ

- **Every session operation throws `NotSupportedException`.** RabbitMQ has no sessions: since 2026-11-13 the list, the detail, the messages of one session and the state write all refuse, where the list used to answer empty, and `SupportsSessions` is false, so the API answers 400 without calling the provider. Locked by `src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQSessionTests.cs#RabbitMQ_refuses_the_session_list_detail_messages_and_state_write` and `src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQSessionTests.cs#RabbitMQ_declares_no_sessions`. Whether the UI hides the feature through a capability flag is a separate question on [[pages/invariants/provider-boundaries]].
