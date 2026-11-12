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

    /// <summary>Correct: peeking 3 messages returns the 3 messages in queue order.</summary>
    [Fact]
    public async Task Defect_peek_returns_the_head_message_count_times()
    {
        var queue = await CreateQueueAsync("peek-head");
        foreach (var body in new[] { "m1", "m2", "m3" })
            await _provider.SendMessageAsync(queue, new SendMessageRequest { Body = body });

        var peeked = (await _provider.PeekMessagesAsync(queue, 3)).Select(m => m.Body).ToList();

        Assert.Equal(["m1", "m1", "m1"], peeked);
        await fixture.WaitForMessageCountAsync(queue, 3);
        Assert.Equal(["m1", "m2", "m3"], fixture.Drain(queue));
    }

    /// <summary>Correct: every peeked message carries a key the bulk operations can address it by.</summary>
    [Fact]
    public async Task Defect_peeked_messages_carry_no_sequence_number()
    {
        var queue = await CreateQueueAsync("peek-seq");
        fixture.PublishToQueue(queue, "m1");
        fixture.PublishToQueue(queue, "m2");

        var peeked = (await _provider.PeekMessagesAsync(queue, 2)).ToList();

        Assert.Equal(2, peeked.Count);
        Assert.All(peeked, m => Assert.Null(m.SequenceNumber));
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

    /// <summary>Correct: peeking the dead-letter side of a queue with no dead-letter queue answers empty or a clear error, and later calls on the provider still work.</summary>
    [Fact]
    public async Task Defect_peeking_a_missing_dead_letter_queue_breaks_every_later_peek_while_still_connected()
    {
        var queue = await CreateQueueAsync("no-dlq");
        fixture.PublishToQueue(queue, "kept");

        await Assert.ThrowsAsync<OperationInterruptedException>(() => _provider.PeekMessagesAsync(queue, 1, isDeadLetter: true));

        Assert.True(_provider.IsConnected);
        await Assert.ThrowsAsync<AlreadyClosedException>(() => _provider.PeekMessagesAsync(queue, 1));
        await Assert.ThrowsAsync<AlreadyClosedException>(() => _provider.SendMessageAsync(queue, new SendMessageRequest { Body = "x" }));
        Assert.Equal(1u, fixture.MessageCount(queue));
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

    /// <summary>Correct: a move to a queue that does not exist reports a failure and leaves the message in the source.</summary>
    [Fact]
    public async Task Defect_move_to_a_missing_queue_reports_success_and_the_message_is_gone()
    {
        var source = await CreateQueueAsync("move-src");
        var missing = RabbitMqFixture.UniqueName("move-missing");
        fixture.PublishToQueue(source, "moved");

        var result = await _provider.MoveMessagesAsync(source, missing, [1]);

        Assert.Equal(1, result.SuccessCount);
        Assert.Equal(0, result.FailureCount);
        Assert.Empty(result.Failures);
        Assert.Equal(0u, fixture.MessageCount(source));
        Assert.False(await fixture.QueueExistsAsync(missing));
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

    /// <summary>Correct: a bulk delete of a message published without properties deletes it, and a response it cannot read never costs the messages it consumed.</summary>
    [Fact]
    public async Task Defect_bulk_delete_of_messages_without_properties_throws_after_consuming_them_all()
    {
        var queue = await CreateQueueAsync("no-props");
        foreach (var body in new[] { "m1", "m2", "m3" }) fixture.Publish("", queue, body);

        await Assert.ThrowsAsync<JsonException>(() => _provider.DeleteMessagesAsync(queue, [3]));

        Assert.Equal(0u, fixture.MessageCount(queue));
    }

    /// <summary>Correct: resubmitting dead-letter message 3 resubmits message 3.</summary>
    [Fact]
    public async Task Defect_single_resubmit_ignores_the_sequence_number_and_takes_the_dead_letter_head()
    {
        var queue = await CreateQueueAsync("resubmit");
        var deadLetter = $"{queue}.dlq";
        _queues.Add(deadLetter);
        await _provider.CreateQueueAsync(deadLetter);
        foreach (var body in new[] { "d1", "d2", "d3" }) fixture.PublishToQueue(deadLetter, body);

        await _provider.ResubmitDeadLetterMessageAsync(queue, 3);

        Assert.Equal(["d1"], fixture.Drain(queue));
        Assert.Equal(["d2", "d3"], fixture.Drain(deadLetter));
    }

    /// <summary>Correct: a send to a fanout exchange reaches its bound queues, or fails when nothing can route it.</summary>
    [Fact]
    public async Task Defect_send_to_a_fanout_exchange_without_subject_is_dropped_and_reports_success()
    {
        var exchange = await CreateExchangeAsync("fanout", "fanout");
        var queue = RabbitMqFixture.UniqueName("fanout-q");
        _queues.Add(queue);
        await _provider.CreateSubscriptionAsync(exchange, queue);

        await _provider.SendMessageAsync(exchange, new SendMessageRequest { Body = "dropped" });
        await _provider.SendMessageAsync(exchange, new SendMessageRequest { Body = "sentinel", Subject = "any" });

        await fixture.WaitForMessageCountAsync(queue, 1);
        Assert.Equal(["sentinel"], fixture.Drain(queue));
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

    /// <summary>Correct: only queues bound to an exchange are listed as its subscriptions.</summary>
    [Fact]
    public async Task Defect_an_exchange_to_exchange_binding_is_listed_as_a_subscription()
    {
        var source = await CreateExchangeAsync("e2e-src", "topic");
        var destination = await CreateExchangeAsync("e2e-dst", "topic");
        using var bound = await fixture.Management.PostAsJsonAsync($"bindings/%2F/e/{source}/e/{destination}", new { routing_key = "k" });
        bound.EnsureSuccessStatusCode();

        var subscription = Assert.Single(await _provider.GetSubscriptionsAsync(source));

        Assert.Equal(destination, subscription.Name);
        Assert.Equal("k", Assert.Single(subscription.Rules).FilterExpression);
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

    /// <summary>Correct: a dead-letter message first published by another user is resubmitted, or stays in the dead-letter queue when the broker refuses it.</summary>
    [Fact]
    public async Task Defect_resubmit_of_a_message_with_another_users_user_id_fails_after_consuming_it()
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

        await Assert.ThrowsAsync<HttpRequestException>(() => _provider.ResubmitDeadLetterMessageAsync(queue, 1));

        Assert.Equal(0u, fixture.MessageCount(deadLetter));
        Assert.Equal(0u, fixture.MessageCount(queue));
    }
}
