using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Moq;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// Creating a queue, topic or subscription with its configuration, editing one, and enabling or disabling
/// one, against a mocked <see cref="ServiceBusAdministrationClient"/>.
/// </summary>
public class AzureServiceBusProviderAdministrationTests
{
    private const string BrokerText = "BROKER-DETAIL-SENTINEL";

    private static QueueProperties ConfiguredQueue() =>
        ServiceBusModelFactory.QueueProperties(
            name: "orders",
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
            status: EntityStatus.Active,
            forwardTo: "orders-archive",
            forwardDeadLetteredMessagesTo: "orders-poison",
            userMetadata: "owned by billing",
            enablePartitioning: true);

    private static TopicProperties ConfiguredTopic() =>
        ServiceBusModelFactory.TopicProperties(
            name: "events",
            maxSizeInMegabytes: 2048,
            requiresDuplicateDetection: true,
            defaultMessageTimeToLive: TimeSpan.FromMinutes(30),
            autoDeleteOnIdle: TimeSpan.FromDays(7),
            duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            enableBatchedOperations: true,
            status: EntityStatus.Active,
            enablePartitioning: true);

    private static SubscriptionProperties ConfiguredSubscription() =>
        ServiceBusModelFactory.SubscriptionProperties(
            topicName: "events",
            subscriptionName: "audit",
            lockDuration: TimeSpan.FromSeconds(45),
            requiresSession: true,
            defaultMessageTimeToLive: TimeSpan.FromMinutes(30),
            autoDeleteOnIdle: TimeSpan.FromDays(7),
            deadLetteringOnMessageExpiration: true,
            maxDeliveryCount: 3,
            enableBatchedOperations: true,
            status: EntityStatus.Active,
            forwardTo: "audit-archive",
            forwardDeadLetteredMessagesTo: "audit-poison",
            userMetadata: "owned by compliance");

    private static Task<Response<T>> Ok<T>(T value) => Task.FromResult(Response.FromValue(value, Mock.Of<Response>()));

    private static ServiceBusException Broker(ServiceBusFailureReason reason) => new(BrokerText, reason);

