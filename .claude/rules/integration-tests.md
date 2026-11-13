---
paths:
  - "src/ServiceBusExplorer.IntegrationTests/**"
---

# ServiceBusExplorer.IntegrationTests

Runs the providers against real brokers started in Docker: the Azure Service Bus emulator and
RabbitMQ, through Testcontainers (`context/pages/decisions/0002-integration-tests-against-brokers-in-docker.md`).

## Rules this project must keep

- **A test only ever talks to a container the same run started.** The connection comes from the
  container fixture, never from configuration, an environment variable or a file, and no
  connection string, host or namespace of a real broker appears in the project.
  `AzureServiceBusFixtureTests` and `RabbitMqFixtureTests` pin it.
- **When Docker is missing the run fails; it does not skip.**
- **A known defect is pinned by a test of today's behaviour, named `Defect_...`.** The change that
  fixes the defect rewrites that test to assert the correct behaviour. A `Defect_` test never
  says the behaviour is wanted.
- **What the emulator cannot do is written down, not worked around**, on
  `context/pages/conventions/testing.md`.

## Commands

| When | Run |
|---|---|
| A provider, a broker call, a management-API call or an emulator changed | `dotnet test src/ServiceBusExplorer.IntegrationTests`, on the machine, with Docker running |

It runs on the machine because it needs the Docker daemon, which the container does not have on
purpose. It is a heavy lane: at most two heavy lanes (brokers in Docker or the end-to-end suite)
run at once on the owner's machine.
