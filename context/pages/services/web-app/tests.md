---
title: "Web App: Tests"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
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
- `web-app/scripts/generate-icons.js` sets a non-zero exit code when generation fails (`web-app/scripts/generate-icons.js#generateIcons().catch((error) => {`), tested with a stubbed `sharp` by `web-app/scripts/generate-icons.test.js#a failed icon generation exits with a non-zero status`. No npm script and no CI job runs that test: `test:electron` globs `electron/**` only (`web-app/package.json`); run it with `node --test scripts/generate-icons.test.js` in `web-app/`.
- `npm test` is `ng test` (`web-app/package.json`). `angular.json` sets the `@angular/build:unit-test` builder with no `runner` option (`web-app/angular.json`); the builder schema defaults `runner` to `vitest`, `runnerConfig` to `false` and `include` to `**/*.spec.ts` (`web-app/node_modules/@angular/build/src/builders/unit-test/schema.json`). Run on 2026-11-12, after the sub-queue and cancel-scheduled changes, `npm test -- --watch=false` executes all 45 files: 827 tests pass and 8 are skipped (three `describe.skip` blocks for the refresh variants in `web-app/src/app/core/services/metrics.service.spec.ts#getQueueMetricsWithRefresh`).
- Plain `npx vitest` is not a way to run these tests: without the Angular builder there is no compiler, so components with signal inputs or `templateUrl` fail. A `vitest.config.ts` that listed 11 files for that mode was removed on 2026-11-12; the builder never read it.
- **End-to-end tests** (2026-11-13), in `web-app/e2e/`, run with `npx playwright test -c e2e` in `web-app/`. They drive the production build in Chromium against the real API and RabbitMQ and the Service Bus emulator in containers the run starts. They save every screen they reach in light and dark under `web-app/dist/e2e/screenshots/`.
  - They run the Electron renderer path in a browser. The page gets the two preload members `ApiService` reads, `getApiPort` and `getApiSecret` (`web-app/e2e/fixtures.ts#test`), so the key is attached by `ApiService` as in the desktop app, and routing is by hash.
  - Browser mode without a key stays unreachable by design ([[pages/invariants/local-authenticated-api]]). Neither `ApiService` nor the API changed for the tests.
  - How they run, the flows, the defects they pin as expected failures, and what they do not cover are on [[pages/conventions/testing]].
- CI: the web job runs `npm ci`, the tests and `npm run build` (`.github/workflows/ci.yml#cache: 'npm'`, `.github/workflows/ci.yml`, `.github/workflows/ci.yml#working-directory: web-app`). No lint step; `web-app/package.json` has no `lint` script. See [[pages/conventions/testing]].
