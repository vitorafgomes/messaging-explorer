---
title: "Core: Azure single-message actions"
version: "1.0"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.0: dead-letter and defer of an active message by its sequence number, through the bounded scan of the selective delete"
page_type: service
status: active
description: "Read when a change touches the dead-letter or the defer of an active message by its sequence number on Azure, SupportsManualDeadLetter, or the delete of one message from the detail pane."
source:
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs
  - src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs
  - src/ServiceBusExplorer.Core/Abstractions/IProviderCapabilities.cs
  - src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs
  - src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs
reliability: high
---

# Core: Azure single-message actions

One topic of [[pages/services/core|Core]]; the routes are on [[pages/services/api/routes-single-message-actions]] and the screen on [[pages/services/web-app/features-message-detail-actions]].

## What it does

Two members of `IMessagingProvider` act on active messages, each named by its sequence number, on a queue or a subscription:

- `DeadLetterMessagesAsync` dead-letters with the caller's reason and description, "Manual dead letter" and "Moved to dead letter by user" when absent (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeadLetterMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DefaultDeadLetterReason`).
- `DeferMessagesAsync` defers; the message then leaves the active messages and is reached only by its number, as on [[pages/services/core/azure-deferred]] (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeferMessagesAsync`).

The web app calls them with one number, from the detail of one message. The receive-and-delete of one message is not a member of its own: it is the selective delete, `DeleteMessagesAsync` with that one number ([[pages/services/core/azure-bulk-operations]]). Abandon is not offered: in an application that only peeks, an abandon would raise the delivery count of a message and do nothing else.

## How a message is reached

The broker locks a message only as it hands it out, and an active message cannot be received by its number. Both members therefore run the scan of the selective delete, through `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#SettleActiveAsync`:

- **Checks before the receive.** `CheckBeforeScanAsync` on the active sub-queue with no target (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#CheckBeforeScanAsync`): it reads `MaxDeliveryCount` and refuses the call when one receive would dead-letter a fresh message, or when the settings cannot be read, before anything is received ([[pages/services/core/azure-bulk-safety-checks]]).
- **The scan.** A PeekLock receiver from the head (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeadLetterActiveCoreAsync`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeferActiveCoreAsync`), both over `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeleteMessagesCoreAsync` with the settle swapped in. A target is dead-lettered or deferred; every unselected message is abandoned at once and counted in `UnselectedDeliveryCountRaised`, and one that reached its limit is listed in `UnselectedDeadLettered` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#RecordReleases`).
- **Delivery-limit stop.** The scan stops before it would receive again an unselected message whose next delivery reaches the limit; each target not yet reached is reported with the delivery-limit text.
- **Never skipped.** A number the scan did not find is reported "Not found within scan window", never left out.
- **Fixed failure texts.** A dead-letter or a defer the broker refuses is reported for its number as "The broker did not dead-letter this message." or "The broker did not defer this message." (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ActiveNotDeadLetteredError`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ActiveNotDeferredError`), never with the broker's text.
- **Token and timeout** are those of the selective delete: the caller's token stops the scan and propagates; the safety timeout ends it with a partial result.

The scan's reach and its limits are those of the delete; see the scan entries on [[pages/services/core/known-gaps]].

## Capabilities

`SupportsManualDeadLetter` declares the dead-letter of an active message, true for Azure (`src/ServiceBusExplorer.Core/Providers/Azure/AzureProviderCapabilities.cs#SupportsManualDeadLetter`); the defer is declared by `SupportsDeferral`. RabbitMQ declares neither (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProviderCapabilities.cs#SupportsManualDeadLetter`) and refuses both with `NotSupportedException`: "RabbitMQ does not support dead-lettering a message by sequence number." (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeadLetterMessagesAsync`) and the deferral text of `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeferralNotSupported`.

## Tests

Unit, `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs`: `A_single_active_dead_letter_dead_letters_only_its_message_with_the_reason_and_abandons_the_others`, `A_single_active_defer_defers_only_its_message_and_removes_nothing`, `A_dead_letter_without_a_reason_writes_the_default_reason_and_description`, `A_dead_letter_or_defer_the_broker_refuses_is_reported_for_its_sequence_number_with_a_fixed_text`, `A_dead_letter_or_defer_of_a_message_not_in_the_scan_window_is_reported_not_found_never_silently`, `A_dead_letter_or_defer_stops_before_an_unselected_message_reaches_its_max_delivery_count`, `A_dead_letter_or_defer_on_an_entity_with_a_max_delivery_count_of_1_or_unreadable_settings_is_refused_before_any_receive`. No emulator test reaches these members yet.

## Known gaps

On a session-enabled queue or subscription the scan uses a non-session receiver and the broker refuses it, so the call fails ([[pages/services/core/known-gaps]]).
