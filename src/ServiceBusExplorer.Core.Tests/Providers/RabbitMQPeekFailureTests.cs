using System.Net;
using System.Text;
using Moq;
using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// The calls a RabbitMQ peek adds before it reads: the management lookup of the dead-letter queue and the reopening of a
/// channel the broker closed. When either fails, the peek fails with that error and reads nothing.
/// </summary>
public class RabbitMQPeekFailureTests
{
    private sealed class StatusHandler(HttpStatusCode status) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent("broker failure", Encoding.UTF8, "text/plain") });
        }
    }

    private static RabbitMQManagementClient Client(HttpMessageHandler handler) =>
        new(new HttpClient(handler), "http://127.0.0.1:15672/api", "/", "user", "password");

    [Fact]
    public async Task A_dead_letter_peek_whose_lookup_of_the_dead_letter_queue_answers_500_fails_with_that_error_and_reads_nothing()
    {
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        var handler = new StatusHandler(HttpStatusCode.InternalServerError);
        var provider = new RabbitMQProvider(connection.Object, Client(handler), channel.Object);

        await Assert.ThrowsAsync<HttpRequestException>(() => provider.PeekMessagesAsync("orders", 10, MessageSubQueue.DeadLetter));

        Assert.Equal(1, handler.Calls);
        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_channel_that_cannot_be_opened_again_fails_the_peek_with_that_error_and_the_next_call_tries_again()
    {
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var closed = new Mock<IModel>();
        closed.Setup(c => c.IsOpen).Returns(false);
        var reopened = new Mock<IModel>();
        reopened.Setup(c => c.IsOpen).Returns(true);
        connection.SetupSequence(c => c.CreateModel())
            .Throws(new AlreadyClosedException(new ShutdownEventArgs(ShutdownInitiator.Peer, 320, "CONNECTION_FORCED")))
            .Returns(reopened.Object);
        var provider = new RabbitMQProvider(connection.Object, Client(new StatusHandler(HttpStatusCode.OK)), closed.Object);

        await Assert.ThrowsAsync<AlreadyClosedException>(() => provider.PeekMessagesAsync("orders", 1));
        closed.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);

        Assert.Empty(await provider.PeekMessagesAsync("orders", 1));
        reopened.Verify(c => c.BasicGet("orders", false), Times.Once);
    }

    private static BasicGetResult Delivery(ulong tag, string body) =>
        new(tag, false, "", "orders", 0, new Mock<IBasicProperties>().SetupAllProperties().Object, System.Text.Encoding.UTF8.GetBytes(body));

    private static (RabbitMQProvider Provider, Mock<IModel> Channel) HoldingProvider(Func<int, BasicGetResult?> get, bool channelOpen = true)
    {
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var channel = new Mock<IModel>();
        var open = true;
        channel.Setup(c => c.IsOpen).Returns(() => open);
        var call = 0;
        channel.Setup(c => c.BasicGet("orders", false)).Returns(() =>
        {
            call++;
            var result = get(call);
            if (!channelOpen && call > 1) open = false;
            return result!;
        });
        return (new RabbitMQProvider(connection.Object, Client(new StatusHandler(HttpStatusCode.OK)), channel.Object), channel);
    }

    [Fact]
    public async Task A_peek_that_fails_after_reading_two_messages_requeues_both_with_one_nack_and_fails_with_the_error()
    {
        var (provider, channel) = HoldingProvider(call => call switch
        {
            1 => Delivery(1, "m1"),
            2 => Delivery(2, "m2"),
            _ => throw new IOException("BROKER-DETAIL-SENTINEL")
        });

        await Assert.ThrowsAsync<IOException>(() => provider.PeekMessagesAsync("orders", 5));

        channel.Verify(c => c.BasicNack(2, true, true), Times.Once);
        channel.Verify(c => c.BasicNack(It.IsAny<ulong>(), It.IsAny<bool>(), It.IsAny<bool>()), Times.Once);
    }

    [Fact]
    public async Task A_peek_cancelled_after_reading_one_message_requeues_it_and_is_cancelled()
    {
        using var cts = new CancellationTokenSource();
        var (provider, channel) = HoldingProvider(call =>
        {
            if (call == 1) { cts.Cancel(); return Delivery(1, "m1"); }
            return Delivery((ulong)call, $"m{call}");
        });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => provider.PeekMessagesAsync("orders", 5, cancellationToken: cts.Token));

        channel.Verify(c => c.BasicNack(1, true, true), Times.Once);
    }

    [Fact]
    public async Task A_peek_whose_channel_closed_while_reading_sends_no_nack_since_the_broker_requeues_what_it_held()
    {
        var (provider, channel) = HoldingProvider(call => call == 1 ? Delivery(1, "m1") : null, channelOpen: false);

        var peeked = await provider.PeekMessagesAsync("orders", 5);

        Assert.Single(peeked);
        channel.Verify(c => c.BasicNack(It.IsAny<ulong>(), It.IsAny<bool>(), It.IsAny<bool>()), Times.Never);
    }
}
