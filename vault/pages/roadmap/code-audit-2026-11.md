---
title: "Code audit, November 2026"
version: "1.0"
date: 2026-11-12
changes: "Initial tracker: the line-by-line bug hunt of 2026-11-12, by area"
page_type: roadmap
status: active
description: "The findings of the line-by-line read of the back end and the front end on 2026-11-12: bugs by area and severity, then improvements. A tracker; an entry leaves when its fix lands."
updated: 2026-11-12
source:
  - "src/"
  - "web-app/"
  - chat
reliability: medium
---

# Code audit, November 2026

> Five readers each read one area of the code line by line on 2026-11-12, without running it. This page holds what they found that [[pages/roadmap/followups]] did not already record. Nothing here was fixed by the audit.

**How to read an entry.** `CONFIRMED` means the reader verified the code path at the cited line and around it; where the failure also depends on how the broker or an SDK behaves, the entry says so, and that part was not executed. `PLAUSIBLE` means the code allows it and a run is needed to confirm. Severity: P1 loses, duplicates or misdirects messages, leaks a secret, corrupts data or crashes; P2 is a wrong result, a broken feature or a leak; P3 is minor. A fix goes through the bug-fix lane and starts with a test that fails on today's code; a finding that turns out to be intended goes to [[pages/conventions/decisions-that-look-like-defects]].

This page is a tracker: `version` changes only when its shape does.

## Azure Service Bus provider

Path for every entry: `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs`. No entry has a test today. Breaches of [[pages/invariants/bulk-operations-are-at-least-once]] are marked.

### P1

- **A resubmit or a move into an entity with duplicate detection can lose the message** (CONFIRMED in code; the broker rule is from the documentation). The copy keeps the original `MessageId` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1396`). If the target has duplicate detection and that id is still inside its window, the broker accepts the send and drops it; the source is then completed and the result says success. Invariant breach. Fix: read `RequiresDuplicateDetection` of the target first; refuse, or send with a new id and keep the old one in a property.
- **A selective delete or move on an active entity dead-letters messages the user did not select** (CONFIRMED in code; the broker rule is documented). Every scanned message is received in PeekLock and the non-targets are abandoned (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1151`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1572`); each abandon raises the delivery count, and a message can be recycled several times in one scan. On an entity with a low `MaxDeliveryCount`, untouched production messages reach the dead-letter queue. No clean fix on active entities: stop at the first pass beyond the largest target, and warn or block when the source is not a dead-letter queue and the limit is small.

### P2

- **One failed abandon ends the scan.** The abandons run inside the scan's `try` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1151`); a lost lock on a non-target, which is harmless, reports every remaining target as not found. Fix: catch per abandon.
- **A failed send or a cancel leaves the cycle's messages locked** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1337`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1567`), up to 250 plus the prefetch buffer, so an immediate retry does not see them. Fix: abandon in a `finally`, without the caller's token.
- **Only `ServiceBusException` becomes a partial result** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1362`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1592`). A missing Send right on the target throws another type in cycle N and the successes of the earlier cycles are lost: the user sees an error although messages were already moved. Invariant breach (failures not reported per message).
- **The scan assumes messages arrive in sequence order** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1156`). False on partitioned entities and when earlier targets are locked; targets that exist are reported not found.
- **Sending a message with a custom property fails.** `ApplicationProperties` binds as `JsonElement` values and is copied as is (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1690`); the SDK rejects the type. This breaks send and import for any message with a property (CONFIRMED in code and the SDK's message text; not executed).
- **One message with a non-binary AMQP body breaks a whole peek or search**, and binary bodies are shown corrupted (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1702`): the fallback calls the same throwing member, and the base64 branch can never run.
- **A session purge can return success with sessions untouched** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:937`): the idle timeout is re-armed only when a session is accepted, and a caller's cancel is swallowed. A failure answered as success ([[pages/invariants/a-guard-must-be-able-to-fire]]).
- **Selective delete, move and receive fail on session-enabled active entities** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1017`): they open a non-session receiver.
- **Creating a subscription with an invalid filter leaves it with no rule** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:450`), receiving nothing, and a retry fails with "already exists". Fix: the SDK overload that creates subscription and rule together.
- **Peek stops on a short batch** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:734`), which the broker may return while more messages exist; the list is cut short.
- **A send of many messages goes out as one batch** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:760`) and fails entirely when it exceeds one; this is the import path. The size-aware batching already exists for resubmit.
- **Receive completes inside the loop** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:776`): if a complete fails on message k, the earlier ones are already removed and their content is never returned.
- **The session list is cut short** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1761`): each session receiver is disposed before the next accept, the broker can hand back the same session, and the loop stops on the first repeat.
- **The queue details screen shows defaults** for lock duration, max delivery count, sessions, partitioning, size, TTL and status, because `GetQueueAsync` reads only the runtime properties (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:209`). Topics and subscriptions read both.
- **The single resubmit re-reads roughly the first hundred dead-letter messages** (PLAUSIBLE, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:843`), so a message deeper in the queue is sent and never removed. Worse than the recorded gap. Fix: call the bulk path with one element.
- **Prefetch with a short lock duration** (PLAUSIBLE, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:976`): the next batch can arrive with expired locks, so each message is sent and then cannot be completed.
- **Metrics are probably queried on the wrong resource** (PLAUSIBLE, `src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs:351`): a child resource id per queue, where Service Bus publishes on the namespace with an `EntityName` dimension. One real call confirms it.

### P3

- `DeadLetterMessageAsync` can only find deferred messages (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:795`); nothing calls it.
- Search reports `HasMore` on an exactly full last page, runs a user regex with no timeout, and answers an invalid pattern with a 500 (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:604`).
- `ConnectAsync` on a connected provider leaks the old client (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:101`); latent, only fresh instances call it.

