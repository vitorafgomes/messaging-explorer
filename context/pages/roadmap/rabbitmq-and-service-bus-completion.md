---
title: "RabbitMQ and Azure Service Bus: what is left to call both complete"
version: "1.0"
date: 2026-11-16
changes: "Initial plan page"
page_type: roadmap
status: active
description: "The order of work, end to end, that closes RabbitMQ and Azure Service Bus: ten phases, each one lane and one pull request, with what it needs from the owner, what proves it and what stays out."
updated: 2026-11-16
source:
  - chat
  - "context/pages/roadmap/followups.md"
  - "context/pages/roadmap/rabbitmq-messaging-scenarios.md"
  - "context/pages/roadmap/azure-service-bus-administration.md"
  - "context/pages/roadmap/product-backlog.md"
reliability: medium
---

# RabbitMQ and Azure Service Bus: what is left to call both complete

> The owner asked on 2026-11-16 for one plan, end to end, of what is left on the two brokers. This page orders work that [[pages/roadmap/followups]], [[pages/roadmap/rabbitmq-messaging-scenarios]] and [[pages/roadmap/azure-service-bus-administration]] already record; it adds no finding of its own except the two of 2026-11-16 written on the follow-ups page. The entries were read from those pages, not checked again against the code on that day.

## What "complete" means here

1. A message action offered on one broker is offered on the other, or the provider declares that it cannot do it ([[pages/invariants/provider-boundaries]]).
2. No entry under "P1 - can lose a message" of [[pages/roadmap/followups]] names either broker's message operations ([[pages/invariants/bulk-operations-are-at-least-once]]).
3. A read the broker refuses is shown with the broker's reason, never as a generic failure and never as an empty list.
4. Each message action has an end-to-end flow on each broker.

## The phases

State on 2026-11-16: phases 1 to 5 are built; of phase 4, RabbitMQ still logs to the console, which goes with phase 8. Phase 9 is built, with the two leftovers its section names.

Each phase is one pipeline lane, one session and one pull request, in this order. Size is relative: S is one short session, L is a session that fills a day.

| # | Broker | What | Size | Needs from the owner |
|---|---|---|---|---|
| 0 | RabbitMQ | Land the stale-position fix of the resubmit and cut the next beta | S | A manual test of the local build; the word to commit |
| 1 | Service Bus | A peek the broker refuses says why | S | Emulator or a real namespace; a namespace named for one read |
| 2 | RabbitMQ | Bulk delete and move rebuilt, send first and remove after | L | `RabbitMQ.Client` 7 now or later |
| 3 | RabbitMQ | Edit and resubmit, and the capability turned on | M | None |
| 4 | RabbitMQ | Refuse what a queue type cannot do; the honest send | M | Peek on a queue with live consumers: confirm each time or not |
| 5 | Both | A failure midway is reported as what it is | M | None |
| 6 | Service Bus | Bulk work on a deep dead-letter queue | L | A real namespace for one measurement; three decisions |
| 7 | Service Bus | Sessions, AMQP bodies and scheduled messages | M | A real namespace to confirm the topic peek |
| 8 | Both | Small ones | M | None |
| 9 | Web app | Every screen update goes through a signal | M | None |
| 10 | Both | End-to-end flows and the stable release | M | The word to release |

### 0. Land the resubmit fix

- **State:** built, tested and reviewed in the working tree on 2026-11-16; not committed ([[pages/history/core]], [[pages/history/web-app]]).
- **Left:** the owner's manual test on a local RabbitMQ, the commits, the pull request, the release.
- **Why first:** `main` carries the resubmit of 2026-11-15 without it, and that one can send a stale position.

### 1. A peek the broker refuses says why

- **Closes:** the transfer dead-letter queue of a subscription and the peek of a queue that forwards, both on [[pages/roadmap/followups]].
- **Build:** the provider turns the broker's refusal of a peek into a result with a reason; the peek routes answer it as a `{ message }` the web app already shows; the transfer dead-letter tab is not offered where the broker has no such queue, once the behaviour of real Azure is known.
- **Proof:** an integration test for a subscription beside `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs#The_transfer_dead_letter_queue_of_a_queue_without_one_answers_empty_and_is_not_its_dead_letter_queue`; a controller test where the peek throws; a web spec that reads the reason on the screen.
- **Lenses:** `api-surface`, `invariants`. The reason is the broker's text: it carries the entity path and must carry no connection detail.

### 2. RabbitMQ bulk delete and move

- **Closes:** the first P1 of [[pages/roadmap/followups]]: delete and move consume before they republish, ignore the cancellation token, and move ignores the subscription. Phase 4 of [[pages/roadmap/rabbitmq-messaging-scenarios]].
- **Build:** the shape the resubmit took on 2026-11-15 ([[pages/services/core/rabbitmq-and-legacy]]): hold the deliveries, publish with confirms and `mandatory`, remove after, report per position, stop on the caller's token.
- **Proof:** the `Defect_` tests of the integration project turn green; one test per call that fails.
- **Lenses:** `message-safety`, `boundaries`, `invariants`, and the optimizer.

### 3. RabbitMQ edit and resubmit, and the capability

