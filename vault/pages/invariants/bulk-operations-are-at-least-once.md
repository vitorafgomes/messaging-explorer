---
title: "Bulk operations are at-least-once"
version: "1.3"
date: 2026-11-12
changes: "v1.3 (2026-11-12): the cancel of scheduled messages is covered, a disabled entity found midway is reported per message and never retried, and the limit of the disabled-entity exception is stated; every enforcement point re-read after the sub-queue change. v1.2 (2026-11-12): two Azure loss modes reproduced on the emulator are known exceptions; the invariant no longer claims to hold for Azure. v1.1 (2026-11-12): the RabbitMQ exception names the three loss modes reproduced in a container and cites the tests that pin them. v1.0 founded from the code"
page_type: invariant
status: active
description: "A bulk delete, resubmit, move, purge or cancel of scheduled messages never loses a message silently: send first, complete after; a message sent but not removed from its source is reported as a possible duplicate; failures are reported per sequence number; scans are bounded; the caller's token stops the batch."
updated: 2026-11-12
enforced_by:
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1773"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1886"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2093"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1422"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1611"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2104"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2160"
  - "src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:375"
verified_by:
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:162"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:196"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:347"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:467"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs:364"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs:460"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs:524"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs:551"
source:
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs"
  - "src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs"
  - "src/ServiceBusExplorer.Core/Models/BatchOperationResult.cs"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs"
  - "src/ServiceBusExplorer.Core/Abstractions/EntityAdministrationExceptions.cs"
  - "CHANGELOG.md"
reliability: high
---

# Bulk operations are at-least-once

> A message the user selected is, after the operation, in exactly one of three states the result names: done, failed with its sequence number and reason, or possibly duplicated. It is never gone without a word. Rule H of root `CLAUDE.md`.

## Why this exists

Version 2.3.0 fixed dead-letter bulk delete and resubmit losing and duplicating messages: the whole selection was scanned while earlier messages sat under a PeekLock that expired (`CHANGELOG.md`, 2.3.0). The fix moved the Azure provider to per-batch cycles, receive then send then complete inside one cycle. This page is the rule that fix established, so the next change to these paths is judged against it.

## Scope

- **Applies to:** `DeleteMessagesAsync`, `ResubmitDeadLetterMessagesAsync`, `MoveMessagesAsync`, `PurgeMessagesAsync` and, since 2026-11-12, `CancelScheduledMessagesAsync` of `IMessagingProvider`, on the active queue, the dead-letter queue and the transfer dead-letter queue alike (one receiver helper serves the three, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1002`), the controller actions that call them, and the Angular bulk flow that shows the result.
- **Does not cover:** exactly-once delivery. The broker does not offer it across two entities, and the UI states the caveat.

## Where it's enforced (Azure provider)

- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1773` - a resubmit cycle sends its targets, in as many batches as their size needs (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1850`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1859`); `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1774` only then completes each source message (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1886`), and a failed complete is recorded per sequence number with a "may be duplicated on retry" text (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1908`), not retried by resending.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2001` - a move cycle sends first and `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2002` completes after (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2071`); `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2093` a move whose complete fails after the send is reported with the "may be duplicated" text defined at `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1424`.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1422` - a scan stops after a safety timeout, armed in each of the three loops (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1537`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1729`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1957`); `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1420` it also stops after consecutive windows with no target (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1555`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1594`), and the targets left are reported as not found (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1423`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1620`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1811`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2039`).
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1582` - messages received and not selected are abandoned so their locks are released (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1778` for resubmit, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2006` for move).
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1550` - each cycle checks the token (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1742` for resubmit, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1970` for move, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1507` for the drain of a purge or a delete of everything); only the safety timeout is absorbed into a partial result, a cancellation by the caller propagates (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1603`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1794`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2022`).
- The controllers pass `HttpContext.RequestAborted` into every batch action, through one private action per operation that the active, dead-letter and transfer dead-letter routes share: delete `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:375`, resubmit `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:310`, move `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:405`, purge `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:338`, cancel of scheduled messages `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:252`.
- `src/ServiceBusExplorer.Core/Models/BatchOperationResult.cs:21` - the result carries one failure entry per sequence number.

### Cancel of scheduled messages (2026-11-12)

A cancel deletes messages, so it is held to the same rule.

- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2104` - the sequence numbers are validated before any broker call: 1 to 500, each positive, none repeated (`src/ServiceBusExplorer.Core/Providers/Azure/EntityConfigurationValidator.cs:73`).
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2139` - one broker call cancels all of them when all are scheduled; only when the broker answers that one is not found (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2147`) is each number cancelled on its own (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2163`), so the result says which ones failed. At most 501 broker calls.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2178` - a number that fails carries one of three fixed sentences (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1023`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1024`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1025`), never the broker's text; any other failure of the first call fails every number (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2154`). The causes are logged once per request (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2126`).
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2160` - the token is checked before each single-number call and handed to the SDK.

### A disabled entity (2026-11-12)

The broker refuses a send to, or a receive from, an entity disabled for that direction. The provider answers with the neutral `EntityDisabledException` (`src/ServiceBusExplorer.Core/Abstractions/EntityAdministrationExceptions.cs:24`), which the controllers turn into 409 with a fixed text (`src/ServiceBusExplorer.Api/Controllers/EntityAdministrationResults.cs:19`).

- **Before anything was done, the operation throws.** Delete `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1609`, resubmit `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1800`, move `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2028`, cancel `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2145` and `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2168`.
- **Found midway, it is reported per message and nothing is retried.** What was already deleted, sent or cancelled keeps its outcome; every remaining sequence number is a failure with the text "The entity is disabled for this operation." (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1611`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1802`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2030`, written at `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1626`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1817`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2045`; cancel `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2172`). The loop ends there.
- **What the exception guarantees, and what it does not.** It guarantees only that no message was removed from its source. A resubmit or a move whose first cycle was sent in several batches may have sent part of that cycle before the broker refused the next batch; those messages stay in the source, so a retry can duplicate them, and the 409 does not say so. This is the same hole as the partial send under Known exceptions, not a new one.

