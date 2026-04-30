# Messaging Explorer

> Universal messaging platform explorer and management tool — free and open source.

A cross-platform desktop and web application for managing and exploring messages across multiple messaging platforms (Azure Service Bus, RabbitMQ, and more). Built with Angular, Electron, and .NET.

![License](https://img.shields.io/badge/license-MIT-green.svg)

## Features

- Multi-broker support (Azure Service Bus, RabbitMQ)
- View and manage Queues, Topics, Subscriptions, Exchanges
- Browse, send, and resubmit messages
- Dead-letter management with notifications
- RabbitMQ pattern detection (Work Queue, Pub/Sub, Routing, Topics, RPC, Headers)
- Cross-platform desktop app (Windows, macOS, Linux)
- Modern UI with dark/light themes

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 22+](https://nodejs.org/)
- npm 11+

## Project Structure

```
messaging-explorer/
├── src/
│   ├── ServiceBusExplorer.Core/    # Core library with models and services
│   └── ServiceBusExplorer.Api/     # .NET Web API backend
├── web-app/                         # Angular frontend + Electron
│   ├── src/                         # Angular source code
│   └── electron/                    # Electron main process
└── bug-reporter-worker/             # Optional Cloudflare Worker for bug reports
```

## Development

### Install dependencies

```bash
cd web-app
npm install
```

### Run the application

```bash
npm run start:all
```

Or start backend and frontend separately:

```bash
# Terminal 1 — API
npm run start:api

# Terminal 2 — Angular
npm run start
```

Open `http://localhost:4297` in your browser.

### Run as a desktop app (dev)

```bash
npm run electron:dev
```

## Building

### Build everything

```bash
npm run build:all
```

### Build the desktop app

```bash
# Linux
npm run electron:build:linux

# Windows
npm run electron:build:win

# macOS
npm run electron:build:mac
```

The packaged application will be in `web-app/release/`.

## Usage

1. Click **Connections** in the sidebar.
2. Add a new connection (Azure Service Bus connection string or RabbitMQ credentials).
3. Click **Connect**.
4. Navigate to **Queues**, **Topics**, or **Exchanges** to manage entities.

## Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start Angular dev server |
| `npm run start:api` | Start .NET API |
| `npm run start:all` | Start API and Angular together |
| `npm run build` | Build Angular |
| `npm run build:api` | Build .NET API for production |
| `npm run build:all` | Build everything |
| `npm run electron:dev` | Run as desktop app (dev) |
| `npm run electron:build:linux` | Build Linux desktop app |
| `npm run electron:build:win` | Build Windows desktop app |
| `npm run electron:build:mac` | Build macOS desktop app |

## Adding new providers

See [`docs/ADDING_PROVIDERS.md`](docs/ADDING_PROVIDERS.md) for the provider plugin architecture.

## Contributing

Issues and pull requests are welcome. Please open an issue first to discuss substantial changes.

## License

[MIT](LICENSE) © Vitor Gomes
