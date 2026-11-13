---
paths:
  - "web-app/electron/**"
---

# The Electron shell

Owns: process lifecycle of the API, window and splash, native menu, tray and its connection menu, single-instance lock, auto-update, `electron-builder` packaging and the release pipeline. Does not own any UI logic (`context/pages/services/web-app.md`) or any broker or storage code (`context/pages/services/api.md`, `context/pages/services/core.md`).

Each rule in full, with the code and tests that keep it: `context/pages/services/electron-shell/how-the-rules-are-kept.md`.

A gap written on `context/pages/services/electron-shell/known-gaps.md` may stay as it was found.
A change never adds a gap and never widens one.

## Read before you change

- `context/pages/invariants/local-authenticated-api.md` - the secret, loopback binding and `X-Api-Key` contract this process creates and enforces the start of.
- `context/pages/invariants/secrets-masked-at-the-api-boundary.md` - why the tray can show connection data safely.
- `context/pages/services/web-app.md` - the only consumer of `window.electronAPI`.
- `context/pages/services/api/public-contract-and-startup.md` - the child process; `API_SECRET` and `SERVICEBUS_DATA_PATH` are read there.
- `context/pages/architecture/project-map.md` and `context/pages/conventions/tooling.md` - repo layout and the release toolchain.

## Commands

| When | Run |
|---|---|
| Test the shell | `../tools/checks/in-docker.sh npm run test:electron` in `web-app/` |
| An IPC channel, or how the API process starts, changed | a sensitive change with the `api-surface` lens |

## What to read for a change

Read the one row your change matches. Pages are under `context/pages/services/electron-shell/`; the map, `context/pages/services/electron-shell.md`, lists them all.

| If the change touches | Read |
|---|---|
| The secret, the port, starting or stopping the API, the single-instance lock | `startup-and-api-process.md` |
| Window options, CSP, `window.open`, what main.js logs | `how-the-rules-are-kept.md` |
| The frame, the menu, a shell shortcut | `window-frame-and-menu.md` |
| An IPC channel, `preload.js`, the tray | `ipc-and-tray.md` |
| Updates, `electron-builder`, `release.yml` | `updates-packaging-and-release.md` |
| `shell-helpers.js` or a shell test | `tests.md` |
