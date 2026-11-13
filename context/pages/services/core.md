---
title: "Core"
version: "2.0"
date: 2026-11-12
updated: 2026-11-13
changes: "v2.0: a map of topic pages; the old version notes moved to history"
page_type: service
status: active
description: "The messaging library behind the API: a provider abstraction over Azure Service Bus and RabbitMQ, bulk DLQ operations, the workspace file with its connections, and the Azure Monitor metrics service."
source:
  - src/ServiceBusExplorer.Core/
  - src/ServiceBusExplorer.Core.Tests/
  - src/ServiceBusExplorer.IntegrationTests/
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs
  - src/ServiceBusExplorer.Api.Tests/ApiFactory.cs
reliability: high
---

# Core

> One `IMessagingProvider` seam over Azure Service Bus and RabbitMQ, plus the file-backed workspace of saved connections and the metrics service; it has no HTTP surface of its own.

## Responsibility

Owns the provider contract and both implementations, the bulk delete / resubmit / move algorithms, `workspace.json` persistence and masking of stored connections, and the Azure Monitor metrics reader. Does not own HTTP routes, auth middleware, CORS or the monitoring poller ([[pages/services/api]]), nor any UI ([[pages/services/web-app]], [[pages/services/electron-shell]]).

## Rules

The rules this project must keep, and what to read before changing it, are in `.claude/rules/core.md`; Claude Code loads that file when a task touches the project. Each rule in full, with the code and tests that keep it: [[pages/services/core/how-the-rules-are-kept]].

## Topics

Read the page your change touches, not all of them.

| Page | Read when a change touches |
|---|---|
| [[pages/services/core/how-the-rules-are-kept\|How the rules are kept]] | an invariant this project keeps, or a review of a change that could break one; each rule in full with the code and tests that keep it |
| [[pages/services/core/public-contract\|Public contract and flow]] | IMessagingProvider, IProviderCapabilities, IConnectionConfig and the entities, ProviderFactory, the workspace and metrics interfaces, or how the API reaches a provider |
| [[pages/services/core/azure-provider\|Azure provider]] | AzureServiceBusProvider and its clients, the Azure auth types and AzureCredentialFactory, search, entity administration, or the counts of one entity |
| [[pages/services/core/azure-sub-queues\|Azure sub-queues and scheduled messages]] | CreateReceiver and the sub-queues, the transfer dead-letter queue, scheduled messages and their cancel, or a disabled entity on Azure |
| [[pages/services/core/azure-sessions\|Azure sessions]] | listing, opening, the state or the lock of an Azure session |
| [[pages/services/core/azure-definitions\|Azure entity definitions]] | ExportDefinitionsAsync or the import of entity definitions: validation, dry run, the order of creation |
| [[pages/services/core/azure-bulk-operations\|Azure bulk operations]] | purge and delete all, bulk delete, resubmit and move on Azure, their scan loops, cancellation, the safety timeout and possible duplicates |
| [[pages/services/core/rabbitmq-and-legacy\|RabbitMQ provider and the legacy service]] | RabbitMQProvider: AMQP, RabbitMQManagementClient, the topic and subscription mapping, RabbitMQPatternDetector, RabbitMQ bulk operations; or the legacy ServiceBusService |
| [[pages/services/core/workspace-and-metrics\|Workspace and metrics]] | FileWorkspaceManager: migration, locking, the atomic write, an unreadable file, masking, the merge on update and import; or the metrics services |
| [[pages/services/core/tests-unit-azure\|Unit tests of the Azure provider]] | a Core.Tests test of the Azure batch, sub-queue, credential, read, metrics or session code |
| [[pages/services/core/tests-unit-definitions-and-workspace\|Unit tests of definitions, the workspace and RabbitMQ]] | a Core.Tests test of entity definitions, FileWorkspaceManager or the RabbitMQ management client, or what Core.Tests does not cover |
| [[pages/services/core/tests-integration\|Integration tests]] | an IntegrationTests test of RabbitMQProvider or AzureServiceBusProvider against a broker in Docker, a Defect_ test, or what no broker test reaches |
| [[pages/services/core/known-gaps\|Hot spots and known gaps of the Azure provider]] | a hot spot of Core, or a gap of the Azure provider recorded as it was found |
| [[pages/services/core/known-gaps-more\|Known gaps of RabbitMQ and the code]] | a gap of the RabbitMQ provider, the vendor boundary, the versions, entity definitions or the legacy service, recorded as it was found |

## Cache footprint

`AzureMonitorMetricsService` keeps an `IMemoryCache` entry per metrics query for 30 seconds (`src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs#CacheDuration`, `src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs#GetQueueMetricsAsync`, `src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs#GetTopicMetricsAsync`, `src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs#GetSubscriptionMetricsAsync`). Nothing else in Core caches.

## Cross-service dependencies

- **Reads from:** Azure Service Bus (AMQP + management), RabbitMQ (AMQP + HTTP management), Azure Monitor (`MetricsQueryClient`), the local `workspace.json`.
- **Written to by:** [[pages/services/api]] only (`src/ServiceBusExplorer.Api/Program.cs#builder.Services.AddSingleton<IConnectionManager>(sp =>` to `src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`).

## History

Dated changes live in [[pages/history/core]], newest first.

## Ownership

- **Primary:** repo owner.
- **Escalation:** see [[pages/architecture/project-map]].

## Related

[[pages/services/api]], [[pages/services/web-app]], [[pages/services/electron-shell]], [[pages/conventions/tooling]]
