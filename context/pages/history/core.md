---
title: "Core history"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: the version notes of the service page header"
page_type: reference
status: active
description: "What changed in the Core project and when, newest first, as the service page header recorded it until 2026-11-13."
source:
  - context/pages/services/core.md
reliability: high
---

# Core history

What changed when in the project [[pages/services/core|Core]] describes, newest first.

## Version notes until 2026-11-13

The `changes` field of the service page header as it stood when the page became a map, cut at each "Earlier", in its words.

- 2026-11-13: a peek can answer without bodies (includeBody false), IMessage.Body is nullable for it; the scan of a bulk call measured on the emulator not reaching 300 deep, pinned as a defect, and leaving its prefetched messages locked in some runs.
- Earlier on 2026-11-13: a peek starts at an optional sequence number on Azure, declared by SupportsPeekFromSequenceNumber; RabbitMQ refuses a start.
- Earlier on 2026-11-13: sessions are listed by a passive peek that locks nothing, one session is opened at a time, its detail reads the state and up to messageCount messages under one accept, and RabbitMQ refuses all four; an unreadable legacy file stops the consolidation and is kept; the RabbitMQ management client disposes every response; the RabbitMQ exchange types cannot be changed through a cast. Before: the Azure provider is tested against the Service Bus emulator by the integration project; the silent single-resubmit duplicate reproduced; also on 2026-11-13: 2026-11-13: export and import of entity definitions: one versioned document of every queue, topic, subscription and rule, an import that checks the document first, answers a dry run and creates only what does not exist, and SupportsDefinitions false for RabbitMQ.
- Earlier on 2026-11-13: sessions are listed by a passive peek that locks nothing, one session is opened at a time, its detail reads the state and up to messageCount messages under one accept, and RabbitMQ refuses all four; an unreadable legacy file stops the consolidation and is kept; the RabbitMQ management client disposes every response; the RabbitMQ exchange types cannot be changed through a cast. Before: the Azure provider is tested against the Service Bus emulator by the integration project; the silent single-resubmit duplicate reproduced; also on 2026-11-13: 2026-11-13: a failed connection test or connect is verified to log no secret (ConnectionFailureLogTests); a RabbitMQ queue's dead-letter count comes from its .dlq queue, where it was always 0.
- Earlier on 2026-11-13: GetQueueCountsAsync and GetSubscriptionCountsAsync read one entity's counts in one call with the caller's token; IQueueEntity carries the transfer dead-letter count, which the Azure queue list now maps; the RabbitMQ management reads of a queue and of an exchange's bindings take a token.
- Earlier on 2026-11-13: sessions are listed by a passive peek that locks nothing, one session is opened at a time, its detail reads the state and up to messageCount messages under one accept, and RabbitMQ refuses all four; an unreadable legacy file stops the consolidation and is kept; the RabbitMQ management client disposes every response; the RabbitMQ exchange types cannot be changed through a cast. Before: the Azure provider is tested against the Service Bus emulator by the integration project; the silent single-resubmit duplicate reproduced
