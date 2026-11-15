using Azure.Messaging.ServiceBus;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The send of many messages against a mocked <see cref="ServiceBusSender"/> whose batches hold a fixed number of
/// messages: split into full batches, a message too large for an empty batch refused by its position, the count
/// sent when the broker fails or the caller cancels between batches.
/// </summary>
public class AzureServiceBusProviderSendBatchTests
{
    private const string Sentinel = "BROKER-DETAIL-SENTINEL";
    private const string Huge = "huge";

    private sealed class FakeSender
    {
        public Mock<ServiceBusSender> Mock { get; } = new();
        public List<List<string>> Sends { get; } = new();
        private List<ServiceBusMessage> _current = new();

        public FakeSender(int capacity, Func<int, Exception?>? sendFails = null)
        {
            Mock.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>())).Returns(() =>
            {
                var store = new List<ServiceBusMessage>();
                _current = store;
                return new ValueTask<ServiceBusMessageBatch>(ServiceBusModelFactory.ServiceBusMessageBatch(
                    batchSizeBytes: 1024,
                    batchMessageStore: store,
                    batchOptions: new CreateMessageBatchOptions(),
                    tryAddCallback: m => m.Body.ToString() != Huge && store.Count < capacity));
            });
            Mock.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
                .Returns(() =>
                {
                    var failure = sendFails?.Invoke(Sends.Count + 1);
                    if (failure is not null) return Task.FromException(failure);
                    Sends.Add(_current.Select(m => m.Body.ToString()).ToList());
                    return Task.CompletedTask;
                });
        }
    }

    private static List<ServiceBusMessage> Messages(params string[] bodies) => bodies.Select(b => new ServiceBusMessage(b)).ToList();

    private static List<(int, string)> Failures(SendMessagesResult result) => result.Failures.Select(f => (f.Index, f.Error)).ToList();

    [Fact]
    public async Task A_send_larger_than_one_batch_is_split_into_full_batches_and_every_message_is_sent_in_order()
    {
        var sender = new FakeSender(capacity: 3);

        var result = await AzureServiceBusProvider.SendInBatchesAsync(sender.Mock.Object, Messages("m0", "m1", "m2", "m3", "m4", "m5", "m6"), NullLogger.Instance, CancellationToken.None);

        Assert.True(
            result.SentCount == 7 && result.Success,
            $"A send larger than one batch must send every message; sent {result.SentCount}, failures {result.Failures.Count}.");
        Assert.Equal([["m0", "m1", "m2"], ["m3", "m4", "m5"], ["m6"]], sender.Sends);
    }

    [Fact]
    public async Task A_message_too_large_for_an_empty_batch_is_refused_by_its_position_never_sent_alone_and_the_others_are_sent()
    {
        var sender = new FakeSender(capacity: 3);

        var result = await AzureServiceBusProvider.SendInBatchesAsync(sender.Mock.Object, Messages("m0", Huge, "m2"), NullLogger.Instance, CancellationToken.None);

        Assert.True(
            Failures(result).SequenceEqual([(1, SendMessageFailure.TooLarge)]),
            "A message larger than one batch must be refused per message, by its position, never dropped in silence.");
        Assert.Equal(2, result.SentCount);
        Assert.Equal([["m0"], ["m2"]], sender.Sends);
        sender.Mock.Verify(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task The_broker_failing_on_the_second_batch_returns_the_count_sent_so_far_and_each_message_not_sent_without_its_text()
    {
        var sender = new FakeSender(capacity: 2, sendFails: n => n == 2
            ? new ServiceBusException(Sentinel, ServiceBusFailureReason.ServiceCommunicationProblem)
            : null);

        var result = await AzureServiceBusProvider.SendInBatchesAsync(sender.Mock.Object, Messages("m0", "m1", "m2", "m3", "m4"), NullLogger.Instance, CancellationToken.None);

        Assert.True(
            result.SentCount == 2,
            $"After the broker fails on the second batch the caller must get the count sent so far, 2; got {result.SentCount}.");
        Assert.Equal(
            [(2, SendMessageFailure.Unconfirmed), (3, SendMessageFailure.Unconfirmed), (4, SendMessageFailure.NotSent)],
            Failures(result));
        Assert.DoesNotContain(result.Failures, f => f.Error.Contains(Sentinel));
        Assert.Equal([["m0", "m1"]], sender.Sends);
        sender.Mock.Verify(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task The_caller_token_stops_the_send_between_batches_and_the_result_says_how_many_were_sent_before_the_stop()
    {
        using var cancel = new CancellationTokenSource();
        var sender = new FakeSender(capacity: 2);
        sender.Mock.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(() =>
            {
                cancel.Cancel();
                return Task.CompletedTask;
            });

        var result = await AzureServiceBusProvider.SendInBatchesAsync(sender.Mock.Object, Messages("m0", "m1", "m2", "m3", "m4"), NullLogger.Instance, cancel.Token);

        Assert.True(
            result.SentCount == 2 && Failures(result).SequenceEqual([(2, SendMessageFailure.NotSent), (3, SendMessageFailure.NotSent), (4, SendMessageFailure.NotSent)]),
            $"The caller's token must stop the send between batches, with the 2 sent before the stop kept; sent {result.SentCount}.");
        sender.Mock.Verify(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_failure_of_the_first_batch_propagates_as_it_was_since_nothing_was_sent()
    {
        var refused = new ServiceBusException(Sentinel, ServiceBusFailureReason.ServiceTimeout);
        var sender = new FakeSender(capacity: 2, sendFails: _ => refused);

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.SendInBatchesAsync(sender.Mock.Object, Messages("m0", "m1", "m2"), NullLogger.Instance, CancellationToken.None));

        Assert.Same(refused, error);
        Assert.Empty(sender.Sends);
    }
}
