---
title: "UI: finish the move to Angular Material"
version: "1.1"
date: 2026-11-12
changes: "v1.1: Phase 5, the order of work for what the prototype still draws; a Decisions section"
page_type: roadmap
status: active
description: "The web app ends on one design system: every screen built from Angular Material and coloured by its theme, with end-to-end tests that drive the real app and capture each screen."
updated: 2026-11-14
source:
  - chat
  - "context/pages/conventions/ui.md"
reliability: medium
---

# UI: finish the move to Angular Material

> Every screen is Angular Material, coloured by the theme, and looks the same for the same kind of thing. End-to-end tests drive the real app in a browser and keep a picture of each screen.

## Why now

The owner finds the queue screens worse than the subscription ones and asked for the layout to be improved with Angular Material, and for end-to-end tests. The measurements on [[pages/conventions/ui]] explain the feeling: two design systems on one screen, the entity screens still on Bootstrap, and a queue panel that is a poorer copy of the subscription panel. Changing layout by reading templates is guessing, so the first phase is to see.

## Scope

- **In scope:** end-to-end tests of the web app against the real API and a broker in a container; the queue panel brought to the subscription panel's level; buttons, icons, colours and form controls moved to Material screen by screen; Bootstrap, Font Awesome and `ng-bootstrap` removed at the end.
- **Out of scope:** a new visual identity, new features, a redesign of navigation. The Electron packaging tests are Phase 4 of [[pages/roadmap/tests-of-everything]].

## Target outcome

No dates are set; the owner sets them.

## Status

- **As of 2026-11-12:** the convention is written and the target layout is drawn in `context/prototypes/web-app/` (38 artboards since the review of [[pages/roadmap/ui-review-2026-11]], light and dark, with screenshots); nothing is built in the application. Phase 0 waits for the Azure emulator fixture of [[pages/roadmap/tests-of-everything]] Phase 1, which gives a broker with data to point the app at.
- **As of 2026-11-13:** Phase 0 is in progress. The end-to-end tests and their screenshots exist and pass locally; CI, three of the planned flows and the owner's review remain.
- **2026-11-13, the visual migration starts with Settings,** a new screen built from its artboard (`context/prototypes/web-app/Settings.dc.html`) in Material components and theme tokens only: updates with every state of the artboard, the data file and the danger zone with a typed confirmation, developer mode, About. Its end-to-end flow (`web-app/e2e/settings.e2e.ts`) asserts the version and the update state and saves four screens in light and dark. Connections, Messages and Send come next, one change each.

## Phases

### Phase 0 - See it: end-to-end tests with screenshots
- **Status:** in progress (2026-11-13). The flows run green locally with Playwright in `web-app/e2e/`, in a workflow of their own, `.github/workflows/e2e.yml`, which has not run in CI yet. The owner has not looked at the screenshots yet.
  - **Built:** add a connection and connect, open a queue and a subscription, peek, and send and see, against RabbitMQ and the Service Bus emulator, plus the Connections, Queues, Topics and Monitoring screens. That is 23 screens, in light and dark, 46 screenshots, uploaded by CI as `e2e-screenshots`.
  - **How:** the tests run the Electron renderer path in a browser. The page gets the preload's `getApiPort` and `getApiSecret`, so `ApiService` sends the key; browser mode without a key stays unreachable.
  - **Pinned defects:** three known defects met on the way are pinned as expected failures, not worked around.
  - **Written 2026-11-14:** resubmit from a dead-letter queue and delete a selection on the emulator, purge with its typed name on RabbitMQ (`web-app/e2e/azure-service-bus.e2e.ts#resubmits one message of the dead-letter queue to the queue, and the results name it`, `web-app/e2e/rabbitmq.e2e.ts#purges the active messages of a queue only once its name is typed`). The workflow also runs every night at 03:00 UTC, the owner's default.
  - Details on [[pages/conventions/testing]].
