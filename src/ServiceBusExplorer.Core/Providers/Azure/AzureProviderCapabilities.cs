using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// Azure Service Bus provider capabilities.
/// Exposes the features supported by Azure Service Bus for capability discovery.
/// </summary>
public class AzureProviderCapabilities : IProviderCapabilities
{
    /// <summary>
    /// Singleton instance of AzureProviderCapabilities.
    /// Since capabilities are constant, a single instance can be shared.
    /// </summary>
    public static readonly AzureProviderCapabilities Instance = new();

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus has native support for Topics as a pub/sub mechanism.
    /// </remarks>
    public bool SupportsTopics => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus has native support for Subscriptions to Topics.
    /// </remarks>
    public bool SupportsSubscriptions => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports scheduled message delivery via ScheduledEnqueueTime property.
    /// </remarks>
    public bool SupportsScheduledMessages => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports message sessions for ordered processing via SessionId property.
    /// </remarks>
    public bool SupportsSessions => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus has built-in dead letter queue support ($deadletterqueue sub-queue).
    /// </remarks>
    public bool SupportsDeadLetterQueue => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports message sequence numbers (SequenceNumber property).
    /// </remarks>
    public bool SupportsSequenceNumbers => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports message filtering on subscriptions via SQL and Correlation filters.
    /// </remarks>
    public bool SupportsMessageFiltering => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports batch operations for sending and receiving messages.
    /// </remarks>
    public bool SupportsMessageBatching => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports transactional messaging operations.
    /// </remarks>
    public bool SupportsTransactions => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports message deferral via the Defer operation.
    /// </remarks>
    public bool SupportsDeferral => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports duplicate detection via RequiresDuplicateDetection setting.
    /// </remarks>
    public bool SupportsDuplicateDetection => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports auto-forwarding messages to another entity via ForwardTo property.
    /// </remarks>
    public bool SupportsAutoForwarding => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus does not use exchange types - this is a RabbitMQ concept.
    /// </remarks>
    public IReadOnlyCollection<string> SupportedExchangeTypes => Array.Empty<string>();

    /// <inheritdoc />
    /// <remarks>
    /// Maximum message size varies by tier:
    /// - Basic/Standard tier: 256 KB (262,144 bytes)
    /// - Premium tier: up to 100 MB
    /// This returns the Standard tier limit as a conservative default.
    /// </remarks>
    public long MaxMessageSizeInBytes => 256 * 1024; // 256 KB (Standard tier)

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus supports very long TTL durations.
    /// Standard/Premium tiers support up to TimeSpan.MaxValue (essentially unlimited).
    /// Using 14 days as a practical maximum that works across all tiers.
    /// </remarks>
    public TimeSpan MaxTimeToLive => TimeSpan.FromDays(14);

    /// <inheritdoc />
    public string ProviderDisplayName => "Azure Service Bus";

    /// <inheritdoc />
    /// <remarks>
    /// Returns the version of the Azure.Messaging.ServiceBus SDK being used.
    /// </remarks>
    public string ProviderVersion => "7.20.1";
}
