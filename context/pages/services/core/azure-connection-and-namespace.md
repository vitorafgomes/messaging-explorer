---
title: "Core: Azure transport, proxy and namespace properties"
version: "1.0"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.0: split out of the Azure provider page"
page_type: service
status: active
description: "Read when a change touches how an Azure connection reaches the broker (AMQP or AMQP over WebSockets, a proxy) or the namespace properties read (tier, messaging units, alias, the effective message size)."
source:
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureConnectionConfig.cs
  - src/ServiceBusExplorer.Core/Models/NamespaceInfo.cs
reliability: high
---

# Core: Azure transport, proxy and namespace properties

The rest of the Azure provider is on [[pages/services/core/azure-provider]].

**Namespace properties (2026-11-14).** `GetNamespacePropertiesAsync` is one `GetNamespacePropertiesAsync` call of the administration client with the caller's token (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#GetNamespacePropertiesCoreAsync`). It maps name, tier (`Basic`, `Standard`, `Premium`), messaging units (Premium only, null otherwise), the geo-DR alias (null when empty) and the created and modified times into `NamespaceInfo` (`src/ServiceBusExplorer.Core/Models/NamespaceInfo.cs#NamespaceInfo`), and sets `MaxMessageSizeInBytes` from the tier: 256 KB on Basic and Standard (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#StandardMaxMessageSizeInBytes`), 100 MB on Premium, the most a queue or topic can be set to (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#PremiumMaxMessageSizeInBytes`); a Premium entity's own limit is its `MaxMessageSizeInKilobytes`, already read back (`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderReadTests.cs#Queue_details_carry_forward_to_auto_delete_duplicate_detection_user_metadata_batched_operations_max_message_size_and_the_transfer_dead_letter_count`). The read needs the Manage right; any failure reaches the caller as it is, never a made-up value. Nothing in the app checks a message against the limit before sending; the broker refuses an oversized one. Pinned by `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderNamespaceTests.cs#A_Premium_namespace_carries_its_messaging_units_and_the_100_MB_an_entity_can_be_set_to`, `#A_failing_read_reaches_the_caller_as_the_broker_exception_instead_of_a_made_up_namespace`, and against the emulator, which answers the read as a Standard namespace with no alias (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs#The_emulator_namespace_reads_as_a_Standard_namespace_with_no_units_no_alias_and_the_256_KB_limit`).

**Transport and proxy (2026-11-14).** A connection may ask for AMQP over WebSockets on 443 (`UseWebSockets`) and an HTTP proxy (`ProxyAddress`), for a network that blocks 5671. `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#BuildClientOptions` sets the transport and a `WebProxy` with `UseDefaultCredentials`; `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#BuildAdministrationClientOptions` gives the administration client an `HttpClientTransport` through the same proxy, and the SDK defaults with no proxy, so the AMQP path is the one it was. `src/ServiceBusExplorer.Core/Providers/Azure/AzureConnectionConfig.cs#IsProxyAllowed` refuses a proxy that is not http or https, carries a user name or password, or comes without WebSockets, since AMQP over TCP does not go through an HTTP proxy; `IsValid` and the import call it, so a refused address is never tested, connected or stored. The connection test still probes only the administration client over HTTPS: a WebSockets transport the proxy blocks shows on the first message call, not on the test. Pinned by `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderTests.cs#A_connection_test_through_a_proxy_that_fails_goes_through_the_proxy_and_answers_false` (a loopback proxy sees the `CONNECT`) and `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs#A_connection_with_no_transport_set_sends_and_peeks_over_AMQP_as_before`.
