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

- **No screen created or deleted an entity.** Create arrived on 2026-11-12 with edit and status (items 1 and 3 below): a create action on the tree (`web-app/src/app/features/entities/entities-tree.component.ts:837`). No screen deletes one yet; the API can and nothing calls it.
- **The topic panel looked editable and saved nothing. Fixed 2026-11-12.** Its form had live inputs and toggles and no submit path, so an edit was discarded in silence; the panel is read-only text now.
- **The metrics dashboard drew random numbers** and could not be reached. Removed 2026-11-12, with its two unreachable tabs. The real metrics service of the API still has no consumer in the app.
- **No capability flag hid anything.** Since 2026-11-12 `ProviderService` follows the active connection and sessions, scheduled messages and the dead-letter side are hidden where the flag is explicitly false (`web-app/src/app/features/entities/entity-details.component.ts:1882`). The provider registry and the provider shell are still mounted nowhere (`web-app/src/app/features/entities/entities-container.component.ts:17`); one shared panel serves both brokers.

## Foundations (before any item)

Each of these is needed by several items; doing them first keeps the items small.

- **F1. The queue read path reads the queue's configuration. Done 2026-11-12.** `GetQueueAsync` read only the runtime properties, so lock duration, time to live, max delivery count, max size, sessions, dead-lettering on expiration and status came back as zero, false or empty. It now reads the configuration and the runtime properties in parallel, two calls, and maps both (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:169`); `QueueInfo` carries forward to, forward dead-lettered to, auto delete on idle, batched operations, user metadata, duplicate detection, max message size and the transfer dead-letter count. The list stays on the single paged enumeration (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:151`) and therefore still carries configuration at its defaults.
- **F2. Create accepts options through the API. Done 2026-11-12.** The three POST routes take `{ name, options }` with typed fields only (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:57`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:57`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:162`); a body with only a name creates as before. Creating an entity that exists answers 409 where it answered 500.
- **F3. Capabilities gate the UI. Done 2026-11-12 for what exists:** the connected provider's capabilities reach `ProviderService` (`web-app/src/app/core/services/provider.service.ts:115`) and hide what the broker cannot do, so the new Azure-only screens can be gated the same way. Still open: delete or mount the unused provider registry and the two provider-specific detail components, which look like the extension point and are dead code; that takes an ADR.
- **F4. A sub-queue is a value, not a boolean. Done 2026-11-12.** `MessageSubQueue` (active, dead-letter, transfer dead-letter, `src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:418`) replaces `bool isDeadLetter` on every message operation of the interface, and in the Azure provider one helper, `CreateReceiver`, builds the receiver for a sub-queue through the SDK's own `SubQueue` option (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1002`) where each operation appended the path by hand. Both controllers route the active, dead-letter and transfer dead-letter variants of an operation through one private action (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:163`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:360`). In the web app the dialog's boolean became one `subQueue` value derived from the tab (`web-app/src/app/features/messages/view-messages-dialog.component.ts:1111`), and the selection service keeps one selection per tab, now three. Behaviour lock: the existing unit and integration suites, green before and after.
- **F5. A message says what state it is in and how big it is. Done 2026-11-12.** `MessageInfo` and `IMessage` carry the state (active, deferred, scheduled) and the body size in bytes, mapped where the message is mapped (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2233`). No extra call. A scheduled message did not show in a peek until the peek stopped ending at the first short batch, fixed on 2026-11-12 with item 7 ([[pages/roadmap/code-audit-2026-11]]).

## The items

Each item lists what exists, what to build by layer, the SDK members, and its cost and risk. "Tests" always means: unit tests in the two unit projects, one failing-call test per new broker call (Rule I), a test against the emulator in `src/ServiceBusExplorer.IntegrationTests` where the emulator supports the call, and a spec for every new component.

### 1. Edit an existing queue, topic or subscription

**Done 2026-11-12, with create and status.** `PATCH` on the three entity routes (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:84`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:84`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:189`): a field that is absent stays as it is, an empty forward target clears it. The Azure provider reads once, changes only what was sent and writes once (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:257`); its limits are checked before the broker is called and a refusal never carries the broker's text. The capability `SupportsEntityUpdate` (`src/ServiceBusExplorer.Core/Abstractions/IProviderCapabilities.cs:99`) is false for RabbitMQ, whose update members throw. In the app: a form dialog for create and edit, a review of the changed fields before saving, shown only when the API itself says the capability is true. What was planned and found, kept below for the record:

- **Exists:** full configuration read for one topic and one subscription; nothing writes. No update member in the interface and no PUT route for entities.
- **Core:** `UpdateQueueAsync`, `UpdateTopicAsync`, `UpdateSubscriptionAsync` on `IMessagingProvider`, each taking an options object of the editable properties only: time to live, lock duration, max delivery count, forward to, forward dead-lettered to, max size, auto delete on idle, dead-lettering on expiration, batched operations, user metadata, duplicate detection window. The Azure implementation reads the properties, changes the named fields and calls `ServiceBusAdministrationClient.UpdateQueueAsync` (and the topic and subscription equivalents). Properties the broker fixes at creation (partitioning, sessions, duplicate detection on or off) are not offered.
- **API:** `PUT api/queues/{name}`, `PUT api/topics/{name}`, `PUT api/topics/{topic}/subscriptions/{subscription}`, behind the key middleware like every route ([[pages/invariants/local-authenticated-api]]).
- **Web:** an edit dialog per entity kind in Angular Material, opened from the details panel; the topic form that saves nothing is replaced by it. Create dialogs for the three kinds come with it, since they share the fields (F2).
- **Performance:** one read and one write per save, and one more read to return the entity. **The update is last write wins:** the SDK sends `If-Match: *` and the property types carry no entity tag (read in the SDK's code, 7.21), so a change made by someone else between the read and the write is overwritten without notice. The review step shows the values read when the dialog opened.
- **Security:** an update is disruptive (a shorter lock or a new forward target changes delivery at once). Confirmation shows old and new value per changed field. A forward target is chosen from the entities of the same namespace, never typed as a URL.
- **Depends on:** F1, F2, F3.

### 2. Subscription rules

**Done 2026-11-12.** Four routes under `api/topics/{topic}/subscriptions/{subscription}/rules` (`src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:224`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:245`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:267`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:291`): list, add, replace, delete. A rule is typed: SQL, correlation, true or false, an optional SQL action, and for a correlation filter the eight system fields and application properties as name, type and value, the value always text, so nothing untyped crosses the API. The Azure provider validates before calling the broker, replaces with one read and one write (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:916`), and answers a rule the broker refuses with a fixed text. The capability `SupportsSubscriptionRules` is false for RabbitMQ, whose bindings still read as a read-only routing key rule. In the app: a rules table with add, edit and delete (`web-app/src/app/features/entities/subscription-rules.component.ts`), where a list that failed to load never looks like "no rule" and deleting the last rule asks for its name. Two defects on the same surface were fixed with it ([[pages/roadmap/code-audit-2026-11]]). What was planned and found, kept below for the record:

- **Exists:** rules are read with the subscription (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:622`) and mapped for SQL, correlation, true and false filters (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:796`); the mapper keeps only the correlation id and the application properties of a correlation filter. The app shows them read-only without the filter type (`web-app/src/app/features/entities/entity-details.component.ts:661`). Creation with a filter deletes `$Default` and adds one rule under a fixed name (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:645`), a path no route reaches.
- **Core:** `GetRulesAsync`, `CreateRuleAsync`, `UpdateRuleAsync`, `DeleteRuleAsync`, with a typed rule model: filter kind (SQL, correlation, true, false), the SQL expression, every correlation field (correlation id, message id, to, reply to, subject, session id, reply to session id, content type, application properties) and an optional SQL action. Members: `ServiceBusAdministrationClient.GetRulesAsync`, `CreateRuleAsync`, `UpdateRuleAsync`, `DeleteRuleAsync`.
- **API:** `GET`, `POST`, `PUT`, `DELETE` under `api/topics/{topic}/subscriptions/{subscription}/rules`.
- **Web:** a rules editor in the subscription panel's Rules tab: list with filter type, add, edit, delete.
- **Performance:** rules are paged by the SDK; a subscription has few. No call per rule.
- **Security:** deleting the last rule stops delivery to the subscription, and replacing `$Default` with a narrower filter drops messages in silence at the broker. Both get a confirmation that says so. A SQL expression is sent to the broker as data, never interpolated into anything local.
- **Depends on:** F3.

