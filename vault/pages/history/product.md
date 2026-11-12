---
title: "Product history"
version: "1.0"
date: 2026-11-12
changes: "Initial history page, migrated from the owner's notes"
page_type: reference
status: active
description: "How Messaging Explorer got here: the private version line up to 3.0.0, the public relaunch as 1.0.0, why 2.3.0 followed, and the decisions taken on the way that still shape the code."
updated: 2026-11-12
source:
  - "owner's private notes, April to July 2026 (migrated with the owner's word on 2026-11-12; rewritten in English, checked against the code)"
  - "CHANGELOG.md"
reliability: medium
---

# Product history

> The tool was built in private as "Message Explorer" up to version 3.0.0, relaunched in public as "Messaging Explorer" 1.0.0 with its history squashed, and resumed the older line at 2.3.0. This page is the part of that story the code alone cannot tell.

Everything before 2026-04-30 comes from the owner's notes and predates the public repository: the commits are not in this repo's history, so those entries are `reliability: medium` and are not re-verifiable here. Each statement about what the code does today was checked on 2026-11-12.

## Timeline

| Date | Version | What happened |
|---|---|---|
| 2026-04-01 | 2.0.0 (private) | The shell moved from a commercial admin template to Angular Material, with a light and dark theme. The two JSON files for connections and groups became one `workspace.json` under one manager and one lock, so a group and its connections can no longer be written apart. A security review led to CORS limits, the API key and a CSP. Auto-update arrived. |
| 2026-04-08 | 2.0.8 (private) | Sessions for Azure Service Bus; the live active-messages monitor with sparkline, delta, rate and peak; counts refreshed by polling; about 150 hard-coded colours replaced by variables for the dark theme; all Portuguese text removed from the UI; Font Awesome 4 to 7. |
| 2026-04-09 | 3.0.0 (private) | Electron 39 to 41; stable and beta update channels kept in `electron-store`; unsigned macOS builds. |
| 2026-04-19 | - | The Azure authentication decision ([[pages/decisions/0003-azure-authentication-strategy]]) and a security hardening pass. |
| 2026-04-30 | 1.0.0 (public) | First public release under the MIT licence, as "Messaging Explorer", with RabbitMQ beside Azure Service Bus. The history was squashed, which is why the version restarted. 1.0.1 and 1.0.2 fixed the API port in packaged builds and string enums in JSON. |
| 2026-07-06 | - | A survey of the public code named the same three weaknesses the audit of November found again: RabbitMQ operations that can lose messages, secrets in plain text on disk, and thin tests exactly where the risk is. |
| 2026-07-20 | 2.3.0 | Dead-letter bulk delete and resubmit reworked into per-batch cycles with cancellation. The version jumped from 1.0.2 to 2.3.0 so that users of the private 2.x line would not see the relaunch as a downgrade (`CHANGELOG.md`). |
| 2026-11-12 | - | The agent harness, this vault, the code audit and the integration tests ([[pages/decisions/0001-in-repo-vault-and-agent-harness]], [[pages/roadmap/code-audit-2026-11]]). |
| 2026-11-12 | 2.4.0 | The fixes of the audit (connection fields kept on save, entity names with reserved characters, bulk actions bound to the selection, a start that waits for the API), the Beta update channel, block maps in the release, dependencies moved inside their majors (`CHANGELOG.md`). First release built by the gated workflow: CI on the tagged commit, tag checked against the package version, then the three builds. |

## Decisions taken on the way that still hold

Recorded here because someone will otherwise undo them without knowing why. Each was checked against today's code.

- **Sessions are listed by accepting the next session in a loop.** The Azure SDK has no call that lists sessions, so this is the only approach available (2026-04-08). It is also why the list can be slow and why the audit doubts its completeness on a real namespace.
- **The live monitor polls every 3 seconds.** Chosen as the balance between a real-time feel and load on the broker, sized for entities moving more than 50 messages a second (2026-04-08).
- **macOS builds are unsigned on purpose.** Signing needs a paid Apple Developer membership, and the owner chose not to pay until demand justifies it (2026-04-09). The cost: Gatekeeper warns on first open. This answers the open question on [[pages/roadmap/improvement-plan]], Phase 3; it is a standing decision, revisited only if the owner says so.
- **Several namespaces at once ("connection tabs") is deferred.** It was judged high risk because every controller reads one process-wide provider; the workaround is to disconnect and reconnect. The planned shape was a connection id in a request header, to avoid changing every route. The static provider slot recorded on [[pages/services/api]] is the prerequisite.
- **Updates come from GitHub Releases.** While the repository was private they came from a separate public bucket, because a private repository needs a token to download; once public, the app went back to GitHub (`web-app/package.json`, `build.publish`).
- **Bug reports open a GitHub issue.** The private-era reporter posted through a serverless function; today the dialog builds an issue URL and nothing is sent anywhere else (`web-app/src/app/shared/bug-report-dialog.component.ts:20`).

## The Material migration, first attempt

The move to Angular Material was planned on 2026-04-01 in ten phases: theme and shell, navigation, buttons, cards, forms, tables, alerts and badges, grid, cleanup, polish. The shell and the dialogs were done for 2.0.0. The rest was not: on 2026-11-12 the entity screens are still Bootstrap, and `web-app/src/styles.scss:4` still imports it with the comment "removed in Phase 9". The measurements and the rules are on [[pages/conventions/ui]]; the second attempt is [[pages/roadmap/ui-material-migration]], which starts from end-to-end tests the first attempt did not have.

## What the earlier plans asked for, and where it stands

Checked against the code on 2026-11-12.

| Planned | State today |
|---|---|
| Schedule a message, set a time to live on send | Built (the send dialog has both fields) |
| Edit and resubmit a dead-letter message | Built; it turns property values into text and keeps the message id ([[pages/roadmap/code-audit-2026-11]]) |
| Message templates | Built, stored in the browser, not per connection |
| Import from JSON or CSV | Built; fails as a whole past one batch |
| Message diff, Excel export | Built |
| Server-side search | Endpoints exist per entity; the web app has no client for them and searches only the loaded page |
| Metrics from Azure Monitor | The API exists and queries one configured namespace; the screen is hidden and a placeholder draws random numbers |
| Several namespaces at once | Deferred, see above |

What is still wanted is on [[pages/roadmap/product-backlog]].
