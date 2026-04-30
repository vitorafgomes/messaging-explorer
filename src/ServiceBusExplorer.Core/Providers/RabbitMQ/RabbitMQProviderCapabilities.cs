using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Providers.RabbitMQ;

/// <summary>
/// RabbitMQ provider capabilities.
/// Exposes the features supported by RabbitMQ for capability discovery.
/// </summary>
public class RabbitMQProviderCapabilities : IProviderCapabilities
{
    /// <summary>
    /// Singleton instance of RabbitMQProviderCapabilities.
    /// Since capabilities are constant, a single instance can be shared.
    /// </summary>
    public static readonly RabbitMQProviderCapabilities Instance = new();

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ supports topics via Exchanges (topic, fanout, headers exchange types).
    /// </remarks>
    public bool SupportsTopics => true;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ supports subscriptions via Queue Bindings to Exchanges.
    /// </remarks>
    public bool SupportsSubscriptions => true;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ does not natively support scheduled messages.
    /// Requires the delayed message exchange plugin (rabbitmq_delayed_message_exchange).
    /// </remarks>
    public bool SupportsScheduledMessages => false;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ does not natively support message sessions for ordered processing.
    /// </remarks>
    public bool SupportsSessions => false;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ supports dead letter queues via Dead Letter Exchange (DLX) configuration.
    /// </remarks>
    public bool SupportsDeadLetterQueue => true;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ does not natively support message sequence numbers like Azure Service Bus.
    /// </remarks>
    public bool SupportsSequenceNumbers => false;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ supports message filtering via routing keys and header matching on exchanges.
    /// </remarks>
    public bool SupportsMessageFiltering => true;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ supports batch operations for sending messages (basic.publish in batches).
    /// </remarks>
    public bool SupportsMessageBatching => true;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ supports transactional messaging via TX mode or publisher confirms.
    /// </remarks>
    public bool SupportsTransactions => true;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ does not natively support message deferral like Azure Service Bus.
    /// </remarks>
    public bool SupportsDeferral => false;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ does not natively support duplicate detection.
    /// </remarks>
    public bool SupportsDuplicateDetection => false;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ does not have built-in auto-forwarding like Azure Service Bus.
    /// Similar functionality requires manual exchange-to-exchange or queue binding configuration.
    /// </remarks>
    public bool SupportsAutoForwarding => false;

    /// <summary>
    /// RabbitMQ supported exchange types.
    /// </summary>
    private static readonly string[] ExchangeTypes = ["direct", "fanout", "topic", "headers"];

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ supports multiple exchange types for different routing patterns:
    /// - direct: Routes based on exact routing key match.
    /// - fanout: Broadcasts to all bound queues.
    /// - topic: Routes based on pattern matching on routing keys.
    /// - headers: Routes based on message header attributes.
    /// </remarks>
    public IReadOnlyCollection<string> SupportedExchangeTypes => ExchangeTypes;

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ default maximum message size is approximately 128 MB.
    /// This can be configured via the max_message_size configuration option.
    /// </remarks>
    public long MaxMessageSizeInBytes => 128 * 1024 * 1024; // 128 MB

    /// <inheritdoc />
    /// <remarks>
    /// RabbitMQ supports unlimited message TTL by default.
    /// TTL can be configured per queue or per message.
    /// Using TimeSpan.MaxValue to represent unlimited TTL.
    /// </remarks>
    public TimeSpan MaxTimeToLive => TimeSpan.MaxValue;

    /// <inheritdoc />
    public string ProviderDisplayName => "RabbitMQ";

    /// <inheritdoc />
    /// <remarks>
    /// Returns the version of the RabbitMQ.Client library being used.
    /// </remarks>
    public string ProviderVersion => "6.8.1";
}
