namespace ServiceBusExplorer.Core.Abstractions;

/// <summary>
/// Interface for provider capability discovery.
/// Allows the UI and API to gracefully handle feature differences between messaging providers.
/// Each provider implementation exposes its capabilities through this interface.
/// </summary>
public interface IProviderCapabilities
{
    /// <summary>
    /// Indicates whether the provider supports topics as a pub/sub mechanism.
    /// For Azure Service Bus: true (native Topics).
    /// For RabbitMQ: true (via Exchanges).
    /// </summary>
    bool SupportsTopics { get; }

    /// <summary>
    /// Indicates whether the provider supports subscriptions to topics.
    /// For Azure Service Bus: true (native Subscriptions).
    /// For RabbitMQ: true (via Queue Bindings to Exchanges).
    /// </summary>
    bool SupportsSubscriptions { get; }

    /// <summary>
    /// Indicates whether the provider supports scheduled/delayed message delivery.
    /// For Azure Service Bus: true (ScheduledEnqueueTime).
    /// For RabbitMQ: false (requires delayed message plugin).
    /// </summary>
    bool SupportsScheduledMessages { get; }

    /// <summary>
    /// Indicates whether the provider supports message sessions for ordered processing.
    /// For Azure Service Bus: true (SessionId property).
    /// For RabbitMQ: false (not natively supported).
    /// </summary>
    bool SupportsSessions { get; }

    /// <summary>
    /// Indicates whether the provider supports dead letter queues/exchanges.
    /// For Azure Service Bus: true (built-in $deadletterqueue).
    /// For RabbitMQ: true (Dead Letter Exchange - DLX).
    /// </summary>
    bool SupportsDeadLetterQueue { get; }

    /// <summary>
    /// Indicates whether the provider supports message sequence numbers.
    /// For Azure Service Bus: true (SequenceNumber property).
    /// For RabbitMQ: false (not natively supported).
    /// </summary>
    bool SupportsSequenceNumbers { get; }

    /// <summary>
    /// Indicates whether the provider supports message filtering on subscriptions.
    /// For Azure Service Bus: true (SQL filters, Correlation filters).
    /// For RabbitMQ: true (routing keys, header matching).
    /// </summary>
    bool SupportsMessageFiltering { get; }

    /// <summary>
    /// Indicates whether the provider supports message batching operations.
    /// For Azure Service Bus: true.
    /// For RabbitMQ: true (basic.publish in batches).
    /// </summary>
    bool SupportsMessageBatching { get; }

    /// <summary>
    /// Indicates whether the provider runs messaging operations in a transaction.
    /// For Azure Service Bus: false (the broker offers them; no code here runs one).
    /// For RabbitMQ: false (no TX channel, no publisher confirms).
    /// </summary>
    bool SupportsTransactions { get; }

    /// <summary>
    /// Indicates whether the provider can delete, resubmit and dead-letter a deferred message by its sequence number.
    /// For Azure Service Bus: true.
    /// For RabbitMQ: false (not natively supported).
    /// </summary>
    bool SupportsDeferral { get; }

    /// <summary>
    /// Indicates whether the provider supports message duplication detection.
    /// For Azure Service Bus: true (RequiresDuplicateDetection).
    /// For RabbitMQ: false (not natively supported).
    /// </summary>
    bool SupportsDuplicateDetection { get; }

    /// <summary>
    /// Indicates whether the provider supports auto-forwarding messages to another entity.
    /// For Azure Service Bus: true (ForwardTo property).
    /// For RabbitMQ: false (manual binding configuration required).
    /// </summary>
    bool SupportsAutoForwarding { get; }

    /// <summary>
    /// Indicates whether the provider can change the settings and status of an existing queue, topic or subscription.
    /// For Azure Service Bus: true.
    /// For RabbitMQ: false (queue and exchange arguments are fixed at declaration).
    /// </summary>
    bool SupportsEntityUpdate { get; }

    /// <summary>
    /// Indicates whether the provider can list, add, replace and delete the rules of a subscription.
    /// For Azure Service Bus: true.
    /// For RabbitMQ: false (a binding has a routing key, not rules).
    /// </summary>
    bool SupportsSubscriptionRules { get; }

    /// <summary>
    /// Indicates whether the provider can peek, search, delete and resubmit the messages of the transfer
    /// dead-letter queue, where the broker puts the messages it could not forward to another entity.
    /// For Azure Service Bus: true.
    /// For RabbitMQ: false (no such queue).
    /// </summary>
    bool SupportsTransferDeadLetter { get; }

    /// <summary>
    /// Indicates whether the provider can export the definitions of every entity to one document and import such a
    /// document, creating only what does not exist.
    /// For Azure Service Bus: true.
    /// For RabbitMQ: false (its own definitions export is not read by this application).
    /// </summary>
    bool SupportsDefinitions { get; }

    /// <summary>
    /// Indicates whether the provider can read the properties of the connected namespace.
    /// For Azure Service Bus: true (the administration client; it needs the Manage right).
    /// For RabbitMQ: false (a broker has no namespace).
    /// </summary>
    bool SupportsNamespaceProperties { get; }

    /// <summary>
    /// Gets the supported exchange types for the provider.
    /// For Azure Service Bus: empty (not applicable).
    /// For RabbitMQ: ["direct", "fanout", "topic", "headers"].
    /// </summary>
    IReadOnlyCollection<string> SupportedExchangeTypes { get; }

    /// <summary>
    /// Gets the maximum message size in bytes supported by the provider.
    /// For Azure Service Bus: 256 KB, the default used while the tier is not known; the tier's own limit is
    /// <see cref="Models.NamespaceInfo.MaxMessageSizeInBytes"/>.
    /// For RabbitMQ: configurable, default ~128MB.
    /// </summary>
    long MaxMessageSizeInBytes { get; }

    /// <summary>
    /// Gets the maximum time-to-live duration for messages.
    /// For Azure Service Bus: varies by tier.
    /// For RabbitMQ: unlimited or queue-configured.
    /// </summary>
    TimeSpan MaxTimeToLive { get; }

    /// <summary>
    /// Gets the display name for the provider (e.g., "Azure Service Bus", "RabbitMQ").
    /// </summary>
    string ProviderDisplayName { get; }

    /// <summary>
    /// Gets the provider version or connection library version.
    /// </summary>
    string ProviderVersion { get; }

    /// <summary>
    /// Indicates whether a peek can start at a given sequence number instead of the head of the queue.
    /// For Azure Service Bus: true.
    /// For RabbitMQ: false (a queue is read from its head only).
    /// </summary>
    bool SupportsPeekFromSequenceNumber { get; }

    /// <summary>
    /// Indicates whether an active message named by its sequence number can be dead-lettered, with a reason and a
    /// description. For Azure Service Bus: true. For RabbitMQ: false.
    /// </summary>
    bool SupportsManualDeadLetter { get; }

    /// <summary>
    /// Indicates whether a body that is not valid UTF-8 is read as base64 with its flag and a base64 body can be sent
    /// byte for byte. For Azure Service Bus: true. For RabbitMQ: false; a body is read as UTF-8 text and a base64 send
    /// is refused.
    /// </summary>
    bool SupportsBinaryBody { get; }
}
