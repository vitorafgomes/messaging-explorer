---
title: "Testing"
version: "1.0"
date: 2026-11-12
changes: "2026-11-13: the Running counts after the monitoring counts change; the monitoring controller and poll have tests. Earlier: integration project against the Azure Service Bus emulator: the Running row, the emulator fixture, what the emulator cannot do"
page_type: convention
status: active
description: "How Messaging Explorer is tested: xUnit with Moq for the two .NET projects, vitest for the Angular app, what runs in CI, the state at the founding, and what has no test."
updated: 2026-11-13
source:
  - "src/ServiceBusExplorer.Core.Tests/"
  - "src/ServiceBusExplorer.Api.Tests/"
  - "src/ServiceBusExplorer.IntegrationTests/"
  - "web-app/angular.json"
  - ".github/workflows/ci.yml"
reliability: high
---

# Testing

> Test behaviour at the project boundary; a new guard ships with the input that fires it; web tests run through `ng test`, never plain vitest.

## Stack

- **.NET:** xUnit 2.9.3 with plain `Assert`, Moq 4.20.70 in the Core tests (`src/ServiceBusExplorer.Core.Tests/ServiceBusExplorer.Core.Tests.csproj:17`), `Microsoft.AspNetCore.Mvc.Testing` in the Api tests (`src/ServiceBusExplorer.Api.Tests/ServiceBusExplorer.Api.Tests.csproj:12`), `coverlet.collector` in both. No assertion library beyond xUnit; adding one is an ADR, not a package reference.
- **Web:** vitest 4 with jsdom, driven by the Angular unit-test builder (`web-app/angular.json:91`).
- The test projects live under `src/`, beside the code, not under `tests/`.

## Running

| What | Command | State on 2026-11-12 |
|---|---|---|
| Core | `dotnet test src/ServiceBusExplorer.Core.Tests` | 380 passed, 0 skipped (2026-11-13) |
| Api | `dotnet test src/ServiceBusExplorer.Api.Tests` | 344 passed, 0 skipped (2026-11-13) |
| Integration (Docker) | `dotnet test src/ServiceBusExplorer.IntegrationTests` | 94 passed, 0 skipped (31 RabbitMQ, 63 Azure Service Bus) on 2026-11-13, 196 s for the test run on that day; earlier, 93 to 102 s wall with the images cached, as measured when the project had 74 tests. The two collections run in parallel and the Azure one dominates: about 20 s to start SQL Server and the emulator, about 68 s of tests, of which 20 s is the deep dead-letter resubmit (350 messages arranged one by one) and 15 s three calls to a closed port that wait out the SDK retries |
| Web | `npm test -- --watch=false` in `web-app/` | 50 files: 896 passed, 8 skipped (2026-11-13) |
| Electron shell helpers and preload | `npm run test:electron` in `web-app/` (`node --test`) | 28 passed, 0 skipped (2026-11-13) |
| Build | `dotnet build ServiceBusExplorer.slnx` | 0 warnings, 0 errors |

The Api tests share process-wide environment variables, so the assembly disables parallelisation (`src/ServiceBusExplorer.Api.Tests/Usings.cs:4`).

## The integration project

`src/ServiceBusExplorer.IntegrationTests` runs the RabbitMQ provider against a real broker and the Azure Service Bus provider against the emulator, under [[pages/decisions/0002-integration-tests-against-brokers-in-docker]]. Testcontainers.RabbitMq 4.16.0 starts `rabbitmq:4.3.7-management` (`src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:19`): a pinned patch of the current 4.x line, with the management plugin because the provider uses AMQP and the management HTTP API both.

