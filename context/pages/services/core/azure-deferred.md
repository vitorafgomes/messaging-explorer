---
title: "Core: Azure deferred messages"
version: "1.0"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.0: delete, resubmit and dead-letter of deferred messages by sequence number; SupportsDeferral true for Azure"
page_type: service
status: active
description: "Read when a change touches the delete, resubmit or dead-letter of a deferred message on Azure, SupportsDeferral, or how a deferred message is received by its sequence number."
source:
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureProviderCapabilities.cs
  - src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs
  - src/ServiceBusExplorer.Core/Models/DeferredBatchRequest.cs
  - src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs
  - src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs
reliability: high
---

# Core: Azure deferred messages

One topic of [[pages/services/core|Core]]; the routes are on [[pages/services/api/routes-entities-and-messages]].

## What it does

A deferred message stays in the active queue of its entity and is received only by its sequence number (`ServiceBusReceiver.ReceiveDeferredMessagesAsync`); a peek lists it with the state `Deferred`. Since 2026-11-14 three members of `IMessagingProvider` handle it, on a queue and on a subscription:

- `DeleteDeferredMessagesAsync` receives and completes (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeleteDeferredMessagesAsync`).
- `ResubmitDeferredMessagesAsync` sends a copy to the queue, or to the topic of a subscription, then completes the deferred message (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ResubmitDeferredMessagesAsync`). The copy is active, not deferred. From a subscription it goes through the topic, so every subscription whose filter matches gets it, as the dead-letter resubmit does.
- `DeadLetterDeferredMessagesAsync` dead-letters with the caller's reason and description, "Manual dead letter" and "Moved to dead letter by user" when absent (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeadLetterDeferredMessagesAsync`).

