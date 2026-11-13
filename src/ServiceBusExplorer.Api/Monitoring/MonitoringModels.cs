using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Monitoring;

public class MonitoringSnapshot
{
    public DateTimeOffset Timestamp { get; set; }
    public List<MonitoringEntityDto> Queues { get; set; } = [];
    public List<MonitoringSubscriptionDto> Subscriptions { get; set; } = [];
}

/// <summary>
/// What the snapshot route answers: the latest snapshot, null until a poll has collected one; the time between two
/// polls; and when the last poll failed, null once a later poll succeeded.
/// </summary>
public class MonitoringStatus
{
    public MonitoringSnapshot? Snapshot { get; set; }
    public int PollIntervalSeconds { get; set; }
    public DateTimeOffset? LastPollFailedAt { get; set; }
}

/// <summary>
/// The counts of one entity. A null count is one the broker does not count for this entity: scheduled messages of
/// a subscription, and whatever the provider's capabilities say it does not have.
/// </summary>
public class MonitoringEntityDto
{
    public string Name { get; set; } = string.Empty;
    public long ActiveMessageCount { get; set; }
    public long DeadLetterMessageCount { get; set; }
    public long TransferMessageCount { get; set; }
    public long? ScheduledMessageCount { get; set; }
    public long? TransferDeadLetterMessageCount { get; set; }

    public static MonitoringEntityDto FromQueue(IQueueEntity queue, IProviderCapabilities capabilities) => new()
    {
        Name = queue.Name,
        ActiveMessageCount = queue.ActiveMessageCount,
        DeadLetterMessageCount = queue.DeadLetterMessageCount,
        TransferMessageCount = queue.TransferMessageCount,
        ScheduledMessageCount = capabilities.SupportsScheduledMessages ? queue.ScheduledMessageCount : null,
        TransferDeadLetterMessageCount = capabilities.SupportsTransferDeadLetter ? queue.TransferDeadLetterMessageCount : null
    };
}

public class MonitoringSubscriptionDto : MonitoringEntityDto
{
    public string TopicName { get; set; } = string.Empty;

    /// <summary>
    /// The scheduled count is always null: the broker's subscription runtime properties carry none.
    /// </summary>
    public static MonitoringSubscriptionDto FromSubscription(string topicName, SubscriptionInfo subscription, IProviderCapabilities capabilities) => new()
    {
        TopicName = topicName,
        Name = subscription.Name,
        ActiveMessageCount = subscription.ActiveMessageCount,
        DeadLetterMessageCount = subscription.DeadLetterMessageCount,
        TransferMessageCount = subscription.TransferMessageCount,
        ScheduledMessageCount = null,
        TransferDeadLetterMessageCount = capabilities.SupportsTransferDeadLetter ? subscription.TransferDeadLetterMessageCount : null
    };
}
