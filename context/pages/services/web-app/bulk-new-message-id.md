---
title: "Web App: New message IDs and what a scan did to unselected messages"
version: "1.0"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.0: split out of the bulk operations page"
page_type: service
status: active
description: "Read when a change touches the option \"Send with a new message ID\" in the messages, move, automatic resubmit or results dialog, a duplicate refusal, or the new ids and unselected-message lines of the results dialog."
source:
  - web-app/src/app/core/services/bulk-operations.service.ts
  - web-app/src/app/core/services/resubmit-run.service.ts
  - web-app/src/app/features/messages/view-messages-dialog.component.ts
  - web-app/src/app/features/messages/move-messages-dialog.component.ts
  - web-app/src/app/features/messages/continuous-resubmit-dialog.component.ts
  - web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts
reliability: high
---

# Web App: New message IDs and what a scan did to unselected messages

One topic of [[pages/services/web-app|Web App]]; the bulk calls themselves are on [[pages/services/web-app/bulk-operations]], and what the server checks is on [[pages/services/core/azure-bulk-safety-checks]].

## The option "Send with a new message ID"

- **One wording.** Every dialog shows the same checkbox, "Send with a new message ID", and the same hint: the copy gets a new message ID and keeps the original in the `x-original-message-id` property, and without it the target would drop the copy as a duplicate, so it is refused (`web-app/src/app/core/services/bulk-operations.service.ts#NEW_MESSAGE_ID_OPTION`). It is off until the user ticks it, and it sends `newMessageIdOnDuplicateDetection` on the request.
- **When it shows.** Only when the dialog knows the target detects duplicates: the opener passed `targetDetectsDuplicates`, or the server refused a message with its duplicate text, which `isDuplicateRefusal` recognises by the start of the text, marked as a ceiling in the code until the API carries a field (`web-app/src/app/core/services/bulk-operations.service.ts#isDuplicateRefusal`). The queue and topic lists of the API read runtime properties only, so a dialog opened from a list, or from a subscription in the entity panel, usually learns it only from a refusal ([[pages/roadmap/followups]]).
- **The messages dialog**, on the dead-letter and the transfer dead-letter tabs, shows it above the list for the single resubmit and the bulk resubmit (`web-app/src/app/features/messages/view-messages-dialog.component.ts#targetDetectsDuplicates`). A single resubmit refused as a duplicate (the API's 400) or a bulk result with a duplicate refusal turns it on for the dialog (`web-app/src/app/features/messages/view-messages-dialog.component.ts#resubmit`, `web-app/src/app/features/messages/view-messages-dialog.component.ts#resubmitSelected`).
- **The move dialog** reads the chosen target with `getQueue`, since the queue list does not carry duplicate detection, and shows the option when that read says the target detects duplicates; a failed read counts as no, and the refusal then offers it on retry (`web-app/src/app/features/messages/move-messages-dialog.component.ts#readTarget`). The move closes with the flag only when the target detects duplicates and the box is ticked (`web-app/src/app/features/messages/move-messages-dialog.component.ts#choice`).
- **The automatic resubmit dialog** shows it on configure when the opener knows the target detects duplicates (`data.targetDetectsDuplicates`) and passes it to the run at start (`web-app/src/app/features/messages/continuous-resubmit-dialog.component.ts#start`); after a finished run whose failures include a duplicate refusal it shows it again beside "Retry the N failed" (`web-app/src/app/features/messages/continuous-resubmit-dialog.component.ts#refusedAsDuplicate`, `web-app/src/app/features/messages/continuous-resubmit-dialog.component.ts#retryFailed`). A retry keeps the flag of the run it retries when that run had it. The run hands the flag to every batch it sends (`web-app/src/app/core/services/resubmit-run.service.ts#brokerFor`, `web-app/src/app/core/services/resubmit-run.service.ts#retry`); see [[pages/services/web-app/bulk-automatic-resubmit]].
- **The results dialog** offers it beside Retry for a resubmit or a move whose result has a duplicate refusal, and closes with the choice so the retry sends it (`web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts#offersNewMessageId`).

## What the results dialog says

- **New ids.** A table "Sent with a new message ID (N)" lists each sequence number with its new message ID, from `newMessageIds` of the result, and says that each copy keeps its original message ID in the `x-original-message-id` property (`web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts#newIds`). The single resubmit returns no id, so its new id is shown nowhere.
- **Unselected messages sent to the dead-letter queue.** When `unselectedDeadLettered` is not empty, an alert says "Sent to the dead-letter queue: at least N unselected messages reached the max delivery count during the scan" and lists their sequence numbers.
- **Delivery counts raised.** When `unselectedDeliveryCountRaised` is not zero, a line says "At least N unselected messages had their delivery count raised by one." Both numbers are lower bounds, as the server counts them ([[pages/services/core/azure-bulk-safety-checks]]).
