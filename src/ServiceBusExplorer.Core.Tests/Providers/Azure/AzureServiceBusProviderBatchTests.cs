using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Moq;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
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

    // A mocked receiver has no AMQP link, so the server-side purge fails and the
    // drain must fall back to the receive loop instead of surfacing the error.
    [Fact]
    public async Task TryPurgeServerSide_returns_null_when_unsupported()
    {
        var receiver = BuildReceiver(Array.Empty<IReadOnlyList<ServiceBusReceivedMessage>>());

        var purged = await AzureServiceBusProvider.TryPurgeServerSideAsync(receiver.Object, CancellationToken.None);

        Assert.Null(purged);
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

    [Fact]
    public async Task ResubmitCore_reports_not_found_for_target_beyond_window_and_terminates()
    {
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

        var result = await AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, new long[] { 1, 999 }, CancellationToken.None);

        Assert.Equal(1, result.SuccessCount);
        var failure = Assert.Single(result.Failures);
        Assert.Equal((999L, "Not found within scan window"), (failure.SequenceNumber, failure.Error));
    }

    [Fact]
    public async Task ResubmitCore_throws_when_caller_token_is_already_cancelled_and_sends_nothing()
    {
        var targets = new long[] { 1, 2 };
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>> { targets.Select(Msg).ToList() });
        var sender = new Mock<ServiceBusSender>();

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, targets, cts.Token));
        sender.Verify(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DrainAll_throws_when_caller_token_is_already_cancelled_and_receives_nothing()
    {
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>> { new[] { Msg(1) } });

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => AzureServiceBusProvider.DrainAllAsync(receiver.Object, cts.Token));
        receiver.Verify(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeleteMessagesCore_throws_when_caller_token_is_already_cancelled_and_completes_nothing()
    {
        var targets = new long[] { 1, 2 };
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>> { targets.Select(Msg).ToList() });

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, targets, cts.Token));
        receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private const string DuplicateDetectionRefusal = "The target detects duplicates; a copy with the same message id would be dropped. Nothing was sent or removed.";
    private const string DeliveryLimitNotReached = "Not reached: going on would have sent unselected messages past their max delivery count into the dead-letter queue. Nothing was sent or removed.";
    private const string SettingsUnreadable = "The settings of the entity could not be read; the connection needs the Manage right for this. Nothing was sent or removed.";

    private static ServiceBusReceivedMessage Msg(long sequenceNumber, int deliveryCount, string? messageId = null, IDictionary<string, object>? properties = null) =>
        ServiceBusModelFactory.ServiceBusReceivedMessage(
            body: BinaryData.FromString($"body-{sequenceNumber}"),
            messageId: messageId,
            properties: properties,
            sequenceNumber: sequenceNumber,
            deliveryCount: deliveryCount);

    private static Task<Response<T>> Ok<T>(T value) => Task.FromResult(Response.FromValue(value, Mock.Of<Response>()));

    private static QueueProperties Queue(string name, bool requiresDuplicateDetection, int maxDeliveryCount) =>
        ServiceBusModelFactory.QueueProperties(
            name: name, lockDuration: TimeSpan.FromSeconds(30), maxSizeInMegabytes: 1024,
            requiresDuplicateDetection: requiresDuplicateDetection, requiresSession: false,
            defaultMessageTimeToLive: TimeSpan.FromDays(1), autoDeleteOnIdle: TimeSpan.MaxValue,
            deadLetteringOnMessageExpiration: false, duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            maxDeliveryCount: maxDeliveryCount, enableBatchedOperations: true, status: EntityStatus.Active,
            forwardTo: null, forwardDeadLetteredMessagesTo: null, userMetadata: "", enablePartitioning: false,
            maxMessageSizeInKilobytes: 256);

    /// <summary>
    /// A provider connected to a namespace that cannot resolve, whose administration client is the supplied mock: a
    /// call that went past its settings check would try that namespace and fail in another way than the one asserted.
    /// </summary>
    private static async Task<AzureServiceBusProvider> ProviderWithAdmin(Mock<ServiceBusAdministrationClient> admin)
    {
        var provider = new AzureServiceBusProvider();
        await provider.ConnectAsync(new AzureConnectionConfig
        {
            Name = "cs",
            AuthType = AzureAuthType.ConnectionString,
            ConnectionString = "Endpoint=sb://unreachable.invalid/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        });
        provider.UseAdministrationClient(admin.Object);
        return provider;
    }

    private static Mock<ServiceBusAdministrationClient> AdminWith(params QueueProperties[] queues)
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        foreach (var queue in queues)
            admin.Setup(a => a.GetQueueAsync(queue.Name, It.IsAny<CancellationToken>())).Returns(Ok(queue));
        return admin;
    }

    private static void AssertRefusedEach(BatchOperationResult result, string error, string because)
    {
        Assert.True(result.Failures.Select(f => (f.SequenceNumber, f.Error)).SequenceEqual([(1L, error), (2L, error)]),
            $"{because} Failures were: {string.Join("; ", result.Failures.Select(f => $"{f.SequenceNumber}: {f.Error}"))}");
        Assert.Equal((0, 2, 0), (result.SuccessCount, result.FailureCount, result.UnselectedDeliveryCountRaised));
    }

    [Fact]
    public async Task A_resubmit_or_move_into_a_target_that_detects_duplicates_refuses_every_message_and_receives_nothing()
    {
        await using var provider = await ProviderWithAdmin(AdminWith(Queue("orders", true, 10), Queue("archive", true, 10)));

        var resubmitted = await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 2]);
        var moved = await provider.MoveMessagesAsync("orders", "archive", [1, 2]);

        AssertRefusedEach(resubmitted, DuplicateDetectionRefusal, "A copy with the original id into a duplicate-detecting target is refused per message before anything is received.");
        AssertRefusedEach(moved, DuplicateDetectionRefusal, "A move into a duplicate-detecting target is refused per message before anything is received.");
    }

    [Fact]
    public async Task An_administration_read_that_fails_refuses_every_message_of_a_delete_resubmit_or_move_and_sends_nothing()
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetQueueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<QueueProperties>>(new ServiceBusException("broker said no", ServiceBusFailureReason.ServiceTimeout)));
        await using var provider = await ProviderWithAdmin(admin);

        var deleted = await provider.DeleteMessagesAsync("orders", [1, 2]);
        var resubmitted = await provider.ResubmitDeadLetterMessagesAsync("orders", [1, 2]);
        var moved = await provider.MoveMessagesAsync("orders", "archive", [1, 2], MessageSubQueue.DeadLetter);

        AssertRefusedEach(deleted, SettingsUnreadable, "A delete whose settings cannot be read reports each message and removes nothing.");
        AssertRefusedEach(resubmitted, SettingsUnreadable, "A resubmit whose settings cannot be read reports each message and sends nothing.");
        AssertRefusedEach(moved, SettingsUnreadable, "A move whose settings cannot be read reports each message and sends nothing.");
        Assert.DoesNotContain(deleted.Failures.Concat(resubmitted.Failures).Concat(moved.Failures), f => f.Error.Contains("broker said no"));
    }

    [Fact]
    public async Task A_caller_cancellation_during_the_settings_read_propagates_instead_of_being_reported()
    {
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetQueueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromCanceled<Response<QueueProperties>>(cancelled.Token));
        await using var provider = await ProviderWithAdmin(admin);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => provider.DeleteMessagesAsync("orders", [1, 2], cancellationToken: cancelled.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => provider.MoveMessagesAsync("orders", "archive", [1, 2], cancellationToken: cancelled.Token));
    }

    [Fact]
    public async Task A_delete_or_move_on_an_active_entity_with_a_max_delivery_count_of_1_is_refused_before_any_receive()
    {
        await using var provider = await ProviderWithAdmin(AdminWith(Queue("orders", false, 1), Queue("archive", false, 10)));

        var deleted = await provider.DeleteMessagesAsync("orders", [1, 2]);
        var moved = await provider.MoveMessagesAsync("orders", "archive", [1, 2]);

        AssertRefusedEach(deleted, DeliveryLimitNotReached, "With one delivery allowed, receiving any unselected message would dead-letter it, so the delete is refused.");
        AssertRefusedEach(moved, DeliveryLimitNotReached, "With one delivery allowed, receiving any unselected message would dead-letter it, so the move is refused.");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_resubmit_or_move_with_new_ids_sends_each_copy_with_a_new_id_keeps_the_first_original_and_reports_it(bool move)
    {
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            new[] { Msg(1, 1, "order-1"), Msg(2, 1, "order-2-copy", new Dictionary<string, object> { ["x-original-message-id"] = "order-2" }) }
        });
        var sent = new List<ServiceBusMessage>();
        var sender = new Mock<ServiceBusSender>();
        sender.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(ServiceBusModelFactory.ServiceBusMessageBatch(long.MaxValue, sent, new CreateMessageBatchOptions(), _ => true)));
        sender.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = move
            ? await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, [1, 2], CancellationToken.None, maxDeliveryCount: null, newMessageIds: true)
            : await AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, [1, 2], CancellationToken.None, newMessageIds: true);

        Assert.Equal((2, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(["order-1", "order-2"], sent.Select(m => (string)m.ApplicationProperties["x-original-message-id"]));
        Assert.Equal(new Dictionary<long, string> { [1] = sent[0].MessageId, [2] = sent[1].MessageId }, result.NewMessageIds);
        Assert.True(sent.All(m => m.MessageId is not ("order-1" or "order-2-copy")), "Each copy into a duplicate-detecting target must carry a new message id, or the broker drops it.");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_new_id_is_reported_only_for_a_message_handed_to_a_send_never_for_one_a_failed_flush_left_unsent(bool move)
    {
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            new[] { Msg(1, 1, "order-1"), Msg(2, 1, "order-2"), Msg(3, 1, "order-3") }
        });
        var sender = new Mock<ServiceBusSender>();
        sender.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>())).Returns(() =>
        {
            var store = new List<ServiceBusMessage>();
            return new ValueTask<ServiceBusMessageBatch>(ServiceBusModelFactory.ServiceBusMessageBatch(long.MaxValue, store, new CreateMessageBatchOptions(), _ => store.Count == 0));
        });
        sender.SetupSequence(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask)
            .Throws(new ServiceBusException("flush failed", ServiceBusFailureReason.ServiceTimeout));

        var result = move
            ? await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, [1, 2, 3], CancellationToken.None, maxDeliveryCount: null, newMessageIds: true)
            : await AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, [1, 2, 3], CancellationToken.None, newMessageIds: true);

        Assert.True(result.NewMessageIds.Keys.Order().SequenceEqual([1L, 2L]),
            $"Only a message handed to a send may be listed with a new id; message 3 never reached one. Listed: {string.Join(", ", result.NewMessageIds.Keys)}; failures: {string.Join("; ", result.Failures.Select(f => $"{f.SequenceNumber}: {f.Error}"))}");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_delete_or_move_on_an_active_entity_stops_before_receiving_again_an_unselected_message_at_its_limit_and_reports_the_rest_not_reached(bool move)
    {
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            new[] { Msg(10, 2), Msg(11, 3), Msg(1, 1) },
            new[] { Msg(2, 1) }
        });
        var sender = new Mock<ServiceBusSender>();
        sender.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>())).Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = move
            ? await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, [1, 2], CancellationToken.None, maxDeliveryCount: 3)
            : await AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, [1, 2], CancellationToken.None, maxDeliveryCount: 3);

        Assert.Equal(1, result.SuccessCount);
        Assert.Equal([(2L, DeliveryLimitNotReached)], result.Failures.Select(f => (f.SequenceNumber, f.Error)));
        Assert.True(result.UnselectedDeliveryCountRaised == 2, "The result says how many unselected messages had their delivery count raised by the scan.");
        Assert.True(result.UnselectedDeadLettered.SequenceEqual([11L]), "An unselected message received at its last delivery is reported as dead-lettered, never silently.");
        receiver.Verify(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()), Times.Once());
    }

    [Fact]
    public async Task A_delete_on_an_active_entity_keeps_scanning_while_another_receive_stays_below_the_limit()
    {
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>>
        {
            new[] { Msg(10, 1), Msg(1, 1) },
            new[] { Msg(10, 2), Msg(2, 1) }
        });

        var result = await AzureServiceBusProvider.DeleteMessagesCoreAsync(receiver.Object, [1, 2], CancellationToken.None, maxDeliveryCount: 4);

        Assert.True((result.SuccessCount, result.FailureCount) == (2, 0),
            $"A scan stops only when receiving an unselected message again would reach its limit; it was ({result.SuccessCount}, {result.FailureCount}).");
        Assert.Equal(1, result.UnselectedDeliveryCountRaised);
        Assert.Empty(result.UnselectedDeadLettered);
    }

    [Fact]
    public async Task A_resubmit_from_a_subscription_whose_topic_detects_duplicates_is_refused_and_receives_nothing()
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetTopicAsync("events", It.IsAny<CancellationToken>())).Returns(Ok(ServiceBusModelFactory.TopicProperties(
            name: "events", maxSizeInMegabytes: 1024, requiresDuplicateDetection: true, defaultMessageTimeToLive: TimeSpan.FromDays(1),
            autoDeleteOnIdle: TimeSpan.MaxValue, duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            enableBatchedOperations: true, status: EntityStatus.Active, enablePartitioning: false)));
        await using var provider = await ProviderWithAdmin(admin);

        var resubmitted = await provider.ResubmitDeadLetterMessagesAsync("events", [1, 2], subscriptionName: "audit");

        AssertRefusedEach(resubmitted, DuplicateDetectionRefusal, "A resubmit from a subscription goes to its topic, so the topic's duplicate detection refuses it.");
    }

    [Fact]
    public async Task A_delete_from_an_active_subscription_with_a_max_delivery_count_of_1_is_refused_before_any_receive()
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetSubscriptionAsync("events", "audit", It.IsAny<CancellationToken>())).Returns(Ok(ServiceBusModelFactory.SubscriptionProperties(
            topicName: "events", subscriptionName: "audit", lockDuration: TimeSpan.FromSeconds(30), requiresSession: false,
            defaultMessageTimeToLive: TimeSpan.FromDays(1), autoDeleteOnIdle: TimeSpan.MaxValue, deadLetteringOnMessageExpiration: false,
            maxDeliveryCount: 1, enableBatchedOperations: true, status: EntityStatus.Active, forwardTo: null,
            forwardDeadLetteredMessagesTo: null, userMetadata: "")));
        await using var provider = await ProviderWithAdmin(admin);

        var deleted = await provider.DeleteMessagesAsync("events", [1, 2], subscriptionName: "audit");

        AssertRefusedEach(deleted, DeliveryLimitNotReached, "The delivery limit of a subscription is its own, read before any receive.");
    }

    private static Mock<ServiceBusReceiver> SettlingReceiver(Exception? settleFailure = null)
    {
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>> { new[] { Msg(1, 1), Msg(2, 1), Msg(3, 1) } });
        receiver.Setup(r => r.DeadLetterMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(settleFailure is null ? Task.CompletedTask : Task.FromException(settleFailure));
        receiver.Setup(r => r.DeferMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()))
            .Returns(settleFailure is null ? Task.CompletedTask : Task.FromException(settleFailure));
        return receiver;
    }

    [Fact]
    public async Task A_single_active_dead_letter_dead_letters_only_its_message_with_the_reason_and_abandons_the_others()
    {
        var receiver = SettlingReceiver();

        var result = await AzureServiceBusProvider.DeadLetterActiveCoreAsync(receiver.Object, [2], "Poison", "Bad schema", CancellationToken.None, maxDeliveryCount: 10);

        Assert.True((result.SuccessCount, result.FailureCount) == (1, 0), $"The one message asked for is dead-lettered; it was ({result.SuccessCount}, {result.FailureCount}).");
        receiver.Verify(r => r.DeadLetterMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 2), "Poison", "Bad schema", It.IsAny<CancellationToken>()), Times.Once());
        receiver.Verify(r => r.DeadLetterMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber != 2), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never());
        receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never());
        receiver.Verify(r => r.AbandonMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 1 || m.SequenceNumber == 3), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
        Assert.True(result.UnselectedDeliveryCountRaised == 2, "The unselected messages the scan received and released are counted in the report.");
    }

    [Fact]
    public async Task A_single_active_defer_defers_only_its_message_and_removes_nothing()
    {
        var receiver = SettlingReceiver();

        var result = await AzureServiceBusProvider.DeferActiveCoreAsync(receiver.Object, [3], CancellationToken.None, maxDeliveryCount: 10);

        Assert.True((result.SuccessCount, result.FailureCount) == (1, 0), $"The one message asked for is deferred; it was ({result.SuccessCount}, {result.FailureCount}).");
        receiver.Verify(r => r.DeferMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 3), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()), Times.Once());
        receiver.Verify(r => r.DeferMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber != 3), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()), Times.Never());
        receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never());
    }

    [Fact]
    public async Task A_dead_letter_without_a_reason_writes_the_default_reason_and_description()
    {
        var receiver = SettlingReceiver();

        await AzureServiceBusProvider.DeadLetterActiveCoreAsync(receiver.Object, [1], null, null, CancellationToken.None);

        receiver.Verify(r => r.DeadLetterMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 1), "Manual dead letter", "Moved to dead letter by user", It.IsAny<CancellationToken>()), Times.Once());
    }

    [Theory]
    [InlineData(false, "The broker did not dead-letter this message.")]
    [InlineData(true, "The broker did not defer this message.")]
    public async Task A_dead_letter_or_defer_the_broker_refuses_is_reported_for_its_sequence_number_with_a_fixed_text(bool defer, string expected)
    {
        var receiver = SettlingReceiver(new ServiceBusException("broker said no", ServiceBusFailureReason.MessageLockLost));

        var result = defer
            ? await AzureServiceBusProvider.DeferActiveCoreAsync(receiver.Object, [2], CancellationToken.None)
            : await AzureServiceBusProvider.DeadLetterActiveCoreAsync(receiver.Object, [2], "r", "d", CancellationToken.None);

        Assert.True(result.Failures.Select(f => (f.SequenceNumber, f.Error)).SequenceEqual([(2L, expected)]),
            $"A failed settle is reported for its sequence number with a fixed text, never the broker's. Failures were: {string.Join("; ", result.Failures.Select(f => $"{f.SequenceNumber}: {f.Error}"))}");
        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_dead_letter_or_defer_of_a_message_not_in_the_scan_window_is_reported_not_found_never_silently(bool defer)
    {
        var receiver = SettlingReceiver();

        var result = defer
            ? await AzureServiceBusProvider.DeferActiveCoreAsync(receiver.Object, [999], CancellationToken.None)
            : await AzureServiceBusProvider.DeadLetterActiveCoreAsync(receiver.Object, [999], null, null, CancellationToken.None);

        Assert.True(result.Failures.Select(f => (f.SequenceNumber, f.Error)).SequenceEqual([(999L, "Not found within scan window")]),
            "A sequence number the scan did not find is reported as not found within the scan window, never left out.");
        Assert.Equal((0, 1), (result.SuccessCount, result.FailureCount));
    }

    [Fact]
    public async Task A_dead_letter_or_defer_stops_before_an_unselected_message_reaches_its_max_delivery_count()
    {
        var receiver = BuildReceiver(new List<IReadOnlyList<ServiceBusReceivedMessage>> { new[] { Msg(10, 2) }, new[] { Msg(1, 1) } });
        receiver.Setup(r => r.DeferMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await AzureServiceBusProvider.DeferActiveCoreAsync(receiver.Object, [1], CancellationToken.None, maxDeliveryCount: 3);

        Assert.True(result.Failures.Select(f => (f.SequenceNumber, f.Error)).SequenceEqual([(1L, DeliveryLimitNotReached)]),
            "The defer keeps the delivery-limit guard of the delete: it stops and reports the target not reached.");
        receiver.Verify(r => r.DeferMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()), Times.Never());
    }

    [Fact]
    public async Task A_dead_letter_or_defer_on_an_entity_with_a_max_delivery_count_of_1_or_unreadable_settings_is_refused_before_any_receive()
    {
        await using var limited = await ProviderWithAdmin(AdminWith(Queue("orders", false, 1)));
        var unreadableAdmin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        unreadableAdmin.Setup(a => a.GetQueueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<QueueProperties>>(new ServiceBusException("broker said no", ServiceBusFailureReason.ServiceTimeout)));
        await using var unreadable = await ProviderWithAdmin(unreadableAdmin);

        AssertRefusedEach(await limited.DeadLetterMessagesAsync("orders", [1, 2], reason: "r"), DeliveryLimitNotReached, "With one delivery allowed, the dead-letter scan is refused before it receives.");
        AssertRefusedEach(await limited.DeferMessagesAsync("orders", [1, 2]), DeliveryLimitNotReached, "With one delivery allowed, the defer scan is refused before it receives.");
        AssertRefusedEach(await unreadable.DeadLetterMessagesAsync("orders", [1, 2]), SettingsUnreadable, "A dead-letter whose settings cannot be read reports each message and changes nothing.");
        AssertRefusedEach(await unreadable.DeferMessagesAsync("orders", [1, 2]), SettingsUnreadable, "A defer whose settings cannot be read reports each message and changes nothing.");
    }
}