- **Scope:** Playwright (one new development dependency) driving the Angular app in a browser, with the real API started on loopback with a known key and a broker in a container, never a real one ([[pages/decisions/0002-integration-tests-against-brokers-in-docker]]). First flows: add a connection and connect; open a queue and a subscription; peek messages; send a message and see it; resubmit one from a dead-letter queue; delete a selection; purge with its confirmation. Each flow saves a screenshot of each screen in light and in dark, as build artefacts.
- **Success criteria:** the flows pass locally and in a CI job; the screenshots exist for every screen the flows reach; the owner has looked at them.
- **Notes:** these flows are also the behaviour lock for every later phase. A flow that exposes a defect of [[pages/roadmap/code-audit-2026-11]] is reported, not worked around.

### Phase 1 - A queue looks and works like a subscription
- **Status:** in progress (2026-11-13). The panel half is built, in the web app only: a queue and a subscription share one panel shape, with the same header, the same cards, Material tabs and the same More actions menu holding the purges (details on [[pages/services/web-app]]). Not done: `GetQueueAsync` reading runtime and configuration together (Core), and live counts for a queue, which need a poll the queue does not have; a queue's purge stays the purge of its active messages, the dead-letter and all purges of a subscription were not added to a queue. The screenshots of a queue and a subscription differ by the live Active card, the Scheduled and Size cards and Send Message of a queue, the topic in the header, the Rules tab, and the tab name Description, which the specs select by name.
- **Scope:** `GetQueueAsync` reads configuration and runtime properties together, as the topic and the subscription already do; the queue panel uses the subscription panel's cards, live counts, tabs and purge menu, and gains the sessions tab. One shared panel, not two copies (rule 7).
- **Success criteria:** a queue created with a 2-minute lock, 7 deliveries and sessions shows exactly those values; the end-to-end screenshots of a queue and a subscription differ only by the rules tab.

### Phase 2 - Actions that can hurt
- **Status:** in progress (2026-11-13).
  - **Connections, migrated 2026-11-13, with a recorded residual:** the screen and its add, edit, groups and export dialogs are Material and theme tokens, with the three states and named icon controls; the end-to-end flows pass unchanged. The counts reach zero once the debug panel goes; the light and dark screenshots wait for the owner's review. In `features/connections/` the Bootstrap classes went from 233 to 27, Font Awesome from 46 to 5, literal colours from 8 to 2 and `--bs-*` from 74 to 0. What is left is the developer-mode debug panel, kept as it was apart from its Clear All Data button, removed on 2026-11-13, and the class `badge` on the connected chip, which a pinned expected failure looks for. Details on [[pages/services/web-app]].
- **Scope:** rule 6 everywhere: destructive actions out of the routine row, one confirmation builder that names entity, parent and connection with the live count; an environment badge in the toolbar; fields with no save path become text (rule 8).
- **Success criteria:** no purge or delete can be confirmed without the entity and the connection on screen.

### Phase 3 - Material, screen by screen
- **2026-11-13, the main screen,** the entities tree, the entity panel, its container and the live Active card of a subscription, drawn from `context/prototypes/web-app/Main.dc.html`, with the end-to-end flows green before and after. Counts in `entity-details`, `entities-tree`, `entities-container` and `transfer-monitor`: Bootstrap classes 98 to 0, Font Awesome 65 to 0, literal colours 80 to 0, `--bs-*` 140 to 0. The styles of the three larger components are in their own files. The light and dark screenshots wait for the owner's review.
- **Status:** started 2026-11-13 with Settings, a screen that did not exist: no Bootstrap class, Font Awesome icon or literal colour in `web-app/src/app/features/settings/`; the warning and success tokens the artboard uses were not defined then; since 2026-11-14 they are, and the cannot-update and ready panels use them.
  - **2026-11-13, the shared parts, the Monitoring Overview and the Queues and Topics pages.** The selection bar, Advanced Filters and the bulk progress and results dialogs under `web-app/src/app/shared/components/`, the Overview tab of `features/monitoring/` and `features/queues/` and `features/topics/` are Material and theme tokens, each with its styles in its own file; their specs and the end-to-end flows pass, with two selectors that named Bootstrap classes changed (`.modal-title` of the results dialog spec, `.card-header` of the topics spec and the Azure end-to-end flow). Bootstrap classes, Font Awesome icons, literal colours and `--bs-*` per part, before and after: selection bar 30, 14, 9, 9 to 0; Advanced Filters 3, 3, 43, 33 to 0; progress dialog 54, 30, 0, 13 to 0; results dialog 50, 26, 1, 25 to 0; Monitoring 28, 18, 25, 19 to 0; Queues 54, 18, 0, 0 to 0; Topics 85, 25, 1, 2 to 0. Built from the artboards: the selection bar always on screen with Delete apart in the error colour, the Overview cards, sparklines and Change column, the three states of the two list pages, the purges in a menu. Not built: Delete last as "Delete {count}", the results table with separate Result and Error columns and the environment line of the two bulk dialogs. A partial or failed outcome takes the error container, as no warning token is defined. The light and dark screenshots wait for the owner's review.