### 3. Entity status

**Done 2026-11-12** for one entity: the status travels in the same `PATCH` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:298`), each kind accepts only its own values, the panel shows a status chip, and any value other than Active needs the entity's name typed. Not done: the marker in the tree, which needs the configuration enumeration described under Performance below.

- **Exists:** `Status` is a string on the three models (`src/ServiceBusExplorer.Core/Models/QueueInfo.cs:16`), filled only for one topic and one subscription (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:581`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:789`). Shown as text for topics and subscriptions, never for queues, never in the tree.
- **Core:** status filled on every read path (F1 covers the queue); one `SetEntityStatusAsync` per entity kind or a status field on the update options of item 1. Values: `EntityStatus.Active`, `Disabled`, `SendDisabled`, `ReceiveDisabled`.
- **API:** part of the PUT of item 1, or `PUT .../status`.
- **Web:** a status chip in the panel header and a marker in the tree; a menu to change it.
- **Performance:** the list paths are runtime-only and carry no status (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:394`). Showing status in the tree needs the configuration enumeration as a second paged call run in parallel with the first, not one call per entity.
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

**API side done 2026-11-13.** The listing defect is fixed: a plain receiver can peek a session-enabled queue or subscription, returning the messages of every session with their session id and locking none, which was verified on the emulator (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusSessionTests.cs:79`). So the list is a bounded passive peek grouped by session id and accepts nothing (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2308`). Only opening one session accepts it, waits at most five seconds and releases it before the answer. Eight routes replace the four under `api/sessions`: list, detail, messages and state write under `api/queues/{name}/sessions` and `api/topics/{topic}/subscriptions/{subscription}/sessions` ([[pages/services/api]]). The state write compares the state the caller was shown and answers 409 with `code` `SessionStateChanged` when it changed, writing nothing; a session in use answers 409 with `code` `SessionInUse`. A state that is not UTF-8 is shown as base64 and refused for editing. Every SDK call has a failing-call test, and the emulator tests include the regression test: a session a consumer holds is still listed and the consumer keeps its lock (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusSessionTests.cs:112`). Details on [[pages/services/core]].

- **Web, done 2026-11-13,** against the route contract shared with the API lane (four routes per queue and per subscription under `.../sessions`; the old `api/sessions` routes removed): one `entity-sessions` component in a Sessions tab of the queue panel and of the subscription panel, created only when the tab opens. A passive list with the scan's truncation notice and the lock notice, a session opened by id (1 to 128 characters), its state and its messages read one call after the other, read-only; a state editor whose confirmation shows the old state beside the new and whose write carries the state as read, so a state changed meanwhile is refused and the dialog offers Reload instead of writing again (`web-app/src/app/features/entities/entity-sessions.component.ts:255`, `web-app/src/app/features/entities/session-state-dialog.component.ts:152`). Detail on [[pages/services/web-app]].
- **Security:** writing session state changes what the consuming application reads next: confirmation, and the old state shown beside the new.

### 7. Scheduled and deferred messages

**Done 2026-11-12 for the cancel of scheduled messages on queues.** `POST api/queues/{name}/messages/cancel-scheduled` with `{ sequenceNumbers }` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:241`), where a `DELETE .../messages/scheduled` was planned: 1 to 500 numbers, validated in the provider before any broker call (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2104`); one broker call when all are scheduled and a fallback of one call per number otherwise, at most 501 calls (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2139`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2163`); the result in the delete-batch shape, per sequence number; a failure is one of three fixed sentences, and one warning line is logged per request (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2126`). It follows [[pages/invariants/bulk-operations-are-at-least-once]], the caller's token included. In the app: a state chip on each Scheduled or Deferred message (`web-app/src/app/features/messages/view-messages-dialog.component.ts:206`), a "Scheduled" filter over the loaded messages (`web-app/src/app/features/messages/view-messages-dialog.component.ts:1291`), and Cancel scheduled, enabled only when the whole selection is scheduled and holds at most 500 (`web-app/src/app/features/messages/view-messages-dialog.component.ts:2051`), with a confirmation that needs the queue name typed for more than one message (`web-app/src/app/features/messages/cancel-scheduled-dialog.component.ts:77`). The peek that lists them was fixed with it: it no longer stops at the first short batch (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1175`), so a scheduled message behind an active one is listed. On the emulator a cancel that mixes in a number that is not scheduled cancels none and fails every number (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:87`); real Azure was not verified.

