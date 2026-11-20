using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.McpToolTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// send_message and send_messages ask the user in the app before anything is sent, send once only after the user
/// allows it, send nothing after a denial, a wait with no answer or a cancellation, refuse a connection offered for
/// reading and an undeclared capability without asking, skip the question only on a local test broker the user marked,
/// and answer what the send routes answer, each message of a batch included.
/// </summary>
public class McpSendToolTests
{
    private static object OneMessage(string entity = "orders") => new
    {
        entity,
        body = "{\"n\":1} " + BodyMarker + Sentinel,
        reason = "reproduce the failure of order 42",
        subject = "order-created",
        applicationProperties = new Dictionary<string, string> { ["tenant"] = "t1" },
    };

    private static async Task<Host> StartAsync(Broker broker, string level = "readAndSend", ServiceBusConnection? connection = null, bool? neverAsk = null, TimeSpan? wait = null)
    {
        var host = new Host(broker, wait);
        await host.StartAsync();
        connection ??= Offered();
        await host.SeedAsync(connection);
        await host.OfferAsync(connection.Id, level, neverAsk);
        await host.ConnectAsync(connection.Id);
        return host;
    }

    private static ServiceBusConnection LocalBroker() => new()
    {
        Id = "c-local",
        Name = "local-name",
        ProviderType = ProviderType.RabbitMQ,
        HostName = "localhost",
        UserName = "guest",
        Password = Sentinel,
    };

    private static (string Asked, string Where, string Outcome, string Kind) Line(JsonElement line) =>
        (line.GetProperty("asked").GetString()!, line.GetProperty("where").GetString()!, line.GetProperty("outcome").GetString()!, line.GetProperty("kind").GetString()!);

    [Fact]
    public async Task A_send_waits_for_the_user_and_is_sent_once_only_after_the_user_allows_it()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("send_message", OneMessage());
        var waiting = await host.WaitForRequestsAsync();
        var sendsWhileWaiting = broker.SendCalls;
        await host.AnswerOnlyRequestAsync(allow: true);
        var (isError, text) = await call;