### Improvements

- Complete after a successful send without the caller's token, so a cancel between the two cannot make an unreported duplicate.
- A `CancellationToken` on peek, search, send, receive and sessions in `IMessagingProvider`.
- Extract the scan loop shared by delete, resubmit and move before fixing the entries above; each fix is otherwise made three times.
- Log once when the server-side purge falls back to the slow drain.
- Say in the UI, before the user confirms, that a resubmit from a subscription's dead-letter queue publishes to the topic and so reaches every subscription.
- A token cache for the interactive browser credential, which today prompts on every test and every connect.
- The metrics service uses a plain default credential, including the managed identity probe the provider excludes on purpose; and a missing data point is drawn as zero.
- The capability limits (256 KB, 14 days) are wrong for the Premium tier.

### Read and found sound

Entity path building on every operation; send before complete in resubmit and move, with no resend after a failed complete; batch splitting on resubmit; termination of the delete scan; the drain and the server-side purge; no secret in any log template; the credential factory; the provider factory; paging in search; the metrics cache keys and time ranges. The legacy `ServiceBusService` was only skimmed.

## RabbitMQ provider

Paths under `src/ServiceBusExplorer.Core/Providers/RabbitMQ/`. No broker was contacted: requeue position, the `routed` reply, a channel closing on a 404, the quorum delivery limit and `user_id` validation are from RabbitMQ's documented behaviour. The provider has no tests beyond sessions.

### The answer on bulk operations

**They cannot be made safe over the management HTTP API, and they can over the AMQP client the project already references. Turn them off until that is built.** The HTTP `get` has two modes: one acknowledges before the response exists, the other requeues everything; there is no way to hold one message while it is republished. Over AMQP: a dedicated channel per operation with publisher confirms; fetch without acknowledging up to a bounded window; a delete target is acknowledged; a move or resubmit target is published with `mandatory` and a confirm, and only then acknowledged; a failed publish is negatively acknowledged with requeue and reported; non-targets are never republished and return to their place when the channel closes. Positions cannot be made stable, so a peek must emit a key that survives until the action (a hash of id, body, routing key and timestamp fits the existing `long`). Known cost: every held message comes back flagged redelivered. Turning it off needs a capability flag, which does not exist today. This decides the open question on [[pages/roadmap/improvement-plan]], Phase 2.

### P1

