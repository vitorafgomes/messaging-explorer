---
title: "Local brokers in Docker"
version: "1.0"
date: 2026-11-12
changes: "Initial runbook"
page_type: runbook
status: active
description: "Start RabbitMQ and the Azure Service Bus emulator on this machine and connect the app to them, to try a change by hand without touching a real broker."
updated: 2026-11-12
source:
  - chat
  - "dev/brokers/docker-compose.yml"
  - "dev/brokers/haproxy.cfg"
  - "dev/brokers/servicebus-config.json"
  - "dev/brokers/rabbitmq-definitions.json"
reliability: high
---

# Local brokers in Docker

> Run this to try the app by hand against a RabbitMQ and an Azure Service Bus that hold nothing of value.

## When to run this

- Before a release, to open the packaged app and click through what changed; the automated suites do not open the app.
- To reproduce a report without a real namespace.
- Never as a substitute for the integration tests: those start their own containers on random ports and need nothing from here ([[pages/decisions/0002-integration-tests-against-brokers-in-docker]]).

## Start and stop

```bash
docker compose -f dev/brokers/docker-compose.yml up -d
docker compose -f dev/brokers/docker-compose.yml down -v
```

The Service Bus emulator answers about twenty seconds after `up`, once its SQL Server is ready. `down -v` discards every message and every entity created by hand; the sample entities come back on the next `up`. Starting the emulator and its SQL Server accepts their licence terms (`ACCEPT_EULA`), as the integration tests already do.

Every port is published on `127.0.0.1` only (`dev/brokers/docker-compose.yml:14`, `dev/brokers/docker-compose.yml:47`). The credentials in these files belong to throwaway containers and are used nowhere else.

## Connect the app

| Broker | In the connection dialog |
|---|---|
| Azure Service Bus | Connection string: `Endpoint=sb://localhost:5673;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;` |
| RabbitMQ | Host `localhost`, port `5672`, user `explorer`, password `explorer`, virtual host `/`, management port `15672` |

`SAS_KEY_VALUE` is the literal text the emulator expects, not a placeholder. The RabbitMQ management page is at `http://localhost:15672`.

## What is in them

- **Service Bus** (`dev/brokers/servicebus-config.json`): queues `orders` (30 s lock, 3 deliveries, dead-lettering on expiry), `billing/invoices` (sessions, a name with a slash) and `notifications`; topic `order-events` with subscriptions `warehouse` and `email`.
- **RabbitMQ** (`dev/brokers/rabbitmq-definitions.json`): exchanges `orders` (topic) and `orders.dlx` (fanout); queues `orders.created` (dead-letters to `orders.dlx`), `orders.audit` and `orders.failed`, with their bindings.

## Why there is a proxy in front of the emulator

The emulator serves messages over AMQP on one port and entity management over HTTP on another, while the app, as with a real namespace, takes one endpoint for both. The integration tests work around it with two providers per test ([[pages/conventions/testing]]). Here a small proxy listens on one port and sends a connection that opens with the bytes `AMQP` to the messaging port and everything else to the management port (`dev/brokers/haproxy.cfg:12`), so one connection string does both.

## Verified on 2026-11-12

With the packaged 2.4.0 API pointed at these containers: test connection, connect, list queues, topics and subscriptions, read one queue, read a queue whose name has a slash, send and peek on Service Bus; test connection, connect, list queues and exchanges, send and peek on RabbitMQ. The RabbitMQ peek returned the one message five times, the defect already recorded in [[pages/roadmap/code-audit-2026-11]].

## Limits

- The emulator does not partition, has no purge of a whole entity through the management API the app uses, and caps time to live at one hour ([[pages/conventions/testing]] lists what it leaves untested).
- Microsoft Entra sign-in cannot be tried here: the emulator takes the connection string only.
- If port 5672, 15672 or 5673 is taken on the machine, `up` fails for that service; change the left side of the port mapping.
