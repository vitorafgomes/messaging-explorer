---
title: "Electron Shell history"
version: "1.2"
date: 2026-11-13
updated: 2026-11-16
changes: "2026-11-16: the versions of a channel. v1.1: dated entries above the version notes"
page_type: reference
status: active
description: "What changed in the Electron Shell project and when, newest first, as the service page header recorded it until 2026-11-13."
source:
  - context/pages/services/electron-shell.md
reliability: high
---

# Electron Shell history

What changed when in the project [[pages/services/electron-shell|Electron Shell]] describes, newest first.

## 2026-11-19

- A download refused because no update is on offer, while a check runs or after one found none, says so, apart from the refusal of a version that differs from the one agreed to (`web-app/electron/shell-helpers.js#downloadAgreedUpdate`).

- **Electron 42.** The shell moved from Electron 41 to 42.11 for its security fixes, which the 41 line does not receive: one high advisory and seven lower. None of the breaking changes of 42 touches this shell: it shows no notification, renders nothing off screen, never clears storage quotas and makes no named image. `sharp`, which only draws the icons at build time, went to 0.35, and the `uuid` under `exceljs` is overridden to 11.1.1. Checked by starting the packaged Linux build on its own data folder and ports: the API listened, the window read the empty lists with the key, and the quit stopped the API.

- From the review of the pull request: the version an agreement is checked against no longer outlives the offer. The installed updater replaces the update it holds only when it announces one, so the last announced version was already the one it would download; now a check in flight, a check that found nothing newer and an error each void it too, so a stale agreement is refused whatever the library does (`web-app/electron/shell-helpers.js#followFoundVersion`, `web-app/electron/shell-helpers.test.js#the version an agreement can be given for is the one the updater would download now`).

- From the same review: the shell logs an error as the error, never its text or stack, and `download-update` carries the version the agreement was given for.

- **An update downloads only with the user's agreement,** decided by the owner: the check announces, `download-update` refuses without `agreed`, and the special case of a picked version is gone. [[pages/services/electron-shell/updates-packaging-and-release]]

- The tray asks the API for its menu only once the API is healthy and refreshes then; the two requests it made before logged two errors at every start (`web-app/electron/main.js#async function fetchFromAPI(endpoint) {`).

- The shell keeps its own console lines in memory and answers them on `get-shell-logs`, for the Logs screen. [[pages/services/electron-shell/ipc-and-tray]]

- The `save-export-file` channel writes an export where the user chooses in the save dialog. [[pages/services/electron-shell/ipc-and-tray]]

## 2026-11-16

- A version the user picked is kept: nothing newer downloads or installs by itself while it runs. [[pages/services/electron-shell/updates-packaging-and-release]]

- The `install-update-version` channel downloads a picked version after the user's agreement, with the updater put back afterwards. [[pages/services/electron-shell/updates-packaging-and-release]]

- `list-update-versions`, an IPC channel with no argument: the versions of the stored channel, read by the main process from the release page of this repository ([[pages/services/electron-shell/updates-packaging-and-release]]). The first request the shell makes to the internet outside the updater.

## 2026-11-14

- `open-dev-tools`, an IPC channel with no argument: it opens the developer tools of the main window only when the main window's own webContents asks, and does nothing when the window is gone (`web-app/electron/shell-helpers.js#openDevTools`); the preload exposes it as `openDevTools`. Ctrl+N, or Cmd+N on macOS, in every build, sends `navigate` `/connections` (`web-app/electron/shell-helpers.js#shellShortcut`). The `before-input-event` handler names each action, where before any action other than full screen toggled the developer tools.
- Two IPC channels for the Settings screen, neither taking an argument: `get-data-file` answers the path of `data/workspace.json` under the user data folder, and `show-data-file` shows it in the file manager, answering an error when nothing is saved yet or the file manager refuses (`web-app/electron/shell-helpers.js#showDataFile`). Tests: four new shell tests, two of them where the call fails.

## Version notes until 2026-11-13

The `changes` field of the service page header as it stood when the page became a map, cut at each "Earlier", in its words.

- 2026-11-13: one read-only IPC getter, get-self-update-blocker, says why this package cannot update itself (macOS unsigned, the portable exe, a Linux package other than the AppImage); the update calls of the renderer moved from app.ts to AppUpdateService; About moved to Settings.
- Earlier 2026-11-13: the shell handles F11 and, in development builds, the developer tools keys without a menu; the macOS Window menu is explicit and carries Close; window.electron is gone from the preload; a preload test.
- Earlier 2026-11-13: the native frame and title bar on macOS, no application menu on Windows and Linux and only the application, Edit and Window menus on macOS, a window background from the system theme, the IPC channels toggle-dev-mode, clear-all-data and menu-new-connection removed, the menu and the window options moved into shell-helpers.js with tests.
- Earlier 2026-11-13: the health timeout tests run on the node:test fake clock. 2026-11-12: beta channel applies allowPrerelease, no downgrade, release uploads beta metadata and block maps; health wait and start-failure dialog, SIGKILL fallback that can fire, openExternal scheme allowlist, update-channel validation, emojis removed from logs, shell-helpers.js and its node:test suite
