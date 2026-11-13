---
paths:
  - "web-app/src/**"
  - "web-app/e2e/**"
  - "web-app/angular.json"
  - "web-app/package.json"
---

# The web app

Owns all presentation and client-side state: connection management, the entity tree, message browsing, send, import, export, diff, bulk dialogs, monitoring charts, templates, theme, filters. Does not own persistence of connections or any broker access; that is the API (`context/pages/services/api.md`) and the Core library (`context/pages/services/core.md`). Does not own process management, tray, menu or updates; that is `context/pages/services/electron-shell.md`.

## Rules this project must keep

- **Every HTTP call goes through `ApiService`.** It is what attaches the `X-Api-Key`; a call that
  bypasses it carries no key.
- **A secret arrives masked and stays masked.** The app never shows, stores or logs an unmasked
  connection string, password or client secret.
- **A bulk operation tells the user what happened to each message,** and says that operations are
  at-least-once. A possible duplicate is shown as one, never hidden.
- **What a provider cannot do is read from its capabilities,** never guessed from its name.
- **A screen follows `context/pages/conventions/ui.md`:** no new Bootstrap class, Font Awesome icon
  or literal colour; a destructive action never sits beside a routine one; an icon button has a
  name; an error is shown as an error, not as an empty list.
- **An IPC channel, or a change to how the API process is started, is a sensitive change** with
  the `api-surface` lens (`reference/sensitive.md` of the pipeline skill).
- Each rule in full, with the code and tests that keep it: `context/pages/services/web-app/how-the-rules-are-kept.md`.
- A gap written on `context/pages/services/web-app/known-gaps.md` may stay as it was found.
  A change never adds a gap and never widens one.

## Read before you change

- `context/pages/invariants/local-authenticated-api.md` - the `X-Api-Key` contract `ApiService` must keep honouring.
- `context/pages/invariants/secrets-masked-at-the-api-boundary.md` - the UI only ever receives masked connection strings and passwords.
- `context/pages/invariants/provider-boundaries.md` - what may be provider-specific and where.
- `context/pages/invariants/bulk-operations-are-at-least-once.md` - what cancel and retry mean for the bulk dialogs.
- `context/pages/services/electron-shell/ipc-and-tray.md` - owns `window.electronAPI`, the only source of the API port and secret.
- `context/pages/services/api.md` and `context/pages/services/core.md` - the contract this app mirrors.
- `context/pages/conventions/testing.md` and `context/pages/conventions/tooling.md` - how tests and builds are run.

## Commands, in `web-app/`

| To | Run |
|---|---|
| Test | `../tools/checks/in-docker.sh npm test -- --watch=false`. It runs vitest through the Angular builder; plain `npx vitest` has no Angular compiler and fails sound tests |
| Test the shell | `../tools/checks/in-docker.sh npm run test:electron` |
| Build | `npm run build` |
| End-to-end, once at the end of a lane with a visible change | `npx playwright test -c e2e`, on the machine: it starts the API and brokers |

The only skipped tests allowed are the 8 in `metrics.service.spec.ts`.

## Tools for Angular work

| For | Use |
|---|---|
| What Angular recommends for this version, its documentation, examples | The Angular CLI's own server, `angular-cli`: `get_best_practices`, `search_documentation`, `find_examples`, `list_projects`. Ask it before writing Angular code from memory: the framework changes between versions |
| Where a symbol is used, a rename, inspections in TypeScript | The WebStorm server, when WebStorm is open on the project |
| Seeing the change in the running app | The `run` skill |
| Building what an artboard draws | `reference/prototype.md` of the pipeline skill; the artboards are under `context/prototypes/web-app/` |

## What to read for a change

Read the one row your change matches. Pages are under `context/pages/services/web-app/`; the map, `context/pages/services/web-app.md`, lists them all. The Electron shell has its own rules file.

| If the change touches | Read |
|---|---|
| `ApiService`, `apiPath`, `HighlightPipe` | `how-the-rules-are-kept.md` |
| A package, the build, bootstrap, routes, the toolbar, `core/` | `stack-and-bootstrap.md` |
| Delete, resubmit, move or send in the messages dialog | `bulk-operations.md` |
| The automatic resubmit of a dead-letter queue | `bulk-automatic-resubmit.md` |
| The entity form, sub-queue tabs, scheduled messages, sessions | `features-messages-and-sessions.md` |
| The entity panel, the tree, definitions, the purge confirmation | `features-entities-panel-and-definitions.md` |
| Settings, or a list page under `features/` | `features-settings-and-folders.md` |
| The Monitoring screen | `features-monitoring.md` |
| The provider registry, capabilities, `shared/` | `providers-and-shared.md` |
| A spec or an end-to-end test | `tests.md` |
