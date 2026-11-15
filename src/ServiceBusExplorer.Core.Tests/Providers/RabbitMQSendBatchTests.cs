using System.Net.Http;
using Moq;
using RabbitMQ.Client;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// A RabbitMQ batch send keeps what was published: a failure or a cancellation before the first publish propagates and
/// publishes nothing; after it, the result holds the count published, the failing message as possibly sent and the rest
/// as not sent, never retried.
/// </summary>
public class RabbitMQSendBatchTests
{
    private static (RabbitMQProvider Provider, List<string> Published) ProviderFailingAt(int failingCall, Exception? error = null)
    {
        var published = new List<string>();
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        channel.Setup(c => c.CreateBasicProperties()).Returns(() => new Mock<IBasicProperties>().SetupAllProperties().Object);
        var call = 0;
        channel.Setup(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()))
            .Callback((string _, string _, bool _, IBasicProperties _, ReadOnlyMemory<byte> body) =>
            {
                call++;
                if (call == failingCall) throw error ?? new IOException("BROKER-DETAIL-SENTINEL");
                published.Add(System.Text.Encoding.UTF8.GetString(body.Span));
            });
        var client = new RabbitMQManagementClient(new HttpClient(), "http://127.0.0.1:15672/api", "/", "user", "password");
        return (new RabbitMQProvider(connection.Object, client, channel.Object), published);
    }

    private static List<SendMessageRequest> Messages(int count) =>
        Enumerable.Range(1, count).Select(i => new SendMessageRequest { Body = $"m{i}" }).ToList();

    [Fact]
    public async Task A_publish_failing_after_the_first_returns_the_count_published_the_failing_message_as_possibly_sent_and_the_rest_as_not_sent()
    {
        var (provider, published) = ProviderFailingAt(failingCall: 3);

        var result = await provider.SendMessagesAsync("orders", Messages(5));

        Assert.Equal(["m1", "m2"], published);
        Assert.Equal(2, result.SentCount);
        Assert.Equal(
            [(2, SendMessageFailure.Unconfirmed), (3, SendMessageFailure.NotSent), (4, SendMessageFailure.NotSent)],
            result.Failures.Select(f => (f.Index, f.Error)));
        Assert.DoesNotContain(result.Failures, f => f.Error.Contains("BROKER-DETAIL-SENTINEL"));
    }

    [Fact]
    public async Task A_publish_failing_on_the_first_message_propagates_and_nothing_is_published()
    {
        var error = new IOException("BROKER-DETAIL-SENTINEL");
        var (provider, published) = ProviderFailingAt(failingCall: 1, error);

        var thrown = await Assert.ThrowsAsync<IOException>(() => provider.SendMessagesAsync("orders", Messages(3)));

        Assert.Same(error, thrown);
        Assert.Empty(published);
    }

    [Fact]
    public async Task A_token_cancelled_before_the_first_publish_publishes_nothing_and_propagates()
    {
        var (provider, published) = ProviderFailingAt(failingCall: 0);
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => provider.SendMessagesAsync("orders", Messages(3), cancelled.Token));

        Assert.True(published.Count == 0, "A send asked with a cancelled token must publish nothing.");
    }

    [Fact]
    public async Task A_token_cancelled_after_the_first_publish_stops_the_send_and_keeps_the_count_published()
    {
        using var stop = new CancellationTokenSource();
        var published = new List<string>();
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        channel.Setup(c => c.CreateBasicProperties()).Returns(() => new Mock<IBasicProperties>().SetupAllProperties().Object);
        channel.Setup(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()))
            .Callback((string _, string _, bool _, IBasicProperties _, ReadOnlyMemory<byte> body) =>
            {
                published.Add(System.Text.Encoding.UTF8.GetString(body.Span));
                if (published.Count == 2) stop.Cancel();
            });
        var client = new RabbitMQManagementClient(new HttpClient(), "http://127.0.0.1:15672/api", "/", "user", "password");
        var provider = new RabbitMQProvider(connection.Object, client, channel.Object);

        var result = await provider.SendMessagesAsync("orders", Messages(5), stop.Token);

        Assert.True(published.Count == 2, $"The caller's token must stop the send after the publish in flight; published {published.Count}.");
        Assert.Equal(2, result.SentCount);
        Assert.Equal([2, 3, 4], result.Failures.Select(f => f.Index));
        Assert.All(result.Failures, f => Assert.Equal(SendMessageFailure.NotSent, f.Error));
    }
}
