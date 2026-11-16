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
    private delegate bool Wait(TimeSpan timeout, out bool timedOut);

    private const string Stopped = "Not resubmitted: the batch stopped after an earlier message failed. The message is still in the dead-letter queue.";

    private static BasicGetResult Delivery(ulong tag) => new(tag, false, "", "orders.dlq", 0, Mock.Of<IBasicProperties>(), new byte[] { 1 });

    private static (RabbitMQProvider Provider, Mock<IModel> Channel) Provider(bool confirmed = true, bool timedOut = false, int messages = 1)
    {
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        channel.Setup(c => c.QueueDeclarePassive("orders.dlq")).Returns(new QueueDeclareOk("orders.dlq", (uint)messages, 0));
        var gets = channel.SetupSequence(c => c.BasicGet("orders.dlq", false));
        for (var i = 0; i < messages; i++) gets = gets.Returns(Delivery((ulong)(7 + i)));
        gets.Returns((BasicGetResult)null!);
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut)).Returns(confirmed);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        connection.Setup(c => c.CreateModel()).Returns(channel.Object);
        var management = new RabbitMQManagementClient(new HttpClient(), "http://127.0.0.1:1/api", "/", "user", "password");
        return (new RabbitMQProvider(connection.Object, management, channel.Object), channel);
    }

    private static AlreadyClosedException Closed(ushort code = 320, string text = "CONNECTION_FORCED") => new(new ShutdownEventArgs(ShutdownInitiator.Peer, code, text));

    [Fact]
    public async Task A_message_the_broker_does_not_confirm_is_not_removed_from_the_dead_letter_queue_and_is_reported()
    {
        var (provider, channel) = Provider(confirmed: false);

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.Equal("Not resubmitted: the broker did not accept the message. It is still in the dead-letter queue.", Assert.Single(result.Failures).Error);
        Assert.False(result.Failures[0].PossibleDuplicate);
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
        channel.Verify(c => c.BasicNack(7, true, true), Times.Once);
    }

    [Fact]
    public async Task A_confirm_that_times_out_keeps_the_message_and_reports_a_possible_duplicate()
    {
        var (provider, channel) = Provider(timedOut: true);

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.Equal("The broker did not confirm in time: the message may have been sent and is still in the dead-letter queue. It may be duplicated.", Assert.Single(result.Failures).Error);
        Assert.True(result.Failures[0].PossibleDuplicate);
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
        Assert.Equal("Sent, but not removed from the dead-letter queue. It may be duplicated.", result.Failures[0].Error);
        Assert.True(result.Failures[0].PossibleDuplicate);
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

    [Fact]
    public async Task A_confirm_the_broker_breaks_with_a_406_refusal_keeps_the_message_and_says_it_was_not_resubmitted()
    {
        var (provider, channel) = Provider();
        var timedOut = false;
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut)).Throws(Closed(406, "PRECONDITION_FAILED"));

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.StartsWith("Not resubmitted: the broker refused the message", Assert.Single(result.Failures).Error);
        Assert.EndsWith("It is still in the dead-letter queue.", result.Failures[0].Error);
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_connection_that_drops_while_waiting_for_the_confirm_reports_a_possible_duplicate_never_not_resubmitted()
    {
        var (provider, channel) = Provider();
        var timedOut = false;
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut)).Throws(Closed());

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.Equal("The connection failed before the broker confirmed: the message may have been sent and is still in the dead-letter queue. It may be duplicated.", Assert.Single(result.Failures).Error);
        Assert.All(result.Failures.Where(f => f.Error.StartsWith("The connection failed", StringComparison.Ordinal)), f => Assert.True(f.PossibleDuplicate));
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_cancel_during_the_batch_stops_it_the_positions_left_are_reported_and_only_the_confirmed_one_is_removed()
    {
        var (provider, channel) = Provider(messages: 2);
        using var cancel = new CancellationTokenSource();
        channel.Setup(c => c.BasicAck(7, false)).Callback(cancel.Cancel);

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 2], cancellationToken: cancel.Token);

        Assert.Equal(1, result.SuccessCount);
        var left = Assert.Single(result.Failures);
        Assert.Equal((2L, "Not resubmitted: the operation was cancelled. The message is still in the dead-letter queue."), (left.SequenceNumber, left.Error));
        channel.Verify(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()), Times.Once);
        channel.Verify(c => c.BasicAck(8, It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_cancel_before_the_batch_starts_sends_nothing_and_removes_nothing()
    {
        var (provider, channel) = Provider();
        using var cancel = new CancellationTokenSource();
        cancel.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => provider.ResubmitDeadLetterMessagesAsync("orders", [1], cancellationToken: cancel.Token));

        channel.Verify(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()), Times.Never);
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_position_beyond_the_messages_in_the_dead_letter_queue_is_reported_and_the_one_that_exists_is_resubmitted()
    {
        var (provider, channel) = Provider(messages: 1);

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 3]);

        Assert.Equal(1, result.SuccessCount);
        var missing = Assert.Single(result.Failures);
        Assert.Equal((3L, "Not resubmitted: no message at this position in the dead-letter queue."), (missing.SequenceNumber, missing.Error));
        channel.Verify(c => c.BasicAck(7, false), Times.Once);
    }

    [Fact]
    public async Task After_a_confirm_that_times_out_the_batch_stops_so_a_late_answer_never_lands_on_another_message()
    {
        var (provider, channel) = Provider(messages: 2);
        var waits = 0;
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out It.Ref<bool>.IsAny))
            .Returns(new Wait((TimeSpan _, out bool timedOut) => { timedOut = ++waits == 1; return !timedOut; }));

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 2]);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal([1L, 2L], result.Failures.Select(f => f.SequenceNumber));
        Assert.EndsWith("It may be duplicated.", result.Failures[0].Error);
        Assert.Equal(Stopped, result.Failures[1].Error);
        channel.Verify(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()), Times.Once);
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_publish_that_fails_on_a_closed_channel_reports_every_position_still_in_the_dead_letter_queue_and_removes_nothing()
    {
        var (provider, channel) = Provider(messages: 3);
        channel.Setup(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()))
            .Throws(Closed(406, "PRECONDITION_FAILED"));

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 2, 3]);

        Assert.Equal((0, 3), (result.SuccessCount, result.FailureCount));
        Assert.Equal([1L, 2L, 3L], result.Failures.Select(f => f.SequenceNumber));
        Assert.All(result.Failures, f => Assert.EndsWith("The message is still in the dead-letter queue.", f.Error));
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_406_for_an_expired_delivery_is_not_a_refusal_of_the_publish_and_reports_a_possible_duplicate()
    {
        var (provider, channel) = Provider();
        var timedOut = false;
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut))
            .Throws(Closed(406, "PRECONDITION_FAILED - delivery acknowledgement on channel 1 timed out"));

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.EndsWith("It may be duplicated.", Assert.Single(result.Failures).Error);
    }

    [Fact]
    public async Task A_removal_the_broker_never_confirmed_is_reported_as_a_possible_duplicate_never_as_a_success()
    {
        var (provider, channel) = Provider();
        channel.Setup(c => c.Close()).Throws(Closed());

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        Assert.Equal("Sent, but its removal from the dead-letter queue was not confirmed. It may be duplicated.", Assert.Single(result.Failures).Error);
    }

    [Fact]
    public async Task A_close_that_times_out_leaves_the_removal_unproven_and_reports_the_sent_message_as_a_possible_duplicate()
    {
        var (provider, channel) = Provider();
        channel.Setup(c => c.Close()).Throws(new TimeoutException("The close was not answered in time."));

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [1]);

        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
        var failure = Assert.Single(result.Failures);
        Assert.Equal(1, failure.SequenceNumber);
        Assert.Equal("Sent, but its removal from the dead-letter queue was not confirmed. It may be duplicated.", failure.Error);
        Assert.True(failure.PossibleDuplicate);
    }

    [Fact]
    public async Task A_requeue_that_fails_at_the_end_keeps_the_report_of_each_message()
    {
        var (provider, channel) = Provider(messages: 2);
        channel.Setup(c => c.BasicNack(It.IsAny<ulong>(), It.IsAny<bool>(), It.IsAny<bool>())).Throws(Closed());

        var result = await provider.ResubmitDeadLetterMessagesAsync("orders", [2]);

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        channel.Verify(c => c.BasicAck(8, false), Times.Once);
        channel.Verify(c => c.BasicNack(7, true, true), Times.Once);
    }

    /// <summary>Two messages; the first is confirmed and removed, then the broker closes the channel while the second waits on its confirm.</summary>
    private static async Task<ServiceBusExplorer.Core.Models.BatchOperationResult> ClosedWhileWaitingOnTheSecond(ShutdownEventArgs close)
    {
        var (provider, channel) = Provider(messages: 2);
        var open = true;
        channel.Setup(c => c.IsOpen).Returns(() => open);
        channel.Setup(c => c.CloseReason).Returns(() => open ? null! : close);
        var waits = 0;
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out It.Ref<bool>.IsAny))
            .Returns(new Wait((TimeSpan _, out bool timedOut) =>
            {
                timedOut = false;
                if (++waits == 1) return true;
                open = false;
                throw new AlreadyClosedException(close);
            }));

        return await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 2]);
    }

    [Fact]
    public async Task A_channel_the_broker_closed_for_a_refusal_had_processed_the_earlier_removal_so_it_counts_as_a_success()
    {
        var result = await ClosedWhileWaitingOnTheSecond(new ShutdownEventArgs(ShutdownInitiator.Peer, 406, "PRECONDITION_FAILED"));

        Assert.Equal(1, result.SuccessCount);
        var refused = Assert.Single(result.Failures);
        Assert.Equal(2L, refused.SequenceNumber);
        Assert.StartsWith("Not resubmitted: the broker refused the message", refused.Error);
    }

    [Theory]
    [InlineData(406, "PRECONDITION_FAILED - delivery acknowledgement on channel 1 timed out")]
    [InlineData(320, "CONNECTION_FORCED")]
    public async Task A_channel_closed_for_an_expired_delivery_or_a_dropped_connection_leaves_the_earlier_removal_unproven_a_possible_duplicate(ushort code, string text)
    {
        var result = await ClosedWhileWaitingOnTheSecond(new ShutdownEventArgs(ShutdownInitiator.Peer, code, text));

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal([1L, 2L], result.Failures.Select(f => f.SequenceNumber).Order());
        Assert.All(result.Failures, f => Assert.Contains("may be duplicated", f.Error));
        Assert.All(result.Failures, f => Assert.True(f.PossibleDuplicate));
    }
}
