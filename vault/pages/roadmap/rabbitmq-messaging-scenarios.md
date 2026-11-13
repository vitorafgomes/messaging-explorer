---
title: "RabbitMQ: the eight tutorial scenarios, shown as the broker has them and each with tests"
version: "1.0"
date: 2026-11-12
changes: "Initial initiative page"
page_type: roadmap
status: active
description: "Survey and test plan for the eight official RabbitMQ tutorials the owner named (queues 1 to 6, streams 1 and 2): the topology each builds, what the app shows today, what is wrong, how to represent it without inventing a concept, what to build per layer, and the integration and unit tests that validate each."
updated: 2026-11-12
source:
  - chat
  - "src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs"
  - "src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs"
  - "src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs"
  - "src/ServiceBusExplorer.Core/Providers/RabbitMQ/Models/"
  - "src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs"
  - "src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs"
  - "web-app/src/app/core/models/topic.model.ts"
  - "web-app/src/app/core/services/tree-data-builder.service.ts"
  - "web-app/src/app/features/entities/entities-tree.component.ts"
  - "dev/brokers/rabbitmq-definitions.json"
  - "https://www.rabbitmq.com/tutorials"
  - "https://github.com/rabbitmq/rabbitmq-tutorials/tree/main/dotnet"
  - "https://www.rabbitmq.com/docs/streams"
  - "https://www.rabbitmq.com/docs/stream"
  - "https://www.rabbitmq.com/docs/stream-core-plugin-comparison"
  - "https://www.rabbitmq.com/docs/http-api-reference"
  - "https://www.rabbitmq.com/docs/quorum-queues"
  - "https://www.rabbitmq.com/docs/consumers"
  - "https://www.rabbitmq.com/docs/confirms"
  - "https://www.rabbitmq.com/docs/queues"
  - "https://www.rabbitmq.com/docs/direct-reply-to"
  - "https://github.com/rabbitmq/rabbitmq-server/blob/v4.3.x/deps/rabbit/src/rabbit_stream_queue.erl"
  - "https://www.nuget.org/packages/RabbitMQ.Client"
  - "https://www.nuget.org/packages/RabbitMQ.Stream.Client"
reliability: medium
---

# RabbitMQ: the eight tutorial scenarios, shown as the broker has them and each with tests

> The app lists RabbitMQ queues and exchanges and reads none of the eight tutorial topologies safely: its peek repeats the head and marks it redelivered, it kills its own channel on an exclusive queue and its whole connection on a stream, and the pattern it computes for every exchange is never drawn. This page says, per tutorial, what the broker holds, what the app does with it today, how it should look, what to build, and the tests that prove it.

## Where this comes from

On 2026-11-12 the owner said that for RabbitMQ "the ways we can receive messages" are the official tutorials at https://www.rabbitmq.com/tutorials, that he does not know how the product should approach or represent them, and that he requires tests that validate each of them. The eight, in their .NET versions (the index says they target RabbitMQ 4.x):

| # | Tutorial | URL |
|---|---|---|
| Q1 | Hello World | https://www.rabbitmq.com/tutorials/tutorial-one-dotnet |
| Q2 | Work Queues | https://www.rabbitmq.com/tutorials/tutorial-two-dotnet |
| Q3 | Publish/Subscribe | https://www.rabbitmq.com/tutorials/tutorial-three-dotnet |
| Q4 | Routing | https://www.rabbitmq.com/tutorials/tutorial-four-dotnet |
| Q5 | Topics | https://www.rabbitmq.com/tutorials/tutorial-five-dotnet |
| Q6 | RPC | https://www.rabbitmq.com/tutorials/tutorial-six-dotnet |
| S1 | Stream Hello World | https://www.rabbitmq.com/tutorials/tutorial-one-dotnet-stream |
| S2 | Stream Offset Tracking | https://www.rabbitmq.com/tutorials/tutorial-two-dotnet-stream |

The tutorial pages embed their code from GitHub; the exact calls quoted below were read in the source files at https://github.com/rabbitmq/rabbitmq-tutorials/tree/main/dotnet (queues) and on the two stream pages. The entry of [[pages/roadmap/product-backlog]] points here.

**How the facts were established.** The code was read on the commit after release 2.4.0. External facts carry their URL. Broker behaviour marked **executed** was run on 2026-11-12 against a throwaway `rabbitmq:4.3.7-management` container (the image the integration fixture pins, `src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:19`), through the management API and a Python AMQP 0-9-1 client, never through this provider and never against the owner's local broker. What the provider does with those answers is read from its code, and the test plan below is what turns each reading into an execution. Anything else says "not verified".

Three rules the owner set for all new work:

