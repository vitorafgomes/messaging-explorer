using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using static ServiceBusExplorer.Api.Tests.McpToolTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// dead_letter_messages, resubmit_messages, move_messages, delete_messages, purge_messages and
/// cancel_scheduled_messages: offered only at the level all, always asked in the app, refused by capability before
/// anybody is asked, run once only after the user's answer through the code path of their route, and answering what
/// the route answers, the report per sequence number included. Nothing is retried.
/// </summary>
public class McpRemoveToolTests
{
    public static readonly TheoryData<string> Tools = ["delete_messages", "purge_messages", "dead_letter_messages", "cancel_scheduled_messages", "resubmit_messages", "move_messages"];

    private static readonly string[] NumberedToolNames = ["delete_messages", "dead_letter_messages", "cancel_scheduled_messages", "resubmit_messages", "move_messages"];

    public static readonly TheoryData<string> NumberedTools = new(NumberedToolNames);

    /// <summary>The arguments of each tool, with <paramref name="numbers"/> as its sequence numbers.</summary>
    private static object Args(string tool, object? numbers = null)
    {
        numbers ??= new long[] { 12, 13 };
        return tool switch
        {
            "delete_messages" => new { entity = "orders", subQueue = "deadLetter", sequenceNumbers = numbers, reason = "clean up order 42" },
            "purge_messages" => new { entity = "events", subscription = "audit", subQueue = "active", reason = "clean up order 42" },
            "dead_letter_messages" => new { entity = "orders", sequenceNumbers = numbers, reason = "clean up order 42", deadLetterReason = "poison", deadLetterDescription = "bad json" },
            "cancel_scheduled_messages" => new { entity = "orders", sequenceNumbers = numbers, reason = "clean up order 42" },
            "resubmit_messages" => new { entity = "events", subscription = "audit", sequenceNumbers = numbers, reason = "clean up order 42" },
            "move_messages" => new { entity = "orders", subQueue = "deadLetter", sequenceNumbers = numbers, target = "orders-retry", reason = "clean up order 42" },
            _ => throw new ArgumentOutOfRangeException(nameof(tool)),
        };
    }

    /// <summary>What each tool calls, records as asked and where, and the verb of its outcome.</summary>
    private static (string Method, string Asked, string Where, string Verb) Expected(string tool) => tool switch
    {
        "delete_messages" => (nameof(IMessagingProvider.DeleteMessagesAsync), "Delete 2 messages", "orders (dead-letter queue) on offered-name", "deleted"),
        "purge_messages" => (nameof(IMessagingProvider.PurgeMessagesAsync), "Purge the subscription", "events / audit (active) on offered-name", "purged"),
        "dead_letter_messages" => (nameof(IMessagingProvider.DeadLetterMessagesAsync), "Dead-letter 2 messages", "orders (active) on offered-name", "dead-lettered"),
        "cancel_scheduled_messages" => (nameof(IMessagingProvider.CancelScheduledMessagesAsync), "Cancel 2 scheduled messages", "orders (scheduled) on offered-name", "cancelled"),
        "resubmit_messages" => (nameof(IMessagingProvider.ResubmitDeadLetterMessagesAsync), "Resubmit 2 messages", "events / audit (dead-letter queue) on offered-name", "resubmitted"),
        "move_messages" => (nameof(IMessagingProvider.MoveMessagesAsync), "Move 2 messages", "orders (dead-letter queue) on offered-name", "moved"),
        _ => throw new ArgumentOutOfRangeException(nameof(tool)),
    };

    private static async Task<Host> StartAsync(Broker broker, string level = "all", ServiceBusConnection? connection = null, bool? neverAsk = null, TimeSpan? wait = null)
    {
        var host = new Host(broker, wait);
        await host.StartAsync();
        connection ??= Offered();
        await host.SeedAsync(connection);
        await host.OfferAsync(connection.Id, level, neverAsk);
        await host.ConnectAsync(connection.Id);
        return host;
    }

