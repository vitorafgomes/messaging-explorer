---
title: "Electron Shell: Tests"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Electron Shell service page"
page_type: service
status: active
description: "Read when a change touches shell-helpers.js and its tests, the preload and release-workflow tests, or what no test reaches."
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

# Electron Shell: Tests

One topic of [[pages/services/electron-shell|Electron Shell]]; the map lists the others.

## Tests

- `web-app/electron/shell-helpers.js` holds the testable decisions of main.js in plain CommonJS with no `electron` import: `isSafeExternalUrl`, `normalizeUpdateChannel`, `applyUpdateChannel`, `waitForHealth`, `stopProcess`, and since 2026-11-13 `applicationMenuTemplate`, `mainWindowOptions`, `shellShortcut` and `selfUpdateBlocker`, whose three reasons and the two packages that can update themselves are pinned by `web-app/electron/shell-helpers.test.js#a macOS build cannot update itself, because it is not signed`, `web-app/electron/shell-helpers.test.js#the portable Windows build cannot update itself; the installed one can` and `web-app/electron/shell-helpers.test.js#on Linux the AppImage can update itself; the deb package cannot`.
- `web-app/electron/shell-helpers.test.js` covers them with `node:test` and `node:assert/strict`, no dependency: no application menu on win32 and linux and exactly the three menus on darwin (`web-app/electron/shell-helpers.test.js#assert`, `web-app/electron/shell-helpers.test.js#no File/Edit/View/Window/Help bar: no application menu on win32 and linux`), the shell's shortcuts for each platform and build (`web-app/electron/shell-helpers.test.js#devToolsKeys` to `web-app/electron/shell-helpers.test.js#a packaged build never opens developer tools`), window options with no hidden title bar, traffic-light position or vibrancy and with the sandboxed web preferences (`web-app/electron/shell-helpers.test.js#windowPaths`), the background for each system theme (`web-app/electron/shell-helpers.test.js#options`), the accepted and refused URL schemes (`web-app/electron/shell-helpers.test.js#no blue flash: background follows the system theme`, `web-app/electron/shell-helpers.test.js#openExternal must not accept any URL scheme: http and https URLs are safe`), the two channels and the rejected values (`web-app/electron/shell-helpers.test.js#openExternal must not accept any URL scheme: file, javascript, custom schemes and garbage are refused`, `web-app/electron/shell-helpers.test.js#set-update-channel must reject a channel that is not latest or beta: latest and beta are kept`), what a channel applies to the updater, with a fake whose channel setter turns downgrades on as the library's does (`web-app/electron/shell-helpers.test.js#channel`, `web-app/electron/shell-helpers.test.js#updater`), the health outcomes healthy, exited and timeout, including a fetch that never settles (`web-app/electron/shell-helpers.test.js#updater`, `web-app/electron/shell-helpers.test.js#result`); since 2026-11-13 the two timeout cases run on the `node:test` fake clock (`setTimeout` and `Date`), so a five-minute deadline resolves in milliseconds and a stalled scheduler cannot change the count of attempts, and both `stopProcess` cases with a fake child whose `killed` turns true on the first signal (`web-app/electron/shell-helpers.test.js#timer`, `web-app/electron/shell-helpers.test.js#returned`).
- `web-app/electron/release-workflow.test.js` reads `.github/workflows/release.yml` as text and matches the upload globs of each OS against the files a stable and a beta build leave behind: the exact uploaded set, `beta*.yml` on a beta, the block maps, and never the builder's debug files (`web-app/electron/release-workflow.test.js#a stable release uploads latest*.yml and the packages for every OS`, `web-app/electron/release-workflow.test.js#a beta release uploads beta*.yml for every OS`, `web-app/electron/release-workflow.test.js#a release uploads the .blockmap files of the Windows installer and the macOS packages`, `web-app/electron/release-workflow.test.js#builder debug files are never uploaded`).
- Run with `npm run test:electron` in `web-app/` (`web-app/package.json`); CI runs it in the `web` job after the Angular tests (`.github/workflows/ci.yml#working-directory: web-app`).
- `web-app/electron/preload.test.js` loads the preload with a fake `electron` module (no Electron) and pins what it exposes; see the IPC surface. Since 2026-11-13 the fake records the channel of each `invoke`, and `getSelfUpdateBlocker` is pinned to `get-self-update-blocker` (`web-app/electron/preload.test.js#getSelfUpdateBlocker reads the get-self-update-blocker channel and sends nothing with it`).
- No test starts Electron. The wiring in main.js (the dialogs, the window opening after the wait, `before-quit`, the IPC handlers) is untested.
