---
title: "Core: How the rules are kept"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Core service page"
page_type: service
status: active
description: "Read when a change touches an invariant this project keeps, or a review of a change that could break one; each rule in full with the code and tests that keep it."
source:
  - src/ServiceBusExplorer.Core/
  - src/ServiceBusExplorer.Core.Tests/
  - src/ServiceBusExplorer.IntegrationTests/
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs
  - src/ServiceBusExplorer.Api.Tests/ApiFactory.cs
reliability: high
---

# Core: How the rules are kept

One topic of [[pages/services/core|Core]]; the map lists the others.

## To change here, read

- [[pages/invariants/provider-boundaries]] - what may live outside `Providers/<Provider>/`
- [[pages/invariants/secrets-masked-at-the-api-boundary]] - masking, the `***` sentinel, who may call `GetConnectionWithSecretAsync`
- [[pages/invariants/bulk-operations-are-at-least-once]] - send before complete, possible duplicates are reported, never resent
- [[pages/invariants/a-guard-must-be-able-to-fire]] - the safety timeout and no-progress guards in the scan loops
- [[pages/services/api]] - the only caller of this library
- [[pages/architecture/project-map]] - which tests to run when this project changes
- [[pages/conventions/testing]]

## Invariants

- [[pages/invariants/provider-boundaries]] - vendor SDK types stay under `Providers/<Provider>/`
- [[pages/invariants/secrets-masked-at-the-api-boundary]] - masked reads, sentinel on write, raw only via `GetConnectionWithSecretAsync`
- [[pages/invariants/bulk-operations-are-at-least-once]] - `ResubmitCoreAsync` and `MoveCoreAsync` send before they complete
- [[pages/invariants/a-guard-must-be-able-to-fire]] - the no-progress and safety-timeout exits in `DeleteMessagesCoreAsync`
