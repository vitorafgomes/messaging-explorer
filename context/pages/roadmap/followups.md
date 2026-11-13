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
  - "context/pages/services/"
  - chat
reliability: high
---

# Follow-ups

> One list, by risk. An entry is a pointer: the citation and the detail live under "Known gaps" on the service page named, so a line number is fixed in one place. A change that closes an entry removes it here and there in the same commit. Nothing on this list was fixed at the founding; the founding wrote it down.

Each entry carries its date. This page is a tracker: `version` changes only when its shape does.

## P1 - can lose a message or expose a secret

- **2026-11-12 - RabbitMQ bulk delete, resubmit and move consume before they republish.** Reproduced in a container on 2026-11-12: an unrouted republish reported as success, a whole batch consumed and then lost on a parse failure, a refused republish. The cancellation token is never read; `MoveMessagesAsync` ignores the subscription. Breach of [[pages/invariants/bulk-operations-are-at-least-once]], pinned by `Defect_` tests in the integration project. [[pages/services/core]]
- **2026-11-12 - The consolidation migration still writes `workspace.json` directly**, not through the atomic save. [[pages/services/core]]
- **2026-11-13 - A legacy `connections.json` or `connection-groups.json` that cannot be parsed now stops the consolidation and is kept, but the app then starts with an empty workspace and tells the user nothing**; the first save creates `workspace.json` and the kept files are never read again. Nothing is lost on disk; the user has to know to recover them. [[pages/services/core]]
- **2026-11-12 - A send that fails partway through a resubmit or move cycle** leaves the sent messages reported as not found; a retry duplicates them with no warning. Read from the code, no test. Since 2026-11-12 the same holds when the failure is a disabled entity: the 409, or the disabled text per message, guarantees only that nothing was removed from the source. [[pages/services/core]]
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
- **2026-11-13 - Entity definitions leave out what the create options cannot carry and what was not verified**: the maximum message size of a Premium entity, a correlation rule property the app cannot write (type Other refuses the whole document), the size a partitioned Standard entity reports, user metadata against a broker (the emulator keeps none); the export reports no progress and the import creates one entity at a time. A namespace above 5000 queues, topics and subscriptions or 10000 rules is refused by the export (the bounds an import accepts); exporting it needs a chunked export into several files, not built. Deferred from item 4 of [[pages/roadmap/azure-service-bus-administration]]. [[pages/services/core]]
- **2026-11-12 - RabbitMQ members that throw or return empty behind the shared interface** (dead-lettering, search, sessions) and RabbitMQ logging through `Console.WriteLine`. [[pages/services/core]], [[pages/invariants/provider-boundaries]]

## P2 - performance

- **2026-11-13 - The RabbitMQ monitoring poll costs one management request per queue twice over.** A poll lists queues and exchanges (the topic list itself reads the queues and the bindings of each exchange), then per exchange its bindings, then for each queue binding the queue and its `.dlq` queue: about 3 + 2E + 2B requests for E exchanges and B queue bindings, every period. Since 2026-11-13 a binding to an exchange is no longer read as a queue. Left: one bindings lookup per topic where one `GET /api/bindings/{vhost}` would do, a topic read that needs only names, and the two queue reads per binding, which the queue list of the same poll already holds. [[pages/services/api]], [[pages/services/core]]
- **2026-11-13 - The monitoring store keeps 120 snapshots while the app reads 20.** The history route is asked for 20 (`count=20` in the web app), the store keeps 120 whole snapshots, one record per queue and subscription each. Estimate of the performance review, reasoned, not measured: about 200 bytes per entity per snapshot, so about 0.7 MB per snapshot and 80 MB held for 120 snapshots on a namespace of 3,500 entities, of the API's memory held for nothing the app reads. Either keep 20, or keep only the totals for the older ones. [[pages/services/api]]

## P3 - dead code and stale documents

