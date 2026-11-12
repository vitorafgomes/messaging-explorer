---
title: "UI: finish the move to Angular Material"
version: "1.0"
date: 2026-11-12
changes: "Initial initiative page"
page_type: roadmap
status: active
description: "The web app ends on one design system: every screen built from Angular Material and coloured by its theme, with end-to-end tests that drive the real app and capture each screen."
updated: 2026-11-12
source:
  - chat
  - "vault/pages/conventions/ui.md"
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

- **As of 2026-11-12:** the convention is written and the target layout is drawn in `vault/prototypes/web-app/` (38 artboards since the review of [[pages/roadmap/ui-review-2026-11]], light and dark, with screenshots); nothing is built in the application. Phase 0 waits for the Azure emulator fixture of [[pages/roadmap/tests-of-everything]] Phase 1, which gives a broker with data to point the app at.

## Phases

### Phase 0 - See it: end-to-end tests with screenshots
- **Status:** not started
- **Scope:** Playwright (one new development dependency) driving the Angular app in a browser, with the real API started on loopback with a known key and a broker in a container, never a real one ([[pages/decisions/0002-integration-tests-against-brokers-in-docker]]). First flows: add a connection and connect; open a queue and a subscription; peek messages; send a message and see it; resubmit one from a dead-letter queue; delete a selection; purge with its confirmation. Each flow saves a screenshot of each screen in light and in dark, as build artefacts.
- **Success criteria:** the flows pass locally and in a CI job; the screenshots exist for every screen the flows reach; the owner has looked at them.
- **Notes:** these flows are also the behaviour lock for every later phase. A flow that exposes a defect of [[pages/roadmap/code-audit-2026-11]] is reported, not worked around.

### Phase 1 - A queue looks and works like a subscription
- **Status:** not started
- **Scope:** `GetQueueAsync` reads configuration and runtime properties together, as the topic and the subscription already do; the queue panel uses the subscription panel's cards, live counts, tabs and purge menu, and gains the sessions tab. One shared panel, not two copies (rule 7).
- **Success criteria:** a queue created with a 2-minute lock, 7 deliveries and sessions shows exactly those values; the end-to-end screenshots of a queue and a subscription differ only by the rules tab.

### Phase 2 - Actions that can hurt
- **Status:** not started
- **Scope:** rule 6 everywhere: destructive actions out of the routine row, one confirmation builder that names entity, parent and connection with the live count; an environment badge in the toolbar; fields with no save path become text (rule 8).
- **Success criteria:** no purge or delete can be confirmed without the entity and the connection on screen.

### Phase 3 - Material, screen by screen
- **Status:** not started
- **Scope:** in this order: entity details, entities tree, connections, messages dialog, monitoring, queues and topics pages. Per screen: buttons and form controls to Material, Font Awesome to `mat-icon`, `--bs-*` and hex colours to theme tokens, styles into their own file, the three states of rule 9, names on icon controls.
- **Success criteria:** per screen, the counts on [[pages/conventions/ui]] reach zero for that screen and its end-to-end flow still passes; the light and dark screenshots are reviewed.

### Phase 4 - Remove what is left
- **Status:** not started
- **Scope:** delete the Bootstrap import, Font Awesome and `ng-bootstrap`; a lint that fails on a hex colour, `class="btn"` or `fa fa-` in `web-app/src/app`; virtualise the message list.
- **Success criteria:** none of the three packages is in `package.json`; the bundle is smaller, with the number recorded here.

## Decisions pending

- Status colours: Material's theme has an error colour and no warning or success. Define two custom tokens, or express those states with icons and the existing colours.
- Whether the end-to-end job runs on every pull request or on changes under `web-app/` and nightly.

## Services affected

[[pages/services/web-app]], [[pages/services/core]] (Phase 1 only)

## Risks

- **A visual refactor of a 3,760-line component with no spec breaks behaviour.** Mitigation: Phase 0 first; one screen per change; the flows as the lock.
- **The dark theme regresses where a Bootstrap variable had no exact token.** Mitigation: both themes captured for every screen.
- **The emulator cannot serve a flow** (management calls, sessions). Mitigation: found in the provider phase before this one starts; such a flow runs against RabbitMQ or is listed as not covered.

## Related

- [[pages/conventions/ui]]
- [[pages/roadmap/tests-of-everything]], [[pages/roadmap/code-audit-2026-11]]
