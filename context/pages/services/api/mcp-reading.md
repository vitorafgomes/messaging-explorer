---
title: "Api: MCP server, reading in pages and in full"
version: "1.0"
date: 2026-11-20
changes: "v1.0: first version: the four lists in pages, read_message, structured content"
page_type: service
status: active
description: "Read when a change touches the paging of list_queues, list_topics, list_subscriptions or list_rules, the read_message tool, or how a tool's answer is written as text and as structured content."
source:
  - src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs
  - src/ServiceBusExplorer.Api/Mcp/McpToolCalls.cs
  - src/ServiceBusExplorer.Api.Tests/McpToolTests.cs
  - src/ServiceBusExplorer.Api.Tests/McpReadMessageTests.cs
reliability: high
---

# Api: MCP server, reading in pages and in full

One topic of [[pages/services/api|Api]]; the map lists the others. The other reading tools, the gate and the record are on [[pages/services/api/mcp-server]]; the production ask is on [[pages/services/api/mcp-asking-and-sending]].

## Contract

- **The four lists** `list_queues`, `list_topics`, `list_subscriptions` and `list_rules` take `limit`, 1 to 500, 200 when omitted (`src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#DefaultLimit`, `#MaxLimit`), and `after`, a name. Each answers `{ items, next }`: `items` holds each entity as the tool answered it before paging, and `next`, the last name answered, is present only when more exist. A call with `after` = `next` continues the list. A limit outside 1 to 500 is refused with "limit is 1 to 500.". Until 2026-11-20 each answered a bare array of everything. `list_connections` is not paged.
- **`read_message`** (`src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#ReadMessage`), `ReadOnly = true`: `entity`, `sequenceNumber`, `subscription`, `subQueue` (`active`, `deadLetter`, `transferDeadLetter`), `offset` (0 when omitted), `reason`. It answers the fields `peek_messages` answers (`src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#Answered`) with the body from `offset`, at most 8000 characters, plus `bodyLength`, the whole length in characters, and `nextOffset` while more remains. The description of `peek_messages` says a body cut at 8000 characters is read on with it.
- **Structured content:** every success is one text block of JSON, and, when that JSON is an object, the same object as the result's `structuredContent` (`src/ServiceBusExplorer.Api/Mcp/McpToolCalls.cs#RunAsync`). An array, such as the answer of `list_connections` or `read_logs`, and every refusal or failure stay text only. No tool declares an output schema.

## How it works

- **A page** is ordered by name, ordinal, whatever order the provider gave, so a continuation never skips or repeats a name; `after` keeps the names that sort after it, so one that names nothing listed starts where it would sort (`src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#Page`). The limit is checked right after the active connection is read, before the user is asked or the broker is called (`src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#RequireLimit`). The provider still lists everything; the page bounds the answer, not the broker call.
- **The record line** of a list keeps "<n> listed", n the entities answered, and adds ", more exist" when `next` is given.
- **`read_message`** checks, in order: the active offered connection at the level `read` (`src/ServiceBusExplorer.Api/Mcp/McpToolCalls.cs#ActiveAsync`); the sub-queue refusals of `peek_messages` (`src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#SubQueueOf`); a provider that names a message by its position, refused with `src/ServiceBusExplorer.Api/Mcp/McpRemoveTools.cs#PositionRefused`, which keeps RabbitMQ, where a peek requeues, from ever being read by a tool marked read-only; a provider that cannot peek from a position. Then a production connection asks as a peek does, titled "read message <n>". It calls `IMessagingProvider.PeekMessagesAsync` for one message from the sequence number; when none comes back, or one with another number, it answers "The message was not found.". An offset below 0 or past the length is refused with "offset is 0 to <length>.".
- **No body reaches the record or a log:** the record line is "Read message <n>", the entity and sub-queue on the connection, and "<k> characters read" or the refusal; a broker failure answers the fixed sentence of `src/ServiceBusExplorer.Api/Mcp/McpToolCalls.cs#FailureSentence`.
- **Structured content** is parsed from the very text the block carries, so the two never differ.

## Sharp edges

- `src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#Page` answers `next` only when more exist: a `next` of null would tell a client to continue forever.
- `src/ServiceBusExplorer.Api/Mcp/McpReadTools.cs#Answered` writes through `src/ServiceBusExplorer.Api/Mcp/McpToolCalls.cs#JsonOptions`; without it an enum would turn into a number.
- The order is by name, not the order the provider gave: a client that read the rules in the broker's order now reads them by name.

## Tests

- `src/ServiceBusExplorer.Api.Tests/McpToolTests.cs`: `#A_list_answers_at_most_200_by_name_with_next_and_after_continues_it`, `#Rules_are_paged_by_name_with_limit_and_after_and_each_item_is_the_rule_as_answered_before`, `#A_limit_outside_1_to_500_is_refused_and_the_broker_is_not_asked`, `#An_object_answer_is_also_given_as_structured_content_and_an_array_or_a_refusal_is_text_only`. `Host.CallAsync` checks the structured content of every answer of every tool test (`src/ServiceBusExplorer.Api.Tests/McpToolTests.cs#AssertStructuredContent`).
- `src/ServiceBusExplorer.Api.Tests/McpReadMessageTests.cs`: `#A_body_of_20000_characters_is_read_in_three_pieces_that_join_to_the_original_and_none_of_it_is_recorded`, `#On_a_production_connection_read_message_asks_first_and_a_denial_reads_nothing`, `#A_connection_not_offered_is_refused_and_nothing_is_read`, `#A_message_not_there_or_an_offset_outside_the_body_is_refused_with_its_sentence`, `#What_the_provider_cannot_do_is_refused_with_the_sentence_of_the_peek_and_the_numbered_tools`, `#A_read_the_broker_fails_answers_the_fixed_sentence_and_records_the_failure`, `#Read_message_is_read_only_and_peek_messages_says_a_cut_body_is_read_on_with_it`.
- The stub provider peeks from the sequence number it is given, as a broker does; no broker is reached.
