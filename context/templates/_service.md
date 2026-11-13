---
title: "<Service name>"
version: "1.0"
date: YYYY-MM-DD
changes: "Initial service map"
page_type: service
status: stub
description: "<One-sentence responsibility>"
source:
  - <source paths that contributed>
reliability: high
---

# <Service name>

> One-sentence responsibility. If you can't compress it to one sentence, the service is doing too much.

The map of one project. It says what the project is for and lists its topic pages, saved under
`pages/services/<project>/` from `templates/_service-topic.md`. How a topic works goes on the
topic page; the rules go in `.claude/rules/<project>.md` (`templates/_project-rules.md`) and, in
full, on `pages/services/<project>/how-the-rules-are-kept.md`; dated changes go on
[[pages/history/<project>]]. `changes` holds the newest note only. Keep the map short: a reader
opens it to choose one topic page.

## Responsibility

REQUIRED. What this service owns. What it explicitly does NOT own (link the service that does).

## Rules

The rules this project must keep, and what to read before changing it, are in
`.claude/rules/<project>.md`; Claude Code loads that file when a task touches the project. Each
rule in full, with the code and tests that keep it: [[pages/services/<project>/how-the-rules-are-kept]].

## Topics

REQUIRED. One row per topic page, the rules page and the known-gaps page included. The second
column completes the sentence "read this page when a change touches ...", naming something a
reader can see in the change: a type, a folder, a route, a screen.

| Page | Read when a change touches |
|---|---|
| [[pages/services/<project>/<topic>\|<Topic>]] | <what in the code this page is about> |

## Cache footprint

If the service uses a cache, list the keys:

- `<service>:<entity>(id)` - read by [[pages/...]], invalidated by [[pages/...]]

If none: "None. Not applicable for [reason]."

## Cross-service dependencies

- **Reads from:** [[pages/services/X]] via HTTP; [[pages/services/Y]] via event
- **Written to by:** [[pages/services/Z]]

## History

This page states how the module works now. What changed when lives in [[pages/history/<module>]], newest first; never add dated activity bullets here.

## Related

REQUIRED. Projects this one references, projects that reference it, and its history page.
