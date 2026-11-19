---
title: "ADR 0008 - An MCP server inside the local API"
version: "1.0"
date: 2026-11-19
changes: "2026-11-19: accepted by the owner, who asked for the implementation with the screen as drawn; an assistant can read the logs and change settings of the app, each as its own choice, never the MCP group itself; the SDK calls proven by a throwaway project; the SDK leaves the Origin check to the application. Initial ADR draft"
page_type: adr
status: accepted
description: "The local API serves an MCP endpoint, off until the user turns it on, that offers an assistant only the connections the user chose, behind a token of its own, and asks the user in the app before anything is sent, moved or removed."
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

Updated: 2026-11-19.

## Context

The owner asked on 2026-11-19 for an MCP server, the way an IDE offers its own tools to an assistant, and for the complete version: "a versao completa pois quero que voce tambem possa enviar msg". The screen was drawn first, as a group of Settings, and changed with the owner three times the same day: the group is named "MCP server", the toolbar shows the MCP icon only while the server is active, and the configuration sits inside Settings.

Three rules of the project meet this request head on. Nobody but the local user reaches the API ([[pages/invariants/local-authenticated-api]]): an MCP client is a second caller. A secret never leaves the backend unmasked ([[pages/invariants/secrets-masked-at-the-api-boundary]]), and what a tool answers leaves the computer, because the assistant sends it to the company that runs it. A bulk operation never loses a message silently ([[pages/invariants/bulk-operations-are-at-least-once]]), and the brokers are usually someone's production.

What was read on 2026-11-19, and what was not:

- The specification, revision 2026-07-28, has two standard transports, stdio and Streamable HTTP. For Streamable HTTP a server must validate the `Origin` header and answer 403 to an invalid one, should bind to localhost when local, and should authenticate every connection. Authorization is optional; the OAuth flow is the one the specification describes, and it says nothing for or against a static bearer token.
- The specification says there should always be a human in the loop able to deny a tool call, and puts that on the host application. Elicitation lets a server ask the user through the client, but a client need not support it.
- The C# SDK is `ModelContextProtocol.AspNetCore` 2.4.0. A throwaway project proved on 2026-11-19 what the plan needs: `AddMcpServer().WithHttpTransport(o => o.Stateless = true).WithTools<T>()` and `MapMcp("/mcp")` build and answer `initialize`, `tools/list` and `tools/call`; a tool method takes a service from dependency injection and a `CancellationToken`, and neither shows in its schema; `[McpServerTool(ReadOnly = true)]` and `Destructive = true` reach the client as `readOnlyHint` and `destructiveHint`; an `McpException` reaches the client as an error result with its message. **The SDK does not validate `Origin`:** a call with a foreign `Origin` was answered 200, so that check is this application's to write. **Not verified:** a connection from Claude Code itself; the calls were made with an HTTP client.
- Claude Code takes an HTTP server as `{ "type": "http", "url": ..., "headers": { "Authorization": "Bearer ..." } }`.
- The MCP logo is in the specification's repository, which is MIT licensed. No usage terms for the logo or the name were found.

## Decision

**Where it runs.** The MCP endpoint is served by the API process itself, at `/mcp` over Streamable HTTP, on the loopback address and port the API already uses. The API holds the connected provider and the stored connections, so the tools call the same services the controllers call, never the HTTP routes.

**Off by default.** While the server is inactive `/mcp` answers 404 and no tool exists. The switch is in Settings, group "MCP server".

**A token of its own.** The per-launch `X-Api-Key` stays what it is and is never given to an assistant. The user creates an MCP token in Settings; it is shown once, stored only as a hash in the data folder, compared in fixed time, and sent by the client as `Authorization: Bearer`. `/mcp` is the second exemption from the `X-Api-Key` middleware, after `/health`, and the only route that accepts the MCP token; the MCP token opens no other route. The `Origin` header is validated as the specification requires, and the existing Host filter applies. Creating a new token ends the old one.

**Only the connections the user offers.** Each stored connection has a level for assistants, kept with the connection: not offered (the default), read, read and send, or read, send and remove. A connection that is not offered does not exist for a tool, not even by name. A connection marked as production is not offered until the user chooses it on purpose.

**The user is asked in the app.** A tool that sends, moves, removes, purges or changes an entity waits while the app shows what is asked, where, how many messages and the reason the assistant gave; with no answer in two minutes the tool is told the request was denied. A delete or a purge asks for the entity name typed, as on the screen. A connection marked as production asks before every operation, a read included. The one exception: a connection the user marks as a local test broker is never asked. Elicitation through the client is not relied on, because a client need not support it.

