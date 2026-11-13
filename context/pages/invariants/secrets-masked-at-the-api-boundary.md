---
title: "Secrets are masked at the API boundary"
version: "1.2"
date: 2026-11-12
changes: "v1.2 (2026-11-13): a failing broker call logs no secret on test, connect, save, an operation route and a monitoring cycle, checked with sentinel secrets in every log entry and on the console, and against a real RabbitMQ refusing a wrong password. v1.1 (2026-11-12): the save response is masked, an import never stores the mask, Password is pinned by tests; three known exceptions closed. v1.0 founded from the code"
page_type: invariant
status: active
description: "A connection string, a password, a client secret and the API secret leave the backend only as the mask, except on an export the user asked for with secrets; the mask never overwrites a stored secret; nothing logs one."
updated: 2026-11-13
enforced_by:
  - "src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#MaskConnection"
  - "src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#CopyEditableFields"
  - "src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#SaveConnectionAsync"
  - "src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection"
verified_by:
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#GetConnection_by_id_returns_masked_connection_string"
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#GetConnection_by_id_returns_masked_client_secret"
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#GetConnection_by_id_returns_masked_password"
  - "src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#Save_connection_response_never_returns_a_raw_secret"
  - "src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs#The_save_response_never_returns_a_raw_secret_on_update"
  - "src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs#Importing_a_masked_export_for_an_unknown_id_never_stores_the_mask_as_the_secret"
  - "src/ServiceBusExplorer.Api.Tests/MetricsControllerTests.cs#GetQueueMetrics_returns_500_without_leaking_exception_message"
  - "src/ServiceBusExplorer.Api.Tests/ConnectionFailureLogTests.cs#ConnectionFailureLogTests"
  - "src/ServiceBusExplorer.IntegrationTests/ConnectionFailureLogTests.cs#RabbitMQConnectionFailureLogTests"
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

- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#MaskConnection` - `MaskConnection` clones a connection with the three secret fields replaced by `***` when they are not empty (`:281`, `:286`, `:298` of the same file).
- `src/ServiceBusExplorer.Core/Services/IConnectionManager.cs#IConnectionManager` - `GetConnectionAsync` returns the masked clone; `src/ServiceBusExplorer.Core/Services/IConnectionManager.cs#IConnectionManager` `GetConnectionWithSecretAsync` is the one read with raw values, for server-side callers.
- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#CopyEditableFields` - `CopyEditableFields`, the one merge used by save and by import of a stored id: a secret that arrives as the mask keeps the stored value (`src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#CopyEditableFields`).
- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#SaveConnectionAsync` - `SaveConnectionAsync` returns the masked clone of what it stored, on update and on create, so the POST response carries no raw secret.
- `src/ServiceBusExplorer.Core/Services/FileWorkspaceManager.cs#ImportConfigurationAsync` - an import for an id that is not stored clears a secret that arrives as the mask instead of storing the literal `***`.
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#SaveConnection` - the save action reads the raw connection to restore masked fields before it tests the connection.
- `src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs#ExportConfiguration` - an export with `includeSecrets=true` is the one response with raw secrets, and it logs a warning.

## How it's verified

