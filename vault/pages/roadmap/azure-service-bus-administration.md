---
title: "Azure Service Bus: administer the entity, not only look at it"
version: "1.0"
date: 2026-11-12
changes: "Initial initiative page: survey of what exists and what is missing for twelve Azure Service Bus capabilities"
page_type: roadmap
status: active
description: "Work breakdown for the Azure Service Bus capabilities the product lacks next to the reference tool: edit entities, rules, status, definitions export, counts overview, sessions, scheduled and deferred messages, transfer dead-letter, batch send, live view."
updated: 2026-11-12
source:
  - chat
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs"
  - "src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs"
  - "web-app/src/app/features/entities/entity-details.component.ts"
  - "https://github.com/paolosalvatori/ServiceBusExplorer"
reliability: medium
---

# Azure Service Bus: administer the entity, not only look at it

> The product reads and moves messages well and administers almost nothing: no screen creates, edits, disables or deletes a queue, a topic, a subscription or a rule. This page lists, per capability, what the code already has and what has to be built in the provider, the API, the web app and the tests.

## Where this comes from

On 2026-11-12 the owner asked for a comparison with Paolo Salvatori's Service Bus Explorer (Windows, .NET Framework, version 6.3.1) and then for "the survey of everything that is necessary to do". The reference tool was read from its README, its feature log and its documentation; this code base was read by two surveys, one of `src/` and one of `web-app/src/app/`, on the commit of release 2.4.0. The entries of [[pages/roadmap/product-backlog]] point here for the detail.

The reference tool supplies ideas only. Three rules the owner set for this work:

- **Current SDKs only.** Everything below uses `Azure.Messaging.ServiceBus` 7.21 and its `ServiceBusAdministrationClient`, `Azure.Identity` and `Azure.Monitor.Query`. Each item names the member it calls; all of them were checked in the installed package. What the reference tool does only through the legacy libraries (WCF bindings, the old REST metrics, Relay, Notification Hubs) is out.
- **Performance is part of the design.** Each item states its round trips, its paging and its bounds. A listing never costs one call per entity.
- **Security is part of the design.** These features change production brokers. Each item states which of Rules A, G and H of the root `CLAUDE.md` it touches, and every disruptive action follows the confirmation of [[pages/conventions/ui]] (name the entity, the connection and its environment; type the name for the destructive ones).

It does not include Event Hubs, Relay, Notification Hubs or Event Grid: a different product. RabbitMQ gains nothing here by itself; every new provider member is declared in `IProviderCapabilities` and refused by the RabbitMQ provider ([[pages/invariants/provider-boundaries]]).

## What the surveys corrected

Four things the vault or the conversation had wrong, found while surveying:

- **No screen creates or deletes an entity.** The provider and the API can (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:57`), and the Angular services have the methods, but nothing calls them (`web-app/src/app/core/services/queue.service.ts:44`, `web-app/src/app/core/services/queue.service.ts:53`, `web-app/src/app/core/services/topic.service.ts:48`, `web-app/src/app/core/services/topic.service.ts:112`). There is no create dialog in the app.
- **The topic panel looked editable and saved nothing. Fixed 2026-11-12.** Its form had live inputs and toggles and no submit path, so an edit was discarded in silence; the panel is read-only text now.
- **The metrics dashboard drew random numbers** and could not be reached. Removed 2026-11-12, with its two unreachable tabs. The real metrics service of the API still has no consumer in the app.
- **No capability flag hid anything.** Since 2026-11-12 `ProviderService` follows the active connection and sessions, scheduled messages and the dead-letter side are hidden where the flag is explicitly false (`web-app/src/app/features/entities/entity-details.component.ts:2393`). The provider registry and the provider shell are still mounted nowhere (`web-app/src/app/features/entities/entities-container.component.ts:17`); one shared panel serves both brokers.

## Foundations (before any item)

Each of these is needed by several items; doing them first keeps the items small.

- **F1. The queue read path reads the queue's configuration.** `GetQueueAsync` calls only the runtime properties (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:158`), so lock duration, time to live, max delivery count, max size, sessions and dead-lettering on expiration come back as zero or false (`src/ServiceBusExplorer.Core/Models/QueueInfo.cs:24`), and status is never filled. Read `QueueProperties` beside the runtime properties, the way the topic and the subscription already do (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:250`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:395`), and add the missing fields to `QueueInfo` (forward to, forward dead-lettered to, auto delete on idle, batched operations, user metadata, duplicate detection, max message size, transfer and transfer dead-letter counts). This is the queue details defect already pinned by an integration test ([[pages/roadmap/code-audit-2026-11]]). Cost: two calls in parallel for one queue; the list stays on the single paged enumeration (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:144`).
- **F2. Create accepts options through the API.** The option models exist (`src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:310`, `src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:361`, `src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:403`) and the routes take a name only (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:332`), so the options overloads are unreachable. Give the create routes a typed body, validated at the boundary.
- **F3. Capabilities gate the UI. Done 2026-11-12 for what exists:** the connected provider's capabilities reach `ProviderService` (`web-app/src/app/core/services/provider.service.ts:103`) and hide what the broker cannot do, so the new Azure-only screens can be gated the same way. Still open: delete or mount the unused provider registry and the two provider-specific detail components, which look like the extension point and are dead code; that takes an ADR.
- **F4. A sub-queue is a value, not a boolean.** Every message operation takes `bool isDeadLetter` and appends the path by hand (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:592`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:690`). Replace it with a three-value type (active, dead-letter, transfer dead-letter) mapped to `SubQueue`, across the interface (`src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:189`), the provider and both controllers. Behaviour lock: the existing unit and integration suites.
- **F5. A message says what state it is in and how big it is.** `MessageInfo` has no state and no size (`src/ServiceBusExplorer.Core/Models/MessageInfo.cs:42`). Map `ServiceBusReceivedMessage.State` (active, deferred, scheduled) and the body length where the message is mapped (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1697`). No extra call.

## The items

Each item lists what exists, what to build by layer, the SDK members, and its cost and risk. "Tests" always means: unit tests in the two unit projects, one failing-call test per new broker call (Rule I), a test against the emulator in `src/ServiceBusExplorer.IntegrationTests` where the emulator supports the call, and a spec for every new component.

### 1. Edit an existing queue, topic or subscription

- **Exists:** full configuration read for one topic and one subscription; nothing writes. No update member in the interface and no PUT route for entities.
- **Core:** `UpdateQueueAsync`, `UpdateTopicAsync`, `UpdateSubscriptionAsync` on `IMessagingProvider`, each taking an options object of the editable properties only: time to live, lock duration, max delivery count, forward to, forward dead-lettered to, max size, auto delete on idle, dead-lettering on expiration, batched operations, user metadata, duplicate detection window. The Azure implementation reads the properties, changes the named fields and calls `ServiceBusAdministrationClient.UpdateQueueAsync` (and the topic and subscription equivalents). Properties the broker fixes at creation (partitioning, sessions, duplicate detection on or off) are not offered.
- **API:** `PUT api/queues/{name}`, `PUT api/topics/{name}`, `PUT api/topics/{topic}/subscriptions/{subscription}`, behind the key middleware like every route ([[pages/invariants/local-authenticated-api]]).
- **Web:** an edit dialog per entity kind in Angular Material, opened from the details panel; the topic form that saves nothing is replaced by it. Create dialogs for the three kinds come with it, since they share the fields (F2).
- **Performance:** one read and one write per save; the read supplies the entity tag the update needs, so a concurrent change is refused by the broker instead of overwritten.
- **Security:** an update is disruptive (a shorter lock or a new forward target changes delivery at once). Confirmation shows old and new value per changed field. A forward target is chosen from the entities of the same namespace, never typed as a URL.
- **Depends on:** F1, F2, F3.

### 2. Subscription rules

- **Exists:** rules are read with the subscription (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:406`) and mapped for SQL, correlation, true and false filters (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:536`); the mapper keeps only the correlation id and the application properties of a correlation filter. The app shows them read-only without the filter type (`web-app/src/app/features/entities/entity-details.component.ts:497`). Creation with a filter deletes `$Default` and adds one rule under a fixed name (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:458`), a path no route reaches.
- **Core:** `GetRulesAsync`, `CreateRuleAsync`, `UpdateRuleAsync`, `DeleteRuleAsync`, with a typed rule model: filter kind (SQL, correlation, true, false), the SQL expression, every correlation field (correlation id, message id, to, reply to, subject, session id, reply to session id, content type, application properties) and an optional SQL action. Members: `ServiceBusAdministrationClient.GetRulesAsync`, `CreateRuleAsync`, `UpdateRuleAsync`, `DeleteRuleAsync`.
- **API:** `GET`, `POST`, `PUT`, `DELETE` under `api/topics/{topic}/subscriptions/{subscription}/rules`.
- **Web:** a rules editor in the subscription panel's Rules tab: list with filter type, add, edit, delete.
- **Performance:** rules are paged by the SDK; a subscription has few. No call per rule.
- **Security:** deleting the last rule stops delivery to the subscription, and replacing `$Default` with a narrower filter drops messages in silence at the broker. Both get a confirmation that says so. A SQL expression is sent to the broker as data, never interpolated into anything local.
- **Depends on:** F3.