**Not done:** deferral is declared unsupported, not implemented (`SupportsDeferral` is false, `src/ServiceBusExplorer.Core/Providers/Azure/AzureProviderCapabilities.cs:76`; a deferred message already in a queue is still shown with its state); scheduled messages on topics, which have no cancel route; and a listing of scheduled messages from the broker, the "Scheduled" view being a filter of what the peek loaded ([[pages/roadmap/followups]]). What was planned and found, kept below for the record:

- **Exists:** a message can be scheduled on send (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2219`); the count shows on the queue. Nothing lists, cancels or marks them. `SupportsDeferral` was declared true (false since 2026-11-12, `src/ServiceBusExplorer.Core/Providers/Azure/AzureProviderCapabilities.cs:76`) and nothing defers; the only deferral call sits in a dead-letter method no route reaches (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1247`).
- **Core:** F5 gives the state. `CancelScheduledMessagesAsync` on the interface, calling `ServiceBusSender.CancelScheduledMessagesAsync` with the sequence numbers a peek returned. Either implement deferral (`DeferMessageAsync`, `ReceiveDeferredMessagesAsync`) or set the capability to false; a flag that promises what no code does breaks [[pages/invariants/provider-boundaries]].
- **API and web:** `DELETE .../messages/scheduled`; a Scheduled filter in the messages dialog and a cancel action; the scheduled time in the detail pane.
- **Performance:** scheduled messages come from the same bounded peek as today (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1175`); no second scan.
- **Security:** cancelling a scheduled message deletes it. It follows [[pages/invariants/bulk-operations-are-at-least-once]]: every failure reported per sequence number, the caller's token honoured.
- **Depends on:** F5.

### 8. Transfer dead-letter queue

**Done 2026-11-12.** Eight routes mirror the dead-letter peek, search, delete-batch and resubmit-batch, four for a queue (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:159`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:126`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:360`, `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:297`) and four for a subscription (`src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:356`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:322`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:494`, `src/ServiceBusExplorer.Api/Controllers/TopicsController.cs:429`). The capability `SupportsTransferDeadLetter` (`src/ServiceBusExplorer.Core/Abstractions/IProviderCapabilities.cs:114`) is true for Azure and false for RabbitMQ, which refuses the sub-queue, and the API answers 400 without calling such a provider (`src/ServiceBusExplorer.Api/Controllers/EntityAdministrationResults.cs:29`). There is no purge and no move for it, and its delete-batch refuses `all: true` (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:370`). A resubmit from it runs the same send-first cycle as the dead-letter one (Rule H). In the app: a third tab in the messages dialog, shown only when the API explicitly says so (`web-app/src/app/features/messages/view-messages-dialog.component.ts:83`), and a Transfer Dead Letter card on the queue and subscription panels when the count is above zero (`web-app/src/app/features/entities/entity-details.component.ts:110`, `web-app/src/app/features/entities/entity-details.component.ts:353`). On the emulator the transfer dead-letter queue of a subscription cannot be read and no real transfer dead-letter message could be produced, so those paths have unit and API tests only ([[pages/conventions/testing]]). What was planned and found, kept below for the record:

- **Exists:** a count on the subscription model only (`src/ServiceBusExplorer.Core/Models/SubscriptionInfo.cs:11`), rendered nowhere. No operation can address the sub-queue.
- **Build:** F4 is the whole backend change. Web: a third tab in the messages dialog and a card in the panel when the count is above zero.
- **Security:** resubmitting from the transfer dead-letter queue is a move like any other and follows Rule H.
- **Depends on:** F1, F4.

### 9. Send many messages

- **Exists:** a batch send that hands the whole list to one SDK call, with no split by size (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1206`), reachable for queues only (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:202`) and with no cap on the count. The size-aware split already exists for resubmit (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1828`).
- **Build:** split with `ServiceBusSender.CreateMessageBatchAsync` and `TryAddMessage`; a cap on the count at the API boundary; the topic route; in the send dialog a count and a placeholder for a sequence value.
- **Performance:** one sender for the whole operation, batches filled to the size limit, progress and cancellation.
- **Security:** a generator pointed at production is a flood. Hard cap, confirmation above a threshold that names the entity and the environment, and a failure report per batch.

