using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Known defects of the RabbitMQ provider, each pinned by a test of today's behaviour against a real
/// broker. Each test passes while the defect exists; the change that fixes one rewrites its test to
/// assert the behaviour named in its summary.
/// </summary>
[Collection(RabbitMqCollection.Name)]
public sealed class RabbitMQProviderDefectTests(RabbitMqFixture fixture) : IAsyncLifetime
{
    private readonly List<string> _queues = [];
    private readonly List<string> _exchanges = [];
    private readonly List<string> _users = [];
    private RabbitMQProvider _provider = null!;

    public async Task InitializeAsync() => _provider = await fixture.ConnectAsync();

    public async Task DisposeAsync()
    {
        foreach (var queue in _queues) await fixture.DeleteQueueAsync(queue);
        foreach (var exchange in _exchanges) await fixture.DeleteExchangeAsync(exchange);
        foreach (var user in _users) await fixture.DeleteUserAsync(user);
        await _provider.DisposeAsync();
    }

    private async Task<string> CreateQueueAsync(string tag)
    {
        var name = RabbitMqFixture.UniqueName(tag);
        _queues.Add(name);
        await _provider.CreateQueueAsync(name);
        return name;
    }

    private async Task<string> CreateExchangeAsync(string tag, string type)
    {
        var name = RabbitMqFixture.UniqueName(tag);
        _exchanges.Add(name);
        await _provider.CreateTopicAsync(name, new TopicCreateOptions { ExchangeType = type });
        return name;
    }

    private async Task<string> CreateUserAsync(string tag, string password, string tags)
    {
        var name = RabbitMqFixture.UniqueName(tag);
        _users.Add(name);
        using var created = await fixture.Management.PutAsJsonAsync($"users/{name}", new { password, tags });
        created.EnsureSuccessStatusCode();
        using var permitted = await fixture.Management.PutAsJsonAsync($"permissions/%2F/{name}", new { configure = ".*", write = ".*", read = ".*" });
        permitted.EnsureSuccessStatusCode();
        return name;
    }

    private static int ClosedPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    /// <summary>Fixed 2026-11-15: peeking 3 messages returns the 3 messages in queue order, and the queue keeps them in that order.</summary>
    [Fact]
    public async Task A_peek_returns_each_message_once_in_queue_order_and_leaves_them_in_place()
    {
        var queue = await CreateQueueAsync("peek-head");
        foreach (var body in new[] { "m1", "m2", "m3" })
            await _provider.SendMessageAsync(queue, new SendMessageRequest { Body = body });

        var peeked = (await _provider.PeekMessagesAsync(queue, 3)).Select(m => m.Body).ToList();
        var more = (await _provider.PeekMessagesAsync(queue, 20)).Select(m => m.Body).ToList();

        Assert.Equal(["m1", "m2", "m3"], peeked);
        Assert.Equal(["m1", "m2", "m3"], more);
        await fixture.WaitForMessageCountAsync(queue, 3);
        Assert.Equal(["m1", "m2", "m3"], fixture.Drain(queue));
    }

    /// <summary>Fixed 2026-11-15: every peeked message carries its position in the queue, the key the bulk operations address it by, so deleting position 2 deletes only the second message.</summary>
    [Fact]
    public async Task Peeked_messages_carry_their_position_and_a_delete_of_one_position_deletes_only_that_message()
    {
        var queue = await CreateQueueAsync("peek-seq");
        fixture.PublishToQueue(queue, "m1");
        fixture.PublishToQueue(queue, "m2");
        fixture.PublishToQueue(queue, "m3");

        var peeked = (await _provider.PeekMessagesAsync(queue, 3)).ToList();

        Assert.Equal([(1L, "m1"), (2L, "m2"), (3L, "m3")], peeked.Select(m => (m.SequenceNumber ?? 0, m.Body)));
        var deleted = await _provider.DeleteMessagesAsync(queue, [peeked[1].SequenceNumber!.Value]);
        Assert.Equal(1, deleted.SuccessCount);
        Assert.Equal(["m1", "m3"], fixture.Drain(queue).OrderBy(b => b));
    }