- **Current client libraries only.** The repo references `RabbitMQ.Client` 6.8.1 (`src/ServiceBusExplorer.Core/ServiceBusExplorer.Core.csproj:19`); the newest stable is 7.2.2 (https://www.nuget.org/packages/RabbitMQ.Client), a rewrite whose API is `IChannel` with `*Async` members only in every example of its guide (https://www.rabbitmq.com/client-libraries/dotnet-api-guide), and which the project has deferred to the bulk rebuild ([[pages/roadmap/followups]]). Everything below is specified against 6.8.1 members that exist in the installed package: `IModel.BasicGet`, `BasicNack`, `BasicQos`, `ConfirmSelect`, and the `BasicConsume` overload that takes consumer `arguments`. A stream can be read with that client (AMQP 0-9-1) or with `RabbitMQ.Stream.Client` 1.12.2 over the stream protocol (https://www.nuget.org/packages/RabbitMQ.Stream.Client); the trade-off is under "Streams, in depth".
- **Performance is part of the design.** Each scenario states its round trips and bounds.
- **Security is part of the design.** The app is pointed at production brokers: **a read must not change the broker unless the user asked for a destructive action.** Each scenario states what a read changes today. Rules A, F, G and H of the root `CLAUDE.md` and the confirmations of [[pages/conventions/ui]] apply as on [[pages/roadmap/azure-service-bus-administration]].

**Out of scope, with the reason.** Tutorial 7, Publisher Confirms, is not a scenario: confirms are a mode of a publisher's channel, nothing in a queue, an exchange or a binding records them, so there is nothing to explore. It stays in as a technique: the rebuilt send and bulk paths publish with `mandatory` and a confirm ([[pages/roadmap/code-audit-2026-11]]). Also out: the AMQP 1.0 variants of the tutorials (the provider speaks 0-9-1), MQTT and STOMP (other protocols, other clients), federation and shovel (operator topology, not message reading), super streams (partitioned streams that need the stream protocol; a later page if asked), stream filtering.

## What the survey corrected

- **The detected pattern is computed for every exchange and never drawn.** The provider runs the detector while listing (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:244`) and the tree has a badge for it (`web-app/src/app/features/entities/entities-tree.component.ts:122`), but the badge reads its value through a guard that requires `providerType` on the topic (`web-app/src/app/core/models/topic.model.ts:146`, `web-app/src/app/core/models/topic.model.ts:248`), and no model on the server has that property and no code in the app sets it. Even with the guard open the name would not resolve: the API serialises enums as strings (`src/ServiceBusExplorer.Api/Program.cs:59`) and the app's pattern enum is numeric (`web-app/src/app/core/models/topic.model.ts:179`). Read from code, not executed in a browser.
- **`DetectQueuePattern` has no caller** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:85`). Hello World, Work Queues and RPC, the three tutorials with no named exchange, can therefore never be reported: the default exchange is filtered out of the list (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:222`). [[pages/services/core]] says the detector "classifies exchanges"; that is all it does.
- **The audit's "kills the shared channel" is, on a stream, "kills the connection".** `basic.get` on a stream is answered with 540 NOT_IMPLEMENTED, which closes the whole connection (executed; the refusal is in the broker source, https://github.com/rabbitmq/rabbitmq-server/blob/v4.3.x/deps/rabbit/src/rabbit_stream_queue.erl). The same for `queue.purge`.
- **Peek on a quorum queue leaves a counter on the message.** Each get and requeue raises `x-acquired-count`; a reject with requeue also raises `x-delivery-count`, which counts toward the delivery limit, 20 by default since RabbitMQ 4.0 (executed for both headers and the default; https://www.rabbitmq.com/docs/quorum-queues). The audit had this as PLAUSIBLE.
- **A queue bound with several keys appears as several subscriptions with one name** (one `SubscriptionInfo` per binding, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:358`), and the tree builds its node id from that name (`web-app/src/app/core/services/tree-data-builder.service.ts:202`). This is tutorial 4 exactly. Not in the audit.

## What holds for every scenario

**How the app maps RabbitMQ today.** One tree titled "Service Bus Entities" (`web-app/src/app/features/entities/entities-tree.component.ts:37`) with two categories, Queues and Topics. Every queue of the virtual host is a queue (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:126`). Every exchange except the default one and `amq.*` is a "topic" (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:222`); every binding whose source is that exchange is a "subscription" named after its destination, with the binding key as a rule called `RoutingKey` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:471`). The queue model already carries type, durable, exclusive, auto-delete, consumer count, ready and unacknowledged counts (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Models/RabbitMQQueueInfo.cs:47`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/Models/RabbitMQQueueInfo.cs:52`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/Models/RabbitMQQueueInfo.cs:57`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/Models/RabbitMQQueueInfo.cs:114`) and the app's model has the fields (`web-app/src/app/core/models/queue.model.ts:75`), but the one shared panel draws none of them: it shows the Azure header, "Active Messages" and the Azure properties (`web-app/src/app/features/entities/entity-details.component.ts:71`, `web-app/src/app/features/entities/entity-details.component.ts:100`). The RabbitMQ panel that would draw them (`web-app/src/app/providers/rabbitmq/components/rabbitmq-entity-details.component.html:258`) is mounted nowhere ([[pages/services/web-app]]).

**What a read changes today.** Listing is passive: HTTP GETs on the management API. Reading messages is not:

| Operation today | What it does to the broker | Source |
|---|---|---|
| Peek (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:522`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:529`) | `basic.get` then `basic.nack` with requeue, once per requested message, on the one shared channel (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:17`). Returns the head N times. The head is marked redelivered for whoever consumes it next. On a quorum queue its `x-acquired-count` rises by N. While a message is held, a live consumer is handed the one behind it. | Head repeated: `src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:74`. Flag and counter: executed. "Redeliveries will have a special boolean property, `redeliver`, set to `true`": https://www.rabbitmq.com/docs/confirms |
| Peek of an exclusive queue of another connection | The broker answers 405 RESOURCE_LOCKED and closes the channel (executed). The provider's only channel is then dead while `IsConnected` stays true, the mechanism already pinned for a missing dead-letter queue (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:115`). | "Exclusive: used by only one connection": https://www.rabbitmq.com/docs/queues |
| Peek, receive or purge of a stream | 540 NOT_IMPLEMENTED, connection closed (executed). | broker source, above |
| Subscriptions of an exchange | Passive, but two HTTP calls per binding: the queue and a probe for `<queue>.dlq` (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:360`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:362`). | code |
| Receive, purge, bulk delete, resubmit, move | Destructive by request; the bulk three lose messages ([[pages/invariants/bulk-operations-are-at-least-once]]). | [[pages/roadmap/code-audit-2026-11]] |

**What a safe read is, per queue type.**

