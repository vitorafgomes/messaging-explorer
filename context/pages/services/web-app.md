---
title: "Web App"
version: "2.0"
date: 2026-11-12
updated: 2026-11-14
changes: "v2.0: a map of topic pages; the old version notes moved to history; a topic for the message detail, binary bodies and single-message actions"
page_type: service
status: active
description: "Angular 21 single-page UI that talks to the local .NET API through one ApiService, in a plain browser or inside the Electron shell."
source:
  - web-app/package.json
  - web-app/angular.json
  - web-app/src/main.ts
  - web-app/src/app/app.config.ts
  - web-app/src/app/app.routes.ts
  - web-app/src/app/app.ts
  - web-app/src/app/app.html
  - web-app/src/app/features/settings/settings.component.ts
  - web-app/src/app/features/settings/app-update.service.ts
  - web-app/src/app/features/settings/clear-all-data-dialog.component.ts
  - web-app/src/app/shared/bug-report.service.ts
  - web-app/src/environments/environment.ts
  - web-app/src/environments/environment.prod.ts
  - web-app/src/app/core/services/api.service.ts
  - web-app/src/app/core/services/api-path.ts
  - web-app/src/app/core/services/bulk-operations.service.ts
  - web-app/src/app/core/services/entity-selection.service.ts
  - web-app/src/app/core/services/queue.service.ts
  - web-app/src/app/core/services/provider.service.ts
  - web-app/src/app/core/models/provider.model.ts
  - web-app/src/app/providers/provider-registry.service.ts
  - web-app/src/app/providers/kafka/index.ts
  - web-app/src/app/features/entities/entities-container.component.ts
  - web-app/src/app/features/entities/provider-shell.component.ts
  - web-app/src/app/features/messages/view-messages-dialog.component.ts
  - web-app/src/app/features/messages/continuous-resubmit-dialog.component.ts
  - web-app/src/app/core/services/resubmit-run.service.ts
  - web-app/src/app/features/messages/resubmit-run-indicator.component.ts
  - web-app/src/app/features/entities/entity-details.component.ts
  - web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts
  - web-app/src/app/shared/pipes/highlight.pipe.ts
  - web-app/src/app/shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component.ts
  - docs/ADDING_PROVIDERS.md
  - .github/workflows/ci.yml
  - src/ServiceBusExplorer.Core/Providers/ProviderType.cs
  - src/ServiceBusExplorer.Api/Program.cs
reliability: high
---

# Web App

> The Angular 21 UI under `web-app/src/`: it renders connections, entities, messages and monitoring, and sends every HTTP call to the local .NET API through `ApiService`.

## Responsibility

Owns all presentation and client-side state: connection management, the entity tree, message browsing, send, import, export, diff, bulk dialogs, monitoring charts, templates, theme, filters. Does not own persistence of connections or any broker access; that is the API ([[pages/services/api]]) and the Core library ([[pages/services/core]]). Does not own process management, tray, menu or updates; that is [[pages/services/electron-shell]].

## Rules

The rules this project must keep, and what to read before changing it, are in `.claude/rules/web-app.md`; Claude Code loads that file when a task touches the project. Each rule in full, with the code and tests that keep it: [[pages/services/web-app/how-the-rules-are-kept]].

## Topics

Read the page your change touches, not all of them.

