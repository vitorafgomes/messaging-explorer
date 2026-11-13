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

## Next version: Azure Event Hubs and Azure Event Grid (2026-11-12)

On 2026-11-12 the owner decided that the next version adds Azure Event Hubs and Azure Event Grid. The three Microsoft products (Service Bus, Event Hubs, Event Grid) are presented together as one "Microsoft Azure" family, under one sign-in where the user has one.
Current SDKs only, with performance and security decided at design time, as for the Service Bus work. The survey, the connection model, the fit with `IMessagingProvider`, the items and the order are on [[pages/roadmap/azure-event-hubs-and-event-grid]].

## Asked for, in the owner's last order (2026-07-06)

- **2026-07-06 - Search across entities.** One screen that searches every queue and subscription. The per-entity search endpoints exist; this needs a fan-out on the server and a client, which the web app does not have even for one entity.
- **2026-04-08 - Several namespaces at once (connection tabs).** Waits on the active provider leaving the static slot ([[pages/services/api]]); deferred once for that reason ([[pages/history/product]]).
- **2026-07-06 - Edit an entity's configuration.** Nothing changes the properties of a queue, topic or subscription, and no screen creates or deletes one either: the API can, the app never calls it. Item 1 of [[pages/roadmap/azure-service-bus-administration]].
- **2026-04-08 - Subscription rules editor.** SQL and correlation filters are read-only today. Item 2 of [[pages/roadmap/azure-service-bus-administration]].
- **2026-07-06 - Monitoring history.** The API keeps 120 snapshots; the screen charts the totals of the last 20 polls and has no history per entity. Item 5 of [[pages/roadmap/azure-service-bus-administration]].
- **2026-04-08 - Metrics and alerts.** Real charts from Azure Monitor per entity, and thresholds that notify (dead-letter above N, active above N). Waits on metrics following the active connection instead of one configured namespace.
- **2026-07-06 - Command palette and keyboard shortcuts** for navigation.
- **2026-04-19 - Azure resource discovery** after sign-in, the unbuilt half of [[pages/decisions/0003-azure-authentication-strategy]].

## From the comparison with Service Bus Explorer (2026-11-12)

The owner asked what the reference tool for Azure Service Bus has that this product lacks. Ideas only: current SDKs, performance and security decided at design time. What exists, what to build per layer and the order are on [[pages/roadmap/azure-service-bus-administration]]; the numbers are its items.

- **2026-11-12 - Enable and disable an entity** (active, disabled, send disabled, receive disabled). Item 3.
- **2026-11-12 - Export and import the definitions of a namespace** (queues, topics, subscriptions, rules), to recreate them elsewhere. Item 4.
- **2026-11-12 - Counts of every entity on one screen**, sortable, filterable, with the dead-letter threshold the user sets. Item 5.
- **2026-11-12 - Browse sessions**: the messages of one session, the state editor, sessions on queues. Item 6. Built on 2026-11-13, with the defect it started with fixed: listing sessions no longer locks any.
- **2026-11-12 - Scheduled and deferred messages**: list, cancel a scheduled one, mark a deferred one. Item 7. Built on 2026-11-12: the state of each message, a filter of the loaded ones and the cancel on queues. Left: a listing from the broker, topics, and deferral itself.
- **2026-11-12 - Transfer dead-letter queue** reachable from the messages dialog. Item 8. Built on 2026-11-12.
- **2026-11-12 - Send many messages** with a count, a cap and a split by batch size. Item 9.
- **2026-11-12 - Live view of arriving messages**, by polling a peek, never a receiver. Item 10; last.
- **2026-11-12 - Sort the message list, copy the body, filter the tree by name, dates on the queue panel.** Item 11.
- **2026-11-12 - Sovereign clouds** as a fixed list on the connection. Item 12; only on request.

**The automatic resubmit, at the size of a real backlog.** The owner's remark of 2026-11-12: "we have 700 thousand messages in dead-letter, we click and process all of them automatically". What exists: the continuous resubmit runs inside its dialog, so closing the dialog stops the run; it stops on the first failure or possible duplicate, because the failed message stays at the head of the dead-letter queue and each cycle peeks the head ([[pages/services/web-app]]); it shows no elapsed time, rate or estimate. Wanted, none of it built:

- **2026-11-12 - Continue past a failure** without ever resending a possible duplicate ([[pages/invariants/bulk-operations-are-at-least-once]]), and report every failure at the end.
- **2026-11-12 - A run that belongs to the app,** not to the dialog: it survives closing the dialog, with pause and stop.
- **2026-11-12 - An estimate** of the time left, from the measured rate, with the elapsed time and the rate shown.
- **2026-11-12 - A filter before starting:** dead-letter reason, enqueued time.
- **2026-11-12 - A final report that can be saved.**

## RabbitMQ: the eight tutorial scenarios, each with tests (2026-11-12)

The owner named the official tutorials as "the ways we can receive messages" on RabbitMQ: queues 1 to 6 (Hello World, Work Queues, Publish/Subscribe, Routing, Topics, RPC) and streams 1 and 2 (Hello World, Offset Tracking), and requires tests that validate each of them.
Reading must not change the broker unless the user asked for a destructive action; a stream is read from a position and never purged, received or moved.
The topology of each, what the app shows today, how to represent it, what to build per layer, the test plan and the order are on [[pages/roadmap/rabbitmq-messaging-scenarios]].

## Smaller, unordered

- 2026-04-08 - Connection profiles by environment with a colour label. The toolbar badge on the UI prototype is the first piece ([[pages/conventions/ui]]).
- 2026-04-08 - Secrets encrypted at rest. Needs the owner's choice between the OS keychain and Electron's safe storage ([[pages/roadmap/improvement-plan]]).
- 2026-07-06 - RabbitMQ: the real dead-letter exchange instead of the `<queue>.dlq` convention; metrics from the management statistics.
- 2026-07-06 - Azure: list and cancel scheduled messages; deferred messages. Cancel on queues built on 2026-11-12 ([[pages/roadmap/azure-service-bus-administration]], item 7).
- 2026-07-06 - A health endpoint that probes the broker; paging for large queues.
- 2026-04-08 - Syntax highlighting of JSON and XML bodies; saved filter presets.
- 2026-04-08 - A command-line mode for scripts (peek, send, purge).
- 2026-04-08 - A plugin system for other brokers; drag a message between entities; a sound on a dead-letter threshold.

## Release cadence the owner set (2026-04-08)

Patch releases as needed for fixes and security; minor releases for features, roughly monthly; major releases for breaking changes and platform upgrades, roughly quarterly.
