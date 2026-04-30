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
    /// Indicates whether the provider supports transactional messaging.
    /// For Azure Service Bus: true.
    /// For RabbitMQ: true (TX mode or publisher confirms).
    /// </summary>
    bool SupportsTransactions { get; }

    /// <summary>
    /// Indicates whether the provider supports message deferral.
    /// For Azure Service Bus: true (Defer operation).
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
    /// Gets the supported exchange types for the provider.
    /// For Azure Service Bus: empty (not applicable).
    /// For RabbitMQ: ["direct", "fanout", "topic", "headers"].
    /// </summary>
    IReadOnlyCollection<string> SupportedExchangeTypes { get; }

    /// <summary>
    /// Gets the maximum message size in bytes supported by the provider.
    /// For Azure Service Bus: varies by tier (256KB to 100MB).
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
}