### 10. Live view of arriving messages

- **Exists:** nothing streams. The subscription panel polls the entity's counts every three seconds (`web-app/src/app/features/entities/transfer-monitor.component.ts:243`).
- **Build, if wanted:** a live tail that polls a peek from the last seen sequence number. Not a receiver: a `ServiceBusProcessor` would take messages away from the real consumers.
- **Performance:** poll interval with a floor, stops when the dialog closes or the window is hidden.
- **Recommendation:** last. It is the least asked for and the easiest to misuse.

### 11. Small ones

- **Sort the message list.** The list is a virtual scroll of cards (`web-app/src/app/features/messages/view-messages-dialog.component.ts:191`); sorting loaded messages by sequence, time, delivery count or size is client side once F5 lands.
- **Copy the body.** The copy action exists in a component no template uses (`web-app/src/app/shared/components/message-body-editor/message-body-editor.component.ts:564`); add it to the detail pane, which also omits session id, subject, to, reply to, scheduled time and expiry (`web-app/src/app/features/messages/view-messages-dialog.component.ts:441`).
- **Filter the tree by name.** Client side over the loaded tree (`web-app/src/app/features/entities/entities-tree.component.ts:33`). A server-side filter comes only if a namespace is too large to list; the list calls take no parameter today (`src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:73`).
- **Dates on the queue panel.** Created, updated and accessed are already returned (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:345`) and shown for topics and subscriptions only.

### 12. Sovereign clouds

- **Exists:** the interactive credential names the public cloud (`src/ServiceBusExplorer.Core/Providers/Azure/AzureCredentialFactory.cs:54`); the other credentials take the SDK default; the metrics client has no endpoint setting (`src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs:72`). The dialog offers four of the five credential types: the default credential is in the model and not in the list (`web-app/src/app/features/connections/add-connection-dialog.component.ts:482`).
- **Build:** a cloud field on the connection (public, US Government, China), mapped to the authority host for every credential and to the Monitor endpoint; a fixed list, never a free URL. Offer the fifth credential type or remove it from the model.
- **Security:** an authority host typed by hand would send a sign-in to an arbitrary server; that is why it is a list. The new field is not a secret and stays out of the mask ([[pages/invariants/secrets-masked-at-the-api-boundary]]).
- **Priority:** only on request. No user has asked.

## Order

1. **F1, F3, F5** and the two honest removals (the topic form that saved nothing, the mock metrics). Done on 2026-11-12, with the duration parser that read days as one minute.
2. **F2, item 1, item 3.** Create, edit, status: one dialog family, one update call. Done on 2026-11-12, except the status marker in the tree.
3. **Item 2.** Rules. Done on 2026-11-12.
4. **F4, item 8, item 7.** Sub-queues and message states. Done on 2026-11-12, with a clear answer for a disabled entity and a peek that can be cancelled; of item 7, deferral, scheduled messages on topics and a listing from the broker are not done.
5. **Item 6**, starting with the session listing defect. Done on 2026-11-13: the list takes no lock, one session opens with its state and messages, and the state write refuses a state that changed.
6. **Item 5**, then **item 4**, which needs everything above to recreate an entity faithfully.
7. **Items 9, 11** as fillers; **10** and **12** only if asked.

Each step is a pipeline lane of its own with its tests and its review lenses; items 1 to 4 and 7 to 9 touch production state and take the `message-safety` or `api-surface` lens. The screens are drawn first in the prototype ([[pages/roadmap/ui-review-2026-11]]) and built in Angular Material ([[pages/roadmap/ui-material-migration]]).

## Open questions for the owner

- Deferral: implement it, or declare it unsupported? Declared unsupported on 2026-11-12 (item 7); implementing it stays open.
- The metrics tab: wire it to Azure Monitor (it needs the subscription and resource group, which the connection does not carry) or remove it?
- Import of definitions: create only, as proposed, or also update existing entities?
