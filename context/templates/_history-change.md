---
title: "<YYYY-MM — Short descriptive title>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial history note"
page_type: reference       # history notes are reference-class; they don't mutate
status: artefact           # historical record; not actively maintained
description: "<One-sentence retrospective>"
source:
  - <source paths — PR links, design docs, chat transcripts via crystallize>
reliability: high
---

# <YYYY-MM — Short descriptive title>

> One-sentence retrospective. Read like a commit message title for the whole effort.

## What changed

Plain description of the before/after state. No prose filler — enumerate.

## Why

The forcing function. Link the [[pages/roadmap/...]] initiative if applicable.

## Outcome

Concrete results. Numbers where possible.

- <metric before> → <metric after>
- <count of PRs>, <count of files touched>
- Duration: <YYYY-MM-DD>–<YYYY-MM-DD>

## Services affected

- [[pages/services/...]]
- [[pages/services/...]]

## Invariants / ADRs affected

- Added: [[pages/invariants/...]], [[pages/decisions/...]]
- Modified: [[pages/...]]
- Superseded: [[pages/decisions/...]] → replaced by [[pages/decisions/...]]

## Followups left

Known items not done in this effort. Link the roadmap entry that tracks them.

- <item> — tracked in [[pages/roadmap/...]]

## Key references

- PRs: <links>
- Design doc: `raw/designs/<filename>` → `ingested/designs/<filename>`
- Discussion: <link>

## Lessons

What we learned. Keep honest; this is the section future-us will re-read.
