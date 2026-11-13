---
title: "Api: Session and definition routes"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Api service page"
page_type: service
status: active
description: "Read when a change touches the session routes of a queue or a subscription and their status codes, or the namespace export and import of entity definitions."
source:
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/Controllers/
  - src/ServiceBusExplorer.Api/Monitoring/
  - src/ServiceBusExplorer.Api/appsettings.json
  - src/ServiceBusExplorer.Api.Tests/
  - src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs
  - src/ServiceBusExplorer.Core/Services/UnconfiguredMetricsService.cs
  - web-app/electron/main.js
reliability: high
---

# Api: Session and definition routes

One topic of [[pages/services/api|Api]]; the map lists the others.

## Controllers

**Sessions (2026-11-13).** Eight routes replace the four under `api/sessions`. Each base, a queue and a subscription, has a list (`GET .../sessions?maxMessages=`, default 1000, clamped to 1..5000, `src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#List`), the detail of one session (`GET .../sessions/{sessionId}?messageCount=`, absent or 0 for no messages, clamped to 0..1000, `src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#GetQueueSession`; one accept reads the state and peeks up to that many messages, answered as `messages` in the peek route's shape, `null` when not asked), its messages (`GET .../sessions/{sessionId}/messages?count=`, the peek route's default 10 and limit 1..1000, `src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#PeekQueueSessionMessages`) and a state write (`PUT .../sessions/{sessionId}/state`). The list answers `{ sessions: [{ sessionId, messageCount, firstSequenceNumber }], scannedMessages, truncated }` and locks nothing; the detail answers `{ sessionId, state, stateIsBinary, lockedUntil, messages }`; the other three accept one session and release it before the answer ([[pages/services/core]]). The write takes `{ state, expectedState }`, both required and bound as a `JsonElement`. An absent property, a missing body or a value that is not a string answers 400 with a fixed text, and the provider is never called (`src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#SetState`). A `state` of `null` or `""` clears the state. An `expectedState` of `null` or `""` means the session had no state. One runner hands the provider the request token and maps every failure (`src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#Run`):
- 400 for a provider without `SupportsSessions`, which is never called;
- 400 for an entity without sessions, a binary state and an id or state the provider refused, each with its fixed text;
- 404 `The queue was not found.` or `The subscription was not found.`;
- 409 `{ message, code: "SessionInUse" }` for a session another receiver holds or a five-second accept that elapsed;
- 409 `{ message, code: "SessionStateChanged" }` when the state changed since it was read;
- 409 `The entity is disabled for this operation.` for a disabled entity, as on every other message route;
- anything else the constant 500, the exception logged at Error with the operation, the entity path and the session id, never the state (`src/ServiceBusExplorer.Api/Controllers/SessionsController.cs#Run`).

Pinned by `src/ServiceBusExplorer.Api.Tests/SessionRouteTests.cs`, the detail's `messageCount` clamp and `messages` body included (`src/ServiceBusExplorer.Api.Tests/SessionRouteTests.cs#The_detail_hands_the_provider_the_message_count_clamped_to_0_through_1000`, `src/ServiceBusExplorer.Api.Tests/SessionRouteTests.cs#The_detail_asked_for_messages_answers_them_beside_the_state_in_the_peek_shape`). Known limits: an empty entity that does not use sessions lists as empty instead of answering 400, because a peek cannot tell it from an empty session entity. At the cap of 100 sessions, `truncated` is true and `scannedMessages` counts only the messages before the 101st session. Seen on the emulator only, not on a real namespace: accepting a session of an entity without sessions throws `InvalidOperationException`, an unknown session id is accepted with no state, and a session receiver's peek can return a short batch.

**Entity definitions (2026-11-13).** `POST api/namespace/export` answers the provider's document ([[pages/services/core]]) as camelCase JSON with enum names, and 400 with the provider's text when the namespace holds more than an import accepts, naming the count and the limit (`src/ServiceBusExplorer.Api/Controllers/NamespaceController.cs#Export`). `POST api/namespace/import?dryRun=` reads the body itself, at most 10 MB, with or without a Content-Length, and answers 413 `The document must be at most 10 MB.` past it without calling the provider (`src/ServiceBusExplorer.Api/Controllers/NamespaceController.cs#MaxImportBytes`, `src/ServiceBusExplorer.Api/Controllers/NamespaceController.cs#ReadBodyAsync`). `dryRun` is true unless it is exactly `false`, so a request that leaves it out creates nothing; any other value answers 400 (`src/ServiceBusExplorer.Api/Controllers/NamespaceController.cs#Import`). A body that does not parse, or a value of the wrong type, answers 400 naming the JSON path, `null` answers `The document is empty.` (`src/ServiceBusExplorer.Api/Controllers/NamespaceController.cs#Import`); the provider's refusal of the document answers 400 with its violations, anything else the constant 500. The answer is `{ dryRun, items: [{ kind, name, topic, outcome, differingFields, reason }] }`, one item per queue, topic and subscription of the document. Both routes answer 400 without calling a provider that lacks `SupportsDefinitions` (`src/ServiceBusExplorer.Api/Controllers/NamespaceController.cs#Refusal`), sit behind the key middleware like every route, and hand the provider the request token. The capabilities answer carries `supportsDefinitions` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#GetProviderCapabilities`).
