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
}
