---
title: "Core: Integration tests"
version: "1.0"
date: 2026-11-13
updated: 2026-11-13
changes: "v1.0: split out of the Core service page"
page_type: service
status: active
description: "Read when a change touches an IntegrationTests test of RabbitMQProvider or AzureServiceBusProvider against a broker in Docker, a Defect_ test, or what no broker test reaches."
source:
  - src/ServiceBusExplorer.Core/
  - src/ServiceBusExplorer.Core.Tests/
  - src/ServiceBusExplorer.IntegrationTests/
  - src/ServiceBusExplorer.Api/Program.cs
  - src/ServiceBusExplorer.Api/Controllers/ConnectionsController.cs
  - src/ServiceBusExplorer.Api.Tests/ApiFactory.cs
reliability: high
---

# Core: Integration tests

One topic of [[pages/services/core|Core]]; the map lists the others.

## Testing footprint

`src/ServiceBusExplorer.IntegrationTests/` runs `RabbitMQProvider` through its public surface against RabbitMQ 4.3.7 with the management plugin, in a container the run starts ([[pages/decisions/0002-integration-tests-against-brokers-in-docker]], how it works on [[pages/conventions/testing]]). 29 tests:

- `src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderTests.cs` - what works today: connect and disconnect, `TestConnectionAsync` true and false, queue create, list, get and delete, the configured values and the status of one queue, the state and size of an active and a scheduled message, exchanges listed as topics without `amq.*`, a binding created and listed as a subscription and deleted again, body, content type, message id and a string header through send and peek, receive removing the message, a peek with a cancelled token leaving the queue as it was, purge.
- `src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs` - sixteen `Defect_` tests for the fifteen audit entries the container reproduced ([[pages/roadmap/code-audit-2026-11]], RabbitMQ section): each passes on today's behaviour and its summary names the correct one.
- `src/ServiceBusExplorer.IntegrationTests/RabbitMqFixtureTests.cs#The_provider_connects_only_to_the_loopback_container_this_run_started` - the provider reaches only the loopback container the run started.

The same project runs `AzureServiceBusProvider` through `IMessagingProvider` against the Azure Service Bus emulator 2.0.1 with its SQL Server, one pair of containers per run. The emulator serves messages and entities on two ports, so each test holds two providers, one per connection string; what that and the emulator's other limits leave untested is listed on [[pages/conventions/testing]]. 67 tests on 2026-11-13:

- `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs` - what works today: test connection true for the management endpoint and false for a closed port and for the messaging endpoint, connect and disconnect, queue create, list, get and delete, topic and subscription create, list, get and delete, body, content type, subject, correlation id, message id, session id and a string property through send and peek, the session list, receive removing the message, a topic send reaching each subscription, the dead-letter side after the max delivery count and after an explicit dead-letter, bulk delete, resubmit and move of a selected dead-letter message, the three bulk calls refusing an already-cancelled token with nothing changed, and, since 2026-11-12, a peek across the gap a dropped duplicate leaves, a scheduled message listed behind an active one with its state, the transfer dead-letter queue of a queue answering empty and not its dead-letter queue, a cancel of two scheduled messages, and the neutral exception from a send, a batch send, a cancel, a receive and a resubmit on a disabled queue with nothing changed, and, since 2026-11-13, a dead-letter peek from the sequence number of the third of five messages returning the last three only (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs#A_dead_letter_peek_from_the_sequence_number_of_the_third_message_does_not_return_the_first_two`).
- `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs` - thirteen `Defect_` tests for the audit entries the emulator reproduced and that are still open and the new findings it surfaced, the latest a cancel that mixes in a number that is not scheduled (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs#Defect_a_cancel_where_one_number_is_not_scheduled_cancels_none_on_the_emulator_and_fails_every_number`) ([[pages/roadmap/code-audit-2026-11]], Azure and API sections).
- `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusDefinitionsTests.cs` (since 2026-11-13) - the export of the emulator's namespace with configuration and rules (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusDefinitionsTests.cs#Export_reads_the_queues_topics_subscriptions_and_rules_of_the_namespace_with_their_configuration`); the document serialized as the API writes it holds neither the connection's key nor `SharedAccessKey`, `Endpoint=` or `sb://` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusDefinitionsTests.cs#The_exported_document_holds_no_part_of_the_connection_secret`); a dry run that creates nothing, then an import that creates a queue before the queue it forwards to would fail and a subscription with only its own rule (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusDefinitionsTests.cs#A_dry_run_writes_nothing_and_the_import_then_creates_each_entity_with_its_configuration_and_only_its_own_rules`); an existing queue that differs left as it was (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusDefinitionsTests.cs#Import_reports_an_existing_queue_with_another_configuration_as_differing_and_leaves_it_unchanged`); an import deletes nothing: a queue the document leaves out keeps its two messages, and a subscription the document names with other rules keeps exactly its own rule (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusDefinitionsTests.cs#Import_deletes_no_entity_the_document_leaves_out_and_no_rule_of_a_subscription_it_names_with_other_rules`). The copy's forward target is checked equal to the source's broker address with the target renamed and, read back through the provider, to the bare entity name.
- `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusFixtureTests.cs#Both_provider_endpoints_are_the_loopback_container_this_run_started` - both endpoints are the loopback container the run started.

Not reached by any test against a broker: `PurgeMessagesAsync` and delete-all (they need both endpoints at once), `DeadLetterMessageAsync`.

- `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusSessionTests.cs` - sessions on the emulator: a plain receiver peeks every session of a session queue and subscription and locks none (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusSessionTests.cs#A_plain_receiver_peeks_every_session_of_a_session_enabled_queue_and_subscription_and_locks_none`); listing lists a session a consumer holds and leaves it its lock (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusSessionTests.cs#Listing_lists_a_session_a_consumer_holds_leaves_that_consumer_its_lock_and_leaves_every_other_session_acceptable_at_once`), the defect's regression test; the scan past one peek batch and its truncation, the detail with a text, binary and unknown state, the messages of one session, the state write and its refusal when the state changed, the in-use answer, an entity without sessions and a missing one.