- **Classic or quorum queue: there is no read that leaves no trace.** AMQP 0-9-1 has no browse. The least harmful read is: a channel opened for this one read; `basic.get` without acknowledging, N times, holding all N; then one `basic.nack` with `multiple` and `requeue`; close the channel. It returns N different messages in queue order and puts them back in their place (executed on a classic queue: held `c0 c1 c2`, order afterwards `c0 c1 c2 c3`; "it will be placed to its original position in its queue, if possible", https://www.rabbitmq.com/docs/confirms). Its costs, which the screen states instead of hiding: every returned message is flagged redelivered from then on; on a quorum queue `x-acquired-count` rises by one per read; for the milliseconds of the hold a live consumer does not get those messages. `basic.nack` does not raise the quorum `x-delivery-count` and `basic.reject` does (table on https://www.rabbitmq.com/docs/quorum-queues, executed through the management API's two requeue modes), so the read uses nack and never reject, and never lets the channel die with messages held (a lost connection counts as a delivery, same table). Since 4.3 the delivery limit is evaluated against the delivery count; whether a 4.0 to 4.2 broker counts a nack toward the limit is **not verified**, so on a quorum queue of a broker older than 4.3 the screen warns before a peek.
- **Never a consumer on a queue for a read.** `basic.consume` followed by a cancel deletes an auto-delete queue with the messages in it (executed: after one consume and cancel the queue answered 404; "deleted when last consumer unsubscribes", https://www.rabbitmq.com/docs/queues). A get does not (executed). A consumer would also enter the round-robin of a work queue and take deliveries from the real workers.
- **Not the management API's `get` for the read path.** It can do the same hold and requeue in one HTTP call, but the reference calls it "intended for development and troubleshooting only" (https://www.rabbitmq.com/docs/http-api-reference), its JSON breaks this client on a message with no properties (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:188`), and the bulk rebuild needs the AMQP hold anyway: one mechanism, not two.
- **Exclusive queue: no read exists.** Only the declaring connection may touch it. The app shows the queue, its owner connection and its counts from the management API (`owner_pid_details`, executed) and offers no message view.
- **Stream: a real non-destructive read exists** and it is a consumer with an offset. See "Streams, in depth".

**Identity of a peeked message.** RabbitMQ has no sequence number and the peek returns none (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:967`), which breaks the bulk UI ([[pages/roadmap/code-audit-2026-11]]). The audit's answer stands: the peek emits a key derived from message id, body, routing key and timestamp, and a bulk action finds its targets by that key inside a held window, never by position. On a stream the key is the offset, which is a broker fact.

**Round trips the management API costs today.** Listing topics is one call for the exchanges, one for all queues, then one per exchange for its bindings (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:219`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:225`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:234`); the tree then asks for the subscriptions of every exchange, two calls per binding. For E exchanges and B bindings: 2 + E + E + 2B. The target for every scenario below is **four calls for the whole tree whatever its size**: `GET /api/queues/{vhost}`, `GET /api/exchanges/{vhost}`, `GET /api/bindings/{vhost}`, `GET /api/consumers/{vhost}` (all on https://www.rabbitmq.com/docs/http-api-reference), grouped in memory, each restricted with the `columns` parameter the same page documents. List endpoints page at 100 by default and 500 at most (same page); a virtual host with more queues than that needs the paging loop, which the client does not have today.

## The scenarios

Each scenario lists: the topology the tutorial builds; what a person exploring it wants; what the app shows today and what the detector says; what is wrong; how to represent it; what to build; performance; security. The topology facts are the tutorial's source lines.

### Q1. Hello World

- **Topology.** One queue `hello`: `QueueDeclareAsync(queue: "hello", durable: true, exclusive: false, autoDelete: false, arguments: { "x-queue-type": "quorum" })`. No exchange declared: the sender publishes to the default exchange, `BasicPublishAsync(exchange: string.Empty, routingKey: "hello", body: body)`, with no properties at all. One consumer, automatic acknowledgement: `BasicConsumeAsync("hello", autoAck: true, consumer: consumer)`. No prefetch.
- **Wants.** To see the queue, that it is a durable quorum queue, how many messages wait, whether anyone consumes, and to read a waiting message without taking it from the consumer.
- **Today.** The queue is listed with its counts. The panel does not show its type, its durability or its consumer count. No pattern is reported, because no named exchange exists; that silence is correct by accident. A message published with no properties peeks correctly over AMQP (content type shown as `application/octet-stream`, a message id invented per peek, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:953`). With the consumer running the queue is empty and there is nothing to read, which is also correct: an auto-acknowledging consumer leaves nothing behind.
- **Wrong or missing.** Peek repeats the head and marks it redelivered (audit P2). The invented message id changes on every peek, so it looks like a property of the message. Queue type, durable and consumers are not drawn.
- **Represent.** Tree: the queue under Queues with a type chip `quorum`. Panel: Ready, Unacknowledged, Consumers; Type, Durable, Auto-delete, Exclusive, Arguments. Message view: the safe read above, labelled "Peek (get and requeue)", with one line stating its cost. A property the message does not have is shown as absent, never invented.
- **Build.** Core: the hold-then-one-nack peek on a channel of its own; stop inventing `MessageId`; a peek key. API: nothing new. Web: the RabbitMQ fields on the shared panel, gated on the provider.
- **Performance.** Peek of N: N `basic.get` round trips and one nack, bounded by the API's cap of 1000 (`src/ServiceBusExplorer.Api/Controllers/QueuesController.cs:158`); default 10. Recommended cap for RabbitMQ: 100 held at once, because the hold takes messages out of delivery.
- **Security.** Rule A unchanged (same routes). The read marks messages redelivered; an application that treats a redelivered message differently will see it. Stated on the screen.

### Q2. Work Queues

- **Topology.** One queue `task_queue`, durable quorum, same declaration as Q1 with the other name. Publisher: default exchange, `routingKey: "task_queue"`, `mandatory: true`, `basicProperties` with `Persistent = true`. Two or more workers, each with `BasicQosAsync(prefetchSize: 0, prefetchCount: 1, global: false)`, `BasicConsumeAsync("task_queue", autoAck: false, ...)` and `BasicAckAsync(deliveryTag, multiple: false)` after the work. The broker round-robins; an unacknowledged message returns to the queue if its worker dies.
- **Wants.** How many workers are attached, each one's prefetch and acknowledgement mode, how many messages are being worked on (unacknowledged) against how many wait (ready); to read a waiting task without becoming a worker.
- **Today.** Listed as a queue with "Active Messages" equal to ready (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:542`); unacknowledged and consumer count are mapped and not drawn. No pattern is reported. The uncalled queue detector would say Work Queue only while two or more workers are connected (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:96`), Hello World with one (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:114`) and nothing with none: the same queue under three names depending on the hour.
- **Wrong or missing.** Everything of Q1. The topology of Q1 and Q2 is identical in the broker; what differs is the consumers, and the consumers are facts the management API returns (`prefetch_count`, `ack_required`, the channel, per consumer; executed on `GET /api/consumers`). Send from the app is persistent (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:859`) but sets no `mandatory` flag.
- **Represent.** No "Work Queue" label. Panel: a Consumers table (consumer tag, connection, prefetch, manual or automatic acknowledgement) and the two counts side by side, "Ready 12, Unacknowledged 2 (with 2 consumers)". That is the work queue, said in the broker's words.
- **Build.** Core: consumers of a queue from `GET /api/consumers/{vhost}`, grouped by queue; persistence (`delivery_mode`) on the peeked message. API: `GET api/queues/{name}/consumers`. Web: the Consumers table.
- **Performance.** One call for all consumers of the virtual host, part of the four-call tree.
- **Security.** A held peek on a busy work queue changes which worker gets which task for the duration of the hold and marks the peeked tasks redelivered. The peek never registers a consumer. Receive from the app on a work queue takes a task no worker will ever do: it is the destructive action, behind the confirmation of [[pages/conventions/ui]] that names queue, connection and count.

### Q3. Publish/Subscribe

- **Topology.** A fanout exchange `logs`: `ExchangeDeclareAsync(exchange: "logs", type: ExchangeType.Fanout)` (durability left at the client's default, not verified). Each receiver declares a server-named queue with `QueueDeclareAsync()` and no argument, which the tutorial describes as "a non-durable, exclusive, autodelete queue with a generated name" such as `amq.gen-JzTY20BRgKO-HjmUJj0wLg`, binds it with `QueueBindAsync(queue: queueName, exchange: "logs", routingKey: string.Empty)` and consumes with `autoAck: true`. The publisher sends `BasicPublishAsync(exchange: "logs", routingKey: string.Empty, body: body)`; the key is ignored by a fanout. With no receiver running there is no queue and the message is dropped, which the tutorial accepts.
- **Wants.** The exchange, its type, who is bound right now, and that those queues belong to live connections and vanish with them. Not to read their messages: they are consumed on arrival.
- **Today.** The exchange is a "topic" with one "subscription" per receiver, each named `amq.gen-...`; the same queues are listed again under Queues. The detector says Pub/Sub at 0.9 with two receivers (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:168`), at 0.7 with one (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:185`) and "None" with confidence 0.5 with none; right for the type, and not drawn. Opening View Messages on a receiver's queue kills the provider's channel (table above). Send to the exchange from the app with an empty subject goes to the default exchange and is dropped with a success answer (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:216`).
- **Wrong or missing.** The peek on an exclusive queue; the send; the words (a fanout exchange is not a topic and a binding is not a subscription); the two HTTP calls per binding; the invented dates.
- **Represent.** Tree: an Exchanges category; the exchange with a `fanout` chip; under it its bindings, each "to queue `amq.gen-...`". The queue itself appears once, under Queues, with chips `exclusive` and `auto-delete` and its owner connection. Panel of the exchange: type, durable, auto-delete, internal, bindings table (destination, destination type, key, arguments). Panel of an exclusive queue: counts and owner; no message actions.
- **Build.** Core: bindings from one `GET /api/bindings/{vhost}` grouped by source; a typed binding list on the exchange instead of subscriptions; `owner_pid_details` on the queue; send to an exchange takes the exchange and the routing key as two explicit values, with `mandatory` and a confirm. API: `GET api/exchanges`, `GET api/exchanges/{name}/bindings`, or the same data on the existing topic routes with honest field names (decision in Open questions). Web: the Exchanges category for RabbitMQ; message actions hidden when `exclusive` is true.
- **Performance.** Receivers come and go: the tree is a snapshot; refresh is the user's action, no polling of bindings.
- **Security.** Reading the topology is passive. The app never declares, binds or consumes to "see what flows": a tap would be a new queue on a production exchange, and that is a create action the user asks for, not a read.

### Q4. Routing

- **Topology.** A direct exchange `direct_logs`: `ExchangeDeclareAsync(exchange: "direct_logs", type: ExchangeType.Direct)`. Each receiver: a server-named exclusive queue, and **one binding per severity** it wants, `QueueBindAsync(queue: queueName, exchange: "direct_logs", routingKey: severity)` in a loop over `info`, `warning`, `error`. Publisher: `BasicPublishAsync(exchange: "direct_logs", routingKey: severity, body: body)`. Consumers `autoAck: true`.
- **Wants.** Which keys lead to which queue; that one queue holds several bindings; to send a test message with a chosen key and see where it would go.
- **Today.** The detector says Routing at 0.9 when two or more distinct keys are bound (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:224`), **Hello World at 0.7 when the exchange has a single binding** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:243`), which is wrong: Hello World is the default exchange. A receiver bound with three severities is three "subscriptions" with the same name. Deleting that "subscription" removes the first binding found and leaves the others (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:455`). Sending with the severity typed in "Subject / Label" (`web-app/src/app/features/messages/send-message-dialog.component.ts:144`) does route.
- **Wrong or missing.** A binding has no identity in the app: the broker identifies it by source, destination and `properties_key` (https://www.rabbitmq.com/docs/http-api-reference), the app by destination name alone. The field that carries the routing key is called Subject.
- **Represent.** The bindings table of Q3, here with the key column filled: `error -> amq.gen-A`, `info -> amq.gen-B`, `warning -> amq.gen-B`, `error -> amq.gen-B`. On a queue's panel, the reverse: "Bound to `direct_logs` with keys info, warning, error" (`GET /api/queues/{vhost}/{name}/bindings`, already in the client, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:399`, and unused). The send dialog on RabbitMQ labels the field "Routing key".
- **Build.** Core: binding identity (`properties_key`) through to delete; a queue's own bindings. API and web: delete a binding by its identity, with the confirmation naming exchange, key and queue.
- **Performance.** Covered by the single bindings call.
- **Security.** Deleting a binding stops delivery to a production consumer at once and silently: disruptive, confirmed, and it must delete the binding the user pointed at.

### Q5. Topics

- **Topology.** A topic exchange `topic_logs`: `ExchangeDeclareAsync(exchange: "topic_logs", type: ExchangeType.Topic)`. Receivers as in Q4, binding keys are patterns of dot-separated words where `*` is one word and `#` is zero or more (the page's examples: `*.orange.*`, `*.*.rabbit`, `lazy.#`, `kern.*`, `*.critical`, `#`). Publisher: routing key `<facility>.<severity>`, for example `kern.critical`. A key is at most 255 bytes.
- **Wants.** The patterns; which queues a given key would reach.
- **Today.** The detector says Topics at 0.9 when any binding has a wildcard (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:284`) and at 0.7 otherwise (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:300`): right, and not drawn. The binding key is shown as the rule of the "subscription", which is the nearest thing to correct in the whole mapping. Creating a "subscription" with no key binds with `#` on any exchange type (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:400`), which on a direct exchange is a literal key that matches nothing.
- **Wrong or missing.** Same as Q4. The sample broker of [[pages/runbooks/local-brokers]] is this scenario (`orders`, topic, keys `order.created` and `order.#`), with durable named queues, which is how it looks in production; the tutorial's exclusive queues are the other half.
- **Represent.** As Q4, chip `topic`. A small pure function in the panel, "which bindings match this key", evaluated in the browser over the bindings already loaded: no broker call, no message sent.
- **Build.** Web only, beyond Q3 and Q4: the matcher (words, `*`, `#`) with a spec per example of the tutorial page.
- **Performance.** None at the broker.
- **Security.** The matcher sends nothing. A test send to a production topic exchange reaches every matching consumer: the send confirmation lists the queues the key matches before sending.

### Q6. RPC

- **Topology.** Server: queue `rpc_queue`, durable quorum (same declaration as Q1), `BasicQosAsync(prefetchSize: 0, prefetchCount: 1, global: false)`, `BasicConsumeAsync("rpc_queue", false, consumer)`; for each request it publishes the result to the default exchange with `routingKey: props.ReplyTo`, `mandatory: true` and `CorrelationId = props.CorrelationId`, then acknowledges the request. Client: a server-named exclusive callback queue (`QueueDeclareAsync()`), consumed with automatic acknowledgement; each request goes to the default exchange with `routingKey: "rpc_queue"`, `mandatory: true`, and properties `CorrelationId` (a new value per request) and `ReplyTo` (the callback queue's name); a reply whose correlation id is unknown is discarded. No named exchange anywhere. The tutorial does not use direct reply-to; where an application does, the reply "queue" is the pseudo-queue `amq.rabbitmq.reply-to`, which "does not appear in the management plugin" (https://www.rabbitmq.com/docs/direct-reply-to; executed: not in the queue list).
- **Wants.** The request queue and its server (Q2's consumer table), the requests waiting with their `reply_to` and `correlation_id`, and whether the queue a request names still exists; replies are consumed on arrival and are not there to read.
- **Today.** `rpc_queue` is a queue like any other; the callback queue is listed as `amq.gen-...`. `reply_to` and `correlation_id` are mapped (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:954`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:958`) and the detail pane shows both (`web-app/src/app/features/messages/view-messages-dialog.component.ts:322`, `web-app/src/app/features/messages/view-messages-dialog.component.ts:360`). No pattern is reported for this topology. The exchange detector's RPC rule looks for queue names containing "req" and "reply" or "resp" bound to one named exchange (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:390`), which the tutorial never produces and which "requisitions" and "responders" do. The uncalled queue detector would call any exclusive or `amq.gen-` queue an RPC reply queue (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:441`, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:447`), that is every receiver of Q3, Q4 and Q5.
- **Wrong or missing.** Nothing ties a request to its reply queue. Peeking `rpc_queue` holds a caller's request away from the server for the hold; a caller with a timeout feels it.
- **Represent.** No RPC entity: the broker has none. In the message view a request shows Reply to and Correlation id at the top of the detail, and Reply to is a link when a queue of that name exists, a plain "direct reply-to (not a queue)" when it starts with `amq.rabbitmq.reply-to`, and "queue no longer exists" otherwise. The callback queue is an exclusive queue as in Q3.
- **Build.** Web: the three states of the Reply to field, resolved against the loaded tree. Last and only if asked: "Send a reply" that fills the send dialog with the default exchange, the reply queue as routing key and the same correlation id.
- **Performance.** None beyond the tree.
- **Security.** A reply sent by hand is delivered to a production caller as if the server had answered: it carries the strongest send confirmation, naming the caller's queue and the correlation id. It is the last item of the last phase for that reason.

### S1. Stream Hello World

- **Topology.** Client `RabbitMQ.Stream.Client` (the page uses 1.8.0), over the stream protocol on port 5552, which needs the plugin: `rabbitmq-plugins enable rabbitmq_stream rabbitmq_stream_management`, and for the container the page starts, `-p 5552:5552` and `RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS='-rabbitmq_stream advertised_host localhost'`. `StreamSystem.Create(new StreamSystemConfig())`; the stream is `CreateStream(new StreamSpec("hello-stream") { MaxLengthBytes = 5_000_000_000 })` ("always define the retention policy"); `Producer.Create(new ProducerConfig(streamSystem, "hello-stream"))` and `producer.Send(new Message(Encoding.UTF8.GetBytes("Hello, World")))`, without the confirmation handler; `Consumer.Create(new ConsumerConfig(streamSystem, "hello-stream") { OffsetSpec = new OffsetTypeFirst(), MessageHandler = ... })`. In the broker a stream is a queue whose type is `stream`: always durable, never exclusive, an append-only log "that can be repeatedly read until they expire"; retention is by size (`x-max-length-bytes`) or age (`x-max-age`), "evaluated on per segment basis" (https://www.rabbitmq.com/docs/streams).
- **Wants.** To see that it is a stream, its retention, how much it holds, who reads it, and to read from the start, from the end, from an offset or from a time, as often as wanted, without affecting anyone.
- **Today.** Listed under Queues with a message count (executed: the management API reports `type: stream` and `messages_ready` equal to what was published; the mapper keeps the type, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:552`, and `x-max-length-bytes`). Nothing on screen says it is a stream. View Messages, Receive and Purge each end the AMQP connection.
- **Wrong or missing.** Every message operation. The panel offers Purge on it (`web-app/src/app/features/entities/entity-details.component.ts:86`).
- **Represent, build, performance, security.** Under "Streams, in depth".

### S2. Stream Offset Tracking

- **Topology.** Same client and stream (`new StreamSpec(stream)`, no retention argument in this one). The producer uses a `ConfirmationHandler`, sends 100 messages and the last body is `marker`. The consumer has a name, `Reference = "offset-tracking-tutorial"` ("the consumer must a have name"), and stores its position on the server: `await consumer.StoreOffset(context.Offset)` every 10 messages (the page calls that "an unusually low value") and once more at the marker. On start it asks `await streamSystem.QueryOffset(consumerName, stream)`; `OffsetNotFoundException` means first run and `OffsetTypeFirst()`, otherwise `new OffsetTypeOffset(storedOffset + 1)`. "RabbitMQ Streams provide server-side offset tracking to store the progress of a given consumer in a stream." The offsets are "persisted in the stream itself as non-message data", and server-side tracking is "currently only available when using the Stream plugin" (https://www.rabbitmq.com/docs/streams).
- **Wants.** For a named consumer: where it is, how far behind the end; and to read around that position to see what it will get next.
- **Today.** Nothing: the provider has no stream protocol client and the management API has no endpoint for tracked offsets (the stream endpoints are connections, publishers and consumers only, https://www.rabbitmq.com/docs/http-api-reference).
- **Represent, build, performance, security.** Under "Streams, in depth".

## Streams, in depth

**Why the current peek cannot work.** It is `basic.get`, and a stream refuses it: "basic.get not supported by stream queues" with 540, which is a connection error, so the provider is disconnected, not just refused (executed; broker source cited above). Requeue has no meaning either: a stream never removes a message on acknowledgement.

**The two ways to read one.**

| | AMQP 0-9-1, the client the project has | Stream protocol, `RabbitMQ.Stream.Client` |
|---|---|---|
| How | A channel; `BasicQos` with a prefetch count; `BasicConsume` with `autoAck: false` and the consumer argument `x-stream-offset`; collect; `BasicCancel`; close | `StreamSystem`, `Consumer.Create` with an `OffsetSpec` |
| Broker side | Built in, port 5672 (https://www.rabbitmq.com/docs/stream-core-plugin-comparison) | Plugin `rabbitmq_stream` must be enabled; port 5552, TLS 5551 (https://www.rabbitmq.com/docs/stream) |
| Positions | `first`, `last` (the last written chunk), `next`, a numeric offset (clamped to the log), a timestamp, an interval such as `7D` (https://www.rabbitmq.com/docs/streams); all six executed | `OffsetTypeFirst`, `OffsetTypeLast`, `OffsetTypeNext`, `OffsetTypeOffset`, `OffsetTypeTimestamp` |
| The message's offset | The `x-stream-offset` header of each delivery (executed: 0, 1, 2, ...; the broker sets it, source cited above) | `context.Offset` |
| Tracked offsets | None: "Use external store" (comparison page) | `QueryOffset(reference, stream)`, `StoreOffset` |
| Throughput | "Hundreds of thousands per second" (same page); irrelevant for a viewer | "Millions" |
| Cost to the product | Nothing new: no dependency, no port, no setting | A dependency (net8.0, net9.0, net10.0 assets), a second port in the connection form and the firewall, and the advertised host: the client is told where the stream's nodes are and connects there (`stream.advertised_host`, `stream.advertised_port`), which fails through NAT, a tunnel or a container unless an address resolver is configured (not verified here) |

**Reading from a position without affecting anyone, and without storing anything.** Over AMQP 0-9-1, executed: reading `first` twice in a row returned the same five messages with offsets 0 to 4, none flagged redelivered; afterwards the stream reported the same count and zero consumers. No acknowledgement was sent: on a stream the acknowledgement is only "a credit mechanism to advance the current offset of the consumer" (https://www.rabbitmq.com/docs/streams), so the prefetch count is the bound of the read and nothing more arrives. Nothing is stored: a 0-9-1 consumer has no reference name and the server tracks nothing for it. The traces are a consumer visible in `GET /api/consumers` for the duration (with its `x-stream-offset` argument, executed) and the stream's delivery counter in the statistics. The broker's requirements, each executed: a prefetch must be set (406 without), automatic acknowledgement is refused (540), global QoS is refused (source). An offset past the end, `next`, or an empty stream deliver nothing, so the read ends on a time bound, not on a count.

**Recommendation.** Phase one of streams is the AMQP 0-9-1 read on 6.8.1: it satisfies S1 completely and the reading half of S2, on every broker, with no new dependency. The stream protocol client comes second and only for what 0-9-1 cannot do, which is showing a tracked offset; it is optional per connection (a "Stream port" field left empty means the feature is off), lives entirely inside `Providers/RabbitMQ/` (Rule F), and its password is the same secret already masked (Rule G; a new field for it would join the mask in the same change).

**Tracked offsets (S2): show, and edit only on the owner's word.** Showing needs the consumer's reference name, and nothing enumerates the names stored in a stream: the app can offer the names of the stream consumers connected now (`GET /api/stream/consumers`, plugin `rabbitmq_stream_management`; whether each row carries the reference is not verified) and a field to type one. For a name: stored offset, the stream's last offset, the difference, and "Read from here". Whether the client exposes the first and last offset of a stream as `StreamStats` with `FirstOffset()` and `CommittedChunkId()` is from a summary of its documentation, not verified. Editing is `StoreOffset` under that name: it moves where a production consumer resumes, forward loses messages for it and backward replays them. If built at all it is a destructive action with the typed confirmation, shows old and new offset, and refuses while a consumer of that name is connected. Open question.

**What is never offered on a stream.** Purge (the broker refuses it; retention is the only removal). Receive and delete (nothing removes one message). Move, bulk delete, dead-letter and resubmit (no removal from the source, no dead-letter exchange for a stream: the feature matrix of https://www.rabbitmq.com/docs/streams). What remains: read from a position, send, copy a read message to another queue (a send), delete the stream itself (an entity action with the typed name). These are capability flags the UI reads, not buttons that fail ([[pages/invariants/provider-boundaries]]).

**Representation.** A stream stays under Queues, because in the broker it is a queue, with the chip `stream`. Its panel: Messages (labelled approximate: the count can be "artificially larger" because tracking data is counted, https://www.rabbitmq.com/docs/streams), retention (max bytes, max age, segment size), consumers. Its message view replaces the Active and Dead-letter tabs with one position bar: Start, End, Offset, Time, and "Older" and "Newer" by offset; each row shows its offset where a queue row would show nothing.

**One abstraction with Azure Event Hubs.** A survey written in parallel proposes, for Event Hubs, an abstraction for "read from a position without removing" over partitions and offsets. Its facts are that survey's; none was verified here. The two things share the shape: an append-only log with retention, a read that removes nothing and can be repeated, a position that is the start, the end, an offset or a time, an offset on every message, and a consumer position stored apart from the reading itself. They differ in ways the abstraction must leave room for: an event hub is a set of partitions and every read names one, while a RabbitMQ stream is a single log (its partitioned form, the super stream, is out of scope), so a stream is the case of exactly one partition; the positions do not coincide exactly (`last` is a chunk in RabbitMQ; the relative interval exists only there); where a consumer's position is stored and what names it differ entirely (a reference name inside the stream, against a consumer group and a store outside the broker), so tracked positions should stay a provider-specific panel and not be forced into the shared member; and the transports differ, which Rule F already hides. **One abstraction can serve both** for the read: one member on `IMessagingProvider` taking the entity, an optional partition, a position (kind and value), a maximum count and a maximum wait, returning messages that carry their offset and partition; one capability flag; and the list of what is not offered on a log. With two concrete users it is not premature (Rule C). **The decision belongs in one ADR covering both brokers**, written when both surveys are in; neither page should create the interface alone.

**Performance.** One channel and one short-lived consumer per read; prefetch equal to the page size (default 50, cap 500); a wait bound of two seconds without a delivery; bodies above a display limit are truncated in the answer and fetched whole on request. A timestamp position attaches at a chunk boundary, so the first rows can be earlier than the time asked; the screen says "from the chunk containing".

**Security.** The read creates a consumer and removes nothing: it is the one RabbitMQ read that fully meets the owner's rule. It still costs the broker work, so it is bounded and never runs unattended (no live tail by default). The routes are ordinary routes behind the key (Rule A).

## The test plan

**Where and against what.** `src/ServiceBusExplorer.IntegrationTests`, collection `RabbitMQ`, the container the fixture already starts: `rabbitmq:4.3.7-management` (`src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:19`), under [[pages/decisions/0002-integration-tests-against-brokers-in-docker]]: no skipped test, only the broker the run starts. Unit tests go to `src/ServiceBusExplorer.Core.Tests`, which has no detector test today ([[pages/services/core]]) and already sees the internals of Core.

**What the fixture needs.**

- For Q1 to Q6 and for the app's side of S1 and S2: nothing. A stream is declared and read over AMQP 0-9-1 on the stock image (declaring and the refusals were executed with only the management plugins on).
- For S1 and S2 arranged "with the client the tutorial uses": the test project (not Core) references `RabbitMQ.Stream.Client`; the fixture enables the plugin after start with one exec, `rabbitmq-plugins enable rabbitmq_stream rabbitmq_stream_management` (executed on the running container: both started with no restart), and binds container port 5552 to a random host port beside `src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:35`. Because the host port is random, the advertised port cannot be set before start; the stream client must be given the mapped endpoint through its address resolver (`StreamSystemConfig.AddressResolver`, from a summary of the client's documentation, not verified). If that cannot be made to work, the arrange falls back to the same stream written over AMQP 0-9-1 and the page says so; the app's assertions do not change.
- **One deviation, stated.** The queue tutorials use `RabbitMQ.Client` 7; the test project gets 6.8.1 through Core and cannot hold both. Each arrange therefore makes the tutorial's calls with the 6.8.1 members of the same name (`QueueDeclare`, `ExchangeDeclare`, `QueueBind`, `BasicQos`, `BasicConsume`, `BasicPublish`) and the same arguments. The topology in the broker is the same; the arranges are rewritten when the project moves to 7.
- New fixture helpers, all on the observer connection that already exists (`src/ServiceBusExplorer.IntegrationTests/RabbitMqFixture.cs:84`): declare a quorum queue; start a worker (prefetch, manual acknowledgement, holds its deliveries); start a subscriber (server-named exclusive queue, bindings, returns the queue name and stays open); a snapshot of queues, bindings and consumers through the management API for the "left unchanged" assertions; a wait for the management statistics, which lag the broker by some seconds.

**Status column.** PASS: expected to pass on today's code; a failure when first run is a finding and becomes a `Defect_`. DEFECT: a `Defect_` test that asserts today's wrong behaviour, its `<summary>` starting "Correct:" as given, rewritten by the fix. FEATURE: needs a member that does not exist; it is the red test of that phase (Rule B). Tests that already exist are referenced, not counted.

### Q1. Hello World

| Test | Arrange | Act | Assert | Status |
|---|---|---|---|---|
| `Hello_world_queue_is_listed_as_a_durable_quorum_queue_with_one_ready_message` | Declare the tutorial's quorum queue; publish `Hello World!` to the default exchange with no properties | `GetQueueAsync`, `GetQueuesAsync` | Type `quorum`, durable, not exclusive, not auto-delete, ready 1, consumers 0 | PASS |
| `Hello_world_message_published_without_properties_is_peeked_with_its_body_and_routing_key` | Same | `PeekMessagesAsync(queue, 1)` | Body equal; subject equals the queue name; reply to and correlation id null; ready still 1 | PASS |
| `Hello_world_topology_lists_no_exchange_and_reports_no_pattern` | Same | `GetTopicsAsync` | No topic for this queue; the default exchange is not listed | PASS |
| `Peek_of_a_quorum_queue_marks_the_message_redelivered_and_raises_its_acquired_count` | Same | Peek 1; then the observer gets the head | `Redelivered` true; header `x-acquired-count` 1; no `x-delivery-count`; ready 1. Pins the documented cost of a read on a queue, which no implementation removes | PASS |
| `Defect_peek_invents_a_different_message_id_on_every_read` | Same | Peek twice | Two different non-empty ids. Correct: a message with no message id is shown with none | DEFECT |
| existing `Defect_peek_returns_the_head_message_count_times` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:74`) | | | Run it on a quorum queue as well when it is fixed | exists |

### Q2. Work Queues

| Test | Arrange | Act | Assert | Status |
|---|---|---|---|---|
| `Work_queue_with_two_workers_reports_two_consumers_two_unacknowledged_and_the_rest_ready` | Quorum `task_queue`; two workers with prefetch 1 and manual acknowledgement that do not acknowledge; publish 5 persistent with `mandatory` | `GetQueueAsync` | Consumers 2, unacknowledged 2, ready 3, active count 3 | PASS |
| `Peek_on_a_work_queue_leaves_its_workers_its_counts_and_its_order_unchanged` | Same | Snapshot; peek 1; snapshot; release the workers and collect what they receive | Consumers and counts equal before and after; the workers receive the three ready messages in publish order; the provider registered no consumer | PASS |
| `Send_to_a_work_queue_publishes_a_persistent_message_a_worker_receives` | One worker | `SendMessageAsync(queue, body)` | The worker's delivery has delivery mode 2 and the body | PASS |
| `Defect_a_peeked_task_does_not_say_it_is_persistent` | Publish one persistent, one transient | Peek each | Neither message exposes its delivery mode. Correct: the peek carries persistent or transient | DEFECT |
| `Consumers_of_a_work_queue_are_listed_with_prefetch_and_acknowledgement_mode` | Two workers | The new consumers member | Two rows, prefetch 1, manual acknowledgement | FEATURE |

### Q3. Publish/Subscribe

| Test | Arrange | Act | Assert | Status |
|---|---|---|---|---|
| `Fanout_exchange_with_two_receivers_is_listed_with_one_binding_per_receiver_and_empty_keys` | Fanout `logs`; two subscribers | `GetTopicsAsync` | Exchange type `fanout`; two bindings, destinations the two `amq.gen-` names, destination type queue, key empty | PASS |
| `Fanout_exchange_with_two_receivers_is_detected_as_publish_subscribe` | Same | `GetTopicAsync` | Pattern `PubSub`, confidence 0.9 | PASS |
| `Fanout_exchange_whose_receivers_left_has_no_binding_and_no_pattern` | Same, then close the subscribers' connection | `GetTopicAsync` | Exchange still listed; bindings empty; pattern `None`; the two queues gone from `GetQueuesAsync` | PASS |
| `A_receivers_queue_is_listed_as_exclusive_server_named_and_not_durable` | One subscriber | `GetQueuesAsync` | Name starts `amq.gen-`; exclusive true; durable false | PASS |
| `Listing_exchanges_and_subscriptions_leaves_queues_bindings_and_consumers_unchanged` | Two subscribers consuming | Snapshot; `GetTopicsAsync`, `GetSubscriptionsAsync`; snapshot | Snapshots equal | PASS |
| `Defect_peeking_a_receivers_exclusive_queue_fails_and_breaks_every_later_peek_while_still_connected` | One subscriber; one ordinary queue with a message | Peek the exclusive queue; peek the ordinary queue | First throws (405); second throws although `IsConnected` is true; the subscriber still consumes. Correct: an exclusive queue of another connection is refused with a clear error and later calls work | DEFECT |
| existing `Defect_send_to_a_fanout_exchange_without_subject_is_dropped_and_reports_success` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:216`) | | | | exists |

### Q4. Routing

| Test | Arrange | Act | Assert | Status |
|---|---|---|---|---|
| `Direct_exchange_is_listed_with_one_binding_per_severity` | Direct `direct_logs`; subscriber A bound `error`; subscriber B bound `info`, `warning`, `error` | `GetTopicAsync` | Type `direct`; four bindings with exactly those destination and key pairs | PASS |
| `Direct_exchange_with_several_keys_is_detected_as_routing` | Same | `GetTopicAsync` | Pattern `Routing`, 0.9 | PASS |
| `Send_with_a_severity_as_subject_reaches_only_the_queues_bound_with_it` | Same | Send with subject `error`, then `info` | A receives 1, B receives 2, in order, each with routing key equal to the severity | PASS |
| `Defect_a_direct_exchange_with_a_single_binding_is_detected_as_hello_world` | Only subscriber A | `GetTopicAsync` | Pattern `HelloWorld`. Correct: a direct exchange with a binding is routing; Hello World is the default exchange | DEFECT |
| `Defect_a_queue_bound_with_three_severities_is_listed_as_three_subscriptions_of_one_name` | Only subscriber B | `GetSubscriptionsAsync` | Three entries, same name, one rule each. Correct: one entry per binding with an identity, or one per queue carrying its three keys | DEFECT |
| `Defect_deleting_the_subscription_of_a_queue_bound_with_three_severities_removes_one_binding` | Only subscriber B | `DeleteSubscriptionAsync(exchange, queueB)` | Two bindings remain. Correct: the caller names the binding and exactly that one is removed | DEFECT |

### Q5. Topics

| Test | Arrange | Act | Assert | Status |
|---|---|---|---|---|
| `Topic_exchange_is_listed_with_its_binding_patterns` | Topic `topic_logs`; subscribers bound `kern.*`, `*.critical`, `#` | `GetTopicAsync`, `GetSubscriptionsAsync` | Type `topic`; three bindings with those keys; each subscription's rule equals its key | PASS |
| `Topic_exchange_with_wildcard_bindings_is_detected_as_topics` | Same | `GetTopicAsync` | Pattern `Topics`, 0.9 | PASS |
| `Topic_exchange_without_wildcards_is_detected_as_topics_with_lower_confidence` | One binding `kern.critical` | `GetTopicAsync` | Pattern `Topics`, 0.7 | PASS |
| `Send_with_subject_kern_critical_reaches_each_matching_queue_exactly_once` | The three subscribers and a fourth bound `kern.*` and `*.critical` both | Send with subject `kern.critical` | Each of the four receives one message; a send with `auth.info` reaches only `#` | PASS |

### Q6. RPC

| Test | Arrange | Act | Assert | Status |
|---|---|---|---|---|
| `Rpc_request_waiting_in_the_request_queue_is_peeked_with_reply_to_and_correlation_id` | Quorum `rpc_queue`, no server; a client with a server-named exclusive callback queue publishes `30` with correlation id and reply to | Peek 1 | Body `30`; reply to equals the callback queue; correlation id equal | PASS |
| `Peek_of_an_rpc_request_does_not_remove_or_answer_it` | Same; peek; then start the tutorial's server | Wait for the client's reply | The client receives one reply with its correlation id; the callback queue received nothing before the server started | PASS |
| `Rpc_topology_lists_no_exchange_and_reports_no_pattern` | Server and client running | `GetTopicsAsync` | Nothing for it | PASS |
| `Rpc_callback_queue_is_listed_as_exclusive` | Client running | `GetQueuesAsync` | The callback queue: exclusive true | PASS |
| `A_direct_reply_to_client_adds_no_queue_to_the_list` | A client consuming `amq.rabbitmq.reply-to` | `GetQueuesAsync` before and after | Same names | PASS |
| `A_message_sent_to_the_callback_queue_with_the_correlation_id_reaches_the_waiting_client` | Client waiting | `SendMessageAsync(callbackQueue, { CorrelationId })` | The client receives it with that correlation id (whether the default exchange delivers into another connection's exclusive queue is not verified; the run decides) | PASS |

### S1. Stream Hello World

| Test | Arrange | Act | Assert | Status |
|---|---|---|---|---|
| `Stream_is_listed_as_a_durable_queue_of_type_stream_with_its_size_retention` | The tutorial's stream with a max length in bytes; five messages | `GetQueueAsync` | Type `stream`; durable; `MaxLengthBytes` equal | PASS |
| `Stream_reports_its_published_messages_as_its_message_count` | Same | `GetQueueAsync` after the statistics wait | Active count 5, consumers 0 | PASS |
| `Defect_peeking_a_stream_disconnects_the_provider` | Same; one ordinary queue | Peek the stream; `IsConnected`; `GetQueuesAsync` | Throws; `IsConnected` false; the next call throws "Not connected"; the stream still holds 5. Correct: a stream is read from a position by a consumer and the provider stays connected | DEFECT |
| `Defect_purging_a_stream_disconnects_the_provider_and_removes_nothing` | Same | `PurgeMessagesAsync` | Throws; `IsConnected` false; 5 messages. Correct: purge is refused for a stream before the broker is called | DEFECT |
| `Defect_receiving_from_a_stream_disconnects_the_provider_and_removes_nothing` | Same | `ReceiveMessagesAsync` | Same. Correct: receive is refused for a stream | DEFECT |
| `Stream_read_from_the_start_returns_every_message_in_order_with_offsets_from_zero` | Same | The new read member, position start, count 10 | Five messages, bodies in order, offsets 0 to 4 | FEATURE |
| `Stream_read_twice_returns_the_same_messages_and_leaves_no_consumer_and_no_flag` | Same | Read start twice; snapshot | Equal results; no message redelivered; stream count 5; consumers 0; the tutorial consumer started afterwards with `OffsetTypeFirst` still receives all five | FEATURE |
| `Stream_read_from_an_offset_a_time_and_the_end_starts_where_asked` | Same | Offset 3; a time before the first publish; end | Offsets 3 and 4; all five; the last chunk | FEATURE |
| `Stream_read_past_the_end_returns_empty_within_the_wait_bound` | Same | Offset 99, wait 2 s | Empty, in under 3 s, provider still connected | FEATURE |
| `A_stream_read_whose_consume_is_refused_reports_the_failure_and_stays_connected` | A stream name that does not exist | The read | A typed not-found failure; a later read works. The failing-call test of Rule I | FEATURE |

### S2. Stream Offset Tracking

| Test | Arrange | Act | Assert | Status |
|---|---|---|---|---|
| `Stream_with_tracked_offsets_is_listed_as_a_stream_and_counts_at_least_its_messages` | Run the tutorial: 100 messages ending in `marker`; the named consumer stores every 10 and at the marker | `GetQueueAsync` | Type `stream`; active count at least 100 (tracking data may be counted) | PASS |
| `A_read_through_the_app_does_not_move_a_consumers_tracked_offset` | Same; note `QueryOffset` for the tutorial's reference (99) | Read from start, from offset 42 and from the end | `QueryOffset` still 99; a made-up reference still throws `OffsetNotFoundException` | FEATURE |
| `Stream_read_from_offset_42_returns_the_message_the_tutorial_consumer_saw_at_42` | Same; the consumer recorded body by offset | Read offset 42, count 1 | Same body, offset 42 | FEATURE |
| `The_last_message_of_the_stream_read_from_the_end_is_the_marker` | Same | Read end | The last row's body is `marker`, offset 99 | FEATURE |
| `The_tracked_offset_of_a_named_consumer_is_reported` | Same | The new tracked-offset member with the reference | 99; an unknown reference answers "none stored", not an error | FEATURE |
| `A_tracked_offset_query_against_a_broker_without_the_stream_port_reports_it_is_unavailable` | A config with no stream port | The same member | A typed "not available on this connection"; nothing thrown from the client library. Rule I | FEATURE |

### Unit tests for the pattern detector

In `src/ServiceBusExplorer.Core.Tests`, built from model objects, no broker.

| Test | Topology given | Assert | Status |
|---|---|---|---|
| `Fanout_exchange_with_two_bindings_is_publish_subscribe_at_high_confidence` | Q3, two receivers | `PubSub`, 0.9 | PASS |
| `Fanout_exchange_with_one_binding_is_publish_subscribe_at_medium_confidence` | Q3, one receiver | `PubSub`, 0.7 | PASS |
| `Defect_fanout_exchange_with_no_binding_reports_none_with_half_confidence` | Q3, none | `None`, 0.5. Correct: no pattern carries no confidence | DEFECT |
| `Direct_exchange_with_three_distinct_keys_is_routing` | Q4 | `Routing`, 0.9, metadata lists the three keys | PASS |
| `Defect_direct_exchange_with_a_single_binding_is_hello_world` | Q4, one binding | `HelloWorld`, 0.7. Correct: routing | DEFECT |
| `Topic_exchange_with_a_wildcard_binding_is_topics_at_high_confidence` | Q5 | `Topics`, 0.9 | PASS |
| `Topic_exchange_with_literal_keys_is_topics_at_medium_confidence` | Q5 without wildcards | `Topics`, 0.7 | PASS |
| `Defect_queues_named_requisitions_and_responders_on_one_exchange_are_reported_as_rpc` | Two ordinary queues with those names | Secondary pattern `RPC`. Correct: a name is not evidence | DEFECT |
| `Defect_publisher_confirms_is_never_reported_for_a_durable_bound_exchange` | Durable exchange, two bindings | No secondary `PublisherConfirms`, because the bound queue count it tests is never filled (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:363`). Correct: the detector makes no claim about confirms at all | DEFECT |
| `Queue_with_two_consumers_is_a_work_queue` | Q2, two workers | `WorkQueue`, 0.9 | PASS |
| `Defect_a_work_queue_with_one_worker_is_reported_as_hello_world` | Q2, one worker, default binding | `HelloWorld`. Correct: the same queue is not renamed by its consumer count | DEFECT |
| `Defect_a_publish_subscribe_receivers_exclusive_queue_is_reported_as_an_rpc_reply_queue` | Q3 receiver queue: exclusive, `amq.gen-`, two bindings | `RPC`, 0.7. Correct: exclusive and server-named describe every receiver of Q3 to Q6 | DEFECT |

One spec in `web-app`, in the project's own style: given the JSON the API sends for an exchange with a detected pattern, the tree node carries no pattern text (pins the badge that never renders). It is rewritten when the badge is decided.

### Totals

Integration, new: 48 (Q1 5, Q2 5, Q3 6, Q4 6, Q5 4, Q6 6, S1 10, S2 6); two existing `Defect_` tests are referenced and not counted. Of them **28 PASS, 9 DEFECT, 11 FEATURE**. Unit, new: 12, of them **6 PASS, 6 DEFECT**. Web: 1 DEFECT. In all **61 tests: 34 expected to pass today, 16 pinning a defect, 11 arriving with their feature.**

### What cannot be tested in the container, and why

- **A broker older than 4.3**, where the delivery limit of a quorum queue may count a requeue: the fixture pins one image. The claim stays "not verified" and the screen warns by broker version.
- **Clusters**: replicas of a quorum queue or a stream, leader location, a stream client redirected to another node. One node only.
- **TLS** on 5671, 5551 and the management API: the connection has no TLS field yet ([[pages/roadmap/code-audit-2026-11]]).
- **The advertised host through NAT or a tunnel**, the real failure mode of the stream protocol; a container on loopback hides it.
- **Timing claims**: that a held peek delays a worker, the 30 minute consumer timeout (https://www.rabbitmq.com/docs/consumers). The tests assert state, not latency.
- **Retention actually deleting segments**: it works per segment of 500 MB by default (https://www.rabbitmq.com/docs/streams); not worth a test's runtime.
- **The screens**: the integration project has no browser; the representation is covered by specs and the end-to-end run of [[pages/roadmap/tests-of-everything]].

## Representation table

| Scenario | Entity in the tree | Chip or label | The panel shows | Actions offered | Hidden |
|---|---|---|---|---|---|
| Q1 Hello World | Queue | `quorum` (or `classic`) | Ready, unacknowledged, consumers, durable, arguments | Peek (get and requeue), send, receive, purge behind confirmations | Lock duration, sessions, scheduled, any pattern name |
| Q2 Work Queues | Queue | `quorum`, "2 consumers" | The same, and a consumers table with prefetch and acknowledgement mode | The same; peek states that it holds tasks from the workers | "Work Queue" as a label |
| Q3 Publish/Subscribe | Exchange, with bindings beneath; each receiver's queue once under Queues | `fanout`; on the queue `exclusive`, `auto-delete` | Exchange: type, durable, bindings table. Queue: counts and owner connection | Exchange: send. Exclusive queue: none on messages | Peek, receive and purge on an exclusive queue; "Topic" and "Subscription" as words |
| Q4 Routing | Exchange with bindings | `direct` | Bindings as key to destination; on a queue, the keys it is bound with | Send with a routing key; delete one binding by identity | A queue shown three times |
| Q5 Topics | Exchange with bindings | `topic` | The same, and "which bindings match this key" | The same | |
| Q6 RPC | Request queue as Q2; callback queue as Q3's exclusive queue; nothing for direct reply-to | none specific | On a request: reply to and correlation id first, reply to resolved against the tree | Peek; later, "send a reply" behind the strongest confirmation | An "RPC" entity or badge |
| S1 Stream Hello World | Queue | `stream` | Approximate message count, retention, consumers | Read from start, end, offset or time; send; copy a message elsewhere | Purge, receive, move, bulk delete, dead-letter tab |
| S2 Offset Tracking | The same stream | `stream` | The same, and for a named consumer its stored offset and distance from the end | "Read from here"; editing an offset only if the owner says so | Everything S1 hides |

The detected pattern, where one is kept, is one quiet line in the exchange panel that states the fact it rests on ("fanout exchange, 2 bindings"), with no percentage. Recommended: drop the percentage, drop Hello World, RPC and Publisher Confirms as detected values, and let the exchange type chip carry the rest.

## Order

Each phase ships something safe by itself and is a pipeline lane with its tests.

1. **Pin first.** The 16 defect tests and the 34 passing ones above, with the fixture helpers. No product change. It converts every "read from code" on this page into an execution.
2. **Read safely.** Refuse a message operation on a stream and on an exclusive queue before the broker is called (capability by queue type; the three stream defects and the exclusive-queue defect turn green). Peek becomes hold-then-one-nack on its own channel, with a key and no invented id. The tree in four calls. The RabbitMQ facts on the panel: type, flags, counts, consumers. Words: Exchanges and Bindings. The pattern badge decided.
3. **Bindings with identity and the honest send.** One entry per binding; delete by identity; send to an exchange with an explicit routing key, `mandatory` and a confirm (Q3, Q4, Q5).
4. **The RabbitMQ bulk rebuild the audit calls for**, over AMQP with the peek key, behind a capability flag that is off until then ([[pages/roadmap/code-audit-2026-11]], [[pages/invariants/bulk-operations-are-at-least-once]]). The move to `RabbitMQ.Client` 7 is decided here, not before.
5. **Streams over AMQP 0-9-1**, after the one ADR with Event Hubs: the positional read, the position bar, the S1 tests and the reading half of S2.
6. **Tracked offsets** over the stream protocol, optional per connection: show only.
7. **RPC niceties and the key matcher**: the resolved reply-to, "send a reply", "which bindings match".

The screens are drawn first in the prototype ([[pages/conventions/ui]]) and built in Angular Material ([[pages/roadmap/ui-material-migration]]).

## Open questions for the owner

- **The pattern badge:** drop the guess and show the exchange type and the facts, as recommended, or keep a named pattern?
- **Peek on a queue with live consumers:** allowed with a stated cost, as proposed, or behind a confirmation each time? There is no read on a classic or quorum queue that leaves no trace.
- **Words and routes:** the tree says Exchanges and Bindings for RabbitMQ over the existing topic routes, or the API gains exchange and binding routes of its own?
- **Exclusive queues of other connections:** shown without message actions, as proposed, or hidden from the tree?
- **Streams:** AMQP 0-9-1 first and the stream protocol only for tracked offsets, as recommended?
- **Editing a tracked offset:** never, or as a destructive action with a typed confirmation?
- **`RabbitMQ.Client` 7:** with the bulk rebuild (phase 4), or before the stream read is written, so that it is written once?
