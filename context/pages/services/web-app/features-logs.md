---
title: "Web App: The Logs screen"
version: "1.0"
date: 2026-11-19
updated: 2026-11-19
changes: "v1.0: the Logs screen of Developer mode"
page_type: service
status: active
description: "Read when a change touches the Logs screen of Developer mode, the service that gathers its lines, or what a line may carry."
source:
  - web-app/src/app/features/logs/logs.component.ts
  - web-app/src/app/core/services/app-log.service.ts
  - context/prototypes/web-app/Logs.dc.html
reliability: high
---

# Web App: The Logs screen

One topic of [[pages/services/web-app|Web App]]; the map lists the others. The lines of the backend come from the route on [[pages/services/api/controllers]].

**The Logs screen (2026-11-19).** With Developer mode on, the toolbar shows Logs beside Monitoring, with a count of the errors (`web-app/src/app/features/logs/logs.component.ts#shown`, drawn on `context/prototypes/web-app/Logs.dc.html`). It lists the backend's lines, read every five seconds, and the calls of the screen that got no answer, which `ApiService` reports (a call the backend answered with an error is already one of the backend's lines, so it is not kept twice) (`web-app/src/app/core/services/app-log.service.ts#refresh`); with Developer mode off nothing is read or kept. Level, source and search narrow the list; a line opens to its details; Pause, Copy shown, Save to a file and Clear act on it. The third source, Desktop app, is read through `window.electronAPI.getShellLogs` on the same five seconds and is absent in a browser (`web-app/src/app/core/services/app-log.service.ts#readShell`); the shell's side is on [[pages/services/electron-shell/ipc-and-tray]].

A line never carries a request or response body, a header, a connection string, a password, a key or a token ([[pages/invariants/secrets-masked-at-the-api-boundary]]): the backend keeps of an exception only the names of its types, and the screen keeps of a failed call only its method, its path without the query and its status. Names of entities and of namespaces do appear, in paths and in the backend's own sentences.

**The shell's own log (2026-11-19).** What the main process writes to its console is also kept in memory, the last 500 lines, for the Logs screen (`web-app/electron/shell-helpers.js#function createShellLog({ limit = 500, hidden = [], now = () => new Date() } = {}) {`, wired by `web-app/electron/shell-helpers.js#function captureConsole(target, shellLog) {`). A line the API process wrote is never kept: the backend keeps its own, without the text of an exception. Of an Error only the name and the code are kept, of another object nothing; the home folder is written as `~` and the API secret as `***`. The shell never writes the text or the stack of an error to its console, only the error (`web-app/electron/shell-helpers.test.js#main.js never writes the text or the stack of an error to its console, only the error itself, of which the shell log keeps the name`).
