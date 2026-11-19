using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Moq;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The single-queue read, the single-topic read with its subscriptions, and the received-message mapping, against a mocked
/// <see cref="ServiceBusAdministrationClient"/> and SDK model factory objects.
/// </summary>
public class AzureServiceBusProviderReadTests
{
    private const string QueueName = "orders";

    private static QueueProperties ConfiguredQueue() =>
        ServiceBusModelFactory.QueueProperties(
            name: QueueName,
            lockDuration: TimeSpan.FromSeconds(45),
            maxSizeInMegabytes: 2048,
            requiresDuplicateDetection: true,
            requiresSession: true,
            defaultMessageTimeToLive: TimeSpan.FromMinutes(30),
            autoDeleteOnIdle: TimeSpan.FromDays(7),
            deadLetteringOnMessageExpiration: true,
            duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            maxDeliveryCount: 3,
            enableBatchedOperations: true,
            status: EntityStatus.SendDisabled,
            forwardTo: "orders-archive",
            forwardDeadLetteredMessagesTo: "orders-poison",
            userMetadata: "owned by billing",
            enablePartitioning: true,
            maxMessageSizeInKilobytes: 1024);

    private static QueueRuntimeProperties QueueRuntime() =>
        ServiceBusModelFactory.QueueRuntimeProperties(
            name: QueueName,
            activeMessageCount: 11,
            scheduledMessageCount: 12,
            deadLetterMessageCount: 13,
            transferDeadLetterMessageCount: 14,
            transferMessageCount: 15,
            totalMessageCount: 65,
            sizeInBytes: 4096,
            createdAt: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
            updatedAt: new DateTimeOffset(2026, 1, 2, 0, 0, 0, TimeSpan.Zero),
            accessedAt: new DateTimeOffset(2026, 1, 3, 0, 0, 0, TimeSpan.Zero));

