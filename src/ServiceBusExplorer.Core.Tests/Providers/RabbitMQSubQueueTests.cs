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

    [Fact]
    public async Task RabbitMQ_declares_no_deferral_and_refuses_each_deferred_operation_with_the_fixed_text()
    {
        var provider = new RabbitMQProvider();

        var errors = new[]
        {
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.DeleteDeferredMessagesAsync("orders", [1])),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.ResubmitDeferredMessagesAsync("orders", [1], "audit")),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.DeadLetterDeferredMessagesAsync("orders", [1]))
        };

        Assert.False(provider.Capabilities.SupportsDeferral, "RabbitMQ has no deferred messages and must say so in its capabilities.");
        Assert.All(errors, e => Assert.Equal("RabbitMQ does not support deferred messages.", e.Message));
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

    [Theory]
    [InlineData("payload", 7L)]
    [InlineData("", 0L)]
    [InlineData("ção", 5L)]
    public void A_RabbitMQ_message_is_Active_and_its_size_is_the_bytes_of_its_body_with_or_without_the_body_read(string body, long bytes)
    {
        var result = new RabbitMQ.Client.BasicGetResult(1, false, "", "orders", 0, null, System.Text.Encoding.UTF8.GetBytes(body));

        var withBody = RabbitMQProvider.MapBasicGetToMessageInfo(result, isDeadLettered: false);
        var withoutBody = RabbitMQProvider.MapBasicGetToMessageInfo(result, isDeadLettered: false, includeBody: false);

        Assert.Equal(("Active", bytes), (withBody.State, withBody.SizeInBytes));
        Assert.Equal(("Active", bytes), (withoutBody.State, withoutBody.SizeInBytes));
    }

    [Fact]
    public void The_headers_of_a_dead_lettered_RabbitMQ_message_are_read_as_text_at_every_depth_and_the_message_is_written_as_JSON()
    {
        var properties = new Moq.Mock<RabbitMQ.Client.IBasicProperties>();
        properties.SetupGet(p => p.Headers).Returns(new Dictionary<string, object>
        {
            ["x-first-death-exchange"] = System.Text.Encoding.UTF8.GetBytes("orders"),
            ["x-death"] = new List<object>
            {
                new Dictionary<string, object>
                {
                    ["queue"] = System.Text.Encoding.UTF8.GetBytes("orders.created"),
                    ["reason"] = System.Text.Encoding.UTF8.GetBytes("rejected"),
                    ["count"] = 2L,
                    ["time"] = new RabbitMQ.Client.AmqpTimestamp(1794873600),
                    ["routing-keys"] = new List<object> { System.Text.Encoding.UTF8.GetBytes("order.created") }
                }
            }
        });
        var result = new RabbitMQ.Client.BasicGetResult(1, false, "orders.dlx", "order.created", 0, properties.Object, System.Text.Encoding.UTF8.GetBytes("{}"));

        var message = RabbitMQProvider.MapBasicGetToMessageInfo(result, isDeadLettered: true);
        var json = System.Text.Json.JsonSerializer.Serialize(message.ApplicationProperties);

        Assert.Equal("orders", message.DeadLetterSource);
        Assert.Equal(
            """{"x-first-death-exchange":"orders","x-death":[{"queue":"orders.created","reason":"rejected","count":2,"time":"2026-11-17T00:00:00Z","routing-keys":["order.created"]}]}""",
            json);
    }
}
