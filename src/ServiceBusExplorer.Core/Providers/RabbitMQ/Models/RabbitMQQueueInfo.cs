using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Providers.RabbitMQ.Models;

/// <summary>
/// RabbitMQ queue information implementing the abstract queue entity interface.
/// Contains RabbitMQ-specific properties like durability, auto-delete, and exclusive settings.
/// </summary>
public class RabbitMQQueueInfo : IQueueEntity
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

    // RabbitMQ-specific properties

    /// <summary>
    /// The virtual host where this queue is located.
    /// </summary>
    public string VirtualHost { get; set; } = "/";

    /// <summary>
    /// Indicates whether the queue is durable (survives broker restart).
    /// </summary>
    public bool Durable { get; set; }

    /// <summary>
    /// Indicates whether the queue will be automatically deleted when no longer in use.
    /// </summary>
    public bool AutoDelete { get; set; }

    /// <summary>
    /// Indicates whether the queue is exclusive to the connection that created it.
    /// </summary>
    public bool Exclusive { get; set; }

    /// <summary>
    /// The number of consumers currently consuming from this queue.
    /// </summary>
    public int ConsumerCount { get; set; }

    /// <summary>
    /// The number of messages in the queue that are ready to be delivered.
    /// </summary>
    public long MessagesReady { get; set; }

    /// <summary>
    /// The number of messages in the queue that are currently being delivered to consumers.
    /// </summary>
    public long MessagesUnacknowledged { get; set; }

    /// <summary>
    /// The total number of messages in the queue (ready + unacknowledged).
    /// </summary>
    public long TotalMessages { get; set; }

    /// <summary>
    /// The name of the dead letter exchange (DLX) configured for this queue.
    /// Null if no DLX is configured.
    /// </summary>
    public string? DeadLetterExchange { get; set; }

    /// <summary>
    /// The routing key used when dead-lettering messages to the DLX.
    /// Null if no dead letter routing key is configured.
    /// </summary>
    public string? DeadLetterRoutingKey { get; set; }

    /// <summary>
    /// The message TTL (time-to-live) in milliseconds for all messages in this queue.
    /// Null if no queue-level TTL is configured.
    /// </summary>
    public long? MessageTtlMilliseconds { get; set; }

    /// <summary>
    /// The maximum length (number of messages) for this queue.
    /// Null if no limit is configured.
    /// </summary>
    public long? MaxLength { get; set; }

    /// <summary>
    /// The maximum length in bytes for this queue.
    /// Null if no limit is configured.
    /// </summary>
    public long? MaxLengthBytes { get; set; }

    /// <summary>
    /// The overflow behavior when the queue reaches its maximum length.
    /// Common values: "drop-head", "reject-publish", "reject-publish-dlx".
    /// </summary>
    public string? OverflowBehavior { get; set; }

    /// <summary>
    /// The queue type.
    /// Common values: "classic", "quorum", "stream".
    /// </summary>
    public string QueueType { get; set; } = "classic";

    /// <summary>
    /// The message delivery rate per second.
    /// </summary>
    public double MessageRateDeliver { get; set; }

    /// <summary>
    /// The message publish rate per second.
    /// </summary>
    public double MessageRatePublish { get; set; }

    /// <summary>
    /// The node where this queue is located.
    /// </summary>
    public string? Node { get; set; }

    /// <summary>
    /// The state of the queue.
    /// Common values: "running", "idle", "flow".
    /// </summary>
    public string State { get; set; } = "running";

    /// <summary>
    /// Queue arguments/options as key-value pairs.
    /// Contains all custom queue arguments set during declaration.
    /// </summary>
    public Dictionary<string, object> Arguments { get; set; } = new();
}
