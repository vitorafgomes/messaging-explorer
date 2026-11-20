---
title: "Web App: The window that asks the user about a request of an assistant"
version: "1.0"
date: 2026-11-20
updated: 2026-11-20
changes: "v1.0: split out of the MCP server group page; phase three, the kinds that move or remove messages, danger and the word typed"
page_type: service
status: active
description: "Read when a change touches McpRequestDialogComponent, the polling of the requests in App, the kinds a request may have, danger, or the word typed before a request can be allowed."
source:
  - web-app/src/app/features/settings/mcp-request-dialog.component.ts
  - web-app/src/app/features/settings/mcp-settings.service.ts
  - web-app/src/app/app.ts
  - context/prototypes/web-app/Settings.dc.html
  - context/pages/services/web-app/features-settings-mcp.md
reliability: high
---

# Web App: The window that asks the user about a request of an assistant

One topic of [[pages/services/web-app|Web App]]; the map lists the others. The group of Settings that offers the connections is [[pages/services/web-app/features-settings-mcp]]; the window is drawn on `context/prototypes/web-app/Settings.dc.html` as `mcp.ask`.

## Contract

`GET mcp/requests` answers the requests that wait, each with `id`, `time`, `assistant`, `kind`, `title`, `facts`, `note`, `allowLabel`, `expiresAt`, and from phase three `danger` and `typed` (`web-app/src/app/features/settings/mcp-settings.service.ts#McpRequest`). An older API leaves the last two out; `danger` absent is false and `typed` absent is null. `POST mcp/requests/{id}/answer` takes `{ allow }`, and `{ allow: true, typed }` when the request asks for a word (`web-app/src/app/features/settings/mcp-settings.service.ts#answer`); it answers 204, 400 with a message for a wrong word, and 404 when the request is no longer waiting. Both go through `ApiService`.

## How it works

**The polling.** `App` polls `GET mcp/requests` every 2 seconds while the server is enabled and `supports.confirmation` is true, one call in flight at a time, and stops when the server is turned off and when the app is destroyed (`web-app/src/app/app.ts#asking`). A failed poll is tried again on the next tick and shows nothing; a 404 means the API cannot ask, and the polling stops for good. The oldest waiting request opens `McpRequestDialogComponent` over whatever screen is shown, one at a time (`web-app/src/app/app.ts#showRequest`).

**The window.**

- As the artboard draws `mcp.ask`: the title with the MCP mark, the facts as a description list, the note in the warning container, Deny and the allow button with the API's `allowLabel`, and "The assistant waits for your answer. With no answer in 2 minutes it is told the request was denied." Every text from the API is bound as text, never as markup.
- Only Deny and the allow button answer, each through `POST mcp/requests/{id}/answer`; the dialog is opened with `disableClose` and focus on Deny (`web-app/src/app/features/settings/mcp-request-dialog.component.ts#config`), so Escape and a click outside do nothing. A request is answered once: a second click while the first answer is in flight sends nothing (`web-app/src/app/features/settings/mcp-request-dialog.component.ts#answer`). A failed answer is said in the dialog, which stays open.
- When the request leaves the list, or the answer gets a 404, the dialog closes by itself with the snack bar "The request is no longer waiting." A request already shown is never opened again.
- The kinds this version can allow are read, send, connect, deadLetter, resubmit, move, delete, purge and cancelScheduled. Any other kind shows Deny only and "This version of the app cannot allow this kind of request."
- After an allowed `connect` the app reads the status once a second without publishing it (`ConnectionService.peekStatus`) until it names another connection or 15 seconds pass, then publishes it once (`web-app/src/app/app.ts#followConnect`); tested by `web-app/src/app/app.spec.ts#a denied connect and an allowed request of another kind read no status`.

**Phase three (2026-11-20, moving and removing).** As the artboard draws the state askedToDelete:

- With `danger` the note is drawn in the error container and the allow button in the error colour (`web-app/src/app/features/settings/mcp-request-dialog.component.ts#danger`). Focus still starts on Deny.
- With `typed`, a text field labelled with the API's `typed.label`, empty, with no autofill and no placeholder. The allow button is disabled, natively and with `aria-disabled`, until the field holds `typed.word` exactly: case counts and nothing is trimmed (`web-app/src/app/features/settings/mcp-request-dialog.component.ts#matches`). `answer` checks the same before it sends, so no path allows before the word matches. Pasting fires the same `input` event as typing. The field sits in no form, so Enter in it submits nothing.
- The word is never shown in the dialog: the facts already name the entity. Allow sends `{ allow: true, typed: <the field> }`; Deny sends `{ allow: false }` whatever the field holds.
- A 400 to the answer shows the API's message alone, inline as an alert ("Type the name exactly as shown to allow this."), keeps the dialog open and the field as it was. Any other failure keeps the sentence "Your answer was not sent: ...".

## Sharp edges

- The window is only in the app: with the app minimised, nothing outside it says a request waits.
- Not verified in a running app against the API of phase three: the specs mock the contract above. The colours of a dangerous request are asserted by class, not seen on screen.

## Tests

- `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#a double click on the allow button sends one answer: a request is answered once` and `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#text from the API is shown as text: markup in the title, a fact or the note is never rendered`; the polling, `web-app/src/app/app.spec.ts#the polling stops when the app is destroyed`.
- Phase three: `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#the allow button disabled and aria-disabled until the word is typed exactly`, `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#a click on the disabled allow button, Enter in the field, Enter on Deny, Escape and the backdrop never answer allow`, `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#answers allow true with the typed value, once`, `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#a wrong word answered 400 shows the API`, `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#danger draws the note in the error container and the allow button in the error colour`, `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#the word is shown nowhere in the dialog`, `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#can be allowed: Deny, then the allow button`; the older API, `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#an older API without danger and typed`.