### 3. Entity status

- **Exists:** `Status` is a string on the three models (`src/ServiceBusExplorer.Core/Models/QueueInfo.cs:16`), filled only for one topic and one subscription (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:365`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:529`). Shown as text for topics and subscriptions, never for queues, never in the tree.
- **Core:** status filled on every read path (F1 covers the queue); one `SetEntityStatusAsync` per entity kind or a status field on the update options of item 1. Values: `EntityStatus.Active`, `Disabled`, `SendDisabled`, `ReceiveDisabled`.
- **API:** part of the PUT of item 1, or `PUT .../status`.
- **Web:** a status chip in the panel header and a marker in the tree; a menu to change it.
- **Performance:** the list paths are runtime-only and carry no status (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:235`). Showing status in the tree needs the configuration enumeration as a second paged call run in parallel with the first, not one call per entity.
- **Security:** disabling a production queue is an incident-grade action: typed-name confirmation, and the panel keeps showing a disabled entity as disabled so it is not forgotten.
- **Depends on:** F1, item 1.

### 4. Export and import of entity definitions

- **Exists:** nothing for entities. Connections export with secrets masked by default (`web-app/src/app/features/connections/export-connections-dialog.component.ts:30`), which is the model to follow for the dialog.
- **Core:** a service that reads every queue, topic, subscription and rule with full configuration and writes one versioned JSON document; and one that reads such a document and creates what does not exist. No secret is part of an entity definition.
- **API:** `POST api/namespace/export`, `POST api/namespace/import` (with a dry run that answers what would be created, what already exists and what differs).
- **Web:** Export and Import in the tree header; the import shows the dry run before anything is created.
- **Performance:** export is the two paged enumerations per kind plus one rules enumeration per subscription; on a large namespace this is the slowest read in the product, so it runs with bounded parallelism, reports progress and honours cancellation.
- **Security:** import only creates. It never updates or deletes an existing entity, and it names the target connection and environment in its confirmation. An imported document is untrusted input: validated against the schema, names and sizes bounded.
- **Depends on:** F1, F2, items 1 and 2.

### 5. Counts of every entity on one screen

- **Exists:** a background service polls every 30 seconds, fixed (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs:33`), and keeps 120 snapshots in memory (`src/ServiceBusExplorer.Api/Monitoring/MonitoringStore.cs:7`). The monitoring screen shows totals, a chart and two tables with dead-letter rows tinted (`web-app/src/app/features/monitoring/monitoring.component.ts:159`, `web-app/src/app/features/monitoring/monitoring.component.ts:214`). Subscriptions carry no scheduled count and nobody carries the transfer dead-letter count (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs:79`).
- **Core and API:** add the missing counts to the snapshot; make the interval a setting with a floor; an on-demand refresh of one entity.
- **Web:** sorting by column, a name filter, a click from a row to the entity, user thresholds for the dead-letter highlight. The mock metrics tab is gone; wiring the real metrics service to a screen is the owner's open decision.
- **Performance:** the poll costs one enumeration per topic for subscriptions (`src/ServiceBusExplorer.Api/Monitoring/MonitoringBackgroundService.cs:68`); it must stay bounded in parallelism and skip a cycle when the previous one has not finished.
- **Security:** read-only. The interval floor prevents the tool from hammering a production namespace.

### 6. Sessions

- **Exists:** listing and state write in the provider and the API (`src/ServiceBusExplorer.Api/Controllers/SessionsController.cs:32`, `src/ServiceBusExplorer.Api/Controllers/SessionsController.cs:68`). The app lists sessions for subscriptions only and reads state; the state writers and the queue lister have no caller (`web-app/src/app/core/services/session.service.ts:19`, `web-app/src/app/core/services/session.service.ts:25`).
- **Defect to fix first:** listing accepts and locks each session in turn under a ten second budget (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1740`). On a busy entity that takes sessions away from the real consumers while the list loads, and it returns only the sessions it managed to lock. The current SDK has no passive session enumeration, so the screen must say that listing locks, release each lock immediately, and keep the bound.
- **Core:** peek the messages of one session: `ServiceBusClient.AcceptSessionAsync` then `PeekMessagesAsync` on the session receiver, lock released at once. An optional session id on peek, or a dedicated member.
- **API and web:** the route; a Sessions tab on the queue panel; the messages of one session; an editor for the state with a confirmation.
- **Security:** writing session state changes what the consuming application reads next: confirmation, and the old state shown beside the new.