    /// <summary>Correct: a queue with a message TTL is listed with that TTL, and the other queues and topics still list.</summary>
    [Fact]
    public async Task Defect_a_queue_with_a_message_ttl_makes_queue_and_topic_listing_throw()
    {
        var queue = RabbitMqFixture.UniqueName("ttl");
        _queues.Add(queue);
        await _provider.CreateQueueAsync(queue, new QueueCreateOptions { DefaultMessageTimeToLive = TimeSpan.FromMinutes(1) });

        await Assert.ThrowsAsync<InvalidCastException>(async () => (await _provider.GetQueuesAsync()).ToList());
        await Assert.ThrowsAsync<InvalidCastException>(async () => (await _provider.GetTopicsAsync()).ToList());
    }

    /// <summary>Fixed 2026-11-15: peeking the dead-letter side of a queue with no dead-letter queue answers empty, and later calls on the provider still work.</summary>
    [Fact]
    public async Task Peeking_a_missing_dead_letter_queue_answers_empty_and_every_later_call_still_works()
    {
        var queue = await CreateQueueAsync("no-dlq");
        fixture.PublishToQueue(queue, "kept");

        Assert.Empty(await _provider.PeekMessagesAsync(queue, 1, subQueue: MessageSubQueue.DeadLetter));

        Assert.True(_provider.IsConnected);
        Assert.Equal("kept", Assert.Single(await _provider.PeekMessagesAsync(queue, 1)).Body);
        await _provider.SendMessageAsync(queue, new SendMessageRequest { Body = "x" });
        await fixture.WaitForMessageCountAsync(queue, 2);
    }

