using Azure.Messaging.ServiceBus;
using Moq;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// Unit tests for the batch delete / resubmit cores. They exercise the message-handling
/// logic directly against mocked <see cref="ServiceBusReceiver"/> / <see cref="ServiceBusSender"/>
/// instances, so no real Service Bus connection is involved.
/// </summary>
public class AzureServiceBusProviderBatchTests
{
    private static ServiceBusReceivedMessage Msg(long sequenceNumber) =>
        ServiceBusModelFactory.ServiceBusReceivedMessage(
            body: BinaryData.FromString($"body-{sequenceNumber}"),
            sequenceNumber: sequenceNumber);

    private static ServiceBusException LockLost() =>
        new("The lock supplied is invalid.", ServiceBusFailureReason.MessageLockLost);

    /// <summary>
    /// Builds a receiver whose ReceiveMessagesAsync returns the supplied batches in order,
    /// then empty batches forever. CompleteMessageAsync / AbandonMessageAsync succeed unless
    /// a failing predicate is supplied.
    /// </summary>
    private static Mock<ServiceBusReceiver> BuildReceiver(
        IEnumerable<IReadOnlyList<ServiceBusReceivedMessage>> batches,
        Func<long, Exception?>? completeBehaviour = null)
    {
        var queue = new Queue<IReadOnlyList<ServiceBusReceivedMessage>>(batches);
        var receiver = new Mock<ServiceBusReceiver>();

        receiver
            .Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => queue.Count > 0 ? queue.Dequeue() : Array.Empty<ServiceBusReceivedMessage>());

        receiver
            .Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .Returns((ServiceBusReceivedMessage m, CancellationToken _) =>
            {
                var ex = completeBehaviour?.Invoke(m.SequenceNumber);
                return ex is null ? Task.CompletedTask : Task.FromException(ex);
            });

        receiver
            .Setup(r => r.AbandonMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        return receiver;
    }

    private static ServiceBusMessageBatch NewTestBatch() =>
        ServiceBusModelFactory.ServiceBusMessageBatch(
            batchSizeBytes: long.MaxValue,
            batchMessageStore: new List<ServiceBusMessage>(),
            batchOptions: new CreateMessageBatchOptions(),
            tryAddCallback: _ => true);

    // Test 1: all targets found across many small receive batches (the case that failed
    // against the old 10-attempt cap — here 40 targets arrive 3 per call, ~14 rounds).
    [Fact]
    public async Task DeleteMessagesCore_finds_all_targets_across_many_small_batches()
    {
        var targets = Enumerable.Range(1, 40).Select(i => (long)i).ToArray();
        var batches = targets
            .Chunk(3)
            .Select(chunk => (IReadOnlyList<ServiceBusReceivedMessage>)chunk.Select(Msg).ToList())
            .ToList();

        var receiver = BuildReceiver(batches);

        var result = await AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, targets, CancellationToken.None);

