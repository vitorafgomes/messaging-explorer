---
title: "Web App: Providers and shared"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Web App service page"
page_type: service
status: active
description: "Read when a change touches ProviderRegistryService, ProviderShellComponent, ProviderService and capabilities, docs/ADDING_PROVIDERS.md, or a shared component."
source:
  - web-app/src/app/providers/provider-registry.service.ts
  - web-app/src/app/providers/kafka/index.ts
  - web-app/src/app/features/entities/provider-shell.component.ts
  - web-app/src/app/core/services/provider.service.ts
  - web-app/src/app/core/models/provider.model.ts
  - docs/ADDING_PROVIDERS.md
  - src/ServiceBusExplorer.Core/Providers/ProviderType.cs
  - web-app/src/app/shared/
reliability: high
---

# Web App: Providers and shared

One topic of [[pages/services/web-app|Web App]]; the map lists the others.

## providers/ and the registry

- `ProviderRegistryService` maps `ProviderType` to an entity-details component class, filled by lazy `import()` of the `azure-service-bus` and `rabbitmq` barrels (`web-app/src/app/providers/provider-registry.service.ts#import`).
- `ProviderShellComponent` resolves the class and calls `createComponent` (`web-app/src/app/features/entities/provider-shell.component.ts#componentType`).
- But the shell is not used: the `entities` route renders `<app-entity-details>` directly (`web-app/src/app/features/entities/entities-container.component.ts#<app-entity-details></app-entity-details>`), and a grep of `src/app` finds no `app-provider-shell` outside doc comments. The registry, shell and both provider components are therefore unreachable at runtime; the 2178-line `EntityDetailsComponent` handles both brokers, and since 2026-11-12 it hides what the connected broker's capabilities say it cannot do: sessions, scheduled messages and the dead-letter side, each only when the flag is explicitly false (`web-app/src/app/features/entities/entity-details.component.ts#supports`). See [[pages/invariants/provider-boundaries]].
- `kafka/` holds three empty folders (`.gitkeep`) and a barrel containing only a TODO comment (`web-app/src/app/providers/kafka/index.ts#* TODO: Implement Kafka provider components`). No Kafka component, no `ProviderType.Kafka` in the frontend enum (`web-app/src/app/core/models/provider.model.ts#export enum ProviderType {`), and none in the backend enum (`src/ServiceBusExplorer.Core/Providers/ProviderType.cs#ProviderType`): there is no backend provider.
- `ProviderService` follows the active connection: on connect it holds that provider's built-in default capabilities, then the API's answer merged over them; a failed call keeps the defaults of the connected provider without an error; on disconnect the state resets and a late answer for the previous connection is dropped (`web-app/src/app/core/services/provider.service.ts#ProviderService`). The API sends the provider type by name and the service normalises it (`web-app/src/app/core/services/provider.service.ts#toProviderType`). It lists only Azure and RabbitMQ.

### docs/ADDING_PROVIDERS.md versus the code

- Step 1 (add enum value): matches the current enum shape (`web-app/src/app/core/models/provider.model.ts#export enum ProviderType {`) but the backend enum must also change and the guide omits it.
- Step 8 (register in `registerProviders`): matches the registry (`web-app/src/app/providers/provider-registry.service.ts#registerProviders`).
- Architecture flow ("ProviderShellComponent receives change ... renders provider UI", `docs/ADDING_PROVIDERS.md#### Architecture Flow`): does not match; the shell is never instantiated, so completing steps 1 to 9 would not make a new provider appear.
- Step 9 (`EntityInfo` union): matches (`web-app/src/app/core/models/provider-component.interface.ts`).

## shared/

Components: `advanced-filter-panel`, `bulk-actions-toolbar`, `bulk-operation-progress-dialog`, `bulk-operation-results-dialog`, `message-body-editor` (Prism-based, `web-app/src/app/shared/components/message-body-editor/message-body-editor.component.ts#MessageBodyEditorComponent`). Top level: `confirm-dialog`, `bug-report-dialog` and, since 2026-11-13, `bug-report.service`. Pipes: `highlight` only. Since 2026-11-13 the first four are Material and theme tokens, with their styles in their own `.scss` file. The selection bar (`web-app/src/app/shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component.ts#BulkActionsToolbarComponent`) stays on screen: with nothing selected it says "No message selected. Tick rows to resubmit, move, compare, export or delete them.", and with a selection it says what the selection covers, then Delete outlined in the error colour and set apart by a divider, then the routine actions and Clear. The progress and results dialogs keep their text, their states and what they return on close; only the markup changed (`web-app/src/app/shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component.ts#cancel`, `web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts#getFailedSequenceNumbers`). The progress dialog's in-flight, outcome and cancelled states are pinned by `web-app/src/app/shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component.spec.ts#BulkOperationProgressDialogComponent reports the operation in flight, its outcome and a cancel`.
