---
title: "User interface"
version: "1.0"
date: 2026-11-12
changes: "Initial convention, written before the migration it governs"
page_type: convention
status: active
description: "How a screen is built in the web app: Angular Material components and theme tokens only, one icon set, named destructive actions, distinct empty, loading and error states, and a name on every control."
updated: 2026-11-12
source:
  - "web-app/src/styles.scss"
  - "web-app/src/app/"
  - chat
reliability: high
---

# User interface

> One design system. A screen is built from Angular Material components and coloured by the Material theme tokens; nothing new is written in Bootstrap, and a screen that is touched moves over.

## Where the app is today

Measured on 2026-11-12. The move from Bootstrap to Angular Material stopped halfway (`web-app/src/styles.scss:4` still imports Bootstrap as "temporary"):

| | Bootstrap side | Material side |
|---|---|---|
| Buttons | 99 `class="btn"` | 43 `mat-*` buttons |
| Icons | 208 Font Awesome | 47 `mat-icon` |
| Colour variables in components | about 560 `--bs-*` | 1 `--mat-sys-*` |

The toolbar and the dialogs are Material; the entity screens are Bootstrap. The dark theme of those screens therefore comes from Bootstrap's variables, not from the Material theme defined at `web-app/src/styles.scss:36`. There are 264 literal hex colours, 99 fixed pixel widths against 13 media queries, no `aria-label` anywhere, and 1,685 lines of styles inside `entity-details.component.ts`. `ng-bootstrap` is a dependency nothing uses.

## The rules

They apply to every new screen and to every screen a change touches. A change is not asked to migrate screens it does not touch.

1. **Components.** Buttons, inputs, selects, menus, tabs, tables, cards, dialogs, tooltips, progress and chips are Angular Material. No new `class="btn"`, `form-control`, `nav-tabs`, `card` or `badge` from Bootstrap.
2. **Colour.** Only theme tokens: `var(--mat-sys-surface)`, `--mat-sys-on-surface`, `--mat-sys-primary`, `--mat-sys-error`, `--mat-sys-outline-variant` and their family. No hex, `rgb()` or named colour in a component, and no new `--bs-*`. A status colour the theme lacks (warning, success) is defined once in `styles.scss` for light and dark, never in a component.
3. **Icons.** `mat-icon` with the bundled Material Icons font. No new Font Awesome.
4. **Type and spacing.** The Material typography tokens (`--mat-sys-title-medium`, `--mat-sys-body-medium`) and a 4 px spacing scale. No font size in pixels in a component.
5. **Layout.** Flex and grid with `min-width: 0` on what must shrink; a fixed pixel width only for an icon or an avatar. A screen works at 1024 px wide without horizontal scroll.
6. **Destructive actions.** Delete and purge are never beside a routine action at the same weight: they sit in a menu or apart, in the error colour. Every confirmation names the entity, its parent and the connection, shows the live count, and a purge asks for a typed acknowledgement.
7. **The same thing looks the same.** A queue and a subscription hold messages the same way, so they share one panel: the same cards, tabs and actions, minus rules, which only a subscription has.
8. **What cannot be saved is not editable.** A field with no save path is read-only text, not an input.
9. **States.** Loading, empty and error are three different things on screen. An error says what failed and offers a retry; it is never an empty list or a spinner that does not end.
10. **Names.** Every control that is only an icon has an `aria-label` and a tooltip. Every form field has a label.
11. **Lists.** A list that can pass a few hundred rows is virtualised with `*cdkVirtualFor`.
12. **Where the styles live.** Past about a hundred lines, a component's styles are in their own `.scss` file.

## The prototype

`vault/prototypes/web-app/index.html` draws the target layout as five artboards in one self-contained file, with its screenshots and a README beside it: a queue, a subscription, the purge confirmation, the messages list and the three states, each in light and dark. It is the picture of the rules above.

The prototype is the spec. Where the application and an artboard differ, the artboard is what the screen should become, and what an artboard draws that the application lacks is owed. A change to a screen updates its artboard and its screenshot in the same change. A layout question is settled on the prototype first, because it costs minutes there and days in a 2,760-line component.

## How it is checked

- By reading, in the review gate: a diff under `web-app/src/app` that adds a Bootstrap class, a Font Awesome icon, a literal colour or an icon button with no name is a finding against this page.
- By looking: the end-to-end run captures a screenshot of each screen in light and in dark ([[pages/roadmap/ui-material-migration]], Phase 0). A layout change is judged on those, not on the diff.
- Nothing enforces these rules mechanically yet; a lint for the countable ones (hex colours, `class="btn"`, `fa fa-`) is on the initiative.

## Related

- [[pages/roadmap/ui-material-migration]]
- [[pages/services/web-app]]
- [[pages/conventions/testing]]