## How it's verified

`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs`:

- `:162` and `:313` - resubmit and move send before completing, in each cycle.
- `:196` and `:347` - a failed complete records the duplicate warning and does not resend.
- `:87` - a failed complete on delete records the real error; `:250` and `:406` a transient broker failure returns a partial result.
- `:110`, `:378` and `:491` - a target beyond the scan window is reported not found and the scan terminates, for delete, move and resubmit.
- `:467` - a token already cancelled throws before any work, for move; `:514` for resubmit, which sends nothing; `:542` for delete, which completes nothing; `:529` for the drain, which receives nothing.

`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs`:

- `:72` and `:90` - each sub-queue reaches the SDK as the receiver of that queue, and the transfer dead-letter queue is reachable by delete and resubmit of a queue and of a subscription.
- `:340` - a delete that finds the entity disabled midway keeps what it deleted and fails the rest with the disabled text, without retrying; `:353` disabled before anything was deleted throws.
- `:364` - the same for a resubmit and a move whose target is disabled midway; `:391` disabled before anything was sent throws and completes nothing.
- `:423` - a cancel of numbers that are all scheduled is one broker call; `:435` one number that is not scheduled fails only that number.
- `:448`, `:475` - a cancel on a disabled queue before anything was cancelled throws; `:460` found midway, it keeps what it cancelled and fails the rest without retrying.
- `:489` and `:502` - a failing cancel shows only the fixed sentences and logs the causes once.
- `:524` - the caller's token stops a cancel before the next sequence number.
- `:551` - a cancel outside 1 to 500 positive distinct numbers is refused before the broker is called; `:563` 500 reach it.

The 409 of every message route, and the transfer delete-batch that refuses `all: true`, are tested in `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs:207` and `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs:82`.

## Known exceptions

None is intended; each is recorded on [[pages/services/core]] with its citations and tracked in [[pages/roadmap/followups]].

- **The RabbitMQ provider does the opposite order, and loses messages three ways.** Its bulk delete, resubmit and move consume through the management API with `ack_requeue_false` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:702`) and republish afterwards; it never reads the cancellation token. Each loss was reproduced against a broker in a container on 2026-11-12, and the test pins today's behaviour as a defect: a republish that reaches no queue is reported as success and the message is gone (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:153`); a response that fails to parse, as it does for a message published with no properties, throws after every message up to the highest selected position was already consumed, the unselected ones included (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:188`); a republish the broker refuses, as for another user's `user_id`, loses the message already consumed (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:317`). Until that is fixed this invariant does not hold for RabbitMQ at all. The decision recorded on [[pages/roadmap/code-audit-2026-11]] is to turn these operations off for RabbitMQ and rebuild them over AMQP.
- **The Azure provider loses a message on a resubmit or a move into an entity with duplicate detection.** The copy keeps the original `MessageId`; inside the detection window the broker accepts and drops it, the source is completed, and the result reports success. Reproduced on the emulator (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:114`).
- **A selective delete or move on an active Azure entity dead-letters messages the user did not select.** The scan abandons the non-targets, which raises their delivery count; with a low `MaxDeliveryCount` they reach the dead-letter queue while the result reports success. Reproduced on the emulator (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:160`).
- **A send that fails partway through a cycle** leaves the messages already sent reported as not found; a retry duplicates them without the duplicate warning. When the failure is a disabled entity they are reported with the disabled text instead, or, in the first cycle, the whole operation answers `EntityDisabledException`; the duplicate warning is missing all the same.
- **A cancel that mixes in a number that is not scheduled cancels none on the emulator,** and every number is reported failed, where the unit tests expect only that number to fail (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:87`). Nothing is lost: the messages stay scheduled and the result says so. Real Azure was not verified.
- **Cancel of scheduled messages is refused by RabbitMQ,** which has none, and exists for queues only.
- **The single-message resubmit** sends first and returns silently when the original is not found again.
- **Single receive and single resubmit actions ignore the request token** ([[pages/services/api]]).
- **The Angular flow shows one final update, not per-batch progress,** and does not reload the list after a cancel ([[pages/services/web-app]]).

## Change protocol

A change that reorders receive, send and complete, or removes a failure report, needs a superseding ADR first. The `message-safety` lens of gate 6 reviews every diff that touches these paths, on opus.
