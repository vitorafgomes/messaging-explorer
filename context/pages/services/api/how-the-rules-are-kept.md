---
title: "Api: How the rules are kept"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Api service page"
page_type: service
status: active
description: "Read when a change touches an invariant this project keeps, or a review of a change that could break one; each rule in full with the code and tests that keep it."
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

# Api: How the rules are kept

One topic of [[pages/services/api|Api]]; the map lists the others.

## To change here, read

- [[pages/invariants/local-authenticated-api]]
- [[pages/invariants/secrets-masked-at-the-api-boundary]]
- [[pages/invariants/provider-boundaries]]
- [[pages/invariants/bulk-operations-are-at-least-once]]
- [[pages/invariants/a-guard-must-be-able-to-fire]]
- [[pages/services/core]] (the provider contract every controller calls)
- [[pages/services/web-app]] and [[pages/services/electron-shell]] (the only callers; Electron mints the secret)
- [[pages/conventions/testing]]

## Invariants

- [[pages/invariants/local-authenticated-api]]: loopback only plus `X-Api-Key` on everything but `/health` and preflight (`src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`; pinned by `src/ServiceBusExplorer.Api.Tests/AuthMiddlewareTests.cs#Request_without_api_key_returns_401`, `:20`, `:29`, `:38`).
- [[pages/invariants/secrets-masked-at-the-api-boundary]]: only `includeSecrets` exports and internal `WithSecret` calls see raw secrets.
- [[pages/invariants/provider-boundaries]]: controllers talk to `IMessagingProvider`, never to a broker SDK; the slot is process-wide.
- [[pages/invariants/bulk-operations-are-at-least-once]]: the controllers only forward the request token; delivery semantics are in [[pages/services/core]].
- [[pages/invariants/a-guard-must-be-able-to-fire]]: the Host filter and the `API_SECRET` fail-fast are made to fire by `src/ServiceBusExplorer.Api.Tests/BoundaryGuardTests.cs#A_foreign_Host_is_refused` and `:29`; the Kestrel loopback binding has no test that makes it fire (see [[pages/services/api/tests|Testing]] and [[pages/services/api/known-gaps|Known gaps]]).
