using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
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
            Admin.Setup(a => a.GetQueueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((string name, CancellationToken _) => Response.FromValue(ServiceBusModelFactory.QueueProperties(
                    name: name, lockDuration: TimeSpan.FromSeconds(30), maxSizeInMegabytes: 1024, requiresDuplicateDetection: false,
                    requiresSession: false, defaultMessageTimeToLive: TimeSpan.FromDays(1), autoDeleteOnIdle: TimeSpan.MaxValue,
                    deadLetteringOnMessageExpiration: false, duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
                    maxDeliveryCount: 10, enableBatchedOperations: true, status: EntityStatus.Active, forwardTo: null,
                    forwardDeadLetteredMessagesTo: null, userMetadata: "", enablePartitioning: false, maxMessageSizeInKilobytes: 256), Mock.Of<Response>()));
            Admin.Setup(a => a.GetTopicAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((string name, CancellationToken _) => Response.FromValue(ServiceBusModelFactory.TopicProperties(
                    name: name, maxSizeInMegabytes: 1024, requiresDuplicateDetection: false, defaultMessageTimeToLive: TimeSpan.FromDays(1),
                    autoDeleteOnIdle: TimeSpan.MaxValue, duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
                    enableBatchedOperations: true, status: EntityStatus.Active, enablePartitioning: false), Mock.Of<Response>()));
        }

        /// <summary>Entity settings with no duplicate detection and a delivery limit of 10, as a bulk call reads them first.</summary>
        public Mock<ServiceBusAdministrationClient> Admin { get; } = new();

        public AzureServiceBusProvider Provider()
        {
            var provider = new AzureServiceBusProvider(Client.Object);
            provider.UseAdministrationClient(Admin.Object);
            return provider;
        }
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
    public void Azure_declares_the_transfer_dead_letter_queue_and_deferral()
    {
        var capabilities = new AzureServiceBusProvider().Capabilities;

        Assert.True((capabilities.SupportsTransferDeadLetter, capabilities.SupportsDeferral) == (true, true),
            "Azure handles deferred messages by sequence number, so it must declare deferral, and the transfer dead-letter queue.");
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

        var error = await Assert.ThrowsAsync<MessageReadFailedException>(() => broker.Provider().PeekMessagesAsync("orders", 10));

        Assert.Equal("The broker did not return the messages of this entity (ServiceTimeout).", error.Message);
        Assert.Equal(ServiceBusFailureReason.ServiceTimeout, Assert.IsType<ServiceBusException>(error.InnerException).Reason);
    }

    public static TheoryData<Exception, string> OtherPeekFailures => new()
    {
        { new UnauthorizedAccessException("Endpoint=sb://secret;SharedAccessKey=SENTINEL"), "not authorised: reading needs the Listen right, which the role Azure Service Bus Data Receiver or a key with that right gives, and the network rules of the namespace must accept this computer" },
        { new UnauthorizedAccessException("Unauthorized access. 'Listen' claim(s) are required to perform this operation. Resource: 'sb://SENTINEL'"), "not authorised: the broker says the Listen right is missing; the role Azure Service Bus Data Receiver, or a key with that right, gives it" },
        { new UnauthorizedAccessException("Ip has been prevented to connect to the endpoint SENTINEL"), "not authorised: the network rules of the namespace refuse this computer" },
        { new InvalidOperationException("the entity requires sessions SENTINEL"), "InvalidOperationException" },
        { new TimeoutException("SENTINEL"), "TimeoutException" },
        { new NotSupportedException("SENTINEL"), "NotSupportedException" },
    };

    [Theory]
    [InlineData("Unauthorized access. 'Send' claim(s) are required to perform this operation. SENTINEL", "the broker says the Send right is missing; the role Azure Service Bus Data Sender, or a key with that right, gives it")]
    [InlineData("Unauthorized access. 'Manage,EntityRead' claim(s) are required SENTINEL", "the broker says the Manage right is missing; the role Azure Service Bus Data Owner, or a key with that right, gives it")]
    [InlineData("a claim is required SENTINEL", "the broker says a right this operation needs is missing")]
    [InlineData("Public network access is disabled for the namespace SENTINEL", "the network rules of the namespace refuse this computer")]
    [InlineData("Put token failed. status-code: 401. Resource: 'sb://network-prod.example/firewall-events' SENTINEL", null)]
    [InlineData("SENTINEL", null)]
    public void A_refusal_is_told_apart_by_what_the_broker_names_and_never_carries_its_text(string brokerText, string? detail)
    {
        Assert.Equal(detail, BrokerRefusal.Detail(new UnauthorizedAccessException(brokerText)));
    }

    [Theory]
    [MemberData(nameof(OtherPeekFailures))]
    public async Task A_peek_that_fails_with_an_error_that_is_not_the_brokers_own_still_names_its_kind_and_never_its_text(Exception failure, string kind)
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>())).ThrowsAsync(failure);

        var error = await Assert.ThrowsAsync<MessageReadFailedException>(() => broker.Provider().PeekMessagesAsync("orders", 10));

        Assert.Equal($"The broker did not return the messages of this entity ({kind}).", error.Message);
        Assert.Same(failure, error.InnerException);
    }

    [Fact]
    public async Task A_peek_the_caller_cancels_is_a_cancellation_not_a_read_failure()
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>())).ThrowsAsync(new OperationCanceledException());

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => broker.Provider().PeekMessagesAsync("orders", 10));
    }

    [Fact]
    public async Task A_transfer_dead_letter_peek_whose_receiver_fails_gives_the_caller_the_broker_error_instead_of_an_empty_list()
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.ServiceCommunicationProblem));

        var error = await Assert.ThrowsAsync<MessageReadFailedException>(() =>
            broker.Provider().PeekMessagesAsync("orders", 10, MessageSubQueue.TransferDeadLetter));

        Assert.Equal("The broker did not return the messages of this entity (ServiceCommunicationProblem).", error.Message);
        Assert.Equal(ServiceBusFailureReason.ServiceCommunicationProblem, Assert.IsType<ServiceBusException>(error.InnerException).Reason);
    }

    [Theory]
    [InlineData("send")]
    [InlineData("send batch")]
    [InlineData("receive")]
    [InlineData("peek")]
    [InlineData("search")]
    [InlineData("schedule")]
    public async Task A_disabled_entity_answers_the_neutral_exception_with_the_fixed_text_on_every_single_message_path(string operation)
    {
        var broker = new FakeBroker();
        var disabled = Broker(ServiceBusFailureReason.MessagingEntityDisabled);
        broker.Sender.Setup(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>())).ThrowsAsync(disabled);
        broker.Sender.Setup(s => s.ScheduleMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<DateTimeOffset>(), It.IsAny<CancellationToken>())).ThrowsAsync(disabled);
        broker.Sender.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>())).ThrowsAsync(disabled);
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
            "schedule" => provider.SendMessageAsync("events", new SendMessageRequest { Body = "b", ScheduledEnqueueTime = DateTimeOffset.UtcNow.AddMinutes(10) }),
            _ => provider.SearchMessagesAsync("orders", new MessageSearchRequest { Query = "x" })
        });

        Assert.Equal("The entity is disabled for this operation.", error.Message);
        Assert.Same(disabled, error.InnerException);
    }

    private const string DuplicateDetectionRefusal = "The target detects duplicates; a copy with the same message id would be dropped. Nothing was sent or removed.";
    private const string SettingsUnreadable = "The settings of the entity could not be read; the connection needs the Manage right for this. Nothing was sent or removed.";

    private static QueueProperties DetectingQueue(string name) => ServiceBusModelFactory.QueueProperties(
        name: name, lockDuration: TimeSpan.FromSeconds(30), maxSizeInMegabytes: 1024, requiresDuplicateDetection: true,
        requiresSession: false, defaultMessageTimeToLive: TimeSpan.FromDays(1), autoDeleteOnIdle: TimeSpan.MaxValue,
        deadLetteringOnMessageExpiration: false, duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
        maxDeliveryCount: 10, enableBatchedOperations: true, status: EntityStatus.Active, forwardTo: null,
        forwardDeadLetteredMessagesTo: null, userMetadata: "", enablePartitioning: false, maxMessageSizeInKilobytes: 256);

    private static TopicProperties DetectingTopic(string name) => ServiceBusModelFactory.TopicProperties(
        name: name, maxSizeInMegabytes: 1024, requiresDuplicateDetection: true, defaultMessageTimeToLive: TimeSpan.FromDays(1),
        autoDeleteOnIdle: TimeSpan.MaxValue, duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
        enableBatchedOperations: true, status: EntityStatus.Active, enablePartitioning: false);

    /// <summary>A broker whose queue and topic named "orders" detect duplicates.</summary>
    private static FakeBroker DetectingBroker()
    {
        var broker = new FakeBroker();
        broker.Admin.Setup(a => a.GetQueueAsync("orders", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(DetectingQueue("orders"), Mock.Of<Response>()));
        broker.Admin.Setup(a => a.GetTopicAsync("orders", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(DetectingTopic("orders"), Mock.Of<Response>()));
        return broker;
    }

    private static void AssertNothingSentOrRemoved(FakeBroker broker, string because)
    {
        broker.Sender.Verify(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>()), Times.Never, because);
        broker.Receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never, because);
        Assert.True(broker.Receivers.Count == 0, $"{because} Receivers opened: {string.Join(", ", broker.Receivers)}");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("audit")]
    public async Task A_single_resubmit_into_a_queue_or_topic_that_detects_duplicates_is_refused_with_the_fixed_text_and_sends_and_removes_nothing(string? subscription)
    {
        var broker = DetectingBroker();
        broker.Receiver.Setup(r => r.PeekMessagesAsync(1, 7, It.IsAny<CancellationToken>())).ReturnsAsync(Batch(Msg(7)));

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            broker.Provider().ResubmitDeadLetterMessageAsync("orders", 7, subscription));

        Assert.True(error.Message == DuplicateDetectionRefusal,
            $"A single resubmit with the original id into a target that detects duplicates must be refused with the fixed text; it said: {error.Message}");
        AssertNothingSentOrRemoved(broker, "A refused single resubmit sends nothing and removes nothing from the dead-letter queue.");
    }

    [Fact]
    public async Task A_single_resubmit_whose_target_settings_cannot_be_read_is_refused_with_the_Manage_text_and_no_broker_text()
    {
        var broker = new FakeBroker();
        broker.Admin.Setup(a => a.GetQueueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ThrowsAsync(new ServiceBusException(Sentinel, ServiceBusFailureReason.ServiceTimeout));

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            broker.Provider().ResubmitDeadLetterMessageAsync("orders", 7));

        Assert.True(error.Message == SettingsUnreadable,
            $"A single resubmit that cannot read its target's settings must be refused with the Manage text; it said: {error.Message}");
        AssertNothingSentOrRemoved(broker, "A single resubmit that cannot read its target's settings sends nothing and removes nothing.");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("audit")]
    public async Task A_single_resubmit_with_a_new_id_into_a_target_that_detects_duplicates_sends_the_copy_with_a_new_id_keeps_the_original_and_completes_the_source(string? subscription)
    {
        var broker = DetectingBroker();
        var original = ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString("b"), messageId: "order-7", sequenceNumber: 7);
        broker.Receiver.Setup(r => r.PeekMessagesAsync(1, 7, It.IsAny<CancellationToken>())).ReturnsAsync(Batch(original));
        broker.Receiver.Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>())).ReturnsAsync(Batch(original));
        var sent = new List<ServiceBusMessage>();
        broker.Sender.Setup(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>()))
            .Callback((ServiceBusMessage m, CancellationToken _) => sent.Add(m)).Returns(Task.CompletedTask);

        await broker.Provider().ResubmitDeadLetterMessageAsync("orders", 7, subscription, newMessageIdOnDuplicateDetection: true);

        var copy = Assert.Single(sent);
        Assert.True(copy.MessageId != "order-7" && Guid.TryParse(copy.MessageId, out _),
            $"The copy must carry a new message id so the target does not drop it; it carried {copy.MessageId}");
        Assert.True(copy.ApplicationProperties.TryGetValue(AzureServiceBusProvider.OriginalMessageIdProperty, out var kept) && (string)kept == "order-7",
            "The copy must keep the original message id in x-original-message-id.");
        broker.Receiver.Verify(r => r.CompleteMessageAsync(original, It.IsAny<CancellationToken>()), Times.Once,
            "After the copy was sent, the original is completed in the dead-letter queue.");
    }

    [Theory]
    [InlineData("not found", "it was not found among the messages read to remove it.")]
    [InlineData("complete fails", "the lock on the message was lost.")]
    [InlineData("complete refused", "the broker refused it as not authorised.")]
    [InlineData("complete times out", "the broker did not answer in time.")]
    public async Task A_single_resubmit_that_sent_its_copy_and_could_not_remove_the_original_says_so_as_a_possible_duplicate_never_returns_in_silence(string how, string why)
    {
        var broker = DetectingBroker();
        var original = ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString("b"), messageId: "order-7", sequenceNumber: 7);
        var other = ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString("o"), messageId: "order-8", sequenceNumber: 8);
        broker.Receiver.Setup(r => r.PeekMessagesAsync(1, 7, It.IsAny<CancellationToken>())).ReturnsAsync(Batch(original));
        if (how == "not found")
        {
            broker.Receiver.SetupSequence(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Batch(other)).ReturnsAsync(Batch());
        }
        else
        {
            broker.Receiver.Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>())).ReturnsAsync(Batch(original));
            broker.Receiver.Setup(r => r.CompleteMessageAsync(original, It.IsAny<CancellationToken>())).ThrowsAsync(how switch
            {
                "complete refused" => new UnauthorizedAccessException("Listen claim(s) are required"),
                "complete times out" => new TimeoutException("no answer"),
                _ => Broker(ServiceBusFailureReason.MessageLockLost)
            });
        }

        var said = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            broker.Provider().ResubmitDeadLetterMessageAsync("orders", 7, newMessageIdOnDuplicateDetection: true));

        Assert.Equal($"Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: {why}", said.Message);
        broker.Sender.Verify(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_single_resubmit_that_removed_the_original_is_done_even_when_releasing_another_message_it_read_fails()
    {
        var broker = DetectingBroker();
        var original = ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString("b"), messageId: "order-7", sequenceNumber: 7);
        var other = ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString("o"), messageId: "order-8", sequenceNumber: 8);
        broker.Receiver.Setup(r => r.PeekMessagesAsync(1, 7, It.IsAny<CancellationToken>())).ReturnsAsync(Batch(original));
        broker.Receiver.Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>())).ReturnsAsync(Batch(other, original));
        broker.Receiver.Setup(r => r.AbandonMessageAsync(other, It.IsAny<IDictionary<string, object>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.MessageLockLost));

        await broker.Provider().ResubmitDeadLetterMessageAsync("orders", 7, newMessageIdOnDuplicateDetection: true);

        broker.Receiver.Verify(r => r.CompleteMessageAsync(original, It.IsAny<CancellationToken>()), Times.Once);
    }

    private static ServiceBusReceivedMessage Delivered(long sequenceNumber, int deliveryCount) =>
        ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString($"body-{sequenceNumber}"), messageId: $"order-{sequenceNumber}",
            sequenceNumber: sequenceNumber, deliveryCount: deliveryCount);

    [Fact]
    public async Task The_public_move_hands_the_core_the_new_ids_and_the_max_delivery_count_it_read()
    {
        var broker = new FakeBroker();
        broker.Admin.Setup(a => a.GetQueueAsync("orders", It.IsAny<CancellationToken>())).ReturnsAsync(Response.FromValue(ServiceBusModelFactory.QueueProperties(
            name: "orders", lockDuration: TimeSpan.FromSeconds(30), maxSizeInMegabytes: 1024, requiresDuplicateDetection: false,
            requiresSession: false, defaultMessageTimeToLive: TimeSpan.FromDays(1), autoDeleteOnIdle: TimeSpan.MaxValue,
            deadLetteringOnMessageExpiration: false, duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            maxDeliveryCount: 3, enableBatchedOperations: true, status: EntityStatus.Active, forwardTo: null,
            forwardDeadLetteredMessagesTo: null, userMetadata: "", enablePartitioning: false, maxMessageSizeInKilobytes: 256), Mock.Of<Response>()));
        broker.Admin.Setup(a => a.GetQueueAsync("archive", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(DetectingQueue("archive"), Mock.Of<Response>()));
        var cycles = new Queue<IReadOnlyList<ServiceBusReceivedMessage>>([Batch(Delivered(10, 2), Delivered(1, 1)), Batch(Delivered(2, 1))]);
        broker.Receiver.Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => cycles.Count > 0 ? cycles.Dequeue() : Batch());
        var sent = new List<ServiceBusMessage>();
        broker.Sender.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<ServiceBusMessageBatch>(ServiceBusModelFactory.ServiceBusMessageBatch(long.MaxValue, sent, new CreateMessageBatchOptions(), _ => true)));

        var result = await broker.Provider().MoveMessagesAsync("orders", "archive", [1, 2], newMessageIdOnDuplicateDetection: true);

        var copy = Assert.Single(sent);
        Assert.True(copy.MessageId != "order-1" && result.NewMessageIds.SequenceEqual([new KeyValuePair<long, string>(1, copy.MessageId)]),
            $"A move that opted in to new ids into a duplicate-detecting target must send the copy with a new id and report it; sent {copy.MessageId}, reported {string.Join(", ", result.NewMessageIds)}");
        Assert.True(result.Failures.Select(f => (f.SequenceNumber, f.Error)).SequenceEqual([(2L, "Not reached: going on would have sent unselected messages past their max delivery count into the dead-letter queue. Nothing was sent or removed.")]),
            $"The move must stop before an unselected message reaches the max delivery count it read; failures: {string.Join("; ", result.Failures.Select(f => $"{f.SequenceNumber}: {f.Error}"))}");
    }

    [Fact]
    public async Task A_dead_letter_delete_or_resubmit_never_reads_the_source_settings_so_a_connection_without_Manage_can_run_it()
    {
        var broker = new FakeBroker();
        broker.Admin.Setup(a => a.GetQueueAsync("orders", It.IsAny<CancellationToken>())).ThrowsAsync(new UnauthorizedAccessException("no Manage"));
        broker.Admin.Setup(a => a.GetSubscriptionAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>())).ThrowsAsync(new UnauthorizedAccessException("no Manage"));
        broker.Receiver.Setup(r => r.ReceiveMessagesAsync(It.IsAny<int>(), It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>())).ReturnsAsync(Batch(Msg(1)));
        var provider = broker.Provider();

        var queueDelete = await provider.DeleteMessagesAsync("orders", [1], MessageSubQueue.DeadLetter);
        var subscriptionDelete = await provider.DeleteMessagesAsync("events", [1], MessageSubQueue.DeadLetter, "audit");
        var subscriptionResubmit = await provider.ResubmitDeadLetterMessagesAsync("events", [1], MessageSubQueue.DeadLetter, "audit");

        Assert.True(new[] { queueDelete, subscriptionDelete, subscriptionResubmit }.All(r => r.SuccessCount == 1 && r.FailureCount == 0),
            "A delete or resubmit on a dead-letter queue has no delivery limit to read, so it must run without reading the source's settings.");
        broker.Admin.Verify(a => a.GetSubscriptionAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never,
            "A dead-letter delete or resubmit never reads the source's max delivery count.");
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
    public async Task A_batch_the_broker_refuses_midway_as_disabled_is_never_listed_with_a_new_message_id(string operation)
    {
        var receiver = ReceiverFailingAfter([Batch(Msg(1)), Batch(Msg(2), Msg(3))], Broker(ServiceBusFailureReason.ServiceTimeout));
        receiver.Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        var sender = new Mock<ServiceBusSender>();
        sender.Setup(s => s.CreateMessageBatchAsync(It.IsAny<CancellationToken>())).Returns(() => new ValueTask<ServiceBusMessageBatch>(NewTestBatch()));
        sender.SetupSequence(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask)
            .Throws(Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        var result = operation == "resubmit"
            ? await AzureServiceBusProvider.ResubmitCoreAsync(receiver.Object, sender.Object, [1, 2, 3], CancellationToken.None, newMessageIds: true)
            : await AzureServiceBusProvider.MoveCoreAsync(receiver.Object, sender.Object, [1, 2, 3], CancellationToken.None, newMessageIds: true);

        Assert.Equal(new long[] { 1 }, result.NewMessageIds.Keys.OrderBy(k => k).ToArray());
        Assert.True(!result.NewMessageIds.ContainsKey(2) && !result.NewMessageIds.ContainsKey(3),
            "A batch the broker refused as disabled was not sent, so none of it may be listed with a new message id.");
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

    [Fact]
    public async Task A_scheduled_send_returns_the_sequence_number_the_broker_gave_it_and_a_send_without_a_time_returns_none()
    {
        var broker = new FakeBroker();
        var due = DateTimeOffset.UtcNow.AddMinutes(10);
        broker.Sender.Setup(s => s.ScheduleMessageAsync(It.IsAny<ServiceBusMessage>(), due, It.IsAny<CancellationToken>())).ReturnsAsync(42L);
        var provider = broker.Provider();

        var scheduled = await provider.SendMessageAsync("events", new SendMessageRequest { Body = "later", ScheduledEnqueueTime = due });
        var sentNow = await provider.SendMessageAsync("events", new SendMessageRequest { Body = "now" });

        Assert.Equal<(long?, long?)>((42L, null), (scheduled, sentNow));
        broker.Sender.Verify(s => s.ScheduleMessageAsync(It.Is<ServiceBusMessage>(m => m.Body.ToString() == "later"), due, It.IsAny<CancellationToken>()), Times.Once);
        broker.Sender.Verify(s => s.SendMessageAsync(It.Is<ServiceBusMessage>(m => m.Body.ToString() == "now"), It.IsAny<CancellationToken>()), Times.Once);
        broker.Client.Verify(c => c.CreateSender("events"), Times.Exactly(2));
    }

    [Fact]
    public async Task A_scheduled_send_the_broker_refuses_for_another_reason_throws_its_exception_and_returns_no_number()
    {
        var broker = new FakeBroker();
        broker.Sender.Setup(s => s.ScheduleMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<DateTimeOffset>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.ServiceTimeout));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => broker.Provider().SendMessageAsync("events",
            new SendMessageRequest { Body = "later", ScheduledEnqueueTime = DateTimeOffset.UtcNow.AddMinutes(10) }));

        Assert.Equal(ServiceBusFailureReason.ServiceTimeout, error.Reason);
        broker.Sender.Verify(s => s.SendMessageAsync(It.IsAny<ServiceBusMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Cancelling_scheduled_messages_of_a_topic_uses_the_topic_sender_and_reports_each_number_not_cancelled()
    {
        var broker = new FakeBroker();
        var calls = new List<long[]>();
        broker.Sender.Setup(s => s.CancelScheduledMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .Returns((IEnumerable<long> numbers, CancellationToken _) =>
            {
                calls.Add(numbers.ToArray());
                return numbers.Contains(13) ? Task.FromException(Broker(ServiceBusFailureReason.MessageNotFound)) : Task.CompletedTask;
            });

        var result = await broker.Provider().CancelScheduledMessagesAsync("events", [12, 13, 14]);

        Assert.Equal(2, result.SuccessCount);
        Assert.Equal(new[] { (13L, "This message is not scheduled any more.") }, FailuresOf(result));
        Assert.Equal(new[] { new long[] { 12, 13, 14 }, [12], [13], [14] }, calls.ToArray());
        broker.Client.Verify(c => c.CreateSender("events"), Times.Once);
    }

    [Fact]
    public async Task A_failing_cancel_call_on_a_topic_fails_every_number_with_the_fixed_sentence()
    {
        var broker = new FakeBroker();
        broker.Sender.Setup(s => s.CancelScheduledMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.ServiceTimeout));

        var result = await broker.Provider().CancelScheduledMessagesAsync("events", [12, 13]);

        Assert.Equal(0, result.SuccessCount);
        Assert.Equal(new[] { (12L, CancelFailed), (13L, CancelFailed) }, FailuresOf(result));
    }

    [Fact]
    public async Task A_cancel_of_501_numbers_on_a_topic_is_refused_before_the_topic_sender_is_created()
    {
        var broker = new FakeBroker();

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            broker.Provider().CancelScheduledMessagesAsync("events", Enumerable.Range(1, 501).Select(i => (long)i).ToArray()));

        Assert.Equal("sequenceNumbers must hold 1 to 500 sequence numbers.", error.Message);
        broker.Client.Verify(c => c.CreateSender(It.IsAny<string>()), Times.Never);
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

        var fromHead = await Assert.ThrowsAsync<MessageReadFailedException>(() =>
            broker.Provider().PeekMessagesAsync("orders", 10, MessageSubQueue.DeadLetter));
        var fromPosition = await Assert.ThrowsAsync<MessageReadFailedException>(() =>
            broker.Provider().PeekMessagesAsync("orders", 10, MessageSubQueue.DeadLetter, fromSequenceNumber: 3));

        Assert.Equal(("The broker did not return the messages of this entity (ServiceTimeout).", fromHead.Message), (fromPosition.Message, fromPosition.Message));
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
        Assert.Equal(new[] { true, true, false }, result.Failures.OrderBy(f => f.SequenceNumber).Select(f => f.PossibleDuplicate).ToArray());
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
        Assert.Equal(new[] { true, true, false, false }, result.Failures.OrderBy(f => f.SequenceNumber).Select(f => f.PossibleDuplicate).ToArray());
    }

    private const string NotDeferred = "Not found as a deferred message.";
    private const string DeferredNotHandled = "Nothing was done to this deferred message: the call stopped on a broker failure.";
    private const string DeferredDuplicate = "Message was resubmitted but could not be removed from the deferred messages and may be duplicated on retry";

    private static ServiceBusReceivedMessage Deferred(long sequenceNumber) => Msg(sequenceNumber, ServiceBusMessageState.Deferred);

    /// <summary>A broker whose deferred messages are <paramref name="deferred"/>: a call naming any other number fails whole with MessageNotFound, as the broker does.</summary>
    private static FakeBroker DeferredBroker(List<long[]> calls, params long[] deferred)
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.ReceiveDeferredMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .Returns((IEnumerable<long> numbers, CancellationToken _) =>
            {
                var asked = numbers.ToArray();
                calls.Add(asked);
                return asked.All(deferred.Contains)
                    ? Task.FromResult<IReadOnlyList<ServiceBusReceivedMessage>>(asked.Select(Deferred).ToList())
                    : Task.FromException<IReadOnlyList<ServiceBusReceivedMessage>>(Broker(ServiceBusFailureReason.MessageNotFound));
            });
        return broker;
    }

    private static Task<BatchOperationResult> RunDeferred(AzureServiceBusProvider provider, string operation, long[] numbers, string? subscription = null, CancellationToken token = default) =>
        operation switch
        {
            "delete" => provider.DeleteDeferredMessagesAsync("orders", numbers, subscription, token),
            "resubmit" => provider.ResubmitDeferredMessagesAsync("orders", numbers, subscription, cancellationToken: token),
            _ => provider.DeadLetterDeferredMessagesAsync("orders", numbers, subscription, "bad-data", "rejected by the operator", token)
        };

    [Theory]
    [InlineData("delete", null, "orders")]
    [InlineData("resubmit", "audit", "orders/subscriptions/audit")]
    [InlineData("deadletter", "audit", "orders/subscriptions/audit")]
    public async Task Deferred_messages_are_received_by_sequence_number_from_the_active_queue_in_one_call_and_each_is_settled(string operation, string? subscription, string path)
    {
        var calls = new List<long[]>();
        var broker = DeferredBroker(calls, 4, 5);

        var result = await RunDeferred(broker.Provider(), operation, [4, 5], subscription);

        Assert.True(result.SuccessCount == 2 && result.FailureCount == 0, $"Both deferred messages must be handled; failures: {string.Join("; ", FailuresOf(result))}");
        Assert.Equal((path, SubQueue.None), Assert.Single(broker.Receivers));
        Assert.Equal(new[] { new long[] { 4, 5 } }, calls.ToArray());
    }

    [Theory]
    [InlineData("delete")]
    [InlineData("resubmit")]
    [InlineData("deadletter")]
    public async Task A_sequence_number_that_is_not_a_deferred_message_is_reported_not_found_as_a_deferred_message_and_the_others_are_still_handled(string operation)
    {
        var calls = new List<long[]>();
        var broker = DeferredBroker(calls, 4, 6);

        var result = await RunDeferred(broker.Provider(), operation, [4, 5, 6]);

        Assert.True(FailuresOf(result).SequenceEqual(new[] { (5L, NotDeferred) }),
            $"A number the broker does not hold as a deferred message must be reported 'not found as a deferred message', never skipped; got {string.Join("; ", FailuresOf(result))}");
        Assert.Equal(2, result.SuccessCount);
        Assert.Equal(new[] { new long[] { 4, 5, 6 }, [4], [5], [6] }, calls.ToArray());
    }

    [Fact]
    public async Task A_deferred_number_the_broker_answers_without_a_message_is_reported_not_found_as_a_deferred_message()
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.ReceiveDeferredMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ServiceBusReceivedMessage> { Deferred(4) });

        var result = await broker.Provider().DeleteDeferredMessagesAsync("orders", [4, 5]);

        Assert.True(FailuresOf(result).SequenceEqual(new[] { (5L, NotDeferred) }),
            $"A number the broker answered nothing for must be reported, never skipped; got {string.Join("; ", FailuresOf(result))}");
        broker.Receiver.Verify(r => r.CompleteMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 4), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("delete")]
    [InlineData("resubmit")]
    [InlineData("deadletter")]
    public async Task A_receive_of_deferred_messages_that_fails_reports_every_number_with_the_fixed_text_and_settles_nothing(string operation)
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.ReceiveDeferredMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ServiceBusException(Sentinel, ServiceBusFailureReason.ServiceTimeout));

        var result = await RunDeferred(broker.Provider(), operation, [4, 5]);

        Assert.True(FailuresOf(result).SequenceEqual(new[] { (4L, DeferredNotHandled), (5L, DeferredNotHandled) }),
            $"A failed receive of deferred messages must report each number with the fixed text and no broker text; got {string.Join("; ", FailuresOf(result))}");
        broker.Receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never);
        broker.Sender.Verify(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_deferred_resubmit_sends_the_copies_before_it_completes_the_deferred_messages()
    {
        var order = new List<string>();
        var broker = DeferredBroker(new List<long[]>(), 4, 5);
        broker.Sender.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .Callback(() => order.Add("send")).Returns(Task.CompletedTask);
        broker.Receiver.Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .Callback((ServiceBusReceivedMessage m, CancellationToken _) => order.Add($"complete {m.SequenceNumber}")).Returns(Task.CompletedTask);

        var result = await broker.Provider().ResubmitDeferredMessagesAsync("orders", [4, 5]);

        Assert.True(order.SequenceEqual(new[] { "send", "complete 4", "complete 5" }),
            $"A deferred resubmit must send first and complete after; the broker saw {string.Join(", ", order)}");
        Assert.Equal(2, result.SuccessCount);
        broker.Client.Verify(c => c.CreateSender("orders"), Times.Once);
    }

    [Fact]
    public async Task A_deferred_resubmit_whose_complete_fails_after_the_send_reports_a_possible_duplicate_and_never_sends_again()
    {
        var broker = DeferredBroker(new List<long[]>(), 4, 5);
        broker.Receiver.Setup(r => r.CompleteMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 5), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.MessageLockLost));

        var result = await broker.Provider().ResubmitDeferredMessagesAsync("orders", [4, 5]);

        var failure = Assert.Single(result.Failures);
        Assert.True(failure.SequenceNumber == 5 && failure.PossibleDuplicate && failure.Error.StartsWith(DeferredDuplicate),
            $"A deferred message sent and not completed must be reported as a possible duplicate; got {failure.SequenceNumber}: {failure.Error}");
        Assert.Equal(1, result.SuccessCount);
        broker.Sender.Verify(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()), Times.Once,
            "A possible duplicate is never sent again.");
    }

    [Fact]
    public async Task A_deferred_resubmit_whose_send_fails_reports_each_message_handed_to_the_send_as_a_possible_duplicate_completes_nothing_and_carries_no_broker_text()
    {
        var broker = DeferredBroker(new List<long[]>(), 4, 5);
        broker.Sender.Setup(s => s.SendMessagesAsync(It.IsAny<ServiceBusMessageBatch>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ServiceBusException(Sentinel, ServiceBusFailureReason.ServiceTimeout));

        var result = await broker.Provider().ResubmitDeferredMessagesAsync("orders", [4, 5]);

        Assert.True(result.Failures.Count == 2 && result.Failures.All(f => f.Error.StartsWith(DeferredDuplicate)),
            "A send that failed may have reached the broker, so each message handed to it is a possible duplicate, never 'nothing was done': "
            + string.Join("; ", result.Failures.Select(f => $"{f.SequenceNumber}: {f.Error}")));
        Assert.DoesNotContain(result.Failures, f => f.Error.Contains(Sentinel));
        broker.Receiver.Verify(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()), Times.Never,
            "Nothing is completed when the send failed.");
    }

    [Fact]
    public async Task A_deferred_resubmit_whose_complete_fails_carries_no_broker_text()
    {
        var broker = DeferredBroker(new List<long[]>(), 4);
        broker.Receiver.Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ServiceBusException(Sentinel, ServiceBusFailureReason.MessageLockLost));

        var result = await broker.Provider().ResubmitDeferredMessagesAsync("orders", [4]);

        var failure = Assert.Single(result.Failures);
        Assert.True(failure.Error.StartsWith(DeferredDuplicate) && !failure.Error.Contains(Sentinel),
            $"The possible duplicate is reported in the fixed text, never with the broker's; got {failure.Error}");
    }

    [Theory]
    [InlineData(ServiceBusFailureReason.MessagingEntityDisabled, "The entity is disabled for this operation.")]
    [InlineData(ServiceBusFailureReason.ServiceTimeout, DeferredNotHandled)]
    public async Task A_deferred_call_whose_second_batch_fails_keeps_what_the_first_settled_and_reports_the_rest_without_a_second_receive(ServiceBusFailureReason reason, string expected)
    {
        var numbers = Enumerable.Range(1, 150).Select(n => (long)n).ToArray();
        var broker = new FakeBroker();
        var receives = 0;
        broker.Receiver.Setup(r => r.ReceiveDeferredMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .Returns((IEnumerable<long> asked, CancellationToken _) => ++receives == 1
                ? Task.FromResult<IReadOnlyList<ServiceBusReceivedMessage>>(asked.Select(Deferred).ToList())
                : Task.FromException<IReadOnlyList<ServiceBusReceivedMessage>>(Broker(reason)));

        var result = await broker.Provider().DeleteDeferredMessagesAsync("orders", numbers);

        Assert.Equal(100, result.SuccessCount);
        Assert.True(result.Failures.Select(f => f.SequenceNumber).SequenceEqual(numbers[100..]) && result.Failures.All(f => f.Error == expected),
            $"Numbers 101 to 150 are reported with '{expected}' and the first batch's outcomes are kept; got {result.Failures.Count} failures.");
        Assert.Equal(2, receives);
    }

    [Fact]
    public async Task A_deferred_resubmit_whose_target_settings_cannot_be_read_is_refused_with_the_Manage_text_and_receives_nothing()
    {
        var broker = DeferredBroker(new List<long[]>(), 4, 5);
        broker.Admin.Setup(a => a.GetQueueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ServiceBusException(Sentinel, ServiceBusFailureReason.ServiceTimeout));

        var result = await broker.Provider().ResubmitDeferredMessagesAsync("orders", [4, 5]);

        Assert.True(result.Failures.Count == 2 && result.Failures.All(f => f.Error.Contains("needs the Manage right") && !f.Error.Contains(Sentinel)),
            "A deferred resubmit that cannot read whether the target detects duplicates refuses each number with the fixed Manage text.");
        broker.Receiver.Verify(r => r.ReceiveDeferredMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_deferred_resubmit_into_a_target_that_detects_duplicates_is_refused_and_receives_nothing()
    {
        var broker = DetectingBroker();

        var result = await broker.Provider().ResubmitDeferredMessagesAsync("orders", [4, 5], "audit");

        Assert.Equal(new[] { (4L, DuplicateDetectionRefusal), (5L, DuplicateDetectionRefusal) }, FailuresOf(result));
        broker.Receiver.Verify(r => r.ReceiveDeferredMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()), Times.Never);
        broker.Admin.Verify(a => a.GetSubscriptionAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never,
            "A deferred message is received by its number, so no unselected message is received and the source's delivery limit is not read.");
    }

    [Fact]
    public async Task A_deferred_dead_letter_writes_the_reason_and_description_and_a_failing_one_is_reported_with_the_fixed_text()
    {
        var broker = DeferredBroker(new List<long[]>(), 4, 5);
        broker.Receiver.Setup(r => r.DeadLetterMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 5), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ServiceBusException(Sentinel, ServiceBusFailureReason.ServiceTimeout));

        var result = await broker.Provider().DeadLetterDeferredMessagesAsync("orders", [4, 5], reason: "bad-data", description: "rejected by the operator");

        Assert.Equal(new[] { (5L, "The broker did not dead-letter this deferred message.") }, FailuresOf(result));
        Assert.Equal(1, result.SuccessCount);
        broker.Receiver.Verify(r => r.DeadLetterMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 4), "bad-data", "rejected by the operator", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_deferred_delete_whose_complete_fails_reports_that_number_with_the_fixed_text_and_no_broker_text()
    {
        var broker = DeferredBroker(new List<long[]>(), 4, 5);
        broker.Receiver.Setup(r => r.CompleteMessageAsync(It.Is<ServiceBusReceivedMessage>(m => m.SequenceNumber == 4), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ServiceBusException(Sentinel, ServiceBusFailureReason.ServiceTimeout));

        var result = await broker.Provider().DeleteDeferredMessagesAsync("orders", [4, 5]);

        Assert.Equal(new[] { (4L, "The broker did not remove this deferred message.") }, FailuresOf(result));
        Assert.Equal(1, result.SuccessCount);
    }

    [Theory]
    [InlineData("delete")]
    [InlineData("resubmit")]
    [InlineData("deadletter")]
    public async Task A_deferred_call_on_an_entity_disabled_before_anything_was_done_throws_the_neutral_exception(string operation)
    {
        var broker = new FakeBroker();
        broker.Receiver.Setup(r => r.ReceiveDeferredMessagesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.MessagingEntityDisabled));

        var error = await Assert.ThrowsAsync<EntityDisabledException>(() => RunDeferred(broker.Provider(), operation, [4]));

        Assert.Equal(Disabled, error.Message);
    }

    [Fact]
    public async Task A_deferred_call_above_1000_sequence_numbers_is_refused_naming_the_field_before_the_broker_is_called()
    {
        var broker = new FakeBroker();
        var numbers = Enumerable.Range(1, 1001).Select(i => (long)i).ToArray();

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => broker.Provider().DeleteDeferredMessagesAsync("orders", numbers));

        Assert.True(error.Message == "sequenceNumbers must hold 1 to 1000 sequence numbers.",
            $"A deferred call is bounded at 1000 sequence numbers; it said: {error.Message}");
        Assert.Empty(broker.Receivers);
    }

    [Fact]
    public async Task A_deferred_call_of_1000_numbers_reaches_the_broker_in_batches_of_100()
    {
        var calls = new List<long[]>();
        var numbers = Enumerable.Range(1, 1000).Select(i => (long)i).ToArray();
        var broker = DeferredBroker(calls, numbers);

        var result = await broker.Provider().DeleteDeferredMessagesAsync("orders", numbers);

        Assert.Equal(1000, result.SuccessCount);
        Assert.Equal(Enumerable.Repeat(100, 10), calls.Select(c => c.Length));
    }

    [Fact]
    public async Task The_caller_token_stops_a_deferred_call_before_the_next_batch_is_received()
    {
        using var cts = new CancellationTokenSource();
        var calls = new List<long[]>();
        var numbers = Enumerable.Range(1, 150).Select(i => (long)i).ToArray();
        var broker = DeferredBroker(calls, numbers);
        broker.Receiver.Setup(r => r.CompleteMessageAsync(It.IsAny<ServiceBusReceivedMessage>(), It.IsAny<CancellationToken>()))
            .Callback(() => cts.Cancel()).Returns(Task.CompletedTask);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => broker.Provider().DeleteDeferredMessagesAsync("orders", numbers, cancellationToken: cts.Token));

        Assert.True(calls.Count == 1, $"The caller's token must stop the call before the next batch is received; receives: {calls.Count}");
    }
}
