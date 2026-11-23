---
title: "Electron Shell: Updates, packaging and release"
version: "1.4"
date: 2026-11-13
updated: 2026-11-23
changes: "2026-11-23: the deb updates itself, on Restart to Update only. 2026-11-20: the feed, how Beta picks a release, the AppImage name. Older: the history page"
page_type: service
status: active
description: "Read when a change touches electron-store, electron-updater and the update channel, the electron-builder configuration, or the release workflow."
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

# Electron Shell: Updates, packaging and release

One topic of [[pages/services/electron-shell|Electron Shell]]; the map lists the others.

## Store and auto-update

- `electron-store` holds one key, `updateChannel`, default `'latest'` (`web-app/electron/main.js#const store = new Store({`).
- `electron-updater`: since 2026-11-19 `autoDownload` is false everywhere, so a check only announces a version; `autoInstallOnAppQuit` is true only on the Windows installer and the AppImage. A deb (`resources/package-type`, read once: `web-app/electron/main.js#const PACKAGE_TYPE`) updates itself, but `DebUpdater` runs `dpkg -i` through `pkexec` or `sudo`, which asks for the administrator password, so it installs only on Restart to Update, never on quit (`web-app/electron/shell-helpers.js#function configureAutoUpdate(`); an rpm or unknown package stays blocked. The update found downloads only when the user ticked the agreement, which the shell checks itself, with the version the agreement was given for against the version the check found (`web-app/electron/shell-helpers.js#downloadAgreedUpdate`); it then installs on the next quit (a deb excepted), or at once with Restart to Update. `channel` from the store, run through `normalizeUpdateChannel` with `latest` as the fallback (`web-app/electron/main.js#applyUpdateChannel(autoUpdater, normalizeUpdateChannel(`, `web-app/electron/shell-helpers.js#function normalizeUpdateChannel(channel) {`). The channel is applied at start-up and on every change by `applyUpdateChannel` (`web-app/electron/shell-helpers.js#function applyUpdateChannel(updater, channel) {`), which sets `allowPrerelease` to true on `beta` only and `allowDowngrade` to false after the channel, because the library's channel setter turns downgrades on. With `allowPrerelease` off the GitHub provider asked the latest stable release for `beta.yml` and failed every check; with it on it takes the newest release, beta or stable, and falls back to `latest*.yml`. A beta build whose stored channel is still the default `latest` receives no prerelease until the user chooses Beta. `set-update-channel` accepts exactly `latest` and `beta` (`web-app/electron/main.js#ipcMain.handle('set-update-channel', (event, requested) => {`), the two the UI offers (`web-app/src/app/features/settings/app-update.service.ts#result`).
- Checks: 5 s after launch, then every 4 hours, skipped in dev (`web-app/electron/main.js#const UPDATE_CHECK_INITIAL_DELAY_MS = 5_000;`, `web-app/electron/main.js#function scheduleUpdateChecks() {`). Failures are logged as "offline?" (`web-app/electron/main.js#console.log('[Updater] Auto-check failed (offline?):', err);`).
- Feed: GitHub provider, owner `vitorafgomes`, repo `messaging-explorer`, `releaseType: release` (`web-app/package.json`). Every release carries `latest.yml`, `latest-linux.yml` and `latest-mac.yml`, a beta included (read on the release page on 2026-11-20, six releases). On Beta the updater first asks the release for `beta*.yml`, is answered 404 and falls back to `latest*.yml` ([[pages/decisions/0006-choose-the-version-to-install]]). The upload also takes the `.blockmap` files of the Windows installer and the macOS packages (`.github/workflows/release.yml#web-app/release/*.blockmap`); the AppImage carries its block map inside the file.
- **Beta takes the newest release by date, not the highest version.** With `allowPrerelease` on, the library (electron-updater 6.8.11, `GitHubProvider#getLatestVersion`) takes the first entry of the release feed that is not an alpha. A stable release of an older line published after a newer beta therefore hides that beta from whoever is on an earlier one, until another release is published; the list of versions in Settings still installs it. The rule for publishing: never release a version lower than the newest beta already published.
- **The AppImage is published without the version in its name** (`web-app/package.json#appImage`, since 2026-11-20): the updater renames an AppImage whose file name holds a version to the name of the new one, which broke a launcher pointing at the old file. An older copy is renamed one last time by its next update. Pinned by `web-app/electron/release-workflow.test.js#the AppImage is published under a name without the version, so an update replaces the file the user starts`.
- Not run: a real update on Windows.

## Packaging (`web-app/package.json` `build`)

- App id `com.messagingexplorer.app`, product `Messaging Explorer`, output `release/` (`web-app/package.json`). Files: `dist/web-app/**`, `electron/**` except `electron/**/*.test.js`, `src/assets/**`; assets are `asarUnpack`ed (`web-app/package.json`).
- `extraResources` copies `../src/ServiceBusExplorer.Api/bin/Release/net10.0/publish` to `resources/api` (`web-app/package.json`). That folder comes from `dotnet publish -c Release` with no runtime identifier (`web-app/package.json`) and the csproj sets no `SelfContained` or `RuntimeIdentifier`, so the API is framework-dependent and the user needs the .NET 10 runtime (inferred from the missing settings, not run). One publish output is shared by the arm64 and x64 mac builds.
- Windows: `nsis` and `portable`, `asInvoker` (`web-app/package.json`). macOS: `dmg` and `zip` for arm64 and x64 (`web-app/package.json`). Linux: `AppImage` and `deb` (`web-app/package.json`).
- Scripts use `electron-builder --publish never` (`web-app/package.json`); publishing is done by the workflow, not by the builder.

