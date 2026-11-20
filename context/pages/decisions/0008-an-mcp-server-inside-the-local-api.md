---
title: "ADR 0008 - An MCP server inside the local API"
version: "1.0"
date: 2026-11-19
changes: "2026-11-20: Enforcement names the gate, the token check and their tests. 2026-11-19: accepted by the owner, with the screen as drawn; logs and settings of the app as separate choices, never the MCP group itself; the SDK proven by a throwaway project, which leaves the Origin check to the application. Initial ADR draft"
page_type: adr
status: accepted
description: "The local API serves an MCP endpoint, off by default, for the connections the user chose, behind its own token, asking the user in the app before anything is sent, moved or removed."
supersedes: ""
superseded_by: ""
source:
  - chat
  - "https://modelcontextprotocol.io/specification/2026-07-28"
  - "https://github.com/modelcontextprotocol/csharp-sdk"
  - "https://code.claude.com/docs/en/mcp"
reliability: medium
---

# ADR 0008 - An MCP server inside the local API

> The local API serves an MCP endpoint, off until the user turns it on. It offers an assistant only the connections the user chose, at the level chosen for each, behind a token of its own, and asks the user in the app before anything is sent, moved or removed.

## Status

- [ ] Proposed
- [x] Accepted
- [ ] Deprecated / superseded

Updated: 2026-11-20.

## Context

The owner asked on 2026-11-19 for an MCP server, the way an IDE offers its own tools to an assistant, and for the complete version: "a versao completa pois quero que voce tambem possa enviar msg". The screen was drawn first and settled with the owner the same day: a Settings group named "MCP server", and the MCP icon in the toolbar only while the server is active.

Three rules of the project meet this request head on. Nobody but the local user reaches the API ([[pages/invariants/local-authenticated-api]]): an MCP client is a second caller. A secret never leaves the backend unmasked ([[pages/invariants/secrets-masked-at-the-api-boundary]]), and what a tool answers leaves the computer, to the company that runs the assistant. A bulk operation never loses a message silently ([[pages/invariants/bulk-operations-are-at-least-once]]), and the brokers are usually someone's production.

What was read on 2026-11-19, and what was not:

- The specification, revision 2026-07-28: over Streamable HTTP a server must answer 403 to an invalid `Origin`, should bind to localhost and should authenticate every connection; its optional OAuth flow says nothing for or against a static bearer token.
- A human should always be able to deny a tool call; the specification puts that on the host. Elicitation asks the user through the client, which need not support it.
- The C# SDK, `ModelContextProtocol.AspNetCore` 2.4.0, was proven by a throwaway project on 2026-11-19: a stateless `MapMcp("/mcp")` answers `initialize`, `tools/list` and `tools/call`; a tool takes services and a `CancellationToken` that stay out of its schema; `ReadOnly` and `Destructive` reach the client as hints. **The SDK does not validate `Origin`** (a foreign one was answered 200), so that check is this application's. **Not verified:** a connection from Claude Code itself.
- Claude Code takes an HTTP server as `{ "type": "http", "url": ..., "headers": { "Authorization": "Bearer ..." } }`.
- The MCP logo is in the specification's repository, which is MIT licensed. No usage terms for the logo or the name were found.

## Decision

**Where it runs.** The API process itself serves `/mcp` over Streamable HTTP, on its loopback address and port. The tools call the services the controllers call, never the HTTP routes.

**Off by default.** While the server is off `/mcp` answers 404 and no tool exists; the switch is in Settings, group "MCP server".

**A token of its own.** The per-launch `X-Api-Key` is never given to an assistant. The user creates an MCP token in Settings; it is shown once, stored only as a hash in the data folder, compared in fixed time, and sent as `Authorization: Bearer`. `/mcp` is the second exemption from the `X-Api-Key` middleware, after `/health`, and the only route the MCP token opens. `Origin` is validated as the specification requires, and the Host filter applies. A new token ends the old one.

**Only the connections the user offers.** Each stored connection has a level for assistants: not offered (the default), read, read and send, or read, send and remove. A connection that is not offered does not exist for a tool, not even by name. A connection marked as production is not offered until the user chooses it on purpose.

**The user is asked in the app.** A tool that sends, moves, removes, purges or changes an entity waits while the app shows what is asked, where, how many messages and the reason the assistant gave; with no answer in two minutes the tool is told the request was denied. A delete or a purge asks for the entity name typed, as on the screen. A connection marked as production asks before every operation, a read included. The one exception: a connection the user marks as a local test broker is never asked. Elicitation is not relied on.

**One active connection.** The API has one provider slot. A tool acts on the connection that is active in the app, when it is offered; changing the active connection through a tool is itself an operation the user is asked about.

**What a tool answers.** The same data the routes answer: masked secrets, the per-message report of a bulk operation with its possible duplicates, and fixed sentences for errors, never the text of a broker's exception. The Settings group says plainly that names, counts and message bodies read by an assistant leave the computer.

**The logs of the app.** Asked by the owner on 2026-11-19: an assistant can read the lines of the backend store the Logs screen shows (`src/ServiceBusExplorer.Api/Logs/RecentLogStore.cs#RecentLogStore`), filtered by level and text, which by rule carry no secret, no message body and no exception text. It is its own choice in the Settings group, off by default, because a line can name the target or an entity of a connection not offered. The lines of the shell and the screen reach the tool only once they are handed to the API, a later phase.

