using Azure.Messaging.ServiceBus;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The sub-queue a message operation reads, the peek across short batches, the answer to a disabled entity and the
/// cancel of scheduled messages, against a mocked <see cref="ServiceBusClient"/>, receiver and sender.
/// </summary>
public class AzureServiceBusProviderSubQueueTests
{
    private const string FakeConnectionString =
        "Endpoint=sb://unit.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    private static ServiceBusReceivedMessage Msg(long sequenceNumber, ServiceBusMessageState state = ServiceBusMessageState.Active) =>
        ServiceBusModelFactory.ServiceBusReceivedMessage(
            body: BinaryData.FromString($"body-{sequenceNumber}"),
            sequenceNumber: sequenceNumber,
            serviceBusMessageState: state);

    private static IReadOnlyList<ServiceBusReceivedMessage> Batch(params ServiceBusReceivedMessage[] messages) => messages;

    private const string Disabled = "The entity is disabled for this operation.";
    private const string CancelFailed = "The broker did not cancel this message.";

    private const string Sentinel = "BROKER-DETAIL-SENTINEL";

    private static ServiceBusException Broker(ServiceBusFailureReason reason) => new("broker detail TrackingId:abc", reason);

    private static ServiceBusMessageBatch NewTestBatch() =>
        ServiceBusModelFactory.ServiceBusMessageBatch(
            batchSizeBytes: long.MaxValue,
            batchMessageStore: new List<ServiceBusMessage>(),
            batchOptions: new CreateMessageBatchOptions(),
            tryAddCallback: _ => true);

    /// <summary>A mocked client that records every receiver it creates and hands out one receiver and one sender.</summary>
    private sealed class FakeBroker
    {
        public Mock<ServiceBusClient> Client { get; } = new();
        public Mock<ServiceBusReceiver> Receiver { get; } = new();
        public Mock<ServiceBusSender> Sender { get; } = new();
        public List<(string Path, SubQueue SubQueue)> Receivers { get; } = new();

