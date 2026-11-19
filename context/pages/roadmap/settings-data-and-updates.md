---
title: "Settings: a version picker in Updates and a Monitoring history in Data"
version: "1.0"
date: 2026-11-16
changes: "Initial plan page"
page_type: roadmap
status: active
description: "The plan for two things the owner asked for on 2026-11-16: choosing which version to install, with its notes and an explicit agreement, and an optional history behind Monitoring, kept for a period the user sets. What exists, what to build per layer, the order, and the decisions still open."
updated: 2026-11-16
source:
  - chat
  - "web-app/electron/main.js"
  - "web-app/src/app/features/settings/"
  - "context/prototypes/web-app/Settings.dc.html"
  - "context/prototypes/web-app/Monitoring.dc.html"
reliability: medium
---

# Settings: a version picker in Updates and a Monitoring history in Data

> Asked by the owner on 2026-11-16, and drawn first as an exploration on the project's own Settings and Monitoring artboards, which the owner approved before this page was written. The version picker was already decided on 2026-11-15 in [[pages/decisions/0006-choose-the-version-to-install]], proposed and not built; Part A below follows it and adds only what the owner asked on 2026-11-16, recorded there as an amendment. Nothing here is built. The parts of the code named below were read on that day; the behaviour of the update library with an older release was not run.

## What the owner asked for, in the owner's words

1. In Updates, on Stable and on Beta alike, an option to pick other versions and install an older one or the current one.
2. Nothing installs directly: the app shows everything the picked version has and installs only with the user's agreement; without it, it only shows what the version has.
3. Monitoring shows the total of items processed, with charts.
4. How long that data is kept is a setting; the user has to allow it; without a longer period it is cleared at the period the user sets.
5. The setting sits inside Data, which is already inside Settings, and it is off by default.

## Part A: the version picker

### What exists

- The shell checks one feed per channel and reports `available`, `downloading`, `ready` or `error` to the screen (`web-app/electron/main.js#autoUpdater.on('update-available'`), with a channel kept in the settings store (`web-app/electron/main.js#ipcMain.handle('set-update-channel'`).
- A newer version downloads in the background and installs on the next quit, since the owner asked for automatic updates on 2026-11-13 ([[pages/roadmap/followups]]).
- Some packages cannot update themselves, and the shell says which (`web-app/electron/main.js#ipcMain.handle('get-self-update-blocker'`).

### What to build

| Layer | What |
|---|---|
| Shell | List the releases of the channel shown, as ADR 0006 decides: at most 30, newest first; Stable lists the releases that are not pre-releases, Beta lists only the pre-releases. Each entry carries the version, the date, the text of its notes and whether this platform has a package in it. The notes are what 2026-11-16 adds. |
| Shell | Install a picked version, as ADR 0006 decides: only a tag of the release form that was in the last list the shell read, the address built from the fixed owner and repository; the downgrade is allowed for that one install and refused again after it, whether it succeeded or failed. |
| Shell | Before an older version installs, copy the connections file beside the original, named with the version left. |
| Shell | The automatic check stays as it is, as ADR 0006 decides. Since 2026-11-19 the check only announces a version: it downloads when the user ticks the agreement, as [[pages/services/electron-shell/updates-packaging-and-release]] says. |
| Web app | The Version rows, the notes of the picked version, the agreement box and Install, as the artboard draws them. The installed version shows its notes and nothing to install. A package that cannot update itself shows the notes and the link to the release page. |

### What must hold

- **The notes are text from outside the app.** They are shown as text, never as markup, and a link in them is never followed by the app.
- **The screen never names an address.** The shell installs by a version number it listed; an IPC call with anything else is refused. This is a new IPC surface: the `api-surface` lens and the electron-shell rules apply ([[pages/invariants/local-authenticated-api]]).
- **One test where the listing fails**: the releases cannot be read (no network, a rate limit, a body that is not what was expected) and the screen says so, with the installed version still shown.
- **A release without the update files** of this platform is listed with its notes and cannot be installed from the app; the screen says why.

### Not known yet

- Whether the update library installs an older release cleanly on each platform. It has to be tried on a real installed build before the screen offers it; if it does not work on a platform, that platform gets the notes and the release page only.

## Part B: the Monitoring history

