---
title: "<Service name>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial service page"
page_type: service
status: stub
description: "<One-sentence responsibility>"
source:
  - <source paths that contributed>
reliability: high
---

# <Service name>

> One-sentence responsibility. If you can't compress it to one sentence, the service is doing too much.

## To change here, read

The 4 to 10 pages that constrain a change in this module: its invariants, the ADRs that set its shape, the flows that run through it, the conventions it must follow. A reader about to change the module reads these and nothing else first.

- [[pages/invariants/<name>]]
- [[pages/decisions/<NNNN-slug>]]
- [[pages/flows/<name>]]
- [[pages/conventions/<name>]]

## Responsibility

What this service owns. What it explicitly does NOT own (link the service that does).

## Public contract

- **HTTP routes** — top-level route prefix, or "internal only"
- **Events published** — Service Bus topics/subscriptions this service writes to
- **Events consumed** — inbound events this service subscribes to
- **Direct callers** — other services that call this one via HTTP

## How it works

At least one drawing (Mermaid: `flowchart`, `sequenceDiagram` or `stateDiagram-v2`) of how the service works: where data lands, the write path with its save order, the read path with its authorisation gate, and the lifecycle of the main record. Every box names a type listed under Hot spots. Required for every new feature.

## Invariants

Link every [[pages/invariants/*]] this service must preserve. If an invariant doesn't have a page yet, create one (copy `templates/_invariant.md`).

- [[pages/invariants/<name>]] — *one-line summary*
- [[pages/invariants/<name>]] — *one-line summary*

## Hot spots

Code paths that are high-churn, high-complexity, or known-fragile. Cite `file:line`.

- `src/<path>.cs:LINE` — *what's hot about it*
- `src/<path>.cs:LINE` — *what's hot about it*

## Cache footprint

If the service uses tier-2 cache, list the keys:

- `<service>:<entity>(id)` — read by [[pages/...]], invalidated by [[pages/...]]

If none: "None. Not applicable for [reason]."

## Cross-service dependencies

- **Reads from:** [[pages/services/X]] via HTTP; [[pages/services/Y]] via event
- **Written to by:** [[pages/services/Z]]

## Testing footprint

- **Unit tests:** `src/<service>.Tests/...`
- **Integration tests:** `src/<service>.Tests/Integration/...`
- **Invariants verified by tests:** list the invariant pages that have `verified_by:` entries pointing into this service

## History

This page states how the module works now. What changed when lives in [[pages/history/<module>]], newest first; never add dated activity bullets here.

## Known violations / P1 debt

If the service has tracked structural debt (violations of conventions, pending refactors), list and link:

- *Description* — tracked in [[pages/roadmap/<initiative>]]

## Ownership

- **Primary:** <person / team>
- **Escalation:** see [[pages/overview/stakeholders]]
