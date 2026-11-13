---
title: "Web App: Hot spots and known gaps"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Web App service page"
page_type: service
status: active
description: "Read when a change touches a hot spot of the app or a gap recorded as it was found."
source:
  - web-app/src/app/
reliability: high
---

# Web App: Hot spots and known gaps

One topic of [[pages/services/web-app|Web App]]; the map lists the others.

## Hot spots

- `web-app/src/app/features/entities/entity-details.component.ts#EntityDetailsComponent` - 716 lines since 2026-11-13, template inline, styles in `entity-details.component.scss`; handles both brokers, purge, send. The topic panel is read-only text since 2026-11-12: it used to be a form with no save.
- `web-app/src/app/features/messages/view-messages-dialog.component.ts#invalid` - 2719 lines; three near-identical bulk flows (resubmit, delete, move) and the cancel of scheduled messages.
- `web-app/src/app/shared/components/message-body-editor/message-body-editor.component.ts#MessageBodyEditorComponent` - 1239 lines.
- `web-app/src/app/features/connections/connections.component.ts#ungrouped` - 881 lines.
- `web-app/src/app/features/connections/add-connection-dialog.component.ts#envs` - 800 lines.
- `web-app/src/app/shared/components/advanced-filter-panel/advanced-filter-panel.component.ts#AdvancedFilterPanelComponent` - 472 lines.
- `web-app/src/app/features/entities/entities-tree.component.ts#EntitiesTreeComponent` - 385 lines since 2026-11-13, styles in `entities-tree.component.scss`.
- `web-app/src/app/features/monitoring/monitoring.component.ts#MonitoringComponent` - 436 lines.

## Known gaps

