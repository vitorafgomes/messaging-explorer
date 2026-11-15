---
title: "Web App: Deferred messages and Load more"
version: "1.1"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.1 (2026-11-14): each deferred call runs under the progress dialog, so the messages dialog cannot be closed mid-call and Cancel warns what may have been affected. v1.0: delete, resubmit and dead-letter of deferred messages from the selection bar; Load more on the Active and Dead Letter tabs"
page_type: service
status: active
description: "Read when a change touches the deferred actions of the messages dialog (Resubmit deferred, Dead-letter deferred, Delete N deferred), the dead-letter dialog of deferred messages, or Load more on the Active and Dead Letter tabs."
source:
  - web-app/src/app/features/messages/view-messages-dialog.component.ts
  - web-app/src/app/features/messages/deadletter-deferred-dialog.component.ts
  - web-app/src/app/shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component.ts
  - web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts
  - web-app/src/app/shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component.ts
  - web-app/src/app/core/services/queue.service.ts
  - web-app/src/app/core/services/topic.service.ts
reliability: high
---

# Web App: Deferred messages and Load more

One topic of [[pages/services/web-app|Web App]]; the other bulk calls are on [[pages/services/web-app/bulk-operations]], and what the server does with a deferred message is on [[pages/services/core/azure-deferred]].

## Deferred actions (2026-11-14)

- **Offered only where the provider declares it.** The Active tab of a queue or a subscription offers them when the API's capabilities say `supportsDeferral` is true and at least one selected message is in the `Deferred` state (`web-app/src/app/features/messages/view-messages-dialog.component.ts#selectedDeferred`). The default capabilities say false, so RabbitMQ and an API that does not answer get none. Never on the dead-letter or transfer dead-letter tab.
- **What they send.** Exactly the selected sequence numbers whose loaded message is deferred, one call, through `ApiService`: `POST .../deferred/delete-batch`, `resubmit-batch` or `deadletter-batch` of the queue or of the subscription (`web-app/src/app/core/services/queue.service.ts#settleDeferredMessages`, `web-app/src/app/core/services/topic.service.ts#settleDeferredMessages`). The client does not chunk; the server refuses more than 1000, and that refusal is shown in a snack bar with the selection kept.
- **The selection bar** (`web-app/src/app/shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component.ts#deferredCount`) adds "Resubmit deferred" and "Dead-letter deferred" among the routine actions, before Clear, and "Delete N deferred" after Delete, apart and in the error colour. A line under the bar says, for a mixed selection, "The deferred actions act on the D deferred only; L of the N selected are not deferred and left out.", and always "Delete N and Move do not reach a deferred message: the broker hands one out only by its sequence number." (`web-app/src/app/features/messages/view-messages-dialog.component.ts#deferredNote`). The existing actions keep their behaviour.
- **Delete** asks for the queue or subscription name typed, through the confirm dialog, and names what is left out (`web-app/src/app/features/messages/view-messages-dialog.component.ts#handleDeleteDeferred`).
- **Resubmit** sends without a confirmation, as the dead-letter resubmit does. Above the list, while deferred messages are selected, the Active tab shows "Send with a new message ID" when the target detects duplicates or after a duplicate refusal, and on a subscription the note that a resubmit goes through the topic, both in the words of [[pages/services/web-app/bulk-new-message-id]].
- **Dead-letter** opens `deadletter-deferred-dialog`: the entity, connection, environment and count, an optional Reason and Description, "Keep them" and "Dead-letter N deferred messages" (`web-app/src/app/features/messages/deadletter-deferred-dialog.component.ts#DeadLetterDeferredDialogComponent`). An empty field is not sent, so the API writes "Manual dead letter" and "Moved to dead letter by user".
- **While the call runs.** A deferred resubmit sends and then completes, so each deferred call, delete and dead-letter included, runs under the progress dialog every send-then-complete flow uses (`web-app/src/app/features/messages/view-messages-dialog.component.ts#settleDeferred`): it cannot be dismissed, its backdrop covers the messages dialog, so neither Escape, the backdrop nor the close button ends the call. It reads "Resubmitting 2 deferred messages from orders...", "Deleting ..." or "Dead-lettering 2 deferred messages in orders..." (`web-app/src/app/shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component.ts#getOperationDescription`). Cancel aborts the request, the server stops through `RequestAborted`, no results open, and the dialog says that messages already processed may still have been affected, as for the other flows. Until 2026-11-14 the messages dialog could be closed mid-call: the request was aborted, a possible duplicate was never shown, and the next "Resubmit deferred" sent again.
- **Results.** Each call opens the bulk results dialog with `deferred: true`: "Attempted to delete 2 deferred messages from orders.", "Dead-letter Results", and each failure by its sequence number in the API's words, "Not found as a deferred message." included (`web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts#getOperationSummary`). Only a resubmit offers Retry, and Retry never takes a possible duplicate: the deferred duplicate text matches `isPossibleDuplicate` (`web-app/src/app/features/messages/view-messages-dialog.component.ts#settleDeferred`). Closing the results reloads the Active tab.
- **What it does not do.** The Show filter has no Deferred option; the rows carry the Deferred chip.

## Load more (2026-11-14)

- **When.** On the Active and Dead Letter tabs, when the last read returned a full page, the count asked for capped at the 1000 the API returns (`web-app/src/app/features/messages/view-messages-dialog.component.ts#pageSize`), and the capabilities say `supportsPeekFromSequenceNumber` is true (`web-app/src/app/features/messages/view-messages-dialog.component.ts#canLoadMore`). Below the list: "Load more" and "The next N after #S".
- **What.** One peek per click from the highest loaded sequence number plus one, appended to the list, a number already loaded skipped; the selection stays. A shorter page ends it. A failure keeps the list and says why in a snack bar (`web-app/src/app/features/messages/view-messages-dialog.component.ts#loadMore`).

## Tests

`web-app/src/app/features/messages/view-messages-dialog.component.spec.ts`, the describes "deferred messages: delete, resubmit and dead-letter from the selection bar" (the progress dialog: "while a deferred %s runs, the messages dialog cannot be closed") and "Load more reads the next page from the last sequence number, one page per click"; `web-app/src/app/features/messages/deadletter-deferred-dialog.component.spec.ts`; `web-app/src/app/shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component.spec.ts#BulkActionsToolbarComponent: deferred actions`; `web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.spec.ts#BulkOperationResultsDialogComponent for deferred messages`; `web-app/src/app/shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component.spec.ts#a deferred resubmit cannot be dismissed, and its Cancel says messages already processed may have been affected`.

## Not drawn

`context/prototypes/web-app/Messages.dc.html` draws the Deferred chip and the detail note only: no deferred action, no dead-letter dialog and no Load more. The bar follows its own Cancel scheduled and Delete pattern, the dialog follows `cancel-scheduled-dialog`, and no artboard draws them yet.