### What exists

- Monitoring reads count snapshots from the API and charts the totals of the last 20 polls; the API keeps them in memory and they are gone when the app closes ([[pages/services/web-app/features-monitoring]]).
- Nothing records what the app itself did, and nothing reads how many messages a broker processed.

### What "processed" means here

A count is what waits now; it rises and falls with what arrives and what leaves, so the difference between two counts is never shown as "processed". Two real sources, never mixed on screen:

| Source | What it gives | Where |
|---|---|---|
| The broker | RabbitMQ counts published, delivered and acknowledged messages per queue, with a rate, in its management API. Azure Service Bus gives the same through Azure Monitor, which a connection does not carry today; without it, and on the emulator, the card says the broker does not give it. | Read with the monitoring poll |
| This app | Each resubmit, delete, move, purge and send the app ran: kind, entity, how many, what was left behind, how long. | Recorded where the API answers the operation |

### What to build

| Layer | What |
|---|---|
| Core | A history store behind one interface: append an operation, append a count reading, read a period, delete older than a date, delete all, report its size and its oldest record. |
| Core | The setting, off by default, with the period to keep (1, 7, 30 or 90 days), stored with the app's other data. |
| Api | Record an operation after each batch route answers; record the totals of each monitoring poll; routes to read the history, to read and change the setting, and to delete the history. |
| Api | Delete what is older than the period when the API starts and once an hour. Turning the setting off deletes the history. Clear all data deletes it too. |
| Core | RabbitMQ: read the per-queue message statistics the management API already returns. A capability says whether a provider gives processed counts. |
| Web app | Settings, Data: the Monitoring history block as the artboard draws it. Monitoring: the Processed section, the chart per hour and the table of what the app did. |

### What must hold

- **Off until the user turns it on.** With it off nothing is written and Monitoring covers only the session.
- **Never a message body, a message property, a connection string, a password or a key.** One test writes an operation whose inputs carry a sentinel in each of those and asserts the stored record holds none ([[pages/invariants/secrets-masked-at-the-api-boundary]]).
- **Names are stored, and the screen says so.** The names of connections and entities can describe a customer's environment; they are kept for the period and no longer.
- **Recording never changes an operation.** A history write that fails is logged and the operation's answer is unchanged; one test where the store fails.
- **The store is bounded.** By the period, and by a ceiling on its size for a period that would outgrow it.

## Order

Each row is one lane and one pull request. The artboards are the spec, so they come first.

| # | What | Size |
|---|---|---|
| 1 | The two official artboards, `Settings.dc.html` and `Monitoring.dc.html`, take the approved drawing. Done 2026-11-16: every new part is marked "Design, not built", and the second row of the canvas moved down for the taller Settings | S |
| 2 | The history setting and the store, with its bound and its deletion; Settings, Data shows it | M |
| 3 | The record of what the app did, and the table on Monitoring | M |
| 4 | RabbitMQ processed counts and the two Processed cards | M |
| 5 | The chart per hour and the kept count readings | M |
| 6 | The version list and the notes of a picked version, read only. Done 2026-11-16 | M |
| 7 | Install of a picked version with the agreement. Built 2026-11-16 and proven by tests; the owner installed an older version on Linux on 2026-11-16 and it worked; a picked version is kept afterwards; Windows and macOS are unverified | M |

## Open questions for the owner

1. **Automatic updates.** ADR 0006 keeps the automatic check, and since 2026-11-13 a newer version downloads by itself and installs on quit. The owner asked on 2026-11-16 that nothing installs without the user's agreement after reading what the version has. Does that hold for the newest version found by the automatic check too, or only for a version picked from the list? **Answered on 2026-11-19: for both; built the same day.**
2. **Where the history is kept.** A SQLite file is the recommendation: it serves the charts and a period of months, and it is one new dependency in the packaged API. The alternative is a text file with one line per record, with no dependency and poor for charts.
3. **The periods.** 1, 7, 30 and 90 days, as drawn?
4. **Clear all data** also deletes the history, as drawn?
5. **An older version and the connections file.** Copy the file beside the original before the install, as drawn?
6. **Azure Monitor.** Processed counts for Azure Service Bus need the subscription and the resource group on the connection. In this plan or after it?
