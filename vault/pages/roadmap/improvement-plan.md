---
title: "Improvement plan"
version: "1.0"
date: 2026-11-12
changes: "Initial plan, from the founding survey, a dependency audit and a read of the release workflow on 2026-11-12"
page_type: roadmap
status: active
description: "The order of work to make Messaging Explorer safe to point at a production broker and trustworthy to ship on Windows, macOS and Linux: seven phases, each with its scope and the observable result that closes it."
updated: 2026-11-12
source:
  - "vault/pages/roadmap/followups.md"
  - "vault/pages/services/"
  - ".github/workflows/release.yml"
  - "web-app/package.json"
  - chat
reliability: medium
---

# Improvement plan

> When this is done, a release is a commit that passed its tests on three operating systems, the app starts on a machine with nothing preinstalled, no bulk operation on either broker can lose a message without saying so, and no secret leaves the backend unmasked.

This page is the order. The findings and their citations stay where they are: "Known gaps" on each service page and [[pages/roadmap/followups]]. A phase that ships removes its entries there.

> **2026-11-12, later the same day:** a line-by-line audit found far more than the founding survey ([[pages/roadmap/code-audit-2026-11]]). Its "Where to start" list comes before phases 4 to 6 below, and it settles the RabbitMQ question of Phase 2: turn the bulk operations off, then rebuild them over AMQP.

## Why now

The founding survey of 2026-11-12 read the whole repo for the first time against written rules. It found that the three things root `CLAUDE.md` calls never "harden later" are each breached somewhere, that the gates cannot see most of it (CI runs no web test, most controllers and one whole provider have no tests), and that the release packages whatever commit is tagged without running a test. The tool is public and its users point it at production.

## Scope

- **In scope:** the defects and gaps on [[pages/roadmap/followups]], the release pipeline, dependency health, the test and build gates, the structure of the largest files where it blocks testing.
- **Out of scope:** new product features (a third provider, Azure sign-in with resource discovery, new screens). A feature that arrives meanwhile goes through the pipeline on its own and does not reorder this plan. Encrypting `workspace.json` and code signing are listed, but each waits for an owner decision.

## Target outcome

No dates are set; the owner sets them. The plan is done when each phase's success criteria below can be observed.

## Status

- **As of 2026-11-12:** nothing started. The working tree holds the owner's uncommitted work on `fix/dlq-bulk-operations` plus the uncommitted harness and vault.
- **Next milestone:** Phase 0.
- **Blocker:** the open branch. Every phase below edits files that branch touches (`AzureServiceBusProvider.cs`, `view-messages-dialog.component.ts`, `api.service.ts`, `package.json`); it lands first.

## Phases

The order is by what each phase makes possible, not only by risk: Phase 1 comes before the fixes because a fix whose test cannot run is not proven.

### Phase 0 - Land what is open
- **Status:** not started
- **Scope:** the owner's DLQ bulk-operations branch as its own PR; the harness and vault as a separate `chore/` PR. The untracked `metrics-dashboard.component.ts` goes with whichever change owns it.
- **Success criteria:** `main` holds both; a fresh clone runs the nine harness self-tests green in CI.

### Phase 1 - Gates that tell the truth
- **Status:** in progress
- **Scope:**
  1. Done 2026-11-12: the web suite was never red. The founding ran plain `npx vitest`, which has no Angular compiler; `npm test -- --watch=false` runs all 21 files, 519 passing and 8 skipped. The gate now uses it and the unused `vitest.config.ts` was removed.
  2. Un-skip the 8 refresh tests in `metrics.service.spec.ts` or delete them with the reason.
  3. Done 2026-11-12: CI runs the web tests. Open: CI runs the .NET tests per project and on `ubuntu`, `windows` and `macos`.
  4. `Directory.Build.props` with warnings as errors, a `global.json`, an `.editorconfig`; fix what surfaces. A lint and a format script for `web-app`.
- **Success criteria:** every spec file runs and passes; CI fails on a red web test, on a compiler warning and on a failing test on any of the three systems; `followups.md` loses its "The gates themselves" entries except tests-missing.
- **Notes:** item 4 changes the product build and may surface many warnings; it is its own PR.

