---
title: "Electron Shell: How the rules are kept"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Electron Shell service page"
page_type: service
status: active
description: "Read when a change touches an invariant the shell keeps (the secret, the window security settings, what is logged), or a review of a change that could break one."
source:
  - web-app/electron/main.js
  - web-app/electron/shell-helpers.js
  - web-app/electron/shell-helpers.test.js
  - web-app/electron/preload.js
  - web-app/package.json
  - config.json
  - .github/workflows/release.yml
  - .github/workflows/ci.yml
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/ServiceBusExplorer.Api.csproj
  - web-app/src/app/app.ts
  - web-app/src/app/core/services/api.service.ts
reliability: high
---

# Electron Shell: How the rules are kept

One topic of [[pages/services/electron-shell|Electron Shell]]; the map lists the others.

## To change here, read

- [[pages/invariants/local-authenticated-api]] - the secret, loopback binding and `X-Api-Key` contract this process creates and enforces the start of.
- [[pages/invariants/secrets-masked-at-the-api-boundary]] - why the tray can show connection data safely.
- [[pages/services/web-app]] - the only consumer of `window.electronAPI`.
- [[pages/services/api]] - the child process; `API_SECRET` and `SERVICEBUS_DATA_PATH` are read there.
- [[pages/architecture/project-map]] and [[pages/conventions/tooling]] - repo layout and the release toolchain.

## Windows and security settings

- Main window: its options come from `mainWindowOptions` (`web-app/electron/shell-helpers.js#function mainWindowOptions({ preload, icon, prefersDark }) {`, called at `web-app/electron/main.js#mainWindow = new BrowserWindow(mainWindowOptions({`): `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, preload `preload.js` (`web-app/electron/shell-helpers.js#sandbox: true,`), pinned by `web-app/electron/shell-helpers.test.js#windowPaths`. Splash window uses the same three flags with no preload (`web-app/electron/main.js#nodeIntegration: false,`).
- Production loads `dist/web-app/browser/index.html` from `file://` (`web-app/electron/main.js#mainWindow.loadFile(path.join(__dirname, '../dist/web-app/browser/index.html'));`).
- CSP is set through `onHeadersReceived` for every non-`file://` response: `default-src 'self'; script-src 'self'; ... connect-src 'self' http://localhost:*` (`web-app/electron/main.js#session.defaultSession.webRequest.onHeadersReceived((details, callback) => {`, `web-app/electron/main.js`). `file://` responses are skipped (`web-app/electron/main.js#if (details.url.startsWith('file://')) {`), so the packaged window runs without this header; only the dev server is covered.
- `window.open` and link targets are always denied in-app; the URL goes to `shell.openExternal` only when `isSafeExternalUrl` accepts it, a parseable `http:` or `https:` URL (`web-app/electron/main.js#mainWindow.webContents.setWindowOpenHandler(({ url }) => {`, `web-app/electron/main.js#if (isSafeExternalUrl(url)) {`, `web-app/electron/shell-helpers.js#function isSafeExternalUrl(url) {`). That is the only `openExternal` call in main.js.
- Close hides the window (Linux: minimize) instead of quitting; quitting is via Quit in the macOS application menu or tray Quit (`web-app/electron/main.js#mainWindow.on('close', (event) => {`).

## Logging

Everything goes to `console.*` of the main process; there is no log file. Findings:

- The secret is never logged by main.js: it appears only in the child env (`web-app/electron/main.js#API_SECRET: API_SECRET`) and the tray header (`web-app/electron/main.js#headers: { 'X-Api-Key': API_SECRET }`). The API does not print it either; it only compares it (`src/ServiceBusExplorer.Api/Program.cs#FileWorkspaceManager`).
- Child stdout and stderr are echoed verbatim as `[API]` and `[API ERROR]` (`web-app/electron/main.js`, `web-app/electron/main.js#apiProcess.stdout.on('data', (data) => {`, `web-app/electron/main.js#apiProcess.stderr.on('data', (data) => {`), so anything the API logs, including connection data if the API ever logs it, would reach the console. That is an API-side question, see [[pages/services/api]].
- Connection ids are logged on tray selection (`web-app/electron/main.js#console.log('Active connection changed to:', connectionId);`). No connection string is passed to any `console` call in main.js or preload.js.
- The health probe logs nothing and sends no secret. Log strings in main.js carry no emoji markers since 2026-11-12.

## Where each rule is kept

The invariants this process keeps, each with the page that holds its code and tests:

- [[pages/invariants/local-authenticated-api]]: the per-launch secret and the start of the API on [[pages/services/electron-shell/startup-and-api-process]]; the channels that hand out the port and the secret on [[pages/services/electron-shell/ipc-and-tray]]; the window and its security settings above.
- [[pages/invariants/secrets-masked-at-the-api-boundary]]: what main.js logs, above; what the tray reads from the API on [[pages/services/electron-shell/ipc-and-tray]].