**The settings of the app.** Asked by the owner on 2026-11-19: an assistant can turn settings of the app on and off, as its own choice in the Settings group, off by default. A tool reads the settings and changes those on a fixed list: the theme, Developer mode, the update channel and the Monitoring history. Never on that list: the MCP server group itself (the switch, the token, the level of a connection, the choices for logs and settings), so an assistant cannot widen its own reach; clearing the data; and installing or downloading an update, which keeps the user's agreement to the exact version. These settings live in the screen and the shell, so the tool hands the change to the app through the channel that carries a confirmation request, and the change shows in the record.

**A record.** What assistants asked for and what happened is kept in memory while the app is open, with no message body and no secret, and shown in Settings.

**Order of building.** A real connection from Claude Code to the first endpoint; then reading; then sending; then moving and removing; then entity administration; the Settings group and the confirmation window come with the first phase that needs them.

## Consequences

- **Better:** an assistant can inspect a dead-letter queue, reproduce a failure by sending messages and clean up after a test, on brokers the user chose, with the user deciding each change.
- **Worse:** the rule "nobody but the local user reaches the API" gains a second credential and a second exempt route. A message body read by an assistant leaves the computer, which no setting can undo.
- **Worse:** every tool that changes something blocks on a person. An unattended run cannot send or remove, by design, except on a local test broker.
- **Neutral but noteworthy:** the token is long-lived, so it is stored hashed and can only be replaced, never read back. The single provider slot means an assistant and the user share one active connection.

## Alternatives considered

- **A separate stdio process proxying to the API** - the per-launch key would go to another process through a file, and every installer would carry a second executable. Kept for a client that cannot use HTTP.
- **Reuse the per-launch `X-Api-Key`** - it changes every launch, breaking the assistant's configuration, and it opens every route.
- **No confirmation in the app, trust the client's own prompts** - the specification asks clients to confirm, but a client can be set to allow everything, and the broker is production.
- **Confirmation through elicitation** - not every client supports it, and the answer would pass through the assistant's side.
- **Read only** - the owner asked for the complete version; reading stays the first phase.
- **Status quo** - the assistant keeps working from tests and logs only.

## Enforcement

Every test of the reading phase is on [[pages/services/api/mcp-server]].

- **The gate:** `src/ServiceBusExplorer.Api/Mcp/McpGate.cs#AdmitAsync` and `src/ServiceBusExplorer.Api/Mcp/McpSettingsStore.cs#TokenMatches` (SHA-256, fixed time). Pinned by `src/ServiceBusExplorer.Api.Tests/McpGateTests.cs#The_mcp_endpoint_answers_404_while_the_user_has_not_turned_it_on_even_with_a_token_and_the_api_key`, `src/ServiceBusExplorer.Api.Tests/McpGateTests.cs#A_foreign_origin_is_refused_403_even_with_the_right_bearer`, `src/ServiceBusExplorer.Api.Tests/McpGateTests.cs#A_request_without_the_right_bearer_is_refused_401_with_one_body_whatever_was_wrong`, `src/ServiceBusExplorer.Api.Tests/McpGateTests.cs#The_api_key_alone_does_not_open_the_mcp_endpoint_in_any_letter_case`, `src/ServiceBusExplorer.Api.Tests/McpGateTests.cs#The_mcp_token_alone_opens_no_api_route`, `src/ServiceBusExplorer.Api.Tests/McpSettingsRouteTests.cs#The_token_is_answered_once_and_stored_only_as_its_hash`.
- **Only the connections offered:** `src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#ActiveAsync`. Pinned by `src/ServiceBusExplorer.Api.Tests/McpSettingsRouteTests.cs#A_connection_is_offered_at_the_level_read_only_never_from_a_production_environment_and_withdrawn_idempotently`, `src/ServiceBusExplorer.Api.Tests/McpToolTests.cs#A_tool_on_an_active_connection_that_is_not_offered_is_refused_and_names_nothing`, `src/ServiceBusExplorer.Api.Tests/McpToolTests.cs#An_offered_connection_whose_environment_became_production_is_refused`.
- **No secret in an answer or the record:** `src/ServiceBusExplorer.Api.Tests/McpToolTests.cs#List_connections_answers_only_the_offered_connections_with_no_secret`, `src/ServiceBusExplorer.Api.Tests/McpToolTests.cs#Every_tool_call_is_recorded_newest_first_without_a_body_or_a_secret`.
- **Owed by later phases:** the levels above read and their refusals; the confirmation window, with a changing tool that does nothing without the user's answer and is denied after the wait.
- **Invariant page and lenses:** [[pages/invariants/local-authenticated-api]] carries the second exemption; `api-surface`, `secrets` and `message-safety` review every phase.

## Related

- [[pages/roadmap/after-2-5-0]] - where this sits in the order of work.
- [[pages/invariants/provider-boundaries]]; the other three rules are linked under Context.

## Settled with the owner on 2026-11-19

- The connections part of the Settings group lists only the connections offered, with "Offer a connection" to add one and "Remove" on each: the owner asked not to list every connection.
- A connection marked as a local test broker is never asked, as drawn; a read on a production connection asks every time, as written. The owner asked for the implementation with both as they stood.
- The first phase is reading. It has no confirmation window yet, so it offers the level "Read" only and refuses to offer a connection of a production environment; both open with the phase that brings the window.
