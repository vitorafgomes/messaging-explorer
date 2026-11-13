---
title: "Api: Connections and secrets"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Api service page"
page_type: service
status: active
description: "Read when a change touches the connections routes: masking, save with the *** placeholder, an unreadable workspace.json, export, export-full, import, clear-all."
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

# Api: Connections and secrets

One topic of [[pages/services/api|Api]]; the map lists the others.

## Connections and secrets

Paths written `.../` abbreviate `src/ServiceBusExplorer.Api/Controllers/`.

- **Masking:** list and get return masked copies (`***` for `ConnectionString`, `Password`, `ClientSecret`) from `FileWorkspaceManager` (`src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#MaskConnection`, `:321`); raw secrets come only from `GetConnectionWithSecretAsync` (`:325`), which `Connect` and `SaveConnection` call (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection`, `:233`) ([[pages/invariants/secrets-masked-at-the-api-boundary]]).
- **Save with placeholder:** if the body carries an `Id` that exists, `***` in `ConnectionString` or `Password` is replaced by the stored value (`.../ConnectionsController.cs:125-133`) before the equality check that decides a "metadata only" update. A metadata-only update skips the connection test (`:146`, `:155`). The manager keeps the stored value for any of the three secrets that still arrives as `***` (`src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#CopyEditableFields`, `:348`, `:357`) and returns the masked clone of what it stored, which the action returns as the POST body (`src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#SaveConnectionAsync`, `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection`).
- **Unreadable `workspace.json`:** every manager read throws `InvalidOperationException` ([[pages/services/core]]). Actions with a `try/catch` answer 500 `{message:"An internal error occurred."}`: list, save, connect, import (the exception is neither `ArgumentException` nor `JsonException`, so it is not a 400), `export-full` and `import-full` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#GetConnections`, `:178`, `:260`, `:464`, `:505`, `:564`). `clear-all` is the in-app recovery: it answers 200 with zero counts and leaves an empty workspace (pinned by `src/ServiceBusExplorer.Api.Tests/ClearAllTests.cs#Clear_all_recovers_an_unreadable_workspace`). GET by id, `DELETE {id}` and `export` have no `try/catch` (`:100`, `:412`, `:419`); the exception handler answers them with the constant 500 in every environment (`src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs#An_unhandled_exception_answers_a_constant_500_body_and_never_the_exception_text`).
- **`export`:** `POST`, masked by default; `?includeSecrets=true` returns raw and sets `Content-Disposition: attachment` and logs the remote IP (`.../ConnectionsController.cs:420-431`). **`export-full`:** same flag, adds groups, indented PascalCase JSON (`:471-503`). **`import`:** string payload to the manager (`:433-469`). **`import-full`:** groups saved first, then connections, with no rollback if the second step fails (`:541-560`).
- **`clear-all`** (`DELETE`, no confirmation parameter): disconnects the provider and the legacy service (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ClearAllData`), then calls `IConnectionManager.ClearAllAsync` (`src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ClearAllData`), which counts what is stored and writes an empty workspace under the manager's lock through the temp-file-and-move save ([[pages/services/core]]). The body is `{message, connectionsDeleted, groupsDeleted}`; an unreadable file reports zero for both and is still reset. A failed write answers the constant 500.
- **`ConnectionMaskingTests.cs` pins** (`src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#GetConnection_by_id_returns_masked_connection_string`): GET by id masks `connectionString` and `clientSecret` (`:81`); default export masks both and does not leak the sentinel (`:41`, `:103`); `includeSecrets=true` returns raw values and a content-disposition (`:61`, `:127`); GET by id and the default export mask `password` (`:150`, `:170`); a metadata-only `POST` answers with `***` for all three secrets (`:196`). It does not pin the list endpoint, `export-full`, any import through the API or `clear-all`; the import merge is pinned in Core (`src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs#Importing_an_existing_id_persists_its_RabbitMQ_fields`, `:155`).
