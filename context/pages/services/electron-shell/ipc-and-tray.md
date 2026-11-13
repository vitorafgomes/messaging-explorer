---
title: "Electron Shell: IPC surface and tray"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Electron Shell service page"
page_type: service
status: active
description: "Read when a change touches an IPC channel, the preload bridge, or the tray and its connection menu."
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

# Electron Shell: IPC surface and tray

One topic of [[pages/services/electron-shell|Electron Shell]]; the map lists the others.

## IPC surface

| Channel | Direction | Returns / payload | Preload API | Caller in `web-app/src` |
|---|---|---|---|---|
| `get-app-version` | invoke | `app.getVersion()` (`web-app/electron/main.js#ipcMain.handle('get-app-version', () => {`) | `getAppVersion` | `AppUpdateService.initialize` (`web-app/src/app/features/settings/app-update.service.ts#shell`) |
| `get-api-secret` | invoke | the per-launch secret (`web-app/electron/main.js#ipcMain.handle('get-api-secret', () => API_SECRET);`) | `getApiSecret` | `ApiService` (`web-app/src/app/core/services/api.service.ts#electronAPI`) |
| `get-api-port` | invoke | `apiPort` number (`web-app/electron/main.js#ipcMain.handle('get-api-port', () => apiPort);`) | `getApiPort` | `ApiService` (`web-app/src/app/core/services/api.service.ts#port`) |
| `check-for-updates` | invoke | `{status:'dev-mode'}`, `{status:'ok',version}` or `{status:'error',message}` (`web-app/electron/main.js#ipcMain.handle('check-for-updates', async () => {`) | `checkForUpdates` | `AppUpdateService.check` (`web-app/src/app/features/settings/app-update.service.ts#result`) |
| `download-update` | invoke | `{status:'ok'}` or error (`web-app/electron/main.js#ipcMain.handle('download-update', async () => {`) | `downloadUpdate` | `AppUpdateService.download` (`web-app/src/app/features/settings/app-update.service.ts#result`) |
| `install-update` | invoke | none; `quitAndInstall(false, true)` (`web-app/electron/main.js#ipcMain.handle('install-update', () => {`) | `installUpdate` | `AppUpdateService.install` (`web-app/src/app/features/settings/app-update.service.ts#install`) |
| `set-update-channel` | invoke | for `latest` or `beta` only: stores and applies it, returns `{status:'ok',channel}`; anything else changes nothing and returns `{status:'error',message:'Unknown update channel'}` (`web-app/electron/main.js#ipcMain.handle('set-update-channel', (event, requested) => {`) | `setUpdateChannel` | `AppUpdateService.setChannel` (`web-app/src/app/features/settings/app-update.service.ts#result`) |
| `get-update-channel` | invoke | stored channel, `latest` when the stored value is not a known channel (`web-app/electron/main.js#ipcMain.handle('get-update-channel', () => {`) | `getUpdateChannel` | `AppUpdateService.initialize` (`web-app/src/app/features/settings/app-update.service.ts#shell`) |
| `get-self-update-blocker` | invoke | `'macos-unsigned'`, `'windows-portable'`, `'linux-package'` or null, from `selfUpdateBlocker(process.platform, process.env)`; read-only, takes no argument (`web-app/electron/main.js#ipcMain.handle('get-self-update-blocker', () => selfUpdateBlocker(process.platfo`, `web-app/electron/shell-helpers.js#function selfUpdateBlocker(platform, env) {`); added 2026-11-13 | `getSelfUpdateBlocker` | `AppUpdateService.initialize` (`web-app/src/app/features/settings/app-update.service.ts#shell`) |
| `update-status` | main to renderer | `{status, version?, percent?, message?, releaseNotes?}` (`web-app/electron/main.js#function sendUpdateStatus(status, data = {}) {`) | `onUpdateStatus` | `AppUpdateService.initialize` (`web-app/src/app/features/settings/app-update.service.ts#shell`) |
| `navigate` | main to renderer | route string, from the tray (`web-app/electron/main.js#mainWindow.webContents.send('navigate', '/entities');`, `web-app/electron/main.js#mainWindow.webContents.send('navigate', '/connections');`) | `onNavigate` | `app.ts` |
| `change-connection` | main to renderer | connection id from tray (`web-app/electron/main.js#mainWindow.webContents.send('change-connection', connection.id);`) | `onChangeConnection` | `app.ts` |
| `set-active-connection` | `ipcMain.on` | sets tray checkmark (`web-app/electron/main.js#ipcMain.on('set-active-connection', (event, connectionId) => {`) | none | none |
| `connections-updated` | `ipcMain.on` | refreshes tray menu (`web-app/electron/main.js#ipcMain.on('connections-updated', () => {`) | none | none |

Removed on 2026-11-13 with the native menu, their only sender: `toggle-dev-mode` and `clear-all-data`, with the preload's `onToggleDevMode` and `onClearAllData`, the listener in `app.ts` and the one on the connections page; and `menu-new-connection` with `onNewConnection`, which had no sender at all. No channel was added then. On 2026-11-13 the Settings screen added one read-only getter, `get-self-update-blocker` (above): its answer is decided in the main process from `process.platform` and two variables the packages set, `PORTABLE_EXECUTABLE_FILE` (the portable launcher of electron-builder, the `app-builder-lib` package (`templates/nsis/portable.nsi`)) and `APPIMAGE`; it sends nothing to the main process and changes nothing. With a reason, the renderer offers neither Download nor Restart to Update, only the download page ([[pages/services/web-app]]).

The preload bridge also exposes `platform`, `isElectron` (`web-app/electron/preload.js#getSelfUpdateBlocker: () => ipcRenderer.invoke('get-self-update-blocker'),`). Since 2026-11-13 `window.electronAPI` is the only global it exposes: the generic `window.electron.on`, whose one caller in `web-app/src` went with the clear-all-data listener, was removed. `web-app/electron/preload.test.js#originalLog` loads the preload against a fake `electron` module and asserts that one global and the channels its listeners subscribe to, `change-connection`, `navigate` and `update-status` (`web-app/electron/preload.test.js#the preload exposes only window.electronAPI, with no generic channel listener`). Preload contains no `ipcRenderer.send`, so the two `ipcMain.on` handlers cannot be reached from the sandboxed renderer. Any script running in the window can call `getApiSecret`; the secret is therefore only as protected as the page content, see [[pages/invariants/local-authenticated-api]].

## Tray

The tray calls the API itself with Node `http` and the secret header (`web-app/electron/main.js`), for `connections` and `connectiongroups`, 5 s timeout, returning `[]` on any error (`web-app/electron/main.js#req.on('error', (error) => {`). It is first built at tray creation, before the API is likely to be up, and refreshed only by the two unreachable `ipcMain.on` handlers and by a connection click (`web-app/electron/main.js#updateTrayMenu(); // Refresh menu to update checkmarks`). The tray list is therefore usually empty until a connection item is used. Menu labels use `connection.name`, falling back to the first 40 characters of `connection.connectionString` as returned by the API (`web-app/electron/main.js`); that value is the masked form per [[pages/invariants/secrets-masked-at-the-api-boundary]].