        Assert.True(waiting.GetArrayLength() == 1 && sendsWhileWaiting == 0,
            $"asks the user in the app before anything is sent: while the request waited the provider was called {sendsWhileWaiting} times and the requests were {waiting}");
        Assert.False(isError, text);
        using (var doc = JsonDocument.Parse(text))
            Assert.Equal((true, JsonValueKind.Null), (doc.RootElement.GetProperty("success").GetBoolean(), doc.RootElement.GetProperty("sequenceNumber").ValueKind));
        Assert.True(broker.SendCalls == 1, $"a send the user allowed is sent once; the provider was called {broker.SendCalls} times");
        var sent = Assert.Single(broker.Sent);
        Assert.Equal(("order-created", "application/json", "t1"), (sent.Subject, sent.ContentType, (string)sent.ApplicationProperties!["tenant"]));
        Assert.True(sent.Body == "{\"n\":1} " + BodyMarker + Sentinel, $"the body the assistant gave reaches the provider whole; it sent {sent.Body}");
        Assert.Equal(0, (await host.RequestsAsync()).GetArrayLength());
        Assert.Equal(("Send 1 message", "orders on offered-name", "1 sent, allowed by you", "ok"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task A_denied_send_sends_nothing()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("send_messages", new { entity = "orders", messages = new[] { new { body = "a" }, new { body = "b" } }, reason = "test" });
        await host.AnswerOnlyRequestAsync(allow: false);
        var answer = await call;

        Assert.True(answer == (true, McpToolCalls.DeniedSentence), $"a denied request is answered with the fixed sentence; it answered {answer}");
        Assert.True(broker.SendCalls == 0, $"a denied send sends nothing; the provider was called {broker.SendCalls} times");
        Assert.Equal(("Send 2 messages", "orders on offered-name", "Denied by you", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task A_send_with_no_answer_in_time_is_denied_and_sends_nothing()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, wait: TimeSpan.FromMilliseconds(300));

        var answer = await host.CallAsync("send_message", OneMessage()).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.True(answer == (true, McpToolCalls.NoAnswerSentence), $"a request with no answer in time is denied with the fixed sentence; it answered {answer}");
        Assert.True(broker.SendCalls == 0, $"a send with no answer in time sends nothing; the provider was called {broker.SendCalls} times");
        Assert.Equal(0, (await host.RequestsAsync()).GetArrayLength());
        Assert.Equal(("Send 1 message", "orders on offered-name", "Denied: no answer in two minutes", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task A_send_cancelled_by_the_assistant_while_waiting_sends_nothing_and_its_request_disappears()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);
        using var cancel = new CancellationTokenSource();

        var call = host.CallAsync("send_message", OneMessage(), cancel.Token);
        var waiting = await host.WaitForRequestsAsync();
        await cancel.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
        var until = DateTime.UtcNow.AddSeconds(5);
        while ((await host.RequestsAsync()).GetArrayLength() > 0 && DateTime.UtcNow < until) await Task.Delay(20);
        var after = await host.RequestsAsync();

        Assert.Equal(1, waiting.GetArrayLength());
        Assert.True(after.GetArrayLength() == 0, $"a request whose tool call was cancelled disappears; still waiting: {after}");
        Assert.True(broker.SendCalls == 0, $"a send cancelled while waiting sends nothing; the provider was called {broker.SendCalls} times");
        Assert.Equal(("Send 1 message", "orders on offered-name", "Cancelled", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task The_request_says_what_where_how_many_and_why_in_fixed_words_with_no_body_and_no_secret()
    {
        var broker = new Broker();
        var connection = Offered();
        connection.ClientId = "client-1";
        connection.EnvironmentId = "env-1";
        await using var host = new Host(broker);
        await host.StartAsync();
        var groups = host.Factory.Services.GetRequiredService<IConnectionGroupManager>();
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "client-1", Name = "Contoso", Type = "client" });
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "env-1", Name = "staging", Type = "environment" });
        await host.SeedAsync(connection);
        await host.OfferAsync(connection.Id, "readAndSend");
        await host.ConnectAsync(connection.Id);
        var reason = "line one\nline\u0007two " + new string('r', 300);

        var topic = host.CallAsync("send_messages", new
        {
            entity = "events",
            messages = new[] { new { body = "héllo " + BodyMarker, contentType = "text/plain" }, new { body = Sentinel, contentType = "text/plain" }, new { body = "x", contentType = "text/plain" } },
            reason,
        });
        var topicRequest = await host.AnswerOnlyRequestAsync(allow: false);
        await topic;
        var queue = host.CallAsync("send_message", new { entity = "orders", body = "{}", reason = "check the queue" });
        var queueRequest = await host.AnswerOnlyRequestAsync(allow: false);
        await queue;

        static List<(string, string)> Facts(JsonElement request) =>
            request.GetProperty("facts").EnumerateArray().Select(f => (f.GetProperty("label").GetString()!, f.GetProperty("value").GetString()!)).ToList();
        var bytes = System.Text.Encoding.UTF8.GetByteCount("héllo " + BodyMarker) + Sentinel.Length + 1;
        var shownReason = ("line onelinetwo " + new string('r', 300))[..200];
        Assert.Equal(("send", "Assistant", "Assistant asks to send 3 messages", "Every subscription of this topic that these messages match receives them. A message sent cannot be taken back.", "Send 3 messages"),
            (topicRequest.GetProperty("kind").GetString(), topicRequest.GetProperty("assistant").GetString(), topicRequest.GetProperty("title").GetString(),
             topicRequest.GetProperty("note").GetString(), topicRequest.GetProperty("allowLabel").GetString()));
        Assert.Equal([("To", "events, a topic"), ("On", "offered-name (Contoso, staging)"), ("Messages", $"3, text/plain, {bytes} bytes in all"), ("It said why", shownReason)], Facts(topicRequest));
        Assert.Equal(("Assistant asks to send 1 message", "Every consumer of this queue receives these messages. A message sent cannot be taken back.", "Send 1 message"),
            (queueRequest.GetProperty("title").GetString(), queueRequest.GetProperty("note").GetString(), queueRequest.GetProperty("allowLabel").GetString()));
        Assert.Equal([("To", "orders, a queue"), ("On", "offered-name (Contoso, staging)"), ("Messages", "1, application/json, 2 bytes in all"), ("It said why", "check the queue")], Facts(queueRequest));
        var expires = topicRequest.GetProperty("expiresAt").GetDateTimeOffset() - topicRequest.GetProperty("time").GetDateTimeOffset();
        Assert.True(expires == TimeSpan.FromMinutes(2), $"a request expires two minutes after it was made; it said {expires}");
        foreach (var request in new[] { topicRequest, queueRequest })
        {
            Assert.False(request.GetRawText().Contains(BodyMarker, StringComparison.Ordinal), $"a request never carries a message body: {request}");
            AssertNoSecret(request.GetRawText(), host.Token, "a request");
        }
        Assert.Equal(0, broker.SendCalls);
    }

    [Fact]
    public async Task A_connection_offered_for_reading_refuses_a_send_without_asking()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, level: "read");

        var single = await host.CallUnaskedAsync("send_message", OneMessage(), "a connection offered at read refuses a send without asking");
        var many = await host.CallUnaskedAsync("send_messages", new { entity = "orders", messages = new[] { new { body = "a" } }, reason = "test" }, "a connection offered at read refuses a send without asking");

        Assert.True(single == (true, McpSendTools.ReadOnlyRefused) && many == (true, McpSendTools.ReadOnlyRefused),
            $"a connection offered at read refuses a send with the fixed sentence; send_message answered {single}, send_messages {many}");
        Assert.True(broker.SendCalls == 0, $"a connection offered at read sends nothing; the provider was called {broker.SendCalls} times");
        Assert.Equal(0, (await host.RequestsAsync()).GetArrayLength());
        Assert.All((await host.ActivityAsync()).EnumerateArray(), l => Assert.Equal("Refused: read only", l.GetProperty("outcome").GetString()));
    }