- **One broker per run.** `RabbitMqFixture` is a collection fixture (`src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:16`, collection at `src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:210`); every class carries `[Collection]`, so the tests run one after another against one container. It binds 15672 as well as 5672 and waits until `/api/overview` answers (`src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:35`).
- **The connection comes only from the fixture.** User and a random password are made in the constructor, host and ports come from the container, and `CreateConfig` builds the provider's config from them. Nothing in the project reads an environment variable, a file or configuration. `The_provider_connects_only_to_the_loopback_container_this_run_started` (`src/ServiceBusExplorer.IntegrationTests/RabbitMqFixtureTests.cs:12`) asserts the host resolves to loopback only and the ports are the mapped ones, not 5672 and 15672. The host itself comes from Testcontainers, and its own settings (`DOCKER_HOST`, `TESTCONTAINERS_HOST_OVERRIDE`, `~/.testcontainers.properties`) can point it elsewhere; the fixture therefore refuses any host that does not resolve to loopback before a test runs (`src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:179`), so a redirected run fails as a whole.
- **No Docker fails the run.** There is no skip anywhere. The container starts in the fixture's `InitializeAsync`, so `DockerUnavailableException` fails every test of the collection. Verified on 2026-11-12 by hiding the Docker socket in a private mount namespace: 27 failed, 0 skipped, exit code 1. Pointing `DOCKER_HOST` at a missing socket is not a test of this: Testcontainers falls back to the default socket and the run goes green.
- **Arrange and observe beside the provider, never instead of it.** The fixture keeps a second AMQP connection and an HTTP client on the management API. A fresh channel per helper call, because a 404 closes a channel; counts over AMQP (`QueueDeclarePassive`), never from management statistics, which lag by seconds; absence is proved with a sentinel message behind the one that must not arrive.
- **Isolation.** Each test makes its own queues, exchanges and users with unique names and deletes them through the management API afterwards, whatever state the provider is in. Ryuk removes the container when the run ends.
- **Two classes.** `RabbitMQProviderTests` is what works today; `RabbitMQProviderDefectTests` pins each reproduced audit entry with a `Defect_` test of today's behaviour, whose summary says what the correct behaviour would be ([[pages/roadmap/code-audit-2026-11]]).
- **Not covered (RabbitMQ):** the bulk resubmit and move paths beyond the defects, search, sessions, quorum queues, TLS, more than one virtual host, and every controller.

### The Azure Service Bus emulator

