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
/// create_, update_ and delete_ of queues, topics, subscriptions and rules: offered only at the level all, always asked
/// in the app, a delete only with the name typed, refused by capability, by the shape of the name and by the lookups
/// before anybody is asked, run once only after the user's answer through the body of their route, and answering what
/// the route answers. Nothing is retried.
/// </summary>
public class McpEntityToolTests
{
    private const string Reason = "set up billing";

    private static readonly string[] ToolNames =
    [
        "create_queue", "update_queue", "delete_queue", "create_topic", "update_topic", "delete_topic",
        "create_subscription", "update_subscription", "delete_subscription", "create_rule", "update_rule", "delete_rule",
    ];

    public static readonly TheoryData<string> Tools = new(ToolNames);

    private static object Args(string tool) => tool switch
    {
        "create_queue" => new { name = "billing", options = new { lockDuration = "00:01:00", maxDeliveryCount = 5, requiresSession = true }, reason = Reason },
        "update_queue" => new { name = "orders", options = new { maxDeliveryCount = 5, status = "Disabled" }, reason = Reason },
        "delete_queue" => new { name = "orders", reason = Reason },
        "create_topic" => new { name = "billing-events", reason = Reason },
        "update_topic" => new { name = "events", options = new { supportOrdering = true }, reason = Reason },
        "delete_topic" => new { name = "events", reason = Reason },
        "create_subscription" => new { topic = "events", name = "billing", options = new { maxDeliveryCount = 3 }, reason = Reason },
        "update_subscription" => new { topic = "events", name = "audit", options = new { status = "ReceiveDisabled" }, reason = Reason },
        "delete_subscription" => new { topic = "events", name = "audit", reason = Reason },
        "create_rule" => new { topic = "events", subscription = "audit", name = "big-orders", rule = new { filterType = "Sql", sqlExpression = "amount > 100" }, reason = Reason },
        "update_rule" => new { topic = "events", subscription = "audit", name = "big-orders", rule = new { filterType = "Correlation", correlation = new { subject = "order" } }, reason = Reason },
        "delete_rule" => new { topic = "events", subscription = "audit", name = "$Default", reason = Reason },
        _ => throw new ArgumentOutOfRangeException(nameof(tool)),
    };

    /// <summary>What each tool calls with which names, records as asked and where, its verb, and what its answer names.</summary>
    private static (string Method, string Names, string Asked, string Where, string Done, string? Answered) Expected(string tool) => tool switch
    {
        "create_queue" => (nameof(IMessagingProvider.CreateQueueAsync), "billing", "Create the queue billing", "offered-name", "Created", null),
        "update_queue" => (nameof(IMessagingProvider.UpdateQueueAsync), "orders", "Change the queue orders", "offered-name", "Changed", "orders"),
        "delete_queue" => (nameof(IMessagingProvider.DeleteQueueAsync), "orders", "Delete the queue orders", "offered-name", "Deleted", null),
        "create_topic" => (nameof(IMessagingProvider.CreateTopicAsync), "billing-events", "Create the topic billing-events", "offered-name", "Created", null),
        "update_topic" => (nameof(IMessagingProvider.UpdateTopicAsync), "events", "Change the topic events", "offered-name", "Changed", "events"),
        "delete_topic" => (nameof(IMessagingProvider.DeleteTopicAsync), "events", "Delete the topic events", "offered-name", "Deleted", null),
        "create_subscription" => (nameof(IMessagingProvider.CreateSubscriptionAsync), "events/billing", "Create the subscription billing", "events on offered-name", "Created", null),
        "update_subscription" => (nameof(IMessagingProvider.UpdateSubscriptionAsync), "events/audit", "Change the subscription audit", "events on offered-name", "Changed", "audit"),
        "delete_subscription" => (nameof(IMessagingProvider.DeleteSubscriptionAsync), "events/audit", "Delete the subscription audit", "events on offered-name", "Deleted", null),
        "create_rule" => (nameof(IMessagingProvider.CreateRuleAsync), "events/audit", "Create the rule big-orders", "events / audit on offered-name", "Created", "big-orders"),
        "update_rule" => (nameof(IMessagingProvider.UpdateRuleAsync), "events/audit/big-orders", "Change the rule big-orders", "events / audit on offered-name", "Changed", "big-orders"),
        "delete_rule" => (nameof(IMessagingProvider.DeleteRuleAsync), "events/audit/$Default", "Delete the rule $Default", "events / audit on offered-name", "Deleted", null),
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

    private static string Names(AdminCall call) => string.Join("/", call.Args.OfType<string>());

    /// <summary>Calls a tool that must be refused before anybody is asked, and asserts nothing was asked or done.</summary>
    private static async Task<string> RefusedUnaskedAsync(Host host, Broker broker, string tool, object args, string requirement)
    {
        var (isError, text) = await host.CallUnaskedAsync(tool, args, requirement);
        Assert.True(isError, $"{requirement}: {tool} answered {text}");
        Assert.True(broker.AdminCalls.Count == 0, $"{requirement}: nothing is created, changed or deleted; the provider was called {broker.AdminCalls.Count} times");
        Assert.Equal(0, (await host.RequestsAsync()).GetArrayLength());
        return text;
    }

    [Theory]
    [MemberData(nameof(Tools))]
    public async Task Each_tool_waits_for_the_user_and_calls_its_route_path_once_only_after_the_allow(string tool)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);
        var expected = Expected(tool);

