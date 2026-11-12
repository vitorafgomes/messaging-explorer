using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// A value out of range is refused with the field and the range, at the boundary of every limit; a value
/// just inside passes.
/// </summary>
public class EntityConfigurationValidatorTests
{
    private const string LockRange = "lockDuration must be between 00:00:05 and 00:05:00.";
    private const string DeliveryRange = "maxDeliveryCount must be between 1 and 2000.";
    private const string TtlRange = "defaultMessageTimeToLive must be at least 00:00:01.";
    private const string AutoDeleteRange = "autoDeleteOnIdle must be at least 00:05:00.";
    private const string WindowRange = "duplicateDetectionHistoryTimeWindow must be between 00:00:20 and 7.00:00:00.";
    private const string SizeRange = "maxSizeInMegabytes must be a positive whole number.";
    private const string MetadataRange = "userMetadata must be at most 1024 characters.";
    private const string EntityNameRule = "name must be 1 to 260 characters of letters, digits, '.', '-', '_' or '/', not starting or ending with '/'.";
    private const string SubscriptionNameRule = "name must be 1 to 50 characters of letters, digits, '.', '-' or '_'.";

    private static string[] Expected(string? violation) => violation is null ? [] : [violation];

    private static IReadOnlyList<string> QueueUpdate(QueueUpdateOptions options) =>
        EntityConfigurationValidator.ValidateQueueUpdate("orders", options);

    [Theory]
    [InlineData("00:00:05", null)]
    [InlineData("00:00:04.9999999", LockRange)]
    [InlineData("00:05:00", null)]
    [InlineData("00:05:00.0000001", LockRange)]
    public void Lock_duration_is_5_seconds_to_5_minutes(string value, string? violation)
    {
        Assert.Equal(Expected(violation), QueueUpdate(new QueueUpdateOptions { LockDuration = TimeSpan.Parse(value) }));
    }

    [Theory]
    [InlineData(1, null)]
    [InlineData(0, DeliveryRange)]
    [InlineData(2000, null)]
    [InlineData(2001, DeliveryRange)]
    public void Max_delivery_count_is_1_to_2000(int value, string? violation)
    {
        Assert.Equal(Expected(violation), QueueUpdate(new QueueUpdateOptions { MaxDeliveryCount = value }));
    }

    [Theory]
    [InlineData("00:00:01", null)]
    [InlineData("00:00:00.9999999", TtlRange)]
    [InlineData("-00:00:01", TtlRange)]
    public void Default_message_time_to_live_is_at_least_1_second(string value, string? violation)
    {
        Assert.Equal(Expected(violation), QueueUpdate(new QueueUpdateOptions { DefaultMessageTimeToLive = TimeSpan.Parse(value) }));
    }

    [Theory]
    [InlineData("00:05:00", null)]
    [InlineData("00:04:59.9999999", AutoDeleteRange)]
    public void Auto_delete_on_idle_is_at_least_5_minutes(string value, string? violation)
    {
        Assert.Equal(Expected(violation), QueueUpdate(new QueueUpdateOptions { AutoDeleteOnIdle = TimeSpan.Parse(value) }));
    }

    [Theory]
    [InlineData("00:00:20", null)]
    [InlineData("00:00:19.9999999", WindowRange)]
    [InlineData("7.00:00:00", null)]
    [InlineData("7.00:00:00.0000001", WindowRange)]
    public void Duplicate_detection_history_time_window_is_20_seconds_to_7_days(string value, string? violation)
    {
        Assert.Equal(Expected(violation), QueueUpdate(new QueueUpdateOptions { DuplicateDetectionHistoryTimeWindow = TimeSpan.Parse(value) }));
    }

    [Theory]
    [InlineData(1L, null)]
    [InlineData(0L, SizeRange)]
    [InlineData(-1024L, SizeRange)]
    public void Max_size_in_megabytes_is_a_positive_whole_number(long value, string? violation)
    {
        Assert.Equal(Expected(violation), QueueUpdate(new QueueUpdateOptions { MaxSizeInMegabytes = value }));
    }

