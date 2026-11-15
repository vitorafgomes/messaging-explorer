---
title: "Web App: Message detail, binary bodies and single-message actions"
version: "1.0"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.0: the hex view of a binary body, Copy base64, defer, dead-letter and delete of one message after a confirmation, the base64 choice of the send dialog, bodyEncoding in export and import"
page_type: service
status: active
description: "Read when a change touches the detail pane of one message in the messages dialog: a binary body, its hex view and copy, the Defer, Dead-letter and Delete actions on it; or the base64 choice of the send dialog, or bodyEncoding in a message export or import."
source:
  - web-app/src/app/shared/message-body.ts
  - web-app/src/app/features/messages/view-messages-dialog.component.ts
  - web-app/src/app/features/messages/send-message-dialog.component.ts
  - web-app/src/app/features/messages/deadletter-deferred-dialog.component.ts
  - web-app/src/app/core/services/message-export.service.ts
  - web-app/src/app/core/services/message-import.service.ts
  - web-app/src/app/features/messages/view-messages-dialog.component.spec.ts
  - web-app/src/app/features/messages/send-message-dialog.component.spec.ts
reliability: high
---

# Web App: Message detail, binary bodies and single-message actions

One topic of [[pages/services/web-app|Web App]]; the routes are on [[pages/services/api/routes-single-message-actions]] and the provider side on [[pages/services/core/azure-single-message-actions]] and [[pages/services/core/message-bodies]].

## A binary body

A message whose `bodyEncoding` is `base64` is shown in the detail pane as hex, never decoded as text (`web-app/src/app/features/messages/view-messages-dialog.component.ts#binaryView`):

- `web-app/src/app/shared/message-body.ts#hexView` lays out rows of 16 bytes as offset, hex and printable ASCII, at most the first 512 bytes (`web-app/src/app/shared/message-body.ts#HEX_VIEW_MAX_BYTES`); the bytes are never changed. The view is kept per message so the template does not decode it on each check.
- A note above it names the byte count and the content type, and says when only the first bytes are shown.
- The copy button reads "Copy base64" and copies every byte as base64 (`web-app/src/app/features/messages/view-messages-dialog.component.ts#copyBody`); a text body keeps "Copy body".

## Actions on one active message

The detail of an active message shows **Defer** when the provider declares `supportsDeferral` and **Dead-letter** when it declares `supportsManualDeadLetter`, and **Delete this message** apart from them, in the danger style. Each acts only after a confirmation:

- `web-app/src/app/features/messages/view-messages-dialog.component.ts#settleOne` - Defer opens the confirm dialog with the entity and the sequence number; Dead-letter opens the dead-letter dialog of deferred messages marked `active`, which asks for an optional reason and description. Only a confirmed choice sends `settleActiveMessages` with that one number, to the queue route or the subscription route.
- `web-app/src/app/features/messages/view-messages-dialog.component.ts#deleteOne` - the confirm dialog, then the delete-batch route of the shown sub-queue with that one number and `all: false`.
- **The scan notice.** On the active tab each confirmation carries the same notice: the broker cannot lock one message by its number, so the app receives messages in order until it finds this one; every other message it receives is released at once with its delivery count raised by one, one at its max delivery count goes to the dead-letter queue and is reported, and operations are at-least-once (`web-app/src/app/features/messages/view-messages-dialog.component.ts#SCAN_NOTICE`).
- The result opens in the results dialog per sequence number, a number not found included, and the tab is read again; a failed call says why in a snack bar.
- `web-app/src/app/features/messages/view-messages-dialog.component.ts#isScanReachable` hides the three actions on a deferred or scheduled message on the active tab: the scan never hands one out, so it would only raise the delivery count of the others. Abandon is not offered.

## The send dialog

When the provider declares `supportsBinaryBody`, the send dialog offers "The body is base64 of binary bytes: send the bytes, not the text" (`web-app/src/app/features/messages/send-message-dialog.component.ts#bodyEncoding`). A body ticked as base64 that does not decode shows "The body is not valid base64" and Send stays disabled (`web-app/src/app/features/messages/send-message-dialog.component.ts#base64Invalid`, `web-app/src/app/shared/message-body.ts#isBase64`). Edit and resubmit of a binary message keeps the base64 flag of the source.

## Export and import

A message export writes `bodyEncoding` in JSON and a "Body Encoding" column in CSV and Excel, `text` when absent (`web-app/src/app/core/services/message-export.service.ts#bodyEncoding`); the import maps both back to the send request (`web-app/src/app/core/services/message-import.service.ts#SENDABLE_FIELDS`), so a binary message re-imported is sent as its bytes. No spec pins either direction yet.

## Tests

- `web-app/src/app/features/messages/view-messages-dialog.component.spec.ts`, under "one message: a binary body and the actions on it": `a binary body is shown as hex with its byte count and content type, and copied as base64, never as garbled text`, `defer asks first, says what the scan does to the other messages, and only then sends the one sequence number`, `a cancelled confirmation sends nothing`, `dead-letter asks for a reason in the dead-letter dialog marked active, then sends the one number with it`, `a subscription sends the action to its own route`, `a provider that declares neither action shows neither`, `a deferred message offers no scan action`, `delete of one message calls delete-batch with that one number only after the confirmation`. Sending without waiting for the confirmation fails the first three action specs and the delete one, each on "nothing is sent before the confirmation" or "nothing is deleted before the confirmation".
- `web-app/src/app/features/messages/send-message-dialog.component.spec.ts`, under "a binary body": `a provider that declares binary bodies offers the base64 choice, and one that does not hides it`, `a base64 body is sent with its flag, so the bytes round trip`, `edit and resubmit of a binary message keeps the base64 flag of the source`, `a body flagged base64 that does not decode is not sent`.
- `web-app/src/app/shared/message-body.spec.ts`: `shows the bytes of a binary body as offset, hex and printable ASCII`, `bounds the hex view to the first bytes of a large body and says how many there are`, `accepts base64 and refuses text that is not`.
