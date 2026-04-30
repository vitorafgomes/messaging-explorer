namespace ServiceBusExplorer.Core.Abstractions;

/// <summary>
/// Interface for topic/exchange entities across messaging providers.
/// Extends <see cref="IMessagingEntity"/> with topic-specific properties.
/// For RabbitMQ, this maps to exchanges with their bindings.
/// </summary>
public interface ITopicEntity : IMessagingEntity
{
    /// <summary>
    /// The number of subscriptions/bindings for this topic.
    /// </summary>
    int SubscriptionCount { get; }

    /// <summary>
    /// The number of scheduled messages waiting for their scheduled time.
    /// </summary>
    long ScheduledMessageCount { get; }

    /// <summary>
    /// The default time-to-live for messages published to this topic.
    /// </summary>
    TimeSpan DefaultMessageTimeToLive { get; }

    /// <summary>
    /// The idle interval after which the topic is automatically deleted.
    /// </summary>
    TimeSpan AutoDeleteOnIdle { get; }

    /// <summary>
    /// The time window for duplicate detection history.
    /// </summary>
    TimeSpan DuplicateDetectionHistoryTimeWindow { get; }

    /// <summary>
    /// The maximum size of the topic in megabytes.
    /// </summary>
    long MaxSizeInMegabytes { get; }

    /// <summary>
    /// The maximum size of a message in kilobytes.
    /// </summary>
    long MaxMessageSizeInKilobytes { get; }

    /// <summary>
    /// Indicates whether duplicate detection is required.
    /// </summary>
    bool RequiresDuplicateDetection { get; }

    /// <summary>
    /// Indicates whether batched operations are enabled for improved throughput.
    /// </summary>
    bool EnableBatchedOperations { get; }

    /// <summary>
    /// Indicates whether message ordering is supported.
    /// </summary>
    bool SupportOrdering { get; }

    /// <summary>
    /// Indicates whether express mode is enabled (messages kept in memory).
    /// </summary>
    bool EnableExpress { get; }

    /// <summary>
    /// User-defined metadata associated with the topic.
    /// </summary>
    string UserMetadata { get; }
}
