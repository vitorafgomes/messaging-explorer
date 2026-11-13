---
title: "Project map"
version: "1.1"
date: 2026-11-12
updated: 2026-11-13
changes: "2026-11-13: release from main; CI runs the web and Electron tests. Before: the integration project also runs the Azure Service Bus emulator"
page_type: longform
status: active
description: "Every project in ServiceBusExplorer.slnx plus the Angular app, the Electron shell and the docs site: kind, references, packages, covering tests and which tests to run when a project changes."
source:
  - ServiceBusExplorer.slnx
  - src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj
  - src/ServiceBusExplorer.Api/ServiceBusExplorer.Api.csproj
  - src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj
  - src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj
  - src/ServiceBusExplorer.IntegrationTests/ServiceBusExplorer.IntegrationTests.csproj
  - web-app/package.json
  - web-app/electron/main.js
  - docs/
  - .github/workflows/ci.yml
reliability: high
---

# Project map

> Five .NET projects in `ServiceBusExplorer.slnx` with a two-level graph (Api and the three test projects point at Core, Api.Tests also at Api), plus three non-.NET parts that are not in the solution: the Angular app, the Electron shell and the GitHub Pages site.

The solution file lists exactly five projects (lines 3 to 7 of `ServiceBusExplorer.slnx`), all `net10.0`. Derived from the `ProjectReference` and `PackageReference` items in each csproj and from `web-app/package.json` on the working tree of 2026-11-12. No `Directory.Build.props`, `global.json` or central package management file exists; versions live in each csproj.

## .NET projects

| Project | Kind | ProjectReference | Test project |
|---|---|---|---|
| [[pages/services/core]] | class library | none | `ServiceBusExplorer.Core.Tests` (direct) and, through the API, `ServiceBusExplorer.Api.Tests` |
| [[pages/services/api]] | ASP.NET Core web app (`Microsoft.NET.Sdk.Web`) | Core (`src/ServiceBusExplorer.Api/ServiceBusExplorer.Api.csproj#<ProjectReference Include="..\ServiceBusExplorer.Core\ServiceBusExplorer.Core.cs`) | `ServiceBusExplorer.Api.Tests` |
| `ServiceBusExplorer.Core.Tests` | xUnit test project | Core (`src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj#<ProjectReference Include="..\ServiceBusExplorer.Core\ServiceBusExplorer.Core.cs`) | is the tests |
| `ServiceBusExplorer.IntegrationTests` | xUnit test project, brokers in Docker | Core (`src/ServiceBusExplorer.IntegrationTests/ServiceBusExplorer.IntegrationTests.csproj#<ProjectReference Include="..\ServiceBusExplorer.Api\ServiceBusExplorer.Api.cspr`) | is the tests |
| `ServiceBusExplorer.Api.Tests` | xUnit test project, in-process host | Api, Core (`src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj#<ProjectReference Include="..\ServiceBusExplorer.Api\ServiceBusExplorer.Api.cspr`, `src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj#<ProjectReference Include="..\ServiceBusExplorer.Core\ServiceBusExplorer.Core.cs`) | is the tests |