    [Theory]
    [InlineData(1024, null)]
    [InlineData(1025, MetadataRange)]
    public void User_metadata_is_at_most_1024_characters(int length, string? violation)
    {
        Assert.Equal(Expected(violation), QueueUpdate(new QueueUpdateOptions { UserMetadata = new string('m', length) }));
    }

    [Fact]
    public void An_update_that_sends_no_field_has_nothing_to_refuse()
    {
        Assert.Empty(QueueUpdate(new QueueUpdateOptions()));
    }

    [Fact]
    public void Every_violation_of_one_request_is_reported_not_only_the_first()
    {
        var errors = QueueUpdate(new QueueUpdateOptions { LockDuration = TimeSpan.Zero, MaxDeliveryCount = 0 });

        Assert.Equal([LockRange, DeliveryRange], errors);
    }

    [Theory]
    [InlineData(null, "name is required.")]
    [InlineData("", "name is required.")]
    [InlineData("a", null)]
    [InlineData("orders.v1-eu_west/inbox", null)]
    [InlineData("/orders", EntityNameRule)]
    [InlineData("orders/", EntityNameRule)]
    [InlineData("my queue", EntityNameRule)]
    [InlineData("orders#1", EntityNameRule)]
    [InlineData("pedidos-ç", EntityNameRule)]
    public void A_queue_or_topic_name_is_letters_digits_dot_dash_underscore_and_inner_slashes(string? name, string? violation)
    {
        Assert.Equal(Expected(violation), EntityConfigurationValidator.ValidateQueueCreate(name, null));
        Assert.Equal(Expected(violation), EntityConfigurationValidator.ValidateTopicCreate(name, null));
    }

    [Theory]
    [InlineData(260, null)]
    [InlineData(261, EntityNameRule)]
    public void A_queue_or_topic_name_is_at_most_260_characters(int length, string? violation)
    {
        var name = new string('q', length);

        Assert.Equal(Expected(violation), EntityConfigurationValidator.ValidateQueueCreate(name, null));
        Assert.Equal(Expected(violation), EntityConfigurationValidator.ValidateTopicCreate(name, null));
    }

    [Theory]
    [InlineData(null, "name is required.")]
    [InlineData("audit.v1-eu_west", null)]
    [InlineData("audit/eu", SubscriptionNameRule)]
    [InlineData("audit eu", SubscriptionNameRule)]
    public void A_subscription_name_is_letters_digits_dot_dash_and_underscore(string? name, string? violation)
    {
        Assert.Equal(Expected(violation), EntityConfigurationValidator.ValidateSubscriptionCreate("events", name, null));
    }

    [Theory]
    [InlineData(50, null)]
    [InlineData(51, SubscriptionNameRule)]
    public void A_subscription_name_is_at_most_50_characters(int length, string? violation)
    {
        Assert.Equal(Expected(violation), EntityConfigurationValidator.ValidateSubscriptionCreate("events", new string('s', length), null));
    }

    [Theory]
    [InlineData("orders-archive", null)]
    [InlineData("", null)]
    [InlineData("ORDERS", "forwardTo must not be the queue itself.")]
    [InlineData("sb://elsewhere/orders", "forwardTo must be a queue or topic name of 1 to 260 characters of letters, digits, '.', '-', '_' or '/', not starting or ending with '/'.")]
    public void A_queue_forwards_to_a_queue_or_topic_name_and_never_to_itself(string target, string? violation)
    {
        Assert.Equal(Expected(violation), QueueUpdate(new QueueUpdateOptions { ForwardTo = target }));
        Assert.Equal(Expected(violation?.Replace("forwardTo", "forwardDeadLetteredMessagesTo")),
            QueueUpdate(new QueueUpdateOptions { ForwardDeadLetteredMessagesTo = target }));
    }

