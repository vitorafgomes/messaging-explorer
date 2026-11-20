---
title: "Web App: The MCP server group of Settings"
version: "1.2"
date: 2026-11-19
updated: 2026-11-20
changes: "v1.2: the kind connect. v1.1: phase two, sending: the window that asks the user, the production offer, the local test broker choice, the activity refreshed. v1.0: phase one, reading: the group of Settings and the toolbar mark"
page_type: service
status: active
description: "Read when a change touches the MCP server group of Settings, McpSettingsService, the window that asks the user about a request of an assistant, the MCP token shown in the app, or the MCP mark on the toolbar."
source:
  - web-app/src/app/features/settings/mcp-settings.service.ts
  - web-app/src/app/features/settings/settings-mcp.component.ts
  - web-app/src/app/features/settings/mcp-request-dialog.component.ts
  - web-app/src/app/app.ts
  - web-app/src/app/app.html
  - context/prototypes/web-app/Settings.dc.html
  - context/pages/decisions/0008-an-mcp-server-inside-the-local-api.md
reliability: high
---

# Web App: The MCP server group of Settings

One topic of [[pages/services/web-app|Web App]]; the map lists the others. Why the server exists and what it may do is [[pages/decisions/0008-an-mcp-server-inside-the-local-api]]; the screen is drawn on `context/prototypes/web-app/Settings.dc.html`.

## Contract

`McpSettingsService` (`web-app/src/app/features/settings/mcp-settings.service.ts#McpSettingsService`), a root service, calls the routes of the API through `ApiService` only, a connection id through `apiPath`: `GET mcp`, `PUT mcp/enabled`, `POST mcp/token`, `PUT` and `DELETE mcp/connections/{id}`, `PUT mcp/logs`, `GET` and `DELETE mcp/activity`, `GET mcp/requests` and `POST mcp/requests/{id}/answer` with `{ allow }`. A level is `PUT` with `neverAsk` only when the caller gives it (`web-app/src/app/features/settings/mcp-settings.service.ts#setLevel`). The fields `production`, `canNeverAsk` and `neverAsk` of an offered connection and `supports.confirmation` may be absent on an older API, and an absent field is read as false. It keeps the state the API answered last and nothing else; a call that fails leaves it as it was and reaches the caller. A 404 to `GET mcp` marks the feature absent (`web-app/src/app/features/settings/mcp-settings.service.ts#load`), so the app runs against an API without it. The token is answered to the caller and never kept by the service (`web-app/src/app/features/settings/mcp-settings.service.ts#createToken`).

## How it works

**The group (2026-11-19, phase one: reading).** `SettingsMcpComponent` (`web-app/src/app/features/settings/settings-mcp.component.ts#SettingsMcpComponent`) sits between Data and Developer, a child of Settings so the token dies with it. It draws only what the API lists:

- The switch, Active or Inactive, with the status sentence and the warning that what an assistant reads leaves the computer.
- While active, Connect an assistant: the url, "Create a token" or "Replace the token", and the configuration to paste, `{"mcpServers":{"messaging-explorer":{"type":"http","url":...,"headers":{"Authorization":"Bearer ..."}}}}`, with `<your token>` until a token is created in this visit (`web-app/src/app/features/settings/settings-mcp.component.ts#configuration`).
- The connections offered, named from the list the Connections screen reads, with client, environment and target; an id the list does not know is "A connection that no longer exists" with Remove only. A list that could not be read is an error with Retry, and a row then shows its id, never "no longer exists".
- The levels of a row are the ones in `levels`, with the artboard's labels (`web-app/src/app/features/settings/settings-mcp.component.ts#levels`); "What each choice allows" shows the blocks of those levels only, and the sentence on bulk operations only beyond reading (`web-app/src/app/features/settings/settings-mcp.component.ts#choices`).
- "Offer a connection" opens a flat list with the search. A connection of a production environment has its Offer disabled and says "A production connection can be offered once the app can ask you before each operation." (`web-app/src/app/features/settings/settings-mcp.component.ts#candidates`).
- "Logs of the app" only when `supports.logs`; "Settings of the app" only when `supports.appSettings`, so not in phase one. With `supports.confirmation` false the "asks you" sentences say "Reads without asking you." and no confirmation dialog exists.
- What assistants did: the table of `GET mcp/activity`, an empty sentence, and Clear the list in the error colour.

Each call that fails says so in its own row, with the API's message or its status; none leaves an empty list.

**Phase two (2026-11-20, sending).** What changes in the group while `supports.confirmation` is true:

- The intro of the connections adds "A production connection always asks you first." Each offered row draws the Production chip from the API's `production`, and its sentence follows the API's fields in this order: production, "Asks you before every operation, a read included."; `canNeverAsk` and `neverAsk`, "A local test broker: never asks you."; "Read", "Reads without asking you."; "Read and send", "Reads without asking; asks you before each send." (`web-app/src/app/features/settings/settings-mcp.component.ts#offered`).
- Where the API answers `canNeverAsk`, the row has the checkbox "A local test broker: do not ask me before a send", checked from `neverAsk`; changing it is `PUT mcp/connections/{id}` with the row's level and the new choice (`web-app/src/app/features/settings/settings-mcp.component.ts#setNeverAsk`).
- A production connection in the offer panel reads "Offer, after you confirm" and opens the shared `ConfirmDialogComponent`, "Offer a production connection?"; only Offer sends the `PUT` (`web-app/src/app/features/settings/settings-mcp.component.ts#offer`). The panel adds "Offering a production connection asks you to confirm it." Without `supports.confirmation` it stays disabled with the phase-one sentence.
- What assistants did is read again every 5 seconds while the server is enabled and the group is on screen; a list that did not change is not set again, so its rows and the focus stay, and a failed refresh keeps the last list and says nothing. A first read that failed keeps its error and Retry.

