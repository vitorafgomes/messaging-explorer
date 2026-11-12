using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// What the Azure Service Bus provider does correctly today, against the emulator. Entity tests use
/// the provider connected to the management endpoint, message tests the one connected to the AMQP
/// endpoint.
/// </summary>
[Collection(AzureServiceBusCollection.Name)]
public sealed class AzureServiceBusProviderTests(AzureServiceBusFixture fixture) : IAsyncLifetime
{
    private readonly List<string> _queues = [];
    private readonly List<string> _topics = [];
    private IMessagingProvider _messaging = null!;
    private IMessagingProvider _management = null!;

    public async Task InitializeAsync()
    {
        _messaging = await fixture.ConnectMessagingAsync();
        _management = await fixture.ConnectManagementAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var queue in _queues) await fixture.DeleteQueueAsync(queue);
        foreach (var topic in _topics) await fixture.DeleteTopicAsync(topic);
        await _messaging.DisposeAsync();
        await _management.DisposeAsync();
    }

    private string Name(List<string> owner, string tag)
    {
        var name = AzureServiceBusFixture.UniqueName(tag);
        owner.Add(name);
        return name;
    }

    private async Task<string> CreateQueueAsync(string tag, Action<CreateQueueOptions>? configure = null)
    {
        var options = new CreateQueueOptions(Name(_queues, tag));
        configure?.Invoke(options);
        await fixture.Admin.CreateQueueAsync(options);
        return options.Name;
    }

    private async Task<long> DeadLetterSequenceOfAsync(string queue, string body) =>
        (await _messaging.PeekMessagesAsync(queue, 10, isDeadLetter: true)).Single(m => m.Body == body).SequenceNumber!.Value;

    [Fact]
    public async Task TestConnection_is_true_for_the_emulator_management_endpoint()
    {
        Assert.True(await new AzureServiceBusProvider().TestConnectionAsync(fixture.CreateManagementConfig()));
    }

    [Fact]
    public async Task TestConnection_is_false_for_a_closed_port()
    {
        var config = fixture.CreateManagementConfig();
        var endpoint = AzureServiceBusFixture.EndpointOf(config.ConnectionString);
        config.ConnectionString = config.ConnectionString.Replace($":{endpoint.Port}/", ":1/");

        Assert.False(await new AzureServiceBusProvider().TestConnectionAsync(config));
    }

    [Fact]
    public async Task TestConnection_is_false_for_the_messaging_endpoint_because_it_probes_the_management_api()
    {
        Assert.False(await new AzureServiceBusProvider().TestConnectionAsync(fixture.CreateMessagingConfig()));
    }

    [Fact]
    public async Task Connect_opens_the_connection_and_disconnect_closes_it()
    {
        var provider = await fixture.ConnectMessagingAsync();
        var connectedWhileOpen = provider.IsConnected;

        await provider.DisconnectAsync();

        Assert.True(connectedWhileOpen);
        Assert.False(provider.IsConnected);
        Assert.Null(provider.CurrentTarget);
        await Assert.ThrowsAsync<InvalidOperationException>(() => provider.PeekMessagesAsync("queue.1"));
    }

    [Fact]
    public async Task A_created_queue_is_listed_read_and_deleted()
    {
        var queue = Name(_queues, "crud");

        await _management.CreateQueueAsync(queue);
        var listed = (await _management.GetQueuesAsync()).Select(q => q.Name).ToList();
        var read = await _management.GetQueueAsync(queue);
        await _management.DeleteQueueAsync(queue);

        Assert.Contains(queue, listed);
        Assert.Equal(queue, read?.Name);
        Assert.Null(await _management.GetQueueAsync(queue));
        Assert.False((await fixture.Admin.QueueExistsAsync(queue)).Value);
    }

    [Fact]
    public async Task A_created_topic_and_subscription_are_listed_read_and_deleted()
    {
        var topic = Name(_topics, "topic");

        await _management.CreateTopicAsync(topic);
        await _management.CreateSubscriptionAsync(topic, "audit");
        var topics = (await _management.GetTopicsAsync()).Select(t => t.Name).ToList();
        var read = Assert.IsType<TopicInfo>(await _management.GetTopicAsync(topic));
        var listed = Assert.Single(await _management.GetSubscriptionsAsync(topic));
        var subscription = await _management.GetSubscriptionAsync(topic, "audit");
        await _management.DeleteSubscriptionAsync(topic, "audit");
        var afterSubscriptionDelete = await _management.GetSubscriptionAsync(topic, "audit");
        await _management.DeleteTopicAsync(topic);

        Assert.Contains(topic, topics);
        Assert.Equal("audit", Assert.Single(read.Subscriptions).Name);
        Assert.Equal("audit", listed.Name);
        Assert.Equal(topic, subscription?.TopicName);
        Assert.Equal("$Default", Assert.Single(subscription!.Rules).Name);
        Assert.Null(afterSubscriptionDelete);
        Assert.Null(await _management.GetTopicAsync(topic));
    }

    [Fact]
    public async Task Body_content_type_subject_ids_session_and_a_string_property_survive_send_then_peek()
    {
        var queue = await CreateQueueAsync("fields", o => o.RequiresSession = true);

        await _messaging.SendMessageAsync(queue, new SendMessageRequest
        {
            Body = "{\"order\":42}",
            ContentType = "application/json",
            Subject = "order-created",
            CorrelationId = "correlation-1",
            MessageId = "message-1",
            SessionId = "session-1",
            ApplicationProperties = new Dictionary<string, object> { ["tenant"] = "contoso" }
        });
        var message = Assert.Single(await _messaging.PeekMessagesAsync(queue, 1));

        Assert.Equal("{\"order\":42}", message.Body);
        Assert.Equal("application/json", message.ContentType);
        Assert.Equal("order-created", message.Subject);
        Assert.Equal("correlation-1", message.CorrelationId);
        Assert.Equal("message-1", message.MessageId);
        Assert.Equal("session-1", message.SessionId);
        Assert.Equal("contoso", message.ApplicationProperties["tenant"]);
    }

    [Fact]
    public async Task The_session_list_holds_every_session_of_a_queue()
    {
        var queue = await CreateQueueAsync("session-list", o => o.RequiresSession = true);
        var sessionIds = Enumerable.Range(0, 20).Select(i => $"session-{i:D2}").ToList();
        foreach (var sessionId in sessionIds)
        {
            await _messaging.SendMessageAsync(queue, new SendMessageRequest { Body = sessionId, SessionId = sessionId });
        }

        var listed = (await _messaging.GetSessionsAsync(queue)).Select(s => s.SessionId).Order().ToList();

        Assert.Equal(sessionIds, listed);
    }

    [Fact]
    public async Task Receive_returns_the_message_and_removes_it()
    {
        var queue = await CreateQueueAsync("receive");
        await fixture.SendAsync(queue, "only");

        var received = Assert.Single(await _messaging.ReceiveMessagesAsync(queue, 10));

        Assert.Equal("only", received.Body);
        Assert.Empty(await fixture.DrainAsync(queue));
    }

    [Fact]
    public async Task A_message_sent_to_a_topic_reaches_each_subscription()
    {
        var topic = Name(_topics, "fanout");
        await fixture.Admin.CreateTopicAsync(topic);
        await fixture.Admin.CreateSubscriptionAsync(topic, "first");
        await fixture.Admin.CreateSubscriptionAsync(topic, "second");

        await _messaging.SendMessageAsync(topic, new SendMessageRequest { Body = "broadcast" });

        Assert.Equal("broadcast", Assert.Single(await PeekSubscriptionWhenForwardedAsync(topic, "first")).Body);
        Assert.Equal("broadcast", Assert.Single(await PeekSubscriptionWhenForwardedAsync(topic, "second")).Body);
    }

    private async Task<List<IMessage>> PeekSubscriptionWhenForwardedAsync(string topic, string subscription)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (true)
        {
            var peeked = (await _messaging.PeekMessagesAsync(topic, 10, subscriptionName: subscription)).ToList();
            if (peeked.Count > 0 || DateTime.UtcNow > deadline)
            {
                return peeked;
            }

            await Task.Delay(100);
        }
    }

    [Fact]
    public async Task A_message_over_the_max_delivery_count_and_an_explicitly_dead_lettered_one_are_on_the_dead_letter_side()
    {
        var queue = await CreateQueueAsync("dlq", o => o.MaxDeliveryCount = 2);
        await fixture.SendAsync(queue, "poison", "rejected");
        await using (var receiver = fixture.Client.CreateReceiver(queue))
        {
            for (var delivery = 0; delivery < 2; delivery++)
            {
                var poison = await receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(5));
                Assert.Equal("poison", poison.Body.ToString());
                await receiver.AbandonMessageAsync(poison);
            }

            var rejected = await receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(5));
            Assert.Equal("rejected", rejected.Body.ToString());
            await receiver.DeadLetterMessageAsync(rejected, "rejected-by-test", "explicit");
        }

        var deadLetters = (await _messaging.PeekMessagesAsync(queue, 10, isDeadLetter: true)).ToList();

        Assert.Equal(
            [("poison", "MaxDeliveryCountExceeded"), ("rejected", "rejected-by-test")],
            deadLetters.Select(m => (m.Body, m.DeadLetterReason)).ToList());
        Assert.All(deadLetters, m => Assert.True(m.IsDeadLettered));
        Assert.Empty(await _messaging.PeekMessagesAsync(queue, 10));
    }

    [Fact]
    public async Task Bulk_delete_of_a_selected_dead_letter_message_removes_only_that_one()
    {
        var queue = await CreateQueueAsync("bulk-delete");
        await fixture.SendToDeadLetterAsync(queue, "m1", "m2", "m3");
        var target = await DeadLetterSequenceOfAsync(queue, "m2");

        var result = await _messaging.DeleteMessagesAsync(queue, [target], isDeadLetter: true);

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(["m1", "m3"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(queue)));
    }

    [Fact]
    public async Task Bulk_resubmit_sends_a_selected_dead_letter_message_back_to_its_queue_and_removes_it()
    {
        var queue = await CreateQueueAsync("bulk-resubmit");
        await fixture.SendToDeadLetterAsync(queue, "m1", "m2");
        var target = await DeadLetterSequenceOfAsync(queue, "m1");

        var result = await _messaging.ResubmitDeadLetterMessagesAsync(queue, [target]);

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(["m1"], await fixture.DrainAsync(queue));
        Assert.Equal(["m2"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(queue)));
    }

    [Fact]
    public async Task Bulk_move_sends_a_selected_dead_letter_message_to_another_queue_and_removes_it()
    {
        var source = await CreateQueueAsync("move-source");
        var target = await CreateQueueAsync("move-target");
        await fixture.SendToDeadLetterAsync(source, "m1", "m2");
        var selected = await DeadLetterSequenceOfAsync(source, "m2");

        var result = await _messaging.MoveMessagesAsync(source, target, [selected], isDeadLetter: true);

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(["m2"], await fixture.DrainAsync(target));
        Assert.Equal(["m1"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(source)));
    }

    [Fact]
    public async Task Bulk_delete_resubmit_and_move_with_an_already_cancelled_token_throw_and_change_nothing()
    {
        var source = await CreateQueueAsync("cancel-source");
        var target = await CreateQueueAsync("cancel-target");
        await fixture.SendToDeadLetterAsync(source, "m1");
        var selected = await DeadLetterSequenceOfAsync(source, "m1");
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            _messaging.DeleteMessagesAsync(source, [selected], isDeadLetter: true, cancellationToken: cancelled.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            _messaging.ResubmitDeadLetterMessagesAsync(source, [selected], cancellationToken: cancelled.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            _messaging.MoveMessagesAsync(source, target, [selected], isDeadLetter: true, cancellationToken: cancelled.Token));

        Assert.Equal(["m1"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(source)));
        Assert.Empty(await fixture.DrainAsync(source));
        Assert.Empty(await fixture.DrainAsync(target));
    }
}
