---
title: "Product backlog"
version: "1.0"
date: 2026-11-12
changes: "Initial tracker, migrated from the owner's roadmap of April 2026 and assessment of July 2026"
page_type: roadmap
status: active
description: "What the owner wants the product to gain, as features: the list from the earlier roadmaps that is not built yet, checked against the code, with what each one waits on."
updated: 2026-11-12
source:
  - "owner's private notes, April to July 2026 (migrated with the owner's word on 2026-11-12; rewritten in English, checked against the code)"
reliability: medium
---

# Product backlog

> Features the owner has asked for and the code does not have yet. Defects are elsewhere: [[pages/roadmap/code-audit-2026-11]] and [[pages/roadmap/followups]]. Order here is the owner's last stated preference, not a commitment.

Each entry carries the date it was first written down. What was planned and is already built is on [[pages/history/product]]. This page is a tracker: `version` changes only when its shape does.

## Asked for, in the owner's last order (2026-07-06)

- **2026-07-06 - Search across entities.** One screen that searches every queue and subscription. The per-entity search endpoints exist; this needs a fan-out on the server and a client, which the web app does not have even for one entity.
- **2026-04-08 - Several namespaces at once (connection tabs).** Waits on the active provider leaving the static slot ([[pages/services/api]]); deferred once for that reason ([[pages/history/product]]).
- **2026-07-06 - Edit an entity's configuration.** Only create and delete exist; nothing changes the properties of a queue, topic or subscription.
- **2026-04-08 - Subscription rules editor.** SQL and correlation filters are read-only today.
- **2026-07-06 - Monitoring history.** The API serves a snapshot and a history; the screen shows only the present.
- **2026-04-08 - Metrics and alerts.** Real charts from Azure Monitor per entity, and thresholds that notify (dead-letter above N, active above N). Waits on metrics following the active connection instead of one configured namespace.
- **2026-07-06 - Command palette and keyboard shortcuts** for navigation.
- **2026-04-19 - Azure resource discovery** after sign-in, the unbuilt half of [[pages/decisions/0003-azure-authentication-strategy]].

## Smaller, unordered

- 2026-04-08 - Connection profiles by environment with a colour label. The toolbar badge on the UI prototype is the first piece ([[pages/conventions/ui]]).
- 2026-04-08 - Secrets encrypted at rest. Needs the owner's choice between the OS keychain and Electron's safe storage ([[pages/roadmap/improvement-plan]]).
- 2026-07-06 - RabbitMQ: the real dead-letter exchange instead of the `<queue>.dlq` convention; metrics from the management statistics.
- 2026-07-06 - Azure: list and cancel scheduled messages; deferred messages.
- 2026-07-06 - A health endpoint that probes the broker; paging for large queues.
- 2026-04-08 - Syntax highlighting of JSON and XML bodies; saved filter presets.
- 2026-04-08 - A command-line mode for scripts (peek, send, purge).
- 2026-04-08 - A plugin system for other brokers; drag a message between entities; a sound on a dead-letter threshold.

## Release cadence the owner set (2026-04-08)

Patch releases as needed for fixes and security; minor releases for features, roughly monthly; major releases for breaking changes and platform upgrades, roughly quarterly.
