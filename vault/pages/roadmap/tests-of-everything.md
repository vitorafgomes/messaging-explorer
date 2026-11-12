---
title: "Tests of everything"
version: "1.0"
date: 2026-11-12
changes: "Initial initiative page"
page_type: roadmap
status: active
description: "Every part of the product has a test that would fail if it broke: the providers against real brokers in Docker, every controller, the web services and dialogs that act on messages, and the packaged app."
updated: 2026-11-12
source:
  - chat
  - "vault/pages/conventions/testing.md"
  - "vault/pages/roadmap/code-audit-2026-11.md"
reliability: medium
---

# Tests of everything

> Every part of the product has a test that would fail if it broke. Where the answer depends on a broker, the test asks a broker, in a container.

## Why now

The audit of 2026-11-12 found about 118 defects by reading. Most were invisible to the suite because the suite did not reach them: one whole provider untested, five controllers untested, the dialog that deletes messages untested, specs built on shapes the API never emits. Fixing those defects without tests that reach them repeats the problem. The owner asked for tests of everything, with Docker where needed ([[pages/decisions/0002-integration-tests-against-brokers-in-docker]]).

## Scope

- **In scope:** integration tests of both providers against containers; unit tests for every controller and the monitoring service; specs for the Angular services and the dialogs that act on messages; a smoke test of the packaged app per operating system.
- **Out of scope:** tests against a real Azure namespace or any broker the run did not start; load tests; UI screenshot tests.

## Target outcome

No dates are set; the owner sets them. Done when each phase's success criteria can be observed.

## Status

- **As of 2026-11-12:** Phase 1 in progress, both halves landed. `src/ServiceBusExplorer.IntegrationTests` holds 60 tests: 27 against a RabbitMQ container and 32 against the Azure Service Bus emulator, with fifteen RabbitMQ and twelve Azure-rooted audit entries reproduced and pinned by `Defect_` tests, two new Azure findings pinned, one Azure entry not reproduced on the emulator and kept as plausible, and the emulator's limits written down.
- **Next milestone:** the working path of the RabbitMQ bulk resubmit and move, then Phase 2.

## Phases

### Phase 1 - Providers against real brokers
- **Status:** in progress. RabbitMQ done on 2026-11-12: the fixture starts `rabbitmq:4.3.7-management` through Testcontainers.RabbitMq 4.16.0, ten baseline tests cover connect, test connection, queues, topics, subscriptions, send, peek, receive and purge, sixteen `Defect_` tests pin the reproduced audit entries, the run fails without Docker, three consecutive runs were green, and the `integration` CI job runs it apart from the unit gate ([[pages/conventions/testing]]). Not done for RabbitMQ: the working path of bulk resubmit and move (today they are reached only through their defects). Azure done on 2026-11-12: the fixture starts `servicebus-emulator:2.0.1` and its SQL Server through Testcontainers.ServiceBus 4.16.0; fifteen baseline tests cover test connection, connect, queues, topics, subscriptions, send, peek, receive, sessions, topic fan-out, the dead-letter path and the bulk delete, resubmit and move with cancellation; sixteen `Defect_` tests pin twelve audit entries (eleven of the Azure section, one of the API section) and two new findings; the session list entry was refuted on the emulator; three consecutive runs were green. Not done for Azure: purge and delete-all, which need the management and AMQP endpoints in one call and the emulator serves them on two ports ([[pages/conventions/testing]], "What the emulator cannot do").
- **Scope:** the project `src/ServiceBusExplorer.IntegrationTests` with container fixtures for RabbitMQ (management plugin) and the Azure Service Bus emulator. For each provider: connect and test connection, list and read entities, send, peek, receive, purge, the dead-letter path, and the bulk delete, resubmit and move. Then one `Defect_` test for each broker-dependent entry of [[pages/roadmap/code-audit-2026-11]] that the container can reproduce.
- **Success criteria:** the run starts its own containers and passes locally and in CI; each PLAUSIBLE broker-dependent entry of the audit is rewritten as CONFIRMED or removed as refuted, with the test named; what the emulator cannot do is listed on [[pages/conventions/testing]].

### Phase 2 - Every controller
- **Status:** not started
- **Scope:** `QueuesController`, `TopicsController`, `SessionsController`, `ConnectionGroupsController`, `MonitoringController`, the connection lifecycle of `ConnectionsController`, and the monitoring background service, through the real pipeline with a stub provider. A route-table test that fails when two actions can match one method and URL.
- **Success criteria:** every action has at least one test of its success path and one of a failing provider call; "What has no test" on [[pages/conventions/testing]] lists no controller.

### Phase 3 - The web app where it acts on messages
- **Status:** not started
- **Scope:** specs for `api.service`, `connection.service`, `entity-selection.service`, `tree-data-builder`, and the dialogs for view, send, resubmit, import, export and move. Fixtures use the shapes the API emits: date strings, string enums, the `d.hh:mm:ss` durations. Un-skip or delete the eight skipped tests.
- **Success criteria:** the P1 entries of the audit in the messages dialog each have a spec that fails on today's code; no skipped test.

### Phase 4 - The packaged app
- **Status:** not started
- **Scope:** per operating system, after packaging: start the packaged app, wait for `/health`, check the window exists, quit. The Electron wiring that today has no test (error dialogs, window order, quit) is reached here or stays listed as untested.
- **Success criteria:** the release workflow runs the three smoke tests and publishes nothing when one fails.

## Decisions pending

- Whether the integration job runs on every pull request or only on changes under `src/ServiceBusExplorer.Core/Providers/` and nightly.

## Services affected

[[pages/services/core]], [[pages/services/api]], [[pages/services/web-app]], [[pages/services/electron-shell]]

## Risks

- **The Azure emulator lacks an operation a test needs** (management calls, sessions, duplicate detection). Mitigation: found in the first step of Phase 1, before tests are written against it; written down per ADR 0002.
- **A `Defect_` test is read as approval of the defect.** Mitigation: the name, and the rule that the fix rewrites it.
- **A slow or flaky container job blocks every pull request.** Mitigation: one fixture per broker shared by the collection; the decision pending above.

## Related

- [[pages/decisions/0002-integration-tests-against-brokers-in-docker]]
- [[pages/roadmap/code-audit-2026-11]], [[pages/roadmap/improvement-plan]]
