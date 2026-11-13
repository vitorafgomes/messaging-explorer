---
title: "UI review, November 2026"
version: "1.0"
date: 2026-11-12
changes: "Initial page"
page_type: roadmap
status: active
description: "A design review of every screen of the web app and of the Electron window on macOS, read from the code: what breaks the UI convention, in priority order, with the artboard that draws the target."
updated: 2026-11-13
source:
  - chat
  - "web-app/electron/main.js"
  - "web-app/electron/preload.js"
  - "web-app/src/app/app.html"
  - "web-app/src/app/app.scss"
  - "web-app/src/styles.scss"
  - "web-app/src/app/features/"
  - "web-app/src/app/shared/"
  - "vault/prototypes/web-app/index.html"
reliability: medium
---

# UI review, November 2026

> Every screen and dialog of the app was read in the code and redrawn as it should be under [[pages/conventions/ui]]. This page lists what the code does differently, most harmful first, and what a Mac user most likely sees. Nothing here was observed in a running app.

## How to read this page

- The target of every finding is an artboard of `vault/prototypes/web-app/index.html`, named by its address (`#queue`, `#mac`). The prototype now has 38 artboards; its README describes each.
- Evidence is a `path:line` read on 2026-11-12. A line proves the code says so, not how it renders.
- **Reliability is medium on purpose.** The review was done on Linux by reading templates and styles. Section C lists what that cannot settle.
- The work itself belongs to [[pages/roadmap/ui-material-migration]]; this page feeds its phases and does not reorder them, except where section D says so.

## A. macOS

The owner remembers a user reporting layout problems on macOS, with no details. The code explains several. All of it is **inferred from code, not reproduced**: nobody ran the app on a Mac for this review. "Sure" below means how sure the reading of the code is, given how Electron documents the option.

### A1. The window buttons are drawn over the toolbar title

