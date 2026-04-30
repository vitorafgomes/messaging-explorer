namespace ServiceBusExplorer.Core.Abstractions;

/// <summary>
/// Interface for message representation across messaging providers.
/// Defines common properties shared by messages from all providers (Azure Service Bus, RabbitMQ, etc.).
/// </summary>
public interface IMessage
{
    /// <summary>
    /// The unique identifier of the message.
    /// For Azure Service Bus: MessageId property.
    /// For RabbitMQ: Typically correlation_id or custom header.
    /// </summary>
    string MessageId { get; }

    /// <summary>
    /// An identifier used to correlate messages, useful for request-reply patterns.
    /// </summary>
    string? CorrelationId { get; }

    /// <summary>
    /// The content type of the message body (e.g., "application/json", "text/plain").
    /// </summary>
    string? ContentType { get; }

    /// <summary>
    /// The message body as a string representation.
    /// </summary>
    string Body { get; }

    /// <summary>
    /// The type of the message body (e.g., "Text", "Binary", "Json").
    /// </summary>
    string BodyType { get; }

    /// <summary>
    /// The address to which replies should be sent.
    /// </summary>
    string? ReplyTo { get; }

    /// <summary>
    /// The destination address for the message.
    /// </summary>
    string? To { get; }

    /// <summary>
    /// The subject or label of the message.
    /// For Azure Service Bus: Subject property.
    /// For RabbitMQ: Often mapped from routing key or custom header.
    /// </summary>
    string? Subject { get; }

    /// <summary>
    /// The number of times delivery of this message has been attempted.
    /// </summary>
    int DeliveryCount { get; }

    /// <summary>
    /// The time when this message was enqueued/published.
    /// </summary>
    DateTimeOffset EnqueuedTime { get; }

    /// <summary>
    /// The time when this message will expire.
    /// Null if the message does not expire.
    /// </summary>
    DateTimeOffset? ExpiresAt { get; }

    /// <summary>
    /// The time-to-live duration for the message.
    /// </summary>
    TimeSpan TimeToLive { get; }

    /// <summary>
    /// Custom application-specific properties/headers attached to the message.
    /// </summary>
    IReadOnlyDictionary<string, object> ApplicationProperties { get; }

    /// <summary>
    /// Indicates whether this message is in a dead letter queue/exchange.
    /// </summary>
    bool IsDeadLettered { get; }

    /// <summary>
    /// The reason why this message was dead-lettered, if applicable.
    /// </summary>
    string? DeadLetterReason { get; }

    /// <summary>
    /// A detailed error description for why the message was dead-lettered, if applicable.
    /// </summary>
    string? DeadLetterErrorDescription { get; }

    /// <summary>
    /// The source entity from which this message was dead-lettered, if applicable.
    /// </summary>
    string? DeadLetterSource { get; }

    /// <summary>
    /// Provider-specific sequence number for message ordering.
    /// For Azure Service Bus: SequenceNumber.
    /// For RabbitMQ: Delivery tag or null if not supported.
    /// </summary>
    long? SequenceNumber { get; }

    /// <summary>
    /// The session identifier for session-enabled queues.
    /// For Azure Service Bus: SessionId property.
    /// For RabbitMQ: Not natively supported, may be null.
    /// </summary>
    string? SessionId { get; }

    /// <summary>
    /// The partition key for partitioned entities.
    /// For Azure Service Bus: PartitionKey property.
    /// For RabbitMQ: May map to routing key or null.
    /// </summary>
    string? PartitionKey { get; }

    /// <summary>
    /// The scheduled time for the message to become available.
    /// Null if the message is not scheduled or scheduling is not supported.
    /// </summary>
    DateTimeOffset? ScheduledEnqueueTime { get; }
}
