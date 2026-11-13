---
title: "Web App"
version: "2.0"
date: 2026-11-12
updated: 2026-11-13
changes: "v2.0: a map of topic pages; the old version notes moved to history"
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
| [[pages/services/web-app/bulk-automatic-resubmit\|Automatic resubmit]] | the automatic resubmit of a dead-letter queue: ResubmitRunService, its batches, filter, pause and stop, a change of connection, its report and indicator |
| [[pages/services/web-app/features-messages-and-sessions\|Entity administration, sub-queues and sessions]] | the entity form dialog, the sub-queue tabs and scheduled messages of the message dialog, a disabled entity, or the sessions tab and its state editor |
| [[pages/services/web-app/features-entities-panel-and-definitions\|Entity panel, tree and definitions]] | the entity panel or the tree on Material, the export and import of definitions, EntitySelectionService, or the purge confirmation |
| [[pages/services/web-app/features-settings-and-folders\|Settings and the feature folders]] | the Settings screen (updates, data, developer, about), AppUpdateService, or the connections, entities, messages, queues, topics and monitoring folders |
| [[pages/services/web-app/features-monitoring\|Monitoring screen]] | the Monitoring screen: the snapshot, the counts table of every entity, its sort, filter, threshold and refresh, the Overview |
| [[pages/services/web-app/providers-and-shared\|Providers and shared]] | ProviderRegistryService, ProviderShellComponent, ProviderService and capabilities, docs/ADDING_PROVIDERS.md, or a shared component |
| [[pages/services/web-app/tests\|Tests]] | a spec, how the web tests run, the end-to-end suite, or the web job of CI |
| [[pages/services/web-app/known-gaps\|Hot spots and known gaps]] | a hot spot of the app or a gap recorded as it was found |

## Related

[[pages/services/electron-shell]], [[pages/services/api]], [[pages/architecture/project-map]], [[pages/history/web-app]].