| Page | Read when a change touches |
|---|---|
| [[pages/services/web-app/how-the-rules-are-kept\|How the rules are kept]] | ApiService and the X-Api-Key, encoding a name in a path, HighlightPipe escaping, or a review of a change that could break a rule of the app |
| [[pages/services/web-app/stack-and-bootstrap\|Stack, bootstrap and core]] | a package version, the build or dev server, bootstrap and routing, the toolbar navigation, the developer-mode shortcut, or the core/ models and services |
| [[pages/services/web-app/bulk-operations\|Bulk operations]] | BulkOperationsService, delete, resubmit and move in ViewMessagesDialogComponent, "all" against the page, possible duplicates, continuous resubmit, send and export, cancel and progress |
| [[pages/services/web-app/bulk-new-message-id\|New message IDs and unselected messages]] | the option "Send with a new message ID" in any dialog, a duplicate refusal, or the new ids and unselected-message lines of the results dialog |
| [[pages/services/web-app/bulk-deferred-messages\|Deferred messages and Load more]] | the deferred actions of the selection bar, the dead-letter dialog of deferred messages, or Load more on the Active and Dead Letter tabs |
| [[pages/services/web-app/bulk-by-position\|Operations by position]] | a resubmit, a delete or a move on a broker that names a message by its place in the queue: no Retry, untick and read again |
| [[pages/services/web-app/features-logs\|The Logs screen]] | the Logs screen of Developer mode, the service that gathers its lines, or what a line may carry |
| [[pages/services/web-app/bulk-automatic-resubmit\|Automatic resubmit]] | the automatic resubmit of a dead-letter queue: ResubmitRunService, its batches, filter, pause and stop, a change of connection, its report and indicator |
| [[pages/services/web-app/bulk-automatic-resubmit-dialog\|Automatic resubmit dialog]] | what the automatic resubmit dialog shows: configure, the run, the report, the head-of-queue loop |
| [[pages/services/web-app/bulk-automatic-resubmit-progress\|Automatic resubmit progress]] | the count before a run, batch numbers, progress and report, the toolbar card, the queue panel line and the tree spinner |
| [[pages/services/web-app/features-messages-and-sessions\|Entity administration, sub-queues and sessions]] | the entity form dialog, the sub-queue tabs and scheduled messages of the message dialog, a disabled entity, or the sessions tab and its state editor |
| [[pages/services/web-app/features-message-detail-actions\|Message detail and single-message actions]] | the detail pane of one message: a binary body as hex and Copy base64, Defer, Dead-letter and Delete of one message with their confirmation, the base64 choice of the send dialog, `bodyEncoding` in export and import |
| [[pages/services/web-app/features-entities-panel-and-definitions\|Entity panel, tree and definitions]] | the entity panel or the tree on Material, the export and import of definitions, EntitySelectionService, or the purge confirmation |
| [[pages/services/web-app/features-entities-main\|Entities as drawn]] | the tree filter and rows, the panel header and actions, the More menu, delete of an entity, the cards and tabs, as the Main artboard draws them |
| [[pages/services/web-app/features-settings-and-folders\|Settings and the feature folders]] | the Settings screen (updates, data, developer, about), AppUpdateService, or the connections, entities, messages, queues, topics and monitoring folders |
| [[pages/services/web-app/features-settings-mcp\|The MCP server group]] | the MCP server group of Settings, McpSettingsService, the MCP token shown in the app, or the MCP mark on the toolbar |
| [[pages/services/web-app/features-settings-mcp-requests\|The window that asks about a request]] | McpRequestDialogComponent, the polling of the requests of assistants, the kinds a request may have, danger, or the word typed before a removal |
| [[pages/services/web-app/features-settings-mcp-app-settings\|The settings of the app an assistant may change]] | the row "Settings of the app" of the MCP server group, McpAppSettingsService, the polling of mcp/app-requests, or the fixed list of settings an assistant may change |
| [[pages/services/web-app/features-connections\|Connections]] | the Connections screen: list and columns, add and edit, a stored secret, Manage Groups and the Production mark, import with its preview |
| [[pages/services/web-app/features-monitoring\|Monitoring screen]] | the Monitoring screen: the snapshot, the counts table of every entity, its sort, filter, threshold and refresh, the Overview |
| [[pages/services/web-app/providers-and-shared\|Providers and shared]] | ProviderRegistryService, ProviderShellComponent, ProviderService and capabilities, docs/ADDING_PROVIDERS.md, or a shared component |
| [[pages/services/web-app/tests\|Tests]] | a spec, how the web tests run, the end-to-end suite, or the web job of CI |
| [[pages/services/web-app/known-gaps\|Hot spots and known gaps]] | a hot spot of the app or a gap recorded as it was found |

## Related

[[pages/services/electron-shell]], [[pages/services/api]], [[pages/architecture/project-map]], [[pages/history/web-app]].