    [Fact]
    public void A_queue_created_with_a_forward_target_naming_itself_is_refused()
    {
        var errors = EntityConfigurationValidator.ValidateQueueCreate("orders", new QueueCreateOptions { ForwardTo = "orders" });

        Assert.Equal(["forwardTo must not be the queue itself."], errors);
    }

    [Fact]
    public void A_subscription_never_forwards_to_its_own_topic()
    {
        var created = EntityConfigurationValidator.ValidateSubscriptionCreate("events", "audit", new SubscriptionCreateOptions { ForwardTo = "events" });
        var updated = EntityConfigurationValidator.ValidateSubscriptionUpdate("events", new SubscriptionUpdateOptions { ForwardDeadLetteredMessagesTo = "Events" });
        var toQueueOfSameName = EntityConfigurationValidator.ValidateSubscriptionUpdate("events", new SubscriptionUpdateOptions { ForwardTo = "audit" });

        Assert.Equal(["forwardTo must not be the topic of the subscription."], created);
        Assert.Equal(["forwardDeadLetteredMessagesTo must not be the topic of the subscription."], updated);
        Assert.Empty(toQueueOfSameName);
    }

    [Theory]
    [InlineData("Active", true)]
    [InlineData("Disabled", true)]
    [InlineData("SendDisabled", true)]
    [InlineData("ReceiveDisabled", true)]
    [InlineData("active", false)]
    [InlineData("Paused", false)]
    public void A_queue_status_is_one_of_the_four_queue_states(string status, bool allowed)
    {
        Assert.Equal(Expected(allowed ? null : "status must be one of Active, Disabled, SendDisabled, ReceiveDisabled."),
            QueueUpdate(new QueueUpdateOptions { Status = status }));
    }

    [Theory]
    [InlineData("Active", true)]
    [InlineData("Disabled", true)]
    [InlineData("SendDisabled", true)]
    [InlineData("ReceiveDisabled", false)]
    public void A_topic_status_is_active_disabled_or_send_disabled(string status, bool allowed)
    {
        Assert.Equal(Expected(allowed ? null : "status must be one of Active, Disabled, SendDisabled."),
            EntityConfigurationValidator.ValidateTopicUpdate(new TopicUpdateOptions { Status = status }));
    }

    [Theory]
    [InlineData("Active", true)]
    [InlineData("Disabled", true)]
    [InlineData("ReceiveDisabled", true)]
    [InlineData("SendDisabled", false)]
    public void A_subscription_status_is_active_disabled_or_receive_disabled(string status, bool allowed)
    {
        Assert.Equal(Expected(allowed ? null : "status must be one of Active, Disabled, ReceiveDisabled."),
            EntityConfigurationValidator.ValidateSubscriptionUpdate("events", new SubscriptionUpdateOptions { Status = status }));
    }

    [Fact]
    public void Every_create_and_update_kind_applies_the_limits_of_its_own_fields()
    {
        Assert.Equal([LockRange], EntityConfigurationValidator.ValidateQueueCreate("orders", new QueueCreateOptions { LockDuration = TimeSpan.FromMinutes(6) }));
        Assert.Equal([WindowRange], EntityConfigurationValidator.ValidateTopicCreate("events", new TopicCreateOptions { DuplicateDetectionHistoryTimeWindow = TimeSpan.FromDays(8) }));
        Assert.Equal([SizeRange], EntityConfigurationValidator.ValidateTopicUpdate(new TopicUpdateOptions { MaxSizeInMegabytes = 0 }));
        Assert.Equal([DeliveryRange], EntityConfigurationValidator.ValidateSubscriptionCreate("events", "audit", new SubscriptionCreateOptions { MaxDeliveryCount = 2001 }));
        Assert.Equal([AutoDeleteRange], EntityConfigurationValidator.ValidateSubscriptionUpdate("events", new SubscriptionUpdateOptions { AutoDeleteOnIdle = TimeSpan.FromMinutes(1) }));
        Assert.Equal([MetadataRange], EntityConfigurationValidator.ValidateTopicCreate("events", new TopicCreateOptions { UserMetadata = new string('m', 1025) }));
    }
}