    private static Mock<ServiceBusAdministrationClient> AdminReturning(
        Func<Task<Response<QueueProperties>>> properties,
        Func<Task<Response<QueueRuntimeProperties>>> runtime)
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetQueueAsync(QueueName, It.IsAny<CancellationToken>())).Returns(properties);
        admin.Setup(a => a.GetQueueRuntimePropertiesAsync(QueueName, It.IsAny<CancellationToken>())).Returns(runtime);
        return admin;
    }

    private static Task<Response<T>> Ok<T>(T value) => Task.FromResult(Response.FromValue(value, Mock.Of<Response>()));

    private static Task<Response<T>> Fails<T>(ServiceBusFailureReason reason) =>
        Task.FromException<Response<T>>(new ServiceBusException("broker said no", reason));

    [Fact]
    public async Task Queue_details_carry_every_configured_and_runtime_value_of_the_queue()
    {
        var admin = AdminReturning(() => Ok(ConfiguredQueue()), () => Ok(QueueRuntime()));

        var queue = await AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, QueueName);

        Assert.NotNull(queue);
        Assert.Equal(QueueName, queue.Name);
        Assert.Equal("SendDisabled", queue.Status);
        Assert.Equal(TimeSpan.FromSeconds(45), queue.LockDuration);
        Assert.Equal(3, queue.MaxDeliveryCount);
        Assert.Equal(TimeSpan.FromMinutes(30), queue.DefaultMessageTimeToLive);
        Assert.Equal(2048, queue.MaxSizeInMegabytes);
        Assert.True(queue.RequiresSession);
        Assert.True(queue.DeadLetteringOnMessageExpiration);
        Assert.True(queue.EnablePartitioning);
        Assert.Equal((11L, 12L, 13L, 15L, 4096L), (queue.ActiveMessageCount, queue.ScheduledMessageCount, queue.DeadLetterMessageCount, queue.TransferMessageCount, queue.SizeInBytes));
    }

    [Fact]
    public async Task Queue_details_carry_forward_to_auto_delete_duplicate_detection_user_metadata_batched_operations_max_message_size_and_the_transfer_dead_letter_count()
    {
        var admin = AdminReturning(() => Ok(ConfiguredQueue()), () => Ok(QueueRuntime()));

        var queue = await AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, QueueName);

        Assert.NotNull(queue);
        Assert.Equal("orders-archive", queue.ForwardTo);
        Assert.Equal("orders-poison", queue.ForwardDeadLetteredMessagesTo);
        Assert.Equal(TimeSpan.FromDays(7), queue.AutoDeleteOnIdle);
        Assert.True(queue.RequiresDuplicateDetection);
        Assert.Equal(TimeSpan.FromMinutes(10), queue.DuplicateDetectionHistoryTimeWindow);
        Assert.Equal("owned by billing", queue.UserMetadata);
        Assert.True(queue.EnableBatchedOperations);
        Assert.Equal(1024L, queue.MaxMessageSizeInKilobytes);
        Assert.Equal(14L, queue.TransferDeadLetterMessageCount);
    }

    [Fact]
    public async Task A_failing_queue_properties_call_reaches_the_caller_instead_of_a_null_or_half_filled_queue()
    {
        var admin = AdminReturning(() => Fails<QueueProperties>(ServiceBusFailureReason.ServiceBusy), () => Ok(QueueRuntime()));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, QueueName));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task A_queue_that_either_call_reports_not_found_is_null(bool propertiesNotFound, bool runtimeNotFound)
    {
        var admin = AdminReturning(
            () => propertiesNotFound ? Fails<QueueProperties>(ServiceBusFailureReason.MessagingEntityNotFound) : Ok(ConfiguredQueue()),
            () => runtimeNotFound ? Fails<QueueRuntimeProperties>(ServiceBusFailureReason.MessagingEntityNotFound) : Ok(QueueRuntime()));

        var queue = await AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, QueueName);

        Assert.Null(queue);
    }

    [Theory]
    [InlineData(ServiceBusMessageState.Active, "Active")]
    [InlineData(ServiceBusMessageState.Deferred, "Deferred")]
    [InlineData(ServiceBusMessageState.Scheduled, "Scheduled")]
    public void A_message_says_its_state_and_its_body_size_in_bytes(ServiceBusMessageState state, string expectedState)
    {
        var received = ServiceBusModelFactory.ServiceBusReceivedMessage(
            body: BinaryData.FromString("price €12"),
            sequenceNumber: 7,
            serviceBusMessageState: state);

        var message = AzureServiceBusProvider.MapToMessageInfo(received, isDeadLettered: false);

        Assert.Equal(expectedState, message.State);
        Assert.Equal(11L, message.SizeInBytes);
    }

    private static ServiceBusReceivedMessage ReceivedWith(global::Azure.Core.Amqp.AmqpMessageBody body)
    {
        var amqp = new global::Azure.Core.Amqp.AmqpAnnotatedMessage(body);
        amqp.Header.DeliveryCount = 0;
        return ServiceBusReceivedMessage.FromAmqpMessage(amqp, BinaryData.FromBytes(Guid.NewGuid().ToByteArray()));
    }

    [Fact]
    public void A_body_sent_as_an_AMQP_value_that_is_text_is_read_as_that_text_with_and_without_the_body_asked()
    {
        var received = ReceivedWith(global::Azure.Core.Amqp.AmqpMessageBody.FromValue("price €12"));

        var withBody = AzureServiceBusProvider.MapToMessageInfo(received, isDeadLettered: true);
        var withoutBody = AzureServiceBusProvider.MapToMessageInfo(received, isDeadLettered: true, includeBody: false);

        Assert.Equal(("price €12", "text", 11L), (withBody.Body, withBody.BodyEncoding, withBody.SizeInBytes));
        Assert.Equal("AmqpValue", withBody.BodyType);
        Assert.Equal("Text", AzureServiceBusProvider.MapToMessageInfo(ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString("x")), isDeadLettered: false).BodyType);
        Assert.Equal((null, 11L), (withoutBody.Body, withoutBody.SizeInBytes));
    }

    [Fact]
    public void A_body_sent_as_an_AMQP_value_that_is_bytes_is_read_as_those_bytes()
    {
        byte[] bytes = [0x00, 0xFF, 0x41];

        var message = AzureServiceBusProvider.MapToMessageInfo(ReceivedWith(global::Azure.Core.Amqp.AmqpMessageBody.FromValue(bytes)), isDeadLettered: false);

        Assert.Equal("base64", message.BodyEncoding);
        Assert.True(Convert.FromBase64String(message.Body!).SequenceEqual(bytes));
    }

    [Fact]
    public void A_body_sent_as_an_AMQP_value_of_another_kind_or_as_a_sequence_is_read_as_its_JSON_never_a_failure()
    {
        var map = ReceivedWith(global::Azure.Core.Amqp.AmqpMessageBody.FromValue(new Dictionary<string, object> { ["orderId"] = 7 }));
        var sequence = ReceivedWith(global::Azure.Core.Amqp.AmqpMessageBody.FromSequence([new List<object> { "a", 1 }, new List<object> { "b" }]));

        Assert.Equal("""{"orderId":7}""", AzureServiceBusProvider.MapToMessageInfo(map, isDeadLettered: false).Body);
        Assert.Equal("""[["a",1],["b"]]""", AzureServiceBusProvider.MapToMessageInfo(sequence, isDeadLettered: false).Body);
        Assert.Equal("AmqpSequence", AzureServiceBusProvider.MapToMessageInfo(sequence, isDeadLettered: false).BodyType);
    }

    [Fact]
    public void A_body_sent_as_a_value_JSON_cannot_write_is_read_as_its_text_never_a_failure()
    {
        var message = AzureServiceBusProvider.MapToMessageInfo(ReceivedWith(global::Azure.Core.Amqp.AmqpMessageBody.FromValue(double.NaN)), isDeadLettered: false);

        Assert.Equal("NaN", message.Body);
    }

    [Fact]
    public void A_body_that_is_not_valid_utf8_is_read_as_the_base64_of_its_exact_bytes_never_with_replaced_bytes()
    {
        byte[] bytes = [0x00, 0xFF, 0xFE, 0x80, 0x41, 0xC3];
        var received = ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromBytes(bytes), sequenceNumber: 1);

        var message = AzureServiceBusProvider.MapToMessageInfo(received, isDeadLettered: false);

        Assert.True(message.BodyEncoding == "base64", "A body that is not valid UTF-8 is flagged base64.");
        Assert.True(Convert.FromBase64String(message.Body!).SequenceEqual(bytes), "The base64 body decodes to the exact bytes; no byte is replaced.");
        Assert.Equal(bytes.Length, message.SizeInBytes);
    }

    [Theory]
    [InlineData("price €12")]
    [InlineData("")]
    public void A_valid_utf8_or_empty_body_is_read_as_its_text(string text)
    {
        var received = ServiceBusModelFactory.ServiceBusReceivedMessage(body: BinaryData.FromString(text), sequenceNumber: 1);

        var message = AzureServiceBusProvider.MapToMessageInfo(received, isDeadLettered: false);

        Assert.True((message.Body, message.BodyEncoding) == (text, "text"), $"A valid UTF-8 body is its text with the text flag; it was ({message.Body}, {message.BodyEncoding}).");
    }

    [Fact]
    public void A_binary_body_sent_as_base64_round_trips_byte_for_byte()
    {
        byte[] bytes = [0x1F, 0x8B, 0x08, 0x00, 0xFF, 0x00, 0x80];

        var sent = AzureServiceBusProvider.CreateServiceBusMessage(new SendMessageRequest { Body = Convert.ToBase64String(bytes), BodyEncoding = "base64" });
        var read = AzureServiceBusProvider.MapToMessageInfo(
            ServiceBusModelFactory.ServiceBusReceivedMessage(body: sent.Body, sequenceNumber: 1), isDeadLettered: false);

        Assert.True(sent.Body.ToArray().SequenceEqual(bytes), "A base64 body is sent as the bytes it encodes, not as its text.");
        Assert.True((read.Body, read.BodyEncoding) == (Convert.ToBase64String(bytes), "base64"), "The bytes read back are the bytes sent.");
    }

    [Fact]
    public void A_text_body_is_sent_as_its_utf8_bytes()
    {
        var sent = AzureServiceBusProvider.CreateServiceBusMessage(new SendMessageRequest { Body = "AAEC" });

        Assert.Equal("AAEC", sent.Body.ToString());
    }

    private const string TopicName = "events";

    private static SubscriptionProperties SubscriptionSettings(string name, EntityStatus status) =>
        ServiceBusModelFactory.SubscriptionProperties(
            topicName: TopicName,
            subscriptionName: name,
            lockDuration: TimeSpan.FromMinutes(2),
            requiresSession: false,
            defaultMessageTimeToLive: TimeSpan.FromHours(1),
            autoDeleteOnIdle: TimeSpan.MaxValue,
            deadLetteringOnMessageExpiration: false,
            maxDeliveryCount: 7,
            enableBatchedOperations: true,
            status: status,
            forwardTo: null,
            forwardDeadLetteredMessagesTo: null,
            userMetadata: "");

    private static SubscriptionRuntimeProperties SubscriptionRuntime(string name, long active) =>
        ServiceBusModelFactory.SubscriptionRuntimeProperties(
            topicName: TopicName, subscriptionName: name, totalMessageCount: active, activeMessageCount: active,
            deadLetterMessageCount: 0, transferMessageCount: 0, transferDeadLetterMessageCount: 0,
            createdAt: default, updatedAt: default, accessedAt: default);

    private static RuleProperties Rule(string name) => ServiceBusModelFactory.RuleProperties(name, new TrueRuleFilter(), null);

    private static AsyncPageable<T> Pages<T>(params T[] values) where T : notnull =>
        AsyncPageable<T>.FromPages([Page<T>.FromValues(values, null, Mock.Of<Response>())]);

    private static IEnumerable<Page<T>> FailingPages<T>(Exception error)
    {
        yield return Throw<Page<T>>(error);
    }

    private static T Throw<T>(Exception error) => throw error;

    /// <summary>A topic whose subscriptions are listed with the given statuses; each subscription's rules come from <paramref name="rules"/>.</summary>
    private static Mock<ServiceBusAdministrationClient> TopicAdmin(
        (string Name, EntityStatus Status)[] subscriptions, Func<string, AsyncPageable<RuleProperties>> rules)
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetTopicAsync(TopicName, It.IsAny<CancellationToken>())).Returns(Ok(ServiceBusModelFactory.TopicProperties(
            name: TopicName, maxSizeInMegabytes: 1024, requiresDuplicateDetection: false, defaultMessageTimeToLive: TimeSpan.FromHours(1),
            autoDeleteOnIdle: TimeSpan.MaxValue, duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            enableBatchedOperations: true, status: EntityStatus.Active, enablePartitioning: false)));
        admin.Setup(a => a.GetTopicRuntimePropertiesAsync(TopicName, It.IsAny<CancellationToken>())).Returns(Ok(
            ServiceBusModelFactory.TopicRuntimeProperties(TopicName, 0, 0, subscriptions.Length, default, default, default)));
        admin.Setup(a => a.GetSubscriptionsRuntimePropertiesAsync(TopicName, It.IsAny<CancellationToken>()))
            .Returns(Pages(subscriptions.Select((s, i) => SubscriptionRuntime(s.Name, i + 10)).ToArray()));
        admin.Setup(a => a.GetSubscriptionsAsync(TopicName, It.IsAny<CancellationToken>()))
            .Returns(Pages(subscriptions.Select(s => SubscriptionSettings(s.Name, s.Status)).ToArray()));
        admin.Setup(a => a.GetRulesAsync(TopicName, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns((string _, string subscription, CancellationToken _) => rules(subscription));
        return admin;
    }

    private static readonly (string, EntityStatus)[] AuditAndBilling = [("audit", EntityStatus.Active), ("billing", EntityStatus.ReceiveDisabled)];

    [Fact]
    public async Task A_topic_read_shows_each_subscriptions_status_and_rule_count()
    {
        var admin = TopicAdmin(AuditAndBilling, s => s == "audit" ? Pages(Rule("$Default")) : Pages(Rule("high"), Rule("low")));

        var topic = await AzureServiceBusProvider.GetTopicCoreAsync(admin.Object, TopicName, CancellationToken.None);

        Assert.NotNull(topic);
        Assert.Equal(
            [("audit", "Active", (int?)1, 10L, 7), ("billing", "ReceiveDisabled", (int?)2, 11L, 7)],
            topic.Subscriptions.Select(s => (s.Name, s.Status, s.RuleCount, s.ActiveMessageCount, s.MaxDeliveryCount)));
    }

    [Theory]
    [InlineData(ServiceBusFailureReason.ServiceBusy)]
    [InlineData(ServiceBusFailureReason.ServiceTimeout)]
    [InlineData(ServiceBusFailureReason.MessagingEntityNotFound)]
    public async Task A_subscription_whose_rule_listing_fails_has_no_rule_count_and_the_topic_read_still_answers(ServiceBusFailureReason reason)
    {
        var admin = TopicAdmin(AuditAndBilling, s => s == "audit"
            ? Pages(Rule("$Default"))
            : AsyncPageable<RuleProperties>.FromPages(FailingPages<RuleProperties>(new ServiceBusException("broker said no", reason))));

        var topic = await AzureServiceBusProvider.GetTopicCoreAsync(admin.Object, TopicName, CancellationToken.None);

        Assert.NotNull(topic);
        Assert.True(
            topic.Subscriptions.Select(s => (s.Name, s.Status, s.RuleCount)).SequenceEqual([("audit", "Active", (int?)1), ("billing", "ReceiveDisabled", (int?)null)]),
            "A failed rule listing leaves only that subscription's rule count unknown (null), never 0, and the topic still answers");
    }

    [Fact]
    public async Task A_failed_subscription_settings_listing_fails_the_topic_read_with_the_broker_error()
    {
        var admin = TopicAdmin(AuditAndBilling, _ => Pages(Rule("$Default")));
        admin.Setup(a => a.GetSubscriptionsAsync(TopicName, It.IsAny<CancellationToken>())).Returns(
            AsyncPageable<SubscriptionProperties>.FromPages(FailingPages<SubscriptionProperties>(new ServiceBusException("broker said no", ServiceBusFailureReason.ServiceBusy))));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => AzureServiceBusProvider.GetTopicCoreAsync(admin.Object, TopicName, CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
        admin.Verify(a => a.GetRulesAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_topic_read_counts_the_rules_of_at_most_200_subscriptions_at_most_eight_at_once()
    {
        var subscriptions = Enumerable.Range(0, AzureServiceBusProvider.TopicRuleCountLimit + 5).Select(i => ($"s{i:000}", EntityStatus.Active)).ToArray();
        int[] open = [0], mostOpen = [0];
        var admin = TopicAdmin(subscriptions, _ => new CountingPages<RuleProperties>([Rule("$Default")], open, mostOpen));

        var topic = await AzureServiceBusProvider.GetTopicCoreAsync(admin.Object, TopicName, CancellationToken.None);

        Assert.NotNull(topic);
        Assert.Equal(AzureServiceBusProvider.TopicRuleCountLimit, topic.Subscriptions.Count(s => s.RuleCount == 1));
        Assert.Equal(["s200", "s201", "s202", "s203", "s204"], topic.Subscriptions.Where(s => s.RuleCount is null).Select(s => s.Name));
        Assert.InRange(mostOpen[0], 2, AzureServiceBusProvider.TopicRuleCountParallelism);
        admin.Verify(a => a.GetRulesAsync(TopicName, It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Exactly(AzureServiceBusProvider.TopicRuleCountLimit));
    }

    private static QueueRuntimeProperties RuntimeOf(string name) =>
        ServiceBusModelFactory.QueueRuntimeProperties(name: name, activeMessageCount: 3, scheduledMessageCount: 0, deadLetterMessageCount: 1,
            transferDeadLetterMessageCount: 0, transferMessageCount: 0, totalMessageCount: 4, sizeInBytes: 0, createdAt: default, updatedAt: default, accessedAt: default);

    private static QueueProperties SettingsOf(string name, EntityStatus status, string? forwardTo) =>
        ServiceBusModelFactory.QueueProperties(name: name, lockDuration: TimeSpan.FromSeconds(30), maxSizeInMegabytes: 1024, requiresDuplicateDetection: false,
            requiresSession: false, defaultMessageTimeToLive: TimeSpan.FromDays(1), autoDeleteOnIdle: TimeSpan.MaxValue, deadLetteringOnMessageExpiration: false,
            duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(1), maxDeliveryCount: 10, enableBatchedOperations: true, status: status,
            forwardTo: forwardTo, forwardDeadLetteredMessagesTo: null, userMetadata: "", enablePartitioning: false, maxMessageSizeInKilobytes: 256);

    [Fact]
    public async Task The_queue_list_carries_each_queues_status_and_forward_target_from_one_extra_listing_joined_by_name()
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetQueuesRuntimePropertiesAsync(It.IsAny<CancellationToken>()))
            .Returns(Pages(RuntimeOf("orders"), RuntimeOf("audit"), RuntimeOf("created-between")));
        admin.Setup(a => a.GetQueuesAsync(It.IsAny<CancellationToken>()))
            .Returns(Pages(SettingsOf("AUDIT", EntityStatus.ReceiveDisabled, null), SettingsOf("orders", EntityStatus.Active, "orders-archive")));

        var queues = await AzureServiceBusProvider.ListQueuesCoreAsync(admin.Object);

        Assert.True(
            queues.Select(q => (q.Name, q.Status, q.ForwardTo, q.ActiveMessageCount))
                .SequenceEqual([("orders", "Active", (string?)"orders-archive", 3L), ("audit", "ReceiveDisabled", null, 3L), ("created-between", "", null, 3L)]),
            "Each queue of the list carries its status and forward target, joined by name in any case, and a queue the settings listing missed keeps its counts with no status");
        admin.Verify(a => a.GetQueuesAsync(It.IsAny<CancellationToken>()), Times.Once);
        admin.Verify(a => a.GetQueuesRuntimePropertiesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_failed_queue_settings_listing_fails_the_queue_list_with_the_broker_error()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetQueuesRuntimePropertiesAsync(It.IsAny<CancellationToken>())).Returns(Pages(RuntimeOf("orders")));
        admin.Setup(a => a.GetQueuesAsync(It.IsAny<CancellationToken>())).Returns(
            AsyncPageable<QueueProperties>.FromPages(FailingPages<QueueProperties>(new ServiceBusException("broker said no", ServiceBusFailureReason.ServiceBusy))));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => AzureServiceBusProvider.ListQueuesCoreAsync(admin.Object));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task The_topic_list_carries_each_topics_status_from_one_extra_listing_joined_by_name()
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetTopicsRuntimePropertiesAsync(It.IsAny<CancellationToken>())).Returns(Pages(
            ServiceBusModelFactory.TopicRuntimeProperties("events", 0, 0, 2, default, default, default),
            ServiceBusModelFactory.TopicRuntimeProperties("billing", 0, 0, 1, default, default, default)));
        admin.Setup(a => a.GetTopicsAsync(It.IsAny<CancellationToken>())).Returns(Pages(
            ServiceBusModelFactory.TopicProperties("events", 1024, false, TimeSpan.FromDays(1), TimeSpan.MaxValue, TimeSpan.FromMinutes(1), true, EntityStatus.SendDisabled, false, 256),
            ServiceBusModelFactory.TopicProperties("billing", 1024, false, TimeSpan.FromDays(1), TimeSpan.MaxValue, TimeSpan.FromMinutes(1), true, EntityStatus.Active, false, 256)));

        var topics = await AzureServiceBusProvider.ListTopicsCoreAsync(admin.Object);

        Assert.Equal([("events", "SendDisabled", 2), ("billing", "Active", 1)], topics.Select(t => (t.Name, t.Status, t.SubscriptionCount)));
    }

    [Fact]
    public async Task A_failed_topic_settings_listing_fails_the_topic_list_with_the_broker_error()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetTopicsRuntimePropertiesAsync(It.IsAny<CancellationToken>())).Returns(Pages(
            ServiceBusModelFactory.TopicRuntimeProperties("events", 0, 0, 2, default, default, default)));
        admin.Setup(a => a.GetTopicsAsync(It.IsAny<CancellationToken>())).Returns(
            AsyncPageable<TopicProperties>.FromPages(FailingPages<TopicProperties>(new ServiceBusException("broker said no", ServiceBusFailureReason.ServiceBusy))));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => AzureServiceBusProvider.ListTopicsCoreAsync(admin.Object));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task A_cancelled_token_stops_the_topic_read()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        var admin = TopicAdmin(AuditAndBilling, _ => Pages(Rule("$Default")));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => AzureServiceBusProvider.GetTopicCoreAsync(admin.Object, TopicName, cancelled.Token));
    }
}