- **A republish that reaches no queue counts as success** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:361`): the publish only checks the HTTP status and never reads `routed`. A move to a mistyped or deleted queue loses the message with a success count.
- **A whole batch can vanish with nothing reported** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:669`): one call consumes up to the highest selected position with acknowledge; if it times out or the response fails to parse, all of them are gone and no result exists. Worse than the recorded gap.
- **Positions are counted from the head at execution time, with no identity check** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:673`): if the queue moved since the peek, a different message is deleted or moved. A position beyond the end is skipped with no failure entry.
- **The single resubmit ignores which message was chosen** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:607`): it takes the head of the dead-letter queue.
- **Send guesses exchange or queue from the message subject** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:542`), with no `mandatory` flag or confirm: a send to a fanout exchange with no subject goes to the default exchange and is dropped, and the API answers success.
- **A republish keeps `user_id`** (PLAUSIBLE, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:1078`): the broker validates it against the publishing user, so a message first published by another user would be rejected after it was already consumed.

### P2

- **Peek shows the same message N times** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:510`): get, requeue, get returns the head each time. It also flags a production message as redelivered, and on a quorum queue with a delivery limit a large peek could dead-letter the head (PLAUSIBLE).
- **Peek returns no sequence number, so the bulk UI is broken for RabbitMQ** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:955`): one click checks every row, the request cannot bind, and with exactly one row loaded a delete becomes a full purge behind the "Delete ALL" dialog. The positional bulk paths are reachable only by calling the API directly.
- **One queue declared with `x-message-ttl` breaks every listing** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:583`): a conversion that throws on the JSON value. Queues, topics and the monitoring poll all fail.
- **Opening the dead-letter tab of a queue with no `<queue>.dlq` kills the shared channel** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:502`); every later peek, send, receive and purge fails until reconnect, while `IsConnected` still says true.
- **Sending a message with a custom property fails** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:867`), the same cause as on the Azure side.
- **TLS can never be turned on** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQConnectionConfig.cs:181`): the stored connection has no field for it, so the management password always travels over plain HTTP and TLS-only brokers cannot be reached. Bears on Rule G in spirit: a credential on the wire in clear.
- **Deleting a subscription can remove another binding** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:447`): the match also accepts the routing key.
- **Move on a topic route uses the exchange name as the queue** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:777`) and throws on an empty selection.
- **A timestamp in milliseconds leaves a message stuck unacknowledged** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:919`): the conversion throws between the get and the requeue.
- **A non-ASCII user or password fails every management call** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:72`).
- **Test checks only the management API and connect checks only AMQP** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:73`), so each can pass while the other endpoint is wrong.
- **One channel serves every request** (PLAUSIBLE, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:17`); channels in this client version are not safe for concurrent use.
- **Exchange-to-exchange bindings are listed as subscriptions** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:350`).
- **The dead-letter queue is always assumed to be `<queue>.dlq`**; the queue's real dead-letter exchange is parsed and never used.

### P3

- Capability flags that disagree with behaviour (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProviderCapabilities.cs:46`): dead-lettering, transactions and batching say true and are not implemented; there is no flag for bulk operations. [[pages/invariants/provider-boundaries]]
- The pattern detector never detects publisher confirms and flags names containing "req" or "resp" as RPC (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:363`).
- Binary bodies are decoded as text (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:900`).
- A queue created with dead-lettering on expiry points at an exchange nothing creates (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:180`); not reachable from the API today.

### Improvements

- One bindings call grouped by source instead of one HTTP call per exchange on every monitoring poll; the same for subscriptions.
- A `CancellationToken` and an explicit timeout on every management call; dispose the responses; materialise the lazy lists.
- Show the usable `amq.*` exchanges; surface a per-exchange failure instead of showing zero subscriptions; read the real delivery count; delete the uncalled members.

### Read and found sound

URL escaping of the virtual host and names; no password in any console line or exception; client lifetime and dispose order; a failed connect is cleaned up; 404 handling; the payload round trip through the management API; purge on the right queue.

## API

Read at commit `0369fc4`. The controllers were being edited the same day (error bodies and an exception handler), so this section names files and actions without line numbers; a fix re-reads the action first. Not repeated here: what [[pages/services/api]] already lists.

### P1

- **Deleting a queue whose name ends in `/messages` or `/deadletter` purges a different queue** (PLAUSIBLE; confirm on the emulator). Every `{name}` is one path segment and the web app never encodes names. Service Bus names may contain `/`: the URL the UI builds to delete a queue named `a/messages` is `DELETE /api/queues/a/messages`, which is the purge route of queue `a`. More generally, entities with `/`, spaces, `#`, `?` or `%` in the name get 404s or truncated URLs on every operation. `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs`, `TopicsController.cs`, `SessionsController.cs`; the callers in `web-app/src/app/core/services/`. Fix: encode path segments in the UI, test `%2F` end to end, and make sure no delete-entity URL can equal a purge route.
- **Receive completes one by one after receiving up to 1000 messages**; a failure partway leaves the earlier ones deleted and never returned. Same root as the Azure entry above, reached from `QueuesController` and `TopicsController`.
- **A resubmit from a subscription's dead-letter queue publishes to the topic**, so every subscription whose filter matches receives a copy, including ones that already processed the original. The code comment says it is intended; the UI does not say so. Needs an owner decision: a warning with a confirmation, or a per-subscription route.

### P2

- **Connect answers `connected: true` without contacting Azure.** The client is built lazily, so a rotated key or an unreachable namespace "connects", replaces the previous working provider, and every later call fails. Fix: the same probe the connection test uses, before the swap. `ConnectionsController.Connect`.
- **Deleting a group hides its connections.** The group is removed and the connections keep pointing at it; the UI shows a connection only when its group exists or it has none, so production connections disappear from the screen while still stored. Environments under a deleted client are lost the same way. `ConnectionGroupsController.DeleteGroup`, `FileWorkspaceManager.DeleteGroupAsync`.
- **After switching connection the monitoring endpoints show the previous broker's numbers** for up to 30 seconds, and a collection already running writes them again after the clear. Snapshots carry no connection identity. `MonitoringBackgroundService`.
- **Metrics always query the one namespace in the `AzureMonitor` settings**, not the namespace of the active connection, and the Electron shell sets none: a packaged app always answers 503, and a configured run shows another namespace's series under this one's entity names. `Program.cs`, `MetricsController`.
- **Connect saves after it swaps.** If the save throws the caller gets 500 with the provider already active, and a connection deleted in between is re-added with its secrets. `ConnectionsController.Connect`.
- **The Azure session list may hold one session** (PLAUSIBLE; same entry as on the Azure side).

### P3

- `LastUsedAt` is never persisted; the write in Connect rewrites the workspace for nothing.
- The connection test does not restore masked secrets from the stored record, so testing an unchanged saved connection tests the literal mask (PLAUSIBLE; depends on what the dialog sends).
- The metadata-only comparison on save also omits the management port, the virtual host, the namespace and every service-principal field (extends the recorded gap).
- Group validation exists only on create; update and `import-full` accept a bad type, a missing parent or a group that is its own parent, and a partial update blanks fields. Any of these makes the group vanish from the tree.
- Deleting the connection that is connected leaves the provider active; `status` reports a connection that no longer exists.
- Disconnect can dispose a provider that a concurrent Connect just installed.
- An invalid search regex answers 500 instead of 400, with no timeout on the pattern.
- `import` reads with case-sensitive options: a camelCase file imports as blank connections and reports success (PLAUSIBLE).
- A session-state request with an empty body or a misspelled property clears the state on a production session and answers 200.
- An undefined `timeRange` value answers 500 instead of 400.
- One topic deleted mid-collection aborts the whole monitoring cycle.
- Port configuration: a missing explicit config path falls through silently; the walk up to the filesystem root accepts the first parseable `config.json` even with neither port key; ports are not range-checked.
- `launchSettings.json` listens on 5197 while the Angular dev environment calls 5917.

### Improvements

- A route-table test that fails when two actions can match one method and URL, and one `%2F` test.
- `DeleteBatchRequest.All` deletes whatever the broker holds at that moment; an optional expected count would refuse when the queue grew since the screen loaded.
- Reject a request with more than one `X-Api-Key` value.
- `status` exposes which saved connection is active; a failed connect keeps and reports the previous target.
- Sessions on an entity without sessions returns an empty list instead of an unhandled exception.
- A batch send on topics, which exists only on queues, if import is meant to work there.
- A batch send reports what was sent, not the input size.
- The fail-fast on `API_SECRET` may lose its buffered log line at exit.

### Read and found sound

The key middleware (only `OPTIONS` and `/health` bypass it; `/healthz`, `//health`, dot segments and `%2F` do not); queue and topic parity action by action (dead-letter flag, subscription name, argument order, the request token); no shadowed route inside a controller; clamps on counts; the lock around the provider slot; `FileWorkspaceManager` locking, atomic save and masking; the export and `import-full` round trip; the monitoring store's bound and order; no secret in the settings files.

## Web app: entities, connections, monitoring, shared

### P1

- **A queue name with `#` or `?` turns a purge into a delete of another queue** (CONFIRMED in code; the effect needs such a name). Names are interpolated raw into the URL (`web-app/src/app/core/services/queue.service.ts:35`, the same in `topic.service.ts`; nothing in `web-app/src/app` calls `encodeURIComponent`). For a queue named `orders#1`, the purge request is `DELETE /api/queues/orders#1/messages`; the browser drops the fragment and the server receives `DELETE /api/queues/orders`, which deletes the queue `orders`. The confirmation said "purge". This is the front-end half of the API entry on names with `/`. Fix: encode every segment in one helper in `ApiService`.
- **After switching connection, the entities screen still shows the previous connection's queue with Purge, Send and View enabled** (`web-app/src/app/features/entities/entities-tree.component.ts:670`, `web-app/src/app/core/services/entity-selection.service.ts:67`). The selection is cleared only on disconnect, and the actions go by name to the new connection. Production and staging often share queue names, and the confirmation names neither the entity nor the connection. Fix: clear the selection whenever a connect succeeds or the target changes.
- **The JSON tree in `message-body-editor` allows script injection from a message body** (latent: nothing imports the component today). It builds HTML with `bypassSecurityTrustHtml` and puts the raw JSON key inside an attribute, with an escape that leaves quotes alone (`web-app/src/app/shared/components/message-body-editor/message-body-editor.component.ts:1027`). A key containing a quote adds an event handler. Script in the renderer can read the API secret and export the stored connections with their secrets. Fix: delete the component, or build the tree with DOM nodes, before anything uses it.

### P2

- **The purge confirmation names nothing and counts from a stale snapshot** (`web-app/src/app/features/entities/entity-details.component.ts:3428`): no queue, subscription, topic or connection in the text, and the number is from when the entity was selected while the panel shows live counts. The queues and topics pages do name the entity.
- **Test connection on a saved connection always fails** (`web-app/src/app/features/connections/add-connection-dialog.component.ts:689`): the dialog sends the masked values with no id and the API does not restore them. Confirms the API entry.
- **Deleting a group hides its connections** (`web-app/src/app/features/connections/manage-group-dialog.component.ts:535`). Confirms the API entry from the UI side.
- **A filter on "Enqueued Time" breaks the message dialog** (`web-app/src/app/core/services/advanced-message-filter.service.ts:170`): it calls a `Date` method on what is a string at runtime. The specs use real dates and miss it.
- **Durations of days show as "1 minute"** (`web-app/src/app/features/entities/entity-details.component.ts:3285`): the parser does not handle the `d.hh:mm:ss` form the API emits, so a 14-day TTL and the maximum value both display the fallback. Another parser in the same file handles it.
- **Sessions of the previous subscription are shown under the next one** (`web-app/src/app/features/entities/entity-details.component.ts:3511`): the list is not reset on selection change and is fetched only when empty.
- **A failed load of an entity shows "Loading..." forever, or an empty panel**; the error is never rendered (`web-app/src/app/core/services/entity-selection.service.ts:50`).
- **Counts on the topics page may not repaint after a purge** (PLAUSIBLE, `web-app/src/app/features/topics/topics.component.ts:206`): the app is zoneless and the update mutates an object inside a signal.

### P3

- Listeners for the menu action and for F9 are added on every visit to the connections page and never removed (`web-app/src/app/features/connections/connections.component.ts:425`); after N visits the action runs N times.
- After clear-all or after deleting the connected connection, the header still says connected (`web-app/src/app/features/connections/connections.component.ts:625`).
- The tree loads twice on every visit and can show the previous connection's tree after a switch; a failed load reads as "No Entities Found" (`web-app/src/app/features/entities/entities-tree.component.ts:670`).
- Clicking A then B can display A when A's response arrives last (`web-app/src/app/core/services/entity-selection.service.ts:44`).
- The transfer monitor shows a growing backlog as a processing rate (`web-app/src/app/features/entities/transfer-monitor.component.ts:231`).
- A regex that matches the empty string can freeze the detail view (`web-app/src/app/shared/pipes/highlight.pipe.ts:58`). The pipe itself is safe against injection.
- A new filter row with no value blanks the list under AND (`web-app/src/app/core/services/advanced-message-filter.service.ts:92`); numbers and dates compare as text.
- Editing a RabbitMQ connection with no stored password saves `guest`; no port validation; the signed-in state survives a change of namespace (`web-app/src/app/features/connections/add-connection-dialog.component.ts:544`).
- A RabbitMQ exchange is shown with the Azure topic form and invented defaults; the inputs are editable and there is no save. Capabilities are ignored.
- `metrics-dashboard` renders random series under real metric names and is instantiated, hidden, for every selected topic (`web-app/src/app/features/entities/metrics-dashboard.component.ts:56`); the metrics service falls back to mock data on any error.
- The monitoring page requests history twice on entry (PLAUSIBLE).
- The bug report puts the last error strings in a GitHub URL with no length limit.

### Improvements

- One confirmation builder for destructive actions: entity, parent, connection target, live count, and the typed acknowledgement for purges.
- An environment badge in the header (the group name); today only the namespace string is shown.
- Delete the dead and mock code: `message-body-editor`, `metrics-dashboard`, the mock fallback, the chart leftovers in `entity-details`, the `.backup` file.
- Preload listeners return a disposer; `electron.on` forwards its arguments, which `navigate` and `change-connection` lose today.
- A CSP meta tag in `index.html`; no remote resource exists, so `default-src 'self'` should be feasible.
- Specs with the shapes the API really emits (date strings, `d.hh:mm:ss`).

### Read and found sound

The highlight pipe (escape, then wrap, and a plain string so Angular still sanitises); the confirm and bug-report dialogs; `index.html` and the styles (no remote resource); the export dialog (masked by default); the preload channels against their callers; nothing secret in browser storage; no cycle possible in groups; timers torn down on destroy.

## Web app: core services and the messages feature

`view-messages-dialog.component.ts` was read in full. Entries already given above (unencoded names, the selection surviving a connection switch, the enqueued-time filter, RabbitMQ rows with no sequence number) are not repeated.

### P1

- **"Retry Failed" resends messages that were already sent** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:1373`, `web-app/src/app/features/messages/view-messages-dialog.component.ts:2082`). The retry list is every entry of `failures`, and that includes the "may be duplicated" entries, whose send succeeded and whose complete failed. A retry puts a second copy at the destination, and the dialog shows them as plain "Failed". Breach of [[pages/invariants/bulk-operations-are-at-least-once]] on the UI side. Fix: the API marks a possible duplicate with a field instead of English text; the dialog excludes those from the retry and says "possible duplicate, do not retry".
- **Delete can drain the whole entity when the user selected a few messages** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:1900`, `web-app/src/app/core/services/bulk-operations.service.ts:253`). The "all selected" flag is stored at click time and never recomputed, and it compares the selection with the visible list, not with the entity count. Search to 3 hits, Select All, clear the search, Delete: the request says `all: true`. With the default page of 20 on a queue of 50,000, Select All then Delete is also a full drain. The confirmation text does say so and asks for an acknowledgement, which is the only guard. Fix: drain only when the selection equals the entity count; recompute the flag; clear the selection when a filter changes.
- **Continuous resubmit re-sends the same messages on every cycle** (`web-app/src/app/features/messages/continuous-resubmit-dialog.component.ts:360`). Each cycle takes the head of the dead-letter queue; a message that failed, or that was sent and not removed, is still at the head and goes out again. The loop stops only when a whole batch fails. Fix: remember failed and duplicate sequence numbers and stop on them.