        Assert.Equal(40, result.SuccessCount);
        Assert.Equal(0, result.FailureCount);
        Assert.True(result.Success);
        // More than 10 receive rounds were required; the old attempt-capped loop could not reach this.
        receiver.Verify(
            r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()),
            Times.AtLeast(14));
    }

    // Test 2: CompleteMessageAsync throws MessageLockLost for one message -> the failure
    // carries the real reason, not a blanket "not found".
    [Fact]
    public async Task DeleteMessagesCore_records_real_error_when_complete_fails()
    {
        var targets = new long[] { 1, 2, 3, 4, 5 };
        var batches = new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            targets.Select(Msg).ToList()
        };

        var receiver = BuildReceiver(batches, completeBehaviour: seq => seq == 3 ? LockLost() : null);

        var result = await AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, targets, CancellationToken.None);

        Assert.Equal(4, result.SuccessCount);
        Assert.Equal(1, result.FailureCount);
        var failure = Assert.Single(result.Failures);
        Assert.Equal(3, failure.SequenceNumber);
        Assert.Contains("lock", failure.Error, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Not found", failure.Error);
    }

    // Test 3: a target beyond the scan window is reported with the distinct not-found error
    // and the loop terminates (no infinite loop) via the empty-batch guard.
    [Fact]
    public async Task DeleteMessagesCore_reports_not_found_for_target_beyond_window_and_terminates()
    {
        var targets = new long[] { 1, 999 };
        var batches = new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            new[] { Msg(1), Msg(2), Msg(3) }
        };

        var receiver = BuildReceiver(batches);

        var result = await AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, targets, CancellationToken.None);

        Assert.Equal(1, result.SuccessCount);
        Assert.Equal(1, result.FailureCount);
        var failure = Assert.Single(result.Failures);
        Assert.Equal(999, failure.SequenceNumber);
        Assert.Equal("Not found within scan window", failure.Error);
    }

    // Test 4: the delete-all fast-path primitive drains every message across batches and
    // stops once the entity is empty.
    [Fact]
    public async Task DrainAll_drains_every_message_and_stops_when_empty()
    {
        var batches = new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            new[] { Msg(1), Msg(2), Msg(3), Msg(4), Msg(5) },
            new[] { Msg(6), Msg(7), Msg(8), Msg(9), Msg(10) },
            new[] { Msg(11), Msg(12), Msg(13) }
        };

        var receiver = BuildReceiver(batches);

        var drained = await AzureServiceBusProvider.DrainAllAsync(receiver.Object, CancellationToken.None);

        Assert.Equal(13, drained);
    }

    // Test 5a: resubmit sends each cycle's messages before completing them.
    [Fact]
    public async Task ResubmitCore_sends_before_completing_each_cycle()
    {
        var targets = new long[] { 1, 2 };
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            targets.Select(Msg).ToList()
        });

        var operations = new List<string>();
        var sender = new Mock<ServiceBusSender>();
        sender
            .Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender
            .Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask)
            .Callback(() => operations.Add("send"));

        receiver
            .Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask)
            .Callback(() => operations.Add("complete"));

        var result = await AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, targets, CancellationToken.None);

        Assert.Equal(2, result.SuccessCount);
        Assert.Equal(0, result.FailureCount);
        Assert.Equal("send", operations.First());
        Assert.All(operations.Skip(1), op => Assert.Equal("complete", op));
    }

    // Test 5b: when the complete fails after a successful send, the message is reported as a
    // possible duplicate and is never resent.
    [Fact]
    public async Task ResubmitCore_records_duplicate_warning_and_does_not_resend_on_complete_failure()
    {
        var targets = new long[] { 1 };
        var receiver = BuildReceiver(
            new List<IReadOnlyList<ServiceBusReceivedMessage>> { new[] { Msg(1) } },
            completeBehaviour: _ => LockLost());

        var sender = new Mock<ServiceBusSender>();
        sender
            .Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender
            .Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, targets, CancellationToken.None);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal(1, result.FailureCount);
        var failure = Assert.Single(result.Failures);
        Assert.Equal(1, failure.SequenceNumber);
        Assert.Contains("duplicated", failure.Error, StringComparison.OrdinalIgnoreCase);

        // Sent exactly once, never re-sent as a single message either.
        sender.Verify(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()), Times.Once);
        sender.Verify(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // Test 6: empty sequence numbers return an empty result without throwing (public contract).
    [Fact]
    public async Task DeleteMessages_and_Resubmit_with_empty_input_return_empty_without_throw()
    {
        var provider = new AzureServiceBusProvider();
        await provider.ConnectAsync(new AzureConnectionConfig
        {
            Name = "cs",
            AuthType = AzureAuthType.ConnectionString,
            ConnectionString = "Endpoint=sb://legacy.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        });

        var deleteResult = await provider.DeleteMessagesAsync("queue", Array.Empty<long>());
        var resubmitResult = await provider.ResubmitDeadLetterMessagesAsync("queue", Array.Empty<long>());

        Assert.Equal(0, deleteResult.SuccessCount);
        Assert.Equal(0, deleteResult.FailureCount);
        Assert.Equal(0, resubmitResult.SuccessCount);
        Assert.Equal(0, resubmitResult.FailureCount);

        await provider.DisposeAsync();
    }

    // Test 7 (production-readiness failure path): a transient broker failure mid-scan yields a
    // partial result instead of an unhandled exception.
    [Fact]
    public async Task DeleteMessagesCore_returns_partial_result_on_transient_broker_failure()
    {
        var targets = new long[] { 1, 2, 3 };
        var receiver = new Mock<ServiceBusReceiver>();

        var calls = 0;
        receiver
            .Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()))
            .Returns(() =>
            {
                calls++;
                if (calls == 1)
                    return Task.FromResult((IReadOnlyList<ServiceBusReceivedMessage>)new[] { Msg(1) });
                throw new ServiceBusException("Operation timed out.", ServiceBusFailureReason.ServiceTimeout);
            });
        receiver
            .Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        receiver
            .Setup(r => r.AbandonMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, targets, CancellationToken.None);

        // Seq 1 completed before the failure; 2 and 3 are reported as not found — no throw.
        Assert.Equal(1, result.SuccessCount);
        Assert.Equal(2, result.FailureCount);
        Assert.All(result.Failures, f => Assert.Equal("Not found within scan window", f.Error));
    }

    // Test 8a: move finds all targets across many small receive batches (the case that failed
    // against the old 10-attempt cap — here 40 targets arrive 3 per call, ~14 rounds).
    [Fact]
    public async Task MoveCore_finds_all_targets_across_many_small_batches()
    {
        var targets = Enumerable.Range(1, 40).Select(i => (long)i).ToArray();
        var batches = targets
            .Chunk(3)
            .Select(chunk => (IReadOnlyList<ServiceBusReceivedMessage>)chunk.Select(Msg).ToList())
            .ToList();

        var receiver = BuildReceiver(batches);
        var sender = new Mock<ServiceBusSender>();
        sender
            .Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender
            .Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, targets, CancellationToken.None);

        Assert.Equal(40, result.SuccessCount);
        Assert.Equal(0, result.FailureCount);
        Assert.True(result.Success);
        // More than 10 receive rounds were required; the old attempt-capped loop could not reach this.
        receiver.Verify(
            r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()),
            Times.AtLeast(14));
    }

    // Test 8b: move sends each cycle's messages before completing them.
    [Fact]
    public async Task MoveCore_sends_before_completing_each_cycle()
    {
        var targets = new long[] { 1, 2 };
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            targets.Select(Msg).ToList()
        });

        var operations = new List<string>();
        var sender = new Mock<ServiceBusSender>();
        sender
            .Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender
            .Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask)
            .Callback(() => operations.Add("send"));

        receiver
            .Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask)
            .Callback(() => operations.Add("complete"));

        var result = await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, targets, CancellationToken.None);

        Assert.Equal(2, result.SuccessCount);
        Assert.Equal(0, result.FailureCount);
        Assert.Equal("send", operations.First());
        Assert.All(operations.Skip(1), op => Assert.Equal("complete", op));
    }

    // Test 8c: when the complete fails after a successful send, the message is reported as a
    // possible duplicate and is never resent.
    [Fact]
    public async Task MoveCore_records_duplicate_warning_and_does_not_resend_on_complete_failure()
    {
        var targets = new long[] { 1 };
        var receiver = BuildReceiver(
            new List<IReadOnlyList<ServiceBusReceivedMessage>> { new[] { Msg(1) } },
            completeBehaviour: _ => LockLost());

        var sender = new Mock<ServiceBusSender>();
        sender
            .Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender
            .Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, targets, CancellationToken.None);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal(1, result.FailureCount);
        var failure = Assert.Single(result.Failures);
        Assert.Equal(1, failure.SequenceNumber);
        Assert.Contains("duplicated", failure.Error, StringComparison.OrdinalIgnoreCase);

        // Sent exactly once, never re-sent as a single message either.
        sender.Verify(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()), Times.Once);
        sender.Verify(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // Test 8d: a target beyond the scan window is reported with the distinct not-found error
    // and the loop terminates (no infinite loop) via the empty-batch guard.
    [Fact]
    public async Task MoveCore_reports_not_found_for_target_beyond_window_and_terminates()
    {
        var targets = new long[] { 1, 999 };
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            new[] { Msg(1), Msg(2), Msg(3) }
        });

        var sender = new Mock<ServiceBusSender>();
        sender
            .Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender
            .Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, targets, CancellationToken.None);

        Assert.Equal(1, result.SuccessCount);
        Assert.Equal(1, result.FailureCount);
        var failure = Assert.Single(result.Failures);
        Assert.Equal(999, failure.SequenceNumber);
        Assert.Equal("Not found within scan window", failure.Error);
    }

    // Test 8e (production-readiness failure path): a transient broker failure mid-scan yields a
    // partial result instead of an unhandled exception.
    [Fact]
    public async Task MoveCore_returns_partial_result_on_transient_broker_failure()
    {
        var targets = new long[] { 1, 2, 3 };
        var receiver = new Mock<ServiceBusReceiver>();

        var calls = 0;
        receiver
            .Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()))
            .Returns(() =>
            {
                calls++;
                if (calls == 1)
                    return Task.FromResult((IReadOnlyList<ServiceBusReceivedMessage>)new[] { Msg(1) });
                throw new ServiceBusException("Operation timed out.", ServiceBusFailureReason.ServiceTimeout);
            });
        receiver
            .Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        receiver
            .Setup(r => r.AbandonMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var sender = new Mock<ServiceBusSender>();
        sender
            .Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender
            .Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, targets, CancellationToken.None);

        // Seq 1 moved before the failure; 2 and 3 are reported as not found — no throw.
        Assert.Equal(1, result.SuccessCount);
        Assert.Equal(2, result.FailureCount);
        Assert.All(result.Failures, f => Assert.Equal("Not found within scan window", f.Error));
    }

    // Test 8f: empty sequence numbers return an empty result without throwing (public contract).
    [Fact]
    public async Task MoveMessages_with_empty_input_returns_empty_without_throw()
    {
        var provider = new AzureServiceBusProvider();
        await provider.ConnectAsync(new AzureConnectionConfig
        {
            Name = "cs",
            AuthType = AzureAuthType.ConnectionString,
            ConnectionString = "Endpoint=sb://legacy.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        });

        var moveResult = await provider.MoveMessagesAsync("queue", "target", Array.Empty<long>());

        Assert.Equal(0, moveResult.SuccessCount);
        Assert.Equal(0, moveResult.FailureCount);

        await provider.DisposeAsync();
    }

    // Test 8g: a pre-cancelled caller token propagates as OperationCanceledException rather than
    // being swallowed into a partial result (only the internal safety timeout is absorbed).
    [Fact]
    public async Task MoveCore_throws_when_caller_token_is_already_cancelled()
    {
        var targets = new long[] { 1, 2 };
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            targets.Select(Msg).ToList()
        });

        var sender = new Mock<ServiceBusSender>();
        sender
            .Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender
            .Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, targets, cts.Token));
    }
}