    /// <summary>Waits for the one request and allows it, typing the word it asks for when it asks for one.</summary>
    private static async Task<JsonElement> AllowOnlyRequestAsync(Host host)
    {
        var waiting = await host.WaitForRequestsAsync();
        Assert.True(waiting.GetArrayLength() == 1, $"the tool asks the user in the app before it goes on; the requests waiting were {waiting}");
        var request = waiting[0].Clone();
        var typed = request.GetProperty("typed");
        var word = typed.ValueKind == JsonValueKind.Null ? null : typed.GetProperty("word").GetString();
        using var answered = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{request.GetProperty("id").GetString()}/answer", new { allow = true, typed = word });
        Assert.Equal(HttpStatusCode.NoContent, answered.StatusCode);
        return request;
    }

    private static (string Asked, string Where, string Outcome, string Kind) Line(JsonElement line) =>
        (line.GetProperty("asked").GetString()!, line.GetProperty("where").GetString()!, line.GetProperty("outcome").GetString()!, line.GetProperty("kind").GetString()!);

    private static List<(string, string)> Facts(JsonElement request) =>
        request.GetProperty("facts").EnumerateArray().Select(f => (f.GetProperty("label").GetString()!, f.GetProperty("value").GetString()!)).ToList();

    [Theory]
    [MemberData(nameof(Tools))]
    public async Task Each_tool_waits_for_the_user_and_calls_its_route_path_once_only_after_the_allow(string tool)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);
        var expected = Expected(tool);

        var call = host.CallAsync(tool, Args(tool));
        await host.WaitForRequestsAsync();
        var callsWhileWaiting = broker.BatchCalls.Count;
        await AllowOnlyRequestAsync(host);
        var (isError, text) = await call;

        Assert.True(callsWhileWaiting == 0, $"{tool} does nothing before the user's answer; the provider was called {callsWhileWaiting} times while the request waited");
        Assert.False(isError, text);
        var done = Assert.Single(broker.BatchCalls);
        Assert.True(done.Method == expected.Method, $"{tool} goes through the provider call of its route; it called {done.Method}");
        Assert.True(done.Token.CanBeCanceled, $"{tool} hands the caller's token to the provider, as its route hands the request's");
        using var doc = JsonDocument.Parse(text);
        if (tool == "purge_messages")
        {
            Assert.True(doc.RootElement.GetProperty("success").GetBoolean(), $"purge_messages answers what its route answers, {{ success }}: {text}");
            Assert.Equal(("events", "audit", MessageSubQueue.Active), (done.Entity, done.Subscription, done.SubQueue));
        }
        else
        {
            Assert.True((doc.RootElement.GetProperty("successCount").GetInt32(), doc.RootElement.GetProperty("failureCount").GetInt32()) == (2, 0),
                $"{tool} answers the route's result per sequence number: {text}");
            Assert.Equal([12L, 13L], done.Numbers);
        }
        var outcome = tool == "purge_messages" ? "Purged, 5 counted before, allowed by you" : $"2 {expected.Verb}, allowed by you";
        Assert.Equal((expected.Asked, expected.Where, outcome, "ok"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Theory]
    [MemberData(nameof(Tools))]
    public async Task A_denial_a_cancellation_while_waiting_and_no_answer_in_time_each_do_nothing(string tool)
    {
        var broker = new Broker();
        await using (var host = await StartAsync(broker))
        {
            var denied = host.CallAsync(tool, Args(tool));
            await host.AnswerOnlyRequestAsync(allow: false);
            var deniedAnswer = await denied;
            Assert.True(deniedAnswer == (true, McpToolCalls.DeniedSentence) && broker.BatchCalls.Count == 0,
                $"a denied {tool} answers the fixed sentence and does nothing; it answered {deniedAnswer} after {broker.BatchCalls.Count} provider calls");

            using var cancel = new CancellationTokenSource();
            var cancelled = host.CallAsync(tool, Args(tool), cancel.Token);
            await host.WaitForRequestsAsync();
            await cancel.CancelAsync();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);

            var until = DateTime.UtcNow.AddSeconds(5);
            while ((await host.ActivityAsync()).GetArrayLength() < 2 && DateTime.UtcNow < until) await Task.Delay(20);
            var outcomes = (await host.ActivityAsync()).EnumerateArray().Select(l => l.GetProperty("outcome").GetString()).ToList();
            Assert.Equal(["Cancelled", "Denied by you"], outcomes);
        }

        await using (var host = await StartAsync(broker, wait: TimeSpan.FromMilliseconds(300)))
        {
            var answer = await host.CallAsync(tool, Args(tool)).WaitAsync(TimeSpan.FromSeconds(10));
            Assert.Equal((true, McpToolCalls.NoAnswerSentence), answer);
            Assert.Equal("Denied: no answer in two minutes", Assert.Single((await host.ActivityAsync()).EnumerateArray()).GetProperty("outcome").GetString());
        }

        Assert.True(broker.BatchCalls.Count == 0, $"{tool} does nothing after a denial, a cancellation while waiting or no answer; the provider was called {broker.BatchCalls.Count} times");
    }

    [Theory]
    [MemberData(nameof(NumberedTools))]
    public async Task A_batch_that_fails_midway_answers_the_route_report_per_sequence_number_and_nothing_is_retried(string tool)
    {
        var broker = new Broker
        {
            BatchResult = numbers => new BatchOperationResult
            {
                SuccessCount = 1,
                FailureCount = 1,
                Failures = [new BatchOperationFailure { SequenceNumber = numbers[1], Error = "The entity is disabled for this operation.", PossibleDuplicate = true }],
                NewMessageIds = new Dictionary<long, string> { [numbers[0]] = "new-id" },
                UnselectedDeliveryCountRaised = 3,
                UnselectedDeadLettered = [99],
            },
        };
        await using var host = await StartAsync(broker);

        var call = host.CallAsync(tool, Args(tool));
        await AllowOnlyRequestAsync(host);
        var (isError, text) = await call;

        Assert.False(isError, text);
        using var doc = JsonDocument.Parse(text);
        var root = doc.RootElement;
        var failure = Assert.Single(root.GetProperty("failures").EnumerateArray());
        Assert.True((root.GetProperty("successCount").GetInt32(), root.GetProperty("failureCount").GetInt32(), failure.GetProperty("sequenceNumber").GetInt64(), failure.GetProperty("possibleDuplicate").GetBoolean()) == (1, 1, 13L, true),
            $"{tool} reports every failure by its sequence number with its possible-duplicate flag, as its route does: {text}");
        Assert.True(root.GetProperty("newMessageIds").GetProperty("12").GetString() == "new-id" && root.GetProperty("unselectedDeliveryCountRaised").GetInt32() == 3
            && root.GetProperty("unselectedDeadLettered")[0].GetInt64() == 99, $"{tool} answers the new message ids and the unselected-delivery fields of its route: {text}");
        Assert.True(broker.BatchCalls.Count == 1, $"{tool} retries nothing; the provider was called {broker.BatchCalls.Count} times");
        var expected = Expected(tool);
        Assert.Equal((expected.Asked, expected.Where, $"1 {expected.Verb}, 1 not {expected.Verb}, allowed by you", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    public static readonly TheoryData<string, string> FailingCalls = new()
    {
        { "delete_messages", "broker" }, { "delete_messages", "timeout" }, { "delete_messages", "unauthorised" },
        { "purge_messages", "broker" }, { "purge_messages", "timeout" }, { "purge_messages", "unauthorised" },
        { "dead_letter_messages", "broker" }, { "dead_letter_messages", "timeout" }, { "dead_letter_messages", "unauthorised" },
        { "cancel_scheduled_messages", "broker" }, { "cancel_scheduled_messages", "timeout" }, { "cancel_scheduled_messages", "unauthorised" },
        { "resubmit_messages", "broker" }, { "resubmit_messages", "timeout" }, { "resubmit_messages", "unauthorised" },
        { "move_messages", "broker" }, { "move_messages", "timeout" }, { "move_messages", "unauthorised" },
    };

    [Theory]
    [MemberData(nameof(FailingCalls))]
    public async Task A_provider_call_that_fails_answers_the_route_fixed_sentence_records_it_and_retries_nothing(string tool, string failure)
    {
        Exception thrown = failure switch
        {
            "broker" => new InvalidOperationException("broker said " + Sentinel),
            "timeout" => new TimeoutException("timed out at " + Sentinel),
            _ => new UnauthorizedAccessException("claims " + Sentinel),
        };
        var broker = new Broker { BatchFailure = thrown };
        await using var host = await StartAsync(broker);

        var call = host.CallAsync(tool, Args(tool));
        await AllowOnlyRequestAsync(host);
        var (isError, text) = await call;

        var sentence = McpToolCalls.MessageOf(EntityAdministrationResults.Unhandled(thrown));
        Assert.True(isError && text == sentence, $"{tool} answers the fixed sentence of its route when the provider throws {thrown.GetType().Name}, never the exception's text; it answered {text}");
        AssertNoSecret(text, host.Token, tool);
        Assert.True(broker.BatchCalls.Count == 1, $"{tool} retries nothing after a failure; the provider was called {broker.BatchCalls.Count} times");
        var expected = Expected(tool);
        Assert.Equal((expected.Asked, expected.Where, "Failed, allowed by you", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Theory]
    [MemberData(nameof(Tools))]
    public async Task Below_the_level_all_each_tool_is_refused_without_asking(string tool)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, level: "readAndSend");

        var answer = await host.CallUnaskedAsync(tool, Args(tool), "a connection offered below all refuses moving and removing without asking");

        Assert.True(answer == (true, McpRemoveTools.LevelRefused), $"a connection offered at readAndSend refuses {tool} with the fixed sentence; it answered {answer}");
        Assert.Empty(broker.BatchCalls);
        Assert.Equal("Refused: not offered for moving or removing", Assert.Single((await host.ActivityAsync()).EnumerateArray()).GetProperty("outcome").GetString());
    }

    [Theory]
    [MemberData(nameof(Tools))]
    public async Task Each_tool_asks_even_on_a_local_broker_the_user_marked_never_asked(string tool)
    {
        var broker = new Broker();
        var local = new ServiceBusConnection { Id = "c-local", Name = "local-name", ProviderType = ProviderType.RabbitMQ, HostName = "localhost", UserName = "guest", Password = Sentinel };
        await using var host = await StartAsync(broker, connection: local, neverAsk: true);

        var call = host.CallAsync(tool, Args(tool));
        var waiting = await host.WaitForRequestsAsync();
        foreach (var request in waiting.EnumerateArray())
        {
            using (await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{request.GetProperty("id").GetString()}/answer", new { allow = false })) { }
        }
        await call;

        Assert.True(waiting.GetArrayLength() == 1, $"{tool} asks the user even on a local test broker marked never asked; the requests were {waiting}");
        Assert.Empty(broker.BatchCalls);
    }

    [Fact]
    public async Task A_provider_that_names_a_message_by_its_position_is_refused_for_the_numbered_tools_and_purge_still_asks()
    {
        var broker = new Broker { SupportsSequenceNumbers = false };
        await using var host = await StartAsync(broker);

        foreach (var tool in NumberedToolNames)
        {
            var answer = await host.CallUnaskedAsync(tool, Args(tool), "a provider that names a message by its position is refused without asking");
            Assert.True(answer == (true, McpRemoveTools.PositionRefused), $"{tool} on a provider that names a message by its position answers the fixed sentence; it answered {answer}");
        }
        var purge = host.CallAsync("purge_messages", Args("purge_messages"));
        await AllowOnlyRequestAsync(host);

        Assert.False((await purge).IsError, "purge_messages names no message, so it stays available on a provider that names messages by position");
        Assert.Equal(nameof(IMessagingProvider.PurgeMessagesAsync), Assert.Single(broker.BatchCalls).Method);
    }

    public static readonly TheoryData<string, string, string> MissingCapabilities = new()
    {
        { "delete_messages", "transfer", "This provider does not support the transfer dead-letter queue." },
        { "purge_messages", "deadLetter", "This provider does not support the dead-letter queue." },
        { "dead_letter_messages", "manual", "This provider does not support dead-lettering a message by sequence number." },
        { "cancel_scheduled_messages", "scheduled", "This provider does not support scheduled messages." },
        { "move_messages", "bulk", McpRemoveTools.BulkRefused },
        { "resubmit_messages", "subscriptions", "This provider does not support subscriptions." },
    };

    [Theory]
    [MemberData(nameof(MissingCapabilities))]
    public async Task A_capability_the_provider_does_not_declare_is_refused_with_its_sentence_before_anybody_is_asked(string tool, string missing, string sentence)
    {
        var broker = new Broker
        {
            SupportsTransferDeadLetter = missing != "transfer",
            SupportsDeadLetterQueue = missing != "deadLetter",
            SupportsManualDeadLetter = missing != "manual",
            SupportsScheduledMessages = missing != "scheduled",
            SupportsBulkMessageOperations = missing != "bulk",
            SupportsSubscriptions = missing != "subscriptions",
        };
        await using var host = await StartAsync(broker);
        var args = tool switch
        {
            "delete_messages" => new { entity = "orders", subQueue = "transferDeadLetter", sequenceNumbers = new long[] { 12 }, reason = "r" },
            "purge_messages" => (object)new { entity = "orders", subQueue = "deadLetter", reason = "r" },
            _ => Args(tool),
        };

        var answer = await host.CallUnaskedAsync(tool, args, "a capability the provider does not declare is refused before anybody is asked");

        Assert.True(answer == (true, sentence), $"{tool} without {missing} answers its fixed sentence; it answered {answer}");
        Assert.Empty(broker.BatchCalls);
    }

    [Fact]
    public async Task A_move_to_a_target_that_does_not_exist_is_refused_before_anybody_is_asked_and_moves_nothing()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var answer = await host.CallUnaskedAsync("move_messages", new { entity = "orders", subQueue = "deadLetter", sequenceNumbers = new long[] { 12 }, target = "no-such-queue", reason = "r" },
            "a move to a target that does not exist is refused before anybody is asked");
        var refusedRequests = (await host.RequestsAsync()).GetArrayLength();
        var toTopic = host.CallAsync("move_messages", new { entity = "orders", subQueue = "deadLetter", sequenceNumbers = new long[] { 12 }, target = "events", reason = "r" });
        var topicRequest = await host.AnswerOnlyRequestAsync(allow: false);
        await toTopic;

        Assert.True(answer == (true, McpRemoveTools.TargetNotFound), $"a move to a target that is neither a queue nor a topic answers the fixed sentence; it answered {answer}");
        Assert.True(broker.BatchCalls.Count == 0, $"a move to a target that does not exist moves nothing; the provider was called {broker.BatchCalls.Count} times");
        Assert.Equal(0, refusedRequests);
        Assert.True(topicRequest.GetProperty("title").GetString() == "Assistant asks to move 1 message", $"a move to a target that is a topic is looked up as a send's is and asks the user; the request was {topicRequest}");
        Assert.Equal(("Move 1 message", "orders (dead-letter queue) on offered-name", "Refused: target not found", "error"), Line((await host.ActivityAsync()).EnumerateArray().Last()));
    }

    [Theory]
    [InlineData("broker", "queue")]
    [InlineData("timeout", "queue")]
    [InlineData("broker", "topic")]
    [InlineData("timeout", "topic")]
    public async Task A_move_whose_lookup_of_the_target_fails_answers_the_fixed_sentence_asks_nobody_and_moves_nothing(string failure, string lookup)
    {
        var broker = new Broker
        {
            FailTopicLookup = lookup == "topic",
            LookupFailure = failure == "timeout"
                ? new TimeoutException(Sentinel)
                : new Azure.Messaging.ServiceBus.ServiceBusException(Sentinel, Azure.Messaging.ServiceBus.ServiceBusFailureReason.ServiceCommunicationProblem),
        };
        await using var host = await StartAsync(broker);

        var answer = await host.CallUnaskedAsync("move_messages", new { entity = "events", subscription = "audit", sequenceNumbers = new long[] { 12 }, target = "no-such-queue", reason = "r" },
            $"a move whose lookup of the target fails ({failure}, {lookup}) asks nobody");

        Assert.True(answer == (true, "An internal error occurred."), $"a move whose lookup of the target fails ({failure}, {lookup}) answers the fixed sentence, never the broker's text; it answered {answer}");
        Assert.True(broker.BatchCalls.Count == 0, $"nothing is moved when the target could not be looked up; the provider was called {broker.BatchCalls.Count} times");
        Assert.Equal(0, (await host.RequestsAsync()).GetArrayLength());
        Assert.Equal(("Move 1 message", "events / audit (active) on offered-name", "Failed", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Theory]
    [InlineData("delete_messages", "queue", "broker")]
    [InlineData("delete_messages", "queue", "timeout")]
    [InlineData("dead_letter_messages", "queue", "broker")]
    [InlineData("dead_letter_messages", "queue", "timeout")]
    [InlineData("move_messages", "queue", "broker")]
    [InlineData("purge_messages", "subscription", "broker")]
    [InlineData("purge_messages", "subscription", "timeout")]
    [InlineData("resubmit_messages", "subscription", "broker")]
    [InlineData("resubmit_messages", "subscription", "timeout")]
    [InlineData("cancel_scheduled_messages", "queue", "broker")]
    [InlineData("cancel_scheduled_messages", "queue", "timeout")]
    [InlineData("cancel_scheduled_messages", "topic", "broker")]
    [InlineData("cancel_scheduled_messages", "topic", "timeout")]
    public async Task A_tool_whose_lookup_of_its_entity_fails_answers_the_fixed_sentence_asks_nobody_and_does_nothing(string tool, string lookup, string failure)
    {
        Exception failed = failure == "timeout"
            ? new TimeoutException(Sentinel)
            : new Azure.Messaging.ServiceBus.ServiceBusException(Sentinel, Azure.Messaging.ServiceBus.ServiceBusFailureReason.ServiceCommunicationProblem);
        var broker = lookup == "subscription"
            ? new Broker { SubscriptionLookupFailure = failed }
            : new Broker { LookupFailure = failed, FailTopicLookup = lookup == "topic" };
        await using var host = await StartAsync(broker);
        var arguments = lookup == "topic" ? new { entity = "events", sequenceNumbers = new long[] { 12 }, reason = "r" } : Args(tool);

        var answer = await host.CallUnaskedAsync(tool, arguments, $"{tool} whose lookup of its {lookup} fails ({failure}) asks nobody");

        Assert.True(answer == (true, "An internal error occurred."), $"{tool} whose lookup of its {lookup} fails ({failure}) answers the fixed sentence, never the broker's text; it answered {answer}");
        Assert.True(broker.BatchCalls.Count == 0, $"nothing is done when the {lookup} could not be looked up; the provider was called {broker.BatchCalls.Count} times");
        Assert.Equal(0, (await host.RequestsAsync()).GetArrayLength());
        var line = Line(Assert.Single((await host.ActivityAsync()).EnumerateArray()));
        Assert.True(line.Item3 == "Failed" && line.Item4 == "error", $"the failed lookup is recorded as a failure; the record said {line}");
    }

    [Fact]
    public async Task Sequence_numbers_are_taken_1_to_100_as_numbers_or_numeric_strings()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var none = await host.CallUnaskedAsync("delete_messages", Args("delete_messages", Array.Empty<long>()), "no sequence number is refused without asking");
        var tooMany = await host.CallUnaskedAsync("delete_messages", Args("delete_messages", Enumerable.Range(1, 101).Select(i => (long)i).ToArray()), "101 sequence numbers are refused without asking");
        var strings = host.CallAsync("delete_messages", Args("delete_messages", new[] { "12", "13" }));
        await AllowOnlyRequestAsync(host);
        var hundred = host.CallAsync("delete_messages", Args("delete_messages", Enumerable.Range(1, 100).Select(i => (long)i).ToArray()));
        await AllowOnlyRequestAsync(host);

        const string Count = "sequenceNumbers must hold 1 to 100 sequence numbers.";
        Assert.True(none == (true, Count) && tooMany == (true, Count), $"a call takes 1 to 100 sequence numbers; 0 answered {none}, 101 answered {tooMany}");
        Assert.False((await strings).IsError, "sequence numbers given as numeric strings are taken");
        Assert.False((await hundred).IsError, "100 sequence numbers are taken");
        Assert.Equal([[12L, 13L], Enumerable.Range(1, 100).Select(i => (long)i).ToArray()], broker.BatchCalls.Select(c => c.Numbers));
    }

    [Fact]
    public async Task An_allow_of_a_delete_needs_the_name_typed_exactly_and_a_wrong_word_keeps_the_request_waiting()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("delete_messages", Args("delete_messages"));
        var id = (await host.WaitForRequestsAsync())[0].GetProperty("id").GetString();
        using var untyped = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = true });
        using var wrongCase = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = true, typed = "Orders" });
        var stillWaiting = (await host.RequestsAsync()).GetArrayLength();
        var callsBefore = broker.BatchCalls.Count;
        using var exact = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = true, typed = "orders" });
        var answer = await call;

        Assert.True((untyped.StatusCode, wrongCase.StatusCode) == (HttpStatusCode.BadRequest, HttpStatusCode.BadRequest),
            $"an allow without the name typed exactly answers 400; it answered {(int)untyped.StatusCode} and {(int)wrongCase.StatusCode}");
        using (var body = JsonDocument.Parse(await wrongCase.Content.ReadAsStringAsync()))
            Assert.Equal(McpController.WrongWord, body.RootElement.GetProperty("message").GetString());
        Assert.True(stillWaiting == 1 && callsBefore == 0, $"a wrong word keeps the request waiting and does nothing; {stillWaiting} waited and the provider was called {callsBefore} times");
        Assert.Equal(HttpStatusCode.NoContent, exact.StatusCode);
        Assert.False(answer.IsError, answer.Text);
        Assert.Single(broker.BatchCalls);
    }

    [Fact]
    public async Task An_allow_after_the_connection_was_lowered_below_all_does_nothing()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("move_messages", Args("move_messages"));
        await host.WaitForRequestsAsync();
        await host.OfferAsync("c-offered", "readAndSend");
        await AllowOnlyRequestAsync(host);
        var answer = await call;

        Assert.True(answer == (true, McpReadTools.NotOffered), $"an allow is taken only while the connection is still offered at all; it answered {answer}");
        Assert.True(broker.BatchCalls.Count == 0, $"nothing is moved after the level was lowered; the provider was called {broker.BatchCalls.Count} times");
    }

    public static readonly TheoryData<string, string, string, string, string, bool, string?> Requests = new()
    {
        { "delete_messages", "Assistant asks to delete 2 messages", "From=orders, dead-letter queue|On=offered-name|Messages=2, sequence numbers 12 to 13|It said why=clean up order 42",
          "A deleted message cannot be brought back. Only the messages named by their sequence numbers are removed.", "Delete 2 messages", true, "Type the queue name to allow it=orders" },
        { "purge_messages", "Assistant asks to purge events / audit", "From=events / audit, active|On=offered-name|Messages=All of them: 5 counted now|It said why=clean up order 42",
          "Every message there is removed and cannot be brought back.", "Purge the subscription", true, "Type the subscription name to allow it=audit" },
        { "dead_letter_messages", "Assistant asks to dead-letter 2 messages", "From=orders, active|On=offered-name|Messages=2, sequence numbers 12 to 13|It said why=clean up order 42",
          "The messages leave the active queue and wait in its dead-letter queue.", "Dead-letter 2 messages", false, null },
        { "cancel_scheduled_messages", "Assistant asks to cancel 2 scheduled messages", "From=orders, scheduled|On=offered-name|Messages=2, sequence numbers 12 to 13|It said why=clean up order 42",
          "A cancelled message is removed and is never delivered.", "Cancel 2 messages", true, null },
        { "resubmit_messages", "Assistant asks to resubmit 2 messages", "From=events / audit, dead-letter queue|On=offered-name|Messages=2, sequence numbers 12 to 13|It said why=clean up order 42",
          "Each message is published to the topic events again, so every subscription it matches receives it, and is then removed from the dead-letter queue. One that is sent and cannot be removed is reported as a possible duplicate.", "Resubmit 2 messages", false, null },
        { "move_messages", "Assistant asks to move 2 messages", "From=orders, dead-letter queue|To=orders-retry|On=offered-name|Messages=2, sequence numbers 12 to 13|It said why=clean up order 42",
          "Each message is sent to orders-retry and then removed from its source. One that is sent and cannot be removed is reported as a possible duplicate.", "Move 2 messages", false, null },
    };

    [Theory]
    [MemberData(nameof(Requests))]
    public async Task The_request_says_what_where_how_many_and_why_in_fixed_words_with_no_secret(string tool, string title, string facts, string note, string allowLabel, bool danger, string? typed)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync(tool, Args(tool));
        var request = await host.AnswerOnlyRequestAsync(allow: false);
        await call;

        var shownTyped = request.GetProperty("typed") is { ValueKind: JsonValueKind.Object } t ? $"{t.GetProperty("label").GetString()}={t.GetProperty("word").GetString()}" : null;
        Assert.Equal((title, facts, note, allowLabel, danger, typed),
            (request.GetProperty("title").GetString(), string.Join("|", Facts(request).Select(f => $"{f.Item1}={f.Item2}")), request.GetProperty("note").GetString(),
             request.GetProperty("allowLabel").GetString(), request.GetProperty("danger").GetBoolean(), shownTyped));
        AssertNoSecret(request.GetRawText(), host.Token, "a request");
        AssertNoSecret((await host.ActivityAsync()).GetRawText(), host.Token, "the record");
    }

    [Fact]
    public async Task One_message_is_written_in_the_singular_a_queue_resubmit_names_the_queue_and_a_purge_without_counts_says_so()
    {
        var broker = new Broker { SupportsMessageCounts = false };
        await using var host = await StartAsync(broker);

        var resubmit = host.CallAsync("resubmit_messages", new { entity = "orders", sequenceNumbers = new long[] { 7 }, reason = "r" });
        var resubmitRequest = await host.AnswerOnlyRequestAsync(allow: false);
        await resubmit;
        var purge = host.CallAsync("purge_messages", new { entity = "orders", subQueue = "deadLetter", reason = "r" });
        var purgeRequest = await host.AnswerOnlyRequestAsync(allow: false);
        await purge;

        Assert.Equal(("Assistant asks to resubmit 1 message", "Resubmit 1 message", "Each message is sent to orders again and then removed from the dead-letter queue. One that is sent and cannot be removed is reported as a possible duplicate."),
            (resubmitRequest.GetProperty("title").GetString(), resubmitRequest.GetProperty("allowLabel").GetString(), resubmitRequest.GetProperty("note").GetString()));
        Assert.Contains(("Messages", "1, sequence number 7"), Facts(resubmitRequest));
        Assert.Equal(("Purge the queue", "Type the queue name to allow it"), (purgeRequest.GetProperty("allowLabel").GetString(), purgeRequest.GetProperty("typed").GetProperty("label").GetString()));
        Assert.Contains(("Messages", "All of them: this broker gives no count"), Facts(purgeRequest));
    }

    [Theory]
    [InlineData("delete_messages", true)]
    [InlineData("purge_messages", true)]
    [InlineData("dead_letter_messages", true)]
    [InlineData("cancel_scheduled_messages", true)]
    [InlineData("resubmit_messages", false)]
    [InlineData("move_messages", false)]
    public async Task Each_tool_is_listed_as_not_read_only_and_not_idempotent_and_destructive_where_it_removes(string tool, bool destructive)
    {
        await using var host = await StartAsync(new Broker());

        var annotations = (await host.ListedToolAsync(tool)).GetProperty("annotations");

        Assert.Equal((false, destructive, false),
            (annotations.GetProperty("readOnlyHint").GetBoolean(), annotations.GetProperty("destructiveHint").GetBoolean(), annotations.GetProperty("idempotentHint").GetBoolean()));
    }
}