## Release workflow (`.github/workflows/release.yml`)

- Trigger: Run workflow on `main` (`.github/workflows/release.yml#workflow_dispatch:`), kind release or prerelease, optional version override; or a pushed `v*` tag (`.github/workflows/release.yml#tags: ['v*']`). Other refs fail `check`. Only `vX.Y.Z` and `vX.Y.Z-beta.N`: the updater has no other channel. One run per ref (`.github/workflows/release.yml#concurrency:`).
- Version: `tools/release/next-version.sh` bumps the last `vX.Y.Z` tag from the conventional commits since it (breaking major, `feat` minor, else patch; prerelease `X.Y.Z-beta.N`, `.github/workflows/release.yml#args=(prerelease beta)`) and writes the notes. No commit carries it: each build stamps it into `web-app/package.json` before packaging (`.github/workflows/release.yml#- name: Set the app version`), so electron-builder writes `latest*.yml` or `beta*.yml` with it. `CHANGELOG.md` stops at 2.4.4.
- Token: read-only (`.github/workflows/release.yml#permissions:`); only `publish` writes, creating tag and release on the built commit (`.github/workflows/release.yml#gh release create "$TAG" --target "$GITHUB_SHA"`), a beta as a prerelease. A workflow-token tag starts no other run; a personal-token one would release twice.
- Jobs: `check`, `verify`, `build-linux` (`.github/workflows/release.yml#build-linux:`), `build-windows` (`.github/workflows/release.yml#build-windows:`), `build-mac` (`.github/workflows/release.yml#build-mac:`): .NET 10, Node 22, `npm ci`, stamp, `npm run electron:build:{linux,win,mac}`, `SHA256SUMS-<os>.txt`, upload with `if-no-files-found: error`; then `publish`.
- Signing: none; macOS unsigned (`.github/workflows/release.yml#macOS: dmg + zip (unsigned)`), Windows too.
- Tests: builds need `verify`, the CI workflow on the released commit (`.github/workflows/release.yml#name: CI on the released commit`, `.github/workflows/release.yml#needs: [check, verify]`). `web-app/electron/release-workflow.test.js` pins trigger and version (`web-app/electron/release-workflow.test.js#a release runs by hand from main, as a release or a beta, with the version computed from the commits`), the stamp (`web-app/electron/release-workflow.test.js#every build stamps the computed version into package.json before electron-builder runs`), the token (`web-app/electron/release-workflow.test.js#only the publish job can write, and it creates the tag on the commit it built`) and the prerelease flag (`web-app/electron/release-workflow.test.js#a beta is published as a prerelease, so stable updaters keep reading the latest stable release`); `tools/release/next-version.test.sh` covers the version and notes.

## The versions of a channel (2026-11-16)

The first half of [[pages/decisions/0006-choose-the-version-to-install]]: the list, read only; nothing installs from it yet. The main process asks the release page of this repository, at an address that is a constant (`web-app/electron/shell-helpers.js#RELEASES_API_URL`), with a 15 second limit. `web-app/electron/shell-helpers.js#updateVersions` keeps a release whose tag is `vX.Y.Z` for Stable and `vX.Y.Z-beta.N` for Beta, leaves out a draft, any other tag and anything that is not a release, keeps at most 30 in the order given, and answers for each its version, date, notes (the text of the release, cut at 20000 characters) and whether it is the installed one (`web-app/electron/shell-helpers.test.js#Stable lists the releases that are not betas and Beta lists only the betas, newest first as the release page gives them`, `web-app/electron/shell-helpers.test.js#at most 30 versions are listed and notes longer than 20000 characters are cut`). A list that cannot be read is an error with a fixed sentence, for no answer, a request limit, another status or a body that is not a list, never an empty list (`web-app/electron/shell-helpers.test.js#a release list that cannot be read says why: no answer, a request limit, another status, a body that is not a list`). The request carries no key, so the release page allows 60 an hour per address.

**Installing a picked version (2026-11-16).** `installUpdateVersion` downloads one version the user picked and agreed to (`web-app/electron/shell-helpers.js#installUpdateVersion`). It refuses, before the updater is touched, a text that is not a version, a version outside the last list the main process read, a request without the agreement, the installed version, a package that cannot replace itself and a release with no update file for the platform (`web-app/electron/shell-helpers.js#UPDATE_FEED_FILES`). Before an older version it copies the connections file beside the original, named with the version left (`web-app/electron/shell-helpers.js#backupDataFile`); a copy that fails stops the install. The updater then reads a generic feed built from the fixed repository and the version, with the downgrade allowed for that one download, and is put back in a `finally`. Once a picked version was downloaded the periodic check stands aside until the app restarts (`web-app/electron/main.js#pickedVersionDownloaded`). Pinned by `web-app/electron/shell-helpers.test.js#a version is installed only when it is a version of the last list`. Not run: a real install of an older version; Windows and macOS.

**A picked version is kept (2026-11-16, simpler since 2026-11-19).** Nothing downloads without the agreement, so a picked version is kept like any other; the stored `pickedVersion` is gone. The agreement belongs to its version, and one install runs at a time. A version published before 2026-11-19 still downloads a newer one by itself.
