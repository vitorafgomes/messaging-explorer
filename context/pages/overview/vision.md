---
title: "Vision"
version: "1.1"
date: 2026-11-12
changes: "v1.1 (2026-11-12): direction added from the owner's migrated notes; no longer a stub. v1.0 founded from README.md and CHANGELOG.md"
page_type: knowledge
status: active
description: "What Messaging Explorer is for and who uses it: one free, open-source desktop tool to explore and manage messages on several brokers."
updated: 2026-11-12
source:
  - "README.md"
  - "CHANGELOG.md"
reliability: medium
---

# Vision

> What the tool is for, from the repository and from the owner's notes migrated on 2026-11-12. Where it came from is on [[pages/history/product]]; what it should gain is on [[pages/roadmap/product-backlog]].

Messaging Explorer is a free, MIT-licensed, cross-platform tool to explore and manage messaging brokers from one window (`README.md`). Today: Azure Service Bus and RabbitMQ; the landing page marks RabbitMQ as in active development. It ships as a desktop app for Windows, macOS and Linux and also runs as a local web app.

**Who uses it:** a developer or an operator who needs to look inside a queue, a topic or a dead-letter queue, and to fix what they find: resend, move, delete, purge. The broker is usually production, which is why the three rules that are never "harden later" are about who reaches the API, where secrets go, and never losing a message silently (root `CLAUDE.md`).

**Version line:** 2.3.0 on 2026-07-20 resumed the original version line after the 1.0.x open-source relaunch (`CHANGELOG.md`).

**Where it is going.** The owner's stated direction, in his order of July 2026: first make it safe (RabbitMQ operations that cannot lose messages, secrets not in plain text, tests where the risk is), then make it more useful (search across entities, several namespaces at once, editing entities and subscription rules, monitoring history). Signing in with an identity and browsing the namespaces it can reach is the decided path for Azure ([[pages/decisions/0003-azure-authentication-strategy]]).

**The parts:** [[pages/architecture/project-map]]; [[pages/services/core]], [[pages/services/api]], [[pages/services/web-app]], [[pages/services/electron-shell]].
