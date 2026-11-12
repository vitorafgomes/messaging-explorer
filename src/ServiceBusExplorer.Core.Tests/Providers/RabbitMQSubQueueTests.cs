using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// RabbitMQ says it has no transfer dead-letter queue and no scheduled messages, in its capabilities and by refusing
/// every operation on them, never by answering as if it had done one.
/// </summary>
public class RabbitMQSubQueueTests
{
    [Fact]
    public void RabbitMQ_declares_no_transfer_dead_letter_queue_and_no_scheduled_messages()
    {
        var capabilities = new RabbitMQProvider().Capabilities;

        Assert.Equal((false, false), (capabilities.SupportsTransferDeadLetter, capabilities.SupportsScheduledMessages));
    }

    [Fact]
    public async Task RabbitMQ_refuses_every_operation_on_the_transfer_dead_letter_queue()
    {
        var provider = new RabbitMQProvider();
        const MessageSubQueue transfer = MessageSubQueue.TransferDeadLetter;

        var errors = new[]
        {
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.PeekMessagesAsync("orders", 10, transfer)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.SearchMessagesAsync("orders", new MessageSearchRequest(), transfer)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.DeleteMessagesAsync("orders", [1], transfer)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.ResubmitDeadLetterMessagesAsync("orders", [1], transfer)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.MoveMessagesAsync("orders", "archive", [1], transfer)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.PurgeMessagesAsync("orders", transfer))
        };

        Assert.All(errors, e => Assert.Equal("RabbitMQ does not support the transfer dead-letter queue.", e.Message));
    }

    [Fact]
    public async Task RabbitMQ_refuses_to_cancel_scheduled_messages()
    {
        var error = await Assert.ThrowsAsync<NotSupportedException>(() => new RabbitMQProvider().CancelScheduledMessagesAsync("orders", [12]));

        Assert.Equal("RabbitMQ does not support scheduled messages.", error.Message);
    }
}