### P2

- **The provider type never matches** (`web-app/src/app/core/models/provider.model.ts:5`): the TypeScript enum is numeric and the API sends strings. Saved RabbitMQ connections show as "Unknown Provider", the exchange labels and totals are wrong, and editing a RabbitMQ connection renders no provider section (the last part PLAUSIBLE). Fix: string values in the enum.
- **A CSV export can run formulas** (`web-app/src/app/core/services/message-export.service.ts:87`): cells are quoted and not neutralised, and the content comes from brokers. The XLSX path is not affected.
- **The body pane changes large numbers** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:1396`): parse and re-serialise rewrites integers above 2^53, and the diff dialog can show two different bodies as equal. Display only; resubmit uses the raw text.
- **A second send keeps the first one's properties and schedule** (`web-app/src/app/features/messages/send-message-dialog.component.ts:423`): after a failed send, clearing the schedule still sends the old value, so a message meant for now goes out scheduled.
- **Edit and resubmit turns every property into text and keeps the original `MessageId`** (`web-app/src/app/features/messages/send-message-dialog.component.ts:325`): typed subscription filters break, and with duplicate detection the edited message can be dropped while the UI says sent.
- **"Save as Template" uses `window.prompt`**, which Electron does not implement (PLAUSIBLE, `web-app/src/app/features/messages/send-message-dialog.component.ts:356`).
- **Failed tree loads read as an empty tree**, and the dead-letter alerts are then cleared from partial data (`web-app/src/app/core/services/tree-data-builder.service.ts:24`).
- **After an error in a bulk operation nothing reloads** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:1382`): rows already removed on the server stay on screen with "Please try again".
- **Keyboard shortcuts act through open dialogs** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:2268`): Delete pressed while the confirmation is open stacks a second one, and confirming both sends two deletes.
- **Zoneless repaint gaps** on Select All over 500 messages and on clearing a tab (PLAUSIBLE, `web-app/src/app/features/messages/view-messages-dialog.component.ts:1177`).
- **A property whose value is `0` or `false` renders empty, and a quick search then throws on non-text values** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:344`).
- **An import goes as one batch and reads the wrong error key** (PLAUSIBLE, `web-app/src/app/core/services/message-import.service.ts:166`), so a size failure shows "Unknown error".