- A row of the entities tree is a `div` that selects on a click: it is not reachable by keyboard and has no role. Making it a button needs the create button out of the row first, because a button cannot hold a button: `web-app/src/app/features/entities/entities-tree.component.ts#@for (node of treeData; track node.id) {`.
- The property rows of the entity panel carry the class names the subscription specs read (`form-section`, `section-header`, `info-table`, `label-cell`, `value-cell`) beside their own; they style nothing and go when those specs may change: `web-app/src/app/features/entities/entity-details.component.ts#propertyTable`.
- Provider registry, shell and provider components are not wired into any route: `web-app/src/app/features/entities/entities-container.component.ts#<app-entity-details></app-entity-details>`.
- `docs/ADDING_PROVIDERS.md#### Architecture Flow` describes a flow the code does not run.
- A 3537-line `web-app/src/app/features/entities/entity-details.component.ts.backup` is committed next to the live file.
- No lint or format script exists for the web app, and CI runs none.
- The counts table renders every row, with no virtual scroll or paging, marked as a ceiling in the code; a namespace of several hundred entities draws them all: `web-app/src/app/features/monitoring/monitoring-counts.component.ts#MonitoringCountsComponent`.
- `LastUsedAt` never reaches the list: the connect sets it (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#Connect`) and the save copies only the editable fields onto the stored connection (`src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#CopyEditableFields`), the same root as `IsConnected`. Seen in the end-to-end screenshots of 2026-11-13: every connection read "Never" right after a connect, so the Connections screen has no Last used column.
- The developer-mode debug panel of the Connections screen is still Bootstrap with Font Awesome icons and two literal colours, left as it was apart from its Clear All Data button, removed on 2026-11-13 with its unguarded browser confirm (the action is in Settings): `web-app/src/app/features/connections/connections.component.ts#plural`. The connected chip keeps the class `badge`, which a pinned end-to-end expected failure looks for.
- The purges of the Queues and Topics pages ask the old confirmation: it names the entity and the count read with the list, not the connection or a live count, and asks for no typed acknowledgement, short of rule 6 of the UI convention: `web-app/src/app/features/queues/queues.component.ts#purgeMessages`, `web-app/src/app/features/topics/topics.component.ts#purgeSubscriptionMessages`.
- The selection bar keeps Delete first, apart and in the error colour; the artboard draws it last, as "Delete {count}". The order is pinned by a spec of the messages dialog: `web-app/src/app/shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component.ts#BulkActionsToolbarComponent`.
- The bulk results dialog lists each failure with its result and error in one line; the artboard draws a table with Sequence Number, Result and Error, and the environment and connection under the title, which the dialog is not given: `web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts#BulkOperationResultsDialogComponent`.
- Eight tests are skipped: the refresh variants in `web-app/src/app/core/services/metrics.service.spec.ts#getQueueMetricsWithRefresh`, with a TODO about timers under zoneless Angular.
- Bulk progress is a single final update, not per batch: `web-app/src/app/features/messages/view-messages-dialog.component.ts#takeUntilDestroyed`.
- After a cancel the message list and counters are not refreshed: `web-app/src/app/features/messages/view-messages-dialog.component.ts#executeCancelScheduled`.
- A possible duplicate is recognised by the provider's English text, not a field: a change of that text in the Azure provider would make Retry Failed resend duplicates again, and RabbitMQ writes no such text. Ceiling until `BatchOperationFailure` carries a flag: `web-app/src/app/core/services/bulk-operations.service.ts#isPossibleDuplicate`.
- The drain-all decision compares the selection with the count the messages dialog received when it opened, not a fresh read; if the entity grew past what was loaded, a selection equal to that stale count still drains everything present at execution, behind the acknowledgement: `web-app/src/app/features/messages/view-messages-dialog.component.ts`.
- A disabled-entity failure of a resubmit or a move is listed as retryable: only a possible duplicate is kept out of the retry list (`web-app/src/app/features/messages/view-messages-dialog.component.ts#resultsDialogRef`, `web-app/src/app/features/messages/view-messages-dialog.component.ts`), so Retry Failed resends by hand to an entity that is still disabled.
- The export dialog still takes a dead-letter boolean and says "(Dead Letter)" for an export from the transfer dead-letter tab: `web-app/src/app/features/messages/export-messages-dialog.component.ts`.
- The "Scheduled" view filters the loaded messages; it is not a listing from the broker: `web-app/src/app/features/messages/view-messages-dialog.component.ts#getRegexError`.
- `cancelScheduledBlockedReason` and `scheduledLoadedCount` are methods bound in the template and recompute on every change detection pass (`web-app/src/app/features/messages/view-messages-dialog.component.ts#resultsDialogRef`, `web-app/src/app/features/messages/view-messages-dialog.component.ts#getRegexError`); not noticeable up to 1,000 loaded messages.
- If `getApiSecret()` fails the app silently sends unauthenticated requests: `web-app/src/app/core/services/api.service.ts#electronAPI`.
- `ProviderShellComponent` silently renders nothing when no component is registered (TODO in code): `web-app/src/app/features/entities/provider-shell.component.ts#componentType`.
- A name that is exactly `.` or `..` cannot be sent as a path segment: `encodeURIComponent` leaves dots alone and the browser's URL parser resolves `.`, `..` and their `%2E` forms as dot segments. Azure names cannot take that form; RabbitMQ names can, and deleting a subscription named `..` under topic `t` would become `DELETE /api/topics/t/` and delete the topic (read from the URL standard and the route table, not executed). `apiPath` does not refuse such a value today: `web-app/src/app/core/services/api-path.ts#apiPath`.
- An automatic resubmit run lives in the renderer's memory: a reload or quitting the app ends it without asking, and its report is lost unless saved; the prototype draws a question on quit (`web-app/src/app/core/services/resubmit-run.service.ts#ResubmitRunService`). After a connect that failed, no run starts until the status read again from the API arrives; if that read fails too, none starts until a later status does.
- The server's resubmit reaches only a few hundred messages past the head of the dead-letter queue. A filtered run, or one that leaves refused messages behind, fills the head with messages it does not send, and the run ends as failed once a message stays not found after one wait, short of N. A message "Not found within scan window" is recognised by the provider's English text, like a possible duplicate (`web-app/src/app/core/services/bulk-operations.service.ts#isNotFoundInScanWindow`): a change of that text would make the run continue past such messages again. The wait and the second try are unit-tested with a fake clock only, not against a broker: `web-app/src/app/core/services/resubmit-run.service.ts#waitForLocks`.
- The Settings screen's cannot-update and ready panels use the tertiary and primary containers because the theme defines no warning or success colour; the artboard draws warning and success (`web-app/src/app/features/settings/settings.component.scss#.blocked-panel {`).
- The toolbar at the minimum window width was seen once in a headless browser at 1000 px, disconnected, light and dark; with a long namespace connected, with an update button, and in Electron on each system it was not: `web-app/src/app/app.html`.
