---
title: "Web App: How the rules are kept"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Web App service page"
page_type: service
status: active
description: "Read when a change touches ApiService and the X-Api-Key, encoding a name in a path, HighlightPipe escaping, or a review of a change that could break a rule of the app."
source:
  - web-app/src/app/core/services/api.service.ts
  - web-app/src/app/core/services/api-path.ts
  - web-app/src/app/shared/pipes/highlight.pipe.ts
reliability: high
---

# Web App: How the rules are kept

One topic of [[pages/services/web-app|Web App]]; the map lists the others.

## To change here, read

- [[pages/invariants/local-authenticated-api]] - the `X-Api-Key` contract `ApiService` must keep honouring.
- [[pages/invariants/secrets-masked-at-the-api-boundary]] - the UI only ever receives masked connection strings and passwords.
- [[pages/invariants/provider-boundaries]] - what may be provider-specific and where.
- [[pages/invariants/bulk-operations-are-at-least-once]] - what cancel and retry mean for the bulk dialogs.
- [[pages/services/electron-shell]] - owns `window.electronAPI`, the only source of the API port and secret.
- [[pages/services/api]] and [[pages/services/core]] - the contract this app mirrors.
- [[pages/conventions/testing]] and [[pages/conventions/tooling]] - how tests and builds are run.

## How it works

### ApiService (the single HTTP gate)

- A grep of `web-app/src/app` for `HttpClient` finds only `api.service.ts` (plus the provider in `app.config.ts`); every service calls `ApiService.get/post/put/delete` (`web-app/src/app/core/services/api.service.ts#get`). No `fetch`, `XMLHttpRequest` or `EventSource` is used.
- Constructor: only if `window.electronAPI` exists, it builds a `ready` promise that awaits `getApiPort()` and `getApiSecret()` in parallel (`web-app/src/app/core/services/api.service.ts#ApiService`, `web-app/src/app/core/services/api.service.ts#initialize`).
- Port: a positive number from Electron replaces the base URL with `http://localhost:{port}/api` (`web-app/src/app/core/services/api.service.ts#port`). Otherwise `environment.apiUrl` is used, `http://localhost:5917/api` in both environment files (`web-app/src/environments/environment.ts#environment`, `web-app/src/environments/environment.prod.ts#environment`).
- Secret: stored in memory, attached as `X-Api-Key` on every verb via `getHeaders()` (`web-app/src/app/core/services/api.service.ts#getHeaders`). If the secret call throws it is logged and requests go out without the header (`web-app/src/app/core/services/api.service.ts#electronAPI`), so the API answers 401.
- Plain browser (no Electron): `ready` stays null, requests are sent immediately with no `X-Api-Key` (`web-app/src/app/core/services/api.service.ts#waitForReady`). The API requires the key on everything except `/health` and answers 401 otherwise (`src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`), and refuses to start without `API_SECRET` (`src/ServiceBusExplorer.Api/Program.cs`). So a browser tab pointed at a running API cannot call it; see [[pages/invariants/local-authenticated-api]].
- GET requests append a `_t=Date.now()` cache buster (`web-app/src/app/core/services/api.service.ts#cacheBuster`).
- **Names in a path are encoded once, by one helper.** Every endpoint that carries a value is written as an `apiPath` tagged template (`web-app/src/app/core/services/api-path.ts#apiPath`): each interpolated value, an entity, topic, subscription or session name, a connection or group id, a sequence number or a query value, goes through `encodeURIComponent`, and the literal parts stay as written. A queue named `a/messages` is deleted with `DELETE queues/a%2Fmessages`, never the purge route of `a`; a purge of `orders#1` is `DELETE queues/orders%231/messages`, never a request for `orders`. No other code encodes, so nothing is encoded twice (`50%off` becomes `50%25off`). An `undefined` or `null` value throws instead of writing the text into the URL (`web-app/src/app/core/services/api-path.ts#path`). Endpoints with no value stay plain strings. The API decodes each segment once on its side ([[pages/services/api]]). Pinned by `web-app/src/app/core/services/api-path.spec.ts#percent-encodes every interpolated value and leaves the literal parts alone` and the "names in the URL" specs of the queue, topic, session and metrics services (`web-app/src/app/core/services/queue.service.spec.ts#names in the URL`, `web-app/src/app/core/services/topic.service.spec.ts#names in the URL`, `web-app/src/app/core/services/session.service.spec.ts#names and session ids with / and a space stay one segment each`, `web-app/src/app/core/services/metrics.service.spec.ts#names in the URL`).

### Highlight pipe

`HighlightPipe` escapes every text segment through a detached `div.textContent` then reads `innerHTML` (`web-app/src/app/shared/pipes/highlight.pipe.ts#escapeHtml`), wraps matches in `<mark>` after escaping (`web-app/src/app/shared/pipes/highlight.pipe.ts#lastIndex`) and returns a plain string, not `SafeHtml`, so Angular's own `[innerHTML]` sanitizer still runs (`web-app/src/app/shared/pipes/highlight.pipe.ts#lastIndex`). It never calls `bypassSecurityTrustHtml`. Used in three `[innerHTML]` bindings of the messages dialog (`web-app/src/app/features/messages/view-messages-dialog.component.ts#@if (selectedTabIndex === 1) {`, `web-app/src/app/features/messages/view-messages-dialog.component.ts`, `web-app/src/app/features/messages/view-messages-dialog.component.ts#Resubmit`).

## Where each rule is kept

The rules of `.claude/rules/web-app.md`, each with the page that holds its code and tests:

- Every HTTP call goes through `ApiService`: the section above, and [[pages/invariants/local-authenticated-api]].
- A secret arrives masked and stays masked: [[pages/invariants/secrets-masked-at-the-api-boundary]].
- A bulk operation tells the user what happened to each message: [[pages/services/web-app/bulk-operations]], [[pages/services/web-app/bulk-automatic-resubmit]] and [[pages/invariants/bulk-operations-are-at-least-once]].
- What a provider cannot do is read from its capabilities: [[pages/services/web-app/providers-and-shared]] and [[pages/invariants/provider-boundaries]].
- A screen follows the UI convention: [[pages/conventions/ui]].
- An IPC channel, or how the API process starts, is a sensitive change: [[pages/services/electron-shell/ipc-and-tray]] and [[pages/services/electron-shell/startup-and-api-process]].