    /// <summary>Correct: an application property bound from the API's JSON is sent as a header with its value.</summary>
    [Fact]
    public async Task Defect_send_with_an_application_property_bound_from_json_throws_and_sends_nothing()
    {
        var queue = await CreateQueueAsync("json-prop");
        var request = JsonSerializer.Deserialize<SendMessageRequest>(
            """{"body":"with-property","applicationProperties":{"tenant":"contoso"}}""",
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.IsType<JsonElement>(request.ApplicationProperties!["tenant"]);

        var error = await Assert.ThrowsAsync<WireFormattingException>(() => _provider.SendMessageAsync(queue, request));

        Assert.Contains("JsonElement", error.Message);
        await _provider.SendMessageAsync(queue, new SendMessageRequest
        {
            Body = "plain",
            ApplicationProperties = new Dictionary<string, object> { ["tenant"] = "contoso" }
        });
        var message = Assert.Single(await _provider.PeekMessagesAsync(queue, 1));
        Assert.Equal("plain", message.Body);
        Assert.Equal("contoso", message.ApplicationProperties["tenant"]);
    }

    /// <summary>Fixed 2026-11-16: a move to a queue that does not exist reports a failure and leaves the message in the source.</summary>
    [Fact]
    public async Task A_move_to_a_missing_queue_reports_the_failure_and_the_message_stays_in_the_source()
    {
        var source = await CreateQueueAsync("move-src");
        var missing = RabbitMqFixture.UniqueName("move-missing");
        fixture.PublishToQueue(source, "moved");

        var result = await _provider.MoveMessagesAsync(source, missing, [1]);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal("Not moved: the broker did not accept the message. It is still in the queue.", Assert.Single(result.Failures).Error);
        Assert.False(await fixture.QueueExistsAsync(missing));
        Assert.Equal(["moved"], fixture.Drain(source));
    }

    /// <summary>Fixed 2026-11-16: a move sends the chosen message to the target and leaves the others in the source, in their order.</summary>
    [Fact]
    public async Task A_move_sends_the_chosen_message_to_the_target_and_keeps_the_others_in_the_source_in_their_order()
    {
        var source = await CreateQueueAsync("move-from");
        var target = await CreateQueueAsync("move-to");
        foreach (var body in new[] { "m1", "m2", "m3" }) fixture.PublishToQueue(source, body);
        await fixture.WaitForMessageCountAsync(source, 3);

        var result = await _provider.MoveMessagesAsync(source, target, [2]);

        Assert.Equal(1, result.SuccessCount);
        Assert.Empty(result.Failures);
        Assert.Equal(["m2"], fixture.Drain(target));
        Assert.Equal(["m1", "m3"], fixture.Drain(source));
    }

    /// <summary>Fixed 2026-11-16: a delete removes the chosen position and leaves the others in the queue, in their order.</summary>
    [Fact]
    public async Task A_delete_removes_the_chosen_position_and_keeps_the_others_in_their_order()
    {
        var queue = await CreateQueueAsync("delete-order");
        foreach (var body in new[] { "m1", "m2", "m3" }) fixture.PublishToQueue(queue, body);
        await fixture.WaitForMessageCountAsync(queue, 3);

        var result = await _provider.DeleteMessagesAsync(queue, [2]);

        Assert.Equal(1, result.SuccessCount);
        Assert.Empty(result.Failures);
        Assert.Equal(["m1", "m3"], fixture.Drain(queue));
    }

    /// <summary>Correct: a delete addresses the message the user saw, and reports it not found when it is gone.</summary>
    [Fact]
    public async Task Defect_delete_by_position_removes_whichever_message_is_at_that_position_now()
    {
        var queue = await CreateQueueAsync("delete-pos");
        foreach (var body in new[] { "m1", "m2", "m3" }) fixture.PublishToQueue(queue, body);
        var seenAtPositionOne = Assert.Single(await _provider.PeekMessagesAsync(queue, 1)).Body;
        await fixture.WaitForMessageCountAsync(queue, 3);
        Assert.Equal("m1", fixture.ConsumeHead(queue));

        var result = await _provider.DeleteMessagesAsync(queue, [1]);

        Assert.Equal("m1", seenAtPositionOne);
        Assert.Equal(1, result.SuccessCount);
        Assert.Equal(0, result.FailureCount);
        Assert.Equal(["m3"], fixture.Drain(queue));
    }

    /// <summary>Fixed 2026-11-15: a bulk delete of a message published without properties deletes it, and the others it read go back to the queue.</summary>
    [Fact]
    public async Task A_bulk_delete_of_messages_without_properties_deletes_the_chosen_one_and_keeps_the_others()
    {
        var queue = await CreateQueueAsync("no-props");
        foreach (var body in new[] { "m1", "m2", "m3" }) fixture.Publish("", queue, body);

        var result = await _provider.DeleteMessagesAsync(queue, [3]);

        Assert.Equal(1, result.SuccessCount);
        Assert.Empty(result.Failures);
        Assert.Equal(["m1", "m2"], fixture.Drain(queue).OrderBy(b => b));
    }

    /// <summary>Fixed 2026-11-16: a send to a fanout exchange reaches its bound queue without a subject.</summary>
    [Fact]
    public async Task A_send_to_a_fanout_exchange_without_a_subject_reaches_its_bound_queue()
    {
        var exchange = await CreateExchangeAsync("fanout", "fanout");
        var queue = RabbitMqFixture.UniqueName("fanout-q");
        _queues.Add(queue);
        await _provider.CreateSubscriptionAsync(exchange, queue);

        await _provider.SendMessageAsync(exchange, new SendMessageRequest { Body = "no subject" });
        await _provider.SendMessageAsync(exchange, new SendMessageRequest { Body = "with subject", Subject = "any" });

        await fixture.WaitForMessageCountAsync(queue, 2);
        Assert.Equal(["no subject", "with subject"], fixture.Drain(queue));
    }

    /// <summary>Fixed 2026-11-16: a send no queue receives is a failure that says so, never a success.</summary>
    [Fact]
    public async Task A_send_no_queue_receives_fails_and_says_why_for_an_exchange_without_a_binding_and_for_a_name_that_does_not_exist()
    {
        var unbound = await CreateExchangeAsync("unbound", "fanout");

        var notRouted = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(
            () => _provider.SendMessageAsync(unbound, new SendMessageRequest { Body = "nowhere" }));
        var noName = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(
            () => _provider.SendMessageAsync(RabbitMqFixture.UniqueName("missing"), new SendMessageRequest { Body = "nowhere" }));

        Assert.Equal("The broker could not route the message: no queue receives it.", notRouted.Message);
        Assert.Equal("No queue or exchange has this name.", noName.Message);
    }

    /// <summary>Fixed 2026-11-16: a send to a queue with a subject goes to the queue; it was published to an exchange of the queue's name and lost.</summary>
    [Fact]
    public async Task A_send_to_a_queue_with_a_subject_reaches_the_queue_and_the_connection_keeps_working()
    {
        var queue = await CreateQueueAsync("send-subject");

        await _provider.SendMessageAsync(queue, new SendMessageRequest { Body = "labelled", Subject = "invoice" });
        await _provider.SendMessageAsync(queue, new SendMessageRequest { Body = "plain" });

        await fixture.WaitForMessageCountAsync(queue, 2);
        Assert.Equal(["labelled", "plain"], (await _provider.PeekMessagesAsync(queue, 10)).Select(m => m.Body));
    }

    /// <summary>Fixed 2026-11-16: a queue the broker does not let this client read says why, and the connection keeps working.</summary>
    [Fact]
    public async Task A_peek_of_a_stream_or_of_a_queue_exclusive_to_another_connection_says_why_and_a_later_peek_still_works()
    {
        var stream = RabbitMqFixture.UniqueName("stream");
        var exclusive = RabbitMqFixture.UniqueName("exclusive");
        _queues.Add(stream);
        fixture.DeclareQueue(stream, arguments: new Dictionary<string, object> { ["x-queue-type"] = "stream" });
        fixture.DeclareQueue(exclusive, exclusive: true);
        var plain = await CreateQueueAsync("after-refusal");
        fixture.PublishToQueue(plain, "still read");

        var ofStream = await Assert.ThrowsAsync<MessageReadFailedException>(() => _provider.PeekMessagesAsync(stream, 5));
        var ofExclusive = await Assert.ThrowsAsync<MessageReadFailedException>(() => _provider.PeekMessagesAsync(exclusive, 5));

        Assert.Equal("The broker did not return the messages of this entity (a stream is not read this way).", ofStream.Message);
        Assert.Equal("The broker did not return the messages of this entity (the queue is exclusive to another connection).", ofExclusive.Message);
        Assert.Equal("Not deleted: a stream is not read this way. Nothing was sent or removed.", Assert.Single((await _provider.DeleteMessagesAsync(stream, [1])).Failures).Error);
        Assert.True(_provider.IsConnected, "A stream closes the whole connection on a get; it must never be asked.");
        Assert.Equal("still read", Assert.Single(await _provider.PeekMessagesAsync(plain, 5)).Body);
    }

    /// <summary>Fixed 2026-11-16: a receive and a purge on a stream are refused before the broker is asked; either one closed the whole connection.</summary>
    [Fact]
    public async Task A_receive_and_a_purge_on_a_stream_are_refused_with_a_reason_and_the_connection_stays_open()
    {
        var stream = RabbitMqFixture.UniqueName("stream-refused");
        _queues.Add(stream);
        fixture.DeclareQueue(stream, arguments: new Dictionary<string, object> { ["x-queue-type"] = "stream" });

        var purge = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => _provider.PurgeMessagesAsync(stream));
        var receive = await Assert.ThrowsAsync<MessageReadFailedException>(() => _provider.ReceiveMessagesAsync(stream, 1));

        Assert.Equal("A stream cannot be purged: it keeps its messages until its retention removes them.", purge.Message);
        Assert.Equal("The broker did not return the messages of this entity (a stream is not read this way).", receive.Message);
        Assert.True(_provider.IsConnected, "A stream closes the whole connection on a get or a purge; it must never be asked.");
    }

