---
title: "Code audit, November 2026"
version: "1.0"
date: 2026-11-12
changes: "Initial tracker: the line-by-line bug hunt of 2026-11-12, by area"
page_type: roadmap
status: active
description: "The findings of the line-by-line read of the back end and the front end on 2026-11-12: bugs by area and severity, then improvements. A tracker; an entry leaves when its fix lands."
updated: 2026-11-13
source:
  - "src/"
  - "web-app/"
  - chat
reliability: medium
---

# Code audit, November 2026

> Five readers each read one area of the code line by line on 2026-11-12, without running it. This page holds what they found that [[pages/roadmap/followups]] did not already record. Nothing here was fixed by the audit.

**How to read an entry.** `CONFIRMED` means the reader verified the code path at the cited line and around it; where the failure also depends on how the broker or an SDK behaves, the entry says so, and that part was not executed. `PLAUSIBLE` means the code allows it and a run is needed to confirm. Severity: P1 loses, duplicates or misdirects messages, leaks a secret, corrupts data or crashes; P2 is a wrong result, a broken feature or a leak; P3 is minor. A fix goes through the bug-fix lane and starts with a test that fails on today's code; a finding that turns out to be intended goes to [[pages/conventions/decisions-that-look-like-defects]].

This page is a tracker: `version` changes only when its shape does.

## Azure Service Bus provider

Path for every entry: `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs`, unless another is named. Breaches of [[pages/invariants/bulk-operations-are-at-least-once]] are marked. On 2026-11-12 the entries marked "reproduced in a container" were executed against the Azure Service Bus emulator 2.0.1 started by the integration run ([[pages/decisions/0002-integration-tests-against-brokers-in-docker]]); each names the `Defect_` test that pins today's behaviour. What the emulator could not exercise is listed on [[pages/conventions/testing]]; an entry that rests on it is unchanged.

### P1

- **A resubmit or a move into an entity with duplicate detection can lose the message** (CONFIRMED in code; the broker rule is from the documentation). The copy keeps the original `MessageId` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1838`). If the target has duplicate detection and that id is still inside its window, the broker accepts the send and drops it; the source is then completed and the result says success. Invariant breach. Reproduced in a container: a dead-lettered message resubmitted into its queue with duplicate detection inside the window is reported as one success, and is in neither the queue nor the dead-letter queue, `Defect_resubmit_into_a_queue_with_duplicate_detection_reports_success_and_the_message_is_gone` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:114`). Fix: read `RequiresDuplicateDetection` of the target first; refuse, or send with a new id and keep the old one in a property.
- **A selective delete or move on an active entity dead-letters messages the user did not select** (CONFIRMED in code; the broker rule is documented). Every scanned message is received in PeekLock and the non-targets are abandoned (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1582`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2006`); each abandon raises the delivery count, and a message can be recycled several times in one scan. On an entity with a low `MaxDeliveryCount`, untouched production messages reach the dead-letter queue. Reproduced in a container: a delete of the last of three messages raised the delivery count of the other two from 0 to 1, `Defect_selective_delete_on_an_active_queue_raises_the_delivery_count_of_the_unselected_messages` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:143`), and with a max delivery count of 1 sent both to the dead-letter queue with `MaxDeliveryCountExceeded` while reporting one success, `Defect_selective_delete_on_an_active_queue_with_a_low_max_delivery_count_dead_letters_the_unselected_messages` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:160`). No clean fix on active entities: stop at the first pass beyond the largest target, and warn or block when the source is not a dead-letter queue and the limit is small.

### P2