### 7. Scheduled and deferred messages

- **Exists:** a message can be scheduled on send (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1683`); the count shows on the queue. Nothing lists, cancels or marks them. `SupportsDeferral` is declared true (`src/ServiceBusExplorer.Core/Providers/Azure/AzureProviderCapabilities.cs:75`) and nothing defers; the only deferral call sits in a dead-letter method no route reaches (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:795`).
- **Core:** F5 gives the state. `CancelScheduledMessagesAsync` on the interface, calling `ServiceBusSender.CancelScheduledMessagesAsync` with the sequence numbers a peek returned. Either implement deferral (`DeferMessageAsync`, `ReceiveDeferredMessagesAsync`) or set the capability to false; a flag that promises what no code does breaks [[pages/invariants/provider-boundaries]].
- **API and web:** `DELETE .../messages/scheduled`; a Scheduled filter in the messages dialog and a cancel action; the scheduled time in the detail pane.
- **Performance:** scheduled messages come from the same bounded peek as today (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:699`); no second scan.
- **Security:** cancelling a scheduled message deletes it. It follows [[pages/invariants/bulk-operations-are-at-least-once]]: every failure reported per sequence number, the caller's token honoured.
- **Depends on:** F5.

### 8. Transfer dead-letter queue

- **Exists:** a count on the subscription model only (`src/ServiceBusExplorer.Core/Models/SubscriptionInfo.cs:11`), rendered nowhere. No operation can address the sub-queue.
- **Build:** F4 is the whole backend change. Web: a third tab in the messages dialog and a card in the panel when the count is above zero.
- **Security:** resubmitting from the transfer dead-letter queue is a move like any other and follows Rule H.
- **Depends on:** F1, F4.

### 9. Send many messages

- **Exists:** a batch send that hands the whole list to one SDK call, with no split by size (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:754`), reachable for queues only (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:154`) and with no cap on the count. The size-aware split already exists for resubmit (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1386`).
- **Build:** split with `ServiceBusSender.CreateMessageBatchAsync` and `TryAddMessage`; a cap on the count at the API boundary; the topic route; in the send dialog a count and a placeholder for a sequence value.
- **Performance:** one sender for the whole operation, batches filled to the size limit, progress and cancellation.
- **Security:** a generator pointed at production is a flood. Hard cap, confirmation above a threshold that names the entity and the environment, and a failure report per batch.