    /// <summary>
    /// Correct: deleting subscription X removes the binding whose destination is X and no other.
    /// The broker lists bindings sorted by destination, so the other queue is named to sort first.
    /// </summary>
    [Fact]
    public async Task Defect_deleting_a_subscription_removes_the_binding_whose_routing_key_equals_its_name()
    {
        var exchange = await CreateExchangeAsync("bind-ex", "topic");
        var other = RabbitMqFixture.UniqueName("bind-a");
        var target = RabbitMqFixture.UniqueName("bind-b");
        _queues.Add(other);
        _queues.Add(target);
        await _provider.CreateSubscriptionAsync(exchange, other, new SubscriptionCreateOptions { RoutingKey = target });
        await _provider.CreateSubscriptionAsync(exchange, target, new SubscriptionCreateOptions { RoutingKey = "#" });

        await _provider.DeleteSubscriptionAsync(exchange, target);

        var remaining = (await _provider.GetSubscriptionsAsync(exchange)).Select(s => s.Name).ToList();
        Assert.Equal([target], remaining);
    }

    /// <summary>Correct: a connection test fails when the AMQP port is wrong.</summary>
    [Fact]
    public async Task Defect_test_connection_passes_with_a_wrong_amqp_port()
    {
        var config = fixture.CreateConfig();
        config.Port = ClosedPort();

        Assert.True(await new RabbitMQProvider().TestConnectionAsync(config));
        await Assert.ThrowsAsync<BrokerUnreachableException>(() => new RabbitMQProvider().ConnectAsync(config));
    }