- **Scope:** in this order: entity details, entities tree, connections, messages dialog, monitoring, queues and topics pages. Per screen: buttons and form controls to Material, Font Awesome to `mat-icon`, `--bs-*` and hex colours to theme tokens, styles into their own file, the three states of rule 9, names on icon controls.
- **Success criteria:** per screen, the counts on [[pages/conventions/ui]] reach zero for that screen and its end-to-end flow still passes; the light and dark screenshots are reviewed.

### Phase 4 - Remove what is left
- **Status:** built 2026-11-14, except the virtualised message list. Bootstrap, ng-bootstrap, Font Awesome and Popper left `web-app/package.json`; the Connections debug panel, the last live Bootstrap user, is Material, and its browser alerts became the snack bar (`web-app/src/app/features/connections/connections.component.ts#showDebugCounts`). The lint is `tools/checks/check-ui-tokens.sh`, in CI. The styles bundle went from 528.85 kB to 35.67 kB (transfer 52.73 to 3.98 kB), the initial total from 1.40 MB to 905.74 kB. `message-body-editor` was deleted. Left for the owner: the provider entity-details components under `web-app/src/app/providers/*/components/`, which nothing renders, and `prismjs`, now unused.
- **Scope:** delete the Bootstrap import, Font Awesome and `ng-bootstrap`; a lint that fails on a hex colour, `class="btn"` or `fa fa-` in `web-app/src/app`; virtualise the message list.
- **Success criteria:** none of the three packages is in `package.json`; the bundle is smaller, with the number recorded here.

### Phase 5 - What the prototype still draws: the order of work
- **Status:** planned 2026-11-14, from the status strip at the top of each artboard in `context/prototypes/web-app/*.dc.html`, spot-checked against `web-app/`. A strip says which lanes exist, not what a lane builds: each lane opens by writing the counted inventory of its artboard (`.claude/skills/explorer-pipeline/reference/prototype.md`) and closes with its `PROTOTYPE COVERAGE` count. One lane is one screen and one pull request, in its own worktree; at most two heavy lanes (brokers in Docker, or the end-to-end suite) at once.
- **This page carries the layout and migration rows.** Rows that are features are planned on their own pages and only ordered here: [[pages/roadmap/azure-service-bus-administration]] (sessions, counts, definitions, status), [[pages/roadmap/product-backlog]] and [[pages/roadmap/followups]] (the rest). The risk class of each lane is from `.claude/skills/explorer-pipeline/reference/sensitive.md`.
- **Lane 0, owner decisions, first.** Each blocks the lanes named.
  - Warning and success tokens: decided 2026-11-14 (see Decisions); unblocks L2, L8, L14, L15.
  - The shape of the Production mark on an environment in `workspace.json`: blocks L5 and L6.
  - Developer tools in a released build, yes or no: a security call; blocks part of L3.
  - When the end-to-end job runs: blocks L13.
  - The macOS window, which only the owner can see on a Mac: L12.
  - Whether the canvas artifact is refreshed from the repo copies, which are newer in 8 of 11 boards.
