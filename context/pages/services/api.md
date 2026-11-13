---
title: "Api"
version: "2.0"
date: 2026-11-12
updated: 2026-11-13
changes: "v2.0: a map of topic pages; the old version notes moved to history"
page_type: service
status: active
description: "ASP.NET Core host that exposes the Core library to the desktop UI as a loopback-only, API-key-guarded REST API over one process-wide active broker connection."
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

# Api

> The local HTTP door of Messaging Explorer: one authenticated loopback REST surface that holds a single active broker connection and forwards every call to the Core provider.

## Responsibility

Owns the HTTP surface: startup configuration, the auth/CORS/host-filter pipeline, route shape, request clamping, error-to-status mapping, and the one slot that holds the active provider. Does not own broker behaviour, bulk-operation semantics or connection persistence; those live in [[pages/services/core]]. Does not serve the UI ([[pages/services/web-app]]) and does not start itself ([[pages/services/electron-shell]]). See [[pages/architecture/project-map]].

## Rules

The rules this project must keep, and what to read before changing it, are in `.claude/rules/api.md`; Claude Code loads that file when a task touches the project. Each rule in full, with the code and tests that keep it: [[pages/services/api/how-the-rules-are-kept]].

## Topics

Read the page your change touches, not all of them.

| Page | Read when a change touches |
|---|---|
| [[pages/services/api/how-the-rules-are-kept\|How the rules are kept]] | an invariant this project keeps, or a review of a change that could break one; each rule in full with the code and tests that keep it |
| [[pages/services/api/public-contract-and-startup\|Public contract and startup]] | the route prefixes, the X-Api-Key header, the JSON options, or Program.cs: ports, the secret, CORS, host filtering, the Kestrel binding, DI, the middleware pipeline |
| [[pages/services/api/controllers\|Controllers]] | which controller owns a route, the static active-provider slot and its lock, or how an entity name travels in the path |
| [[pages/services/api/cancellation-and-errors\|Cancellation and error mapping]] | the request token a bulk or destructive action passes on, a status code or error body, the 500 body, a clamp on a count |
| [[pages/services/api/routes-entities-and-messages\|Entity and message routes]] | creating or editing a queue, topic or subscription, the active, dead-letter and transfer dead-letter routes, scheduled messages, a disabled entity, a peek from a sequence number or without bodies |
| [[pages/services/api/routes-sessions-and-definitions\|Session and definition routes]] | the session routes of a queue or a subscription and their status codes, or the namespace export and import of entity definitions |
| [[pages/services/api/connections-and-secrets\|Connections and secrets]] | the connections routes: masking, save with the *** placeholder, an unreadable workspace.json, export, export-full, import, clear-all |
| [[pages/services/api/monitoring\|Monitoring]] | MonitoringBackgroundService, its poll period and failures, MonitoringStore, or the monitoring routes |
| [[pages/services/api/tests\|Tests]] | a test of the Api project, ApiFactory, or what has no test yet |
| [[pages/services/api/known-gaps\|Hot spots and known gaps]] | a hot spot of the Api project or a gap recorded as it was found |

## Cache footprint

`IMemoryCache` is registered here (`src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`) and handed only to `AzureMonitorMetricsService` (`:154`); its keys belong to [[pages/services/core]]. The only other in-process state is the provider slot and the 120-entry `MonitoringStore`; both vanish on restart.

## Cross-service dependencies

- **Reads from:** [[pages/services/core]] (provider factory, providers, `FileWorkspaceManager`, metrics service).
- **Written to by:** [[pages/services/web-app]] over HTTP; [[pages/services/electron-shell]] spawns the process and sets `API_SECRET`, `ASPNETCORE_URLS`.

## History

This page states how the module works now; dated changes live in [[pages/history/api]], newest first.

## Related

[[pages/services/core]], [[pages/services/web-app]], [[pages/services/electron-shell]], [[pages/architecture/project-map]], [[pages/conventions/testing]], [[pages/conventions/tooling]].
