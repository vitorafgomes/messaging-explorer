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

    [Theory]
    [InlineData(MessageSubQueue.Active)]
    [InlineData(MessageSubQueue.DeadLetter)]
    public async Task RabbitMQ_refuses_a_peek_from_a_sequence_number_and_declares_that_it_cannot_read_from_a_position(MessageSubQueue subQueue)
    {
        var provider = new RabbitMQProvider();

        var error = await Assert.ThrowsAsync<NotSupportedException>(() => provider.PeekMessagesAsync("orders", 10, subQueue, fromSequenceNumber: 0));

        Assert.Equal("RabbitMQ cannot peek from a sequence number.", error.Message);
        Assert.False(provider.Capabilities.SupportsPeekFromSequenceNumber);
    }

    [Fact]
    public void A_RabbitMQ_message_read_without_its_body_has_a_null_body_and_everything_else_as_with_it()
    {
        var result = new RabbitMQ.Client.BasicGetResult(1, false, "dlx", "orders.created", 0, null, System.Text.Encoding.UTF8.GetBytes("payload"));

        var withBody = RabbitMQProvider.MapBasicGetToMessageInfo(result, isDeadLettered: true);
        var withoutBody = RabbitMQProvider.MapBasicGetToMessageInfo(result, isDeadLettered: true, includeBody: false);

        Assert.Equal("payload", withBody.Body);
        Assert.Null(withoutBody.Body);
        Assert.Equal(("orders.created", 7L, "dlx", true), (withoutBody.Subject, withoutBody.SizeInBytes, withoutBody.DeadLetterSource, withoutBody.IsDeadLettered));
    }
}