        var call = host.CallAsync(tool, Args(tool));
        await host.WaitForRequestsAsync();
        var callsWhileWaiting = broker.AdminCalls.Count;
        await AllowOnlyRequestAsync(host);
        var (isError, text) = await call;

        Assert.True(callsWhileWaiting == 0, $"{tool} does nothing before the user's answer; the provider was called {callsWhileWaiting} times while the request waited");
        Assert.False(isError, text);
        var done = Assert.Single(broker.AdminCalls);
        Assert.True((done.Method, Names(done)) == (expected.Method, expected.Names), $"{tool} goes through the provider call of its route once; it called {done.Method} on {Names(done)}");
        using var doc = JsonDocument.Parse(text);
        if (expected.Answered is null)
            Assert.True(doc.RootElement.GetProperty("success").GetBoolean(), $"{tool}, whose route answers no body, answers {{ success: true }}: {text}");
        else
            Assert.True(doc.RootElement.GetProperty("name").GetString() == expected.Answered, $"{tool} answers the entity its route answers: {text}");
        Assert.Equal((expected.Asked, expected.Where, $"{expected.Done}, allowed by you", "ok"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task The_options_and_the_rule_reach_the_provider_as_the_route_hands_them()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        foreach (var tool in new[] { "create_queue", "update_queue", "create_rule", "update_rule" })
        {
            var call = host.CallAsync(tool, Args(tool));
            await AllowOnlyRequestAsync(host);
            Assert.False((await call).IsError, tool);
        }

        var created = (QueueCreateOptions)broker.AdminCalls[0].Args[1]!;
        var updated = (QueueUpdateOptions)broker.AdminCalls[1].Args[1]!;
        var rule = (SubscriptionRuleInfo)broker.AdminCalls[2].Args[2]!;
        var replaced = (SubscriptionRuleInfo)broker.AdminCalls[3].Args[3]!;
        Assert.Equal((TimeSpan.FromMinutes(1), 5, true), (created.LockDuration, created.MaxDeliveryCount, created.RequiresSession));
        Assert.Equal((5, "Disabled", null), (updated.MaxDeliveryCount, updated.Status, updated.LockDuration));
        Assert.Equal(("big-orders", RuleFilterType.Sql, "amount > 100"), (rule.Name, rule.FilterType, rule.SqlExpression));
        Assert.Equal((RuleFilterType.Correlation, "order"), (replaced.FilterType, replaced.Correlation?.Subject));
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
            Assert.Equal((true, McpToolCalls.DeniedSentence), await denied);

            using var cancel = new CancellationTokenSource();
            var cancelled = host.CallAsync(tool, Args(tool), cancel.Token);
            await host.WaitForRequestsAsync();
            await cancel.CancelAsync();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);
            var until = DateTime.UtcNow.AddSeconds(5);
            while ((await host.ActivityAsync()).GetArrayLength() < 2 && DateTime.UtcNow < until) await Task.Delay(20);
            Assert.Equal(["Cancelled", "Denied by you"], (await host.ActivityAsync()).EnumerateArray().Select(l => l.GetProperty("outcome").GetString()));
        }

