using Moq;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using RabbitMQ.Client.Exceptions;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// Where a RabbitMQ send goes and what it reports: to the queue of that name, or to the exchange of that name when
/// there is no such queue, always with <c>mandatory</c> and a publisher confirm, so a message the broker did not
/// route or did not accept is a failure and never a silent success.
/// </summary>
public class RabbitMQSendTests
{
    private const string NotRouted = "The broker could not route the message: no queue receives it.";

    private static (RabbitMQProvider Provider, Mock<IModel> Channel, List<string> Published) Provider(bool queueExists = true, bool confirmed = true, bool timedOut = false, int returnOnPublish = 0)
    {
        var published = new List<string>();
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        channel.Setup(c => c.CreateBasicProperties()).Returns(Mock.Of<IBasicProperties>());
        if (queueExists)
            channel.Setup(c => c.QueueDeclarePassive(It.IsAny<string>())).Returns((string q) => new QueueDeclareOk(q, 0, 0));
        else
            channel.Setup(c => c.QueueDeclarePassive(It.IsAny<string>()))
                .Throws(new OperationInterruptedException(new ShutdownEventArgs(ShutdownInitiator.Peer, 404, "NOT_FOUND")));
        channel.Setup(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()))
            .Callback((string exchange, string key, bool mandatory, IBasicProperties _, ReadOnlyMemory<byte> _) =>
            {
                published.Add($"'{exchange}' '{key}' mandatory={mandatory}");
                if (published.Count == returnOnPublish)
                    channel.Raise(c => c.BasicReturn += null, channel.Object, new BasicReturnEventArgs());
            });
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut)).Returns(confirmed);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        connection.Setup(c => c.CreateModel()).Returns(channel.Object);
        var management = new RabbitMQManagementClient(new HttpClient(), "http://127.0.0.1:1/api", "/", "user", "password");
        return (new RabbitMQProvider(connection.Object, management, channel.Object), channel, published);
    }

    [Fact]
    public async Task A_send_to_a_queue_goes_through_the_default_exchange_with_mandatory_and_waits_for_the_confirm_whatever_its_subject()
    {
        var (provider, channel, published) = Provider();

        await provider.SendMessageAsync("orders", new SendMessageRequest { Body = "b", Subject = "label" });

        Assert.Equal(["'' 'orders' mandatory=True"], published);
        channel.Verify(c => c.ConfirmSelect(), Times.Once);
        var timedOut = false;
        channel.Verify(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut), Times.Once);
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("eu.created", "eu.created")]
    public async Task A_send_to_a_name_that_is_no_queue_goes_to_the_exchange_of_that_name_with_the_subject_as_routing_key(string? subject, string routingKey)
    {
        var (provider, _, published) = Provider(queueExists: false);

        await provider.SendMessageAsync("events", new SendMessageRequest { Body = "b", Subject = subject });

        Assert.Equal([$"'events' '{routingKey}' mandatory=True"], published);
    }

    [Fact]
    public async Task A_queue_exclusive_to_another_connection_is_still_a_queue_and_the_send_goes_to_it()
    {
        var (provider, channel, published) = Provider();
        channel.Setup(c => c.QueueDeclarePassive("orders"))
            .Throws(new OperationInterruptedException(new ShutdownEventArgs(ShutdownInitiator.Peer, 405, "RESOURCE_LOCKED - cannot obtain exclusive access")));

        await provider.SendMessageAsync("orders", new SendMessageRequest { Body = "b" });

        Assert.Equal(["'' 'orders' mandatory=True"], published);
    }

    [Fact]
    public async Task A_connection_that_drops_while_the_name_is_asked_fails_the_send_and_publishes_nothing()
    {
        var (provider, channel, published) = Provider();
        var dropped = new AlreadyClosedException(new ShutdownEventArgs(ShutdownInitiator.Library, 541, "connection lost"));
        channel.Setup(c => c.QueueDeclarePassive("orders")).Throws(dropped);

        Assert.Same(dropped, await Assert.ThrowsAsync<AlreadyClosedException>(() => provider.SendMessagesAsync("orders", [new SendMessageRequest { Body = "b" }])));
        Assert.Empty(published);
    }

    [Fact]
    public async Task A_message_the_broker_returns_as_unroutable_is_a_failure_that_says_no_queue_receives_it()
    {
        var (provider, _, _) = Provider(queueExists: false, returnOnPublish: 1);

        var refused = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => provider.SendMessageAsync("events", new SendMessageRequest { Body = "b" }));

        Assert.Equal(NotRouted, refused.Message);
    }

    [Fact]
    public async Task A_message_the_broker_does_not_confirm_is_a_failure()
    {
        var (provider, _, _) = Provider(confirmed: false);

        var refused = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => provider.SendMessageAsync("orders", new SendMessageRequest { Body = "b" }));

        Assert.Equal("The broker did not accept the message.", refused.Message);
    }

    [Fact]
    public async Task A_confirm_that_does_not_arrive_in_time_says_the_message_may_have_been_sent()
    {
        var (provider, _, _) = Provider(timedOut: true);

        var refused = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => provider.SendMessageAsync("orders", new SendMessageRequest { Body = "b" }));

        Assert.Equal("The broker did not confirm the message in time; it may have been sent.", refused.Message);
    }

    [Fact]
    public async Task A_name_that_is_neither_a_queue_nor_an_exchange_is_a_failure_that_says_so()
    {
        var (provider, channel, _) = Provider(queueExists: false);
        var timedOut = false;
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut))
            .Throws(new AlreadyClosedException(new ShutdownEventArgs(ShutdownInitiator.Peer, 404, "NOT_FOUND - no exchange 'nowhere' in vhost '/'")));

        var refused = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => provider.SendMessageAsync("nowhere", new SendMessageRequest { Body = "b" }));

        Assert.Equal("No queue or exchange has this name.", refused.Message);
    }

    [Fact]
    public async Task In_a_batch_a_message_the_broker_returns_fails_with_its_reason_and_the_ones_after_it_are_not_sent()
    {
        var (provider, _, published) = Provider(queueExists: false, returnOnPublish: 2);
        var three = Enumerable.Range(0, 3).Select(i => new SendMessageRequest { Body = $"b{i}" });

        var result = await provider.SendMessagesAsync("events", three);

        Assert.Equal(1, result.SentCount);
        Assert.Equal([(1, NotRouted), (2, SendMessageFailure.NotSent)], result.Failures.Select(f => (f.Index, f.Error)));
        Assert.Equal(2, published.Count);
    }

    [Fact]
    public async Task A_batch_asks_once_whether_the_name_is_a_queue()
    {
        var (provider, channel, published) = Provider();

        var result = await provider.SendMessagesAsync("orders", Enumerable.Range(0, 3).Select(i => new SendMessageRequest { Body = $"b{i}" }));

        Assert.Equal((3, 3), (result.SentCount, published.Count));
        channel.Verify(c => c.QueueDeclarePassive("orders"), Times.Once);
    }
}