        public FakeBroker()
        {
            Client.Setup(c => c.CreateReceiver(It.IsAny<string>(), It.IsAny<ServiceBusReceiverOptions>()))
                .Callback((string path, ServiceBusReceiverOptions options) => Receivers.Add((path, options.SubQueue)))
                .Returns(Receiver.Object);
            Client.Setup(c => c.CreateSender(It.IsAny<string>())).Returns(Sender.Object);
            Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Batch());
            Receiver.Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Batch());
            Sender.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
                .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        }

        public AzureServiceBusProvider Provider() => new(Client.Object);
    }

    [Theory]
    [InlineData(MessageSubQueue.Active, null, "orders")]
    [InlineData(MessageSubQueue.DeadLetter, null, "orders/$DeadLetterQueue")]
    [InlineData(MessageSubQueue.TransferDeadLetter, null, "orders/$Transfer/$DeadLetterQueue")]
    [InlineData(MessageSubQueue.TransferDeadLetter, "audit", "orders/subscriptions/audit/$Transfer/$DeadLetterQueue")]
    public async Task The_sub_queue_reaches_the_sdk_as_the_receiver_path_of_that_queue(MessageSubQueue subQueue, string? subscription, string expectedPath)
    {
        await using var client = new ServiceBusClient(FakeConnectionString);

        await using var receiver = AzureServiceBusProvider.CreateReceiver(client, "orders", subscription, subQueue);

        Assert.Equal(expectedPath, receiver.EntityPath);
    }

    [Theory]
    [InlineData("peek", null, "orders")]
    [InlineData("peek", "audit", "orders/subscriptions/audit")]
    [InlineData("search", null, "orders")]
    [InlineData("search", "audit", "orders/subscriptions/audit")]
    [InlineData("delete-batch", null, "orders")]
    [InlineData("delete-batch", "audit", "orders/subscriptions/audit")]
    [InlineData("resubmit-batch", null, "orders")]
    [InlineData("resubmit-batch", "audit", "orders/subscriptions/audit")]
    public async Task The_transfer_dead_letter_queue_is_reachable_by_peek_search_delete_and_resubmit_of_a_queue_and_a_subscription(
        string operation, string? subscription, string expectedPath)
    {
        var broker = new FakeBroker();
        var provider = broker.Provider();
        const MessageSubQueue transfer = MessageSubQueue.TransferDeadLetter;

        await (operation switch
        {
            "peek" => provider.PeekMessagesAsync("orders", 10, transfer, subscription),
            "search" => provider.SearchMessagesAsync("orders", new MessageSearchRequest { Query = "x", Count = 5 }, transfer, subscription),
            "delete-batch" => provider.DeleteMessagesAsync("orders", [1], transfer, subscription),
            _ => (Task)provider.ResubmitDeadLetterMessagesAsync("orders", [1], transfer, subscription)
        });

        Assert.Equal((expectedPath, SubQueue.TransferDeadLetter), Assert.Single(broker.Receivers));
    }

    [Fact]
    public async Task A_message_peeked_from_the_transfer_dead_letter_queue_is_marked_dead_lettered()
    {
        var broker = new FakeBroker();
        broker.Receiver.SetupSequence(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Batch(Msg(4)))
            .ReturnsAsync(Batch());

        var message = Assert.Single(await broker.Provider().PeekMessagesAsync("orders", 10, MessageSubQueue.TransferDeadLetter));

        Assert.Equal((4L, true), (message.SequenceNumber, message.IsDeadLettered));
    }

    [Fact]
    public async Task A_resubmit_from_the_active_queue_is_refused_before_any_receiver_is_created()
    {
        var broker = new FakeBroker();

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            broker.Provider().ResubmitDeadLetterMessagesAsync("orders", [1], MessageSubQueue.Active));

        Assert.Empty(broker.Receivers);
    }

    [Fact]
    public void Azure_declares_the_transfer_dead_letter_queue_and_no_longer_declares_deferral()
    {
        var capabilities = new AzureServiceBusProvider().Capabilities;

        Assert.Equal((true, false), (capabilities.SupportsTransferDeadLetter, capabilities.SupportsDeferral));
    }

    [Fact]
    public async Task A_peek_goes_on_after_a_short_batch_and_lists_the_scheduled_message_behind_an_active_one()
    {
        var broker = new FakeBroker();
        var asked = new List<(int Max, long? From)>();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .Callback((int max, long? from, CancellationToken _) => asked.Add((max, from)))
            .ReturnsAsync((int _, long? from, CancellationToken _) => from switch
            {
                null => Batch(Msg(1)),
                2 => Batch(Msg(2, ServiceBusMessageState.Scheduled), Msg(3)),
                _ => Batch()
            });

        var peeked = (await broker.Provider().PeekMessagesAsync("orders", 10)).ToList();

        Assert.Equal(new (long?, string)[] { (1, "Active"), (2, "Scheduled"), (3, "Active") },
            peeked.Select(m => (m.SequenceNumber, m.State)).ToArray());
        Assert.Equal(new (int, long?)[] { (10, null), (9, 2), (7, 4) }, asked.ToArray());
    }

    [Fact]
    public async Task A_peek_whose_first_batch_fills_the_count_makes_one_broker_call()
    {
        var receiver = new Mock<ServiceBusReceiver>();
        receiver.Setup(r => r.PeekMessagesAsync(5, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Batch(Msg(1), Msg(2), Msg(3), Msg(4), Msg(5)));

        var peeked = await AzureServiceBusProvider.PeekCoreAsync(receiver.Object, 5, null, CancellationToken.None);

        Assert.Equal(new long[] { 1, 2, 3, 4, 5 }, peeked.Select(m => m.SequenceNumber).ToArray());
        receiver.Verify(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_peek_of_more_than_250_asks_in_batches_of_250_and_stops_at_the_count()
    {
        var receiver = new Mock<ServiceBusReceiver>();
        var asked = new List<int>();
        receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .Callback((int max, long? _, CancellationToken _) => asked.Add(max))
            .ReturnsAsync((int max, long? from, CancellationToken _) =>
                Enumerable.Range(0, max).Select(i => Msg((from ?? 1) + i)).ToList());

        var peeked = await AzureServiceBusProvider.PeekCoreAsync(receiver.Object, 300, null, CancellationToken.None);

        Assert.Equal(300, peeked.Count);
        Assert.Equal(new[] { 250, 50 }, asked.ToArray());
    }

    [Fact]
    public async Task A_peek_whose_token_is_cancelled_after_the_first_batch_makes_no_further_broker_call_and_hands_the_sdk_that_token()
    {
        using var cts = new CancellationTokenSource();
        var tokens = new List<CancellationToken>();
        var receiver = new Mock<ServiceBusReceiver>();
        receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .Callback((int _, long? _, CancellationToken token) =>
            {
                tokens.Add(token);
                cts.Cancel();
            })
            .ReturnsAsync(Batch(Msg(1)));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => AzureServiceBusProvider.PeekCoreAsync(receiver.Object, 1000, null, cts.Token));

        Assert.Equal(new[] { true }, tokens.Select(t => t.IsCancellationRequested).ToArray());
    }

    [Fact]
    public async Task A_peek_with_an_already_cancelled_token_makes_no_broker_call()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var receiver = new Mock<ServiceBusReceiver>();
        receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>())).ReturnsAsync(Batch());

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => AzureServiceBusProvider.PeekCoreAsync(receiver.Object, 10, null, cts.Token));

        receiver.Verify(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(7)]
    [InlineData(1000)]
    public async Task A_broker_answering_one_message_per_batch_gives_exactly_count_messages_in_at_most_count_plus_one_calls(int count)
    {
        var receiver = new Mock<ServiceBusReceiver>();
        var calls = 0;
        receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .Callback(() => calls++)
            .ReturnsAsync((int _, long? from, CancellationToken _) => Batch(Msg(from ?? 1)));

        var peeked = await AzureServiceBusProvider.PeekCoreAsync(receiver.Object, count, null, CancellationToken.None);

        Assert.Equal(Enumerable.Range(1, count).Select(i => (long)i), peeked.Select(m => m.SequenceNumber));
        Assert.InRange(calls, count, count + 1);
    }

    [Fact]
    public async Task A_search_whose_token_is_cancelled_after_the_first_batch_makes_no_further_broker_call_and_hands_the_sdk_that_token()
    {
        using var cts = new CancellationTokenSource();
        var tokens = new List<CancellationToken>();
        var receiver = new Mock<ServiceBusReceiver>();
        receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .Callback((int _, long? _, CancellationToken token) =>
            {
                tokens.Add(token);
                cts.Cancel();
            })
            .ReturnsAsync(Batch(Msg(1)));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            AzureServiceBusProvider.SearchCoreAsync(receiver.Object, new MessageSearchRequest { Query = "no match" }, false, cts.Token));

        Assert.Equal(new[] { true }, tokens.Select(t => t.IsCancellationRequested).ToArray());
    }

    [Fact]
    public async Task A_peek_whose_continuation_call_fails_gives_the_caller_the_broker_error_instead_of_a_partial_list()
    {
        var broker = new FakeBroker();
        broker.Receiver.SetupSequence(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Batch(Msg(1)))
            .ThrowsAsync(Broker(ServiceBusFailureReason.ServiceTimeout));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => broker.Provider().PeekMessagesAsync("orders", 10));

        Assert.Equal(ServiceBusFailureReason.ServiceTimeout, error.Reason);
    }

    [Fact]
    public async Task A_transfer_dead_letter_peek_whose_receiver_fails_gives_the_caller_the_broker_error_instead_of_an_empty_list()
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.ServiceCommunicationProblem));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            broker.Provider().PeekMessagesAsync("orders", 10, MessageSubQueue.TransferDeadLetter));

        Assert.Equal(ServiceBusFailureReason.ServiceCommunicationProblem, error.Reason);
    }

    [Theory]
    [InlineData("send")]
    [InlineData("send batch")]
    [InlineData("receive")]
    [InlineData("peek")]
    [InlineData("search")]
    public async Task A_disabled_entity_answers_the_neutral_exception_with_the_fixed_text_on_every_single_message_path(string operation)
    {
        var broker = new FakeBroker();
        var disabled = Broker(ServiceBusFailureReason.MessagingEntityDisabled);
        broker.Sender.Setup(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>())).ThrowsAsync(disabled);
        broker.Sender.Setup(s => s.SendMessagesAsync(It.IsAny<IEnumerable<ServiceBusMessage>>(), It.IsAny<CancellationToken>())).ThrowsAsync(disabled);
        broker.Receiver.Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>())).ThrowsAsync(disabled);
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>())).ThrowsAsync(disabled);
        var provider = broker.Provider();
        var message = new SendMessageRequest { Body = "b" };

        var error = await Assert.ThrowsAsync<EntityDisabledException>(() => operation switch
        {
            "send" => provider.SendMessageAsync("orders", message),
            "send batch" => provider.SendMessagesAsync("orders", [message]),
            "receive" => provider.ReceiveMessagesAsync("orders"),
            "peek" => provider.PeekMessagesAsync("orders"),
            _ => provider.SearchMessagesAsync("orders", new MessageSearchRequest { Query = "x" })
        });

        Assert.Equal("The entity is disabled for this operation.", error.Message);
        Assert.Same(disabled, error.InnerException);
    }

    [Fact]
    public async Task A_single_resubmit_into_a_disabled_entity_answers_the_neutral_exception_and_removes_nothing()
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(1, 7, It.IsAny<CancellationToken>())).ReturnsAsync(Batch(Msg(7)));
        broker.Sender.Setup(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        await Assert.ThrowsAsync<EntityDisabledException>(() => broker.Provider().ResubmitDeadLetterMessageAsync("orders", 7));

        Assert.Equal(new[] { ("orders", SubQueue.DeadLetter) }, broker.Receivers.ToArray());
        broker.Receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static Mock<ServiceBusReceiver> ReceiverFailingAfter(IReadOnlyList<ServiceBusReceivedMessage>[] batches, Exception failure)
    {
        var queue = new Queue<IReadOnlyList<ServiceBusReceivedMessage>>(batches);
        var receiver = new Mock<ServiceBusReceiver>();
        receiver.Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()))
            .Returns(() => queue.Count > 0 ? Task.FromResult(queue.Dequeue()) : Task.FromException<IReadOnlyList<ServiceBusReceivedMessage>>(failure));
        return receiver;
    }

    [Fact]
    public async Task A_delete_that_finds_the_entity_disabled_midway_keeps_what_it_deleted_and_fails_the_rest_with_the_disabled_text_without_retrying()
    {
        var receiver = ReceiverFailingAfter([Batch(Msg(1), Msg(2))], Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        var result = await AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, [1, 2, 3, 4], CancellationToken.None);

        Assert.Equal(2, result.SuccessCount);
        Assert.Equal(new[] { (3L, Disabled), (4L, Disabled) },
            result.Failures.Select(f => (f.SequenceNumber, f.Error)).OrderBy(f => f.SequenceNumber).ToArray());
        receiver.Verify(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task A_delete_on_an_entity_disabled_before_anything_was_deleted_throws_the_neutral_exception()
    {
        var receiver = ReceiverFailingAfter([], Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        await Assert.ThrowsAsync<EntityDisabledException>(() =>
            AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, [1, 2], CancellationToken.None));
    }

    [Theory]
    [InlineData("resubmit")]
    [InlineData("move")]
    public async Task A_resubmit_or_move_whose_target_is_disabled_midway_keeps_what_it_sent_and_fails_the_rest_with_the_disabled_text_without_retrying(string operation)
    {
        var receiver = ReceiverFailingAfter([Batch(Msg(1)), Batch(Msg(2), Msg(3))], Broker(ServiceBusFailureReason.ServiceTimeout));
        var completed = new List<long>();
        receiver.Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .Callback((ServiceBusReceivedMessage m, CancellationToken _) => completed.Add(m.SequenceNumber))
            .Returns(Task.CompletedTask);
        var sender = new Mock<ServiceBusSender>();
        sender.SetupSequence(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(new ValueTask<ServiceBusMessageBatch>(NewTestBatch()))
            .Throws(Broker(ServiceBusFailureReason.MessagingEntityDisabled));
        sender.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = operation == "resubmit"
            ? await AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, [1, 2, 3], CancellationToken.None)
            : await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, [1, 2, 3], CancellationToken.None);

        Assert.Equal(1, result.SuccessCount);
        Assert.Equal(new[] { (2L, Disabled), (3L, Disabled) },
            result.Failures.Select(f => (f.SequenceNumber, f.Error)).OrderBy(f => f.SequenceNumber).ToArray());
        Assert.Equal(new long[] { 1 }, completed.ToArray());
        sender.Verify(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Theory]
    [InlineData("resubmit")]
    [InlineData("move")]
    public async Task A_resubmit_or_move_into_a_target_disabled_before_anything_was_sent_throws_the_neutral_exception_and_completes_nothing(string operation)
    {
        var receiver = ReceiverFailingAfter([Batch(Msg(1))], Broker(ServiceBusFailureReason.ServiceTimeout));
        var sender = new Mock<ServiceBusSender>();
        sender.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Throws(Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        await Assert.ThrowsAsync<EntityDisabledException>(() => operation == "resubmit"
            ? AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, [1], CancellationToken.None)
            : AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, [1], CancellationToken.None));

        receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>A sender whose cancel answers each call through <paramref name="answer"/> and records every call.</summary>
    private static Mock<ServiceBusSender> CancellingSender(List<long[]> calls, Func<long[], Exception?> answer)
    {
        var sender = new Mock<ServiceBusSender>();
        sender.Setup(s => s.CancelScheduledMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .Returns((IEnumerable<long> numbers, CancellationToken _) =>
            {
                var call = numbers.ToArray();
                calls.Add(call);
                return answer(call) is { } error ? Task.FromException(error) : Task.CompletedTask;
            });
        return sender;
    }

    private static (long, string)[] FailuresOf(BatchOperationResult result) =>
        result.Failures.Select(f => (f.SequenceNumber, f.Error)).ToArray();

    [Fact]
    public async Task Cancelling_scheduled_messages_that_are_all_scheduled_cancels_them_in_one_broker_call()
    {
        var calls = new List<long[]>();
        var sender = CancellingSender(calls, _ => null);

        var result = await AzureServiceBusProvider.CancelScheduledCoreAsync(sender.Object, "orders", NullLogger.Instance, [12, 13], CancellationToken.None);

        Assert.Equal((2, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(new[] { 12L, 13L }, Assert.Single(calls));
    }

    [Fact]
    public async Task One_sequence_number_that_is_not_scheduled_fails_only_that_number_and_the_others_are_cancelled()
    {
        var calls = new List<long[]>();
        var sender = CancellingSender(calls, call => call.Contains(13) ? Broker(ServiceBusFailureReason.MessageNotFound) : null);

        var result = await AzureServiceBusProvider.CancelScheduledCoreAsync(sender.Object, "orders", NullLogger.Instance, [12, 13, 14], CancellationToken.None);

        Assert.Equal(2, result.SuccessCount);
        Assert.Equal(new[] { (13L, "This message is not scheduled any more.") }, FailuresOf(result));
        Assert.Equal(new[] { new long[] { 12, 13, 14 }, [12], [13], [14] }, calls.ToArray());
    }

    [Fact]
    public async Task A_cancel_on_a_send_disabled_queue_before_anything_was_cancelled_throws_the_neutral_exception()
    {
        var calls = new List<long[]>();
        var sender = CancellingSender(calls, _ => Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        await Assert.ThrowsAsync<EntityDisabledException>(() =>
            AzureServiceBusProvider.CancelScheduledCoreAsync(sender.Object, "orders", NullLogger.Instance, [12, 13], CancellationToken.None));

        Assert.Single(calls);
    }

    [Fact]
    public async Task A_cancel_that_finds_the_queue_disabled_midway_keeps_what_it_cancelled_and_fails_the_rest_with_the_disabled_text_without_retrying()
    {
        var calls = new List<long[]>();
        var sender = CancellingSender(calls, call => call.Length > 1
            ? Broker(ServiceBusFailureReason.MessageNotFound)
            : call[0] == 12 ? null : Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        var result = await AzureServiceBusProvider.CancelScheduledCoreAsync(sender.Object, "orders", NullLogger.Instance, [12, 13, 14], CancellationToken.None);

        Assert.Equal(1, result.SuccessCount);
        Assert.Equal(new[] { (13L, Disabled), (14L, Disabled) }, FailuresOf(result));
        Assert.Equal(new[] { new long[] { 12, 13, 14 }, [12], [13] }, calls.ToArray());
    }

    [Fact]
    public async Task A_cancel_whose_first_single_number_call_finds_the_queue_disabled_throws_the_neutral_exception_and_tries_no_other_number()
    {
        var calls = new List<long[]>();
        var sender = CancellingSender(calls, call => call.Length > 1
            ? Broker(ServiceBusFailureReason.MessageNotFound)
            : Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        await Assert.ThrowsAsync<EntityDisabledException>(() =>
            AzureServiceBusProvider.CancelScheduledCoreAsync(sender.Object, "orders", NullLogger.Instance, [12, 13, 14], CancellationToken.None));

        Assert.Equal(new[] { new long[] { 12, 13, 14 }, [12] }, calls.ToArray());
    }

    [Fact]
    public async Task A_failing_cancel_call_fails_every_number_with_the_fixed_sentence_and_never_the_broker_text()
    {
        var calls = new List<long[]>();
        var sender = CancellingSender(calls, _ => Broker(ServiceBusFailureReason.ServiceTimeout));

        var result = await AzureServiceBusProvider.CancelScheduledCoreAsync(sender.Object, "orders", NullLogger.Instance, [12, 13], CancellationToken.None);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal(new[] { (12L, CancelFailed), (13L, CancelFailed) }, FailuresOf(result));
        Assert.Single(calls);
    }

    [Fact]
    public async Task A_cancel_failing_for_an_arbitrary_cause_shows_only_fixed_sentences_and_logs_the_causes_once()
    {
        var calls = new List<long[]>();
        var sender = CancellingSender(calls, call => call.Length > 1
            ? Broker(ServiceBusFailureReason.MessageNotFound)
            : call[0] switch
            {
                12 => new UnauthorizedAccessException(Sentinel),
                13 => Broker(ServiceBusFailureReason.MessageNotFound),
                _ => Broker(ServiceBusFailureReason.ServiceTimeout)
            });
        var logger = new Mock<ILogger>();

        var result = await AzureServiceBusProvider.CancelScheduledCoreAsync(sender.Object, "orders", logger.Object, [12, 13, 14], CancellationToken.None);

        Assert.Equal(new[] { (12L, CancelFailed), (13L, "This message is not scheduled any more."), (14L, CancelFailed) }, FailuresOf(result));
        Assert.All(result.Failures, f => Assert.DoesNotContain(f.Error, new[] { Sentinel, "UnauthorizedAccessException", "MessageNotFound", "ServiceTimeout" }));
        logger.Verify(l => l.Log(LogLevel.Warning, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(), It.IsAny<Exception?>(),
            It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
    }

    [Fact]
    public async Task The_caller_token_stops_a_cancel_before_the_next_sequence_number()
    {
        using var cts = new CancellationTokenSource();
        var calls = new List<long[]>();
        var sender = CancellingSender(calls, call =>
        {
            if (call.Length == 1 && call[0] == 12) cts.Cancel();
            return call.Length > 1 ? Broker(ServiceBusFailureReason.MessageNotFound) : null;
        });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            AzureServiceBusProvider.CancelScheduledCoreAsync(sender.Object, "orders", NullLogger.Instance, [12, 13, 14], cts.Token));

        Assert.Equal(new[] { new long[] { 12, 13, 14 }, [12] }, calls.ToArray());
    }

    public static TheoryData<long[], string> InvalidSequenceNumbers => new()
    {
        { [], "sequenceNumbers must hold 1 to 500 sequence numbers." },
        { Enumerable.Range(1, 501).Select(i => (long)i).ToArray(), "sequenceNumbers must hold 1 to 500 sequence numbers." },
        { [12, 0], "sequenceNumbers must be positive whole numbers." },
        { [-3], "sequenceNumbers must be positive whole numbers." },
        { [12, 12], "sequenceNumbers must not repeat a sequence number." }
    };

    [Theory]
    [MemberData(nameof(InvalidSequenceNumbers))]
    public async Task A_cancel_outside_1_to_500_positive_distinct_numbers_is_refused_naming_the_field_before_the_broker_is_called(long[] sequenceNumbers, string expected)
    {
        var broker = new FakeBroker();

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            broker.Provider().CancelScheduledMessagesAsync("orders", sequenceNumbers));

        Assert.Equal(expected, error.Message);
        broker.Client.Verify(c => c.CreateSender(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task A_cancel_of_500_distinct_positive_numbers_reaches_the_broker()
    {
        var broker = new FakeBroker();
        var numbers = Enumerable.Range(1, 500).Select(i => (long)i).ToArray();

        var result = await broker.Provider().CancelScheduledMessagesAsync("orders", numbers);

        Assert.Equal(500, result.SuccessCount);
        broker.Sender.Verify(s => s.CancelScheduledMessagesAsync(numbers, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(MessageSubQueue.Active)]
    [InlineData(MessageSubQueue.DeadLetter)]
    [InlineData(MessageSubQueue.TransferDeadLetter)]
    public async Task A_peek_from_a_sequence_number_starts_there_returns_nothing_before_it_and_reads_on_past_a_short_batch(MessageSubQueue subQueue)
    {
        var broker = new FakeBroker();
        var asked = new List<long?>();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .Callback((int _, long? from, CancellationToken _) => asked.Add(from))
            .ReturnsAsync((int _, long? from, CancellationToken _) => (from ?? 1) <= 5 ? Batch(Msg(from ?? 1)) : Batch());

        var peeked = await broker.Provider().PeekMessagesAsync("orders", 10, subQueue, fromSequenceNumber: 3);

        Assert.Equal(new long?[] { 3, 4, 5 }, peeked.Select(m => m.SequenceNumber).ToArray());
        Assert.Equal(new long?[] { 3, 4, 5, 6 }, asked.ToArray());
    }

    [Fact]
    public async Task A_peek_from_a_sequence_number_whose_sdk_call_fails_gives_the_caller_the_same_broker_error_as_a_peek_from_the_head()
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.ServiceTimeout));

        var fromHead = await Assert.ThrowsAsync<ServiceBusException>(() =>
            broker.Provider().PeekMessagesAsync("orders", 10, MessageSubQueue.DeadLetter));
        var fromPosition = await Assert.ThrowsAsync<ServiceBusException>(() =>
            broker.Provider().PeekMessagesAsync("orders", 10, MessageSubQueue.DeadLetter, fromSequenceNumber: 3));

        Assert.Equal((ServiceBusFailureReason.ServiceTimeout, fromHead.Message), (fromPosition.Reason, fromPosition.Message));
    }

    [Fact]
    public void Azure_declares_that_a_peek_can_start_at_a_sequence_number()
    {
        Assert.True(new AzureServiceBusProvider().Capabilities.SupportsPeekFromSequenceNumber);
    }

    [Theory]
    [InlineData(MessageSubQueue.DeadLetter)]
    [InlineData(MessageSubQueue.TransferDeadLetter)]
    public async Task A_peek_without_bodies_answers_each_message_with_a_null_body_and_everything_else_as_with_bodies(MessageSubQueue subQueue)
    {
        var broker = new FakeBroker();
        var enqueued = new DateTimeOffset(2026, 11, 13, 9, 30, 0, TimeSpan.Zero);
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((int _, long? from, CancellationToken _) => from is null or 1
                ? Batch(ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString("payload"), subject: "order", sequenceNumber: 1,
                    properties: new Dictionary<string, object> { ["DeadLetterReason"] = "rejected" }, enqueuedTime: enqueued))
                : Batch());

        var withBody = Assert.Single(await broker.Provider().PeekMessagesAsync("orders", 10, subQueue));
        var withoutBody = Assert.Single(await broker.Provider().PeekMessagesAsync("orders", 10, subQueue, includeBody: false));

        Assert.Equal("payload", withBody.Body);
        Assert.Null(withoutBody.Body);
        Assert.Equal((1L, enqueued, "rejected", "order", 7L, true),
            (withoutBody.SequenceNumber, withoutBody.EnqueuedTime, withoutBody.DeadLetterReason, withoutBody.Subject, withoutBody.SizeInBytes, withoutBody.IsDeadLettered));
        Assert.Equal((withBody.SequenceNumber, withBody.EnqueuedTime, withBody.DeadLetterReason, withBody.Subject, withBody.SizeInBytes),
            (withoutBody.SequenceNumber, withoutBody.EnqueuedTime, withoutBody.DeadLetterReason, withoutBody.Subject, withoutBody.SizeInBytes));
    }

    private const string ResubmitSendUnknown =
        "Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: the send failed and the broker may have accepted it.";
    private const string MoveSendUnknown =
        "Message was moved to the target but could not be removed from the source and may be duplicated: the send failed and the broker may have accepted it.";

    /// <summary>A message batch that holds at most <paramref name="capacity"/> messages.</summary>
    private static ServiceBusMessageBatch BatchHolding(int capacity)
    {
        var store = new List<ServiceBusMessage>();
        return ServiceBusModelFactory.ServiceBusMessageBatch(long.MaxValue, store, new CreateMessageBatchOptions(), _ => store.Count < capacity);
    }

    /// <summary>A sender whose batches hold two messages and whose batch sends answer, in order, as <paramref name="sends"/> says.</summary>
    private static Mock<ServiceBusSender> SenderOfPairs(params Exception?[] sends)
    {
        var answers = new Queue<Exception?>(sends);
        var sender = new Mock<ServiceBusSender>();
        sender.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>())).Returns(() => new ValueTask<ServiceBusMessageBatch>(BatchHolding(2)));
        sender.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(() => answers.Dequeue() is { } error ? Task.FromException(error) : Task.CompletedTask);
        return sender;
    }

    private static Task<BatchOperationResult> ResubmitOrMove(string operation, Mock<ServiceBusReceiver> receiver, Mock<ServiceBusSender> sender, long[] sequenceNumbers) =>
        operation == "resubmit"
            ? AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, sequenceNumbers, CancellationToken.None)
            : AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, sequenceNumbers, CancellationToken.None);

    [Theory]
    [InlineData("resubmit", ResubmitSendUnknown)]
    [InlineData("move", MoveSendUnknown)]
    public async Task A_resubmit_or_move_whose_second_send_times_out_reports_both_sends_as_possible_duplicates_and_nothing_as_not_found(string operation, string duplicate)
    {
        var receiver = ReceiverFailingAfter([Batch(Msg(1), Msg(2), Msg(3), Msg(4))], Broker(ServiceBusFailureReason.ServiceTimeout));
        var sender = SenderOfPairs(null, Broker(ServiceBusFailureReason.ServiceTimeout));

        var result = await ResubmitOrMove(operation, receiver, sender, [1, 2, 3, 4]);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal(new[] { (1L, duplicate), (2L, duplicate), (3L, duplicate), (4L, duplicate) },
            result.Failures.Select(f => (f.SequenceNumber, f.Error)).OrderBy(f => f.SequenceNumber).ToArray());
        receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("resubmit", ResubmitSendUnknown)]
    [InlineData("move", MoveSendUnknown)]
    public async Task A_resubmit_or_move_whose_first_send_throws_reports_its_messages_as_possible_duplicates(string operation, string duplicate)
    {
        var receiver = ReceiverFailingAfter([Batch(Msg(1), Msg(2))], Broker(ServiceBusFailureReason.ServiceTimeout));
        var sender = SenderOfPairs(Broker(ServiceBusFailureReason.ServiceTimeout));

        var result = await ResubmitOrMove(operation, receiver, sender, [1, 2]);

        Assert.Equal((0, 2), (result.SuccessCount, result.FailureCount));
        Assert.All(result.Failures, f => Assert.Equal(duplicate, f.Error));
        Assert.Equal(new long[] { 1, 2 }, result.Failures.Select(f => f.SequenceNumber).Order().ToArray());
    }

    [Theory]
    [InlineData("resubmit", ResubmitSendUnknown)]
    [InlineData("move", MoveSendUnknown)]
    public async Task A_target_never_handed_to_a_send_after_a_send_failed_is_reported_not_found_and_only_it(string operation, string duplicate)
    {
        var receiver = ReceiverFailingAfter([Batch(Msg(1), Msg(2), Msg(3))], Broker(ServiceBusFailureReason.ServiceTimeout));
        var sender = SenderOfPairs(Broker(ServiceBusFailureReason.ServiceTimeout));

        var result = await ResubmitOrMove(operation, receiver, sender, [1, 2, 3]);

        Assert.Equal(new[] { (1L, duplicate), (2L, duplicate), (3L, "Not found within scan window") },
            result.Failures.Select(f => (f.SequenceNumber, f.Error)).OrderBy(f => f.SequenceNumber).ToArray());
    }

    [Theory]
    [InlineData("resubmit", ResubmitSendUnknown)]
    [InlineData("move", MoveSendUnknown)]
    public async Task A_resubmit_or_move_whose_second_send_is_refused_as_disabled_reports_only_the_first_send_as_possible_duplicates(string operation, string duplicate)
    {
        var receiver = ReceiverFailingAfter([Batch(Msg(1), Msg(2), Msg(3), Msg(4))], Broker(ServiceBusFailureReason.ServiceTimeout));
        var sender = SenderOfPairs(null, Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        var result = await ResubmitOrMove(operation, receiver, sender, [1, 2, 3, 4]);

        Assert.Equal(new[] { (1L, duplicate), (2L, duplicate), (3L, Disabled), (4L, Disabled) },
            result.Failures.Select(f => (f.SequenceNumber, f.Error)).OrderBy(f => f.SequenceNumber).ToArray());
    }
}