    /// <summary>Correct: connecting fails when the management port is wrong.</summary>
    [Fact]
    public async Task Defect_connect_succeeds_with_a_wrong_management_port()
    {
        var config = fixture.CreateConfig();
        config.ManagementPort = ClosedPort();
        await using var provider = new RabbitMQProvider();

        await provider.ConnectAsync(config);

        Assert.True(provider.IsConnected);
        await Assert.ThrowsAsync<HttpRequestException>(() => provider.GetQueuesAsync());
    }

    /// <summary>Correct: a user whose password has a non-ASCII character reaches the management API as it reaches AMQP.</summary>
    [Fact]
    public async Task Defect_a_non_ascii_password_connects_over_amqp_and_fails_every_management_call()
    {
        const string password = "pässwörd";
        var user = await CreateUserAsync("non-ascii", password, "administrator");
        var config = fixture.CreateConfig();
        config.UserName = user;
        config.Password = password;
        using var whoAmI = new HttpRequestMessage(HttpMethod.Get, "whoami");
        whoAmI.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Basic", Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{user}:{password}")));
        await using var provider = new RabbitMQProvider();

        using var utf8Response = await fixture.Management.SendAsync(whoAmI);
        await provider.ConnectAsync(config);

        Assert.Equal(HttpStatusCode.OK, utf8Response.StatusCode);
        Assert.True(provider.IsConnected);
        var error = await Assert.ThrowsAsync<HttpRequestException>(() => provider.GetQueuesAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, error.StatusCode);
        Assert.False(await new RabbitMQProvider().TestConnectionAsync(config));
    }

    /// <summary>The broker refuses to republish a message that carries another user's user_id: the message stays in the dead-letter queue and the refusal is reported.</summary>
    [Fact]
    public async Task A_resubmit_the_broker_refuses_for_another_users_user_id_keeps_the_message_in_the_dead_letter_queue_and_reports_it()
    {
        var queue = await CreateQueueAsync("user-id");
        var deadLetter = $"{queue}.dlq";
        _queues.Add(deadLetter);
        await _provider.CreateQueueAsync(deadLetter);
        const string otherPassword = "other-password";
        var other = await CreateUserAsync("other", otherPassword, "");
        using (var connection = new ConnectionFactory
        {
            HostName = fixture.Host, Port = fixture.AmqpPort, UserName = other, Password = otherPassword
        }.CreateConnection())
        using (var channel = connection.CreateModel())
        {
            var properties = channel.CreateBasicProperties();
            properties.UserId = other;
            channel.ConfirmSelect();
            channel.BasicPublish("", deadLetter, properties, "from-other"u8.ToArray());
            channel.WaitForConfirmsOrDie(TimeSpan.FromSeconds(10));
        }
        await fixture.WaitForMessageCountAsync(deadLetter, 1);

        var result = await _provider.ResubmitDeadLetterMessagesAsync(queue, [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.Equal(1, Assert.Single(result.Failures).SequenceNumber);
        Assert.StartsWith("Not resubmitted: the broker refused the message", result.Failures[0].Error);
        Assert.EndsWith("It is still in the dead-letter queue.", result.Failures[0].Error);
        await fixture.WaitForMessageCountAsync(deadLetter, 1);
        Assert.Equal(["from-other"], fixture.Drain(deadLetter));
        Assert.Equal(0u, fixture.MessageCount(queue));
    }
}
