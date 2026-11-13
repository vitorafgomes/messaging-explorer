---
title: "Api history"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: the version notes of the service page header"
page_type: reference
status: active
description: "What changed in the Api project and when, newest first, as the service page header recorded it until 2026-11-13."
source:
  - context/pages/services/api.md
reliability: high
---

# Api history

What changed when in the project [[pages/services/api|Api]] describes, newest first.

## Version notes until 2026-11-13

The `changes` field of the service page header as it stood when the page became a map, cut at each "Earlier", in its words.

- 2026-11-13: the four dead-letter and transfer dead-letter peek routes take an optional includeBody, false answering each message with body null, anything but true or false refused with 400.
- Earlier on 2026-11-13: the four dead-letter and transfer dead-letter peek routes take an optional fromSequenceNumber, refused with 400 when it is not a whole number of 0 or more or the provider cannot read from a position; the capabilities answer carries supportsPeekFromSequenceNumber.
- Earlier on 2026-11-13: the session detail takes messageCount and answers messages under one accept; eight session routes under the queue and subscription bases replace api/sessions; the list locks nothing; state and expectedState both required; a disabled entity answers 409; SessionRouteTests added. 2026-11-12: entity names in the path are decoded once from the raw target by RawTargetRouteValuesAttribute; EntityNameRoutingTests added.
- Earlier: one exception handler answers a constant 500 in every environment; every 500 body is {message}; import never returns an exception message; the Host filter and the API_SECRET fail-fast are pinned by tests; four Known gaps closed; ErrorBodyTests and BoundaryGuardTests added; also on 2026-11-13: 2026-11-13: POST api/namespace/export and POST api/namespace/import (dryRun, a 10 MB body bound, fixed bodies) and supportsDefinitions in the capabilities answer; DefinitionsRouteTests added.
- Earlier on 2026-11-13: the session detail takes messageCount and answers messages under one accept; eight session routes under the queue and subscription bases replace api/sessions; the list locks nothing; state and expectedState both required; a disabled entity answers 409; SessionRouteTests added. 2026-11-12: entity names in the path are decoded once from the raw target by RawTargetRouteValuesAttribute; EntityNameRoutingTests added.
- Earlier: one exception handler answers a constant 500 in every environment; every 500 body is {message}; import never returns an exception message; the Host filter and the API_SECRET fail-fast are pinned by tests; four Known gaps closed; ErrorBodyTests and BoundaryGuardTests added; also on 2026-11-13: 2026-11-13: monitoring polls on a configured period with a 30-second floor and a one-hour ceiling, skips a tick while the previous poll runs, lists subscriptions four topics at a time, carries the transfer dead-letter count and null for a count that is not counted, answers its snapshot with the period and the last failed poll; GET api/monitoring/counts reads one queue or subscription now; MonitoringBackgroundServiceTests added.
- Earlier on 2026-11-13: the session detail takes messageCount and answers messages under one accept; eight session routes under the queue and subscription bases replace api/sessions; the list locks nothing; state and expectedState both required; a disabled entity answers 409; SessionRouteTests added. 2026-11-12: entity names in the path are decoded once from the raw target by RawTargetRouteValuesAttribute; EntityNameRoutingTests added.
- Earlier: one exception handler answers a constant 500 in every environment; every 500 body is {message}; import never returns an exception message; the Host filter and the API_SECRET fail-fast are pinned by tests; four Known gaps closed; ErrorBodyTests and BoundaryGuardTests added
