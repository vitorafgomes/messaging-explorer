---
paths:
  - "web-app/electron/**"
---

# The Electron shell

Owns: process lifecycle of the API, window and splash, native menu, tray and its connection menu, single-instance lock, auto-update, `electron-builder` packaging and the release pipeline. Does not own any UI logic (`context/pages/services/web-app.md`) or any broker or storage code (`context/pages/services/api.md`, `context/pages/services/core.md`).

A gap written under "Known gaps" on `context/pages/services/electron-shell.md` may stay as it was found.
A change never adds a gap and never widens one.

## Read before you change

- `context/pages/invariants/local-authenticated-api.md` - the secret, loopback binding and `X-Api-Key` contract this process creates and enforces the start of.
- `context/pages/invariants/secrets-masked-at-the-api-boundary.md` - why the tray can show connection data safely.
- `context/pages/services/web-app.md` - the only consumer of `window.electronAPI`.
- `context/pages/services/api.md` - the child process; `API_SECRET` and `SERVICEBUS_DATA_PATH` are read there.
- `context/pages/architecture/project-map.md` and `context/pages/conventions/tooling.md` - repo layout and the release toolchain.

## Commands

| When | Run |
|---|---|
| Test the shell | `../scripts/in-docker.sh npm run test:electron` in `web-app/` |
| An IPC channel, or how the API process starts, changed | a sensitive change with the `api-surface` lens |

How the project works, its tests and its known gaps: `context/pages/services/electron-shell.md`.