### 10. Live view of arriving messages

- **Exists:** nothing streams. The subscription panel polls the entity's counts every three seconds (`web-app/src/app/features/entities/transfer-monitor.component.ts:243`).
- **Build, if wanted:** a live tail that polls a peek from the last seen sequence number. Not a receiver: a `ServiceBusProcessor` would take messages away from the real consumers.
- **Performance:** poll interval with a floor, stops when the dialog closes or the window is hidden.
- **Recommendation:** last. It is the least asked for and the easiest to misuse.

### 11. Small ones

- **Sort the message list.** The list is a virtual scroll of cards (`web-app/src/app/features/messages/view-messages-dialog.component.ts:162`); sorting loaded messages by sequence, time, delivery count or size is client side once F5 lands.
- **Copy the body.** The copy action exists in a component no template uses (`web-app/src/app/shared/components/message-body-editor/message-body-editor.component.ts:564`); add it to the detail pane, which also omits session id, subject, to, reply to, scheduled time and expiry (`web-app/src/app/features/messages/view-messages-dialog.component.ts:308`).
- **Filter the tree by name.** Client side over the loaded tree (`web-app/src/app/features/entities/entities-tree.component.ts:17`). A server-side filter comes only if a namespace is too large to list; the list calls take no parameter today (`src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:73`).
- **Dates on the queue panel.** Created, updated and accessed are already returned (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:219`) and shown for topics and subscriptions only.

### 12. Sovereign clouds

- **Exists:** the interactive credential names the public cloud (`src/ServiceBusExplorer.Core/Providers/Azure/AzureCredentialFactory.cs:54`); the other credentials take the SDK default; the metrics client has no endpoint setting (`src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs:72`). The dialog offers four of the five credential types: the default credential is in the model and not in the list (`web-app/src/app/features/connections/add-connection-dialog.component.ts:482`).
- **Build:** a cloud field on the connection (public, US Government, China), mapped to the authority host for every credential and to the Monitor endpoint; a fixed list, never a free URL. Offer the fifth credential type or remove it from the model.
- **Security:** an authority host typed by hand would send a sign-in to an arbitrary server; that is why it is a list. The new field is not a secret and stays out of the mask ([[pages/invariants/secrets-masked-at-the-api-boundary]]).
- **Priority:** only on request. No user has asked.

## Order

1. **F1, F3, F5** and the two honest removals (the topic form that saved nothing, the mock metrics). Done on 2026-11-12, with the duration parser that read days as one minute.
2. **F2, item 1, item 3.** Create, edit, status: one dialog family, one update call.
3. **Item 2.** Rules.
4. **F4, item 8, item 7.** Sub-queues and message states.
5. **Item 6**, starting with the session listing defect.
6. **Item 5**, then **item 4**, which needs everything above to recreate an entity faithfully.
7. **Items 9, 11** as fillers; **10** and **12** only if asked.

Each step is a pipeline lane of its own with its tests and its review lenses; items 1 to 4 and 7 to 9 touch production state and take the `message-safety` or `api-surface` lens. The screens are drawn first in the prototype ([[pages/roadmap/ui-review-2026-11]]) and built in Angular Material ([[pages/roadmap/ui-material-migration]]).

## Open questions for the owner

- Deferral: implement it, or declare it unsupported?
- The metrics tab: wire it to Azure Monitor (it needs the subscription and resource group, which the connection does not carry) or remove it?
- Import of definitions: create only, as proposed, or also update existing entities?
