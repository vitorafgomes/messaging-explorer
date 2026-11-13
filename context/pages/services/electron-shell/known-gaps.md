---
title: "Electron Shell: Known gaps"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Electron Shell service page"
page_type: service
status: active
description: "Read when a change touches a gap of the shell recorded as it was found."
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

# Electron Shell: Known gaps

One topic of [[pages/services/electron-shell|Electron Shell]]; the map lists the others.

## Known gaps

- Port is fixed from `config.json`; no free-port probing despite the preload comment: `web-app/electron/preload.js#// Get the dynamically-allocated API port from the Electron main process`.
- The SIGKILL fallback may not fire on a real quit: Electron does not wait for Node timers after `before-quit`, so the process may be gone before the 5 s timer runs and the API is left with only SIGTERM. Unverified, needs a run of the packaged app: `web-app/electron/main.js#stopProcess(apiProcess, { graceMs: 5000 }).unref();`.
- The start-failure and crash dialogs, and the window opening only after `/health`, have no automated test; they need Electron. Only `waitForHealth` is tested: `web-app/electron/main.js#async function openWindowWhenApiReady(startFailure) {`.
- A tray click during the health wait opens the main window before the API answers, because the tray exists first and calls `createWindow()` when there is no window: `web-app/electron/main.js#createWindow();`.
- No restart after the API crashes; the user gets one error box: `web-app/electron/main.js#function recordApiExit(code, signal) {`. An API killed by a signal after a healthy start (exit code null) shows no box at all: `web-app/electron/main.js#if (apiHealthy && code !== 0 && code !== null && !app.isQuitting) {`.
- CSP not applied to the packaged `file://` window: `web-app/electron/main.js#if (details.url.startsWith('file://')) {`.
- Tray refresh channels have no sender in preload, so the tray list goes stale: `web-app/electron/main.js#ipcMain.on('set-active-connection', (event, connectionId) => {`.
- The macOS window and menu are tested only as the options and the template the helpers return. Nobody has run the result on a Mac: whether the native title bar draws and drags as expected, whether Cmd+C and Cmd+V work in a text field through the Edit role and Cmd+W closes the window, and whether Cmd+Shift+D reaches the page as `D` or `d` (the page accepts both): `web-app/electron/shell-helpers.js#function applicationMenuTemplate(platform) {`.
- No code signing for any OS: `.github/workflows/release.yml#macOS: dmg + zip (unsigned)`.
- A Linux package other than the AppImage is told it cannot update itself (`web-app/electron/shell-helpers.js#if (platform === 'linux') return env.APPIMAGE ? null : 'linux-package';`), as the UI review asked. On electron-updater 6.8.11 a deb whose `resources/package-type` says `deb` loads `DebUpdater`, which installs through `pkexec` or `sudo` (the `electron-updater` package (`out/main.js`)); whether the released deb could update itself was not tried. The three reasons are tested as the helper's answers; none was seen in a packaged app.
- Framework-dependent API in the installer, .NET 10 runtime required on the host (inferred): `web-app/package.json`.
