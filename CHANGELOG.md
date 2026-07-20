# Changelog

All notable changes to this project will be documented in this file.

## [2.3.0] - 2026-07-20

> Version jump from 1.0.2: this release resumes the original Message Explorer
> version line (last published as v2.2.0) so the open-source relaunch does not
> appear to be a downgrade. The 1.0.x tags in this repository correspond to the
> relaunch of the same codebase.

### Fixed
- DLQ bulk delete and resubmit no longer lose messages, and unintended
  duplication is greatly reduced. The Azure provider now processes moves in
  per-batch cycles (receive → send → complete within the same cycle), so a
  message's PeekLock can no longer expire while the rest of the selection is
  being scanned — the root cause of duplicates. Operations remain
  at-least-once: in rare failure windows a message can still be delivered
  twice, and such cases are now reported explicitly (see below).
- If a move completes the send but fails to remove the message from the source,
  the message is reported as a possible duplicate instead of being silently
  resent.

### Added
- Bulk operations (delete, resubmit, move) accept a `CancellationToken`
  end-to-end; aborting the HTTP request stops the batch on the server.
- Bulk operation progress dialog supports cancellation from the UI; no success
  callbacks run after the user aborts.
- Scan safety timeout and prefetch tuning for large DLQ scans.

## [1.0.2] - 2026-04-30

### Fixed
- API now accepts string enum values for `ProviderType`, `AuthType` etc. The
  Angular client sends `"AzureServiceBus"` / `"ConnectionString"`, but the
  default System.Text.Json deserializer only accepts integers, so requests
  to `POST /api/connections/test` and similar endpoints failed with
  `400 Bad Request` before reaching the controller.
- Added `JsonStringEnumConverter` to the global JSON options.

## [1.0.1] - 2026-04-30

### Fixed
- Angular API service now resolves the backend URL via the dynamically-assigned
  port reported by Electron (`window.electronAPI.getApiPort()`) instead of a
  hardcoded value. This fixes connection failures in packaged builds where
  the API listens on a port chosen at startup, not the framework default.
- Removed the framework-default port `5000` from `environment.prod.ts`; the
  fallback now matches the configured port in `config.json` (`5917`).

### Added
- IPC handler `get-api-port` in the Electron main process and a corresponding
  `getApiPort` method on `window.electronAPI`.

## [1.0.0] - 2026-04-30

First public release of Messaging Explorer as an open-source project.

### Added
- Multi-broker support: Azure Service Bus and RabbitMQ
- Browse and manage queues, topics, subscriptions, exchanges
- Send, peek and resubmit messages, including dead-letter handling
- RabbitMQ pattern detection (Work Queue, Pub/Sub, Routing, Topics, RPC, Headers)
- Cross-platform desktop builds for Windows, macOS, Linux
- Public landing page with auto-updating downloads (GitHub Pages)
- MIT license

---

_Earlier history below was kept for reference and pre-dates the public release._

## [1.1.0] - 2026-02-03

### Added
- **RabbitMQ Pattern Detection**: Automatic detection of messaging patterns (Hello World, Work Queue, Pub/Sub, Routing, Topics, RPC, Headers) for RabbitMQ exchanges with confidence scoring
- **Dead Letter Notification System**: Real-time bell icon notifications in the header for subscriptions with dead-letter messages, with click-to-navigate functionality
- **Dynamic Electron Port Allocation**: API server now finds a free port automatically in production, preventing port conflicts
- **Metadata-only Connection Updates**: Save connection metadata changes (name, client ID, environment) without re-testing the connection
- **MessagingPattern enum and RabbitMQPatternDetector service** for intelligent exchange topology analysis

### Changed
- **RabbitMQ Provider**: Enhanced exchange listing with bindings, pattern detection, and subscription message counts from queue stats
- **Connection Management**: Improved save flow with masked credential handling and metadata-only update detection
- **Electron Main Process**: Refactored to use dynamic port discovery via `findFreePort()` and async app initialization
- **Entity Tree Component**: Added pattern badges for RabbitMQ exchanges, improved node layout removing unnecessary placeholders
- **Tree Data Builder**: Integrated DeadLetterNotificationService to track DLQ alerts from subscriptions
- **API Service**: Added dynamic Electron port support with fallback to environment config
- **Connection Service**: Migrated export endpoints from direct HTTP to use ApiService abstraction
- **Manage Group Dialog**: Enhanced layout and UX improvements for connection group management

### Fixed
- **Azure Service Bus Provider**: Minor stability improvements
- **View Messages Dialog**: Minor UI fixes
- **Bulk Operation Dialogs**: UI consistency improvements
- **Connection Dialog**: Improved field handling for different provider types

## [1.0.1] - 2026-01-15

### Fixed
- Bug fixes and stability improvements

## [1.0.0] - 2026-01-09

### Changed
- Optimized ResubmitDeadLetterMessageAsync in ServiceBusService.cs to use direct sequence number lookup instead of linear search pattern, reducing O(n) iterations through message batches and eliminating unnecessary network calls and message lock/abandon cycles