    [Fact]
    public async Task A_local_test_broker_marked_never_asked_sends_without_asking_until_it_is_production_or_not_local()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, connection: LocalBroker(), neverAsk: true);
        var groups = host.Factory.Services.GetRequiredService<IConnectionGroupManager>();

        var unasked = await host.CallUnaskedAsync("send_message", OneMessage(), "a local test broker marked never asked sends without asking");
        var sendsBefore = broker.SendCalls;
        var remote = LocalBroker();
        remote.HostName = "broker.example.com";
        await host.SeedAsync(remote);
        var notLocal = host.CallAsync("send_message", OneMessage());
        var notLocalRequest = await host.AnswerOnlyRequestAsync(allow: false);
        await notLocal;
        var production = LocalBroker();
        production.EnvironmentId = "env-prod";
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "env-prod", Name = "prod", Type = "environment", IsProduction = true });
        await host.SeedAsync(production);
        var prod = host.CallAsync("send_message", OneMessage());
        var prodRequest = await host.AnswerOnlyRequestAsync(allow: false);
        await prod;

        Assert.False(unasked.IsError, unasked.Text);
        Assert.True(sendsBefore == 1, $"a local test broker marked never asked sends without asking; the provider was called {sendsBefore} times");
        Assert.Equal("Assistant asks to send 1 message", notLocalRequest.GetProperty("title").GetString());
        Assert.Equal("Assistant asks to send 1 message", prodRequest.GetProperty("title").GetString());
        Assert.True(broker.SendCalls == 1, $"once the broker is not on this computer or is production the mark stops counting and the denied sends sent nothing; the provider was called {broker.SendCalls} times");
        Assert.Equal(("Send 1 message", "orders on local-name", "1 sent", "ok"), Line((await host.ActivityAsync()).EnumerateArray().Last()));
    }

    [Fact]
    public async Task Send_messages_reports_each_message_and_a_failure_midway_reports_what_was_and_was_not_sent()
    {
        var broker = new Broker
        {
            BatchAnswer = messages => new SendMessagesResult
            {
                SentCount = 2,
                Failures = [new SendMessageFailure { Index = 2, Error = SendMessageFailure.Unconfirmed }],
            },
        };
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("send_messages", new { entity = "orders", messages = new[] { new { body = "a" }, new { body = "b" }, new { body = "c" } }, reason = "test" });
        await host.AnswerOnlyRequestAsync(allow: true);
        var (isError, text) = await call;
        var outOfBounds = await host.CallUnaskedAsync("send_messages", new { entity = "orders", messages = Enumerable.Range(0, 101).Select(i => new { body = "m" }).ToArray(), reason = "test" }, "send_messages takes 1 to 100 messages: 101 are refused before anybody is asked");

        Assert.False(isError, $"a batch that sent part of its messages answers its result, as the batch route does: {text}");
        using (var doc = JsonDocument.Parse(text))
        {
            var failure = Assert.Single(doc.RootElement.GetProperty("failures").EnumerateArray());
            Assert.Equal((false, 2, 2, SendMessageFailure.Unconfirmed),
                (doc.RootElement.GetProperty("success").GetBoolean(), doc.RootElement.GetProperty("count").GetInt32(), failure.GetProperty("index").GetInt32(), failure.GetProperty("error").GetString()));
        }
        Assert.True(broker.SendCalls == 1 && broker.Sent.Select(m => m.Body).SequenceEqual(["a", "b", "c"]),
            $"the batch reaches the provider once, in order, and nothing is retried; it was called {broker.SendCalls} times");
        Assert.True(outOfBounds == (true, "send_messages takes 1 to 100 messages."), $"send_messages takes 1 to 100 messages; 101 answered {outOfBounds}");
        var lines = (await host.ActivityAsync()).EnumerateArray().ToList();
        Assert.Equal(("Send 3 messages", "orders on offered-name", "2 sent, 1 not sent, allowed by you", "error"), Line(lines[1]));
        Assert.Equal(("Send 101 messages", "Refused: count"), (Line(lines[0]).Asked, Line(lines[0]).Outcome));
    }

    [Theory]
    [InlineData("scheduled")]
    [InlineData("sessions")]
    [InlineData("topics")]
    [InlineData("not found")]
    public async Task A_capability_the_provider_does_not_declare_refuses_the_send_before_anything_is_attempted(string missing)
    {
        var broker = new Broker
        {
            SupportsScheduledMessages = missing != "scheduled",
            SupportsSessions = missing != "sessions",
            SupportsTopics = missing != "topics",
        };
        var (arguments, sentence) = missing switch
        {
            "scheduled" => ((object)new { entity = "orders", body = "a", reason = "r", scheduledEnqueueTimeUtc = DateTimeOffset.UtcNow.AddHours(1) }, "This provider does not support scheduled messages."),
            "sessions" => (new { entity = "orders", body = "a", reason = "r", sessionId = "s1" }, "This provider does not support sessions."),
            "topics" => (new { entity = "events", body = "a", reason = "r" }, "This provider does not support topics."),
            _ => (new { entity = "no-such-entity", body = "a", reason = "r" }, "The entity was not found."),
        };
        await using var host = await StartAsync(broker);

        var answer = await host.CallUnaskedAsync("send_message", arguments, $"capabilities decide what a send refuses ({missing}), before the user is asked");

        Assert.True(answer == (true, sentence), $"capabilities decide what a send refuses ({missing}): it answered {answer}");
        Assert.True(broker.SendCalls == 0 && (await host.RequestsAsync()).GetArrayLength() == 0,
            $"a send the provider cannot do ({missing}) is refused before the user is asked or the provider sends; it was called {broker.SendCalls} times");
        Assert.True(missing != "topics" || broker.TopicLookups == 0, "a provider without topics is never asked for one");
    }

    [Theory]
    [InlineData("send_message")]
    [InlineData("send_messages")]
    public async Task A_send_to_a_queue_that_requires_sessions_without_a_session_id_is_refused_before_anybody_is_asked(string tool)
    {
        var broker = new Broker { SessionQueues = ["orders"] };
        await using var host = await StartAsync(broker);
        object withoutSession = tool == "send_message"
            ? new { entity = "orders", body = "a", reason = "r" }
            : new { entity = "orders", messages = new object[] { new { body = "a", sessionId = "s1" }, new { body = "b" } }, reason = "r" };

        var refused = await host.CallUnaskedAsync(tool, withoutSession, "a send to a queue that requires sessions without a sessionId is refused before anybody is asked");
        var withSession = host.CallAsync("send_message", new { entity = "orders", body = "a", sessionId = "s1", reason = "r" });
        var request = await host.AnswerOnlyRequestAsync(allow: false);
        await withSession;

        Assert.True(refused == (true, McpSendTools.SessionRequired),
            $"a send to a queue that requires sessions, with a message that carries no sessionId, answers the fixed sentence; {tool} answered {refused}");
        Assert.True(broker.SendCalls == 0, $"nothing is sent to a queue that requires sessions without a sessionId; the provider was asked to send {broker.SendCalls} times");
        Assert.Equal("Assistant asks to send 1 message", request.GetProperty("title").GetString());
        Assert.Equal("Refused: no session id", Line((await host.ActivityAsync()).EnumerateArray().Last()).Outcome);
    }

    [Theory]
    [InlineData("broker", "orders")]
    [InlineData("timeout", "orders")]
    [InlineData("broker", "events")]
    [InlineData("timeout", "events")]
    public async Task A_send_whose_lookup_of_the_entity_fails_answers_the_fixed_sentence_asks_nobody_and_sends_nothing(string failure, string entity)
    {
        var broker = new Broker
        {
            FailTopicLookup = entity == "events",
            LookupFailure = failure == "timeout"
                ? new TimeoutException(Sentinel)
                : new Azure.Messaging.ServiceBus.ServiceBusException(Sentinel, Azure.Messaging.ServiceBus.ServiceBusFailureReason.ServiceCommunicationProblem),
        };
        await using var host = await StartAsync(broker, connection: LocalBroker());

        var answered = await host.CallAsync("send_message", OneMessage(entity));

        Assert.True(answered == (true, "An internal error occurred."),
            $"a send whose lookup of the entity fails ({failure}) answers the fixed sentence, never the broker's text; it answered {answered}");
        Assert.True(broker.SendCalls == 0, $"nothing is sent when the entity could not be looked up; the provider was asked to send {broker.SendCalls} times");
        Assert.True((await host.RequestsAsync()).GetArrayLength() == 0, "the user is not asked about a send that already failed");
        Assert.Equal([("Send 1 message", $"{entity} on local-name", "Failed", "error")], (await host.ActivityAsync()).EnumerateArray().Select(Line).ToList());
    }

    [Theory]
    [InlineData("broker")]
    [InlineData("timeout")]
    [InlineData("unauthorised")]
    [InlineData("disabled")]
    public async Task A_send_the_broker_fails_answers_the_fixed_sentence_and_records_the_failure(string failure)
    {
        var broker = new Broker
        {
            SendFailure = failure switch
            {
                "timeout" => new TimeoutException(Sentinel),
                "unauthorised" => new UnauthorizedAccessException($"Unauthorized access. 'Send' claim(s) are required to perform this operation. {Sentinel}"),
                "disabled" => new EntityDisabledException(),
                _ => new Azure.Messaging.ServiceBus.ServiceBusException(Sentinel, Azure.Messaging.ServiceBus.ServiceBusFailureReason.ServiceCommunicationProblem),
            },
        };
        var expected = failure switch
        {
            "unauthorised" => "The broker refused this operation as not authorised: the broker says the Send right is missing; the role Azure Service Bus Data Sender, or a key with that right, gives it.",
            "disabled" => "The entity is disabled for this operation.",
            _ => "An internal error occurred.",
        };
        await using var host = await StartAsync(broker, connection: LocalBroker(), neverAsk: true);

        var single = await host.CallUnaskedAsync("send_message", OneMessage(), "a local test broker marked never asked sends without asking");
        var many = await host.CallUnaskedAsync("send_messages", new { entity = "orders", messages = new[] { new { body = "a" }, new { body = "b" } }, reason = "r" }, "a local test broker marked never asked sends without asking");

        Assert.True(single == (true, expected) && many == (true, expected),
            $"a send the broker fails ({failure}) answers the fixed sentence, never the broker's text; send_message answered {single}, send_messages {many}");
        Assert.True(broker.SendCalls == 2, $"a failed send is not retried; the provider was called {broker.SendCalls} times for two calls");
        var lines = (await host.ActivityAsync()).EnumerateArray().Select(Line).ToList();
        Assert.Equal([("Send 2 messages", "orders on local-name", "Failed", "error"), ("Send 1 message", "orders on local-name", "Failed", "error")], lines);
    }

    [Theory]
    [InlineData("lowered to read")]
    [InlineData("another connection")]
    public async Task A_send_allowed_after_the_active_connection_changed_is_refused_and_sends_nothing(string change)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);
        await host.SeedAsync(Offered("c-other"));
        await host.OfferAsync("c-other", "readAndSend");

        var call = host.CallAsync("send_message", OneMessage());
        await host.WaitForRequestsAsync();
        if (change == "lowered to read") await host.OfferAsync("c-offered", "read");
        else await host.ConnectAsync("c-other");
        await host.AnswerOnlyRequestAsync(allow: true);
        var answer = await call;

        Assert.True(answer == (true, McpReadTools.NotOffered), $"a send the user allowed for one connection never goes to another or past a lower level ({change}); it answered {answer}");
        Assert.True(broker.SendCalls == 0, $"nothing is sent ({change}); the provider was called {broker.SendCalls} times");
    }
}