Testcontainers.ServiceBus 4.16.0 starts `mcr.microsoft.com/azure-messaging/servicebus-emulator:2.0.1` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusFixture.cs:22`) with the SQL Server container the emulator needs, on a network of their own. `2.0.1` is the tag `latest` pointed at on 2026-11-12 (same manifest digest); the copy of `latest` cached on the development machine was the older `2.0.0`. The SQL image is the module's default, `mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04`, with the module's throwaway password; it changes only when the package does. The fixture accepts the emulator licence through the module (`WithAcceptLicenseAgreement`, which sets `ACCEPT_EULA`). No entity configuration file is mounted: the fixture keeps the emulator's built-in configuration and every test creates its entities through the management API.

- **Two endpoints, two providers.** The emulator serves AMQP on 5672 and the management API over HTTP on 5300, and the SDK reads both ports from the connection string, so no single connection string reaches both. The fixture hands out both connection strings, each from the container (`GetConnectionString`, `GetHttpConnectionString`), and two providers connected through `ProviderFactory.CreateConnectedProviderAsync` the way the API connects: the management one lists, reads, creates and deletes entities, the messaging one sends, peeks, receives and runs the bulk operations. Both strings carry `UseDevelopmentEmulator=true`; `AzureConnectionConfig.IsValid` and the factory accept them unchanged.
- **The connection comes only from the fixture**, and the loopback guard checks the host of both endpoints before a test runs (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusFixture.cs:167`). `Both_provider_endpoints_are_the_loopback_container_this_run_started` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusFixtureTests.cs:12`) asserts loopback and mapped ports, not 5672 or 5300. The key is the emulator's published development key, which the module puts in the connection string.
- **A start deadline.** The readiness checks of the SQL and emulator containers have no deadline of their own; on 2026-11-12, with the host short of memory, SQL Server never became ready and the first run hung for ten minutes. The fixture gives the start five minutes (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusFixture.cs:35`), image pulls on a cold runner included, and the collection then fails: with the deadline set to 3 s the readiness wait threw `TimeoutException` and the run failed in under 5 s (2026-11-12, restored afterwards).
- **Arrange and observe beside the provider.** A second `ServiceBusClient` and a `ServiceBusAdministrationClient` in the fixture; counts are read by draining or peeking, never from runtime properties, which the emulator reports as zero. The first receive on an idle client can time out while messages are there, so the drain asks a peek first whether the entity is empty (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusFixture.cs:118`).
- **Isolation.** Unique entity names per test, deleted afterwards through the administration client. The emulator allows 50 queues and 50 topics per namespace, so a test that does not clean up will eventually break the others.
- **Four classes.** `AzureServiceBusProviderTests` (39, what works today), `AzureServiceBusProviderDefectTests` (13 `Defect_` tests, [[pages/roadmap/code-audit-2026-11]]), `AzureServiceBusSessionTests` (9, since 2026-11-13: the passive list, one session opened at a time, the regression test of the listing that locked sessions) and the guard test. A topic forwards to its subscriptions late, so a test that sends to a topic polls the subscription with a deadline before it asserts, never a fixed sleep.

#### What the emulator can do

Established by running it on 2026-11-12, each by a call through the provider or the SDK: the administration client on the HTTP endpoint (namespace properties, list, get and runtime properties of queues, topics and subscriptions, create and delete of queues, topics, subscriptions and rules, SQL rule filters with a parse error on a bad expression); sessions (session-enabled queues and subscriptions, session state; and, established on 2026-11-13, a plain receiver peeking a session queue or subscription returns the messages of every session with their session id and locks none, `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusSessionTests.cs:79`; a session another receiver holds is refused at once with `SessionCannotBeLocked`; accepting a session of an entity without sessions throws `InvalidOperationException`, not a `ServiceBusException`; a session queue refuses a message without a session id with `InvalidOperationException`; an unknown session id is accepted, with no state and no message; a zero-byte state reads back as no state; a single peek of 10 on a session receiver returned 1 of the session's 2 messages, a short batch the provider's peek goes past); duplicate detection; dead-lettering by max delivery count and explicitly, with the reason kept; scheduled messages (hidden from receive, shown by peek); application properties of type string, int, bool, double, `DateTimeOffset` and `Guid` round-trip with their types; the 256 KB message limit; peek of 250 messages per call; the server-side purge the provider calls by reflection, which returned the purged count over AMQP (the provider's own comment says the emulator does not support it: `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1458`).

#### What the emulator cannot do

Untested by integration, per [[pages/decisions/0002-integration-tests-against-brokers-in-docker]] rule 6:

- **One connection string for messages and entities.** The provider builds both clients from one string, so an operation that needs both cannot run against the emulator: `PurgeMessagesAsync` (active, dead-letter and session, so the session purge entry of the audit as well) and `DeleteMessagesAsync` with `all`, because both read `RequiresSession` through the administration client before draining over AMQP (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1339`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1344`). With the messaging string the admin call fails after four retries; with the management string the AMQP client talks to the HTTP port and fails after three to five minutes with `GeneralError` (`ProtocolName48545450`, the bytes of "HTTP"). `TestConnectionAsync` probes the administration client, so it answers false for the messaging endpoint (`TestConnection_is_false_for_the_messaging_endpoint_because_it_probes_the_management_api`).
- **Runtime counts.** Active, dead-letter, scheduled and total message counts are always zero, so the counts on queue, topic and subscription listings are untested.
- **Authentication.** A wrong `SharedAccessKey` is accepted on both endpoints; there is no Entra ID, so the credential auth types and a rejected key are untested.
- **Partitioning.** `EnablePartitioning = true` creates a queue that reports itself not partitioned; the audit entry on scan order in partitioned entities cannot be exercised.
- **Limits of a real namespace.** Default message time to live at most one hour (two hours is rejected with 400); 50 queues and 50 topics; Standard-tier sizes only, no Premium; no throttling, no real network.
- **Short peek batches.** A peek returns the full count asked for, for small and for 100 KB messages; the only short batch seen was at the gap a dropped duplicate leaves in a queue with duplicate detection. Since 2026-11-12 the peek goes on past that gap, which one test covers (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs:638`); the other shapes of a short batch are unit-tested only.
- **Lock loss on demand.** No way to make one complete or abandon fail in the middle of a batch, so the audit entries that need it (one failed abandon ends the scan, receive completing one by one) are untested.
- **The transfer dead-letter queue of a subscription.** It cannot be read on the emulator, so the four subscription routes and the provider calls behind them have unit and API tests only (`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs:90`, `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs:51`). The one of a queue can be read and answers empty (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs:675`).
- **A real transfer dead-letter message.** None could be produced, so no test peeks, deletes or resubmits a message that the broker itself failed to forward.
- **A disabled entity on peek and search.** They never fail on a disabled entity here, so their 409 is unit-tested only (`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs:292`); send, batch send, cancel, receive and resubmit on a disabled queue do fail and are tested (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs:740`).
- **A cancel that mixes in a number that is not scheduled.** The emulator cancels none and every number is reported failed, pinned as a `Defect_` test (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:87`); whether real Azure answers the same was not verified.
- **Azure Monitor.** The metrics service has no emulator at all.

The emulator is not the service: a result here proves the code path against the emulator's behaviour, which may differ from a namespace in session hand-out order, peek batching, duplicate detection timing and fan-out latency (a message sent to a topic reaches its subscriptions about 100 to 170 ms later on the emulator).

## Web tests run through `ng test` only

`npm test` is `ng test`, the Angular unit-test builder with vitest as its runner (`web-app/angular.json:91`). It compiles the components and picks up every `*.spec.ts`. The gate is `npm test -- --watch=false` in `web-app/`.

Plain `npx vitest` is not a second way to run them. It has no Angular compiler, so a component with a signal `input()` or a `templateUrl` fails with errors such as NG0303, NG0950 and "Component is not resolved" on tests that are sound. The founding of this context made that mistake and recorded 12 failures that did not exist; the `vitest.config.ts` that listed 11 files for that mode was removed the same day. A failure seen under plain vitest is not evidence of anything.

**Skipped:** 8 tests in three `describe.skip` blocks, the refresh variants of the metrics service (`web-app/src/app/core/services/metrics.service.spec.ts:314`), with a TODO about timers under zoneless Angular. They are the only skips allowed; a new one fails the gate.

## What CI runs

`.github/workflows/ci.yml`: the `harness` job (hook, workflow and script self-tests, the context citation check), the `dotnet` job (restore, build the solution, `dotnet test` on Core.Tests and Api.Tests by path, so it starts no container), the `integration` job (builds and runs `src/ServiceBusExplorer.IntegrationTests` on its own Linux runner) and the `web` job, which installs, runs the Angular tests (`.github/workflows/ci.yml:115`) and the Electron helper tests (`.github/workflows/ci.yml:119`), both since 2026-11-12, and builds (`.github/workflows/ci.yml:123`). There is no lint step. The release workflow calls this workflow before it packages (`.github/workflows/ci.yml:10`).

## Patterns in use

- **Core seams for the Azure provider.** The bulk operations are tested through internal `*Core` methods against fake receivers and senders (`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:63`); `InternalsVisibleTo` opens them (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj:10`). This is the model for a new bulk path: order of calls and the result per sequence number, never "complete was called".
- **Whole-API tests.** `WebApplicationFactory` with a seeded workspace (`src/ServiceBusExplorer.Api.Tests/ApiFactory.cs:38`) for the key middleware, CORS and masking.
- **No real broker.** No test connects to a broker it did not start. Since [[pages/decisions/0002-integration-tests-against-brokers-in-docker]] the providers are also tested against RabbitMQ and the Azure Service Bus emulator in containers the run starts, in a project of its own, outside the fast gate ([[pages/roadmap/tests-of-everything]]). A reproduction against a real broker is manual, on a broker the owner named, and never a destructive operation.
- **One failing-call test per external boundary (Rule I).** A new call to a broker SDK, the RabbitMQ management API, Azure Monitor, the filesystem or a subprocess ships one test where it fails and asserts what the caller does. `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderBatchTests.cs:250` is the shape.
- **A guard ships with the input that fires it** ([[pages/invariants/a-guard-must-be-able-to-fire]]).