- **One failed abandon ends the scan.** The abandons run inside the scan's `try` (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1582`); a lost lock on a non-target, which is harmless, reports every remaining target as not found. Fix: catch per abandon.
- **A failed send or a cancel leaves the cycle's messages locked** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1773`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2001`), up to 250 plus the prefetch buffer, so an immediate retry does not see them. Fix: abandon in a `finally`, without the caller's token.
- **Only `ServiceBusException` becomes a partial result** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1804`, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2032`). A missing Send right on the target throws another type in cycle N and the successes of the earlier cycles are lost: the user sees an error although messages were already moved. Invariant breach (failures not reported per message).
- **The scan assumes messages arrive in sequence order** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1587`). False on partitioned entities and when earlier targets are locked; targets that exist are reported not found.
- **Sending a message with a custom property fails.** `ApplicationProperties` binds as `JsonElement` values and is copied as is (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2226`); the SDK rejects the type. This breaks send and import for any message with a property. Reproduced in a container: the send throws `SerializationException` ("unsupported type, System.Text.Json.JsonElement") and nothing is sent; a plain string value is sent, `Defect_send_with_an_application_property_bound_from_json_throws_and_sends_nothing` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:60`).
- **One message with a non-binary AMQP body breaks a whole peek or search**, and binary bodies are shown corrupted (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2238`): the fallback calls the same throwing member, and the base64 branch can never run. Reproduced in a container for the value body: a peek over a readable message and one with an AMQP value body throws `NotSupportedException`, `Defect_one_message_with_an_amqp_value_body_breaks_the_whole_peek` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:227`); the binary-body display was not executed.
- **A session purge can return success with sessions untouched** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1376`): the idle timeout is re-armed only when a session is accepted, and a caller's cancel is swallowed. A failure answered as success ([[pages/invariants/a-guard-must-be-able-to-fire]]).
- **Selective delete, move and receive fail on session-enabled active entities** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1447`): they open a non-session receiver. Reproduced in a container: all three throw `InvalidOperationException` ("requires sessions") and the message stays, `Defect_selective_delete_move_and_receive_on_a_session_enabled_queue_throw` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:176`).
- **Fixed 2026-11-12: creating a subscription with an invalid filter left it with no rule,** receiving nothing, and a retry failed with "already exists". The subscription and its rule are now created in one SDK call (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:692`), so an invalid expression creates nothing; the pinned test is replaced by `A_subscription_created_with_an_invalid_filter_does_not_exist_afterwards_and_can_be_created_again` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs:284`). No route reaches this path yet.
- **Fixed 2026-11-12: peek stopped on a short batch,** which the broker may return while more messages exist, so the list was cut short. The peek now goes on from the last sequence number until a batch is empty or the count asked for is reached, at most that count plus one broker calls, with the count clamped to 1,000 by the controllers (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1174`); a scheduled message behind an active one is now listed. The pinned `Defect_peek_stops_at_the_short_batch_a_dropped_duplicate_leaves_and_returns_fewer_messages_than_exist` is replaced by `Peeking_10_messages_of_a_queue_that_holds_2_returns_both_across_the_gap_a_dropped_duplicate_leaves` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs:638`), with the shapes the emulator does not produce unit-tested (`src/ServiceBusExplorer.Core.Tests/Providers/Azure/AzureServiceBusProviderSubQueueTests.cs:141`).
- **A send of many messages goes out as one batch** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1212`) and fails entirely when it exceeds one; this is the import path. The size-aware batching already exists for resubmit. Reproduced in a container: 40 messages of 10 KB throw `MessageSizeExceeded` and none is sent, `Defect_send_of_more_messages_than_fit_one_batch_fails_as_a_whole_and_sends_nothing` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:214`).
- **Receive completes inside the loop** (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1227`): if a complete fails on message k, the earlier ones are already removed and their content is never returned.
- **Fixed 2026-11-12: the queue details screen showed defaults** for lock duration, max delivery count, sessions, partitioning, size, time to live and status, because `GetQueueAsync` read only the runtime properties. It now reads the configuration and the runtime properties in parallel and maps both (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:169`), as topics and subscriptions do; a queue either call reports missing is null and any other failure reaches the caller. The test that pinned the defect is replaced by `Queue_details_show_the_configured_values_and_the_status_instead_of_zeros` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs:107`). The queue list still carries configuration at its defaults: it is one runtime enumeration by design. Partitioning was not exercised (the emulator does not partition).
- **The single resubmit re-reads roughly the first hundred dead-letter messages** (CONFIRMED, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1291`), so a message deeper in the queue is sent and never removed. Worse than the recorded gap. Fix: call the bulk path with one element. Reproduced in a container: the last of 350 dead-lettered messages is sent to the queue, all 350 stay in the dead-letter queue, and the call returns without error, `Defect_single_resubmit_of_a_message_deep_in_the_dead_letter_queue_sends_it_and_leaves_it_there` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:197`).
- **Prefetch with a short lock duration** (PLAUSIBLE, `src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1415`): the next batch can arrive with expired locks, so each message is sent and then cannot be completed.
- **Metrics are probably queried on the wrong resource** (PLAUSIBLE, `src/ServiceBusExplorer.Core/Services/AzureMonitorMetricsService.cs:351`): a child resource id per queue, where Service Bus publishes on the namespace with an `EntityName` dimension. One real call confirms it.

- **Fixed 2026-11-13: the session list could be cut short on a real namespace,** and while it loaded it took each session away from its consumers: it accepted the sessions one by one and stopped at the first repeated one. It is now a passive peek that accepts nothing, and it lists a session a consumer holds (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:2308`, `src/ServiceBusExplorer.IntegrationTests/AzureServiceBusSessionTests.cs:112`).

### P3

