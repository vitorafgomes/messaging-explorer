namespace ServiceBusExplorer.Core.Abstractions;

/// <summary>
/// Interface for queue entities across messaging providers.
/// Extends <see cref="IMessagingEntity"/> with queue-specific properties.
/// </summary>
public interface IQueueEntity : IMessagingEntity
{
    /// <summary>
    /// The number of active messages in the queue ready for delivery.
    /// </summary>
    long ActiveMessageCount { get; }

    /// <summary>
    /// The number of messages in the dead letter queue.
    /// </summary>
    long DeadLetterMessageCount { get; }

    /// <summary>
    /// The number of scheduled messages waiting for their scheduled time.
    /// </summary>
    long ScheduledMessageCount { get; }

    /// <summary>
    /// The number of messages being transferred to another queue or topic.
    /// </summary>
    long TransferMessageCount { get; }

    /// <summary>
    /// The default time-to-live for messages sent to this queue.
    /// </summary>
    TimeSpan DefaultMessageTimeToLive { get; }

    /// <summary>
    /// The duration for which a message is locked for processing.
    /// </summary>
    TimeSpan LockDuration { get; }

    /// <summary>
    /// The maximum number of delivery attempts before a message is dead-lettered.
    /// </summary>
    int MaxDeliveryCount { get; }

    /// <summary>
    /// The maximum size of the queue in megabytes.
    /// </summary>
    long MaxSizeInMegabytes { get; }

    /// <summary>
    /// Indicates whether the queue requires sessions for message processing.
    /// </summary>
    bool RequiresSession { get; }

    /// <summary>
    /// Indicates whether messages are dead-lettered when they expire.
    /// </summary>
    bool DeadLetteringOnMessageExpiration { get; }
}
