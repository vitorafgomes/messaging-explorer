---
title: "Electron Shell history"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: the version notes of the service page header"
page_type: reference
status: active
description: "What changed in the Electron Shell project and when, newest first, as the service page header recorded it until 2026-11-13."
source:
  - context/pages/services/electron-shell.md
reliability: high
---

# Electron Shell history

What changed when in the project [[pages/services/electron-shell|Electron Shell]] describes, newest first.

## Version notes until 2026-11-13

The `changes` field of the service page header as it stood when the page became a map, cut at each "Earlier", in its words.

- 2026-11-13: one read-only IPC getter, get-self-update-blocker, says why this package cannot update itself (macOS unsigned, the portable exe, a Linux package other than the AppImage); the update calls of the renderer moved from app.ts to AppUpdateService; About moved to Settings.
- Earlier 2026-11-13: the shell handles F11 and, in development builds, the developer tools keys without a menu; the macOS Window menu is explicit and carries Close; window.electron is gone from the preload; a preload test.
- Earlier 2026-11-13: the native frame and title bar on macOS, no application menu on Windows and Linux and only the application, Edit and Window menus on macOS, a window background from the system theme, the IPC channels toggle-dev-mode, clear-all-data and menu-new-connection removed, the menu and the window options moved into shell-helpers.js with tests.
- Earlier 2026-11-13: the health timeout tests run on the node:test fake clock. 2026-11-12: beta channel applies allowPrerelease, no downgrade, release uploads beta metadata and block maps; health wait and start-failure dialog, SIGKILL fallback that can fire, openExternal scheme allowlist, update-channel validation, emojis removed from logs, shell-helpers.js and its node:test suite
