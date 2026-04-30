using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Azure Service Bus topic information implementing the abstract topic entity interface.
/// </summary>
public class TopicInfo : ITopicEntity
{
    // IMessagingEntity properties
    public string Name { get; set; } = string.Empty;
    public long SizeInBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset AccessedAt { get; set; }
    public string Status { get; set; } = string.Empty;
    public bool EnablePartitioning { get; set; }

    // ITopicEntity properties
    public int SubscriptionCount { get; set; }
    public long ScheduledMessageCount { get; set; }
    public TimeSpan DefaultMessageTimeToLive { get; set; }
    public TimeSpan AutoDeleteOnIdle { get; set; }
    public TimeSpan DuplicateDetectionHistoryTimeWindow { get; set; }
    public long MaxSizeInMegabytes { get; set; }
    public long MaxMessageSizeInKilobytes { get; set; }
    public bool RequiresDuplicateDetection { get; set; }
    public bool EnableBatchedOperations { get; set; }
    public bool SupportOrdering { get; set; }
    public bool EnableExpress { get; set; }
    public string UserMetadata { get; set; } = string.Empty;

    // Azure-specific: Subscriptions collection
    public List<SubscriptionInfo> Subscriptions { get; set; } = new();
}