- `DeadLetterMessageAsync` can only find deferred messages (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1247`); nothing calls it.
- Search reports `HasMore` on an exactly full last page, runs a user regex with no timeout, and answers an invalid pattern with a 500 (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:1077`). Reproduced in a container: two matches asked for two answer `HasMore` true, `Defect_search_reports_more_results_on_an_exactly_full_last_page` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:253`); the pattern `(` throws `RegexParseException` from the provider, `Defect_search_with_an_invalid_regex_throws_the_regex_parse_error` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:242`). The timeout was not exercised.
- `ConnectAsync` on a connected provider leaks the old client (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:108`); latent, only fresh instances call it.
- **Fixed 2026-11-12:** the `$Default` rule of every subscription was shown as a SQL filter with the expression `1=1`, because `TrueRuleFilter` derives from `SqlRuleFilter` and the SQL branch was tested first. The mapper tests true and false first (`src/ServiceBusExplorer.Core/Providers/Azure/AzureServiceBusProvider.cs:800`) and the pinned test is replaced by `The_default_rule_of_a_subscription_is_listed_and_read_as_a_true_filter` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs:168`).
- A connection whose endpoint is an IP address is shown as its first octet, `127` for `127.0.0.1` (found by the integration run on 2026-11-12): the namespace is cut at the first dot (`src/ServiceBusExplorer.Core/Providers/Azure/AzureConnectionConfig.cs:160`). Reproduced in a container, `Defect_the_target_of_an_ip_address_endpoint_is_shown_as_its_first_octet` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:283`).

### Improvements

- Complete after a successful send without the caller's token, so a cancel between the two cannot make an unreported duplicate.
- A `CancellationToken` on peek, search, send, receive and sessions in `IMessagingProvider`.
- Extract the scan loop shared by delete, resubmit and move before fixing the entries above; each fix is otherwise made three times.
- Log once when the server-side purge falls back to the slow drain.
- Say in the UI, before the user confirms, that a resubmit from a subscription's dead-letter queue publishes to the topic and so reaches every subscription.
- A token cache for the interactive browser credential, which today prompts on every test and every connect.
- The metrics service uses a plain default credential, including the managed identity probe the provider excludes on purpose; and a missing data point is drawn as zero.
- The capability limits (256 KB, 14 days) are wrong for the Premium tier.
- The emulator serves AMQP and the management API on two ports, and the provider takes one connection string, so the app cannot drive a local emulator: test connection fails on the AMQP string, and with the HTTP string every message call fails. A second, optional management endpoint on the connection would make it usable (found by the integration run on 2026-11-12, [[pages/conventions/testing]]).

### Read and found sound

Entity path building on every operation; send before complete in resubmit and move, with no resend after a failed complete; batch splitting on resubmit; termination of the delete scan; the drain and the server-side purge; no secret in any log template; the credential factory; the provider factory; paging in search; the metrics cache keys and time ranges. The session list, suspected of being cut short at the first repeated session, returned all 20 sessions of a queue on the emulator, `The_session_list_holds_every_session_of_a_queue` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderTests.cs:342`); refuted there, not proven against a namespace; replaced on 2026-11-13 by a passive peek, the fixed entry above. The legacy `ServiceBusService` was only skimmed.

## RabbitMQ provider

Paths under `src/ServiceBusExplorer.Core/Providers/RabbitMQ/`. No broker was contacted during the read. On 2026-11-12 the entries marked "reproduced in a container" were executed against `rabbitmq:4.3.7-management` started by the integration run ([[pages/decisions/0002-integration-tests-against-brokers-in-docker]]); each names the `Defect_` test that pins today's behaviour. The quorum delivery limit and the shared channel were not executed.

### The answer on bulk operations

**They cannot be made safe over the management HTTP API, and they can over the AMQP client the project already references. Turn them off until that is built.** The HTTP `get` has two modes: one acknowledges before the response exists, the other requeues everything; there is no way to hold one message while it is republished. Over AMQP: a dedicated channel per operation with publisher confirms; fetch without acknowledging up to a bounded window; a delete target is acknowledged; a move or resubmit target is published with `mandatory` and a confirm, and only then acknowledged; a failed publish is negatively acknowledged with requeue and reported; non-targets are never republished and return to their place when the channel closes. Positions cannot be made stable, so a peek must emit a key that survives until the action (a hash of id, body, routing key and timestamp fits the existing `long`). Known cost: every held message comes back flagged redelivered. Turning it off needs a capability flag, which does not exist today. This decides the open question on [[pages/roadmap/improvement-plan]], Phase 2.

### P1

