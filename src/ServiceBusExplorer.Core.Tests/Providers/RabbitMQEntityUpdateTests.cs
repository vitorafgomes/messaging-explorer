using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// RabbitMQ says it cannot update an entity, in its capabilities and by refusing every update, never by
/// returning as if it had.
/// </summary>
public class RabbitMQEntityUpdateTests
{
    [Fact]
    public void RabbitMQ_declares_that_it_cannot_update_entities()
    {
        Assert.False(new RabbitMQProvider().Capabilities.SupportsEntityUpdate);
    }

    [Fact]
    public async Task RabbitMQ_refuses_to_update_a_queue_a_topic_or_a_subscription()
    {
        var provider = new RabbitMQProvider();

        var queue = await Assert.ThrowsAsync<NotSupportedException>(() => provider.UpdateQueueAsync("orders", new QueueUpdateOptions { MaxDeliveryCount = 3 }));
        var topic = await Assert.ThrowsAsync<NotSupportedException>(() => provider.UpdateTopicAsync("events", new TopicUpdateOptions { Status = "Disabled" }));
        var subscription = await Assert.ThrowsAsync<NotSupportedException>(() => provider.UpdateSubscriptionAsync("events", "audit", new SubscriptionUpdateOptions { Status = "Disabled" }));

        Assert.All(new[] { queue, topic, subscription }, e => Assert.Equal("RabbitMQ does not support updating entities.", e.Message));
    }
}
