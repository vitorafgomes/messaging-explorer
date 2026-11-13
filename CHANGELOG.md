# Changelog

All notable changes to this project will be documented in this file.

## [2.4.1] - 2026-11-13

### Added
- Azure Service Bus: create, edit and enable or disable queues, topics and
  subscriptions, with a review of what will change before it is saved.
- Azure Service Bus: list, add, replace and delete the rules of a
  subscription (SQL, correlation, true and false filters, with an action).
- Azure Service Bus: the transfer dead-letter queue of a queue and of a
  subscription can be read, searched, resubmitted and cleaned.
- Azure Service Bus: scheduled messages show their state and can be cancelled
  on a queue.
- Azure Service Bus: sessions on queues and subscriptions. The list locks
  nothing; one session opens with its state and its messages; the state editor
  shows the old state beside the new and refuses to overwrite a state that
  changed meanwhile.
- A local RabbitMQ and an Azure Service Bus emulator in Docker (`dev/brokers/`)
  for trying the app by hand.

### Fixed
- Listing sessions no longer accepts and locks each session, which took them
  away from the applications consuming them.
- The queue details show the real configuration (lock duration, delivery
  count, size, time to live, status) instead of zeros.
- Panels show only what the broker supports and what is real; the sample
  metrics tab and a topic form that saved nothing are gone.
- An operation on a disabled entity answers that it is disabled, instead of a
  generic error.
- Loading messages and searching stop when the request is cancelled.
- A queue or topic list that fails to load says so, instead of showing an
  empty namespace.
- An unexpected error during the automatic dead-letter resubmit ends as a
  failure, never as completed.
- A send retried after a failure carries only what the form holds now.
- An exported CSV cell cannot start a spreadsheet formula.
- A legacy connections file that cannot be read is kept, not deleted.
- The topics page loads the subscriptions of a topic when it is opened, not
  one request per topic on load.
- The project site always shows working download links.

### Changed
- RabbitMQ refuses session operations instead of answering an empty list.

### Known issues
- RabbitMQ bulk delete, resubmit and move can lose messages on a failure. Use
  them with care on RabbitMQ until the rework lands.
- The automatic dead-letter resubmit stops at the first failure and runs only
  while its dialog is open.
- Deferred messages are shown with their state but cannot be deferred or
  received from the app.
- macOS builds are unsigned, so macOS cannot install an update by itself;
  download the new version from the releases page.

## [2.4.0] - 2026-11-12

### Fixed
- Saving or importing a connection keeps every editable field; some were
  dropped before. The response to a save is masked like every other response.
- A workspace file that cannot be read is reported instead of being replaced
  by an empty one, and the file is written atomically.
- Queue, topic and subscription names with reserved characters (`/`, `#`, `?`,
  `%`, spaces) work in every screen; they are encoded once by the app and
  decoded once by the API.
- A bulk action never acts on more than the selection: the selection is
  cleared when the connection changes, a late response cannot replace a newer
  selection, and "delete all" is only offered when the whole entity is
  selected.
- A message that was sent but could not be removed from its source is shown as
  a possible duplicate in the results, not as a plain failure.
- The window opens only after the local API answers; a failed start shows an
  error instead of an empty window.
- An unexpected API error returns one fixed message and no internal detail.
- The Beta update channel finds beta releases. A stable build on Beta used to
  fail on every update check.
- The app no longer offers an older version as an update.

### Added
- Fonts are bundled with the app, so it renders the same offline.
- Releases carry block maps, so an update downloads only what changed, and
  beta releases carry their own update metadata.

### Changed
- Dependencies updated inside their major versions, among them Angular
  21.2.26, Electron 41.10.7 and the Azure SDKs. Known advisories in shipped
  packages went from 20 to 2.
- External links open only for `http` and `https` addresses.

### Known issues
- RabbitMQ bulk delete, resubmit and move can lose messages on a failure. Use
  them with care on RabbitMQ until the rework lands.
- The queue details panel shows zeros for some properties that the
  subscription panel reads correctly.
- macOS builds are unsigned, so macOS cannot install an update by itself;
  download the new version from the releases page.

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