- **Lane 1, fast path:** the hint under the client secret that promises a secure store that does not exist, made true; and the stale tags of the artboards refreshed: the Sessions and Rules tags of `Main.dc.html`, the row tags of `Settings.dc.html`, and the sessions and state-write strips of `Monitoring.dc.html`, which say planned although the queue routes of `SessionsController` and `SessionService` (list, open, messages, state write) exist.

| Lane | Artboard | What is left, per its strip | Class, lenses |
|---|---|---|---|
| L2 | `Settings.dc.html` | L2a built 2026-11-14 (tokens, Appearance, last check, release notes, data and About rows; see [[pages/history/web-app]]); L2b built 2026-11-14 (the bug report and clear dialogs). Left: the trailing icons on the Settings links. Was: first the status tokens of Decisions in `web-app/src/styles.scss`, and the cannot-update and ready panels moved onto them; then Appearance with System as a choice; the last check time and Check now; "up to date"; release notes on screen; the failure reason and link; Repository and Changelog; the private security report link; the bug report preview | Standard, `invariants` |
| L3 | `Settings.dc.html` | Show in folder and the real path built 2026-11-14; Developer tools in a released build left out by the owner's default. Was: Show in folder (a filesystem call through IPC, with its failing-call test); Developer tools in a released build, if Lane 0 says yes | Sensitive, `api-surface`, `boundaries` |
| L4 | `Connections.dc.html` | Built 2026-11-14, except: Import with its preview (L5), the Last used and Environment columns (L5), the empty-state step 3 that names the environment (L6), the broker's reason for a refused user name or password on a failed connect (built 2026-11-14 for a refused port, a host not found, a timeout and TLS). Was: the four browser `confirm()` boxes (delete a connection, a client, an environment; import) as app dialogs; Environment and Last used columns; the line under each name; Authentication as radio buttons; a failed connect inline instead of a snackbar | Standard, `invariants` |
| L5 | `Connections.dc.html` | Built 2026-11-14 except the add-dialog rows 51-80 (radio authentication, five options, hints and notices) and the edit intro line (L6). Was: import with a preview of what is added and replaced; the Stored and Replace panel of a secret; the Production mark and NO ENVIRONMENT | Sensitive, `secrets` |
| L6 | every dialog of `Messages`, `Send`, bulk | The environment line in each dialog header and the environment badge in the toolbar; needs L5's mark | Standard, `invariants`; `message-safety` for the dialogs that send |
| L7 | `Messages.dc.html` | Built 2026-11-14 except Change status in the disabled panel, the loading skeleton, the environment line (L6), the row styling rows of the inventory (selection tint, reason weight, clock icon). Was: the error and disabled panels (a snackbar today); Send and Close in the header; the dead-letter reason and the Body part of the detail | Standard, `invariants` |
| L8 | `Messages.dc.html`, bulk dialogs | Built 2026-11-14, except the environment line of the dialogs (L6). Was: Delete last as "Delete {count}"; the results table with Result and Error columns | Sensitive, `message-safety` |
| L9 | `Send.dc.html` | Built 2026-11-14 for the send form, except the environment line (L6); the import, export and diff rows of the artboard (success container on import, the per-line diff marks, status chips) are left. Was: send on one page in three columns instead of three tabs; the template name and its delete asked inline | Standard, `message-safety` |
| L10 | `Main.dc.html` | Main 49 of 88, Rules 25 of 60, EntityAdmin 9 of 61 built 2026-11-14; left as listed on [[pages/services/web-app/features-entities-main]]. Was: the tree filter; the topic link; a subscription's Size card; the empty-state counts; the topic warning; the topic's Subscriptions tab and Create subscription from it | Standard, `invariants` |
| L11 | `Main.dc.html` | Live counts for a queue (a poll it lacks); `GetQueueAsync` reading configuration and runtime together (Phase 1) | Sensitive, `message-safety`, `boundaries`, `explorer-optimizer`; Core runs both unit projects and the integration suite |
| L12 | `Window.dc.html` | The board "where each old menu item went"; the macOS window seen on a Mac | Owner check; a fix is Sensitive, `api-surface` |
| L13 | (end-to-end) | The three flows and the nightly run built 2026-11-14; the first CI run waits for the pull request. Was: the CI run of `.github/workflows/e2e.yml`; the flows resubmit from a dead-letter queue, delete a selection, purge with its confirmation, against brokers in containers only | Standard (never fast path), heavy |
| L14 | `Monitoring.dc.html` | 37 of 73 built 2026-11-14; left: the sessions, sessions-confirm and definitions states (entities screens), three colour rows to see on screen. Was: the connection line above the title; the Refresh every selector; the Auto resubmit link; export progress and the import plan as one table (definitions) | Standard, `invariants`, `explorer-optimizer` |
| L15 | `AutoResubmit.dc.html` | 28 of 52 built 2026-11-14; left: the environment line, the enqueued-time filter and whole-queue count (API), the question on quit (IPC), the batch number and cycle count the run does not keep, the bell and the panel and tree rows, two sentences that would be false. Was: the enqueued-time filter; the whole-queue count; CSV; the question on quit (IPC); its tags redrawn | Sensitive, `message-safety`, `api-surface`, `explorer-optimizer` |
| L16 | all | Built 2026-11-14 except the virtualised message list. Was: Phase 4 above: Bootstrap, Font Awesome and `ng-bootstrap` removed, the lint, the message list virtualised | Standard (never fast path: `package.json`), `explorer-optimizer` |
| L17 | canvas pages RabbitMQ and Next version | Draw the artboards of [[pages/roadmap/rabbitmq-messaging-scenarios]] and [[pages/roadmap/azure-event-hubs-and-event-grid]] before any code of either | Design only |

