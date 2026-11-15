using Moq;
using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// What a RabbitMQ resubmit does when the broker fails it: a message the broker did not confirm stays in the
/// dead-letter queue, and one that was sent and could not be removed is reported as a possible duplicate.
/// </summary>
public class RabbitMQResubmitFailureTests
{
    private static (RabbitMQProvider Provider, Mock<IModel> Channel) Provider(bool confirmed = true, bool timedOut = false)
    {
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        channel.Setup(c => c.QueueDeclarePassive("orders.dlq")).Returns(new QueueDeclareOk("orders.dlq", 1, 0));
        channel.SetupSequence(c => c.BasicGet("orders.dlq", false))
            .Returns(new BasicGetResult(7, false, "", "orders.dlq", 0, Mock.Of<IBasicProperties>(), new byte[] { 1 }))
            .Returns((BasicGetResult)null!);
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut)).Returns(confirmed);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        connection.Setup(c => c.CreateModel()).Returns(channel.Object);
        var management = new RabbitMQManagementClient(new HttpClient(), "http://127.0.0.1:1/api", "/", "user", "password");
        return (new RabbitMQProvider(connection.Object, management, channel.Object), channel);
    }

    private static AlreadyClosedException Closed() => new(new ShutdownEventArgs(ShutdownInitiator.Peer, 320, "CONNECTION_FORCED"));

    [Fact]
    public async Task A_message_the_broker_does_not_confirm_is_not_removed_from_the_dead_letter_queue_and_is_reported()
    {
        var (provider, channel) = Provider(confirmed: false);

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.Equal("Not resubmitted: the broker did not accept the message. It is still in the dead-letter queue.", Assert.Single(result.Failures).Error);
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
        channel.Verify(c => c.BasicNack(7, true, true), Times.Once);
    }

    [Fact]
    public async Task A_confirm_that_times_out_keeps_the_message_and_reports_a_possible_duplicate()
    {
        var (provider, channel) = Provider(timedOut: true);

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.Equal("The broker did not confirm in time: the message may have been sent and is still in the dead-letter queue. Possible duplicate.", Assert.Single(result.Failures).Error);
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_message_that_was_sent_and_could_not_be_removed_is_reported_as_a_possible_duplicate_never_as_a_success()
    {
        var (provider, channel) = Provider();
        channel.Setup(c => c.BasicAck(7, false)).Throws(Closed());

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.Equal(1, Assert.Single(result.Failures).SequenceNumber);
        Assert.Equal("Sent, but not removed from the dead-letter queue. Possible duplicate.", result.Failures[0].Error);
    }

    [Fact]
    public async Task A_queue_without_a_dead_letter_queue_fails_every_position_and_reads_nothing()
    {
        var (provider, channel) = Provider();
        channel.Setup(c => c.QueueDeclarePassive("orders.dlq"))
            .Throws(new OperationInterruptedException(new ShutdownEventArgs(ShutdownInitiator.Peer, 404, "NOT_FOUND")));

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 2]);

        Assert.Equal([1L, 2L], result.Failures.Select(f => f.SequenceNumber));
        Assert.All(result.Failures, f => Assert.Equal("Not resubmitted: this queue has no dead-letter queue.", f.Error));
        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task The_single_resubmit_throws_the_reason_when_its_message_was_not_resubmitted()
    {
        var (provider, _) = Provider(confirmed: false);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => provider.ResubmitDeadLetterMessageAsync("orders", 1));

        Assert.Equal("Not resubmitted: the broker did not accept the message. It is still in the dead-letter queue.", error.Message);
    }
}
