---
title: "Electron Shell history"
version: "1.1"
date: 2026-11-13
updated: 2026-11-14
changes: "v1.1: dated entries above the version notes"
page_type: reference
status: active
description: "What changed in the Electron Shell project and when, newest first, as the service page header recorded it until 2026-11-13."
source:
  - context/pages/services/electron-shell.md
reliability: high
---

# Electron Shell history

What changed when in the project [[pages/services/electron-shell|Electron Shell]] describes, newest first.

## 2026-11-14

- `open-dev-tools`, an IPC channel with no argument: it opens the developer tools of the main window only when the main window's own webContents asks, and does nothing when the window is gone (`web-app/electron/shell-helpers.js#openDevTools`); the preload exposes it as `openDevTools`. Ctrl+N, or Cmd+N on macOS, in every build, sends `navigate` `/connections` (`web-app/electron/shell-helpers.js#shellShortcut`). The `before-input-event` handler names each action, where before any action other than full screen toggled the developer tools.
- Two IPC channels for the Settings screen, neither taking an argument: `get-data-file` answers the path of `data/workspace.json` under the user data folder, and `show-data-file` shows it in the file manager, answering an error when nothing is saved yet or the file manager refuses (`web-app/electron/shell-helpers.js#showDataFile`). Tests: four new shell tests, two of them where the call fails.

## Version notes until 2026-11-13

The `changes` field of the service page header as it stood when the page became a map, cut at each "Earlier", in its words.

- 2026-11-13: one read-only IPC getter, get-self-update-blocker, says why this package cannot update itself (macOS unsigned, the portable exe, a Linux package other than the AppImage); the update calls of the renderer moved from app.ts to AppUpdateService; About moved to Settings.
- Earlier 2026-11-13: the shell handles F11 and, in development builds, the developer tools keys without a menu; the macOS Window menu is explicit and carries Close; window.electron is gone from the preload; a preload test.
- Earlier 2026-11-13: the native frame and title bar on macOS, no application menu on Windows and Linux and only the application, Edit and Window menus on macOS, a window background from the system theme, the IPC channels toggle-dev-mode, clear-all-data and menu-new-connection removed, the menu and the window options moved into shell-helpers.js with tests.
- Earlier 2026-11-13: the health timeout tests run on the node:test fake clock. 2026-11-12: beta channel applies allowPrerelease, no downgrade, release uploads beta metadata and block maps; health wait and start-failure dialog, SIGKILL fallback that can fire, openExternal scheme allowlist, update-channel validation, emojis removed from logs, shell-helpers.js and its node:test suite