### Phase 2 - Stop losing messages and leaking secrets
- **Status:** in progress (items 2 to 5 done 2026-11-12, review pending; items 1 and 6 open)
- **Scope:** the P1 list of [[pages/roadmap/followups]], one PR per entry, each starting with the failing test.
  1. RabbitMQ bulk delete, resubmit and move: publish before the destructive consume, report per message, honour the token. Needs a decision first on what the management API allows; if it cannot be made safe, the capability is turned off for RabbitMQ and the UI hides it.
  2. The save-connection response returns the masked object.
  3. Saving an existing connection persists every field, RabbitMQ ones included.
  4. `workspace.json`: an unreadable file is an error, never an empty workspace; the write is atomic (temp file and rename); reads take the lock.
  5. Importing a masked export never stores the mask as a secret.
  6. Azure: a send that fails partway through a cycle reports the messages already sent as possible duplicates; the single resubmit reports when it cannot remove the original.
- **Success criteria:** each entry has a test that fails on today's code; the invariant pages [[pages/invariants/bulk-operations-are-at-least-once]] and [[pages/invariants/secrets-masked-at-the-api-boundary]] list no known exception except storage at rest.
- **Lenses:** `message-safety` and `secrets`, on opus.

### Phase 3 - A release that works on three systems
- **Status:** in progress (item 1 and the helper-level part of item 4 done 2026-11-12)
- **Scope:**
  1. Done 2026-11-12: `release.yml` runs the CI workflow before packaging and fails when the tag and the `package.json` version differ. Not yet exercised by a real tag.
  2. The API is published self-contained per runtime identifier (`win-x64`, `linux-x64`, `osx-arm64`, `osx-x64`), and each package gets its own. Today one framework-dependent publish is shared, so the user needs the .NET 10 runtime, and the macOS x64 package most likely carries an arm64 executable; both were inferred from the configuration and must be confirmed on a real build first.
  3. A smoke test per system after packaging: start the packaged app, wait for `/health`, check the window, quit.
  4. The shell waits for `/health` before it shows the window, shows an error when the API does not start or exits, and the kill fallback can fire.
  5. The beta channel: confirm which update manifests the builder writes and upload them.
  6. Actions pinned by commit; Dependabot for actions.
- **Success criteria:** a tag on a red commit publishes nothing; the three smoke tests pass in the workflow; a clean virtual machine of each system with no .NET installed starts the app and connects.
- **Owner decision:** code signing and notarization (a Windows certificate, an Apple Developer account). Until then macOS auto-update is assumed not to work and the site should say the builds are unsigned.

### Phase 4 - Dependencies
- **Status:** not started
- **Scope:** `npm audit` on 2026-11-12 reports 79 advisories (5 critical, 41 high); 20 remain with `--omit=dev` (11 high, none critical), among them `@angular/common`, `@angular/compiler`, `@angular/core`, `@angular/router` and `electron-updater`, all with a fix available. The five critical ones are in development tooling (`concurrently` and transitive packages). .NET: no vulnerable package; outdated ones include `RabbitMQ.Client` 6.8.1 (7.x is a breaking API), `Azure.Identity` 1.13.1 and the test stack (xunit 2.6.2, Test SDK 17.8.0). **Done on 2026-11-12 for everything inside the current majors:** npm went from 79 to 25 advisories (20 to 2 with `--omit=dev`), Angular to 21.2.26, Electron to 41.10.7, the Azure SDKs and the test stack to their newest minor; what is left, Electron 42 first, is on [[pages/roadmap/followups]].
  1. Angular patch line and `electron-updater` first: they ship to users.
  2. Development tooling next.
  3. .NET minor updates in one PR; `RabbitMQ.Client` 7 is a migration of its own and waits for Phase 2 item 1 and for RabbitMQ tests.
  4. Dependabot for npm and NuGet, grouped, weekly; `npm audit --omit=dev` at high as a CI step.
