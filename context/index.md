---
title: "Messaging Explorer Context Index"
version: "1.0"
date: 2026-11-12
changes: "Founded on 2026-11-12"
page_type: index
status: active
description: "Content catalogue for the Messaging Explorer LLM wiki."
updated: 2026-11-12
source:
  - chat
  - src/
  - web-app/
reliability: high
---

# Messaging Explorer Context Index

The content catalogue for this context. Start here, follow wikilinks. If the context can't answer, grep source, then `/wiki-crystallize` the findings back.

- Operation contract: [[CLAUDE]] (how Claude operates on this context)
- Page schema: [[wiki-schema]] | Config: [[wiki-config]]
- Templates: `templates/`
- UI prototype: `prototypes/web-app/` (the target layout: a design canvas of one artboard per screen, and the earlier single-file drawing with screenshots; the spec for [[pages/conventions/ui]])

> **Coverage note (2026-11-12):** founded in one day, from the code only, in the working tree of
> branch `fix/dlq-bulk-operations` with the owner's uncommitted changes. Every `path:line` citation
> resolves (`scripts/check-context-refs.sh`); the service pages and the project map were written by
> three survey agents and their citations were spot-checked, not all re-read, so a line that exists
> may still describe its claim loosely. On 2026-11-12 the owner allowed his private notes to be
> migrated: the product history, the Azure authentication decision and the feature backlog came
> from them, rewritten in English and checked against the code; audits, sessions and plans stayed private. The folders
> `incidents/`, `flows/` and `domain/` are empty until first use.
>
> The survey found real defects. They are recorded, not fixed: "Known gaps" on each service page,
> one list by risk in [[pages/roadmap/followups]].

## Overview

- [[pages/overview/vision|Vision]] - What the tool is for, who uses it and where it is going.

## Architecture

- [[pages/architecture/project-map|Project map]] - Every project in the solution and every non-.NET part, its dependencies, the test project that covers it, and which tests to run when it changes.

## Services

- [[pages/services/core|Core]] - `src/ServiceBusExplorer.Core`: the provider abstraction, the Azure Service Bus and RabbitMQ providers, workspace storage, metrics.
- [[pages/services/api]] - `src/ServiceBusExplorer.Api`: startup and the key middleware, the controllers, the single active provider, monitoring.
- [[pages/services/web-app|Web app]] - `web-app/src`: the Angular application, `ApiService`, the features, the provider registry, the tests that run and the ones that do not.
- [[pages/services/electron-shell|Electron shell]] - `web-app/electron`: the main process that starts the API and holds the secret, the IPC surface, auto-update, packaging and release.

## Invariants

- [[pages/invariants/local-authenticated-api|The API is local and authenticated]] - Rule A. Loopback, Host filter, CORS, the per-launch key in fixed time.
- [[pages/invariants/secrets-masked-at-the-api-boundary|Secrets are masked at the API boundary]] - Rule G. The mask, the merge on save and import, the one raw export.
- [[pages/invariants/bulk-operations-are-at-least-once|Bulk operations are at-least-once]] - Rule H. Send before complete, the duplicate report, bounded scans, cancellation. Holds for Azure; RabbitMQ is a recorded breach.
- [[pages/invariants/provider-boundaries|Provider boundaries]] - Rule F. The provider contract, capabilities, vendor types inside their folder.
- [[pages/invariants/a-guard-must-be-able-to-fire|A guard must be able to fire]] - Every check has an input that reaches it and a test that supplies one; a failure never answers as success.

## Conventions

- [[pages/conventions/tooling|Tooling]] - Model routing, the agents, the hooks, the pipeline skill, the review workflow, what the build does not enforce.
- [[pages/conventions/ui|User interface]] - One design system: Material components and theme tokens, one icon set, named destructive actions, three distinct states, a name on every control; and where the app stands against that today.
- [[pages/conventions/testing|Testing]] - The stacks, the commands, the state at the founding, why web tests run only through `ng test`, what has no test.
- [[pages/conventions/decisions-that-look-like-defects|Decisions that look like defects]] - Intended behaviour that reads as a bug, with the test that locks it.

## Decisions

- [[pages/decisions/0003-azure-authentication-strategy|ADR 0003 - Azure authentication strategy]] *(accepted 2026-04-19)* - Identity before keys: five supported credentials, two rejected, and resource discovery, which is the part not built.
- [[pages/decisions/0004-the-in-repo-documentation-folder-is-named-context|ADR 0004 - The in-repo documentation folder is named context]] *(accepted 2026-11-13)* - `vault/` became `context/`; ADR 0001 otherwise stands.
- [[pages/decisions/0002-integration-tests-against-brokers-in-docker|ADR 0002 - Integration tests against brokers in Docker]] *(accepted)* - A third test project that starts RabbitMQ and the Azure Service Bus emulator in containers; a test never talks to a broker it did not start.
- [[pages/decisions/0001-in-repo-vault-and-agent-harness|ADR 0001 - In-repo context and agent harness]] *(accepted)* - Why the documentation and the harness live in the repo, and where the ten rules came from.

## History

- [[pages/history/product|Product history]] - The private version line to 3.0.0, the public relaunch as 1.0.0, why 2.3.0 followed, and the decisions on the way that still hold.

## Roadmap

- [[pages/runbooks/local-brokers|Local brokers in Docker]] - Start RabbitMQ and the Azure Service Bus emulator on this machine, the connection values for the app, the sample entities and the proxy that gives the emulator one endpoint.
- [[pages/roadmap/product-backlog|Product backlog]] - The features the owner asked for that are not built yet, checked against the code.
- [[pages/roadmap/azure-service-bus-administration|Azure Service Bus: administer the entity]] - What exists and what to build, per layer, for twelve capabilities: edit entities, rules, status, definitions export, counts, sessions, scheduled and deferred messages, transfer dead-letter, batch send.
- [[pages/roadmap/azure-event-hubs-and-event-grid|Azure Event Hubs and Azure Event Grid]] - The next version: the three Microsoft products as one family, sign-in and discovery, what to build for each, the decision the provider abstraction needs, and what can be tested in containers.
- [[pages/roadmap/rabbitmq-messaging-scenarios|RabbitMQ: the eight tutorial scenarios]] - What each of the six queue tutorials and the two stream tutorials builds, what the app shows for it today and whether that is right, how to represent it, streams in depth, and the plan of 61 tests.
- [[pages/roadmap/ui-material-migration|UI: finish the move to Angular Material]] - End-to-end tests with screenshots first, then the queue panel at the subscription's level, safer destructive actions, Material screen by screen, and Bootstrap removed.
- [[pages/roadmap/ui-review-2026-11|UI review, November 2026]] - The macOS window findings (inferred from code), the prioritized list of what to improve per screen, and where the prototype departs from the UI convention.
- [[pages/roadmap/tests-of-everything|Tests of everything]] - Four phases: the providers against real brokers in Docker, every controller, the web app where it acts on messages, the packaged app.
- [[pages/roadmap/code-audit-2026-11|Code audit, November 2026]] - The line-by-line bug hunt of the back end and the front end: findings by area and severity, improvements, and where to start.
- [[pages/roadmap/improvement-plan|Improvement plan]] - The order of work in seven phases: land what is open, gates that tell the truth, message and secret safety, a release that works on three systems, dependencies, the API boundary, tests and structure.
- [[pages/roadmap/followups|Follow-ups]] - The tracker of known gaps, by risk, and the owner decisions pending.
