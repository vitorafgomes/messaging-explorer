---
title: "Electron Shell: Updates, packaging and release"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Electron Shell service page"
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
- `electron-updater`: `autoDownload = false`, `autoInstallOnAppQuit = true`, `channel` from the store, run through `normalizeUpdateChannel` with `latest` as the fallback (`web-app/electron/main.js#autoUpdater.autoDownload = false;`, `web-app/electron/main.js#applyUpdateChannel(autoUpdater, normalizeUpdateChannel(store.get('updateChannel'`, `web-app/electron/shell-helpers.js#function normalizeUpdateChannel(channel) {`). The channel is applied at start-up and on every change by `applyUpdateChannel` (`web-app/electron/shell-helpers.js#function applyUpdateChannel(updater, channel) {`), which sets `allowPrerelease` to true on `beta` only and `allowDowngrade` to false after the channel, because the library's channel setter turns downgrades on. With `allowPrerelease` off the GitHub provider asked the latest stable release for `beta.yml` and failed every check; with it on it takes the newest release, beta or stable, and falls back to `latest*.yml`. A beta build whose stored channel is still the default `latest` receives no prerelease until the user chooses Beta. `set-update-channel` accepts exactly `latest` and `beta` (`web-app/electron/main.js#ipcMain.handle('set-update-channel', (event, requested) => {`), the two the UI offers (`web-app/src/app/features/settings/app-update.service.ts#result`).
- Checks: 5 s after launch, then every 4 hours, skipped in dev (`web-app/electron/main.js#const UPDATE_CHECK_INITIAL_DELAY_MS = 5_000;`, `web-app/electron/main.js#function scheduleUpdateChecks() {`). Failures are logged as "offline?" (`web-app/electron/main.js#console.log('[Updater] Auto-check failed (offline?):', err.message);`).
- Feed: GitHub provider, owner `vitorafgomes`, repo `messaging-explorer`, `releaseType: release` (`web-app/package.json`). The release job uploads the updater metadata of both channels, `latest*.yml` and `beta*.yml` (`.github/workflows/release.yml#web-app/release/*-linux.yml`, `.github/workflows/release.yml#web-app/release/latest.yml`, `.github/workflows/release.yml#web-app/release/*-mac.yml`), and the `.blockmap` files of the Windows installer and the macOS packages for differential downloads (`.github/workflows/release.yml#web-app/release/*.blockmap`); the AppImage carries its block map inside the file. electron-builder writes only the file of the version's own channel for the GitHub provider, so a `-beta` version yields `beta*.yml`. No beta release has been published yet, so the path is covered by tests and by reading the library, not by a real update.

## Packaging (`web-app/package.json` `build`)

- App id `com.messagingexplorer.app`, product `Messaging Explorer`, output `release/` (`web-app/package.json`). Files: `dist/web-app/**`, `electron/**` except `electron/**/*.test.js`, `src/assets/**`; assets are `asarUnpack`ed (`web-app/package.json`).
- `extraResources` copies `../src/ServiceBusExplorer.Api/bin/Release/net10.0/publish` to `resources/api` (`web-app/package.json`). That folder comes from `dotnet publish -c Release` with no runtime identifier (`web-app/package.json`) and the csproj sets no `SelfContained` or `RuntimeIdentifier`, so the API is framework-dependent and the user needs the .NET 10 runtime (inferred from the missing settings, not run). One publish output is shared by the arm64 and x64 mac builds.
- Windows: `nsis` and `portable`, `asInvoker` (`web-app/package.json`). macOS: `dmg` and `zip` for arm64 and x64 (`web-app/package.json`). Linux: `AppImage` and `deb` (`web-app/package.json`).
- Scripts use `electron-builder --publish never` (`web-app/package.json`); publishing is done by the workflow, not by the builder.

## Release workflow (`.github/workflows/release.yml`)

- Trigger: push of a tag matching `v*` only (`.github/workflows/release.yml`). One release per tag at a time (`.github/workflows/release.yml#concurrency:`). `contents: write` (`.github/workflows/release.yml#permissions:`).
- Jobs: `build-linux` on ubuntu-latest (`.github/workflows/release.yml#build-linux:`), `build-windows` on windows-latest (`.github/workflows/release.yml#build-windows:`), `build-mac` on macos-latest (`.github/workflows/release.yml#build-mac:`); each sets up .NET 10 and Node 22, runs `npm ci` and `npm run electron:build:{linux,win,mac}`, and uploads artifacts with `if-no-files-found: error`. `release` needs all three, downloads them and calls `softprops/action-gh-release@v2` with generated notes; `prerelease` is true when the tag contains `-beta` (`.github/workflows/release.yml#release:`, `.github/workflows/release.yml#uses: softprops/action-gh-release@v2`, `.github/workflows/release.yml#prerelease: ${{ contains(github.ref_name, '-beta') }}`).
- Signing: none. No certificate, `CSC_*` or notarization settings exist in the workflow or in `package.json`; the workflow header says macOS is unsigned (`.github/workflows/release.yml#macOS: dmg + zip (unsigned)`). Windows output is unsigned as well (nothing configures it). Since 2026-11-12 the `verify-version` job fails the run when the tag is not `v` plus the `package.json` version (`.github/workflows/release.yml#- name: Compare tag and package.json`).
- Tests: since 2026-11-12 every build job needs `verify`, which calls the CI workflow on the tagged commit (`.github/workflows/release.yml#name: CI on the tagged commit`, `.github/workflows/release.yml#needs: [verify, verify-version]`), so a tag on a commit with a failing test packages nothing. CI does not build the Electron app (`.github/workflows/ci.yml## Angular / web app — install, test, build`), and nothing starts a packaged app.
