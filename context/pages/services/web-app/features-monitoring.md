---
title: "Web App: Monitoring screen"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Web App service page"
page_type: service
status: active
description: "Read when a change touches the Monitoring screen: the snapshot, the counts table of every entity, its sort, filter, threshold and refresh, the Overview."
source:
  - web-app/src/app/features/monitoring/
reliability: high
---

# Web App: Monitoring screen

One topic of [[pages/services/web-app|Web App]]; the map lists the others.

## features/

**Monitoring (2026-11-13).** The screen reads `GET monitoring/snapshot`, now `{ snapshot, pollIntervalSeconds, lastPollFailedAt }`, with the recent history when it opens or the connection changes, and the snapshot again every 30 seconds from the local API (`web-app/src/app/features/monitoring/monitoring.component.ts#load`). Its states are distinct: loading until the API answers; "Waiting for the API's first poll of the broker" while `snapshot` is null and no poll failed; "Could not read the counts from the broker", with the time and Retry, while `snapshot` is null and a poll failed; "Could not load the monitoring data" when the request itself fails; "Nothing to monitor in this namespace" only for a snapshot with no entity; and over data from before a failed poll, a line saying the last poll failed and when the counts are from. The header says how often the API reads the broker. Two Material tabs follow: Overview and All entities, `monitoring-counts` (`web-app/src/app/features/monitoring/monitoring-counts.component.ts#MonitoringCountsComponent`), drawn from the `counts` state of the monitoring artboard:
- one `mat-table` of every queue and subscription with Name (a subscription says its topic), Kind, Active, Dead-letter, Scheduled and Transfer dead-letter; a count the API sends as null reads "Not counted", which is every subscription's scheduled count;
- `matSort` on every column, dead-letter descending at first, a text column ascending on its first click and a count descending, a null count sorting below zero (`web-app/src/app/features/monitoring/monitoring-counts.component.ts#over`);
- a name filter that matches part of the name or of the topic, ignoring case, with a line saying how many entities match and how many are over the threshold (`web-app/src/app/features/monitoring/monitoring-counts.component.ts#over`);
- a dead-letter threshold, a whole number, 100 at first, kept in `localStorage` under `monitoring-dead-letter-threshold` (`web-app/src/app/features/monitoring/monitoring-counts.component.ts#onThreshold`); a row whose dead-letter count is strictly above it is marked "over threshold" in the error container colour, which the theme has, as no warning colour is defined yet;
- the name, a button named "Open {name} in Entities", selects that queue, or that subscription of its topic, in `EntitySelectionService` and navigates to `/entities` (`web-app/src/app/features/monitoring/monitoring-counts.component.ts#open`);
- a refresh icon button per row, named "Refresh the counts of {name}", reads that entity through `GET monitoring/counts` and shows its counts until the next snapshot; a failure says why and keeps the counts of the last poll (`web-app/src/app/features/monitoring/monitoring-counts.component.ts#refresh`).
The Overview (2026-11-13, drawn from the `today` state of the monitoring artboard) holds four cards, Active and Dead-letter with their change since the last poll when it is not zero, Transfer and Monitored entities with the number of queues and subscriptions, the dead-letter card in the error container while any message is dead-lettered; the trend of the last polls as two sparklines, Active and Dead-letter, each an SVG coloured by the primary token with its first and last value and the time of the first and last poll (`web-app/src/app/features/monitoring/monitoring.component.ts#trend`), which replaced the ApexCharts chart and its literal colours; and the queues and the subscriptions as two `mat-table`s whose last column, Change, is the difference in active messages since the previous poll. Pinned by `web-app/src/app/features/monitoring/monitoring.component.spec.ts#the Overview says each total with its change since the last poll and draws the trend of active and dead-letter messages from the first poll to the last`.
Each 30-second read of the snapshot costs little: the table keeps a row element per entity (`trackBy` on the row key), `monitoring-counts` is `OnPush` and its state is all signals, and the All entities tab is created only when it is opened (`matTabContent`); the Overview deltas look the previous snapshot up in one map instead of a search per entity. The artboard's "Refresh every" select is not built: the period is the API's setting, not the app's, and the screen shows it read-only. Its "Auto resubmit" link waits for that feature. Pinned by `web-app/src/app/features/monitoring/monitoring-counts.component.spec.ts` and `web-app/src/app/features/monitoring/monitoring.component.spec.ts`; the query values are encoded once by `apiPath` (`web-app/src/app/core/services/monitoring.service.spec.ts#names the queue, or the topic and the subscription, as query values encoded once`).