**One active connection.** The API has one provider slot. A tool acts on the connection that is active in the app, when it is offered; changing the active connection through a tool is itself an operation the user is asked about.

**What a tool answers.** The same data the routes answer: masked secrets, the per-message report of a bulk operation with its possible duplicates, and fixed sentences for errors, never the text of a broker's exception. The Settings group says plainly that names, counts and message bodies read by an assistant leave the computer.

**The logs of the app.** Asked by the owner on 2026-11-19: an assistant can read the logs the Logs screen shows. A tool answers the lines of the backend store (`src/ServiceBusExplorer.Api/Logs/RecentLogStore.cs#RecentLogStore`), filtered by level and text, which by rule carry no secret, no message body and no exception text. It is a choice of its own in the Settings group, off by default, because a log line can name the target or an entity of a connection that is not offered. The lines of the desktop shell and of the screen live outside the API; they reach the tool only once the shell and the screen hand them to the API, which is a later phase.

**The settings of the app.** Asked by the owner on 2026-11-19: an assistant can turn settings of the app on and off. It is a choice of its own in the Settings group, off by default. A tool reads the settings and changes the ones on a fixed list: the theme, Developer mode, the update channel and the Monitoring history. Three things are never on that list, whatever is chosen: the MCP server group itself (the switch, the token, the level of a connection, the choices for logs and settings), so an assistant cannot widen its own reach; clearing the data; and installing or downloading an update, which keeps the user's agreement to the exact version. These settings live in the screen and in the desktop shell, not in the API, so the tool hands the change to the app through the same channel that carries a request for confirmation, and the change shows in the record.

**A record.** What assistants asked for and what happened is kept in memory while the app is open, with no message body and no secret, and shown in Settings.

**Order of building.** A real connection from Claude Code to the first endpoint; then reading; then sending; then moving and removing; then entity administration; the Settings group and the confirmation window come with the first phase that needs them.

## Consequences

- **Better:** an assistant can inspect a dead-letter queue, reproduce a failure by sending messages and clean up after a test, on brokers the user chose, with the user deciding each change.
- **Worse:** the rule "nobody but the local user reaches the API" gains a second credential and a second exempt route; the invariant page and its tests change with the first phase. A message body read by an assistant leaves the computer, which no setting can undo afterwards.
- **Worse:** every tool that changes something blocks on a person. An unattended run cannot send or remove, by design, except on a local test broker.
- **Neutral but noteworthy:** the token is long-lived, unlike the per-launch key, so it is stored hashed and can only be replaced, never read back. The single provider slot means an assistant and the user share one active connection.

## Alternatives considered

- **A separate process over stdio that proxies to the API** - it would need the per-launch key handed to another process through a file, and a second executable in every installer. Kept as a later addition if a client cannot use HTTP.
- **Reuse the per-launch `X-Api-Key`** - the key changes at every launch, so the configuration of the assistant would break each time, and the assistant would hold the key that opens every route.
- **No confirmation in the app, trust the client's own prompts** - the specification asks clients to confirm, but a client can be set to allow everything, and the broker is production.
- **Confirmation through elicitation** - not every client supports it, and the answer would pass through the assistant's side.
- **Read only** - the owner asked for the complete version; reading stays the first phase.
- **Status quo** - the assistant keeps working from tests and logs only.

## Enforcement

To be written with the first phase; none of it exists yet.

- **Tests:** `/mcp` answers 404 while inactive; refuses a missing or wrong token and an invalid `Origin`; the MCP token opens no other route and `X-Api-Key` does not open `/mcp`; a connection that is not offered is absent from every tool; a level refuses the tools above it; a changing tool does nothing without the user's answer and is denied after the wait; no tool answer carries an unmasked secret.
- **Invariant page:** [[pages/invariants/local-authenticated-api]] gains the second exemption and its tests.
- **Review lenses:** `api-surface`, `secrets` and `message-safety` on every phase.

## Related

- [[pages/roadmap/after-2-5-0]] - where this sits in the order of work.
- [[pages/invariants/local-authenticated-api]], [[pages/invariants/secrets-masked-at-the-api-boundary]], [[pages/invariants/bulk-operations-are-at-least-once]], [[pages/invariants/provider-boundaries]].

## Settled with the owner on 2026-11-19

- The connections part of the Settings group lists only the connections offered, with "Offer a connection" to add one and "Remove" on each: the owner asked not to list every connection.
- A connection marked as a local test broker is never asked, as drawn; a read on a production connection asks every time, as written. The owner asked for the implementation with both as they stood.
- The first phase is reading. It has no confirmation window yet, so it offers the level "Read" only and refuses to offer a connection of a production environment; both open with the phase that brings the window.
