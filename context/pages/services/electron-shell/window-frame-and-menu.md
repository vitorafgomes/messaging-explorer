---
title: "Electron Shell: Window frame and menu"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Electron Shell service page"
page_type: service
status: active
description: "Read when a change touches the native frame, the window background, the application menu, the shell shortcuts."
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

# Electron Shell: Window frame and menu

One topic of [[pages/services/electron-shell|Electron Shell]]; the map lists the others.

## Window frame and menu

Since 2026-11-13, the owner's decision of 2026-11-12: a standard window and no menu bar of its own.

- **Frame.** The native frame and title bar on every platform: the options carry no `titleBarStyle`, `trafficLightPosition` or `vibrancy` (`web-app/electron/shell-helpers.js#function mainWindowOptions({ preload, icon, prefersDark }) {`). Until then macOS asked for `hiddenInset` with the window buttons at 15, 15, drawn over the toolbar, and no drag region. The page declares none now; the native title bar drags the window.
- **Background.** The Material surface colour of the system theme, `#111318` dark or `#f9f9ff` light, chosen by `nativeTheme.shouldUseDarkColors` (`web-app/electron/main.js#prefersDark: nativeTheme.shouldUseDarkColors`, `web-app/electron/shell-helpers.js#backgroundColor: prefersDark ? '#111318' : '#f9f9ff'`), instead of `#4A90E2`. The theme the user chose inside the app lives in the renderer's `localStorage` and is not read here, so someone who picked the opposite of the system theme sees the system colour until the first paint.
- **Menu.** `applicationMenuTemplate` (`web-app/electron/shell-helpers.js#function applicationMenuTemplate(platform) {`) returns, on macOS, exactly three menus: the `appMenu` and `editMenu` roles and a `window` menu written out as minimize, zoom, close, a separator and front, because macOS delivers Cmd+C, Cmd+V, Cmd+X and Cmd+A through Edit and Cmd+M and Cmd+W through Window (the `windowMenu` role has no Close on macOS); elsewhere `null`, and `Menu.setApplicationMenu(null)` removes the menu bar (`web-app/electron/main.js#Menu.setApplicationMenu(menuTemplate && Menu.buildFromTemplate(menuTemplate));`). Set once in `whenReady`, before the splash. Pinned by `web-app/electron/shell-helpers.test.js#assert` and `web-app/electron/shell-helpers.test.js#no File/Edit/View/Window/Help bar: no application menu on win32 and linux`.
- **Shortcuts without a menu.** `shellShortcut` (`web-app/electron/shell-helpers.js#function shellShortcut(input, { platform, isDev }) {`) reads every key of the main window through `before-input-event` (`web-app/electron/main.js#mainWindow.webContents.on('before-input-event', (event, input) => {`) and takes it from the page only when it names an action: F11 toggles full screen on Windows and Linux, in every build; on macOS F11 is left alone, full screen being the zoom button and the system shortcut. F12 and Ctrl+Shift+I, Cmd+Alt+I on macOS, toggle the developer tools in a development build only; a packaged build never opens them. Key up and auto-repeat are ignored. Pinned by `web-app/electron/shell-helpers.test.js#devToolsKeys`, `web-app/electron/shell-helpers.test.js#F11 toggles full screen on win32 and linux, in packaged and development builds`, `web-app/electron/shell-helpers.test.js#F11 does nothing on darwin, where the zoom button and the system shortcut give full screen`, `web-app/electron/shell-helpers.test.js#a development build opens developer tools with F12 and Ctrl+Shift+I, or Cmd+Alt+I on darwin` and `web-app/electron/shell-helpers.test.js#a packaged build never opens developer tools`.
- **What the old menu held.** File (Connection, Clear All Data (Testing), Exit), View (developer tools in development builds, developer mode, full screen) and Help (About) are gone. Connections is the first link of the app toolbar ([[pages/services/web-app]]); developer mode is the page's Ctrl+Shift+D or Cmd+Shift+D. Full screen and the developer tools are the shell's shortcuts above. About moved to the Settings screen on 2026-11-13, with the version and the channel, which left the toolbar's version badge; the macOS application menu keeps its About item.
- **Alt+F4 on Windows** was the accelerator of Exit and quit the app. It is now the system's close, which hides the window to the tray as the close button always did; this is intended, and quitting on Windows and Linux is tray Quit.
