---
title: "Messaging Explorer Context Index"
version: "1.1"
date: 2026-11-12
changes: "v1.1: lists the areas; each area has its own index"
page_type: index
status: active
description: "Content catalogue for the Messaging Explorer LLM wiki."
updated: 2026-11-13
source:
  - chat
  - src/
  - web-app/
reliability: high
---

# Messaging Explorer Context Index

The content catalogue for this context. Start here, follow wikilinks. If the context can't answer, grep source, then `/wiki-crystallize` the findings back.

- Operation contract: [[CLAUDE]] (how Claude operates on this context)
- Page schema: [[wiki-schema]] | Config: [[wiki-config]]
- Templates: `templates/`
- UI prototype: `prototypes/web-app/` (the target layout: a design canvas of one artboard per screen, and the earlier single-file drawing with screenshots; the spec for [[pages/conventions/ui]])

> **Coverage note (2026-11-12):** founded in one day, from the code only, in the working tree of
> branch `fix/dlq-bulk-operations` with the owner's uncommitted changes. Every `path:line` citation
> resolves (`tools/checks/check-context-refs.sh`); the service pages and the project map were written by
> three survey agents and their citations were spot-checked, not all re-read, so a line that exists
> may still describe its claim loosely. On 2026-11-12 the owner allowed his private notes to be
> migrated: the product history, the Azure authentication decision and the feature backlog came
> from them, rewritten in English and checked against the code; audits, sessions and plans stayed private. The folders
> `incidents/`, `flows/` and `domain/` are empty until first use.
>
> The survey found real defects. They are recorded, not fixed: "Known gaps" on each service, its `known-gaps` topic pages,
> one list by risk in [[pages/roadmap/followups]].

## Areas

Each area lists its own pages in its `index.md`; a service map lists its topic pages. Open the area you need.

| Area | Holds |
|---|---|
| [[pages/overview/index\|Overview]] | What the tool is for, who uses it and where it is going. |
| [[pages/architecture/index\|Architecture]] | The projects, their dependencies and which tests cover each. |
| [[pages/services/index\|Services]] | One map per project; each map lists the topic pages of its project. |
| [[pages/invariants/index\|Invariants]] | The rules the code must preserve, with the code and tests that enforce them. |
| [[pages/conventions/index\|Conventions]] | Tooling, testing, the user interface, and decisions that look like defects. |
| [[pages/decisions/index\|Decisions]] | The architecture decision records. |
| [[pages/history/index\|History]] | What changed when: the product, and each project. |
| [[pages/roadmap/index\|Roadmap]] | Initiatives, the backlog, audits and the follow-ups tracker. |
| [[pages/runbooks/index\|Runbooks]] | Operational procedures. |
