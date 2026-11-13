---
title: "<Term>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial domain term page"
page_type: domain-home
status: active
description: "<One-sentence definition of the term>"
source:
  - <source paths>
reliability: high
---

# <Term>

> One-sentence definition. Written so a new teammate understands it without following any link.

## Meaning in this project

What this term means specifically in this codebase, distinct from general industry usage. Note any overloaded meanings with other teams or external sources.

## Where it lives

- **Owned by:** [[pages/services/...]]
- **Referenced by:** [[pages/services/...]], [[pages/services/...]]

## Key attributes

Bulleted properties that matter. Types, constraints, lifecycle.

- **<attribute>** — <type / rule>
- **<attribute>** — <type / rule>

## Lifecycle

States this entity/concept moves through, if applicable.

```
<state A> → <state B> → <state C>
              ↓
           <state D>
```

Each transition: who triggers it, what validates it, what event fires.

## Related terms

Domain terms this links to. Don't re-define — link the other page.

- [[pages/domain/<related>]] — *one-line relationship*
- [[pages/domain/<related>]] — *one-line relationship*

## Invariants

- [[pages/invariants/...]] — *rule this term is bound by*

## Gotchas

Historical ambiguities, naming quirks, conversations that keep repeating.

- *Gotcha* — *resolution*

## Code references

Where the term is manifest in code.

- `src/<path>.cs:LINE` — definition / entity / table
- `src/<path>.cs:LINE` — key behavior
