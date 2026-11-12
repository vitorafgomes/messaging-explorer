---
title: "Messaging Explorer Vault Index"
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

# Messaging Explorer Vault Index

The content catalogue for this vault. Start here, follow wikilinks. If the vault can't answer, grep source, then `/wiki-crystallize` the findings back.

- Operation contract: [[CLAUDE]] (how Claude operates on this vault)
- Page schema: [[wiki-schema]] | Config: [[wiki-config]]
- Templates: `templates/`

> **Coverage note (2026-11-12):** founded in one day, from the code only, in the working tree of
> branch `fix/dlq-bulk-operations` with the owner's uncommitted changes. Every `path:line` citation
> resolves (`scripts/check-vault-refs.sh`); the service pages and the project map were written by
> three survey agents and their citations were spot-checked, not all re-read, so a line that exists
> may still describe its claim loosely. The owner's private notes were not migrated. The folders
> `history/`, `incidents/`, `runbooks/`, `flows/` and `domain/` are empty until first use.
>
> The survey found real defects. They are recorded, not fixed: "Known gaps" on each service page,
> one list by risk in [[pages/roadmap/followups]].

## Overview

- [[pages/overview/vision|Vision]] *(stub)* - What the tool is for and who uses it.

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
- [[pages/conventions/testing|Testing]] - The stacks, the commands, the state at the founding, why web tests run only through `ng test`, what has no test.
- [[pages/conventions/decisions-that-look-like-defects|Decisions that look like defects]] - Intended behaviour that reads as a bug, with the test that locks it.

## Decisions

- [[pages/decisions/0001-in-repo-vault-and-agent-harness|ADR 0001 - In-repo vault and agent harness]] *(accepted)* - Why the documentation and the harness live in the repo, and where the ten rules came from.

## Roadmap

- [[pages/roadmap/code-audit-2026-11|Code audit, November 2026]] - The line-by-line bug hunt of the back end and the front end: findings by area and severity, improvements, and where to start.
- [[pages/roadmap/improvement-plan|Improvement plan]] - The order of work in seven phases: land what is open, gates that tell the truth, message and secret safety, a release that works on three systems, dependencies, the API boundary, tests and structure.
- [[pages/roadmap/followups|Follow-ups]] - The tracker of known gaps, by risk, and the owner decisions pending.
