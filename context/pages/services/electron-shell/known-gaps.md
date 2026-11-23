---
title: "Electron Shell: Known gaps"
version: "1.0"
date: 2026-11-13
updated: 2026-11-23
changes: "2026-11-23: the self-contained API, unproven on Windows and macOS; the deb updates itself; what was not run. v1.0: split out of the Electron Shell service page"
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
- The deb updates itself since 2026-11-23, on Restart to Update only (`web-app/electron/shell-helpers.js#function selfUpdateBlocker(`). On electron-updater 6.8.11 a deb whose `resources/package-type` says `deb` loads `DebUpdater`, which downloads the `.deb` named in `latest-linux.yml` and runs `dpkg -i`, else `apt install`, through `pkexec`, `gksudo`, `kdesudo`, `beesu` or bare `sudo` (the `electron-updater` package, `out/DebUpdater.js` and `out/LinuxUpdater.js`). Nobody has run a real update of an installed deb; the owner will. Read in the library and not seen: when `dpkg -i` fails, a cancelled password included, it runs `apt-get install -f -y` and asks for the password again, and if that one is given the app restarts on the old version with no error event; the prompt is a `spawnSync` that holds the main process until it closes; what bare `sudo` does without a terminal. An install error reaches Settings as a download that failed. An rpm, a pacman package or one of unknown type is still told it cannot update itself, never tried. An install asked with Restart to Update that leaves the app on its old version is told at the next start (`web-app/electron/shell-helpers.js#failedInstallNotice`); an install the app makes by itself on quit, on the AppImage and the Windows installer, writes no record and a failed one is not told.
- The self-contained API (since 2026-11-23) was run on Linux x64 and, on 2026-11-23, by the owner on a Windows x64 machine without .NET, where a portable built locally from Linux opened (2.5.1 failed there with exit code 2147516547). Not run: the Windows installer, a package built by the release workflow, and macOS on either architecture: `web-app/package.json#build:api:win`, `web-app/package.json#build:api:mac`.
