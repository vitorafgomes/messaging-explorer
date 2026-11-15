---
title: "ADR 0006 - Choose the version to install, per channel"
version: "1.0"
date: 2026-11-15
changes: "Initial ADR draft"
page_type: adr
status: proposed
description: "Settings lists the releases of the chosen channel, Stable or Beta, and installs the one the user picks, older ones included, only on the user's click; the automatic check stays as it is."
supersedes: ""
superseded_by: ""
source:
  - chat
  - web-app/electron/main.js
  - web-app/electron/shell-helpers.js
  - web-app/electron/preload.js
  - .github/workflows/release.yml
reliability: high
---

# ADR 0006 - Choose the version to install, per channel

> Settings lists the releases of the chosen channel and installs the one the user picks, older ones included, only when the user asks; the automatic check stays as it is.

## Status

- [x] Proposed
- [ ] Accepted
- [ ] Deprecated / superseded by

Updated: 2026-11-15.

## Context

The owner tested the first beta made by the release workflow, `v2.4.5-beta.1`, on 2026-11-15, and found three things.

- **Stable says a beta is the newest Stable.** With a beta installed and the channel set to Stable, the updater reads the latest release, 2.4.3, which is lower than the installed version. `applyUpdateChannel` never allows a downgrade (`web-app/electron/shell-helpers.js#function applyUpdateChannel(updater, channel) {`), so the check answers "up to date" and Settings says the installed beta "is the newest version on the Stable channel", which is false.
- **Beta has no feed of its own.** electron-builder writes the update metadata under the channel of the version, but with the GitHub provider it never writes `beta*.yml`; `v2.4.5-beta.1` carries `latest.yml`, `latest-linux.yml` and `latest-mac.yml` only. `electron-updater` 6.8.11 looks for `beta-linux.yml` in the release of the newest tag and, when it is missing, reads `latest-linux.yml` of the same release (`web-app/node_modules/electron-updater/out/providers/GitHubProvider.js`, read on 2026-11-15). The Beta channel therefore works, but by that fallback, and it offers the newest release of either kind. `context/pages/services/electron-shell/updates-packaging-and-release.md` states that both channels' files are uploaded; the release does not show that.
- **No version can be chosen.** The channel is the only choice (`web-app/electron/preload.js` exposes `checkForUpdates`, `downloadUpdate`, `installUpdate`, `setUpdateChannel`, `getUpdateChannel`, `getSelfUpdateBlocker`). The owner asked that Stable show the releases that are not betas, that Beta show only betas, and that a version can be picked and installed. The Settings artboard draws the channel only (`context/prototypes/web-app/Settings.dc.html`).

A version picker of this shape was built on 2026-11-14 in another project of the owner and works: a release list from the GitHub API filtered by channel, and an install that points the updater at the release of the chosen tag.

## Decision

Settings, under Updates, lists the releases of the chosen channel, read by the Electron main process from the public GitHub releases API of `vitorafgomes/messaging-explorer` (at most 30, newest first): Stable lists the releases that are not prereleases, Beta lists only the prereleases (`vX.Y.Z-beta.N`). Each row names the version, its date and whether it is installed, and offers Install. Install points `electron-updater` at that release alone, a generic feed on `https://github.com/vitorafgomes/messaging-explorer/releases/download/<tag>` that reads its `latest*.yml`, allows a downgrade for that one install only, then downloads and installs after the user confirms; afterwards the feed and `allowDowngrade = false` are restored. Where the package cannot update itself (`selfUpdateBlocker`), Install opens the release page of that tag instead. The automatic check, every 4 hours and at launch, stays on the GitHub provider and never downgrades. With a beta installed and Stable chosen, Settings says that the installed version is a beta and offers the newest Stable as an explicit install.

## Consequences

- **Better:** each channel lists what it claims; a user can go back to a known good version; the false "newest on Stable" sentence is gone; the picker does not depend on `beta*.yml`, because it reads the `latest*.yml` every release carries.
- **Worse:** two new IPC channels (`list-update-versions`, `install-update-version`) and a request to the GitHub API from the main process, unauthenticated and limited to 60 requests an hour per address; a list that fails to load must say so, never show an empty list as "no versions".
- **Worse:** a downgrade can meet a `workspace.json` written by a newer version; the confirmation says so before it installs.
- **Neutral but noteworthy:** the release workflow keeps uploading `latest*.yml` for every release, beta or not; the electron-shell page is corrected to say that a beta's feed is named `latest*.yml` and that the Beta channel reads it through the fallback.

## Alternatives considered

- **Make electron-builder write `beta*.yml`** (rename or copy the files in the release workflow) - fixes the name of the feed but not the listing nor the choice of a version, and the picker would still need its own feed per tag.
- **A list from `latest*.yml` only** - the feed names one version per channel; it cannot list older ones.
- **The renderer calls the GitHub API** - the renderer reaches only the local API through `ApiService`; a request to the internet belongs to the main process, behind a fixed URL.
- **Status quo** - keeps the false Stable sentence and gives no way back from a bad beta.

## Enforcement

- **IPC input:** `install-update-version` accepts only a tag that matches `^v\d+\.\d+\.\d+(-beta\.\d+)?$` and was in the last list the main process read; the URL is built from fixed owner and repo, never from text the renderer sends. A test in `web-app/electron/shell-helpers.test.js` refuses any other tag, and a test where the GitHub request fails asserts what Settings shows.
- **Restore after install:** a test asserts that the feed and `allowDowngrade = false` return after an install that succeeds and after one that fails.
- **Review:** the change is Sensitive under the pipeline (`api-surface` for the IPC channels and the external call); [[pages/decisions/0005-cite-code-by-name-and-prove-in-proportion-to-risk]] sets its proof.

## Related

- Services affected: [[pages/services/electron-shell]], [[pages/services/web-app]]
- Related: [[pages/services/electron-shell/updates-packaging-and-release]], [[pages/services/web-app/features-settings-and-folders]]

## Notes

Recorded from the owner's test of `v2.4.5-beta.1` on 2026-11-15, the first release made by hand from main with the version computed from the commits.
