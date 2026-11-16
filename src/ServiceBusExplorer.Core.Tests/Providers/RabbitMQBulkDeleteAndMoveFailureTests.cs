using Moq;
using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// What a RabbitMQ bulk move and delete do, and what they report when the broker fails them: a move sends first and
/// removes after, a delete removes only the chosen positions, and neither reports a success the broker did not prove.
/// </summary>
public class RabbitMQBulkDeleteAndMoveFailureTests
{
    private static (RabbitMQProvider Provider, Mock<IModel> Channel, List<string> Calls) Provider(string queue = "orders", bool confirmed = true, int messages = 2, uint consumers = 0)
    {
        var calls = new List<string>();
        var channel = new Mock<IModel>();
        channel.Setup(c => c.IsOpen).Returns(true);
        channel.Setup(c => c.QueueDeclarePassive(queue)).Returns(new QueueDeclareOk(queue, (uint)messages, consumers));
        var gets = channel.SetupSequence(c => c.BasicGet(queue, false));
        for (var i = 0; i < messages; i++) gets = gets.Returns(new BasicGetResult((ulong)(7 + i), false, "", queue, 0, Mock.Of<IBasicProperties>(), new byte[] { 1 }));
        gets.Returns((BasicGetResult)null!);
        var timedOut = false;
        channel.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut)).Returns(confirmed);
        channel.Setup(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()))
            .Callback((string exchange, string key, bool mandatory, IBasicProperties _, ReadOnlyMemory<byte> _) => calls.Add($"publish '{exchange}' {key} mandatory={mandatory}"));
        channel.Setup(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>())).Callback((ulong tag, bool multiple) => calls.Add($"ack {tag} multiple={multiple}"));
        channel.Setup(c => c.BasicNack(It.IsAny<ulong>(), It.IsAny<bool>(), It.IsAny<bool>())).Callback((ulong tag, bool multiple, bool requeue) => calls.Add($"nack {tag} multiple={multiple} requeue={requeue}"));
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        connection.Setup(c => c.CreateModel()).Returns(channel.Object);
        var management = new RabbitMQManagementClient(new HttpClient(), "http://127.0.0.1:1/api", "/", "user", "password");
        return (new RabbitMQProvider(connection.Object, management, channel.Object), channel, calls);
    }

    private static AlreadyClosedException Closed() => new(new ShutdownEventArgs(ShutdownInitiator.Peer, 320, "CONNECTION_FORCED"));

    private static (int, int, string?) Outcome(BatchOperationResult result) =>
        (result.SuccessCount, result.FailureCount, result.Failures.Count == 1 ? result.Failures[0].Error : null);

    [Fact]
    public async Task A_move_sends_the_chosen_message_to_the_target_before_it_removes_it_and_puts_the_others_back()
    {
        var (provider, _, calls) = Provider();

        var result = await provider.MoveMessagesAsync("orders", "archive", [2]);

        Assert.Equal((1, 0, null), Outcome(result));
        Assert.Equal(["publish '' archive mandatory=True", "ack 8 multiple=False", "nack 7 multiple=True requeue=True"], calls);
    }

    [Fact]
    public async Task A_move_the_target_does_not_accept_removes_nothing_and_says_the_message_is_still_in_the_queue()
    {
        var (provider, channel, _) = Provider(confirmed: false);

        var result = await provider.MoveMessagesAsync("orders", "missing", [1]);

        Assert.Equal((0, 1, "Not moved: the broker did not accept the message. It is still in the queue."), Outcome(result));
        channel.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_move_from_a_subscription_reads_the_queue_of_that_subscription_and_its_dead_letter_queue()
    {
        var (provider, _, calls) = Provider(queue: "audit.dlq");

        var result = await provider.MoveMessagesAsync("events", "archive", [1], MessageSubQueue.DeadLetter, "audit");

        Assert.Equal((1, 0, null), Outcome(result));
        Assert.Contains("ack 7 multiple=False", calls);
    }

    [Fact]
    public async Task A_move_that_was_sent_and_could_not_be_removed_is_a_possible_duplicate_never_a_success()
    {
        var (provider, channel, _) = Provider();
        channel.Setup(c => c.BasicAck(7, false)).Throws(Closed());

        var result = await provider.MoveMessagesAsync("orders", "archive", [1]);

        Assert.Equal((0, 1, "Sent, but not removed from the queue. It may be duplicated."), Outcome(result));
        Assert.True(result.Failures[0].PossibleDuplicate);
    }

    [Fact]
    public async Task A_move_cancelled_during_the_batch_sends_no_more_and_reports_the_positions_left()
    {
        var (provider, channel, calls) = Provider();
        using var cancel = new CancellationTokenSource();
        channel.Setup(c => c.BasicAck(7, false)).Callback(cancel.Cancel);

        var result = await provider.MoveMessagesAsync("orders", "archive", [1, 2], cancellationToken: cancel.Token);

        Assert.Equal((1, 1, "Not moved: the operation was cancelled. The message is still in the queue."), Outcome(result));
        Assert.Single(calls, c => c.StartsWith("publish", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_delete_removes_only_the_chosen_position_sends_nothing_and_puts_the_others_back()
    {
        var (provider, _, calls) = Provider();

        var result = await provider.DeleteMessagesAsync("orders", [2]);

        Assert.Equal((1, 0, null), Outcome(result));
        Assert.Equal(["ack 8 multiple=False", "nack 7 multiple=True requeue=True"], calls);
    }

    [Fact]
    public async Task A_delete_whose_removal_fails_is_reported_as_unconfirmed_never_as_a_success()
    {
        var (provider, channel, _) = Provider();
        channel.Setup(c => c.BasicAck(7, false)).Throws(Closed());

        var result = await provider.DeleteMessagesAsync("orders", [1, 2]);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal(
            [(1L, "The removal from the queue was not confirmed. The message may still be there."),
             (2L, "Not deleted: the batch stopped after an earlier message failed. The message is still in the queue.")],
            result.Failures.Select(f => (f.SequenceNumber, f.Error)));
    }

    [Fact]
    public async Task A_delete_whose_channel_close_is_not_answered_is_reported_as_unconfirmed_never_as_a_success()
    {
        var (provider, channel, _) = Provider();
        channel.Setup(c => c.Close()).Throws(new TimeoutException("The close was not answered in time."));

        var result = await provider.DeleteMessagesAsync("orders", [1]);

        Assert.Equal((0, 1, "The removal from the queue was not confirmed. The message may still be there."), Outcome(result));
        Assert.False(result.Failures[0].PossibleDuplicate, "A delete sends nothing, so it cannot duplicate.");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_queue_with_a_consumer_is_refused_and_nothing_is_read(bool move)
    {
        var (provider, channel, _) = Provider(consumers: 1);

        var result = move ? await provider.MoveMessagesAsync("orders", "archive", [1]) : await provider.DeleteMessagesAsync("orders", [1]);

        var not = move ? "Not moved" : "Not deleted";
        Assert.Equal((0, 1, $"{not}: the queue has a consumer, so the position of a message may have changed. Nothing was sent or removed."), Outcome(result));
        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_cancel_before_the_batch_starts_sends_nothing_and_removes_nothing(bool move)
    {
        var (provider, _, calls) = Provider();
        using var cancel = new CancellationTokenSource();
        cancel.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => move
            ? provider.MoveMessagesAsync("orders", "archive", [1], cancellationToken: cancel.Token)
            : provider.DeleteMessagesAsync("orders", [1], cancellationToken: cancel.Token));

        Assert.DoesNotContain(calls, c => c.StartsWith("publish", StringComparison.Ordinal) || c.StartsWith("ack", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_delete_on_a_queue_that_does_not_exist_fails_every_position_and_reads_nothing()
    {
        var (provider, channel, _) = Provider();
        channel.Setup(c => c.QueueDeclarePassive("orders"))
            .Throws(new OperationInterruptedException(new ShutdownEventArgs(ShutdownInitiator.Peer, 404, "NOT_FOUND")));

        var result = await provider.DeleteMessagesAsync("orders", [1, 2]);

        Assert.Equal([(1L, "Not deleted: the queue does not exist."), (2L, "Not deleted: the queue does not exist.")], result.Failures.Select(f => (f.SequenceNumber, f.Error)));
        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    [Theory]
    [InlineData("delete", "Not deleted")]
    [InlineData("move", "Not moved")]
    [InlineData("resubmit", "Not resubmitted")]
    public async Task A_position_beyond_the_1000_a_peek_can_show_is_refused_and_no_message_is_read_or_held(string operation, string not)
    {
        var (provider, channel, _) = Provider();

        var result = operation switch
        {
            "delete" => await provider.DeleteMessagesAsync("orders", [1, 1001]),
            "move" => await provider.MoveMessagesAsync("orders", "archive", [1, 1001]),
            _ => await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 1001]),
        };

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal([1L, 1001L], result.Failures.Select(f => f.SequenceNumber));
        Assert.All(result.Failures, f => Assert.Equal($"{not}: a position beyond 1000 cannot be reached. Nothing was sent or removed.", f.Error));
        channel.Verify(c => c.BasicGet(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task A_publish_the_broker_refuses_closes_only_the_publishing_channel_and_the_held_messages_are_requeued_by_the_one_that_holds_them()
    {
        var holder = new Mock<IModel>();
        holder.Setup(c => c.IsOpen).Returns(true);
        holder.Setup(c => c.QueueDeclarePassive("orders")).Returns(new QueueDeclareOk("orders", 2, 0));
        holder.SetupSequence(c => c.BasicGet("orders", false))
            .Returns(new BasicGetResult(7, false, "", "orders", 0, Mock.Of<IBasicProperties>(), new byte[] { 1 }))
            .Returns(new BasicGetResult(8, false, "", "orders", 0, Mock.Of<IBasicProperties>(), new byte[] { 1 }));
        var publisher = new Mock<IModel>();
        var timedOut = false;
        publisher.Setup(c => c.WaitForConfirms(It.IsAny<TimeSpan>(), out timedOut))
            .Throws(new AlreadyClosedException(new ShutdownEventArgs(ShutdownInitiator.Peer, 406, "PRECONDITION_FAILED - user_id property set to 'other'")));
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        connection.SetupSequence(c => c.CreateModel()).Returns(holder.Object).Returns(publisher.Object);
        var provider = new RabbitMQProvider(connection.Object, new RabbitMQManagementClient(new HttpClient(), "http://127.0.0.1:1/api", "/", "user", "password"), Mock.Of<IModel>(c => c.IsOpen));

        var result = await provider.MoveMessagesAsync("orders", "archive", [2]);

        Assert.Equal(0, result.SuccessCount);
        Assert.StartsWith("Not moved: the broker refused the message (", Assert.Single(result.Failures).Error, StringComparison.Ordinal);
        Assert.EndsWith("). It is still in the queue.", result.Failures[0].Error, StringComparison.Ordinal);
        publisher.Verify(c => c.BasicPublish("", "archive", true, It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()), Times.Once);
        holder.Verify(c => c.BasicPublish(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IBasicProperties>(), It.IsAny<ReadOnlyMemory<byte>>()), Times.Never);
        holder.Verify(c => c.BasicAck(It.IsAny<ulong>(), It.IsAny<bool>()), Times.Never);
        holder.Verify(c => c.BasicNack(8, true, true), Times.Once);
    }

    [Theory]
    [InlineData(false, "Not deleted")]
    [InlineData(true, "Not moved")]
    public async Task A_read_that_fails_midway_fails_every_position_sends_and_removes_nothing_and_requeues_what_was_held(bool move, string not)
    {
        var (provider, channel, calls) = Provider();
        channel.SetupSequence(c => c.BasicGet("orders", false))
            .Returns(new BasicGetResult(7, false, "", "orders", 0, Mock.Of<IBasicProperties>(), new byte[] { 1 }))
            .Throws(Closed());

        var result = move ? await provider.MoveMessagesAsync("orders", "archive", [1, 2]) : await provider.DeleteMessagesAsync("orders", [1, 2]);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal([1L, 2L], result.Failures.Select(f => f.SequenceNumber));
        Assert.All(result.Failures, f =>
        {
            Assert.StartsWith($"{not}: the queue could not be read (", f.Error, StringComparison.Ordinal);
            Assert.EndsWith("). Nothing was sent or removed.", f.Error, StringComparison.Ordinal);
        });
        Assert.Equal(["nack 7 multiple=True requeue=True"], calls);
    }

    [Fact]
    public async Task A_move_or_delete_of_no_position_does_nothing()
    {
        var (provider, channel, _) = Provider();

        Assert.Equal((0, 0, null), Outcome(await provider.MoveMessagesAsync("orders", "archive", [])));
        Assert.Equal((0, 0, null), Outcome(await provider.DeleteMessagesAsync("orders", [])));
        channel.Verify(c => c.QueueDeclarePassive(It.IsAny<string>()), Times.Never);
    }
}
