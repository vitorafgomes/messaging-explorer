---
title: "The API is local and authenticated"
version: "1.1"
date: 2026-11-12
changes: "v1.1 (2026-11-12): the Host filter and the API_SECRET fail-fast are pinned by tests; an exception handler answers one constant body, which closed a leak of the API key through the developer exception page. v1.0 founded from the code"
page_type: invariant
status: active
description: "The API listens on loopback, filters the Host header, restricts CORS to the configured front end and refuses every request without the per-launch API key, compared in fixed time; /health is the one exemption."
updated: 2026-11-12
enforced_by:
  - "src/ServiceBusExplorer.Api/Program.cs:37"
  - "src/ServiceBusExplorer.Api/Program.cs:82"
  - "src/ServiceBusExplorer.Api/Program.cs:88"
  - "src/ServiceBusExplorer.Api/Program.cs:208"
  - "web-app/electron/main.js:10"
  - "web-app/src/app/core/services/api.service.ts:67"
verified_by:
  - "src/ServiceBusExplorer.Api.Tests/AuthMiddlewareTests.cs:12"
  - "src/ServiceBusExplorer.Api.Tests/CorsTests.cs:12"
  - "src/ServiceBusExplorer.Api.Tests/BoundaryGuardTests.cs:15"
  - "src/ServiceBusExplorer.Api.Tests/BoundaryGuardTests.cs:29"
  - "src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs:51"
source:
  - "src/ServiceBusExplorer.Api/Program.cs"
  - "src/ServiceBusExplorer.Api.Tests/"
  - "web-app/electron/main.js"
  - "web-app/src/app/core/services/api.service.ts"
reliability: high
---

# The API is local and authenticated

> No request reaches a controller unless it comes from the local machine and carries the API key generated for this launch. Rule A of root `CLAUDE.md`.

## Why this exists

The API holds broker credentials in memory and can purge a production queue with one HTTP call. It runs on the user's desktop beside a browser, so any web page the user opens can try `http://localhost:<port>`. The key, the CORS policy and the Host filter are what stand between such a page and the user's brokers.

## Scope

- **Applies to:** every route of [[pages/services/api]], every middleware and binding in `Program.cs`, every IPC channel of [[pages/services/electron-shell]] that carries the secret or the port, and every HTTP call of [[pages/services/web-app]].
- **Does not cover:** what an authenticated caller may do. There is one user and no roles.

## Where it's enforced

- `src/ServiceBusExplorer.Api/Program.cs:37` - the process exits at startup when `API_SECRET` is missing or shorter than 32 characters.
- `src/ServiceBusExplorer.Api/Program.cs:70` - CORS allows the configured front-end port on `localhost` and `127.0.0.1`, and the origin `null` that a packaged `file://` window sends.
- `src/ServiceBusExplorer.Api/Program.cs:82` - host filtering accepts `localhost` and `127.0.0.1`.
- `src/ServiceBusExplorer.Api/Program.cs:88` - Kestrel binds to loopback when `ASPNETCORE_URLS` is not set.
- `src/ServiceBusExplorer.Api/Program.cs:186` - `/health` is mapped before the key middleware and answers without a key.
- `src/ServiceBusExplorer.Api/Program.cs:208` - the key middleware compares `X-Api-Key` with `CryptographicOperations.FixedTimeEquals` and answers 401 otherwise; it lets `OPTIONS` through for the CORS preflight (`src/ServiceBusExplorer.Api/Program.cs:192`).
- `web-app/electron/main.js:10` - the secret is 32 random bytes per launch; it reaches the API as an environment variable (`web-app/electron/main.js:638`) and the renderer over the `get-api-secret` IPC channel (`web-app/electron/main.js:832`).
- `web-app/src/app/core/services/api.service.ts:67` - the one place the header is attached.

## How it's verified

- `src/ServiceBusExplorer.Api.Tests/AuthMiddlewareTests.cs:12` - no key is 401; `:20` a wrong key is 401; `:29` the right key is 200; `:38` `/health` is public.
- `src/ServiceBusExplorer.Api.Tests/CorsTests.cs:12` - a preflight from a foreign origin is not allowed; `:26` one from the configured front end is.
- `src/ServiceBusExplorer.Api.Tests/BoundaryGuardTests.cs:15` - a request with a foreign `Host` is refused with 400 and one to `127.0.0.1` passes.
- `src/ServiceBusExplorer.Api.Tests/BoundaryGuardTests.cs:29` - the API process exits with code 1 when `API_SECRET` is missing or has 31 characters.
- `src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs:51` - an unhandled exception answers the constant 500 body in Development and in Production.

## Known exceptions

Recorded on the service pages with their citations and tracked in [[pages/roadmap/followups]]; none is intended behaviour.

- **The loopback binding is not what runs under Electron.** The shell always sets `ASPNETCORE_URLS`, so the branch at `Program.cs:86` is skipped; what binds the API to loopback is the URL the shell passes. No test covers either.
- **Host filtering has two sources in the text, one in effect.** `appsettings.json` carries `"AllowedHosts": "*"`; the explicit list in `Program.cs` is what the filter uses, and a test sends a foreign `Host` and gets 400 (`src/ServiceBusExplorer.Api.Tests/BoundaryGuardTests.cs:15`).
- **CORS allows origin `null`**, which any sandboxed frame or local file also sends. The key is what protects that path.
- **An unhandled exception used to leak the API key in Development.** The developer exception page echoed the request headers, `X-Api-Key` included. Since 2026-11-12 an exception handler outermost in the pipeline answers one constant body in every environment (`src/ServiceBusExplorer.Api.Tests/ErrorBodyTests.cs:51`).

## Change protocol

A change that adds a route outside the key, a binding beyond loopback or a wider origin needs a superseding ADR under `pages/decisions/` first. The `api-surface` lens of gate 6 reviews every diff that touches this page's enforcement points.
