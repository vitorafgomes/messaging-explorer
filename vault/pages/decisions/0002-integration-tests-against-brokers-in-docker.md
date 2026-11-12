---
title: "ADR 0002 - Integration tests against brokers in Docker"
version: "1.0"
date: 2026-11-12
changes: "Initial ADR"
page_type: adr
status: accepted
description: "The providers are tested against a real RabbitMQ and the Azure Service Bus emulator, each started in a container by the test run, in a test project of its own; no test ever connects to a broker it did not start."
updated: 2026-11-12
source:
  - chat
  - "vault/pages/roadmap/code-audit-2026-11.md"
reliability: high
---

# ADR 0002 - Integration tests against brokers in Docker

## Status

Accepted, 2026-11-12 (owner request: tests of everything, with Docker where needed). Amends the "No live broker" rule of [[pages/conventions/testing]].

## Context

Every provider test until now ran against mocks. The audit of 2026-11-12 ([[pages/roadmap/code-audit-2026-11]]) shows what that costs: most of its gravest findings rest on how a broker behaves (what a requeue does to order, whether a publish that reaches no queue is reported, what an abandon does to the delivery count, whether duplicate detection drops a resubmitted message), and a mock cannot answer any of them. Several are marked PLAUSIBLE for that reason alone. The RabbitMQ provider has no test at all beyond sessions.

The founding rule said no test connects to a broker. It was written against the real risk, a test pointed at someone's production namespace, and it was wider than that risk.

## Decision

1. **A third test project, `src/ServiceBusExplorer.IntegrationTests`**, with xUnit like the other two. It starts its brokers in containers through Testcontainers: RabbitMQ with the management plugin, and the Azure Service Bus emulator with the SQL container it needs.
2. **A test only ever talks to a container the same run started.** The connection comes from the container fixture, never from configuration, an environment variable or a file. No connection string, host or namespace of a real broker appears in the project.
3. **It is not part of the fast gate.** The unit projects stay as they are: seconds, no Docker. The integration project is run by its own command and by its own CI job on a Linux runner.
4. **When Docker is missing the integration run fails; it does not skip.** A suite that passes by not running is the failure the mechanic is told to report ([[pages/conventions/tooling]]).
5. **A known defect is pinned by a test of today's behaviour, named `Defect_...`.** It turns a PLAUSIBLE entry of the audit into a CONFIRMED or a refuted one by execution, and it is the red test of the fix: the change that fixes the defect rewrites that test to assert the correct behaviour (Rule B). A `Defect_` test is never a statement that the behaviour is wanted; [[pages/conventions/decisions-that-look-like-defects]] is where wanted behaviour is recorded.
6. **What the emulator cannot do is written down, not worked around.** A provider operation the Azure emulator does not support is listed on [[pages/conventions/testing]] as untested by integration, with the reason.

## Consequences

- Positive: the broker-dependent findings stop being arguments; the RabbitMQ provider gets its first real tests; the planned rebuild of its bulk operations over AMQP has something to be proven against.
- Negative: two new package families (Testcontainers and its modules), a slower job in CI, and image pulls on a cold runner.
- The emulator is not the service. A test that passes on it proves the code path, not every behaviour of a production namespace (partitioned entities, Premium limits, real throttling). The page says which claims rest on the emulator.
- Rule H's standing instruction is unchanged: never run a destructive operation against a broker the owner did not name. A container the test started is not such a broker.

## Alternatives considered

- **A docker-compose file and tests that read a connection string from the environment**: rejected, because the same variable could be pointed at a real broker, which is the one thing this decision must make impossible.
- **Skipping the integration tests when Docker is absent**: rejected; see point 4.
- **Tests that assert the correct behaviour and are marked skipped until the fix lands**: rejected. A skipped test proves nothing about today and is forgotten; the gate allows no new skip.