- `src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#GetConnection_by_id_returns_masked_connection_string`, `:81` and `:150` of the same file - GET by id returns the masked connection string, client secret and password.
- `src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#Export_default_returns_masked_connections`, `:103` and `:170` - the default export is masked; `:61` and `:127` an export with secrets is raw.
- `src/ServiceBusExplorer.Api.Tests/ConnectionMaskingTests.cs#Save_connection_response_never_returns_a_raw_secret` - the POST save response carries the mask for all three secrets.
- `src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs#The_save_response_never_returns_a_raw_secret_on_update` and `src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs#The_save_response_never_returns_a_raw_secret_on_create` - the manager's save returns the mask on update and on create.
- `src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs#A_masked_password_on_update_keeps_the_stored_password` - a masked password on update keeps the stored password.
- `src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs#Importing_a_masked_export_for_an_unknown_id_never_stores_the_mask_as_the_secret` - importing a masked entry for an unknown id never stores the mask.
- `src/ServiceBusExplorer.Api.Tests/MetricsControllerTests.cs#GetQueueMetrics_returns_500_without_leaking_exception_message` - a 500 from the metrics endpoint does not carry the exception message.
- `src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs#An_unhandled_exception_answers_a_constant_500_body_and_never_the_exception_text` - an unhandled exception answers a constant body in every environment. Before 2026-11-12 the Development exception page showed the parse error of an unreadable `workspace.json` and echoed the request headers, the API key among them.
- `src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs#Import_never_returns_the_message_of_an_argument_exception` - the import action answers a constant message, never the exception's.
- `src/ServiceBusExplorer.Api.Tests/ConnectionFailureLogTests.cs#ConnectionFailureLogTests` - talking to a broker that fails logs no secret. Each test drives the API with a sentinel secret that has the characters real keys have (`+`, `/`, `=`) and a capturing logger provider at Trace. For every log entry it records the formatted message, every state value and the `ToString()` and `Data` of the exception and of each inner exception, and it captures the console as well. It asserts the expected failure entry is there, then that the sentinel appears nowhere: raw, URL-encoded and JSON-escaped, and for RabbitMQ also the base64 of `user:password`, the Basic header. The paths covered on `POST test`: three malformed Azure connection strings (`UriFormatException`, `FormatException`, `ArgumentException`, `:159`); a well-formed string on a closed loopback port (`AggregateException` after four retries, `:174`); a service principal whose credential is refused while it is built (`:212`); a closed RabbitMQ management port, the `Console.WriteLine` lines (`:232`). On `POST {id}/connect`, logged by `ProviderFactory` and `ConnectionsController`: a malformed string (`:192`) and a closed AMQP port (`BrokerUnreachableException`, `:250`). On save: a connection the test refuses (`:270`), and a save over an unreadable `workspace.json` whose parse fails inside the stored key (`:289`). After a connect to a closed port: `GET /api/queues`, logged by the exception handler, and a search, logged by `QueuesController` (`:312`); a monitoring cycle (`:346`). Checked on 2026-11-13 with Azure.Messaging.ServiceBus 7.21.0, Azure.Identity 1.21.0 and RabbitMQ.Client 6.8.1: no sentinel appeared on any path, and no code changed. Putting the secret into the log line of `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#TestConnectionAsync` or `src/ServiceBusExplorer.Core/Providers/ProviderFactory.cs#CreateConnectedProviderAsync`, into the management client's console line, or the workspace text into the exception `LoadWorkspace` throws, turns the tests red.
- `src/ServiceBusExplorer.IntegrationTests/ConnectionFailureLogTests.cs#RabbitMQConnectionFailureLogTests` - a wrong password answered by the real RabbitMQ broker logs nothing secret: the connection test answers false with the management API's 401 on the console (`:123`), and the connect fails with `BrokerUnreachableException` over `ACCESS_REFUSED` (`:137`). The Azure Service Bus emulator accepts a wrong `SharedAccessKey` (`:162`), so a refused key cannot be tested on it; the test pins that it succeeds and that the success path logs no key.

## Known exceptions

None is intended; each is tracked in [[pages/roadmap/followups]].

- **The list endpoint, `export-full` and the two import endpoints are not pinned by a masking test** at the API level.
- **The API's stdout is echoed by the Electron shell.** The paths above are verified to carry no secret (`src/ServiceBusExplorer.Api.Tests/ConnectionFailureLogTests.cs#ConnectionFailureLogTests`); the other log lines are not.
- **Nothing scrubs an exception.** Every `Log*(ex, ...)` site, the exception handler and the monitoring cycle write the exception's text as it is. No exception the SDKs threw on the paths above carried a secret, and no exception in Core or Api builds its message from a secret field (searched on 2026-11-13). A provider exception that did carry one would reach the log: made to throw one with the connection string as its message, the route and monitoring tests turned red.
- **The metrics service's credential is not tested.** `AzureMonitorOptions` holds no secret; `AzureMonitorMetricsService` uses `DefaultAzureCredential`, which reads the environment and the developer's own sign-ins, so no failing path can be driven without reaching Azure.
- **A service principal's token request is not covered by a test.** `AzureCredentialFactory.Create` passes no options. With `AZURE_AUTHORITY_HOST` naming a closed loopback port, the run still opened connections to public Microsoft addresses (`strace`, 40.126.31.x and 20.190.159.x), most likely MSAL's instance discovery, and took five minutes; a test of that path leaves the machine. It was checked once by hand, on 2026-11-13, in a network namespace with only loopback. The authority was a closed loopback port, and the logged `AuthenticationFailedException` carried connection-refused errors and no sentinel. A failure answered by the real authority, such as a wrong secret, was not seen.

## Change protocol

A new secret field lands in one change with: its line in `MaskConnection`, its mask merge on save and on import, and a masking test. The `secrets` lens of gate 6 reviews every diff near these points.
