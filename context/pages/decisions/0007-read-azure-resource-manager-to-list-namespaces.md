---
title: "ADR 0007 - Read Azure Resource Manager to list the namespaces"
version: "1.0"
date: 2026-11-19
changes: "2026-11-19: accepted, built and released in 2.5.0. Initial ADR draft"
page_type: adr
status: accepted
description: "The add dialog signs in first and lists the subscriptions and Service Bus namespaces of the account from Azure Resource Manager, with a token of the Resource Manager scope kept in the API's memory only."
supersedes: ""
superseded_by: ""
source:
  - context/prototypes/web-app/Connections.dc.html
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs
  - src/ServiceBusExplorer.Api/Controllers/AzureDirectoryController.cs
  - chat
reliability: high
---

# ADR 0007 - Read Azure Resource Manager to list the namespaces

> To add a connection the user signs in first, then picks the client and environment, then ticks the namespaces Azure Resource Manager lists for the account; the app reads Resource Manager with a token of its scope, which stays in the API's memory.

## Status

- [ ] Proposed
- [x] Accepted
- [ ] Deprecated / superseded

Updated: 2026-11-19.

## Context

The owner asked that the add dialog work as the Connections artboard draws it: authenticate first, then the client and environment, then the namespaces to add to that environment. Until now the user typed the namespace host before signing in. [[pages/decisions/0003-azure-authentication-strategy]] named resource discovery as the part not built. Listing namespaces needs the subscriptions of the account and the namespaces of each, which only Azure Resource Manager answers, and a token for `https://management.azure.com/.default`: a wider scope than the Service Bus data plane the app used so far. The owner also asked that Service Principal and Default credential leave the Add screen; stored connections of those types keep working.

## Decision

`AzureNamespaceDirectory` in Core reads Resource Manager, behind `api/azure-directory` ([[pages/services/core/azure-directory]], [[pages/services/api/controllers]]). It signs in with Microsoft or the Azure CLI session only, keeps one session (the credential) in memory, reads `GET /subscriptions` and `GET /subscriptions/{id}/providers/Microsoft.ServiceBus/namespaces`, follows a next link only on `management.azure.com` over https, and stops at 10 pages, 1000 items and 30 seconds. The token is never returned, logged or stored; `workspace.json` gets the namespace, tenant and resource ID of each connection saved, one per ticked namespace.

## Consequences

- **Better:** no namespace host to type; the resource ID the Monitoring metrics need comes with each namespace; one sign-in adds several connections.
- **Worse:** the app asks for a token that can read the account's whole Resource Manager surface, not only Service Bus. Only two read routes are called, but the token's scope is wider than its use. A connection saved this way still signs in again on its first connect, because the provider builds its own credential.
- **Neutral but noteworthy:** the session is process-wide; a second sign-in replaces it, and closing the dialog signs out.

## Alternatives considered

- **Keep typing the namespace first** - rejected by the owner: it is the step the artboard removes.
- **Azure SDK `Azure.ResourceManager.ServiceBus`** - a new package and a large dependency for two GET calls; the reads go through `HttpClient` inside `Providers/Azure/`.
- **List with the Service Bus scope** - Service Bus has no API that lists namespaces.

## Enforcement

- `src/ServiceBusExplorer.Api.Tests/AzureDirectoryRouteTests.cs#The_token_reaches_no_response_body_and_no_log_entry_on_any_route_whether_it_succeeds_or_fails` - a sentinel token is absent from every response and log entry of the four routes.
- `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureNamespaceDirectoryTests.cs#A_next_link_to_another_host_or_without_https_is_not_followed_so_the_token_never_leaves_for_it`.
- [[pages/invariants/secrets-masked-at-the-api-boundary]] names the token.

## Related

- [[pages/decisions/0003-azure-authentication-strategy]]
- [[pages/services/web-app/features-connections]]