- **Build:** edit and resubmit over the same send-first path; `SupportsBulkMessageOperations` turned on, so Delete, Move, Edit and Resubmit and Retry appear as they do on Service Bus; the reload after a cancel waits for the server to release what it holds ([[pages/roadmap/followups]], 2026-11-16).
- **Proof:** web specs for each button on a RabbitMQ connection; an end-to-end flow.
- **Depends on:** phase 2.

### 4. RabbitMQ: queue types and the honest send

- **Closes:** phases 2 and 3 of [[pages/roadmap/rabbitmq-messaging-scenarios]] where they are still open: a message operation on a stream or on another connection's exclusive queue is refused before the broker is called; a send to an exchange carries an explicit routing key, `mandatory` and a confirm; the members that throw or answer empty behind the interface become declared capabilities.
- **Lenses:** `message-safety`, `boundaries`.

### 5. A failure midway is reported as what it is

- **Closes:** three entries of [[pages/roadmap/followups]]: a send that fails partway leaves sent messages reported as not found; the single resubmit returns silently when the original is gone; a possible duplicate is recognised by English text.
- **Build:** a field on the batch failure that says "sent, removal unproven"; both providers set it; the web app reads the field.
- **Lenses:** `message-safety`, `api-surface`.

### 6. Service Bus: a deep dead-letter queue

- **Closes:** the scan that reaches only a few hundred messages past the head ([[pages/roadmap/followups]], 2026-11-13).
- **Before any code:** one measurement on a real namespace the owner names, and the three decisions that entry lists.
- **Lenses:** `message-safety`, and the optimizer.

### 7. Service Bus: sessions, bodies, scheduled

- **Closes:** single-message actions on a session entity; a body that is an AMQP value or sequence; scheduled messages listed from the broker, and those of a topic ([[pages/roadmap/azure-service-bus-administration]], item 7).

### 8. Small ones

- **Done 2026-11-16:** the console writes, the invented dates, the Azure-only rows, and a test of a message's state and size. The tree already had its filter. Left: the cost of the monitoring poll on RabbitMQ, the status and forward target of a subscription in the tree, the send-many dialog and the sort of the message list.

- **RabbitMQ:** invented entity dates, Azure-only properties shown as 0, `Console.WriteLine`, the cost of the monitoring poll, tests for message state and size.
- **Service Bus:** status and forward target of a subscription in the tree, the send-many dialog (count, confirmation, progress), sort of the message list, filter of the tree.

### 9. Every screen update goes through a signal

- **Asked by the owner on 2026-11-16:** validate that every Angular signal update is done correctly.
- **Done 2026-11-16, the first case:** the counts of an entity in the tree, the panel and the messages dialog read one signal ([[pages/services/web-app/features-entities-panel-and-definitions]]). Left then: the inventory below, and the bell, the list pages and Monitoring.
- **Done 2026-11-16, the rest:** the bell and the Queues and Topics pages read the shared counts; Monitoring keeps its dated snapshot, by choice, and says when the broker reports no counts. The inventory read 55 components: one path had nothing to redraw it (the messages dialog emptied half a second after the count is set to 0), fixed and pinned by `web-app/src/app/features/messages/view-messages-dialog.component.spec.ts#a count of 0 empties the list on screen`; the tree's `treeData` and `selectedNode`, redrawn only by side effects of other components, are signals. Left: the lists of the messages dialog are plain fields redrawn through signals set in the same callbacks, as are Monitoring's history and deltas.
- **Why it can go wrong:** the app runs without zone.js, so a plain field assigned in a subscription, a timer or a dialog callback redraws only when something else marks the view.
- **Build:** an inventory, component by component, of the state a template reads and whether it is a signal, a computed, or a plain field with an explicit mark; each plain field written outside an event handler of its own template becomes a signal or gets a spec that shows the screen changing. Starts with the messages dialog, the entity tree, the entity panel, the bulk dialogs and Monitoring.
- **Proof:** a spec per fixed field that fails before the change, with no manual `detectChanges` between the update and the assertion beyond the one a real render would get.

### 10. End-to-end flows and the stable release

- **Build:** Playwright flows for resubmit, delete, move and purge on each broker ([[pages/roadmap/tests-of-everything]]); the four checks of "complete" above read against the code; the stable release, the next patch.

## Out of this plan

- **RabbitMQ streams** (phases 5 and 6 of [[pages/roadmap/rabbitmq-messaging-scenarios]]): a version of its own, after the decision it shares with Event Hubs.
- **The automatic resubmit at the size of a real backlog** ([[pages/roadmap/product-backlog]]): a version of its own; phase 6 is its ground.
- **Everything that is not a broker:** the API boundary, secrets at rest, signing, packaging, dependencies ([[pages/roadmap/improvement-plan]]).

## Open questions for the owner

- Was the failing transfer dead-letter tab on the emulator or on a real namespace?
- Which namespace may be read for phases 1, 6 and 7?
- `RabbitMQ.Client` 7 with phase 2, or left at 6 until streams?
- Does "complete" stop where this page stops, with streams and the large automatic resubmit as versions of their own?