- **Order.** Lane 0 and L1 first. Then, two at a time: L2 with L4; L5 then L6; L7 with L10; L8, L9; L11 alone (Core and brokers); L14, L15; L13 runs once the flows it needs exist; L16 after every screen is at zero; L12 and L17 when the owner can take them. A lane whose Lane 0 decision is open waits; it is not built on a guess.
- **Success criteria:** every artboard's strip reads Built, each lane's coverage count is `<total> of <total>`, and the rows left are listed here with the reason.


Coverage of the artboards, row by row: 548 of 670 after L16, 765 of 802 after L21 ([[pages/roadmap/prototype-coverage-2026-11-14]]).

## Decisions

- **Status colours, decided by the owner 2026-11-14:** custom tokens, as [[pages/conventions/ui]] rule 2 already says, defined once in `web-app/src/styles.scss` beside each `mat.theme` block, light and dark, with the values the artboards draw (`Settings.dc.html`, `Window.dc.html`): `--app-success` (`#1b6b32`, dark `#9bd6a4`), `--app-success-container` (`#b6f2be`, dark `#00531f`), `--app-on-success-container` (`#002108`, dark `#b6f2be`), `--app-warning-container` (`#ffdea3`, dark `#5c4300`), `--app-on-warning-container` (`#261900`, dark `#ffdea3`). The prefix is `--app-`, never `--mat-sys-`, which belongs to Material. Warning exists only as a container: yellow text on a light surface fails 4.5:1. A status colour always comes with an icon, never alone. No info token: the tertiary covers it. A partial bulk outcome moves from the error container to the warning container.

## Decisions pending

- Whether the end-to-end job runs on every pull request or on changes under `web-app/` and nightly.

## Services affected

[[pages/services/web-app]], [[pages/services/core]] (Phase 1 only)

## Risks

- **A visual refactor of a 2,760-line component with no spec breaks behaviour.** Mitigation: Phase 0 first; one screen per change; the flows as the lock.
- **The dark theme regresses where a Bootstrap variable had no exact token.** Mitigation: both themes captured for every screen.
- **The emulator cannot serve a flow** (management calls, sessions). Mitigation: found in the provider phase before this one starts; such a flow runs against RabbitMQ or is listed as not covered.

## Related

- [[pages/conventions/ui]]
- [[pages/roadmap/tests-of-everything]], [[pages/roadmap/code-audit-2026-11]]
