---
title: "ADR 0003 - Azure authentication strategy"
version: "1.0"
date: 2026-04-19
changes: "Migrated on 2026-11-12 from the owner's decision note of 2026-04-19, with what is implemented today"
page_type: adr
status: accepted
description: "Azure Service Bus is reached with a signed-in identity where possible: interactive browser sign-in, the Azure CLI session, a service principal or the default chain, with the connection string kept for compatibility; username and password, and managed identity, are rejected."
updated: 2026-11-12
source:
  - "owner's private notes, April to July 2026 (migrated with the owner's word on 2026-11-12; rewritten in English, checked against the code)"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureAuthType.cs"
  - "src/ServiceBusExplorer.Core/Providers/Azure/AzureCredentialFactory.cs"
reliability: high
---

# ADR 0003 - Azure authentication strategy

## Status

Accepted by the owner on 2026-04-19, before this context existed. Numbered here in order of migration, not of date. Partly implemented; see "Where it stands".

## Context

The Azure provider accepted only connection strings with a shared access key. Three problems followed. Many organisations forbid such keys in production: they are long-lived, all or nothing, hard to rotate, and leave no trail of who did what. Users copy the string between the portal, a password manager and the tool, and it leaks into screenshots and bug reports. And the user types in namespaces they already have access to, so the tool adds nothing the portal does not.

The requirement in the owner's words: "my user has several Service Bus namespaces - show all the services I have access to". That means signing in with an identity, listing the resources that identity can reach, and connecting with its token.

## Decision

1. **Credentials supported:**

   | Credential | For | |
   |---|---|---|
   | Interactive browser | A person at the desktop; the primary flow | Supported |
   | Azure CLI | Someone already signed in with `az login` | Supported |
   | Service principal (client secret) | Automation and headless use | Supported |
   | Default chain | Convenience in development | Supported |
   | Connection string | Compatibility, and organisations that only hand out keys | Supported |
   | Username and password | - | Rejected |
   | Managed identity | - | Excluded |

2. **"Sign in with Microsoft" is the primary flow**, followed by resource discovery: a tree of subscriptions, resource groups and namespaces to pick from. A connection made that way stores a reference to the namespace and the credential type, and no connection string.
3. **Tokens live in memory only.** Nothing is written to disk; after a restart the user signs in again.
4. **Out of scope:** assigning roles, several tenants in one session, device code flow, and a token cache on disk.

## Rationale

- **Username and password is rejected** because it fails for personal accounts, for accounts with multi-factor authentication, for federated sign-on and for guests, which together are most of the enterprise users this decision is for; Microsoft discourages the flow. A screen for something that fails for most users costs more in support than it gives.
- **Managed identity is excluded** because it only works for code running inside Azure, and this is a desktop tool. In the chain it would probe the instance metadata endpoint at every start, adding a delay and a timing side channel on any machine that happens to be a cloud VM.
- **Sign-in comes with discovery** because signing in and then still being asked to paste a namespace address is a step backwards: the identity already knows what exists.

## Consequences

- Positive: the tool becomes usable where keys are banned; access can be read-only per person; connection strings stop travelling through chats and screenshots.
- Negative: more surface (new endpoints, a sign-in window, more error states: access denied, conditional access, tenant switching), more dependencies, and an empty tree for a user with no role needs a better message than "permission denied".
- The connection-string flow stays; nobody is forced to migrate. RabbitMQ is not affected.

## Where it stands (checked 2026-11-12)

- **Done:** the five credential types exist (`src/ServiceBusExplorer.Core/Providers/Azure/AzureAuthType.cs#AzureAuthType`) and the factory builds each one (`src/ServiceBusExplorer.Core/Providers/Azure/AzureCredentialFactory.cs#Create`); the default chain excludes managed identity, as decided. Neither rejected credential appears in the code.
- **Not done:** resource discovery. No project references the Azure resource management libraries and no endpoint lists subscriptions or namespaces, so a signed-in user still types the namespace. This is the half of the decision that delivers the stated requirement.
- **Departures found by the audit** ([[pages/roadmap/code-audit-2026-11]]): the interactive credential keeps no token cache or authentication record, and test and connect each build a new credential, so the user is prompted on every test and every connect; the metrics service builds a plain default credential that includes the managed identity probe this decision excludes.

## Related

- [[pages/invariants/secrets-masked-at-the-api-boundary]] (the client secret of a service principal is a secret like the others)
- [[pages/services/core]], [[pages/history/product]], [[pages/roadmap/product-backlog]]