        await using (var host = await StartAsync(broker, wait: TimeSpan.FromMilliseconds(300)))
        {
            var answer = await host.CallAsync(tool, Args(tool)).WaitAsync(TimeSpan.FromSeconds(10));
            Assert.Equal((true, McpToolCalls.NoAnswerSentence), answer);
            Assert.Equal("Denied: no answer in two minutes", Assert.Single((await host.ActivityAsync()).EnumerateArray()).GetProperty("outcome").GetString());
        }

        Assert.True(broker.AdminCalls.Count == 0, $"{tool} does nothing after a denial, a cancellation while waiting or no answer; the provider was called {broker.AdminCalls.Count} times");
    }

    public static readonly TheoryData<string, string> FailingCalls = Failures();

    private static TheoryData<string, string> Failures()
    {
        var data = new TheoryData<string, string>();
        foreach (var tool in ToolNames)
            foreach (var failure in new[] { "broker", "timeout", "unauthorised" })
                data.Add(tool, failure);
        return data;
    }

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
        var broker = new Broker { AdminFailure = thrown };
        await using var host = await StartAsync(broker);

        var call = host.CallAsync(tool, Args(tool));
        await AllowOnlyRequestAsync(host);
        var (isError, text) = await call;

        var sentence = McpToolCalls.MessageOf(EntityAdministrationResults.Unhandled(thrown));
        Assert.True(isError && text == sentence, $"{tool} answers the fixed sentence of its route when the provider throws {thrown.GetType().Name}, never the exception's text; it answered {text}");
        AssertNoSecret(text, host.Token, tool);
        Assert.True(broker.AdminCalls.Count == 1, $"{tool} retries nothing after a failure; the provider was called {broker.AdminCalls.Count} times");
        var expected = Expected(tool);
        Assert.Equal((expected.Asked, expected.Where, "Failed, allowed by you", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Theory]
    [InlineData("delete_queue", "queue", "broker")]
    [InlineData("delete_queue", "queue", "timeout")]
    [InlineData("delete_topic", "topic", "broker")]
    [InlineData("delete_topic", "topic", "timeout")]
    [InlineData("create_subscription", "topic", "broker")]
    [InlineData("update_subscription", "topic", "timeout")]
    [InlineData("delete_subscription", "subscription", "broker")]
    [InlineData("delete_subscription", "subscription", "timeout")]
    [InlineData("create_rule", "subscription", "broker")]
    [InlineData("update_rule", "subscription", "timeout")]
    [InlineData("delete_rule", "subscription", "broker")]
    public async Task A_lookup_before_asking_that_fails_answers_the_fixed_sentence_asks_nobody_and_does_nothing(string tool, string lookup, string failure)
    {
        Exception failed = failure == "timeout"
            ? new TimeoutException(Sentinel)
            : new Azure.Messaging.ServiceBus.ServiceBusException(Sentinel, Azure.Messaging.ServiceBus.ServiceBusFailureReason.ServiceCommunicationProblem);
        var broker = lookup == "subscription"
            ? new Broker { SubscriptionLookupFailure = failed }
            : new Broker { LookupFailure = failed, FailTopicLookup = lookup == "topic" };
        await using var host = await StartAsync(broker);

        var text = await RefusedUnaskedAsync(host, broker, tool, Args(tool), $"{tool} whose lookup of its {lookup} fails ({failure}) asks nobody");

        Assert.True(text == "An internal error occurred.", $"{tool} whose lookup of its {lookup} fails answers the fixed sentence, never the broker's text; it answered {text}");
        var expected = Expected(tool);
        Assert.Equal((expected.Asked, expected.Where, "Failed", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Theory]
    [MemberData(nameof(Tools))]
    public async Task Below_the_level_all_each_tool_is_refused_without_asking(string tool)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, level: "readAndSend");

        var text = await RefusedUnaskedAsync(host, broker, tool, Args(tool), "a connection offered below all refuses changing entities without asking");

        Assert.True(text == McpEntityTools.LevelRefused, $"a connection offered at readAndSend refuses {tool} with the fixed sentence; it answered {text}");
        Assert.Equal("Refused: not offered for changing entities", Assert.Single((await host.ActivityAsync()).EnumerateArray()).GetProperty("outcome").GetString());
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
        Assert.Empty(broker.AdminCalls);
    }

    public static readonly TheoryData<string, string, string> MissingCapabilities = new()
    {
        { "update_queue", "update", EntityAdministrationResults.UpdateNotSupported },
        { "update_topic", "update", EntityAdministrationResults.UpdateNotSupported },
        { "update_subscription", "update", EntityAdministrationResults.UpdateNotSupported },
        { "create_topic", "topics", "This provider does not support topics." },
        { "delete_topic", "topics", "This provider does not support topics." },
        { "create_subscription", "subscriptions", "This provider does not support subscriptions." },
        { "delete_subscription", "subscriptions", "This provider does not support subscriptions." },
        { "create_rule", "rules", "This provider does not support subscription rules." },
        { "update_rule", "rules", "This provider does not support subscription rules." },
        { "delete_rule", "rules", "This provider does not support subscription rules." },
    };

    [Theory]
    [MemberData(nameof(MissingCapabilities))]
    public async Task A_capability_the_provider_does_not_declare_is_refused_with_the_route_sentence_before_anybody_is_asked(string tool, string missing, string sentence)
    {
        var broker = new Broker
        {
            SupportsEntityUpdate = missing != "update",
            SupportsTopics = missing != "topics",
            SupportsSubscriptions = missing != "subscriptions",
            SupportsRules = missing != "rules",
        };
        await using var host = await StartAsync(broker);

        var text = await RefusedUnaskedAsync(host, broker, tool, Args(tool), $"{tool} without {missing} is refused before anybody is asked");

        Assert.True(text == sentence, $"{tool} without {missing} answers its fixed sentence; it answered {text}");
    }

    public static readonly TheoryData<string, string, string> BadShapes = new()
    {
        { "create_queue", """{"name":" ","reason":"r"}""", "name is required." },
        { "create_topic", """{"name":"","reason":"r"}""", "name is required." },
        { "create_subscription", """{"topic":"events","name":" ","reason":"r"}""", "name is required." },
        { "delete_queue", """{"name":" ","reason":"r"}""", "name is required." },
        { "create_rule", """{"topic":"events","subscription":"audit","name":"big","rule":{"name":"other","filterType":"True"},"reason":"r"}""", TopicsController.RuleRenamed },
        { "update_rule", """{"topic":"events","subscription":"audit","name":"big","rule":{"name":"other","filterType":"True"},"reason":"r"}""", TopicsController.RuleRenamed },
        { "create_queue", """{"name":"billing"}""", McpToolCalls.ReasonRequired },
        { "delete_rule", """{"topic":"events","subscription":"audit","name":"$Default","reason":" "}""", McpToolCalls.ReasonRequired },
    };

    [Theory]
    [MemberData(nameof(BadShapes))]
    public async Task A_name_or_a_reason_the_route_or_the_tool_would_refuse_is_refused_before_anybody_is_asked(string tool, string json, string sentence)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var text = await RefusedUnaskedAsync(host, broker, tool, JsonDocument.Parse(json).RootElement, $"{tool} with {json} is refused by its shape before anybody is asked");

        Assert.True(text == sentence, $"{tool} with {json} answers the route's sentence; it answered {text}");
    }

    public static readonly TheoryData<string, string, string> Missing = new()
    {
        { "delete_queue", """{"name":"nope","reason":"r"}""", "The queue was not found." },
        { "delete_topic", """{"name":"nope","reason":"r"}""", "The topic was not found." },
        { "delete_subscription", """{"topic":"events","name":"nope","reason":"r"}""", "The subscription was not found." },
        { "create_subscription", """{"topic":"nope","name":"billing","reason":"r"}""", "The topic was not found." },
        { "create_rule", """{"topic":"events","subscription":"nope","name":"big","rule":{"filterType":"True"},"reason":"r"}""", "The subscription was not found." },
    };

    [Theory]
    [MemberData(nameof(Missing))]
    public async Task An_entity_or_its_parent_that_does_not_exist_is_refused_before_anybody_is_asked(string tool, string json, string sentence)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var text = await RefusedUnaskedAsync(host, broker, tool, JsonDocument.Parse(json).RootElement, $"{tool} on what does not exist is refused before anybody is asked");

        Assert.True(text == sentence, $"{tool} on what does not exist answers the route's not-found sentence; it answered {text}");
        Assert.Equal("Refused: not found", Assert.Single((await host.ActivityAsync()).EnumerateArray()).GetProperty("outcome").GetString());
    }

    [Fact]
    public async Task An_allow_of_a_delete_needs_the_name_typed_exactly_and_a_wrong_word_keeps_the_request_waiting()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("delete_queue", Args("delete_queue"));
        var id = (await host.WaitForRequestsAsync())[0].GetProperty("id").GetString();
        using var untyped = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = true });
        using var wrongCase = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = true, typed = "Orders" });
        var stillWaiting = (await host.RequestsAsync()).GetArrayLength();
        var callsBefore = broker.AdminCalls.Count;
        using var exact = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = true, typed = "orders" });
        var answer = await call;

        Assert.True((untyped.StatusCode, wrongCase.StatusCode) == (HttpStatusCode.BadRequest, HttpStatusCode.BadRequest),
            $"an allow of a delete without the name typed exactly answers 400; it answered {(int)untyped.StatusCode} and {(int)wrongCase.StatusCode}");
        Assert.True(stillWaiting == 1 && callsBefore == 0, $"a wrong word keeps the request waiting and deletes nothing; {stillWaiting} waited and the provider was called {callsBefore} times");
        Assert.Equal(HttpStatusCode.NoContent, exact.StatusCode);
        Assert.False(answer.IsError, answer.Text);
        Assert.Equal(nameof(IMessagingProvider.DeleteQueueAsync), Assert.Single(broker.AdminCalls).Method);
    }

    [Fact]
    public async Task An_allow_after_the_connection_was_lowered_below_all_does_nothing()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("delete_topic", Args("delete_topic"));
        await host.WaitForRequestsAsync();
        await host.OfferAsync("c-offered", "readAndSend");
        await AllowOnlyRequestAsync(host);
        var answer = await call;

        Assert.True(answer == (true, McpReadTools.NotOffered), $"an allow is taken only while the connection is still offered at all; it answered {answer}");
        Assert.True(broker.AdminCalls.Count == 0, $"nothing is deleted after the level was lowered; the provider was called {broker.AdminCalls.Count} times");
    }

    private const string Why = "It said why=" + Reason;
    private const string Change = "Only the settings listed are changed. A setting the broker does not allow to change is refused by the broker.";

    public static readonly TheoryData<string, string, string, string, string, bool, string?> Requests = new()
    {
        { "create_queue", "Assistant asks to create the queue billing", "On=offered-name|lockDuration=00:01:00|maxDeliveryCount=5|requiresSession=true|" + Why,
          "A new queue is created on the broker.", "Create the queue", false, null },
        { "update_queue", "Assistant asks to change the queue orders", "On=offered-name|Sets maxDeliveryCount=5|Sets status=Disabled|" + Why, Change, "Change the queue", false, null },
        { "delete_queue", "Assistant asks to delete the queue orders", "On=offered-name|Holds=3 active and 2 dead-letter messages counted now|" + Why,
          "The queue and every message in it are removed and cannot be brought back.", "Delete the queue", true, "Type the queue name to allow it=orders" },
        { "create_topic", "Assistant asks to create the topic billing-events", "On=offered-name|Options=The broker's defaults|" + Why,
          "A new topic is created on the broker.", "Create the topic", false, null },
        { "update_topic", "Assistant asks to change the topic events", "On=offered-name|Sets supportOrdering=true|" + Why, Change, "Change the topic", false, null },
        { "delete_topic", "Assistant asks to delete the topic events", "On=offered-name|Holds=1 subscription|" + Why,
          "The topic, its subscriptions and every message in them are removed and cannot be brought back.", "Delete the topic", true, "Type the topic name to allow it=events" },
        { "create_subscription", "Assistant asks to create the subscription billing", "On=offered-name|In=the topic events|maxDeliveryCount=3|" + Why,
          "A new subscription is created on the broker.", "Create the subscription", false, null },
        { "update_subscription", "Assistant asks to change the subscription audit", "On=offered-name|In=the topic events|Sets status=ReceiveDisabled|" + Why, Change, "Change the subscription", false, null },
        { "delete_subscription", "Assistant asks to delete the subscription audit", "On=offered-name|In=the topic events|Holds=5 active and 4 dead-letter messages counted now|" + Why,
          "The subscription and every message in it are removed and cannot be brought back.", "Delete the subscription", true, "Type the subscription name to allow it=audit" },
        { "create_rule", "Assistant asks to create the rule big-orders", "On=offered-name|In=events / audit|Filter=amount > 100|" + Why,
          "A new rule is created on the broker.", "Create the rule", false, null },
        { "update_rule", "Assistant asks to change the rule big-orders", """On=offered-name|In=events / audit|Sets filter=Correlation {"subject":"order"}|""" + Why, Change, "Change the rule", false, null },
        { "delete_rule", "Assistant asks to delete the rule $Default", "On=offered-name|In=events / audit|" + Why,
          "The rule is removed. If it was the last rule, the subscription receives nothing until another is added.", "Delete the rule", true, "Type the rule name to allow it=$Default" },
    };

    [Theory]
    [MemberData(nameof(Requests))]
    public async Task The_request_says_what_where_and_why_in_fixed_words_with_no_secret(string tool, string title, string facts, string note, string allowLabel, bool danger, string? typed)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync(tool, Args(tool));
        var request = await host.AnswerOnlyRequestAsync(allow: false);
        await call;

        var shownTyped = request.GetProperty("typed") is { ValueKind: JsonValueKind.Object } t ? $"{t.GetProperty("label").GetString()}={t.GetProperty("word").GetString()}" : null;
        var kind = tool.Split('_')[0] switch { "create" => "createEntity", "update" => "updateEntity", _ => "deleteEntity" };
        Assert.Equal((kind, title, facts, note, allowLabel, danger, typed),
            (request.GetProperty("kind").GetString(), request.GetProperty("title").GetString(), string.Join("|", Facts(request).Select(f => $"{f.Item1}={f.Item2}")),
             request.GetProperty("note").GetString(), request.GetProperty("allowLabel").GetString(), request.GetProperty("danger").GetBoolean(), shownTyped));
        AssertNoSecret(request.GetRawText(), host.Token, "a request");
        AssertNoSecret((await host.ActivityAsync()).GetRawText(), host.Token, "the record");
    }

    [Fact]
    public async Task A_long_value_is_cut_at_200_with_dots_a_name_at_100_in_the_record_and_a_broker_without_counts_says_so()
    {
        var broker = new Broker { SupportsMessageCounts = false };
        await using var host = await StartAsync(broker);
        var longName = new string('q', 150);

        var create = host.CallAsync("create_queue", new { name = longName, options = new { userMetadata = new string('m', 250) }, reason = new string('r', 250) });
        var created = await host.AnswerOnlyRequestAsync(allow: false);
        await create;
        var delete = host.CallAsync("delete_queue", new { name = "orders", reason = "r" });
        var deleted = await host.AnswerOnlyRequestAsync(allow: false);
        await delete;

        Assert.Contains(("userMetadata", new string('m', 200) + "..."), Facts(created));
        Assert.Contains(("It said why", new string('r', 200) + "..."), Facts(created));
        Assert.Equal("Create the queue " + new string('q', 100), (await host.ActivityAsync())[1].GetProperty("asked").GetString());
        Assert.Contains(("Holds", "This broker gives no count"), Facts(deleted));
    }

    [Theory]
    [MemberData(nameof(Tools))]
    public async Task Each_tool_is_listed_as_not_read_only_and_not_idempotent_and_destructive_only_for_a_delete(string tool)
    {
        await using var host = await StartAsync(new Broker());

        var annotations = (await host.ListedToolAsync(tool)).GetProperty("annotations");

        Assert.Equal((false, tool.StartsWith("delete_", StringComparison.Ordinal), false),
            (annotations.GetProperty("readOnlyHint").GetBoolean(), annotations.GetProperty("destructiveHint").GetBoolean(), annotations.GetProperty("idempotentHint").GetBoolean()));
    }

    [Theory]
    [InlineData("delete_rule", """{"topic":"events","subscription":"audit","name":"only-eu ","reason":"r"}""")]
    [InlineData("delete_queue", """{"name":"ord\u0007ers","reason":"r"}""")]
    [InlineData("create_queue", """{"name":" orders-new","reason":"r"}""")]
    [InlineData("delete_subscription", """{"topic":"events ","name":"audit","reason":"r"}""")]
    [InlineData("update_rule", """{"topic":"events","subscription":"audit\t","name":"only-eu","rule":{"filterType":"Sql","sqlExpression":"1=1"},"reason":"r"}""")]
    public async Task A_name_that_is_not_exactly_what_the_user_would_read_is_refused_before_anybody_is_asked(string tool, string json)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var text = await RefusedUnaskedAsync(host, broker, tool, JsonSerializer.Deserialize<JsonElement>(json), $"{tool} with a name the user would read differently is refused before anybody is asked");

        Assert.True(text == "A name cannot begin or end with a space, hold a control character or be longer than 260 characters.", $"{tool} with {json} answers the sentence about the name; it answered {text}");
    }
}