- **2026-11-12 - The legacy `ServiceBusService` is registered and never connected.** Delete it. [[pages/services/core]]
- **2026-11-12 - The Angular provider registry, the provider shell and the two provider components are not wired into any route; the `kafka` folder is empty; `docs/ADDING_PROVIDERS.md` describes a flow the app does not run.** Wire it or remove it, then rewrite the guide. [[pages/services/web-app]]
- **2026-11-12 - A 3,537-line `entity-details.component.ts.backup` is tracked beside the live file.** [[pages/services/web-app]]
- **2026-11-12 - The project structure in `README.md` omits the test projects and the context**, and it does not link to the context.

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
- **2026-11-12 - RabbitMQ message state and size have no test.** Both RabbitMQ mappers now set `State` to "Active" and `SizeInBytes` to the payload size; a test belongs in the RabbitMQ integration tests.
- **2026-11-12 - A queue read where one call says missing and the other fails differently answers "missing".** Correct for a queue deleted between the two calls; no test pins which one wins.
- **2026-11-12 - The app compares the provider type as a number while the API sends its name.** `ProviderService` normalises it since 2026-11-12; the connection service, the connection model helpers, the add-connection dialog and the `isRabbitMQ` and `isAzure` guards still compare the numeric enum, so a RabbitMQ connection may be treated as Azure there. Read from code, not reproduced.
- **2026-11-12 - Two dead-letter paths are not gated by the capability:** the subscription's purge menu items and the messages dialog opening on its dead-letter tab by index. Unreachable today, since both brokers declare a dead-letter queue.
- **2026-11-12 - RabbitMQ invents entity dates:** queue and exchange creation, update and access times are filled with the current time, and the panels now show them. An Azure topic with no max message size is reported as 256 KB.
- **2026-11-12 - The provider registry, the provider shell and the two provider-specific detail components are dead code** that Rule F and `docs/ADDING_PROVIDERS.md` describe as the extension point. Mount them or delete them: an ADR. Two defects wait on that decision (2026-11-13): the shell never unsubscribes the outputs of the component it replaces (`web-app/src/app/features/entities/provider-shell.component.ts:197`), and the Azure detail component logs every subscription as a non-Azure entity (`web-app/src/app/providers/azure-service-bus/components/azure-entity-details.component.ts:80`).
- **2026-11-12 - An edit of an entity is last write wins.** The SDK update carries no entity tag, so two people editing the same queue overwrite each other without notice ([[pages/roadmap/azure-service-bus-administration]], item 1). Mitigation to consider: read again just before the write and refuse when a field the user did not touch changed.
- **2026-11-12 - A body that does not parse answers the framework's problem document, not `{ message }`:** a wrong type or a duration that is not a time span on the new create and edit routes. The dialog then shows its generic failure text.
- **2026-11-12 - No connection is marked as production.** Confirmations name the client and environment of the connection, and an edit is not asked for the typed name the prototype draws on production. After a page reload the active connection is unknown and they say so.
- **2026-11-12 - RabbitMQ create ignores the Azure-only options** without an error. The app never offers create on RabbitMQ; the API would accept and drop them.
- **2026-11-12 - The emulator drops user metadata, auto delete on idle, batched operations and max size** on create and update, so those four are covered by unit tests only.
- **2026-11-12 - Three notes from the review of entity administration.** An SDK argument or invalid-operation error during create or update reads as "The broker refused this configuration." even when it is an internal fault such as a disposed client. An edit is written and then read again to answer; when that read fails the caller gets a 500 although the change was applied. The subscription dialog offers the subscription's own topic as a forward target and the server refuses it.
- **2026-11-12 - Replacing `$Default` by a narrower filter gets no warning.** The broker then drops, in silence, what no rule matches. The rules editor warns only when the last rule is deleted.
- **2026-11-12 - A rule property stored as a 32-bit integer, or any type other than text, 64-bit integer, double or boolean, makes the rule read-only in the editor.** Rules written by other tools often carry `Int32`. Decide whether to read it as a whole number and write it back as 64-bit.
- **2026-11-12 - The rules editor judges "last rule" from the list on screen,** which another client may have shortened; and a missing subscription answers "The rule was not found." on replace and delete, because the SDK reports the two alike.
- **2026-11-12 - The broker's parse error for a rule is written to the local server log** with the token of the expression it could not read. The response carries only the fixed text.
- **2026-11-12 - A queue with auto-forwarding cannot be peeked.** The broker refuses a message browser on an entity that forwards, so the messages dialog of such a queue fails to load. Found while trying the transfer dead-letter work; no test pins it and the dialog does not explain it. [[pages/services/core]]
- **2026-11-12 - A disabled-entity failure of a resubmit or a move is offered under "Retry Failed".** When the entity is found disabled midway, the remaining messages come back as failures with the text "The entity is disabled for this operation."; nothing retries them by itself, but the results dialog lists them as retryable and the retry fails the same way until the entity is enabled. A resubmit or move whose first cycle was sent in several batches may also have sent part of it before the 409 ([[pages/invariants/bulk-operations-are-at-least-once]]). [[pages/services/web-app]]
- **2026-11-12 - The export dialog says "(Dead Letter)" for an export from the transfer dead-letter tab.** It still takes a dead-letter boolean. [[pages/services/web-app]]
- **2026-11-12 - The "Scheduled" view is a filter of the loaded messages, not a listing from the broker.** A scheduled message beyond what the peek loaded is not shown, and the count beside the filter says "scheduled of loaded". Scheduled messages on topics have no cancel, and deferral is declared unsupported ([[pages/roadmap/azure-service-bus-administration]], item 7). [[pages/services/web-app]]
- **2026-11-12 - `cancelScheduledBlockedReason` and `scheduledLoadedCount` recompute on every change detection pass** of the messages dialog. Not noticeable up to 1,000 loaded messages, the most a peek returns. [[pages/services/web-app]]
- **2026-11-12 - A cancel that mixes in a number that is not scheduled cancels none on the emulator,** and every number is reported failed; the unit tests expect only that number to fail. Pinned as a `Defect_` test; real Azure was not verified. [[pages/services/core]]
- **2026-11-12 - .NET packages held at an older major or patch**, none vulnerable: `RabbitMQ.Client` 6.8.1 (7.x rewrites the API as async; goes with the RabbitMQ bulk rebuild), `Moq` 4.20.70 (4.21.0 raises six CS8602 warnings in `AzureMonitorMetricsServiceTests`, one `!` each), `Microsoft.OpenApi` 2.x, `xunit.runner.visualstudio` 2.x, `coverlet.collector` 6.x, `Microsoft.NET.Test.Sdk` 17.x. Everything else was moved to the newest version inside its major on 2026-11-12, and `Microsoft.Extensions.*` to 10.0.x.

