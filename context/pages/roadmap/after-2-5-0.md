---
title: "After 2.5.0: the order of work on one branch"
version: "1.0"
date: 2026-11-19
changes: "Initial plan page"
page_type: roadmap
status: active
description: "The order of what is built after the 2.5.0 release, on the single branch feat/improvements-after-2.5.0: the MCP server first, then what the last round left open, message and secret safety, the errors a user sees, features, performance and the release."
updated: 2026-11-19
source:
  - chat
  - "context/pages/roadmap/followups.md"
reliability: medium
---

# After 2.5.0: the order of work on one branch

> Decided with the owner on 2026-11-19, after 2.5.0 was released. Everything below is built on one branch, `feat/improvements-after-2.5.0`, one commit per item, each with its test and its pages. The owner put the MCP server first.

An item that needs a decision or a measurement from the owner says so; the rest does not wait for it. The gaps themselves, with their citations, stay on [[pages/roadmap/followups]].

## 1. An MCP server for the app (first, asked on 2026-11-19)

The owner wants an assistant to reach the brokers through the app, the way an IDE offers its own tools to one: read, and also send. The complete version, in the owner's words: "a versao completa pois quero que voce tambem possa enviar msg".

- **Scope.** Read (connections, queues, topics, subscriptions, rules, counts, peek of every sub-queue, and the logs of the app, asked on 2026-11-19), send (one message or many), act on messages (resubmit, move, delete, purge, cancel scheduled) and administer entities: what the API does today.
- **Before any code:** the decision record, [[pages/decisions/0008-an-mcp-server-inside-the-local-api]], proposed on 2026-11-19 and waiting for the owner; the screen is drawn on the Settings artboard as the group "MCP server".
- **Guards the decision record will propose.** A connection is offered to the server only when the user opts it in; secrets stay masked ([[pages/invariants/secrets-masked-at-the-api-boundary]]); a connection marked as production is out unless chosen on purpose; an operation that sends or removes asks the user in the app before it runs; a bulk operation answers the same per-message report ([[pages/invariants/bulk-operations-are-at-least-once]]).
- **Order of building.** Reading, then sending, then what removes, each with its tests and its review.
- **Owner decisions pending.** Whether every sending or removing operation asks for confirmation in the app, with an exception only for the local test brokers (recommended), and how the server starts and obtains the per-launch key.
- **Not verified yet.** The current SDK for MCP servers has not been read; the estimate of three to four working days rests on that.

## 2. What the last round left open

| Item | State |
|---|---|
| One note where a subscription resubmits, in the messages dialog and the automatic resubmit | Done 2026-11-19 |
| The Connections screen keeps the Connected mark after its list loads again; the end-to-end test that pinned the defect as an expected failure asserts it | In progress 2026-11-19 |
| Retry after a failed download checks again | Done 2026-11-19, to commit |
| ADR 0007 accepted | Done 2026-11-19, to commit |
| A refused download says that no update is on offer, apart from a version that differs | Done 2026-11-19, to commit |
| The note for deferred messages selected on a subscription is the same single note | Done 2026-11-19, to commit |

## 3. Message and secret safety (the P1 entries of the tracker)

- The single resubmit holds the original before it sends, as the batch does.
- The consolidation migration that still writes `workspace.json` directly, and the legacy file that cannot be parsed.
- RabbitMQ: check the identity of a message (its id and the hash of its body) before acting by position.
- The reach of the resubmit, delete and move scans. **Needs a measurement on a namespace the owner names.**
- Secrets in plain text in `workspace.json`. **Needs the owner's decision:** the system keychain or encryption.

## 4. Errors a user sees (P2)

- The transfer dead-letter tab of a subscription that fails to load.
- A peek of a queue with auto-forwarding that fails with no explanation.
- The single-message actions on a session-enabled entity.
- After a cancelled bulk operation, the list and the counters are read again.
- A disabled-entity failure offered under "Retry Failed".
- A malformed JSON body answers `{ message }`, not the framework's document.
- The export from the transfer dead-letter tab that says "(Dead Letter)".

## 5. Features decided or waiting for the owner

- The Monitoring history in SQLite, decided ([[pages/roadmap/settings-data-and-updates]]).
- Send many messages, and the sort of the loaded list. **The artboards wait for the owner's opinion.**
- Keep the sign-in across launches; a second confirmation on Restart to Update; the steps of Add Connection clickable. **Owner decisions.**

## 6. Performance and cleanup

- The message list virtualised; the RabbitMQ monitoring poll; the counts read from one source.
- Dead code: the Angular provider registry, the legacy `ServiceBusService`, `prismjs`.
- The 33 icon-only buttons with no `aria-label`.

## 7. Build and release

- A content security policy on the packaged window.
- A start-up test of the packaged app in CI, which would catch a break of Electron on Windows or macOS before a release.
- Dependabot configured, and workflow actions pinned by commit.
- A check on Windows and macOS: only Linux was started by hand for 2.5.0 and for Electron 42.

## Out of this plan

- Code signing: it needs certificates.
- The `minimatch` advisory in the build tools: its only fix is a downgrade of those tools.

## How it reaches main

One branch. The owner asked for a single branch; the recommendation recorded here is to open a pull request from it at the end of each section, so `main` receives what is already proven and one failing check does not hold everything.