**The window that asks the user.** `App` polls `GET mcp/requests` every 2 seconds while the server is enabled and `supports.confirmation` is true, one call in flight at a time, and stops when the server is turned off and when the app is destroyed (`web-app/src/app/app.ts#asking`). A failed poll is tried again on the next tick and shows nothing; a 404 means the API cannot ask, and the polling stops for good. The oldest waiting request opens `McpRequestDialogComponent` over whatever screen is shown, one at a time (`web-app/src/app/app.ts#showRequest`):

- As the artboard draws `mcp.ask`: the title with the MCP mark, the facts as a description list, the note in the warning container, Deny and the allow button with the API's `allowLabel`, and "The assistant waits for your answer. With no answer in 2 minutes it is told the request was denied." Every text from the API is bound as text, never as markup.
- Only Deny and the allow button answer, each through `POST mcp/requests/{id}/answer`; the dialog is opened with `disableClose` and focus on Deny (`web-app/src/app/features/settings/mcp-request-dialog.component.ts#config`), so Escape and a click outside do nothing. A request is answered once: a second click while the first answer is in flight sends nothing (`web-app/src/app/features/settings/mcp-request-dialog.component.ts#answer`). A failed answer is said in the dialog, which stays open.
- When the request leaves the list, or the answer gets a 404, the dialog closes by itself with the snack bar "The request is no longer waiting." A request already shown is never opened again.
- A kind other than read, send or connect shows Deny only and "This version of the app cannot allow this kind of request."
- After an allowed `connect` the app reads the status once a second without publishing it (`ConnectionService.peekStatus`) until it names another connection or 15 seconds pass, then publishes it once (`web-app/src/app/app.ts#followConnect`); tested by `web-app/src/app/app.spec.ts#a denied connect and an allowed request of another kind read no status`.

**The token.** It lives in one signal of the component (`web-app/src/app/features/settings/settings-mcp.component.ts#token`), is shown once in a read-only box with Copy and "Copy it now. It is not shown again.", and is written to no storage and no console. A new visit shows `<your token>` again.

**The toolbar mark.** While the server is enabled the toolbar shows the MCP mark with a green dot, a link to Settings named "MCP server is active. Open its settings", before Notifications (`web-app/src/app/app.html#@if (mcp.state()?.enabled) {`). `App` reads the state once at start; the switch in Settings changes the same signal, so the mark follows it.

## Sharp edges

- The toolbar reads `GET mcp` once at start. If the API answers after the window, or fails then, the mark stays off until Settings is opened.
- The window that asks the user is only in the app: with the app minimised, nothing outside it says a request waits.
- Not built, on the artboard: the request to delete with the name typed, "Settings of the app", the count of assistants connected, the MCP mark on the Connections cards, grouping the offer panel by client and environment.
- Not verified in a running app against the API of phase two: the specs mock the contract above.

## Tests

- `web-app/src/app/features/settings/mcp-settings.service.spec.ts#reaches every route of the contract through ApiService, with a connection id encoded as one path segment` and `web-app/src/app/features/settings/mcp-settings.service.spec.ts#an API without the MCP server answers 404 to GET mcp: the feature is absent, with no state and no error`.
- `web-app/src/app/features/settings/settings-mcp.component.spec.ts#an API without the MCP server (404 on GET mcp) shows no group at all, and no error panel`, `web-app/src/app/features/settings/settings-mcp.component.spec.ts#only the levels the API lists are drawn, with the labels of the artboard, and picking one is PUT with that level`, `web-app/src/app/features/settings/settings-mcp.component.spec.ts#a production connection is listed with the Production chip and a disabled Offer, and says why`.
- The token: `web-app/src/app/features/settings/settings-mcp.component.spec.ts#creating a token shows it once with Copy and the sentence, puts it in the configuration, and writes it to no storage and no console` and `web-app/src/app/features/settings/settings-mcp.component.spec.ts#after the component is destroyed and created again, the token is gone and the configuration says <your token>`.
- One spec per call that fails, under `web-app/src/app/features/settings/settings-mcp.component.spec.ts#each failed call says so where it happened`.
- Phase two: `web-app/src/app/features/settings/settings-mcp.component.spec.ts#a production connection is offered only after Offer in the confirmation, at "Read"`; the window, `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#a double click on the allow button sends one answer: a request is answered once` and `web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#text from the API is shown as text: markup in the title, a fact or the note is never rendered`; the polling, `web-app/src/app/app.spec.ts#the polling stops when the app is destroyed`.
- The mark: `web-app/src/app/app.spec.ts#while the server is enabled, the toolbar shows the MCP mark and its dot, as a named link to Settings before Notifications`; the place of the group: `web-app/src/app/features/settings/settings.component.spec.ts#the MCP server group sits between Data and Developer, as Settings.dc.html draws it, and is absent against an API without it`.
