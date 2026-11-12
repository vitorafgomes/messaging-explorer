---
title: "<Invariant statement>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial invariant page"
page_type: invariant
status: active
description: "<One-sentence statement of the rule>"
enforced_by:
  - "src/<path>.cs:LINE"
verified_by:
  - "src/<path>.Tests/<test>.cs:LINE"
source:
  - <source paths>
reliability: high
---

# <Invariant statement>

> One-sentence statement. Written as a rule: *"Every X must Y."* or *"No code path may Z."* Specific and falsifiable.

## Why this exists

The failure mode that motivated the invariant. Cite the incident, the bug, or the design constraint. If there's an [[pages/incidents/...]] page, link it.

## Scope

Where the invariant applies. What it does NOT cover.

- **Applies to:** <services / paths / entity types>
- **Does not cover:** <explicit out-of-scope cases>

## Where it's enforced

Cite `file:line` for every enforcement point. The `enforced_by:` frontmatter field holds the machine-readable list; prose below explains each.

- `src/<path>.cs:LINE` — *what this code does to enforce the rule*
- `src/<path>.cs:LINE` — *what this code does*

## How it's verified

Tests that would fail if the invariant were broken. Cite `file:line`.

- `src/<path>.Tests/<test>.cs:LINE` — *what scenario this test covers*

## Known exceptions

Places where the invariant is intentionally not applied, with justification.

- *Scope / path* — *why exempted*

## Related

- Services bound by this: [[pages/services/...]]
- ADR that established this: [[pages/decisions/...]]
- Conventions that reference this: [[pages/conventions/...]]
- Similar invariants: [[pages/invariants/...]]

## Change protocol

If a future change must violate this invariant:

1. Draft a superseding [[pages/decisions/...]] ADR explaining why.
2. Update this page: set `status: deprecated`, set `superseded_by:`.
3. Replace the enforcement code with the new rule the ADR establishes.

*An invariant is harder to remove than to add. That's intentional.*