Core grants its internals to `ServiceBusExplorer.Core.Tests` only (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj#<InternalsVisibleTo Include="ServiceBusExplorer.Core.Tests" />`), which is how the tests call `DeleteMessagesCoreAsync`, `ResubmitCoreAsync` and `MoveCoreAsync` directly. Api.Tests does not get Api internals; it uses `WebApplicationFactory` (`src/ServiceBusExplorer.Api.Tests/ApiFactory.cs`).

```mermaid
flowchart TD
    CT[Core.Tests] --> Core
    IT[IntegrationTests] --> Core
    IT -. AMQP and HTTP .-> RMQ[(RabbitMQ container)]
    IT -. AMQP and HTTP .-> SBE[(Service Bus emulator and SQL Server containers)]
    Api --> Core
    AT[Api.Tests] --> Api
    AT --> Core
    WEB[web-app Angular] -. HTTP /api .-> Api
    EL[web-app/electron] -- spawns or launches --> Api
    EL --> WEB
    DOCS[docs site]
```

Dotted and plain arrows from `web-app` and `electron`, and the dotted arrows to the containers, are run-time relationships, not build references; nothing in the .NET solution depends on them.

## NuGet packages

| Project | Package | Version |
|---|---|---|
| Core | `Azure.Identity` | 1.21.0 (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj#<PackageReference Include="Azure.Identity" Version="1.21.0" />`) |
| Core | `Azure.Messaging.ServiceBus` | 7.21.0 (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj#<PackageReference Include="Azure.Messaging.ServiceBus" Version="7.21.0" />`) |
| Core | `Azure.Monitor.Query` | 1.7.1 (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj#<PackageReference Include="Azure.Monitor.Query" Version="1.7.1" />`) |
| Core | `Microsoft.Extensions.Caching.Memory` | 10.0.15 (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj#<PackageReference Include="Microsoft.Extensions.Caching.Memory" Version="10.0.15`) |
| Core | `Microsoft.Extensions.Logging.Abstractions` | 10.0.15 (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj#<PackageReference Include="Microsoft.Extensions.Logging.Abstractions" Version="1`) |
| Core | `RabbitMQ.Client` | 6.8.1 (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj#<PackageReference Include="RabbitMQ.Client" Version="6.8.1" />`) |
| Api | `Microsoft.AspNetCore.OpenApi` | 10.0.15 (`src/ServiceBusExplorer.Api/ServiceBusExplorer.Api.csproj#<PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.15" />`) |
| Api | `Microsoft.OpenApi` | 2.13.0 (`src/ServiceBusExplorer.Api/ServiceBusExplorer.Api.csproj#<PackageReference Include="Microsoft.OpenApi" Version="2.13.0" />`) |
| Core.Tests | `Moq` | 4.20.70 (`src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj#<PackageReference Include="Moq" Version="4.20.70" />`) |
| Core.Tests | `xunit` / `xunit.runner.visualstudio` / `Microsoft.NET.Test.Sdk` / `coverlet.collector` | 2.9.3 / 2.8.2 / 17.14.2 / 6.0.4 (`src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj#<PackageReference Include="xunit" Version="2.9.3" />`, `src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj#<PackageReference Include="xunit.runner.visualstudio" Version="2.8.2">`, `src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj#<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.2" />`, `src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj#<PackageReference Include="coverlet.collector" Version="6.0.4">`) |
| IntegrationTests | `Testcontainers.RabbitMq` | 4.16.0 (`src/ServiceBusExplorer.IntegrationTests/ServiceBusExplorer.IntegrationTests.csproj#<PackageReference Include="Testcontainers.RabbitMq" Version="4.16.0" />`) |
| IntegrationTests | `Testcontainers.ServiceBus` | 4.16.0 (`src/ServiceBusExplorer.IntegrationTests/ServiceBusExplorer.IntegrationTests.csproj#<PackageReference Include="Testcontainers.ServiceBus" Version="4.16.0" />`); it brings `Testcontainers.MsSql` for the emulator's SQL Server. The project names `Azure.Messaging.ServiceBus` types, which reach it through Core, only to arrange and observe broker state |
| IntegrationTests | `xunit` / `xunit.runner.visualstudio` / `Microsoft.NET.Test.Sdk` / `coverlet.collector` | 2.9.3 / 2.8.2 / 17.14.2 / 6.0.4, the versions of Core.Tests (`src/ServiceBusExplorer.IntegrationTests/ServiceBusExplorer.IntegrationTests.csproj#<PackageReference Include="xunit" Version="2.9.3" />`, `src/ServiceBusExplorer.IntegrationTests/ServiceBusExplorer.IntegrationTests.csproj#<PackageReference Include="xunit.runner.visualstudio" Version="2.8.2">`, `src/ServiceBusExplorer.IntegrationTests/ServiceBusExplorer.IntegrationTests.csproj#<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.2" />`, `src/ServiceBusExplorer.IntegrationTests/ServiceBusExplorer.IntegrationTests.csproj#<PackageReference Include="coverlet.collector" Version="6.0.4">`) |
| Api.Tests | `Microsoft.AspNetCore.Mvc.Testing` | 10.0.15 (`src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj#<PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.15" /`) |
| Api.Tests | `xunit` / `xunit.runner.visualstudio` / `Microsoft.NET.Test.Sdk` / `coverlet.collector` | 2.9.3 / 2.8.2 / 17.14.2 / 6.0.4 (`src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj#<PackageReference Include="xunit" Version="2.9.3" />`, `src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj#<PackageReference Include="xunit.runner.visualstudio" Version="2.8.2">`, `src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj#<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.2" />`, `src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj#<PackageReference Include="coverlet.collector" Version="6.0.4">`) |

The vendor SDKs (`Azure.*`, `RabbitMQ.Client`) are referenced by Core only; Api reaches them transitively. `ProviderVersion` in the two capability classes repeats the Azure and RabbitMQ package versions as strings ([[pages/services/core/known-gaps-more]]).

## What each test project covers

- **Core.Tests** (`src/ServiceBusExplorer.Core.Tests/`): the Azure bulk cores against mocked receivers and senders, `AzureCredentialFactory`, `AzureServiceBusProvider` connect paths, `AzureMonitorMetricsService`, the RabbitMQ session stubs, `SessionInfo`, and since 2026-11-12 `FileWorkspaceManager` (`src/ServiceBusExplorer.Core.Tests/Services/FileWorkspaceManagerTests.cs#Updating_a_connection_persists_its_RabbitMQ_fields`: the merge on save and import, the masked save return, an unreadable file, the atomic write). Not covered directly: `ProviderFactory`, `RabbitMQProvider` (beyond sessions), `RabbitMQManagementClient`, `RabbitMQPatternDetector`, `ServiceBusService`.
- **Api.Tests** (`src/ServiceBusExplorer.Api.Tests/`): masking of connections on read, export and the save response (`ConnectionMaskingTests.cs`), API key middleware (`AuthMiddlewareTests.cs`), CORS (`CorsTests.cs`), the metrics controller with 503 when unconfigured (`MetricsControllerTests.cs`). `FileWorkspaceManager` also runs here, through `IConnectionManager` (`src/ServiceBusExplorer.Api.Tests/ApiFactory.cs#SeedConnectionAsync`). The queue, topic, session, group and monitoring controllers have no test file.
- **IntegrationTests** (`src/ServiceBusExplorer.IntegrationTests/`): the RabbitMQ provider through its public surface against `rabbitmq:4.3.7-management`, and the Azure Service Bus provider through `IMessagingProvider` against `servicebus-emulator:2.0.1` with its SQL Server, each started by Testcontainers once per run; baseline tests of what works and `Defect_` tests pinning reproduced audit entries. Purge and delete-all on Azure are not reached (the emulator serves the two endpoints they need on two ports). Needs Docker; fails, never skips, without it. No `InternalsVisibleTo`. See [[pages/conventions/testing]] and [[pages/decisions/0002-integration-tests-against-brokers-in-docker]].
- **web-app**: 22 `*.spec.ts` files under `web-app/src`, run by the Angular `unit-test` builder (`web-app/angular.json#"test": {`, `web-app/angular.json#"builder": "@angular/build:unit-test"`) with Vitest (`web-app/package.json`, `vitest` ^4.0.8, script `test`). See [[pages/services/web-app]].

## Non-.NET parts

| Part | Path | Kind | Notes |
|---|---|---|---|
| Angular app | `web-app/` | Angular 21 SPA (`@angular/core` ^21.2.8), Material, ng-bootstrap, ApexCharts, ExcelJS, Prism; npm `packageManager` npm@11.6.2 | Feature folders `connections`, `entities`, `messages`, `monitoring`, `queues`, `topics` under `web-app/src/app/features`; per-provider UI under `web-app/src/app/providers/{azure-service-bus,rabbitmq,kafka}` through `provider-registry.service.ts`. A `kafka` folder exists in the UI, but Core has no Kafka provider (`src/ServiceBusExplorer.Core/Providers/ProviderType.cs#ProviderType`) and the registry example for it is commented out (`web-app/src/app/providers/provider-registry.service.ts#import`). See [[pages/services/web-app]]. |
| Electron shell | `web-app/electron/` (`main.js` 1094 lines, `shell-helpers.js` with its `node:test` file, `preload.js` 72, `splash.html`) | Electron ^41.2.0 main process; electron-builder ^26.7.0 | `package.json` `main` is `electron/main.js`. In development it runs `dotnet run` in `src/ServiceBusExplorer.Api` (`web-app/electron/main.js#const apiProjectDir = path.resolve(__dirname, '..', '..', 'src', 'ServiceBusExpl`, `web-app/electron/main.js#apiProcess = spawn('dotnet', ['run', '--no-launch-profile'], {`); packaged, it finds the published API under `resources/api` (`web-app/electron/main.js#path.join(process.resourcesPath, 'api'),` to `web-app/electron/main.js#path.join(__dirname, '..', 'resources', 'api'),`). Defaults: API port 5917, frontend port 4297 (`web-app/electron/main.js#return { apiPort: 5917, frontendPort: 4297 };`). Packaging copies `src/ServiceBusExplorer.Api/bin/Release/net10.0/publish` into `api` (`web-app/package.json`, `build.extraResources`). See [[pages/services/electron-shell]]. |
| Docs site | `docs/` | static GitHub Pages site: `index.html` (326), `styles.css` (617), `app.js` (227) with its `node:test` file `app.test.js`, `icon.svg`, `_config.yml` (`theme: null`, `plugins: []`, `docs/_config.yml#theme: null`, `docs/_config.yml#plugins: []`) | No build step and no reference to or from any code project. `docs/ADDING_PROVIDERS.md` (695 lines) is the guide to adding a provider and is the one document here that tracks Core's provider seam. |

`web-app/package.json` `homepage` points at the Pages site.

## CI

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`. Job `dotnet` restores and builds the whole solution in Release (`.github/workflows/ci.yml#dotnet-version: '10.0.x'`, `.github/workflows/ci.yml#run: dotnet restore ServiceBusExplorer.slnx`), so all five projects always build together, and tests Core.Tests and Api.Tests by path (`.github/workflows/ci.yml`, `.github/workflows/ci.yml#- name: Test`), so it starts no container. Job `integration` builds and runs the integration project on its own runner (`.github/workflows/ci.yml## ---------------------------------------------------------------------------`, `.github/workflows/ci.yml#run: dotnet build src/ServiceBusExplorer.IntegrationTests --configuration Releas`); the release workflow calls this workflow, so a release waits for it. Job `web` runs `npm ci` and `npm run build` in `web-app` (`.github/workflows/ci.yml`) and, since 2026-11-12, `npm test -- --watch=false` between them (`.github/workflows/ci.yml`), so every spec file is part of CI (45 on 2026-11-12), and the Electron helper tests run after them with `npm run test:electron` (`.github/workflows/ci.yml`). `.github/workflows/release.yml` runs by hand from `main` or on a `v*` tag (`.github/workflows/release.yml#workflow_dispatch:`) and builds Electron installers for Linux, Windows and macOS (`.github/workflows/release.yml#run: npm run electron:build:linux`, `.github/workflows/release.yml#run: npm run electron:build:win`, `.github/workflows/release.yml#run: npm run electron:build:mac`).

## Who references whom: what to run when X changes

| Changed | Builds break in | Run these tests | Why |
|---|---|---|---|
| Core, `Abstractions/` or `Models/` | Api, Core.Tests, Api.Tests, IntegrationTests | `dotnet test ServiceBusExplorer.slnx` (it includes the integration project, so it needs Docker), and `web-app` specs if a DTO shape or JSON name changed | Every other .NET project references Core; the SPA consumes the serialised models |
| Core, `Providers/Azure/` | Core.Tests (internals), Api, IntegrationTests | Core.Tests (`Providers/Azure/*`) first; `dotnet test src/ServiceBusExplorer.IntegrationTests` (Docker); Api.Tests for connection and metrics paths; a fix to a pinned defect rewrites its `Defect_` test | The bulk cores are covered by Core.Tests against mocks and by the integration project against the emulator |
| Core, `Providers/RabbitMQ/` | Api, IntegrationTests | `dotnet test src/ServiceBusExplorer.IntegrationTests` (Docker), Core.Tests for sessions, then the full solution; a fix to a pinned defect rewrites its `Defect_` test | Only the integration project reaches the provider's broker paths |
| Core, `Services/FileWorkspaceManager.cs` | Api | Core.Tests `FileWorkspaceManagerTests` and Api.Tests `ConnectionMaskingTests` | Run both projects |
| Core, `Services/*Metrics*` | Api | Core.Tests `Services/AzureMonitorMetricsServiceTests.cs` and Api.Tests `MetricsControllerTests.cs` | Both sides pin behaviour |
| Core, `Providers/ProviderFactory.cs` or `ProviderType.cs` | Api | Full solution; also `web-app` provider registry if a value is added | No direct test; `ConnectionMaskingTests` touches `ProviderType` |
| Api (controllers, `Program.cs`, middleware) | Api.Tests | Api.Tests; the SPA calls these routes, so check `web-app/src/app/core/services/api.service.ts` | Route and JSON changes cross the HTTP boundary with no generated client |
| Core.Tests, Api.Tests or IntegrationTests only | that project | that project | Nothing references a test project |
| `web-app/src` | nothing in .NET | `npm test -- --watch=false` and `npm run build` in `web-app` | CI runs both |
| `web-app/electron`, `web-app/package.json` `build` | nothing in .NET | `npm run test:electron` in `web-app` for the helpers in `shell-helpers.js`, then `npm run electron:dev` by hand | CI runs the helper tests; the wiring in `main.js` and `preload.js` (process spawn, IPC, dialogs) has no automated test |
| `docs/` | nothing | none | Static files |

## To change here, read

- [[pages/invariants/provider-boundaries]]
- [[pages/conventions/testing]]
- [[pages/conventions/tooling]]
- [[pages/services/core]]
- [[pages/services/api]]

## Related

[[pages/services/web-app]], [[pages/services/electron-shell]]
