---
title: "<Flow name>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial flow page"
page_type: knowledge
status: stub
description: "<One-sentence: what end-to-end behavior this flow delivers>"
source:
  - <citation>
reliability: high
---

# <Flow name>

> One-sentence summary of what end-to-end behavior this flow delivers and why it crosses service boundaries.

## Trigger

What initiates the flow. HTTP route + caller, Service Bus event + producer, timer + cadence, or upstream flow.

## Services touched

Ordered list of services in the order they execute. Link each [[pages/services/*]].

1. [[pages/services/<svc>]] - *role in this flow (validates / debits / publishes)*
2. [[pages/services/<svc>]] - *role*

## Drawing

One Mermaid `sequenceDiagram`: the UI, the API host, every module touched, the port or integration event between them, and every store commit (Postgres schema, Mongo collection, the NAS share) as its own arrow, in order.

## Steps

Numbered, code-anchored. Each step cites `path#Member` for the entry point. **Never invent a path** - if the path can't be verified, mark it `?`.

1. **<Step name>** - `src/<path>.cs:LINE`. What happens here in one sentence. What it produces.
2. **<Step name>** - `src/<path>.cs:LINE`. What happens here. What it produces.

## Invariants this flow must preserve

Every [[pages/invariants/*]] that constrains a step in this flow. If a step would violate one, the step (or the invariant) is wrong.

- [[pages/invariants/<name>]] - *which step this constrains*

## Failure modes

- **<Failure>** - what happens, where it surfaces, how the flow recovers. Cite `path#Member` of the handler.
- **<Failure>** - same.

## Idempotency / replay

How the flow handles duplicate triggers, retries, or partial completion. Cite the dedup key or version stamp.

## Developer orientation

How many saves and in what order (no Unit of Work), what a crash between two of them leaves behind and who cleans it, where the tenant boundary is enforced, the files to touch in order (Domain, Application, Infrastructure, API, tests).

## Tests

- **Integration:** `src/<service>.Tests/Integration/...` - what scenario.
- **Contract (Pact):** `pacts/<consumer>-<provider>.json` - which interactions cover which step.
- **End-to-end:** if any.

## Related

- Decisions that shaped the flow: [[pages/decisions/NNNN-*]]
- ADRs proposing changes: [[pages/decisions/NNNN-*]]
- Roadmap items touching it: [[pages/roadmap/*]]
