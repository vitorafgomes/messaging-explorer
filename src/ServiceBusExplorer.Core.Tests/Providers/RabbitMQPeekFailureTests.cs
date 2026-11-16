using Moq;
using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// A RabbitMQ peek the broker refuses leaves the provider as the neutral read failure, with a cause this application
/// wrote, never as an exception of the RabbitMQ client.
/// </summary>
public class RabbitMQPeekFailureTests
{
    private sealed class Management(string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") });
    }

    private sealed class Failing(Func<Task<HttpResponseMessage>> answer) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => answer();
    }

    public static TheoryData<string> ManagementFailures => new("a 500", "a timeout", "a body that is not JSON");

    [Theory]
    [MemberData(nameof(ManagementFailures))]
    public async Task When_the_management_api_cannot_say_the_type_of_the_queue_the_peek_still_asks_the_broker(string failure)
    {
        HttpMessageHandler handler = failure switch
        {
            "a 500" => new Failing(() => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.InternalServerError))),
            "a timeout" => new Failing(() => Task.FromException<HttpResponseMessage>(new TaskCanceledException("The request timed out."))),
            _ => new Management("<html>proxy</html>")
        };
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var provider = new RabbitMQProvider(connection.Object, new RabbitMQManagementClient(new HttpClient(handler), "http://127.0.0.1:1/api", "/", "user", "password"), channel.Object);

        Assert.Empty(await provider.PeekMessagesAsync("orders", 5));

        channel.Verify(c => c.BasicGet("orders", false), Times.Once);
    }

    [Fact]
    public async Task A_peek_the_caller_cancels_while_the_type_is_read_is_cancelled_and_the_broker_is_not_asked()
    {
        using var cancel = new CancellationTokenSource();
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var handler = new Failing(() => { cancel.Cancel(); return Task.FromException<HttpResponseMessage>(new TaskCanceledException()); });
        var provider = new RabbitMQProvider(connection.Object, new RabbitMQManagementClient(new HttpClient(handler), "http://127.0.0.1:1/api", "/", "user", "password"), channel.Object);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => provider.PeekMessagesAsync("orders", 5, cancellationToken: cancel.Token));

        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    private static (RabbitMQProvider Provider, Mock<IModel> Channel) OnAStream()
    {
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        connection.Setup(c => c.CreateModel()).Returns(channel.Object);
        var management = new RabbitMQManagementClient(new HttpClient(new Management("""{"name":"orders","type":"stream"}""")), "http://127.0.0.1:1/api", "/", "user", "password");
        return (new RabbitMQProvider(connection.Object, management, channel.Object), channel);
    }

    [Fact]
    public async Task A_peek_of_a_stream_is_refused_before_the_broker_is_asked_because_a_stream_closes_the_connection_on_a_get()
    {
        var (provider, channel) = OnAStream();

        var failed = await Assert.ThrowsAsync<MessageReadFailedException>(() => provider.PeekMessagesAsync("orders", 5));

        Assert.Equal("The broker did not return the messages of this entity (a stream is not read this way).", failed.Message);
        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_delete_of_every_message_of_a_stream_is_refused_before_the_broker_is_asked_as_a_purge_is()
    {
        var (provider, channel) = OnAStream();

        var refused = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => provider.DeleteMessagesAsync("orders", [], all: true));

        Assert.Equal("A stream cannot be purged: it keeps its messages until its retention removes them.", refused.Message);
        channel.Verify(c => c.QueuePurge(It.IsAny<string>()), Times.Never);
    }

    [Theory]
    [InlineData("receive")]
    [InlineData("purge")]
    [InlineData("delete all")]
    public async Task When_the_management_api_cannot_say_the_type_of_the_queue_a_receive_a_purge_and_a_delete_of_all_still_ask_the_broker(string operation)
    {
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var handler = new Failing(() => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.InternalServerError)));
        var provider = new RabbitMQProvider(connection.Object, new RabbitMQManagementClient(new HttpClient(handler), "http://127.0.0.1:1/api", "/", "user", "password"), channel.Object);

        if (operation == "receive") await provider.ReceiveMessagesAsync("orders", 1);
        else if (operation == "purge") await provider.PurgeMessagesAsync("orders");
        else await provider.DeleteMessagesAsync("orders", [], all: true);

        if (operation == "receive") channel.Verify(c => c.BasicGet("orders", false), Times.Once);
        else channel.Verify(c => c.QueuePurge("orders"), Times.Once);
    }

    [Theory]
    [InlineData(MessageSubQueue.Active)]
    [InlineData(MessageSubQueue.DeadLetter)]
    public async Task A_search_is_refused_as_not_supported_never_answered_as_an_empty_result(MessageSubQueue subQueue)
    {
        var (provider, _) = OnAStream();

        var refused = await Assert.ThrowsAsync<NotSupportedException>(() => provider.SearchMessagesAsync("orders", new ServiceBusExplorer.Core.Models.MessageSearchRequest(), subQueue));

        Assert.Equal("RabbitMQ does not support searching messages.", refused.Message);
    }

    [Fact]
    public async Task A_receive_on_a_stream_is_refused_before_the_broker_is_asked()
    {
        var (provider, channel) = OnAStream();

        var failed = await Assert.ThrowsAsync<MessageReadFailedException>(() => provider.ReceiveMessagesAsync("orders", 5));

        Assert.Equal("The broker did not return the messages of this entity (a stream is not read this way).", failed.Message);
        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_purge_of_a_stream_is_refused_before_the_broker_is_asked_and_says_a_stream_cannot_be_purged()
    {
        var (provider, channel) = OnAStream();

        var refused = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => provider.PurgeMessagesAsync("orders"));

        Assert.Equal("A stream cannot be purged: it keeps its messages until its retention removes them.", refused.Message);
        channel.Verify(c => c.QueuePurge(It.IsAny<string>()), Times.Never);
    }

    [Theory]
    [InlineData("delete", "Not deleted")]
    [InlineData("move", "Not moved")]
    public async Task A_delete_or_a_move_on_a_stream_fails_every_position_before_the_broker_is_asked(string operation, string not)
    {
        var (provider, channel) = OnAStream();

        var result = operation == "delete"
            ? await provider.DeleteMessagesAsync("orders", [1, 2])
            : await provider.MoveMessagesAsync("orders", "archive", [1, 2]);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal([1L, 2L], result.Failures.Select(f => f.SequenceNumber));
        Assert.All(result.Failures, f => Assert.Equal($"{not}: a stream is not read this way. Nothing was sent or removed.", f.Error));
        channel.Verify(c => c.QueueDeclarePassive(It.IsAny<string>()), Times.Never);
        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    [Theory]
    [InlineData(405, "RESOURCE_LOCKED - cannot obtain exclusive access", "the queue is exclusive to another connection")]
    [InlineData(540, "NOT_IMPLEMENTED - basic.get not supported by stream queues", "a stream is not read this way")]
    [InlineData(404, "NOT_FOUND - no queue 'orders'", "the queue does not exist")]
    [InlineData(320, "CONNECTION_FORCED - broker shutdown", "AMQP 320")]
    public async Task A_peek_the_broker_refuses_is_the_neutral_read_failure_with_a_cause_and_nothing_of_the_broker_text(ushort code, string brokerText, string cause)
    {
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        var refusal = new OperationInterruptedException(new ShutdownEventArgs(ShutdownInitiator.Peer, code, brokerText));
        channel.Setup(c => c.BasicGet("orders", false)).Throws(refusal);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var provider = new RabbitMQProvider(connection.Object, new RabbitMQManagementClient(new HttpClient(), "http://127.0.0.1:1/api", "/", "user", "password"), channel.Object);

        var failed = await Assert.ThrowsAsync<MessageReadFailedException>(() => provider.PeekMessagesAsync("orders", 5));

        Assert.Equal($"The broker did not return the messages of this entity ({cause}).", failed.Message);
        Assert.Same(refusal, failed.InnerException);
    }
}
