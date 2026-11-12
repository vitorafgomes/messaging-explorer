---
title: "Follow-ups"
version: "1.0"
date: 2026-11-12
changes: "Founded with the findings of the founding survey of 2026-11-12"
page_type: roadmap
status: active
description: "The tracker of known gaps: what the founding survey found in the code and in the build, by risk, each pointing at the service page that holds its citations."
updated: 2026-11-12
source:
  - "vault/pages/services/"
  - chat
reliability: high
---

# Follow-ups

> One list, by risk. An entry is a pointer: the citation and the detail live under "Known gaps" on the service page named, so a line number is fixed in one place. A change that closes an entry removes it here and there in the same commit. Nothing on this list was fixed at the founding; the founding wrote it down.

Each entry carries its date. This page is a tracker: `version` changes only when its shape does.

## P1 - can lose a message or expose a secret

- **2026-11-12 - RabbitMQ bulk delete, resubmit and move consume before they republish.** Reproduced in a container on 2026-11-12: an unrouted republish reported as success, a whole batch consumed and then lost on a parse failure, a refused republish. The cancellation token is never read; `MoveMessagesAsync` ignores the subscription. Breach of [[pages/invariants/bulk-operations-are-at-least-once]], pinned by `Defect_` tests in the integration project. [[pages/services/core]]
- **2026-11-12 - The consolidation migration still writes `workspace.json` directly**, not through the atomic save. [[pages/services/core]]
- **2026-11-12 - A send that fails partway through a resubmit or move cycle** leaves the sent messages reported as not found; a retry duplicates them with no warning. Read from the code, no test. [[pages/services/core]]
- **2026-11-12 - The single-message resubmit returns silently when the original is not found after the send.** [[pages/services/core]]
- **2026-11-12 - Secrets are stored in plain text in `workspace.json`.** Not a breach of Rule G, which is about the boundary; an owner decision is needed on OS keychain or `safeStorage`. [[pages/services/core]]

## P2 - weakens the API boundary

- **2026-11-12 - The loopback binding in `Program.cs` never runs under Electron** (`ASPNETCORE_URLS` is always set), and host filtering has two sources with no test sending a foreign Host. [[pages/services/api]], [[pages/invariants/local-authenticated-api]]
- **2026-11-12 - A malformed JSON request body gets the framework's automatic 400**, whose text may carry the parser's message (unverified). [[pages/services/api]]
- **2026-11-12 - The packaged window has no CSP.** [[pages/services/electron-shell]]
- **2026-11-12 - No code signing on any OS.** [[pages/services/electron-shell]]
- **2026-11-12 - If the API secret cannot be read, requests go out without the header** and fail as 401 with no message to the user. [[pages/services/web-app]]

## P2 - correctness and lifecycle

- **2026-11-12 - A possible duplicate is recognised by the provider's English text**; the API needs a field on the batch failure so the web app stops matching words. [[pages/services/web-app]]
- **2026-11-12 - The delete-all decision compares the selection with the count the messages dialog received when it opened**, and an open messages dialog survives a change of connection from the Electron menu. [[pages/services/web-app]]
- **2026-11-12 - An entity named exactly `.` or `..` cannot be addressed**: the browser resolves it as a dot segment even when encoded, so deleting a subscription `..` under a topic would reach the topic's own route. Read from the URL standard and the route table, not run; RabbitMQ allows such names, Azure does not. [[pages/services/web-app]]
- **2026-11-12 - One static provider slot for the whole API process**, swapped and disposed while calls may be in flight; the monitoring service keeps a reference to a provider that may be disposed. [[pages/services/api]]
- **2026-11-12 - `import-full` is not atomic.** [[pages/services/api]]
- **2026-11-12 - Changing only the auth type, tenant, namespace or client secret skips the connection test on save.** [[pages/services/api]]
- **2026-11-12 - The SIGKILL fallback may not fire on a real quit** (Electron may exit before the timer; unverified), a tray click during the health wait opens the window early, and a crashed API is not restarted. The dialog wiring has no automated test. [[pages/services/electron-shell]]
- **2026-11-12 - After a cancelled bulk operation the list and counters are not reloaded; progress is one final update.** [[pages/services/web-app]]
- **2026-11-12 - RabbitMQ members that throw or return empty behind the shared interface** (dead-lettering, search, sessions) and RabbitMQ logging through `Console.WriteLine`. [[pages/services/core]], [[pages/invariants/provider-boundaries]]

## P3 - dead code and stale documents

- **2026-11-12 - The legacy `ServiceBusService` is registered and never connected.** Delete it. [[pages/services/core]]
- **2026-11-12 - The Angular provider registry, the provider shell and the two provider components are not wired into any route; the `kafka` folder is empty; `docs/ADDING_PROVIDERS.md` describes a flow the app does not run.** Wire it or remove it, then rewrite the guide. [[pages/services/web-app]]
- **2026-11-12 - A 3,537-line `entity-details.component.ts.backup` is tracked beside the live file.** [[pages/services/web-app]]
- **2026-11-12 - The project structure in `README.md` omits the test projects and the vault**, and it does not link to the vault.

## The gates themselves