- **A republish that reaches no queue counts as success** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:361`): the publish only checks the HTTP status and never reads `routed`. A move to a mistyped or deleted queue loses the message with a success count. Reproduced in a container: `Defect_move_to_a_missing_queue_reports_success_and_the_message_is_gone` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:153`).
- **A whole batch can vanish with nothing reported** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:702`): one call consumes up to the highest selected position with acknowledge; if it times out or the response fails to parse, all of them are gone and no result exists. Worse than the recorded gap. Reproduced in a container: the management API returns `"properties": []` for a message published with no properties, the response does not parse, and a delete of position 3 throws `JsonException` with all three messages consumed, `Defect_bulk_delete_of_messages_without_properties_throws_after_consuming_them_all` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:188`).
- **Positions are counted from the head at execution time, with no identity check** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:706`): if the queue moved since the peek, a different message is deleted or moved. A position beyond the end is skipped with no failure entry. The first half reproduced in a container: after another client consumed the head, a delete of position 1 removed the second message, `Defect_delete_by_position_removes_whichever_message_is_at_that_position_now` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:170`).
- **The single resubmit ignores which message was chosen** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:641`): it takes the head of the dead-letter queue. Reproduced in a container: `Defect_single_resubmit_ignores_the_sequence_number_and_takes_the_dead_letter_head` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:200`).
- **Send guesses exchange or queue from the message subject** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:576`), with no `mandatory` flag or confirm: a send to a fanout exchange with no subject goes to the default exchange and is dropped, and the API answers success. Reproduced in a container: `Defect_send_to_a_fanout_exchange_without_subject_is_dropped_and_reports_success` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:216`).
- **A republish keeps `user_id`** (CONFIRMED, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:1140`): the broker validates it against the publishing user, so a message first published by another user is rejected after it was already consumed. Reproduced in a container: the management publish answers 400 `406 PRECONDITION_FAILED - user_id property set to ... but authenticated user was ...`, the single resubmit throws, and the message is in neither queue, `Defect_resubmit_of_a_message_with_another_users_user_id_fails_after_consuming_it` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:317`).

### P2

- **Peek shows the same message N times** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:544`): get, requeue, get returns the head each time; reproduced in a container, `Defect_peek_returns_the_head_message_count_times` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:74`). It also flags a production message as redelivered, and on a quorum queue with a delivery limit a large peek could dead-letter the head (PLAUSIBLE).
- **Peek returns no sequence number, so the bulk UI is broken for RabbitMQ** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:989`): one click checks every row, the request cannot bind, and with exactly one row loaded a delete becomes a full purge behind the "Delete ALL" dialog. The positional bulk paths are reachable only by calling the API directly. The missing sequence number reproduced in a container, `Defect_peeked_messages_carry_no_sequence_number` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:89`); the UI consequences were not executed.
- **One queue declared with `x-message-ttl` breaks every listing** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:583`): a conversion that throws on the JSON value. Queues, topics and the monitoring poll all fail. Reproduced in a container with a queue the provider itself creates with a default TTL: queue and topic listing throw `InvalidCastException`, `Defect_a_queue_with_a_message_ttl_makes_queue_and_topic_listing_throw` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:103`).
- **Opening the dead-letter tab of a queue with no `<queue>.dlq` kills the shared channel** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:533`); every later peek, send, receive and purge fails until reconnect, while `IsConnected` still says true. Reproduced in a container for peek and send, `Defect_peeking_a_missing_dead_letter_queue_breaks_every_later_peek_while_still_connected` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:115`).
- **Sending a message with a custom property fails** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:901`), the same cause as on the Azure side. Reproduced in a container: a value bound from JSON arrives as `JsonElement` and the send throws `WireFormattingException` with nothing sent; a plain string value is sent, and the channel stays usable, `Defect_send_with_an_application_property_bound_from_json_throws_and_sends_nothing` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:130`).
- **TLS can never be turned on** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQConnectionConfig.cs:181`): the stored connection has no field for it, so the management password always travels over plain HTTP and TLS-only brokers cannot be reached. Bears on Rule G in spirit: a credential on the wire in clear.
- **Deleting a subscription can remove another binding** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:455`): the match also accepts the routing key. Reproduced in a container: the broker lists bindings sorted by destination, so the wrong binding goes when its queue sorts before the subscription's own, `Defect_deleting_a_subscription_removes_the_binding_whose_routing_key_equals_its_name` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:235`).
- **Move on a topic route uses the exchange name as the queue** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:818`) and throws on an empty selection.
- **A timestamp in milliseconds leaves a message stuck unacknowledged** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:953`): the conversion throws between the get and the requeue.
- **A non-ASCII user or password fails every management call** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:72`). Reproduced in a container for a password: AMQP connects, the management API answers 401 to the provider and 200 to the same credentials encoded as UTF-8, `Defect_a_non_ascii_password_connects_over_amqp_and_fails_every_management_call` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:293`).
- **Test checks only the management API and connect checks only AMQP** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:73`), so each can pass while the other endpoint is wrong. Reproduced in a container, `Defect_test_connection_passes_with_a_wrong_amqp_port` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:253`) and `Defect_connect_succeeds_with_a_wrong_management_port` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:264`).
- **One channel serves every request** (PLAUSIBLE, `src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:17`); channels in this client version are not safe for concurrent use.
- **Exchange-to-exchange bindings are listed as subscriptions** (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:358`). Reproduced in a container, `Defect_an_exchange_to_exchange_binding_is_listed_as_a_subscription` (`src/ServiceBusExplorer.IntegrationTests/RabbitMQProviderDefectTests.cs:278`).
- **The dead-letter queue is always assumed to be `<queue>.dlq`**; the queue's real dead-letter exchange is parsed and never used.