- **Done 2026-11-13.** The window options are the same on every platform and carry no `titleBarStyle`, `trafficLightPosition` or `vibrancy` (`web-app/electron/shell-helpers.js:108`), pinned by `web-app/electron/shell-helpers.test.js:79`; the toolbar starts with the navigation and the brand text is gone (`web-app/src/app/app.html:2`). Tested as the options the window receives, not seen on a Mac.
- **Evidence (the code before 2026-11-13):** on darwin the window was created with `titleBarStyle: 'hiddenInset'` and `trafficLightPosition: { x: 15, y: 15 }` in `main.js`. The page starts with the toolbar (`web-app/src/app/app.html:1`); in Electron the menu button was not rendered, so the first thing in the toolbar was the brand text. Nothing in the Angular app reads the platform to change layout: the only use of `platform` is the bug report (`web-app/src/app/app.ts:150`), although the preload exposes it (`web-app/electron/preload.js:37`).
- **What a Mac user sees:** the close, minimise and zoom buttons on top of the first letters of "Messaging Explorer".
- **How sure:** high that they overlap; the exact pixels are not known.
- **Fix (owner's decision, 2026-11-12: a standard window and no menu bar of its own):** stop asking for the hidden title bar on darwin. With the native title bar the buttons have their own strip and nothing in the page has to make room for them. Board `#mac`; the defect is board `#mac-today`.

### A2. The window cannot be dragged

- **Done 2026-11-13, with A1:** the native title bar is back, so the page still declares no drag region, which is now what the design asks. Not seen on a Mac.
- **Evidence:** a hidden title bar leaves no native drag area; the page must mark one with `-webkit-app-region: drag`. The only `app-region` in the repo is `no-drag` on the splash screen (`web-app/electron/splash.html:27`); there is none under `web-app/src`.
- **What a Mac user sees:** a window that cannot be moved by its top edge, and no double click to zoom.
- **How sure:** high. This is the most likely content of the "layout problems" report.
- **Fix:** the native title bar drags the window, so the page declares no drag region. Board `#mac`.

### A3. No Edit menu and no Window menu

- **Done 2026-11-13.** On macOS the menu is exactly the `appMenu` and `editMenu` roles and a Window menu of minimize, zoom, close and front (`web-app/electron/shell-helpers.js:76`); on Windows and Linux no application menu is set, which removes the menu bar (`web-app/electron/main.js:794`). Pinned by `web-app/electron/shell-helpers.test.js:14` and `web-app/electron/shell-helpers.test.js:19`. Of what File, View and Help held: Connections is the first link of the toolbar, where Add Connection already is; the testing item that cleared all data left with the menu (the debug panel button stays, finding 5); developer mode is the page's shortcut. The developer tools are F12 and Ctrl+Shift+I (Cmd+Alt+I on macOS) in development builds only, handled by the shell without a menu (`web-app/electron/shell-helpers.js:93`). About was **not** moved, because the Settings screen does not exist yet: it remains only as the item of the macOS application menu. The Cmd+N and Ctrl+N of board `#win` are not built. Whether Cmd+C, Cmd+V, Cmd+M and Cmd+W now work needs a Mac.
- **Evidence (the code before 2026-11-13):** the menu template had File, View and Help and, on darwin, the application menu. No item used the `undo`, `cut`, `copy`, `paste` or `selectAll` roles, and there was no `windowMenu`.
- **What a Mac user sees:** on macOS the clipboard shortcuts are delivered through the Edit menu, so Cmd+C, Cmd+V, Cmd+X and Cmd+A may do nothing in a text field: a connection string cannot be pasted with the keyboard. Cmd+M and Cmd+W are missing too.
- **How sure:** medium to high; it is the documented behaviour of an Electron app without those roles, not verified on this build.
- **Fix:** on macOS the application menu is reduced to three entries: the application menu, Edit (undo, redo, cut, copy, paste, select all) and Window. On Windows and Linux no application menu is set and the window hides the menu bar, because copy and paste work there without one. What File, View and Help held moves into the app: a new connection on the Connections screen, About and the developer tools in Settings; the testing item that clears all data is removed; shortcuts are handled by the page. Boards `#mac`, `#win`.

### A4. Menu items and shortcuts that are not macOS

- **Partly done 2026-11-13.** There is no Exit item on any platform, so macOS has one Quit, the application menu's. The page's developer mode shortcut accepts `metaKey` beside `ctrlKey` (`web-app/src/app/app.ts:101`), pinned by `web-app/src/app/app.spec.ts:111`. F11 toggles full screen on Windows and Linux, handled by the shell as board `#win` draws it (`web-app/electron/shell-helpers.js:93`, `web-app/electron/main.js:492`), pinned by `web-app/electron/shell-helpers.test.js:40`. **Not done:** `{ role: 'togglefullscreen' }`: on macOS full screen is the zoom button and the system shortcut, neither verified. On Windows, Alt+F4 used to be Exit's accelerator and quit the app; it is now the system's close, which hides the window to the tray as the close button does, by decision.
- **Evidence (the code before 2026-11-13):** "Exit" in File with `Cmd+Q` duplicated the Quit of the application menu. Full screen was F11 and developer tools F12; on a Mac keyboard those are media keys and the convention is Ctrl+Cmd+F. The in-page developer mode shortcut tested `ctrlKey` only, while the menu item used `CmdOrCtrl`.
- **What a Mac user sees:** two Quit items, a full screen shortcut that does not work as expected.
- **How sure:** high for the duplicate, medium for the function keys.
- **Fix:** `{ role: 'togglefullscreen' }`, no Exit item on darwin, `metaKey` accepted beside `ctrlKey`.

### A5. Vibrancy that cannot show, and a blue flash

- **Partly done 2026-11-13.** The vibrancy request is gone (A1), and the window background is the surface colour of the system theme, `#111318` dark or `#f9f9ff` light, from `nativeTheme.shouldUseDarkColors` (`web-app/electron/main.js:489`, `web-app/electron/shell-helpers.js:123`), pinned by `web-app/electron/shell-helpers.test.js:93`. It follows the system theme, not the theme stored in the app, which lives in the renderer's `localStorage`: someone whose app theme differs from the system still sees the other colour until the first paint.
- **Evidence (the code before 2026-11-13):** `vibrancy: 'sidebar'` with an opaque window background `#4A90E2` in `main.js`, and an opaque page background (`web-app/src/styles.scss:62`). The window is shown 1.5 seconds after it is ready (`web-app/electron/main.js:536`).
- **What a Mac user sees:** no vibrancy at all; possibly a blue rectangle before the first paint, also in the dark theme.
- **How sure:** high that the vibrancy is invisible; the flash depends on timing.
- **Fix:** drop the vibrancy request (the design does not use it) and set the window background from the stored theme. All platforms gain from the second half.

### A6. Auto-update on an unsigned build

- **Evidence:** the release workflow states the macOS build is unsigned (`.github/workflows/release.yml:5`); the updater is wired for every platform (`web-app/electron/main.js:837`) and the toolbar offers "Restart to Update" (`web-app/src/app/app.html:58`).
- **What a Mac user sees:** most likely an update that downloads and then fails to install, because the macOS updater requires a signed app; the failure shows as one icon (`web-app/src/app/app.html:64`).
- **How sure:** medium. Needs one run of a released build.
- **Fix:** until the build is signed, macOS takes the fifth state of board `#updates`: "this package cannot update itself", with a link to the download. The same state serves the deb and the portable exe.

### A7. Smaller risks

- **Fonts for code.** `'Consolas', 'Courier New'` (`web-app/src/app/features/entities/entity-details.component.ts:873`), `'Fira Code', 'Consolas', 'Monaco'` (`web-app/src/app/shared/components/message-body-editor/message-body-editor.component.ts:237`), `'Courier New'` (`web-app/src/app/shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component.ts:302`). A Mac has neither Consolas nor Fira Code, so each place falls to a different font. Fix: one stack defined once, starting with `ui-monospace, "SF Mono", Menlo`, as in the prototype's `--mono`.
- **Custom scrollbar in the tree** (`web-app/src/app/features/entities/entities-tree.component.ts:656`): it replaces the overlay scrollbar of macOS with a permanent 8 px one in Bootstrap colours. Fix: remove it; `color-scheme` already themes the native one.
- **Tray icon.** One bitmap resized to 16 px on darwin (`web-app/electron/main.js:209`), from `tray-icon.png` (`web-app/electron/main.js:177`); no `@2x` file and no template image, so it is soft on Retina and does not adapt to a light or dark menu bar.
- **Application icon.** The build names `src/assets/icon.icns` (`web-app/package.json:146`); no such file is tracked in git. Whether the build generates it or ships the default icon was not checked.
- **Window size.** The window opens at 1400 by 900 (`web-app/electron/shell-helpers.js:110`), larger than the usable area of a 13 inch display at its default scaling, and allows 1000 by 700 (`web-app/electron/shell-helpers.js:112`). Board `#min` draws the shell at that minimum.
- **Update bar position.** The download bar is pinned at `top: 48px` (`web-app/src/app/app.scss:78`), a height the toolbar may not have.

## B. Improvements, in priority order

P1 can hurt a broker, mislead about a secret, or blocks a whole screen. P2 breaks a rule of [[pages/conventions/ui]] on a screen people use daily. P3 is polish.

### P1

1. **Purge sits beside the routine actions, as a red button.** Queue: `web-app/src/app/features/entities/entity-details.component.ts:88`. Subscription: the red Purge menu is the first button of the row (`web-app/src/app/features/entities/entity-details.component.ts:311`). Rule 6. Target: `#queue`, `#sub`.
2. **Monitoring, Queues and Topics cannot be reached in the desktop app. Fixed 2026-11-13:** the navigation is in the toolbar, in Electron and in the browser: Connections, Entities, Queues, Topics and Monitoring, the active one marked with `aria-current` (`web-app/src/app/app.html:2`), pinned by `web-app/src/app/app.spec.ts:79` against the route table. The side navigation, which was rendered only outside Electron, is gone. The tray still navigates only to Connections and Entities (`web-app/electron/main.js:331`, `web-app/electron/main.js:417`).
3. **Nothing on screen says which environment is connected.** The toolbar shows the namespace only (`web-app/src/app/app.html:31`). Rule 6 and Phase 2 of the migration. An environment group is a name with no meaning to the app (`web-app/src/app/core/models/connection-group.model.ts:4`). Target: the chip on every board, the production mark on `#groups`, NO ENVIRONMENT on `#connections`.
4. **Browser `confirm` and `alert` for destructive choices.** Deleting a connection (`web-app/src/app/features/connections/connections.component.ts:617`), a client and an environment (`web-app/src/app/features/connections/manage-group-dialog.component.ts:547`, `web-app/src/app/features/connections/manage-group-dialog.component.ts:620`), importing a configuration (`web-app/src/app/features/connections/connections.component.ts:725`). Rules 1 and 6: they name no connection or environment, are unstyled, and are worded by the browser. Target: `#groups`, `#conn-transfer`, `#purge`.
5. **"Clear All Data (Testing)" ships in the File menu with a shortcut. Partly fixed 2026-11-13:** the menu item, its shortcut and its `clear-all-data` IPC channel are gone with the File menu; it remains as a button of the debug panel (`web-app/src/app/features/connections/connections.component.ts:80`). Rule 6. Target: the danger zone of `#settings`, with the `#purge` dialog.
6. **A hint promises a secure store that does not exist.** "Stored in the secure secret store on save" under the client secret (`web-app/src/app/features/connections/add-connection-dialog.component.ts:146`); secrets are plain text in `workspace.json` ([[pages/services/core]]). Usability and honesty. Target: `#conn-azure`, `#settings`.
7. **Forms that cannot be saved. Partly fixed 2026-11-12:** the topic panel was a live form with number inputs and a range slider and no save; it is read-only text now, and the duration boxes of the queue and subscription panels became text. What other read-only inputs and disabled buttons remain on the subscription panel was not surveyed again. Rule 8. Target: `#topic`, `#queue`; real editing is the proposed `#p-edit`.

### P2

8. **A queue and a subscription are two different panels.** Plain stat cards for the queue (`web-app/src/app/features/entities/entity-details.component.ts:101`), a live transfer monitor and tabs for the subscription (`web-app/src/app/features/entities/entity-details.component.ts:337`, `web-app/src/app/features/entities/entity-details.component.ts:376`). Rule 7, Phase 1. Target: `#queue` and `#sub` differ only by the Rules tab.
9. **Delete is the first button of the selection bar, the same size as the others** (`web-app/src/app/shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component.ts:71`). Rule 6. Target: `#messages`.
10. **Icon-only buttons with no name.** Edit and delete on each connection (`web-app/src/app/features/connections/connections.component.ts:196`, `web-app/src/app/features/connections/connections.component.ts:199`) and on each group (`web-app/src/app/features/connections/manage-group-dialog.component.ts:94`). Rule 10. Target: every icon button of the prototype carries an `aria-label` and a title.
11. **The RabbitMQ password is filled with a default** (`web-app/src/app/features/connections/add-connection-dialog.component.ts:500`), so a wrong credential can be saved without typing. Target: `#conn-rabbit`.
12. **Default credential is in the model and not in the dialog** (`web-app/src/app/core/models/connection.model.ts:14`, `web-app/src/app/features/connections/add-connection-dialog.component.ts:483`). Target: `#conn-azure`.
13. **Update states are terse.** A failed update is one icon with a tooltip (`web-app/src/app/app.html:64`); the channel switch is a click on the version number (`web-app/src/app/app.html:9`). Rule 9. Target: `#updates`, `#settings`.
14. **Send hides delivery options behind tabs** (`web-app/src/app/features/messages/send-message-dialog.component.ts:76`), where the schedule and time to live are (`web-app/src/app/features/messages/send-message-dialog.component.ts:167`), and the header does not name the environment. Target: `#send`.
15. **Fixed widths.** The tree column is 320 px (`web-app/src/app/features/entities/entities-container.component.ts:31`), the import preview fixes its columns (`web-app/src/app/features/messages/import-messages-dialog.component.ts:92`), the connection dialog has a 500 px minimum (`web-app/src/app/features/connections/add-connection-dialog.component.ts:360`). Rule 5. Target: `#min`, `#msg-import`.
16. **The tree has no filter and is not virtualised** (`web-app/src/app/features/entities/entities-tree.component.ts:74`). Rule 11 once a namespace has hundreds of entities. Target: `#topic`.
17. **No screen created an entity. Fixed 2026-11-12:** a create action on the tree opens the form dialog drawn on `#create` (`web-app/src/app/features/entities/entities-tree.component.ts:837`).

### P3

18. **Emojis in the interface**: the debug panel (`web-app/src/app/features/connections/connections.component.ts:96`) and an alert (`web-app/src/app/features/connections/connections.component.ts:861`). Rule J of the repo.
19. **Dialog titles are Bootstrap `h5.modal-title` with Font Awesome** in the message dialogs (`web-app/src/app/features/messages/send-message-dialog.component.ts:45`), beside Material titles in the shared ones (`web-app/src/app/shared/confirm-dialog.component.ts:26`). Rules 1 and 3. Phase 3 covers it.
20. **About is a native message box. Changed 2026-11-13:** the Help menu and its message box are gone; macOS keeps the About item of its application menu, and Windows and Linux have no About until Settings exists. Target: `#about`.
21. **The bug report asks for a name that goes to a public issue** (`web-app/src/app/shared/bug-report-dialog.component.ts:59`) and does not show the text before opening the browser. Target: `#bug`.
22. **Closing the window hides it** with no notice (`web-app/electron/main.js:548`). Target: the note on `#win`.

## C. What could not be judged without running the app

- Everything in section A. One session on a Mac with a released build settles A1 to A6.
- Whether the toolbar is blue. The template sets `color="primary"` (`web-app/src/app/app.html:1`) on a Material 3 theme (`web-app/src/styles.scss:36`), where that input may have no effect. The prototype keeps the blue toolbar of its first five boards.
- Real heights and density (`density: -1` at `web-app/src/styles.scss:43`), so the 56 px toolbar of the prototype is an assumption.
- The dark theme of the Bootstrap screens, contrast ratios, focus order and focus trapping in dialogs, screen reader output.
- Behaviour with volume: a tree of hundreds of entities, a message list of thousands, long names.
- Windows: the tray, the installer, high DPI.

## D. Where this review departs from the convention

- **Navigation.** [[pages/roadmap/ui-material-migration]] puts a redesign of navigation out of scope. Finding 2 needs at least the three links in the toolbar; the prototype draws exactly that and nothing more. The app was given five on 2026-11-13, because Queues and Topics are routes of their own and the desktop app had no other way to them.
- **Minimum width.** Rule 5 says 1024 px; the window allows 1000 (`web-app/electron/shell-helpers.js:112`). One of the two numbers should change. The prototype is drawn at 1000.
- **Typed acknowledgement.** Rule 6 asks for it on a purge. The prototype also uses it for a status change, deleting the last rule, clearing data and importing definitions, and proposes to require it only when the environment is production or unmarked.
- **Status colours.** The pending decision of the migration page is taken in the prototype: two tokens, warning and success, each with a container and an on-container colour, for light and dark.
- **Dialog corners.** The app forces 8 px (`web-app/src/styles.scss:97`); the prototype keeps the 24 px of its first boards. Either is fine; it should be one.

## Related

- [[pages/conventions/ui]], [[pages/roadmap/ui-material-migration]]
- [[pages/services/web-app]], [[pages/services/electron-shell]]
- [[pages/roadmap/code-audit-2026-11]]