### P3

- Excel export writes `[object Object]` for nested values; CSV has no byte order mark; long bodies are cut by Excel.
- Message loads have no cancel, so an older response can overwrite a newer one.
- The single Resubmit has no in-flight guard; a double click sends twice.
- A cancel in the one second between the response and the results dialog shows a completed operation as cancelled.
- Search and filters run only on the loaded page while the badge shows the entity total; the server search endpoints have no client. A regex is rebuilt per field per keystroke.
- A missing API port falls back to 5917 with the key still attached (PLAUSIBLE).

### Improvements

- The message list uses `@for` inside the virtual-scroll viewport, so nothing is virtualised; `formatBody` is called from the template on every pass.
- The logger is silent in production builds, errors included.
- Templates are stored globally in `localStorage`, not per connection, with no handling of a full quota.
- Bulk selection state is keyed by sequence number alone; key it by entity and connection.
- No spec exists for `api.service`, `connection.service`, `entity-selection.service`, `view-messages-dialog` or the resubmit, import, export and move dialogs; the existing ones use shapes the API never emits.

### Read and found sound

`api.service.ts` (the key on every verb, requests wait for port and secret); every route, verb and field of the queue, topic and session services against the controllers; no injection path in the messages feature; the dead-letter flag and subscription name on all three bulk flows, and cancel aborting the request; CSV and JSON import parsing; the scheduled time conversion.