### P3

- Capability flags that disagree with behaviour (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProviderCapabilities.cs:46`): dead-lettering, transactions and batching say true and are not implemented; there is no flag for bulk operations. [[pages/invariants/provider-boundaries]]
- The pattern detector never detects publisher confirms and flags names containing "req" or "resp" as RPC (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/Services/RabbitMQPatternDetector.cs:363`).
- Binary bodies are decoded as text (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:934`).
- A queue created with dead-lettering on expiry points at an exchange nothing creates (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQProvider.cs:180`); not reachable from the API today.

### Improvements

- One bindings call grouped by source instead of one HTTP call per exchange on every monitoring poll; the same for subscriptions.
- A `CancellationToken` and an explicit timeout on every management call; materialise the lazy lists. Done 2026-11-13: every response is disposed (`src/ServiceBusExplorer.Core/Providers/RabbitMQ/RabbitMQManagementClient.cs:87` and the other eighteen calls), locked per call by `src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQManagementClientTests.cs:39` and on a 500 by `src/ServiceBusExplorer.Core.Tests/Providers/RabbitMQManagementClientTests.cs:52`.
- Show the usable `amq.*` exchanges; surface a per-exchange failure instead of showing zero subscriptions; read the real delivery count; delete the uncalled members.

### Read and found sound

URL escaping of the virtual host and names; no password in any console line or exception; client lifetime and dispose order; a failed connect is cleaned up; 404 handling; the payload round trip through the management API, except a message with no properties (P1, the batch entry); purge on the right queue.

## API

Read at commit `0369fc4`. The controllers were being edited the same day (error bodies and an exception handler), so this section names files and actions without line numbers; a fix re-reads the action first. Not repeated here: what [[pages/services/api]] already lists.

### P1

- **Receive completes one by one after receiving up to 1000 messages**; a failure partway leaves the earlier ones deleted and never returned. Same root as the Azure entry above, reached from `QueuesController` and `TopicsController`.
- **A resubmit from a subscription's dead-letter queue publishes to the topic**, so every subscription whose filter matches receives a copy, including ones that already processed the original. The code comment says it is intended; the UI does not say so. Needs an owner decision: a warning with a confirmation, or a per-subscription route.

### P2

