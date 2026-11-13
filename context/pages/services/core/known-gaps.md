---
title: "Core: Hot spots and known gaps of the Azure provider"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Core service page"
page_type: service
status: active
description: "Read when a change touches a hot spot of Core, or a gap of the Azure provider recorded as it was found."
source:
  - src/ServiceBusExplorer.Core/
  - src/ServiceBusExplorer.Core.Tests/
  - src/ServiceBusExplorer.IntegrationTests/
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs
  - src/ServiceBusExplorer.Api.Tests/ApiFactory.cs
reliability: high
---

# Core: Hot spots and known gaps of the Azure provider

One topic of [[pages/services/core|Core]]; the map lists the others.

## Hot spots

- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DeleteMessagesCoreAsync` - 2382 lines; `DeleteMessagesCoreAsync`, `ResubmitCoreAsync` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ResubmitCoreAsync`) and `MoveCoreAsync` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#MoveCoreAsync`) repeat one scan loop three times with small differences; a fix to one belongs in all three.
- `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs#GetMessagesAsync` - 1193 lines of HTTP plumbing and response DTOs; `GetMessagesAsync` with `ack_requeue_false` is the destructive read every RabbitMQ bulk call relies on.
- `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync` - 1150 lines; the three bulk methods (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeleteMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#ResubmitDeadLetterMessagesAsync`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#MoveMessagesAsync`) are the least safe code in the library.
- `src/ServiceBusExplorer.Core/Services/ServiceBusService.cs#ServiceBusService` - 780 lines of legacy code that is effectively unused.
- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#SaveConnectionAsync` - the one write path that stores a connection a caller sent (`ClearAllAsync` only empties the file) and the place masking rules meet persistence.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#TryPurgeServerSideAsync` - reflection call to an internal SDK method; breaks silently to the slow drain when the SDK changes.

## Known gaps

Each item was read in the working tree on 2026-11-12 (branch `fix/dlq-bulk-operations`, uncommitted changes included).

- **The Azure provider loses a message on a resubmit or a move into an entity with duplicate detection.** The copy keeps the original `MessageId`; inside the detection window the broker accepts and drops it, the source is completed, and the result reports success. Reproduced on the emulator (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs#Defect_resubmit_into_a_queue_with_duplicate_detection_reports_success_and_the_message_is_gone`).
- **A selective delete or move on an active Azure entity dead-letters messages the user did not select.** The scan abandons the non-targets, which raises their delivery count; with a low `MaxDeliveryCount` they reach the dead-letter queue while the result reports success. Reproduced on the emulator (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs#Defect_selective_delete_on_an_active_queue_with_a_low_max_delivery_count_dead_letters_the_unselected_messages`).
- **A queue with auto-forwarding cannot be peeked.** The broker refuses a message browser on an entity that forwards; the peek fails and nothing explains it. Found by hand on 2026-11-12, no test ([[pages/roadmap/followups]]).
- **A cancel that mixes in a number that is not scheduled cancels none on the emulator** and fails every number, where the fallback is written to fail only that number (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#CancelEachScheduledAsync`, `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs#Defect_a_cancel_where_one_number_is_not_scheduled_cancels_none_on_the_emulator_and_fails_every_number`). Real Azure was not verified.
- **The scan of a bulk call does not reach deep, and can leave prefetched messages locked after it returns.** Measured on the emulator on 2026-11-13, a real namespace not tried. The PeekLock receiver of delete, resubmit and move prefetches 250 messages (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ScanPrefetchCount`), receives from the head and abandons what it does not send; an abandoned message is delivered again first, so the scan gets past the head only through the prefetch lookahead. On a fresh dead-letter queue of 800, one message 300 or 600 deep is reported "Not found within scan window", nothing sent and nothing removed (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs#Defect_a_resubmit_of_one_message_300_deep_in_a_dead_letter_queue_of_800_reports_it_not_found`). The protocol of the web run is pinned too: of 800 dead letters whose first 300 have the reason `skip`, paging from a cursor without bodies and resubmitting the other 500 resubmitted none of them, each reported not found, and every message stayed where its outcome said, none lost and none duplicated (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs#Defect_resubmitting_the_500_behind_300_skipped_dead_letters_by_cursor_is_stopped_by_the_scan_wall_and_loses_nothing`). Without prefetch it is worse: a resubmit of the first 100 of 2,000 found 16. The receiver is disposed once its targets are found and the messages in its prefetch buffer stay locked until their lock expires: a resubmit of the next 100 made at once after the first 100 (30 s lock) reported all of them not found in one run and found all of them in another, so it has no test. The first bulk call on a client that had not received yet came back empty twice and gave up. The single resubmit prefetches 50 and has the same exposure. This bounds the automatic resubmit of the web app, which calls resubmit-batch a batch at a time. A fix holds the locks of the messages a call does not send until a bounded scan ends, which changes the bounded-scan decision; it is the owner's to decide.
- **Comment disagrees with code.** The single resubmit comment says "Use ReceiveAndDelete mode" (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ResubmitDeadLetterMessageAsync`); the receiver is PeekLock (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ResubmitDeadLetterMessageAsync`). The same method sends first (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ResubmitDeadLetterMessageAsync`) and, if it cannot find the original within five receive attempts, returns without error (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#maxReceiveAttempts`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#ResubmitDeadLetterMessageAsync`), so a duplicate there is silent, unlike the batch path. Reproduced against the emulator on 2026-11-12: the last of 350 dead-lettered messages is sent and stays in the dead-letter queue, with no error (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs#Defect_single_resubmit_of_a_message_deep_in_the_dead_letter_queue_sends_it_and_leaves_it_there`).
