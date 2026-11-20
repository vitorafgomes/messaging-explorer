---
title: "Web App: Tests"
version: "1.0"
date: 2026-11-13
updated: 2026-11-20
changes: "v1.0: split out of the Web App service page"
page_type: service
status: active
description: "Read when a change touches a spec, how the web tests run, the end-to-end suite, or the web job of CI."
source:
  - web-app/package.json
  - web-app/angular.json
  - web-app/e2e/
  - .github/workflows/ci.yml
reliability: high
---

# Web App: Tests

One topic of [[pages/services/web-app|Web App]]; the map lists the others.

## Tests

- 59 `*.spec.ts` files exist under `web-app/src` (2026-11-13, after the Settings screen): 1021 tests pass and 8 are skipped.
- 2026-11-19, after the MCP server group of Settings: 88 spec files, 1587 tests pass and 8 are skipped. A spec of a component that holds a secret shown once spies on every `console` method and reads every `localStorage` and `sessionStorage` entry for it (`web-app/src/app/features/settings/settings-mcp.component.spec.ts#creating a token shows it once with Copy and the sentence, puts it in the configuration, and writes it to no storage and no console`).
- 2026-11-20, after phase two of the MCP server in the app: 89 spec files, 1621 tests pass and 8 are skipped. A spec of a polling loop runs under `vi.useFakeTimers()` and counts the calls after `fixture.destroy()` (`web-app/src/app/app.spec.ts#the polling stops when the app is destroyed`); a spec of a Material dialog queries `document`, not the fixture, and closes every dialog and the overlay container after each test (`web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#McpRequestDialogComponent: the window that asks the user, as Settings.dc.html draws mcp.ask`).
- 2026-11-20, after phase three of the MCP server in the app (moving and removing): 89 spec files, 1652 tests pass and 8 are skipped. A spec of a field typed before an action sets the input's `value` and dispatches `input`, the event typing and pasting both fire, and asserts both `disabled` and `aria-disabled` of the button, because the component also refuses in code and a click on a button that is not disabled would prove nothing (`web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#the allow button disabled and aria-disabled until the word is typed exactly`).
- 2026-11-20, after phase 3b of the MCP server in the app (the entity kinds, the Entities block and the confirmation of `all` with entities): 89 spec files, 1657 tests pass and 8 are skipped. A kind the dialog allows is proven by removing it from `web-app/src/app/features/settings/mcp-request-dialog.component.ts#KNOWN_KINDS` and seeing its spec fail (`web-app/src/app/features/settings/mcp-request-dialog.component.spec.ts#phase 3b: the entity kind`).
- 2026-11-20, after the quit question and the panel of a picked version: 90 spec files, 1682 tests pass and 8 are skipped. The count sent to the shell is read from the calls of a `setActiveRuns` spy, the first one included (`web-app/src/app/app.spec.ts#tells the shell how many resubmits run when one starts and when it ends, so quitting can ask first`).
- 2026-11-20, after the settings of the app an assistant may change: 90 spec files, 1671 tests pass and 8 are skipped. A spec of a service that calls the API through `ApiService` uses the real `ApiService` with `provideHttpClientTesting()` and ends with `HttpTestingController.verify()`, so a call the fixed list should have stopped would show as an unexpected request (`web-app/src/app/features/settings/mcp-app-settings.service.spec.ts#nothing in this path reaches the MCP group, clearing the data or an update: any other setting, or a value off the list, is answered failed and changes nothing`).
- `web-app/scripts/generate-icons.js` sets a non-zero exit code when generation fails (`web-app/scripts/generate-icons.js#generateIcons().catch((error) => {`), tested with a stubbed `sharp` by `web-app/scripts/generate-icons.test.js#a failed icon generation exits with a non-zero status`. No npm script and no CI job runs that test: `test:electron` globs `electron/**` only (`web-app/package.json`); run it with `node --test scripts/generate-icons.test.js` in `web-app/`.
- `npm test` is `ng test` (`web-app/package.json`). `angular.json` sets the `@angular/build:unit-test` builder with no `runner` option (`web-app/angular.json`); the builder schema defaults `runner` to `vitest`, `runnerConfig` to `false` and `include` to `**/*.spec.ts` (`web-app/node_modules/@angular/build/src/builders/unit-test/schema.json`). Run on 2026-11-12, after the sub-queue and cancel-scheduled changes, `npm test -- --watch=false` executes all 45 files: 827 tests pass and 8 are skipped (three `describe.skip` blocks for the refresh variants in `web-app/src/app/core/services/metrics.service.spec.ts#getQueueMetricsWithRefresh`).
- Plain `npx vitest` is not a way to run these tests: without the Angular builder there is no compiler, so components with signal inputs or `templateUrl` fail. A `vitest.config.ts` that listed 11 files for that mode was removed on 2026-11-12; the builder never read it.
- **End-to-end tests** (2026-11-13), in `web-app/e2e/`, run with `npx playwright test -c e2e` in `web-app/`. They drive the production build in Chromium against the real API and RabbitMQ and the Service Bus emulator in containers the run starts. They save every screen they reach in light and dark under `web-app/dist/e2e/screenshots/`.
  - They run the Electron renderer path in a browser. The page gets the two preload members `ApiService` reads, `getApiPort` and `getApiSecret` (`web-app/e2e/fixtures.ts#test`), so the key is attached by `ApiService` as in the desktop app, and routing is by hash.
  - Browser mode without a key stays unreachable by design ([[pages/invariants/local-authenticated-api]]). Neither `ApiService` nor the API changed for the tests.
  - How they run, the flows, the defects they pin as expected failures, and what they do not cover are on [[pages/conventions/testing]].
- CI: the web job runs `npm ci`, the tests and `npm run build` (`.github/workflows/ci.yml#cache: 'npm'`, `.github/workflows/ci.yml`, `.github/workflows/ci.yml#working-directory: web-app`). No lint step; `web-app/package.json` has no `lint` script. See [[pages/conventions/testing]].