    private static Mock<ServiceBusAdministrationClient> QueueAdmin(Func<Task<Response<QueueProperties>>> read, List<QueueProperties> written, Exception? writeFails = null)
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetQueueAsync("orders", It.IsAny<CancellationToken>())).Returns(read);
        admin.Setup(a => a.UpdateQueueAsync(It.IsAny<QueueProperties>(), It.IsAny<CancellationToken>()))
            .Returns((QueueProperties q, CancellationToken _) =>
            {
                written.Add(q);
                return writeFails is null ? Ok(q) : Task.FromException<Response<QueueProperties>>(writeFails);
            });
        return admin;
    }

    private static object Settings(QueueProperties q) => new
    {
        q.LockDuration, q.MaxSizeInMegabytes, q.RequiresDuplicateDetection, q.RequiresSession, q.DefaultMessageTimeToLive,
        q.AutoDeleteOnIdle, q.DeadLetteringOnMessageExpiration, q.DuplicateDetectionHistoryTimeWindow, q.MaxDeliveryCount,
        q.EnableBatchedOperations, q.Status, q.ForwardTo, q.ForwardDeadLetteredMessagesTo, q.UserMetadata, q.EnablePartitioning
    };

    [Fact]
    public async Task A_queue_created_with_options_is_created_with_every_one_of_them()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        CreateQueueOptions? sent = null;
        admin.Setup(a => a.CreateQueueAsync(It.IsAny<CreateQueueOptions>(), It.IsAny<CancellationToken>()))
            .Callback((CreateQueueOptions o, CancellationToken _) => sent = o)
            .Returns(Ok(ConfiguredQueue()));

        await AzureServiceBusProvider.CreateQueueCoreAsync(admin.Object, "orders", new QueueCreateOptions
        {
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(30),
            LockDuration = TimeSpan.FromSeconds(45),
            MaxDeliveryCount = 3,
            RequiresSession = true,
            EnablePartitioning = true,
            DeadLetteringOnMessageExpiration = true,
            RequiresDuplicateDetection = true,
            DuplicateDetectionHistoryTimeWindow = TimeSpan.FromMinutes(10),
            MaxSizeInMegabytes = 2048,
            AutoDeleteOnIdle = TimeSpan.FromDays(7),
            EnableBatchedOperations = false,
            ForwardTo = "orders-archive",
            ForwardDeadLetteredMessagesTo = "orders-poison",
            UserMetadata = "owned by billing"
        });

        Assert.NotNull(sent);
        Assert.Equal(
            ("orders", TimeSpan.FromMinutes(30), TimeSpan.FromSeconds(45), 3, true, true, true),
            (sent.Name, sent.DefaultMessageTimeToLive, sent.LockDuration, sent.MaxDeliveryCount, sent.RequiresSession, sent.EnablePartitioning, sent.DeadLetteringOnMessageExpiration));
        Assert.Equal(
            (true, TimeSpan.FromMinutes(10), 2048L, TimeSpan.FromDays(7), false),
            (sent.RequiresDuplicateDetection, sent.DuplicateDetectionHistoryTimeWindow, sent.MaxSizeInMegabytes, sent.AutoDeleteOnIdle, sent.EnableBatchedOperations));
        Assert.Equal(("orders-archive", "orders-poison", "owned by billing"), (sent.ForwardTo, sent.ForwardDeadLetteredMessagesTo, sent.UserMetadata));
    }

    [Fact]
    public async Task A_topic_created_with_options_is_created_with_every_one_of_them()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        CreateTopicOptions? sent = null;
        admin.Setup(a => a.CreateTopicAsync(It.IsAny<CreateTopicOptions>(), It.IsAny<CancellationToken>()))
            .Callback((CreateTopicOptions o, CancellationToken _) => sent = o)
            .Returns(Ok(ConfiguredTopic()));

        await AzureServiceBusProvider.CreateTopicCoreAsync(admin.Object, "events", new TopicCreateOptions
        {
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(30),
            EnablePartitioning = true,
            RequiresDuplicateDetection = true,
            DuplicateDetectionHistoryTimeWindow = TimeSpan.FromMinutes(10),
            MaxSizeInMegabytes = 2048,
            AutoDeleteOnIdle = TimeSpan.FromDays(7),
            EnableBatchedOperations = false,
            SupportOrdering = true,
            UserMetadata = "owned by billing"
        });

        Assert.NotNull(sent);
        Assert.Equal(
            ("events", TimeSpan.FromMinutes(30), true, true, TimeSpan.FromMinutes(10)),
            (sent.Name, sent.DefaultMessageTimeToLive, sent.EnablePartitioning, sent.RequiresDuplicateDetection, sent.DuplicateDetectionHistoryTimeWindow));
        Assert.Equal(
            (2048L, TimeSpan.FromDays(7), false, true, "owned by billing"),
            (sent.MaxSizeInMegabytes, sent.AutoDeleteOnIdle, sent.EnableBatchedOperations, sent.SupportOrdering, sent.UserMetadata));
    }

    [Fact]
    public async Task A_subscription_created_with_options_is_created_with_every_one_of_them()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        CreateSubscriptionOptions? sent = null;
        admin.Setup(a => a.CreateSubscriptionAsync(It.IsAny<CreateSubscriptionOptions>(), It.IsAny<CancellationToken>()))
            .Callback((CreateSubscriptionOptions o, CancellationToken _) => sent = o)
            .Returns(Ok(ConfiguredSubscription()));

        await AzureServiceBusProvider.CreateSubscriptionCoreAsync(admin.Object, "events", "audit", new SubscriptionCreateOptions
        {
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(30),
            LockDuration = TimeSpan.FromSeconds(45),
            MaxDeliveryCount = 3,
            RequiresSession = true,
            DeadLetteringOnMessageExpiration = true,
            DeadLetteringOnFilterEvaluationExceptions = false,
            AutoDeleteOnIdle = TimeSpan.FromDays(7),
            EnableBatchedOperations = false,
            ForwardTo = "audit-archive",
            ForwardDeadLetteredMessagesTo = "audit-poison",
            UserMetadata = "owned by compliance"
        });

        Assert.NotNull(sent);
        Assert.Equal(
            ("events", "audit", TimeSpan.FromMinutes(30), TimeSpan.FromSeconds(45), 3, true),
            (sent.TopicName, sent.SubscriptionName, sent.DefaultMessageTimeToLive, sent.LockDuration, sent.MaxDeliveryCount, sent.RequiresSession));
        Assert.Equal(
            (true, false, TimeSpan.FromDays(7), false),
            (sent.DeadLetteringOnMessageExpiration, sent.EnableDeadLetteringOnFilterEvaluationExceptions, sent.AutoDeleteOnIdle, sent.EnableBatchedOperations));
        Assert.Equal(("audit-archive", "audit-poison", "owned by compliance"), (sent.ForwardTo, sent.ForwardDeadLetteredMessagesTo, sent.UserMetadata));
    }

    [Fact]
    public async Task Creating_a_queue_that_already_exists_reports_already_exists_without_the_broker_text()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.CreateQueueAsync(It.IsAny<CreateQueueOptions>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<QueueProperties>>(Broker(ServiceBusFailureReason.MessagingEntityAlreadyExists)));
        admin.Setup(a => a.CreateQueueAsync("orders", It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<QueueProperties>>(Broker(ServiceBusFailureReason.MessagingEntityAlreadyExists)));

        var withOptions = await Assert.ThrowsAsync<EntityAlreadyExistsException>(() =>
            AzureServiceBusProvider.CreateQueueCoreAsync(admin.Object, "orders", new QueueCreateOptions { MaxDeliveryCount = 3 }));
        var byName = await Assert.ThrowsAsync<EntityAlreadyExistsException>(() =>
            AzureServiceBusProvider.CreateQueueCoreAsync(admin.Object, "orders", null));

        Assert.DoesNotContain(BrokerText, withOptions.Message);
        Assert.DoesNotContain(BrokerText, byName.Message);
    }

    [Fact]
    public async Task Creating_a_subscription_under_a_missing_topic_reports_not_found()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.CreateSubscriptionAsync(It.IsAny<CreateSubscriptionOptions>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<SubscriptionProperties>>(Broker(ServiceBusFailureReason.MessagingEntityNotFound)));

        var error = await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            AzureServiceBusProvider.CreateSubscriptionCoreAsync(admin.Object, "missing", "audit", new SubscriptionCreateOptions()));

        Assert.DoesNotContain(BrokerText, error.Message);
    }

    [Fact]
    public async Task A_create_the_broker_refuses_reports_the_fixed_refusal_and_keeps_the_broker_text_out_of_the_message()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.CreateTopicAsync(It.IsAny<CreateTopicOptions>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<TopicProperties>>(new ArgumentException(BrokerText)));

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            AzureServiceBusProvider.CreateTopicCoreAsync(admin.Object, "events", new TopicCreateOptions { MaxSizeInMegabytes = 3000 }));

        Assert.Equal("The broker refused this configuration.", error.Message);
        Assert.IsType<ArgumentException>(error.InnerException);
    }

    [Fact]
    public async Task Editing_lock_duration_max_delivery_count_and_time_to_live_changes_only_those_three()
    {
        var written = new List<QueueProperties>();
        var admin = QueueAdmin(() => Ok(ConfiguredQueue()), written);

        await AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions
        {
            LockDuration = TimeSpan.FromMinutes(2),
            MaxDeliveryCount = 10,
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(45)
        }, CancellationToken.None);

        var expected = ConfiguredQueue();
        expected.LockDuration = TimeSpan.FromMinutes(2);
        expected.MaxDeliveryCount = 10;
        expected.DefaultMessageTimeToLive = TimeSpan.FromMinutes(45);
        var sent = Assert.Single(written);
        Assert.Equal(Settings(expected), Settings(sent));
    }

    [Fact]
    public async Task Editing_a_queue_reads_it_once_and_writes_it_once()
    {
        var written = new List<QueueProperties>();
        var admin = QueueAdmin(() => Ok(ConfiguredQueue()), written);

        await AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { UserMetadata = "owned by payments" }, CancellationToken.None);

        Assert.Equal("owned by payments", Assert.Single(written).UserMetadata);
        admin.Verify(a => a.GetQueueAsync("orders", It.IsAny<CancellationToken>()), Times.Once);
        admin.Verify(a => a.UpdateQueueAsync(It.IsAny<QueueProperties>(), It.IsAny<CancellationToken>()), Times.Once);
        admin.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task An_empty_forward_target_clears_it_and_an_absent_one_keeps_it()
    {
        var written = new List<QueueProperties>();
        var admin = QueueAdmin(() => Ok(ConfiguredQueue()), written);

        await AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { ForwardTo = "" }, CancellationToken.None);

        var sent = Assert.Single(written);
        Assert.Null(sent.ForwardTo);
        Assert.Equal("orders-poison", sent.ForwardDeadLetteredMessagesTo);
    }

    public static TheoryData<string, EntityStatus> QueueStatuses => new()
    {
        { "Active", EntityStatus.Active },
        { "Disabled", EntityStatus.Disabled },
        { "SendDisabled", EntityStatus.SendDisabled },
        { "ReceiveDisabled", EntityStatus.ReceiveDisabled }
    };

    [Theory]
    [MemberData(nameof(QueueStatuses))]
    public async Task A_queue_is_enabled_or_disabled_by_its_status(string status, EntityStatus expected)
    {
        var written = new List<QueueProperties>();
        var start = ConfiguredQueue();
        start.Status = expected == EntityStatus.Active ? EntityStatus.Disabled : EntityStatus.Active;
        var admin = QueueAdmin(() => Ok(start), written);

        await AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { Status = status }, CancellationToken.None);

        Assert.Equal(expected, Assert.Single(written).Status);
    }

    [Fact]
    public async Task Editing_a_topic_changes_only_the_fields_sent_and_its_status()
    {
        TopicProperties? sent = null;
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetTopicAsync("events", It.IsAny<CancellationToken>())).Returns(Ok(ConfiguredTopic()));
        admin.Setup(a => a.UpdateTopicAsync(It.IsAny<TopicProperties>(), It.IsAny<CancellationToken>()))
            .Callback((TopicProperties t, CancellationToken _) => sent = t)
            .Returns(Ok(ConfiguredTopic()));

        await AzureServiceBusProvider.UpdateTopicCoreAsync(admin.Object, "events", new TopicUpdateOptions
        {
            SupportOrdering = true,
            MaxSizeInMegabytes = 4096,
            Status = "SendDisabled"
        }, CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal((true, 4096L, EntityStatus.SendDisabled), (sent.SupportOrdering, sent.MaxSizeInMegabytes, sent.Status));
        Assert.Equal(
            (TimeSpan.FromMinutes(30), TimeSpan.FromDays(7), TimeSpan.FromMinutes(10), true, true),
            (sent.DefaultMessageTimeToLive, sent.AutoDeleteOnIdle, sent.DuplicateDetectionHistoryTimeWindow, sent.EnableBatchedOperations, sent.RequiresDuplicateDetection));
        admin.Verify(a => a.GetTopicAsync("events", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Editing_a_subscription_changes_only_the_fields_sent_clears_an_empty_forward_target_and_sets_its_status()
    {
        SubscriptionProperties? sent = null;
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetSubscriptionAsync("events", "audit", It.IsAny<CancellationToken>())).Returns(Ok(ConfiguredSubscription()));
        admin.Setup(a => a.UpdateSubscriptionAsync(It.IsAny<SubscriptionProperties>(), It.IsAny<CancellationToken>()))
            .Callback((SubscriptionProperties s, CancellationToken _) => sent = s)
            .Returns(Ok(ConfiguredSubscription()));

        await AzureServiceBusProvider.UpdateSubscriptionCoreAsync(admin.Object, "events", "audit", new SubscriptionUpdateOptions
        {
            LockDuration = TimeSpan.FromMinutes(1),
            DeadLetteringOnFilterEvaluationExceptions = false,
            ForwardDeadLetteredMessagesTo = "",
            Status = "ReceiveDisabled"
        }, CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal((TimeSpan.FromMinutes(1), false, (string?)null, EntityStatus.ReceiveDisabled),
            (sent.LockDuration, sent.EnableDeadLetteringOnFilterEvaluationExceptions, sent.ForwardDeadLetteredMessagesTo, sent.Status));
        Assert.Equal(
            (3, TimeSpan.FromMinutes(30), TimeSpan.FromDays(7), true, true, "audit-archive", "owned by compliance"),
            (sent.MaxDeliveryCount, sent.DefaultMessageTimeToLive, sent.AutoDeleteOnIdle, sent.DeadLetteringOnMessageExpiration, sent.EnableBatchedOperations, sent.ForwardTo, sent.UserMetadata));
    }

    [Fact]
    public async Task Editing_a_missing_queue_reports_not_found_and_writes_nothing()
    {
        var written = new List<QueueProperties>();
        var admin = QueueAdmin(() => Task.FromException<Response<QueueProperties>>(Broker(ServiceBusFailureReason.MessagingEntityNotFound)), written);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { MaxDeliveryCount = 5 }, CancellationToken.None));

        Assert.Empty(written);
    }

    [Fact]
    public async Task A_failing_read_before_an_edit_reaches_the_caller_unchanged_and_writes_nothing()
    {
        var written = new List<QueueProperties>();
        var admin = QueueAdmin(() => Task.FromException<Response<QueueProperties>>(Broker(ServiceBusFailureReason.ServiceBusy)), written);

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { MaxDeliveryCount = 5 }, CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
        Assert.Empty(written);
    }

    [Fact]
    public async Task A_write_that_fails_because_the_broker_is_busy_reaches_the_caller_unchanged()
    {
        var written = new List<QueueProperties>();
        var admin = QueueAdmin(() => Ok(ConfiguredQueue()), written, Broker(ServiceBusFailureReason.ServiceBusy));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { MaxDeliveryCount = 5 }, CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task A_write_the_broker_refuses_reports_the_fixed_refusal_with_the_broker_text_only_inside()
    {
        var written = new List<QueueProperties>();
        var admin = QueueAdmin(() => Ok(ConfiguredQueue()), written, new ArgumentException(BrokerText));

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { MaxSizeInMegabytes = 3000 }, CancellationToken.None));

        Assert.Equal("The broker refused this configuration.", error.Message);
        Assert.Equal(BrokerText, error.InnerException?.Message);
    }

    [Theory]
    [InlineData("sb://contoso.servicebus.windows.net/orders-archive", "orders-archive")]
    [InlineData("https://contoso.servicebus.windows.net/orders-archive", "orders-archive")]
    [InlineData("orders-archive", "orders-archive")]
    [InlineData("http://contoso.servicebus.windows.net/billing/orders%20archive", "billing/orders archive")]
    [InlineData("billing/orders-archive", "billing/orders-archive")]
    [InlineData(null, null)]
    [InlineData("", null)]
    public void A_forward_target_is_read_as_the_bare_entity_name(string? returned, string? expected)
    {
        Assert.Equal(expected, AzureServiceBusProvider.ToEntityPath(returned));
    }

    [Fact]
    public async Task Queue_details_carry_the_forward_targets_as_entity_names_not_addresses()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        var queue = ConfiguredQueue();
        queue.ForwardTo = "sb://contoso.servicebus.windows.net/orders-archive";
        queue.ForwardDeadLetteredMessagesTo = "https://contoso.servicebus.windows.net/billing/orders-poison";
        admin.Setup(a => a.GetQueueAsync("orders", It.IsAny<CancellationToken>())).Returns(Ok(queue));
        admin.Setup(a => a.GetQueueRuntimePropertiesAsync("orders", It.IsAny<CancellationToken>()))
            .Returns(Ok(ServiceBusModelFactory.QueueRuntimeProperties(name: "orders")));

        var read = await AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, "orders");

        Assert.NotNull(read);
        Assert.Equal(("orders-archive", "billing/orders-poison"), (read.ForwardTo, read.ForwardDeadLetteredMessagesTo));
    }

    [Fact]
    public void Subscription_details_carry_the_forward_targets_as_entity_names_not_addresses()
    {
        var subscription = ConfiguredSubscription();
        subscription.ForwardTo = "sb://contoso.servicebus.windows.net/audit-archive";
        subscription.ForwardDeadLetteredMessagesTo = null;

        var read = AzureServiceBusProvider.MapToSubscriptionInfo(subscription,
            ServiceBusModelFactory.SubscriptionRuntimeProperties(topicName: "events", subscriptionName: "audit"));

        Assert.Equal(("audit-archive", (string?)null), (read.ForwardTo, read.ForwardDeadLetteredMessagesTo));
    }

    [Theory]
    [InlineData("create a queue with a lock of six minutes", "lockDuration must be between 00:00:05 and 00:05:00.")]
    [InlineData("create a queue by a name that starts with a slash", "name must be 1 to 260 characters of letters, digits, '.', '-', '_' or '/', not starting or ending with '/'.")]
    [InlineData("create a topic of zero megabytes", "maxSizeInMegabytes must be a positive whole number.")]
    [InlineData("create a subscription with a 51-character name", "name must be 1 to 50 characters of letters, digits, '.', '-' or '_'.")]
    [InlineData("edit a queue to forward to itself", "forwardTo must not be the queue itself.")]
    [InlineData("edit a queue with two values out of range", "defaultMessageTimeToLive must be at least 00:00:01. maxDeliveryCount must be between 1 and 2000.")]
    [InlineData("disable receiving on a topic", "status must be one of Active, Disabled, SendDisabled.")]
    [InlineData("disable sending on a subscription", "status must be one of Active, Disabled, ReceiveDisabled.")]
    public async Task A_configuration_outside_the_azure_limits_is_refused_with_the_field_and_the_range_and_nothing_reaches_the_broker(string request, string message)
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        Func<Task> call = request switch
        {
            "create a queue with a lock of six minutes" => () => AzureServiceBusProvider.CreateQueueCoreAsync(admin.Object, "orders", new QueueCreateOptions { LockDuration = TimeSpan.FromMinutes(6) }),
            "create a queue by a name that starts with a slash" => () => AzureServiceBusProvider.CreateQueueCoreAsync(admin.Object, "/orders", null),
            "create a topic of zero megabytes" => () => AzureServiceBusProvider.CreateTopicCoreAsync(admin.Object, "events", new TopicCreateOptions { MaxSizeInMegabytes = 0 }),
            "create a subscription with a 51-character name" => () => AzureServiceBusProvider.CreateSubscriptionCoreAsync(admin.Object, "events", new string('s', 51), null),
            "edit a queue to forward to itself" => () => AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { ForwardTo = "orders" }, CancellationToken.None),
            "edit a queue with two values out of range" => () => AzureServiceBusProvider.UpdateQueueCoreAsync(admin.Object, "orders", new QueueUpdateOptions { DefaultMessageTimeToLive = TimeSpan.Zero, MaxDeliveryCount = 0 }, CancellationToken.None),
            "disable receiving on a topic" => () => AzureServiceBusProvider.UpdateTopicCoreAsync(admin.Object, "events", new TopicUpdateOptions { Status = "ReceiveDisabled" }, CancellationToken.None),
            _ => () => AzureServiceBusProvider.UpdateSubscriptionCoreAsync(admin.Object, "events", "audit", new SubscriptionUpdateOptions { Status = "SendDisabled" }, CancellationToken.None)
        };

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(call);

        Assert.Equal(message, error.Message);
        Assert.Empty(admin.Invocations);
    }
}
