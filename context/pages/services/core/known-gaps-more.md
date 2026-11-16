---
title: "Core: Known gaps of RabbitMQ and the code"
version: "1.0"
date: 2026-11-13
updated: 2026-11-16
changes: "2026-11-16: the RabbitMQ search is refused, not empty. 2026-11-16: the RabbitMQ bulk gap is now the position, not the loss. v1.0: split out of the Core service page"
page_type: service
status: active
description: "Read when a change touches a gap of the RabbitMQ provider, the vendor boundary, the versions, entity definitions or the legacy service, recorded as it was found."
source:
  - src/ServiceBusExplorer.Core/
  - src/ServiceBusExplorer.Core.Tests/
  - src/ServiceBusExplorer.IntegrationTests/
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs
  - src/ServiceBusExplorer.Api.Tests/ApiFactory.cs
reliability: high
---

# Core: Known gaps of RabbitMQ and the code

One topic of [[pages/services/core|Core]]; the map lists the others.

## Known gaps

- **A RabbitMQ bulk operation addresses a message by its position, not by an identity.** A message removed by another client between the peek and the call shifts the ones behind it, so the call acts on whichever message is at that position (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs#Defect_delete_by_position_removes_whichever_message_is_at_that_position_now`). Narrowed, not closed: a source with a consumer is refused. The loss of messages by bulk delete and move, the ignored cancellation and the ignored subscription left this page on 2026-11-16 ([[pages/services/core/rabbitmq-and-legacy]]).
- **RabbitMQ gaps behind the shared interface.** `DeadLetterMessageAsync` throws `NotSupportedException` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#DeadLetterMessageAsync`) and the four session members throw `NotSupportedException` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#GetSessionsAsync`); since 2026-11-16 `SearchMessagesAsync` throws too and the capability `SupportsMessageSearch` is false, which the search routes check before the provider is called (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs#SearchMessagesAsync`). The capability flags say false for sessions (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProviderCapabilities.cs#SupportsSessions`) but nothing forces callers to check them.
- **Vendor SDK types outside `Providers/<Provider>/`.** `Services/ServiceBusService.cs` imports `Azure.Messaging.ServiceBus` and its `Administration` namespace (`src/ServiceBusExplorer.Core/Services/ServiceBusService.cs#using Azure.Messaging.ServiceBus;`, `src/ServiceBusExplorer.Core/Services/ServiceBusService.cs#using Azure.Messaging.ServiceBus.Administration;`); `Services/AzureMonitorMetricsService.cs` imports `Azure.Core`, `Azure.Identity` and `Azure.Monitor.Query` and its public constructor takes a `TokenCredential` (`src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs#using Azure.Core;`, `src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs#using Azure.Identity;`, `src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs#using Azure.Monitor.Query;`, `src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs#AzureMonitorMetricsService`); `Models/ServiceBusConnection.cs` imports `ServiceBusExplorer.Core.Providers.Azure` for `AzureAuthType` (`src/ServiceBusExplorer.Core/Models/ServiceBusConnection.cs#using ServiceBusExplorer.Core.Providers.Azure;`, `src/ServiceBusExplorer.Core/Models/ServiceBusConnection.cs#AuthType`) and mixes Azure and RabbitMQ fields in one DTO (`src/ServiceBusExplorer.Core/Models/ServiceBusConnection.cs#HostName`, `src/ServiceBusExplorer.Core/Models/ServiceBusConnection.cs#Password`, `src/ServiceBusExplorer.Core/Models/ServiceBusConnection.cs#ManagementPort`, `src/ServiceBusExplorer.Core/Models/ServiceBusConnection.cs#ClientSecret`). `Abstractions/` is clean: it has no `Azure` or `RabbitMQ` import.
- **Hard-coded vendor versions.** `ProviderVersion` returns the string `"7.21.0"` and `"6.8.1"` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureProviderCapabilities.cs#ProviderVersion`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProviderCapabilities.cs#ProviderVersion`); they match the package versions in the csproj today but nothing ties them together.
- **Entity definitions do not carry everything** (2026-11-13). `MaxMessageSizeInKilobytes`, which only Premium sets, is not in the create options and so not exported. A correlation filter with a property of type `Other` exports and is refused on import with the field named, so such a document imports nothing until the rule is changed (`src/ServiceBusExplorer.Core/Providers/Azure/EntityConfigurationValidator.cs#ValidateDefinitions`). A partitioned Standard entity may report its maximum size multiplied by its partitions; whether creating it back with that number is accepted was not verified, the emulator has no partitioning. User metadata is not verified against a broker: the emulator keeps none. A namespace above 5000 entities or 10000 rules cannot be exported: a chunked export, several files, is not built. The export reports no progress, and the import creates one entity at a time, one call each plus one per further rule. A subscription exported without rules is, for one call, created with a `$Default` rule that matches nothing (`src/ServiceBusExplorer.Core/Providers/Azure/AzureEntityDefinitions.cs#CreateSubscriptionAsync`).
- **Dead legacy service.** `ServiceBusService` is registered and injected but never connected (see Legacy `ServiceBusService` on [[pages/services/core/rabbitmq-and-legacy]]), 780 lines kept alive by three read-only calls in `ConnectionsController`.
