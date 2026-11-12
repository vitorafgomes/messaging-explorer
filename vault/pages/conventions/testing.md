---
title: "Testing"
version: "1.0"
date: 2026-11-12
changes: "Founded from the code and a full run on 2026-11-12"
page_type: convention
status: active
description: "How Messaging Explorer is tested: xUnit with Moq for the two .NET projects, vitest for the Angular app, what runs in CI, the state at the founding, and what has no test."
updated: 2026-11-12
source:
  - "src/ServiceBusExplorer.Core.Tests/"
  - "src/ServiceBusExplorer.Api.Tests/"
  - "web-app/angular.json"
  - ".github/workflows/ci.yml"
reliability: high
---

# Testing

> Test behaviour at the project boundary; a new guard ships with the input that fires it; web tests run through `ng test`, never plain vitest.

## Stack

- **.NET:** xUnit 2.6.2 with plain `Assert`, Moq 4.20.70 in the Core tests (`src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj:17`), `Microsoft.AspNetCore.Mvc.Testing` in the Api tests (`src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj:12`), `coverlet.collector` in both. No assertion library beyond xUnit; adding one is an ADR, not a package reference.
- **Web:** vitest 4 with jsdom, driven by the Angular unit-test builder (`web-app/angular.json:91`).
- The test projects live under `src/`, beside the code, not under `tests/`.

## Running

| What | Command | State on 2026-11-12 |
|---|---|---|
| Core | `dotnet test src/ServiceBusExplorer.Core.Tests` | 70 passed, 0 skipped |
| Api | `dotnet test src/ServiceBusExplorer.Api.Tests` | 49 passed, 0 skipped |
| Web | `npm test -- --watch=false` in `web-app/` | 22 files: 540 passed, 8 skipped |
| Electron shell helpers | `npm run test:electron` in `web-app/` (`node --test`) | 10 passed, 0 skipped |
| Build | `dotnet build ServiceBusExplorer.slnx` | 0 warnings, 0 errors |

The Api tests share process-wide environment variables, so the assembly disables parallelisation (`src/ServiceBusExplorer.Api.Tests/Usings.cs:4`).

## Web tests run through `ng test` only

`npm test` is `ng test`, the Angular unit-test builder with vitest as its runner (`web-app/angular.json:91`). It compiles the components and picks up every `*.spec.ts`. The gate is `npm test -- --watch=false` in `web-app/`.

Plain `npx vitest` is not a second way to run them. It has no Angular compiler, so a component with a signal `input()` or a `templateUrl` fails with errors such as NG0303, NG0950 and "Component is not resolved" on tests that are sound. The founding of this vault made that mistake and recorded 12 failures that did not exist; the `vitest.config.ts` that listed 11 files for that mode was removed the same day. A failure seen under plain vitest is not evidence of anything.

**Skipped:** 8 tests in three `describe.skip` blocks, the refresh variants of the metrics service (`web-app/src/app/core/services/metrics.service.spec.ts:295`), with a TODO about timers under zoneless Angular. They are the only skips allowed; a new one fails the gate.

## What CI runs

`.github/workflows/ci.yml`: the `harness` job (hook, workflow and script self-tests, the vault citation check), the `dotnet` job (restore, build, `dotnet test` on the solution) and the `web` job, which installs, runs the Angular tests (`.github/workflows/ci.yml:91`) and the Electron helper tests (`.github/workflows/ci.yml:95`), both since 2026-11-12, and builds (`.github/workflows/ci.yml:99`). There is no lint step. The release workflow calls this workflow before it packages (`.github/workflows/ci.yml:10`).

## Patterns in use

- **Core seams for the Azure provider.** The bulk operations are tested through internal `*Core` methods against fake receivers and senders (`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:63`); `InternalsVisibleTo` opens them (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj:10`). This is the model for a new bulk path: order of calls and the result per sequence number, never "complete was called".
- **Whole-API tests.** `WebApplicationFactory` with a seeded workspace (`src/ServiceBusExplorer.Api.Tests/ApiFactory.cs:38`) for the key middleware, CORS and masking.
- **No real broker.** No test connects to a broker it did not start. Since [[pages/decisions/0002-integration-tests-against-brokers-in-docker]] the providers are also tested against RabbitMQ and the Azure Service Bus emulator in containers the run starts, in a project of its own, outside the fast gate ([[pages/roadmap/tests-of-everything]]). A reproduction against a real broker is manual, on a broker the owner named, and never a destructive operation.
- **One failing-call test per external boundary (Rule I).** A new call to a broker SDK, the RabbitMQ management API, Azure Monitor, the filesystem or a subprocess ships one test where it fails and asserts what the caller does. `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:250` is the shape.
- **A guard ships with the input that fires it** ([[pages/invariants/a-guard-must-be-able-to-fire]]).

## What has no test

From the founding survey; each is on its service page.

- **Core:** `ProviderFactory`, the whole RabbitMQ provider except sessions, `RabbitMQManagementClient`, `RabbitMQPatternDetector`.
- **Api:** `QueuesController`, `TopicsController`, `SessionsController`, `ConnectionGroupsController`, `MonitoringController`, the monitoring service, port resolution, the loopback binding.
- **Electron shell:** `main.js` and `preload.js`. The pure helpers in `web-app/electron/shell-helpers.js` are tested with `node:test`; the wiring around them (dialogs, window order, quit, IPC handlers) needs Electron and has no test.

A refactor of any of these starts with pinning tests (the refactor lane, step 3).

## Related

- [[pages/conventions/tooling]]
- [[pages/architecture/project-map]]
