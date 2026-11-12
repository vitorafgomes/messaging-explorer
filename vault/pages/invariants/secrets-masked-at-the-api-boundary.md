---
title: "Secrets are masked at the API boundary"
version: "1.1"
date: 2026-11-12
changes: "v1.1 (2026-11-12): the save response is masked, an import never stores the mask, Password is pinned by tests; three known exceptions closed. v1.0 founded from the code"
page_type: invariant
status: active
description: "A connection string, a password, a client secret and the API secret leave the backend only as the mask, except on an export the user asked for with secrets; the mask never overwrites a stored secret; nothing logs one."
updated: 2026-11-12
enforced_by:
  - "src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:271"
  - "src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:339"
  - "src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:382"
  - "src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs:121"
verified_by:
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs:23"
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs:81"
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs:150"
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs:196"
  - "src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs:108"
  - "src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs:155"
  - "src/ServiceBusExplorer.Api.Tests/MetricsControllerTests.cs:109"
source:
  - "src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs"
  - "src/ServiceBusExplorer.Core/Services/IConnectionManager.cs"
  - "src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs"
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs"
reliability: high
---

# Secrets are masked at the API boundary

> A stored secret is read in full only by server-side code that opens a connection. Every response carries the mask `***` in its place. Rule G of root `CLAUDE.md`.

## Why this exists

Connection strings and passwords for production brokers pass through this tool. A secret in a JSON response ends up in a screenshot, a bug report or the renderer's memory; a secret in a log ends up in a file the user attaches to an issue on a public repository.

## Scope

- **Applies to:** `ConnectionString`, `Password` and `ClientSecret` of `ServiceBusConnection`, the per-launch API secret, and any secret field added later; every controller response, every log line and exception message, the console output of the Electron shell.
- **Does not cover:** storage. `workspace.json` holds the secrets in plain text ([[pages/services/core]]); encrypting it is a tracked gap in [[pages/roadmap/followups]], not part of this rule.

## Where it's enforced

- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:271` - `MaskConnection` clones a connection with the three secret fields replaced by `***` when they are not empty (`:278`, `:283`, `:295` of the same file).
- `src/ServiceBusExplorer.Core/Services/IConnectionManager.cs:12` - `GetConnectionAsync` returns the masked clone; `src/ServiceBusExplorer.Core/Services/IConnectionManager.cs:18` `GetConnectionWithSecretAsync` is the one read with raw values, for server-side callers.
- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:339` - `CopyEditableFields`, the one merge used by save and by import of a stored id: a secret that arrives as the mask keeps the stored value (`src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:343`, `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:348`, `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:357`).
- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:382` - `SaveConnectionAsync` returns the masked clone of what it stored, on update and on create, so the POST response carries no raw secret.
- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs:438` - an import for an id that is not stored clears a secret that arrives as the mask instead of storing the literal `***`.
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs:121` - the save action reads the raw connection to restore masked fields before it tests the connection.
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs:424` - an export with `includeSecrets=true` is the one response with raw secrets, and it logs a warning.

## How it's verified

- `src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs:23`, `:81` and `:150` of the same file - GET by id returns the masked connection string, client secret and password.
- `src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs:41`, `:103` and `:170` - the default export is masked; `:61` and `:127` an export with secrets is raw.
- `src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs:196` - the POST save response carries the mask for all three secrets.
- `src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs:108` and `src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs:134` - the manager's save returns the mask on update and on create.
- `src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs:91` - a masked password on update keeps the stored password.
- `src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs:155` - importing a masked entry for an unknown id never stores the mask.
- `src/ServiceBusExplorer.Api.Tests/MetricsControllerTests.cs:109` - a 500 from the metrics endpoint does not carry the exception message.
- `src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs:51` - an unhandled exception answers a constant body in every environment. Before 2026-11-12 the Development exception page showed the parse error of an unreadable `workspace.json` and echoed the request headers, the API key among them.
- `src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs:69` - the import action answers a constant message, never the exception's.

## Known exceptions

None is intended; each is tracked in [[pages/roadmap/followups]].

- **The list endpoint, `export-full` and the two import endpoints are not pinned by a masking test** at the API level.
- **The API's stdout is echoed by the Electron shell**; whether any API log line carries a connection string was not verified.

## Change protocol

A new secret field lands in one change with: its line in `MaskConnection`, its mask merge on save and on import, and a masking test. The `secrets` lens of gate 6 reviews every diff near these points.