- **Success criteria:** `npm audit --omit=dev` reports no high or critical; CI fails when one appears.
- **Notes:** after Phase 1, so an update that breaks something is caught by tests that run.

### Phase 5 - API boundary and lifecycle
- **Status:** not started
- **Scope:** the two P2 lists of [[pages/roadmap/followups]].
  1. Done 2026-11-12: one exception handler, one error body shape, no exception message to the client.
  2. Done 2026-11-12 for a foreign `Host` and the missing `API_SECRET`. Open: the binding the shell actually uses.
  3. The active provider held by a service with a lease, not a static field on a controller; the monitoring service takes its provider from it.
  4. Done 2026-11-12 for `clear-all` (it resets through the workspace manager, under its lock, atomically, and works on an unreadable file). Open: `import-full`.
  5. Electron: `openExternal` limited to `https`, a CSP on the packaged window, a validated update channel, no emoji in logs.
  6. The web app tells the user when it has no API secret; after a cancelled bulk operation the list reloads.
- **Success criteria:** [[pages/invariants/local-authenticated-api]] lists no known exception except the `null` origin, which is explained.
- **Lens:** `api-surface`, on opus.

### Phase 6 - Tests where there are none, then structure
- **Status:** not started
- **Scope:**
  1. Tests first: `QueuesController`, `TopicsController`, `SessionsController`, `ConnectionGroupsController`, the monitoring service, `FileWorkspaceManager` on its own, `ProviderFactory`, the RabbitMQ provider and its management client against a fake HTTP handler.
  2. Delete what is dead: the legacy `ServiceBusService`, the tracked `entity-details.component.ts.backup`, the empty `kafka` folder.
  3. The provider registry: wire it into the entities route or remove it, then rewrite `docs/ADDING_PROVIDERS.md` to match. This is the decision that says whether `entity-details.component.ts` (3,760 lines, both brokers in one component) is split by provider.
  4. Only then the large files, each behind behaviour-lock tests: `view-messages-dialog.component.ts` (2,320 lines, three near-identical bulk flows), `AzureServiceBusProvider.cs` (1,844), `main.js` (1,040).
  5. An architecture test for Rule F; capability flags for what RabbitMQ does not support, read by the UI.
- **Success criteria:** every controller and both providers have tests; [[pages/invariants/provider-boundaries]] is enforced by a test; no tracked dead file.
- **Notes:** the refactors are last on purpose. Rule C: none of them is done for its own sake, only where a file's shape blocked a fix or a test in an earlier phase.

## Decisions pending

Each becomes an ADR under `pages/decisions/` when taken.

- Rules A, F, G, H and I as derived at the founding: confirm or amend ([[pages/decisions/0001-in-repo-vault-and-agent-harness]]).
- RabbitMQ bulk operations: make safe, or turn off (Phase 2).
- Self-contained API and the larger installers it brings (Phase 3).
- Code signing on macOS was decided on 2026-04-09: unsigned until demand justifies the membership ([[pages/history/product]]). Windows signing is still open (Phase 3).
- Secrets at rest: OS keychain or Electron `safeStorage`, or stay in plain text and say so (not scheduled).
- The provider registry: wire or remove (Phase 6).

## Services affected

[[pages/services/core]], [[pages/services/api]], [[pages/services/web-app]], [[pages/services/electron-shell]]

## Risks

- **A fix lands where no test exists and proves nothing.** Mitigation: every fix starts with its failing test (the bug-fix lane), and Phase 1 puts the web tests in CI.
- **The RabbitMQ management API cannot do publish-then-consume safely.** Mitigation: the fallback is in the scope, turn the capability off.
- **Warnings as errors surfaces hundreds of warnings.** Mitigation: its own PR; a rule that cannot be met yet is switched off by name with its reason, not silenced wholesale.
- **Self-contained publishes break packaging on one system.** Mitigation: the smoke test of Phase 3 item 3 lands in the same PR as item 2.
- **The inferences in Phase 3 are wrong.** Mitigation: the first step is a real build on each system, before any change.

## Related

- [[pages/roadmap/followups]]
- [[pages/conventions/testing]], [[pages/conventions/tooling]]
