---
title: "Electron Shell"
version: "2.0"
date: 2026-11-12
updated: 2026-11-13
changes: "v2.0: a map of topic pages; the old version notes moved to history"
page_type: service
status: active
description: "Electron main process and preload that start the local .NET API with a per-launch secret, host the Angular UI, run the tray, updater and installers."
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

# Electron Shell

> The desktop wrapper: it launches the published .NET API with a random per-launch secret, shows the Angular UI in a sandboxed window, and owns tray, menu, updates and packaging.

## Responsibility

Owns: process lifecycle of the API, window and splash, native menu, tray and its connection menu, single-instance lock, auto-update, `electron-builder` packaging and the release pipeline. Does not own any UI logic ([[pages/services/web-app]]) or any broker or storage code ([[pages/services/api]], [[pages/services/core]]).

## Rules

The rules this project must keep, and what to read before changing it, are in `.claude/rules/electron-shell.md`; Claude Code loads that file when a task touches the project. Each rule in full, with the code and tests that keep it: [[pages/services/electron-shell/how-the-rules-are-kept]].

## Topics

Read the page your change touches, not all of them.

| Page | Read when a change touches |
|---|---|
| [[pages/services/electron-shell/how-the-rules-are-kept\|How the rules are kept]] | an invariant the shell keeps (the secret, the window security settings, what is logged), or a review of a change that could break one |
| [[pages/services/electron-shell/startup-and-api-process\|Startup and the API process]] | the secret, the port, dev or packaged start of the API, the health wait, a start failure, the stop on quit, the single-instance lock |
| [[pages/services/electron-shell/window-frame-and-menu\|Window frame and menu]] | the native frame, the window background, the application menu, the shell shortcuts |
| [[pages/services/electron-shell/ipc-and-tray\|IPC surface and tray]] | an IPC channel, the preload bridge, or the tray and its connection menu |
| [[pages/services/electron-shell/updates-packaging-and-release\|Updates, packaging and release]] | electron-store, electron-updater and the update channel, the electron-builder configuration, or the release workflow |
| [[pages/services/electron-shell/tests\|Tests]] | shell-helpers.js and its tests, the preload and release-workflow tests, or what no test reaches |
| [[pages/services/electron-shell/known-gaps\|Known gaps]] | a gap of the shell recorded as it was found |

## Related

[[pages/services/web-app]], [[pages/services/api]], [[pages/architecture/project-map]], [[pages/history/electron-shell]].
