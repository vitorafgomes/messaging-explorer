---
title: "ADR NNNN — <decision title>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial ADR draft"
page_type: adr
status: proposed          # proposed | accepted | deprecated
description: "<One-sentence decision>"
supersedes: ""            # e.g. "0003-old-decision-slug" if this replaces another ADR
superseded_by: ""         # leave empty until replaced
source:
  - <source paths>
reliability: high
---

# ADR NNNN — <decision title>

> One-sentence decision. The reader should be able to quote this back after 10 seconds.

## Status

- [ ] Proposed
- [ ] Accepted
- [ ] Deprecated / superseded by [[pages/decisions/MMMM-slug]]

Updated: YYYY-MM-DD.

## Context

What's the forcing function? What problem are we solving? What constraints are in play? Minimum information a new teammate needs to evaluate the decision.

## Decision

What we will do. One paragraph. Cite specific rules, thresholds, APIs, or patterns where relevant.

## Consequences

Trade-offs — what gets better and what gets worse.

- **Better:** ...
- **Worse:** ...
- **Neutral but noteworthy:** ...

## Alternatives considered

- **Alt A** — why rejected
- **Alt B** — why rejected
- **Status quo (do nothing)** — why rejected

## Enforcement

How do we know this decision is being followed?

- **Code rule / lint / test** — citation
- **Code review checklist entry** — link
- **Convention page** — [[pages/conventions/...]]
- **Invariant page** — [[pages/invariants/...]] (if the decision creates a new invariant)

## Related

- Services affected: [[pages/services/...]]
- Supersedes: [[pages/decisions/<prior>]]
- Superseded by: [[pages/decisions/<later>]] (fill in later)
- Related conventions: [[pages/conventions/...]]

## Notes

Anything that doesn't fit the sections above but future readers will want. Discussion links, meeting refs, external references.