## Where to start

Counted across the five areas: about 118 findings, 17 of them P1. The same few roots explain many of them, so the order is by root, not by count.

1. **Names in URLs.** Encode every path segment in the web app and test it end to end. One helper closes three P1 entries (a purge that deletes another queue, a delete that purges another queue, entities that cannot be opened).
2. **Which connection, which entity.** Clear the selection on every connect; name the entity and the connection in every destructive confirmation; show the environment in the header.
3. **"All" means the entity, not the page.** Fix the stored flag and the retry of possible duplicates in the messages dialog; stop the continuous resubmit on a failure.
4. **RabbitMQ.** Turn the bulk operations and the single resubmit off behind a capability flag, then fix peek, the listing that breaks on a TTL argument and the channel that dies on a missing dead-letter queue. Rebuild the bulk operations over AMQP afterwards.
5. **Azure message safety.** Duplicate detection on the target, per-abandon and per-cycle cleanup, any exception becoming a partial result; extract the shared scan loop first.
6. **Things that are simply broken.** Custom properties on send, queue details showing defaults, durations in days, the numeric provider enum, connect that does not connect, the enqueued-time filter.
7. **Dead and mock code.** Delete `message-body-editor` (it carries a script-injection path), `metrics-dashboard`, the mock metrics fallback and the `.backup` file.

Owner decisions this audit raised: a resubmit from a subscription's dead-letter queue reaching every subscription; selective delete and move on active entities, which cannot be made free of side effects; metrics tied to one configured namespace.
