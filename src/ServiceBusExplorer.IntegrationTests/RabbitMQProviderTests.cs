using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ;
using ServiceBusExplorer.Core.Providers.RabbitMQ.Models;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// What the RabbitMQ provider does correctly today, against a real broker.
/// </summary>
[Collection(RabbitMqCollection.Name)]
public sealed class RabbitMQProviderTests(RabbitMqFixture fixture) : IAsyncLifetime
{
    private readonly List<string> _queues = [];
    private readonly List<string> _exchanges = [];
    private RabbitMQProvider _provider = null!;

    public async Task InitializeAsync() => _provider = await fixture.ConnectAsync();

    public async Task DisposeAsync()
    {
        foreach (var queue in _queues) await fixture.DeleteQueueAsync(queue);
        foreach (var exchange in _exchanges) await fixture.DeleteExchangeAsync(exchange);
        await _provider.DisposeAsync();
    }

    private string Queue(string tag)
    {
        var name = RabbitMqFixture.UniqueName(tag);
        _queues.Add(name);
        return name;
    }

    private string Exchange(string tag)
    {
        var name = RabbitMqFixture.UniqueName(tag);
        _exchanges.Add(name);
        return name;
    }

    [Fact]
    public async Task Connect_opens_the_connection_and_disconnect_closes_it()
    {
        var provider = new RabbitMQProvider();

        await provider.ConnectAsync(fixture.CreateConfig());
        var connectedTarget = provider.CurrentTarget;
        var connectedWhileOpen = provider.IsConnected;
        await provider.DisconnectAsync();

        Assert.True(connectedWhileOpen);
        Assert.Equal($"{fixture.Host}:{fixture.AmqpPort}/", connectedTarget);
        Assert.False(provider.IsConnected);
        Assert.Null(provider.CurrentTarget);
        await Assert.ThrowsAsync<InvalidOperationException>(() => provider.GetQueuesAsync());
    }

    [Fact]
    public async Task TestConnection_is_true_for_the_container_credentials()
    {
        Assert.True(await new RabbitMQProvider().TestConnectionAsync(fixture.CreateConfig()));
    }

    [Fact]
    public async Task TestConnection_is_false_for_a_wrong_password()
    {
        var config = fixture.CreateConfig();
        config.Password = "not-the-password";

        Assert.False(await new RabbitMQProvider().TestConnectionAsync(config));
    }

    [Fact]
    public async Task A_created_queue_is_listed_read_and_deleted()
    {
        var queue = Queue("crud");

        await _provider.CreateQueueAsync(queue);
        var listed = (await _provider.GetQueuesAsync()).Select(q => q.Name).ToList();
        var read = await _provider.GetQueueAsync(queue);
        await _provider.DeleteQueueAsync(queue);

        Assert.Contains(queue, listed);
        Assert.Equal(queue, read?.Name);
        Assert.Null(await _provider.GetQueueAsync(queue));
        Assert.False(await fixture.QueueExistsAsync(queue));
    }

    [Fact]
    public async Task A_created_exchange_is_listed_as_a_topic_and_amq_exchanges_are_not()
    {
        var exchange = Exchange("topic");

        await _provider.CreateTopicAsync(exchange, new TopicCreateOptions { ExchangeType = "direct" });
        var topics = (await _provider.GetTopicsAsync()).ToList();

        var topic = Assert.IsType<RabbitMQExchangeInfo>(Assert.Single(topics, t => t.Name == exchange));
        Assert.Equal("direct", topic.ExchangeType);
        Assert.DoesNotContain(topics, t => t.Name.StartsWith("amq."));
    }

    [Fact]
    public async Task A_binding_created_as_a_subscription_is_listed_with_its_routing_key()
    {
        var exchange = Exchange("sub-ex");
        var queue = Queue("sub-q");
        await _provider.CreateTopicAsync(exchange);

        await _provider.CreateSubscriptionAsync(exchange, queue, new SubscriptionCreateOptions { RoutingKey = "orders.*" });
        var subscription = Assert.Single(await _provider.GetSubscriptionsAsync(exchange));

        Assert.Equal(queue, subscription.Name);
        Assert.Equal(exchange, subscription.TopicName);
        var rule = Assert.Single(subscription.Rules);
        Assert.Equal((RuleFilterType.RoutingKey, "orders.*"), (rule.FilterType, rule.SqlExpression));
        Assert.True(await fixture.QueueExistsAsync(queue));
    }

    [Fact]
    public async Task Deleting_a_subscription_with_the_default_routing_key_removes_its_binding()
    {
        var exchange = Exchange("unsub-ex");
        var queue = Queue("unsub-q");
        await _provider.CreateTopicAsync(exchange);
        await _provider.CreateSubscriptionAsync(exchange, queue);
        Assert.Equal(queue, Assert.Single(await _provider.GetSubscriptionsAsync(exchange)).Name);

        await _provider.DeleteSubscriptionAsync(exchange, queue);

        Assert.Empty(await _provider.GetSubscriptionsAsync(exchange));
    }

    [Fact]
    public async Task Body_content_type_and_a_string_header_survive_send_then_peek()
    {
        var queue = Queue("send");
        await _provider.CreateQueueAsync(queue);

        await _provider.SendMessageAsync(queue, new SendMessageRequest
        {
            Body = "{\"order\":42}",
            ContentType = "application/json",
            MessageId = "message-1",
            ApplicationProperties = new Dictionary<string, object> { ["tenant"] = "contoso" }
        });
        var message = Assert.Single(await _provider.PeekMessagesAsync(queue, 1));

        Assert.Equal("{\"order\":42}", message.Body);
        Assert.Equal("application/json", message.ContentType);
        Assert.Equal("message-1", message.MessageId);
        Assert.Equal("contoso", message.ApplicationProperties["tenant"]);
        await fixture.WaitForMessageCountAsync(queue, 1);
    }

    [Fact]
    public async Task Receive_returns_the_message_and_removes_it_from_the_queue()
    {
        var queue = Queue("receive");
        await _provider.CreateQueueAsync(queue);
        await _provider.SendMessageAsync(queue, new SendMessageRequest { Body = "only" });

        var received = Assert.Single(await _provider.ReceiveMessagesAsync(queue, 10));

        await _provider.DisconnectAsync();
        await using var reader = await fixture.ConnectAsync();

        Assert.Equal("only", received.Body);
        Assert.Empty(await reader.PeekMessagesAsync(queue, 10));
        Assert.Equal(0u, fixture.MessageCount(queue));
    }

    [Fact]
    public async Task Purge_empties_the_queue()
    {
        var queue = Queue("purge");
        await _provider.CreateQueueAsync(queue);
        foreach (var body in new[] { "a", "b", "c" }) fixture.PublishToQueue(queue, body);
        Assert.Equal(3u, fixture.MessageCount(queue));

        await _provider.PurgeMessagesAsync(queue);

        Assert.Equal(0u, fixture.MessageCount(queue));
    }

    [Fact]
    public async Task A_queue_named_with_a_space_is_created_and_listed_under_that_name()
    {
        var queue = Queue("with space");

        await _provider.CreateQueueAsync(queue);
        var listed = (await _provider.GetQueuesAsync()).Select(q => q.Name).ToList();

        Assert.Contains(queue, listed);
    }
}
