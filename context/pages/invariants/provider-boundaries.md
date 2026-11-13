---
title: "Provider boundaries"
version: "1.0"
date: 2026-11-12
changes: "Founded from the code on 2026-11-12"
page_type: invariant
status: active
description: "A broker is reached through IMessagingProvider, what a provider cannot do is declared in IProviderCapabilities, and vendor SDK types stay inside their provider folder."
updated: 2026-11-12
enforced_by:
  - "src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:18"
  - "src/ServiceBusExplorer.Core/Providers/ProviderFactory.cs:33"
  - "src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:22"
verified_by:
  - "src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQSessionTests.cs:1"
source:
  - "src/ServiceBusExplorer.Core/Abstractions/"
  - "src/ServiceBusExplorer.Core/Providers/"
  - "src/ServiceBusExplorer.Api/Controllers/"
  - "docs/ADDING_PROVIDERS.md"
reliability: medium
---

# Provider boundaries

> Code outside `src/ServiceBusExplorer.Core/Providers/<Provider>/` talks to a broker through `IMessagingProvider` and never names an `Azure.*` or `RabbitMQ.Client` type. What a provider cannot do is a capability flag the UI reads, never a method that quietly does nothing. Rule F of root `CLAUDE.md`.

## Why this exists

The product is "one tool, several brokers". Every vendor type that leaks into a controller, a model or the Angular app is a place a third provider has to be special-cased, and every member a provider silently skips is a button that appears to work.

## Scope

- **Applies to:** `Abstractions/`, `Models/`, `Services/` of [[pages/services/core]]; every controller of [[pages/services/api]]; the Angular app.
- **Does not cover:** the inside of a provider folder, where the vendor SDK is the point.

## Where it's enforced

By convention and review only; no architecture test exists (tracked in [[pages/roadmap/followups]]). `reliability: medium` for that reason.

- `src/ServiceBusExplorer.Core/Abstractions/IMessagingProvider.cs:18` - the provider contract; `Abstractions/` references no vendor SDK.
- `src/ServiceBusExplorer.Core/Providers/ProviderFactory.cs:33` - the one place a provider type is chosen from `ProviderType`.
- `src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:22` - controllers obtain the active `IMessagingProvider` and call the contract.

## How it's verified

- `src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQSessionTests.cs:1` - pins what the RabbitMQ provider answers for sessions, the one capability difference with a test.
- Nothing fails when a vendor `using` appears outside a provider folder. The `boundaries` lens of gate 6 is the check.

## Known exceptions

- **`Services/AzureMonitorMetricsService.cs`** uses the Azure Monitor SDK outside `Providers/Azure/` and takes a `TokenCredential` in its constructor. Metrics are Azure-only by design today; accepted until a second provider has metrics.
- **`Services/ServiceBusService.cs`** is the legacy Azure-only service. It is still registered and never connected ([[pages/services/core]]); the fix is to delete it, not to move it.
- **`Models/ServiceBusConnection.cs`** mixes Azure and RabbitMQ fields and references `AzureAuthType`.
- **RabbitMQ members behind the shared interface** that throw `NotSupportedException` or return empty (dead-lettering, session state, search) instead of being gated by a capability the UI checks; whether each has a matching capability flag is on [[pages/services/core]].
- **The Angular provider registry is not wired into any route** and `docs/ADDING_PROVIDERS.md` describes a flow the app does not run ([[pages/services/web-app]]).

## Change protocol

A new provider or a new member on `IMessagingProvider` lands with both providers answering (implemented, or a capability flag set to false and read by the UI) and with one failing-call test per new external call (Rule I).
