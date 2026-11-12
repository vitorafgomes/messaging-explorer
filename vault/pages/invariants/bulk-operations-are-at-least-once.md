---
title: "Bulk operations are at-least-once"
version: "1.0"
date: 2026-11-12
changes: "Founded from the code on 2026-11-12"
page_type: invariant
status: active
description: "A bulk delete, resubmit, move or purge never loses a message silently: send first, complete after; a message sent but not removed from its source is reported as a possible duplicate; failures are reported per sequence number; scans are bounded; the caller's token stops the batch."
updated: 2026-11-12
enforced_by:
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1408"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1444"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1653"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:983"
  - "src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:264"
verified_by:
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:162"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:196"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:347"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:467"
source:
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs"
  - "src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs"
  - "src/ServiceBusExplorer.Core/Models/BatchOperationResult.cs"
  - "src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs"
  - "CHANGELOG.md"
reliability: high
---

# Bulk operations are at-least-once

> A message the user selected is, after the operation, in exactly one of three states the result names: done, failed with its sequence number and reason, or possibly duplicated. It is never gone without a word. Rule H of root `CLAUDE.md`.

## Why this exists

Version 2.3.0 fixed dead-letter bulk delete and resubmit losing and duplicating messages: the whole selection was scanned while earlier messages sat under a PeekLock that expired (`CHANGELOG.md`, 2.3.0). The fix moved the Azure provider to per-batch cycles, receive then send then complete inside one cycle. This page is the rule that fix established, so the next change to these paths is judged against it.

## Scope

- **Applies to:** `DeleteMessagesAsync`, `ResubmitDeadLetterMessagesAsync`, `MoveMessagesAsync` and `PurgeMessagesAsync` of `IMessagingProvider`, the controller actions that call them, and the Angular bulk flow that shows the result.
- **Does not cover:** exactly-once delivery. The broker does not offer it across two entities, and the UI states the caveat.

## Where it's enforced (Azure provider)

- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1408` - a resubmit cycle sends its batch; `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1444` only then completes each source message, and a failed complete is recorded per sequence number, not retried by resending.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1653` - a move whose complete fails after the send is reported with the "may be duplicated" text defined at `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:985`.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:983` - a scan stops after a safety timeout; `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:981` it also stops after consecutive windows with no target, and the targets left are reported as not found.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1151` - messages received and not selected are abandoned so their locks are released.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1119` - each cycle checks the token; `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:264` the controllers pass `HttpContext.RequestAborted` into every batch action.
- `src/ServiceBusExplorer.Core/Models/BatchOperationResult.cs:21` - the result carries one failure entry per sequence number.

## How it's verified

`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs`:

- `:162` and `:313` - resubmit and move send before completing, in each cycle.
- `:196` and `:347` - a failed complete records the duplicate warning and does not resend.
- `:87` - a failed complete on delete records the real error; `:250` and `:406` a transient broker failure returns a partial result.
- `:110` and `:378` - a target beyond the scan window is reported not found and the scan terminates.
- `:467` - a token already cancelled throws before any work.

## Known exceptions

None is intended; each is recorded on [[pages/services/core]] with its citations and tracked in [[pages/roadmap/followups]].

- **The RabbitMQ provider does the opposite order.** Its bulk delete, resubmit and move consume through the management API with `ack_requeue_false` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:669`) and republish afterwards, so a failed republish loses the message; it never reads the cancellation token. It has no tests. Until that is fixed this invariant holds for Azure only, and a change to the RabbitMQ bulk paths must move them toward it.
- **A send that fails partway through a cycle** leaves the messages already sent reported as not found; a retry duplicates them without the duplicate warning.
- **The single-message resubmit** sends first and returns silently when the original is not found again.
- **Single receive and single resubmit actions ignore the request token** ([[pages/services/api]]).
- **The Angular flow shows one final update, not per-batch progress,** and does not reload the list after a cancel ([[pages/services/web-app]]).

## Change protocol

A change that reorders receive, send and complete, or removes a failure report, needs a superseding ADR first. The `message-safety` lens of gate 6 reviews every diff that touches these paths, on opus.