What the pipeline cannot check yet ([[pages/conventions/tooling]], [[pages/conventions/testing]]).

- **2026-11-12 - Eight web tests are skipped**: the refresh variants in `metrics.service.spec.ts`, waiting for timer handling under zoneless Angular. [[pages/services/web-app]]
- **2026-11-12 - No lint or format script for the web app**, in CI or locally.
- **2026-11-12 - No warnings-as-errors, no analyzers, no `.editorconfig`, no format gate, no `global.json`.** Adopting a `Directory.Build.props` with warnings as errors is a change to the product build; one PR, through the pipeline.
- **2026-11-12 - No architecture test for Rule F**; a vendor `using` outside a provider folder fails nothing.
- **2026-11-12 - No test for most controllers or for the Electron shell's wiring**; the Azure provider has no integration test yet. [[pages/roadmap/tests-of-everything]]
- **2026-11-12 - The pipeline skill has no `evals/`.**

## Release and dependencies

Read on 2026-11-12 from the workflow and the package configuration; the inferred ones were not run. Order of work: [[pages/roadmap/improvement-plan]], phases 3 and 4.

- **2026-11-12 - The packaged API is framework-dependent and one publish is shared by every package**, so the user needs the .NET 10 runtime and the macOS x64 package most likely carries an arm64 executable (inferred). [[pages/services/electron-shell]]
- **2026-11-12 - No smoke test of a packaged app; CI builds on Linux only.**
- **2026-11-12 - Windows and Linux ship x64 only.**
- **2026-11-12 - The update is offered where it cannot be installed.** macOS refuses to apply an unsigned update and the builds are unsigned by decision ([[pages/history/product]]); the Windows portable build has no updater; the shell still announces a new version on both. Offer a download link there instead of Update. Not reproduced on a machine: it follows from the platform's rule and the library ([[pages/services/electron-shell]]).
- **2026-11-12 - The beta update path has never run for real.** The channel fix and the upload of `beta*.yml` are covered by tests and by reading the library; the first `-beta` tag is the first real check. The stable half ran for real on 2026-11-12: release 2.4.0 carries `latest*.yml` and the block maps of the Windows installer and the macOS packages. A beta build installed by hand stays on Stable until the user picks Beta.
- **2026-11-12 - Updates install on quit without a second question** (`autoInstallOnAppQuit`), after a download the user asked for. Whether install should need its own click is the owner's call.
- **2026-11-12 - Workflow actions are referenced by moving tags, and there is no Dependabot configuration.**
- **2026-11-12 - `npm audit`: 25 advisories left after the in-range update (was 79), 2 high, none critical; 2 moderate with `--omit=dev`.** What remains needs a major or does not apply: Electron 41 has one high and seven lower advisories fixed only from 42.11.16 on, and Electron is shipped in every installer although npm counts it as a development dependency; `sharp` (high) only draws the repository's own icons at build time and needs 0.35; `exceljs` 4.4.0 pulls a `uuid` whose flawed path it does not call; the rest sits in the Angular CLI and electron-builder trees, where the only offered fix is a downgrade. `@angular/animations` is now deprecated upstream.
- **2026-11-12 - The app compares the provider type as a number while the API sends its name.** `ProviderService` normalises it since 2026-11-12; the connection service, the connection model helpers, the add-connection dialog and the `isRabbitMQ` and `isAzure` guards still compare the numeric enum, so a RabbitMQ connection may be treated as Azure there. Read from code, not reproduced.
- **2026-11-12 - Two dead-letter paths are not gated by the capability:** the subscription's purge menu items and the messages dialog opening on its dead-letter tab by index. Unreachable today, since both brokers declare a dead-letter queue.
- **2026-11-12 - RabbitMQ invents entity dates:** queue and exchange creation, update and access times are filled with the current time, and the panels now show them. An Azure topic with no max message size is reported as 256 KB.
- **2026-11-12 - The provider registry, the provider shell and the two provider-specific detail components are dead code** that Rule F and `docs/ADDING_PROVIDERS.md` describe as the extension point. Mount them or delete them: an ADR.
- **2026-11-12 - .NET packages held at an older major or patch**, none vulnerable: `RabbitMQ.Client` 6.8.1 (7.x rewrites the API as async; goes with the RabbitMQ bulk rebuild), `Moq` 4.20.70 (4.21.0 raises six CS8602 warnings in `AzureMonitorMetricsServiceTests`, one `!` each), `Microsoft.OpenApi` 2.x, `xunit.runner.visualstudio` 2.x, `coverlet.collector` 6.x, `Microsoft.NET.Test.Sdk` 17.x. Everything else was moved to the newest version inside its major on 2026-11-12, and `Microsoft.Extensions.*` to 10.0.x.

## Owner decisions pending

- **2026-11-12 - Rules A, F, G, H and I were derived at the founding** from the code and the 2.3.0 changelog ([[pages/decisions/0001-in-repo-vault-and-agent-harness]]). Confirm or amend.
- **2026-11-12 - The owner's notes were migrated** in part: product history, the Azure authentication decision and the feature backlog. Left private on purpose: security audits, session logs and plans.