## What has no test

From the founding survey; each is on its service page.

- **Core:** `ProviderFactory`, `RabbitMQPatternDetector`. The RabbitMQ provider and its management client are reached only by the integration project, through the provider's public surface; their bulk resubmit and move, search and pattern detection have no test of their working path.
- **Api:** `QueuesController` and `TopicsController` beyond the entity administration, rule and message routes, which have tests since 2026-11-12 (the message routes in `src/ServiceBusExplorer.Api.Tests/MessageRouteTests.cs:51`; the session routes since 2026-11-13, `src/ServiceBusExplorer.Api.Tests/SessionRouteTests.cs:79`), `ConnectionGroupsController`, port resolution, the loopback binding. `MonitoringController` and the monitoring poll have tests since 2026-11-13 (`src/ServiceBusExplorer.Api.Tests/MonitoringBackgroundServiceTests.cs:83`, `src/ServiceBusExplorer.Api.Tests/MonitoringControllerTests.cs:68`).
- **Electron shell:** `main.js`. The pure helpers in `web-app/electron/shell-helpers.js` are tested with `node:test`, and what `preload.js` exposes is tested against a fake `electron` module (`web-app/electron/preload.test.js:30`); the wiring around them (dialogs, window order, quit, IPC handlers) needs Electron and has no test.

A refactor of any of these starts with pinning tests (the refactor lane, step 3).

## Related

- [[pages/conventions/tooling]]
- [[pages/architecture/project-map]]
