---
title: "Services"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: the entries of this area moved out of the context index"
page_type: index
status: active
description: "The pages of the services area, one line each."
source:
  - context/index.md
reliability: high
---

# Services

One map per project. A map lists its topic pages and says when to read each; a change reads the map, then only the topic pages it touches.

- [[pages/services/core|Core]] - `src/ServiceBusExplorer.Core`: the provider abstraction, the Azure Service Bus and RabbitMQ providers, workspace storage, metrics.
- [[pages/services/api]] - `src/ServiceBusExplorer.Api`: startup and the key middleware, the controllers, the single active provider, monitoring.
- [[pages/services/web-app|Web app]] - `web-app/src`: the Angular application, `ApiService`, the features, the provider registry, the tests that run and the ones that do not.
- [[pages/services/electron-shell|Electron shell]] - `web-app/electron`: the main process that starts the API and holds the secret, the IPC surface, auto-update, packaging and release.
