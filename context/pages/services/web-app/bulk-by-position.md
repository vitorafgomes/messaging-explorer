---
title: "Web App: Operations by position"
version: "1.0"
date: 2026-11-16
updated: 2026-11-16
changes: "v1.0: split out of the bulk operations page"
page_type: service
status: active
description: "Read when a change touches a resubmit, a delete or a move on a broker that names a message by its place in the queue, as RabbitMQ does: no Retry, and the rows unticked and read again after a cancel or a failed call."
source:
  - web-app/src/app/features/messages/view-messages-dialog.component.ts
  - web-app/src/app/features/messages/view-messages-dialog.component.spec.ts
reliability: high
---

# Web App: Operations by position

One topic of [[pages/services/web-app|Web App]]; the map lists the others. The operations themselves are on [[pages/services/web-app/bulk-operations]].

An operation by position is the exception, for a resubmit, a delete and a move alike (`web-app/src/app/features/messages/view-messages-dialog.component.ts#forgetPositions`; for delete and move `web-app/src/app/features/messages/view-messages-dialog.component.spec.ts#on RabbitMQ a %s that is cancelled unticks the messages at once and reads the list again when the cancelled dialog is closed`, `web-app/src/app/features/messages/view-messages-dialog.component.spec.ts#on RabbitMQ a %s whose call fails unticks the messages and reads the list again`, `web-app/src/app/features/messages/view-messages-dialog.component.spec.ts#on RabbitMQ a move with failures offers no Retry: the positions of the messages left have moved`, and for the resubmit of the open message `web-app/src/app/features/messages/view-messages-dialog.component.ts#resubmitAsBatchOfOne`, `web-app/src/app/features/messages/view-messages-dialog.component.spec.ts#on RabbitMQ a resubmit of the open message whose call fails unticks the messages and reads the list again`). Where the provider declares `supportsSequenceNumbers: false`, as RabbitMQ does, a ticked row is a position in its queue, and a position names another message once one ahead of it is removed. So a resubmit that is cancelled, or whose call fails, unticks the rows at once and reads the list again: after a failed call straight away, after a cancel when the cancelled progress dialog is closed, since the broker is still requeueing the messages the call held (`web-app/src/app/features/messages/view-messages-dialog.component.ts#resubmitSelected`, `web-app/src/app/features/messages/view-messages-dialog.component.spec.ts#on RabbitMQ a cancelled resubmit unticks the messages at once and reads the list again when the cancelled dialog is closed`, `web-app/src/app/features/messages/view-messages-dialog.component.spec.ts#on RabbitMQ a resubmit whose call fails unticks the messages and reads the list again`). A provider that addresses a message by sequence number keeps its ticked rows, as before (`web-app/src/app/features/messages/view-messages-dialog.component.spec.ts#on Azure Service Bus a resubmit that is cancelled or whose call fails keeps the messages ticked: a sequence number does not move`).