- **Connect answers `connected: true` without contacting Azure.** The client is built lazily, so a rotated key or an unreachable namespace "connects", replaces the previous working provider, and every later call fails. Fix: the same probe the connection test uses, before the swap. `ConnectionsController.Connect`. Reproduced at the provider by the integration run: `ConnectAsync` to a closed loopback port returns, `IsConnected` is true and the first call fails after four retries, `Defect_connect_to_a_closed_port_succeeds_without_contacting_the_broker` (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:267`); the controller was not executed.
- **Deleting a group hides its connections.** The group is removed and the connections keep pointing at it; the UI shows a connection only when its group exists or it has none, so production connections disappear from the screen while still stored. Environments under a deleted client are lost the same way. `ConnectionGroupsController.DeleteGroup`, `FileWorkspaceManager.DeleteGroupAsync`.
- **After switching connection the monitoring endpoints show the previous broker's numbers** for up to 30 seconds, and a collection already running writes them again after the clear. Snapshots carry no connection identity. `MonitoringBackgroundService`.
- **Metrics always query the one namespace in the `AzureMonitor` settings**, not the namespace of the active connection, and the Electron shell sets none: a packaged app always answers 503, and a configured run shows another namespace's series under this one's entity names. `Program.cs`, `MetricsController`.
- **Connect saves after it swaps.** If the save throws the caller gets 500 with the provider already active, and a connection deleted in between is re-added with its secrets. `ConnectionsController.Connect`.

### P3

- `LastUsedAt` is never persisted; the write in Connect rewrites the workspace for nothing.
- The connection test does not restore masked secrets from the stored record, so testing an unchanged saved connection tests the literal mask (PLAUSIBLE; depends on what the dialog sends).
- The metadata-only comparison on save also omits the management port, the virtual host, the namespace and every service-principal field (extends the recorded gap).
- Group validation exists only on create; update and `import-full` accept a bad type, a missing parent or a group that is its own parent, and a partial update blanks fields. Any of these makes the group vanish from the tree.
- Deleting the connection that is connected leaves the provider active; `status` reports a connection that no longer exists.
- Disconnect can dispose a provider that a concurrent Connect just installed.
- An invalid search regex answers 500 instead of 400, with no timeout on the pattern. The provider throws `RegexParseException`, reproduced in a container (`src/ServiceBusExplorer.IntegrationTests/AzureServiceBusProviderDefectTests.cs:242`); the 500 was not executed.
- `import` reads with case-sensitive options: a camelCase file imports as blank connections and reports success (PLAUSIBLE).
- Fixed 2026-11-13: a session-state request with an empty body or a misspelled property cleared the state on a production session and answered 200. `state` and `expectedState` are now required and a write whose expected state differs writes nothing.
- An undefined `timeRange` value answers 500 instead of 400.
- One topic deleted mid-collection aborts the whole monitoring cycle.
- Port configuration: a missing explicit config path falls through silently; the walk up to the filesystem root accepts the first parseable `config.json` even with neither port key; ports are not range-checked.
- `launchSettings.json` listens on 5197 while the Angular dev environment calls 5917.

### Improvements

- A route-table test that fails when two actions can match one method and URL.
- `DeleteBatchRequest.All` deletes whatever the broker holds at that moment; an optional expected count would refuse when the queue grew since the screen loaded.
- Reject a request with more than one `X-Api-Key` value.
- `status` exposes which saved connection is active; a failed connect keeps and reports the previous target.
- Sessions on an entity without sessions returns an empty list instead of an unhandled exception.
- A batch send on topics, which exists only on queues, if import is meant to work there.
- A batch send reports what was sent, not the input size.
- The fail-fast on `API_SECRET` may lose its buffered log line at exit.

### Read and found sound

The key middleware (only `OPTIONS` and `/health` bypass it; `/healthz`, `//health`, dot segments and `%2F` do not); queue and topic parity action by action (dead-letter flag, subscription name, argument order, the request token); no shadowed route inside a controller; clamps on counts; the lock around the provider slot; `FileWorkspaceManager` locking, atomic save and masking; the export and `import-full` round trip; the monitoring store's bound and order; no secret in the settings files.

## Web app: entities, connections, monitoring, shared

### P1

- **The JSON tree in `message-body-editor` allows script injection from a message body** (latent: nothing imports the component today). It builds HTML with `bypassSecurityTrustHtml` and puts the raw JSON key inside an attribute, with an escape that leaves quotes alone (`web-app/src/app/shared/components/message-body-editor/message-body-editor.component.ts:1027`). A key containing a quote adds an event handler. Script in the renderer can read the API secret and export the stored connections with their secrets. Fix: delete the component, or build the tree with DOM nodes, before anything uses it.

### P2

- **Test connection on a saved connection always fails** (`web-app/src/app/features/connections/add-connection-dialog.component.ts:689`): the dialog sends the masked values with no id and the API does not restore them. Confirms the API entry.
- **Deleting a group hides its connections** (`web-app/src/app/features/connections/manage-group-dialog.component.ts:535`). Confirms the API entry from the UI side.
- **A filter on "Enqueued Time" breaks the message dialog** (`web-app/src/app/core/services/advanced-message-filter.service.ts:170`): it calls a `Date` method on what is a string at runtime. The specs use real dates and miss it.
- **Fixed 2026-11-12: durations of days showed as "1 minute".** One parser now reads every duration, including the `d.hh:mm:ss` form (`web-app/src/app/features/entities/duration.ts:28`); the second one is deleted. The maximum value reads "Never" and a value the API did not send reads "Not set", on the queue, topic and subscription panels alike (`web-app/src/app/features/entities/entity-details.component.ts:1926`).
- **Fixed 2026-11-13: sessions of the previous subscription were shown under the next one.** The inline list was not reset on selection change and was fetched only when empty. The sessions are now a component of their own, mounted only while its tab is open and reset, with whatever is in flight cancelled, when the entity changes (`web-app/src/app/features/entities/entity-sessions.component.ts:216`).
- **A failed load of an entity shows "Loading..." forever, or an empty panel**; the error is never rendered (`web-app/src/app/core/services/entity-selection.service.ts:64`).
- **Counts on the topics page may not repaint after a purge** (PLAUSIBLE, `web-app/src/app/features/topics/topics.component.ts:209`): the app is zoneless and the update mutates an object inside a signal.

### P3

- Listeners for the menu action and for F9 are added on every visit to the connections page and never removed (`web-app/src/app/features/connections/connections.component.ts:425`); after N visits the action runs N times.
- After clear-all or after deleting the connected connection, the header still says connected (`web-app/src/app/features/connections/connections.component.ts:625`).
- The tree loads twice on every visit and can show the previous connection's tree after a switch (`web-app/src/app/features/entities/entities-tree.component.ts:718`). A failed load no longer reads as "No Entities Found" (fixed 2026-11-13, below).
- The transfer monitor shows a growing backlog as a processing rate (`web-app/src/app/features/entities/transfer-monitor.component.ts:231`).
- A regex that matches the empty string can freeze the detail view (`web-app/src/app/shared/pipes/highlight.pipe.ts:58`). The pipe itself is safe against injection.
- A new filter row with no value blanks the list under AND (`web-app/src/app/core/services/advanced-message-filter.service.ts:92`); numbers and dates compare as text.
- Editing a RabbitMQ connection with no stored password saves `guest`; no port validation; the signed-in state survives a change of namespace (`web-app/src/app/features/connections/add-connection-dialog.component.ts:544`).
- A RabbitMQ exchange is shown with the Azure topic form and invented defaults; the inputs are editable and there is no save. Capabilities are ignored.
- **Removed 2026-11-12:** `metrics-dashboard`, which rendered random series under real metric names, and the two unreachable Metrics tabs. The metrics service still falls back to mock data on any error and has no consumer in the app.
- The monitoring page requests history twice on entry (PLAUSIBLE).
- The bug report puts the last error strings in a GitHub URL with no length limit.

### Improvements

- One confirmation builder for destructive actions: entity, parent, connection target, live count, and the typed acknowledgement for purges.
- An environment badge in the header (the group name); today only the namespace string is shown.
- Delete the dead and mock code: `message-body-editor`, the mock fallback, the `.backup` file. (`metrics-dashboard` and the chart leftovers in `entity-details` went on 2026-11-12.)
- Preload listeners return a disposer; `electron.on` forwards its arguments, which `navigate` and `change-connection` lose today.
- A CSP meta tag in `index.html`; no remote resource exists, so `default-src 'self'` should be feasible.
- Specs with the shapes the API really emits (date strings, `d.hh:mm:ss`).

### Read and found sound

The highlight pipe (escape, then wrap, and a plain string so Angular still sanitises); the confirm and bug-report dialogs; `index.html` and the styles (no remote resource); the export dialog (masked by default); the preload channels against their callers; nothing secret in browser storage; no cycle possible in groups; timers torn down on destroy.

## Web app: core services and the messages feature

`view-messages-dialog.component.ts` was read in full. Entries already given above (the selection surviving a connection switch, the enqueued-time filter, RabbitMQ rows with no sequence number) are not repeated.

### P1


### P2

- **The provider type never matches** (`web-app/src/app/core/models/provider.model.ts:5`): the TypeScript enum is numeric and the API sends strings. Saved RabbitMQ connections show as "Unknown Provider", the exchange labels and totals are wrong, and editing a RabbitMQ connection renders no provider section (the last part PLAUSIBLE). Fix: string values in the enum.
- **Fixed 2026-11-13: a CSV export could run formulas.** Every cell goes through one escape, which now prefixes a value starting with `=`, `+`, `-`, `@`, a tab or a carriage return with an apostrophe (`web-app/src/app/core/services/message-export.service.ts:317`), so a spreadsheet reads it as text; a value that already starts with apostrophes before such a character gets one more. The app's own CSV import removes exactly one (`web-app/src/app/core/services/message-import.service.ts:296`), so an exported file imports with the bodies it had. Locked by `a cell from a message that starts like a spreadsheet formula is exported as text, not as a formula` (`web-app/src/app/core/services/message-export.service.spec.ts:309`) and `a CSV the app exported imports with the same bodies and subjects, including values that start like a formula` (`web-app/src/app/core/services/message-import.service.spec.ts:302`). A spreadsheet shows such a value, a negative number included, with the apostrophe hidden; a hand-written CSV whose cell starts with `'=` loses that apostrophe on import. The XLSX path is not affected.
- **The body pane changes large numbers** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:1714`): parse and re-serialise rewrites integers above 2^53, and the diff dialog can show two different bodies as equal. Display only; resubmit uses the raw text.
- **Fixed 2026-11-13: a second send kept the first one's properties and schedule.** Each send now sets both from the form, or clears them when the form holds none (`web-app/src/app/features/messages/send-message-dialog.component.ts:435`, `web-app/src/app/features/messages/send-message-dialog.component.ts:436`); locked by `properties and a schedule the user cleared after a failed send are not sent again` (`web-app/src/app/features/messages/send-message-dialog.component.spec.ts:219`).
- **Edit and resubmit turns every property into text and keeps the original `MessageId`** (`web-app/src/app/features/messages/send-message-dialog.component.ts:332`): typed subscription filters break, and with duplicate detection the edited message can be dropped while the UI says sent.
- **"Save as Template" uses `window.prompt`**, which Electron does not implement (PLAUSIBLE, `web-app/src/app/features/messages/send-message-dialog.component.ts:363`).
- **Fixed 2026-11-13: a failed tree load read as an empty tree,** and the dead-letter alerts were then cleared from partial data. A queue or topic list the API fails to return now fails the tree (`web-app/src/app/core/services/tree-data-builder.service.ts:31`) and the alerts are left as they were; the tree says "Could not load entities" instead of "No Entities Found" (`web-app/src/app/features/entities/entities-tree.component.ts:60`). Locked by `web-app/src/app/core/services/tree-data-builder.service.spec.ts:45`, `web-app/src/app/core/services/tree-data-builder.service.spec.ts:61` and `web-app/src/app/features/entities/entities-tree.component.spec.ts:96`. One topic whose subscriptions fail still shows as a topic with none, logged.
- **After an error in a bulk operation nothing reloads** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:1700`): rows already removed on the server stay on screen with "Please try again".
- **Zoneless repaint gaps** on Select All over 500 messages and on clearing a tab (PLAUSIBLE, `web-app/src/app/features/messages/view-messages-dialog.component.ts:1519`).
- **A property whose value is `0` or `false` renders empty, and a quick search then throws on non-text values** (`web-app/src/app/features/messages/view-messages-dialog.component.ts:517`).
- **An import goes as one batch and reads the wrong error key** (PLAUSIBLE, `web-app/src/app/core/services/message-import.service.ts:166`), so a size failure shows "Unknown error".

### P3

- Excel export writes `[object Object]` for nested values; CSV has no byte order mark; long bodies are cut by Excel.
- Message loads have no cancel, so an older response can overwrite a newer one.
- The single Resubmit has no in-flight guard; a double click sends twice.
- A cancel in the one second between the response and the results dialog shows a completed operation as cancelled.
- Search and filters run only on the loaded page while the badge shows the entity total; the server search endpoints have no client. A regex is rebuilt per field per keystroke.
- A missing API port falls back to 5917 with the key still attached (PLAUSIBLE).

### Improvements

- The message list uses `@for` inside the virtual-scroll viewport, so nothing is virtualised; `formatBody` is called from the template on every pass.
- The logger is silent in production builds, errors included.
- Templates are stored globally in `localStorage`, not per connection, with no handling of a full quota.
- Bulk selection state is keyed by sequence number alone; key it by entity and connection.
- No spec exists for `api.service`, `connection.service`, `entity-selection.service`, `view-messages-dialog` or the resubmit, import, export and move dialogs; the existing ones use shapes the API never emits.

### Read and found sound

`api.service.ts` (the key on every verb, requests wait for port and secret); every route, verb and field of the queue, topic and session services against the controllers; no injection path in the messages feature; the dead-letter flag and subscription name on all three bulk flows, and cancel aborting the request; CSV and JSON import parsing; the scheduled time conversion.

## Where to start

Counted across the five areas at the time of the audit: about 118 findings, 17 of them P1. Entries leave this page as their fixes land; the first to go, on 2026-11-12, were the unencoded names in URLs. The same day: the selection that survived a connection switch, the purge confirmation that named nothing, a delete that could drain the whole entity, the retry and the continuous resubmit that re-sent possible duplicates, and shortcuts acting through open dialogs. Still open from those: the API has no field for a possible duplicate (the web app matches the text), a queue has no live count, an open messages dialog survives a connection switch, and the toolbar has no environment badge. The same few roots explain many of them, so the order is by root, not by count.

1. **RabbitMQ.** Turn the bulk operations and the single resubmit off behind a capability flag, then fix peek, the listing that breaks on a TTL argument and the channel that dies on a missing dead-letter queue. Rebuild the bulk operations over AMQP afterwards.
2. **Azure message safety.** Duplicate detection on the target, per-abandon and per-cycle cleanup, any exception becoming a partial result; extract the shared scan loop first.
3. **Things that are simply broken.** Custom properties on send, queue details showing defaults, durations in days, the numeric provider enum, connect that does not connect, the enqueued-time filter.
4. **Dead and mock code.** Delete `message-body-editor` (it carries a script-injection path), the mock metrics fallback and the `.backup` file; `metrics-dashboard` went on 2026-11-12.

Owner decisions this audit raised: a resubmit from a subscription's dead-letter queue reaching every subscription; selective delete and move on active entities, which cannot be made free of side effects; metrics tied to one configured namespace.
