---
title: "Core: the Azure directory of sign in, then pick"
version: "1.0"
date: 2026-11-19
updated: 2026-11-19
changes: "v1.0: the Azure Resource Manager reader behind the add dialog's three steps"
page_type: service
status: active
description: "Read when a change touches AzureNamespaceDirectory: the sign-in for the directory, the session it keeps, the subscriptions and namespaces it reads from Azure Resource Manager, its bounds and its failures."
source:
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureCredentialFactory.cs
  - src/ServiceBusExplorer.Core/Abstractions/EntityAdministrationExceptions.cs
  - src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureNamespaceDirectoryTests.cs
reliability: high
---

# Core: the Azure directory of sign in, then pick

The Azure provider itself is on [[pages/services/core/azure-provider]]; the decision to read Resource Manager is [[pages/decisions/0007-read-azure-resource-manager-to-list-namespaces]].

**What it is (2026-11-19).** `src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs#AzureNamespaceDirectory` lets the add dialog sign in first and pick the namespaces after. It is one singleton of the API. It signs in with Microsoft or with the Azure CLI session only: `src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs#SignInAsync` refuses every other `AzureAuthType` before a credential is built, and `src/ServiceBusExplorer.Core/Providers/Azure/AzureCredentialFactory.cs#ForDirectory` builds the credential from the auth type and an optional tenant only. The sign-in asks a token of the scope `https://management.azure.com/.default` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs#Scope`): with Microsoft that opens the browser; with the CLI it asks `az` for a token. It keeps the credential as the session, replacing the one before, and answers the account (`preferred_username`, else `upn`, else `unique_name`) and the tenant (`tid`) read from the token's claims. A failed sign-in keeps no session. `src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs#SignOut` drops it.

**What it reads.** `src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs#ListSubscriptionsAsync` reads `GET /subscriptions?api-version=2022-12-01` and answers id and display name. `src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs#ListNamespacesAsync` reads `GET /subscriptions/{id}/providers/Microsoft.ServiceBus/namespaces?api-version=2021-11-01` and answers name, host (from `properties.serviceBusEndpoint`, else `{name}.servicebus.windows.net`), resource group, tier (`sku.name`) and resource ID. The subscription ID must be a GUID; any other is refused before a request. Each takes the session's credential, or a credential passed in, which is how the tests drive it.

**Bounds.** A `nextLink` is followed only when it is https on `management.azure.com` on the default port, so the token is never sent to another host; at most 10 pages and 1000 items; 30 seconds per read on top of the caller's token, which stops the read and is not reported as a timeout.

**Failures.** Every failure is `src/ServiceBusExplorer.Core/Abstractions/EntityAdministrationExceptions.cs#AzureDirectoryException` with a `AzureDirectoryFailure` reason and a sentence this application wrote: 401 and 403 are "Your account may not read this subscription (403).", another status "Azure answered 500.", a body that is not a list, a timeout, a network failure, a credential that gives no token, a refused or failed sign-in ("No Azure CLI session answered. Run az login in a terminal, then Check again." for the CLI). No message carries the token or the text Azure answered, and the log lines name the status or the exception type only.

**The token.** It lives in the credential the session holds and in the `Authorization` header of each request; it is never returned, never logged, never stored. `workspace.json` gets only what the dialog saves: the namespace, the tenant and the resource ID. The API side is [[pages/services/api/controllers]].

## Tests

`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureNamespaceDirectoryTests.cs#AzureNamespaceDirectoryTests` drives it with a fake credential that issues a token with a sentinel signature and a fake handler in place of Resource Manager; nothing leaves the machine. They cover the two reads and their URLs and scope, the next link followed and the three that are not (`#A_next_link_to_another_host_or_without_https_is_not_followed_so_the_token_never_leaves_for_it`), the page and item bounds, the GUID refusal, 403, 401, 500, a body that is not JSON, a timeout, a network failure, the caller's cancellation, the sign-in and its claims, the refused auth types, a sign-in that throws, and the session replaced and dropped. `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureCredentialFactoryTests.cs#ForDirectory_refuses_every_other_auth_type` pins the factory.

**After the two reviews of 2026-11-19.** A read that reaches its bounds with more to read is a failure that says so (`TooMany`), never a shorter list shown as whole. A sign-out is a barrier: a sign-in that completes after it keeps no session (`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureNamespaceDirectoryTests.cs#A_sign_in_that_completes_after_a_sign_out_keeps_no_session`). A sign-in nobody completes gives up after five minutes. A tenant that is neither an ID nor a domain is refused before a credential is built. The handler that reaches the network follows no redirect (`src/ServiceBusExplorer.Core/Providers/Azure/AzureNamespaceDirectory.cs#NetworkHandler`). In the dialog, leaving a sign-in path or closing the dialog ends the session on the API, and a save reported as failed is checked against the stored connections before it is offered again.

