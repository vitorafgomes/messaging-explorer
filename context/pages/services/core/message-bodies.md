---
title: "Core: Message bodies"
version: "1.0"
date: 2026-11-14
updated: 2026-11-14
changes: "v1.0: a body is read as strict UTF-8 or as base64 with BodyEncoding, never with a replaced byte; a base64 body is sent as its bytes"
page_type: service
status: active
description: "Read when a change touches how a message body is read or sent as a string: MapToMessageInfo, DecodeBytes, CreateServiceBusMessage, BodyEncoding or SupportsBinaryBody."
source:
  - src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs
  - src/ServiceBusExplorer.Core/Models/MessageBodyEncoding.cs
  - src/ServiceBusExplorer.Core/Models/MessageInfo.cs
  - src/ServiceBusExplorer.Core/Models/SendMessageRequest.cs
  - src/ServiceBusExplorer.Core/Abstractions/IProviderCapabilities.cs
  - src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderReadTests.cs
reliability: high
---

# Core: Message bodies

One topic of [[pages/services/core|Core]]; the API checks are on [[pages/services/api/routes-single-message-actions]] and the screen on [[pages/services/web-app/features-message-detail-actions]].

## Read

A message body travels between the API and the web app as a string with a flag, `BodyEncoding`, `text` or `base64` (`src/ServiceBusExplorer.Core/Models/MessageBodyEncoding.cs#MessageBodyEncoding`, `src/ServiceBusExplorer.Core/Models/MessageInfo.cs#BodyEncoding`).

- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#DecodeBytes` decodes the bytes with a strict UTF-8 decoder (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#StrictUtf8`). Valid UTF-8 is the text with the `text` flag. A body with one invalid byte is the base64 of its exact bytes with the `base64` flag: no byte is ever replaced by U+FFFD. No bytes is the empty text `''`.
- `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#MapToMessageInfo` sets the flag from that decode for every peek, search and receive; a peek without bodies decodes nothing and keeps the `text` flag with a null body. `SizeInBytes` stays the byte count of the body.
- The session state is read through the same decode ([[pages/services/core/azure-sessions]]).

## Send

`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs#CreateServiceBusMessage` sends a request flagged `base64` as the bytes it encodes (`src/ServiceBusExplorer.Core/Models/SendMessageRequest.cs#BodyEncoding`), and a request flagged `text` or with no flag as the UTF-8 bytes of its text, as before. It serves the single send, the batch send and the resubmit of an edited copy. The API refuses an unknown flag, base64 that does not decode and a base64 body to a provider without binary bodies before the provider is called, so this method never sees one.

## RabbitMQ

`SupportsBinaryBody` is true for Azure (`src/ServiceBusExplorer.Core/Providers/Azure/AzureProviderCapabilities.cs#SupportsBinaryBody`) and false for RabbitMQ (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProviderCapabilities.cs#SupportsBinaryBody`), whose read and send are unchanged: a body is read as UTF-8 text with the `text` flag, and a base64 send is refused by the API.

## Tests

Unit, `src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderReadTests.cs`: `A_body_that_is_not_valid_utf8_is_read_as_the_base64_of_its_exact_bytes_never_with_replaced_bytes`, `A_valid_utf8_or_empty_body_is_read_as_its_text`, `A_binary_body_sent_as_base64_round_trips_byte_for_byte`, `A_text_body_is_sent_as_its_utf8_bytes`. The decode with replacement (`Encoding.UTF8.GetString`) fails the first one with "A body that is not valid UTF-8 is flagged base64."

## Known gaps

A message whose AMQP body is a value or a sequence, not data, throws on `ServiceBusReceivedMessage.Body`, so the map of a peek that holds one fails ([[pages/services/core/known-gaps]]).
