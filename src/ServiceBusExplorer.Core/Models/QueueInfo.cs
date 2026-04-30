using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Azure Service Bus queue information implementing the abstract queue entity interface.
/// </summary>
public class QueueInfo : IQueueEntity
{
    // IMessagingEntity properties
    public string Name { get; set; } = string.Empty;
    public long SizeInBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset AccessedAt { get; set; }
    public string Status { get; set; } = string.Empty;
    public bool EnablePartitioning { get; set; }

    // IQueueEntity properties
    public long ActiveMessageCount { get; set; }
    public long DeadLetterMessageCount { get; set; }
    public long ScheduledMessageCount { get; set; }
    public long TransferMessageCount { get; set; }
    public TimeSpan DefaultMessageTimeToLive { get; set; }
    public TimeSpan LockDuration { get; set; }
    public int MaxDeliveryCount { get; set; }
    public long MaxSizeInMegabytes { get; set; }
    public bool RequiresSession { get; set; }
    public bool DeadLetteringOnMessageExpiration { get; set; }
}
