---
title: "Vision"
version: "1.0"
date: 2026-11-12
changes: "Founded from README.md and CHANGELOG.md on 2026-11-12"
page_type: knowledge
status: stub
description: "What Messaging Explorer is for and who uses it: one free, open-source desktop tool to explore and manage messages on several brokers."
updated: 2026-11-12
source:
  - "README.md"
  - "CHANGELOG.md"
reliability: medium
---

# Vision

> A stub: it restates what the repo says about itself. The owner's own statement of direction is in his private notes and has not been migrated ([[pages/roadmap/followups]]).

Messaging Explorer is a free, MIT-licensed, cross-platform tool to explore and manage messaging brokers from one window (`README.md`). Today: Azure Service Bus and RabbitMQ; the landing page marks RabbitMQ as in active development. It ships as a desktop app for Windows, macOS and Linux and also runs as a local web app.

**Who uses it:** a developer or an operator who needs to look inside a queue, a topic or a dead-letter queue, and to fix what they find: resend, move, delete, purge. The broker is usually production, which is why the three rules that are never "harden later" are about who reaches the API, where secrets go, and never losing a message silently (root `CLAUDE.md`).

**Version line:** 2.3.0 on 2026-07-20 resumed the original version line after the 1.0.x open-source relaunch (`CHANGELOG.md`).

**The parts:** [[pages/architecture/project-map]]; [[pages/services/core]], [[pages/services/api]], [[pages/services/web-app]], [[pages/services/electron-shell]].