## Owner decisions pending

- **2026-11-13 - The monitoring poll runs whenever a broker is connected, whether or not the Monitoring screen is open.** Each period (30 seconds by default, the floor) it lists the queues and the topics and reads the subscriptions of every topic, four topics at a time: on Azure one list call each plus one per topic; on RabbitMQ about 3 + 2E + 2B management requests for E exchanges and B queue bindings. Polling only while the screen is open would cost nothing when no one looks, and would lose the history the screen draws on opening. [[pages/services/api]]
- **2026-11-13 - The renderer can read the API key** (`web-app/electron/preload.js:9`, handler at `web-app/electron/main.js:832`), so script running in the renderer can take it out of the app. It is the runtime shape [[pages/invariants/local-authenticated-api]] documents; changing it is an ADR. Options: the main process adds `X-Api-Key` to requests for the API's loopback origin with `session.webRequest.onBeforeSendHeaders` and the IPC handler goes; or a narrow IPC proxy per operation; or keep it. [[pages/services/electron-shell]]
- **2026-11-13 - 33 icon-only buttons have no `aria-label`**, in ten files (the toolbar in `app.html`, connections, group dialog, entity tree, send and view-messages dialogs, queues, topics, the filter panel, and the unused body editor), counted by a scan of the templates for `button` and `a` elements whose only content is an icon; clickable icons and badges that are not buttons are not counted. Rule 10 of [[pages/conventions/ui]]. Naming them screen by screen inside [[pages/roadmap/ui-material-migration]], with the end-to-end harness asserting accessible names, or in one pass now.
- **2026-11-13 - The entity tree asks for the subscriptions of every topic on each load**, one request per topic (`web-app/src/app/core/services/tree-data-builder.service.ts:66`), because the dead-letter alerts need every subscription. A namespace-wide subscriptions route on the API would make it one call. The topics page loads them on open since 2026-11-13. [[pages/services/web-app]]
- **2026-11-13 - Import of definitions creates only.** Built as proposed: an entity that exists, the same or different, is reported and left as it is, and an existing subscription gets no rule from the file. Whether an import should ever update an existing entity is open. [[pages/roadmap/azure-service-bus-administration]]
- **2026-11-12 - Rules A, F, G, H and I were derived at the founding** from the code and the 2.3.0 changelog ([[pages/decisions/0001-in-repo-vault-and-agent-harness]]). Confirm or amend.
- **2026-11-12 - The owner's notes were migrated** in part: product history, the Azure authentication decision and the feature backlog. Left private on purpose: security audits, session logs and plans.