`SupportsDeferral` is true for Azure (`src/ServiceBusExplorer.Core/Providers/Azure/AzureProviderCapabilities.cs#SupportsDeferral`) and false for RabbitMQ, which refuses the three with `NotSupportedException` and the text "RabbitMQ does not support deferred messages." (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeferralNotSupported`). Nothing in the application defers a message.

## How it is held to the bulk rule

[[pages/invariants/bulk-operations-are-at-least-once]] applies.

- **Bounded.** 1 to 1000 sequence numbers (`src/ServiceBusExplorer.Core/Models/DeferredBatchRequest.cs#MaxSequenceNumbers`), each positive, none repeated, checked before any broker call (`src/ServiceBusExplorer.Core/Providers/Azure/EntityConfigurationValidator.cs#ValidateScheduledSequenceNumbers`, which takes the bound as a parameter). No scan: each message is named.
- **In batches.** `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#SettleDeferredCoreAsync` receives 100 numbers in one broker call and settles them before it receives the next 100, so no lock ages across the selection. The caller's token is checked before each batch, handed to the SDK, and propagates.
- **Never skipped.** The broker refuses a whole receive when one number is not a deferred message; only then is each number of the batch received on its own (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ReceiveDeferredAsync`). A number with no message, refused or simply not answered, is a failure "Not found as a deferred message." (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#NotDeferredError`). An active message named by its number is reported so and stays active (emulator, below).
- **Send first.** The resubmit sends through `SendOrReportDuplicatesAsync` and completes through `CompleteResubmittedAsync`, the helpers of the dead-letter resubmit, with its own fixed duplicate text "Message was resubmitted but could not be removed from the deferred messages and may be duplicated on retry." (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeferredDuplicateError`), with no broker text. A send that fails reports each message handed to it as a possible duplicate, never as nothing done, and completes nothing; a possible duplicate is never sent again. Pinned by `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs#A_deferred_resubmit_whose_send_fails_reports_each_message_handed_to_the_send_as_a_possible_duplicate_completes_nothing_and_carries_no_broker_text`.
- **Checks before the receive.** The resubmit runs `CheckBeforeScanAsync` with no sub-queue (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#CheckBeforeScanAsync`): only the target's duplicate detection is read, since a receive by number receives no unselected message; the duplicate refusal and the `newMessageIdOnDuplicateDetection` opt-in are those of [[pages/services/core/azure-bulk-safety-checks]]. Delete and dead-letter read no setting, so they need no Manage right.
- **Failures in fixed text.** A complete or dead-letter that fails is "The broker did not remove this deferred message." or "The broker did not dead-letter this deferred message."; a receive that fails stops the call and every number without an outcome is "Nothing was done to this deferred message: the call stopped on a broker failure.", the outcomes of the batches before it kept (`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs#A_deferred_call_whose_second_batch_fails_keeps_what_the_first_settled_and_reports_the_rest_without_a_second_receive`); a message received and not settled keeps its deferred state once its lock expires. No broker text is in the result; the causes are logged in one warning per call.
- **A disabled entity** before anything was sent or removed throws `EntityDisabledException`; found later, the numbers without an outcome fail with "The entity is disabled for this operation.".

## Routes

`POST api/queues/{name}/deferred/delete-batch`, `.../deferred/resubmit-batch`, `.../deferred/deadletter-batch`, and the same under `api/topics/{topic}/subscriptions/{subscription}` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#DeleteDeferredMessages`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs#DeleteDeferredMessages`), take one body `{ sequenceNumbers, newMessageIdOnDuplicateDetection?, reason?, description? }` (`src/ServiceBusExplorer.Core/Models/DeferredBatchRequest.cs#DeferredBatchRequest`) and answer the result in the delete-batch shape, through `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs#DeferredBatch`: 400 "This provider does not support deferred messages." without `SupportsDeferral` and 400 "sequenceNumbers must hold 1 to 1000 sequence numbers.", both before the provider is called; 400 with the provider's refusal text; 409 for a disabled entity; the constant 500 otherwise. The request token reaches the provider; the key middleware covers them like every route. Pinned in `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs`: `A_deferred_batch_route_hands_the_provider_the_entity_the_numbers_and_the_request_token_and_answers_the_result_per_sequence_number`, `A_deferred_batch_above_1000_or_without_a_number_answers_400_naming_the_field_and_is_never_called`, `A_provider_without_deferral_answers_400_to_a_deferred_batch_and_is_never_called`, `A_deferred_batch_on_a_disabled_entity_answers_409_with_the_fixed_text`, `A_deferred_batch_that_fails_for_another_reason_answers_the_constant_500_and_nothing_of_the_broker`, `A_deferred_batch_without_the_api_key_is_refused_with_401`.

## Tests

- Unit, `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs`: `Deferred_messages_are_received_by_sequence_number_from_the_active_queue_in_one_call_and_each_is_settled`, `A_sequence_number_that_is_not_a_deferred_message_is_reported_not_found_as_a_deferred_message_and_the_others_are_still_handled`, `A_deferred_number_the_broker_answers_without_a_message_is_reported_not_found_as_a_deferred_message`, `A_receive_of_deferred_messages_that_fails_reports_every_number_with_the_fixed_text_and_settles_nothing`, `A_deferred_resubmit_sends_the_copies_before_it_completes_the_deferred_messages`, `A_deferred_resubmit_whose_complete_fails_after_the_send_reports_a_possible_duplicate_and_never_sends_again`, `A_deferred_resubmit_into_a_target_that_detects_duplicates_is_refused_and_receives_nothing`, `A_deferred_dead_letter_writes_the_reason_and_description_and_a_failing_one_is_reported_with_the_fixed_text`, `A_deferred_delete_whose_complete_fails_reports_that_number_with_the_fixed_text_and_no_broker_text`, `A_deferred_call_on_an_entity_disabled_before_anything_was_done_throws_the_neutral_exception`, `A_deferred_call_above_1000_sequence_numbers_is_refused_naming_the_field_before_the_broker_is_called`, `A_deferred_call_of_1000_numbers_reaches_the_broker_in_batches_of_100`, `The_caller_token_stops_a_deferred_call_before_the_next_batch_is_received`, `Azure_declares_the_transfer_dead_letter_queue_and_deferral`; RabbitMQ `src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQSubQueueTests.cs#RabbitMQ_declares_no_deferral_and_refuses_each_deferred_operation_with_the_fixed_text`.
- Emulator, `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs`: a message deferred by a receiver of the test is deleted (`A_deferred_message_deleted_by_its_sequence_number_is_gone_and_the_other_stays_deferred`), resubmitted and active again once (`A_deferred_message_resubmitted_by_its_sequence_number_is_active_again_once_and_no_longer_deferred`), dead-lettered with its reason (`A_deferred_message_dead_lettered_by_its_sequence_number_is_in_the_dead_letter_queue_with_the_reason`); a call naming an active message and a missing number reports both not found and leaves the active one in place (`A_deferred_call_naming_an_active_message_and_a_missing_number_reports_both_not_found_as_deferred_and_handles_the_deferred_one`). Real Azure was not verified.

## Not done

Deferring a message from the application and a listing of deferred messages from the broker (they are found by the peek) ([[pages/roadmap/followups]]). The screens are built since 2026-11-14 ([[pages/services/web-app/bulk-deferred-messages]]).
