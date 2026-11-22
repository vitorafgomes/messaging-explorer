---
title: "Web App: The settings of the app an assistant may change"
version: "1.0"
date: 2026-11-20
changes: "v1.0: first version: the row Settings of the app, the polling of mcp/app-requests, the fixed list"
page_type: service
status: active
description: "Read when a change touches the row Settings of the app of the MCP server group, McpAppSettingsService, the polling of mcp/app-requests in App, or the settings an assistant may change."
source:
  - web-app/src/app/features/settings/mcp-app-settings.service.ts
  - web-app/src/app/features/settings/mcp-settings.service.ts
  - web-app/src/app/features/settings/settings-mcp.component.ts
  - web-app/src/app/app.ts
  - context/prototypes/web-app/Settings.dc.html
reliability: high
---

# Web App: The settings of the app an assistant may change

One topic of [[pages/services/web-app|Web App]]; the map lists the others. The group of Settings it belongs to is [[pages/services/web-app/features-settings-mcp]]; the row is drawn on `context/prototypes/web-app/Settings.dc.html` as "Settings of the app".

## Contract

All through `ApiService`, by `web-app/src/app/features/settings/mcp-settings.service.ts#McpSettingsService`:

- The state carries `supports.appSettings` and `appSettingsAllowed`; an older API leaves the second out, which is read as false (`web-app/src/app/features/settings/mcp-settings.service.ts#McpState`).
- `PUT mcp/app-settings` with `{ allowed }` answers the state (`web-app/src/app/features/settings/mcp-settings.service.ts#setAppSettings`).
- `GET mcp/app-requests` answers `{ id, time, assistant, setting, value }[]`; `setting` null asks only for the settings (`web-app/src/app/features/settings/mcp-settings.service.ts#McpAppRequest`).
- `POST mcp/app-requests/{id}/answer`, the id through `apiPath`, takes `{ applied, code, settings }`: `code` is null, `desktopOnly` or `failed`; `settings` is the theme, whether Developer mode is on, and the update channel, null without the desktop shell (`web-app/src/app/features/settings/mcp-settings.service.ts#McpAppAnswer`). It answers 204, or 404 when the request no longer waits.

## How it works

**The row.** Drawn only when `supports.appSettings`, right after "Logs of the app" and built like it: the checkbox "Let an assistant change settings of this app" bound to `appSettingsAllowed`, and two notes. The first leaves out the Monitoring history the artboard names, which this app does not have. A failed `PUT` shows the API's message in the row and puts the box back as the API last said (`web-app/src/app/features/settings/settings-mcp.component.ts#setAppSettings`). The checkbox is the only switch, and it is off until the user ticks it.

**The polling.** While the server is enabled, `supports.appSettings` is true and `appSettingsAllowed` is true, `App` reads `GET mcp/app-requests` every 2 seconds on its own tick, beside the one of `mcp/requests`, one call in flight, and each tick waits until the list it read is applied (`web-app/src/app/app.ts#applying`). A 404 stops it for good; any other failure is tried again on the next tick and shows nothing.

**Applying.** `web-app/src/app/features/settings/mcp-app-settings.service.ts#apply` takes the requests in the order the API lists them, each id once, and answers each. Before each it reads `McpSettingsService.state`: while the server is off or `appSettingsAllowed` is false it changes nothing and answers nothing, so a list fetched just before the user unticked the box is not applied. The ids handled, like the ids of requests `App` has shown, are kept only while the API still lists them.

- `setting` null changes nothing and answers applied.
- A setting or a value not on the fixed list `web-app/src/app/features/settings/mcp-app-settings.service.ts#ALLOWED` (theme: system, light, dark; developerMode: on, off; updateChannel: latest, beta) is answered `failed` and changes nothing. This list is the only gate on this side: the MCP server group, clearing the data and an update are not on it.
- The theme goes through `ThemeService.setMode`; Developer mode through `DevSettingsService.toggle`, the path of Ctrl+Shift+D, only when it is not already as asked; the channel through `AppUpdateService.setChannel`. A value already set changes nothing and answers applied.
- The channel needs the desktop shell, read as Settings reads it before it offers the channel (`AppUpdateService.status` other than `unavailable`); without it the answer is `desktopOnly`. A channel the shell refused, or left as it was, is `failed`.
- A change made shows "<assistant> set <Theme|Developer mode|Update channel> to <value>" with Close for 4 seconds; the name is text, never markup.
- An answer the API did not take is sent again on the next list, while the API still lists the request, and the setting is not applied a second time; a 404 means the request no longer waits and ends it (`web-app/src/app/features/settings/mcp-app-settings.service.spec.ts#an answer the API did not take is sent again while the request is still listed, and the setting is not applied a second time`).

## Sharp edges

- `web-app/src/app/features/settings/mcp-app-settings.service.ts#ALLOWED` is the gate. A name added to it reaches the branch of the update channel unless it gets its own branch.
- `web-app/src/app/features/settings/mcp-app-settings.service.ts#hasShell` must agree with the condition of the Updates group of Settings; if they differ, an assistant could set a channel the user cannot see.

## Tests

- `web-app/src/app/features/settings/mcp-app-settings.service.spec.ts#nothing in this path reaches the MCP group, clearing the data or an update: any other setting, or a value off the list, is answered failed and changes nothing`, with the real `ApiService` and `HttpTestingController.verify()`.
- `web-app/src/app/features/settings/mcp-app-settings.service.spec.ts#the update channel without the desktop shell is answered desktopOnly, with no channel in the settings, and nothing is changed`.
- `web-app/src/app/features/settings/mcp-app-settings.service.spec.ts#the assistant name is shown in the snack bar as text, never as markup`.
- `web-app/src/app/features/settings/mcp-app-settings.service.spec.ts#a choice withdrawn while a list is applied stops before the next request: it is not changed and not answered`, and the two lists handed over after the server was turned off or the choice withdrawn.
- `web-app/src/app/features/settings/mcp-app-settings.service.spec.ts#the ids handled are kept only while the API still lists them: a list without an id forgets it, and one still listed is not applied twice`; `web-app/src/app/app.spec.ts#the ids of requests shown are kept only while the API still lists them, and one still listed is not opened twice`.
- `web-app/src/app/app.spec.ts#a 404 on GET mcp/app-requests stops polling it for good, and the requests that ask the user are still polled`.
- `web-app/src/app/features/settings/settings-mcp.component.spec.ts#"Settings of the app" follows "Logs of the app" when the API supports it, off as the API answers it, and ticking it is PUT mcp/app-settings`.
