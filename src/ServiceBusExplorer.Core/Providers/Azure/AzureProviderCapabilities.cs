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

    private static readonly AzureProviderCapabilities Emulator = new(emulator: true);

    private readonly bool _emulator;

    /// <summary>The capabilities of a namespace.</summary>
    public AzureProviderCapabilities() { }

    private AzureProviderCapabilities(bool emulator) => _emulator = emulator;

    /// <summary>
    /// The capabilities of one connection: those of the development emulator when its connection string
    /// asks for it with <c>UseDevelopmentEmulator=true</c>, those of a namespace otherwise.
    /// </summary>
    public static AzureProviderCapabilities For(AzureConnectionConfig? connection) =>
        !string.IsNullOrEmpty(connection?.ConnectionString) && connection.ConnectionString.Split(';').Any(part =>
            part.Split('=', 2) is [var key, var value]
            && key.Trim().Equals("UseDevelopmentEmulator", StringComparison.OrdinalIgnoreCase)
            && value.Trim().Equals("true", StringComparison.OrdinalIgnoreCase))
            ? Emulator
            : Instance;

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
    /// False: the broker offers transactions, but no code of this provider runs one.
    /// </remarks>
    public bool SupportsTransactions => false;

    /// <inheritdoc />
    /// <remarks>
    /// A deferred message is listed with its state and can be deleted, resubmitted or dead-lettered by its sequence
    /// number; nothing in this provider defers one.
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
    /// Azure Service Bus updates queues, topics and subscriptions through the administration client.
    /// </remarks>
    public bool SupportsEntityUpdate => true;

    /// <inheritdoc />
    public bool SupportsSubscriptionRules => true;

    /// <inheritdoc />
    /// <remarks>False on the development emulator, which refuses the transfer dead-letter queue of a subscription.</remarks>
    public bool SupportsTransferDeadLetter => !_emulator;

    /// <inheritdoc />
    public bool SupportsMessageCounts => !_emulator;

    /// <inheritdoc />
    public bool SupportsDefinitions => true;

    /// <inheritdoc />
    public bool SupportsNamespaceProperties => true;

    /// <inheritdoc />
    /// <remarks>
    /// Azure Service Bus does not use exchange types - this is a RabbitMQ concept.
    /// </remarks>
    public IReadOnlyCollection<string> SupportedExchangeTypes => Array.Empty<string>();

    /// <inheritdoc />
    /// <remarks>
    /// The Basic and Standard limit, the default while the tier is not known: capabilities are per provider, not per
    /// namespace. The limit of the connected namespace's tier is <see cref="Models.NamespaceInfo.MaxMessageSizeInBytes"/>.
    /// </remarks>
    public long MaxMessageSizeInBytes => AzureServiceBusProvider.StandardMaxMessageSizeInBytes;

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
    public string ProviderVersion => "7.21.0";

    /// <inheritdoc />
    public bool SupportsPeekFromSequenceNumber => true;

    /// <inheritdoc />
    public bool SupportsManualDeadLetter => true;

    /// <inheritdoc />
    public bool SupportsBulkMessageOperations => true;

    /// <inheritdoc />
    public bool SupportsMessageSearch => true;

    /// <inheritdoc />
    public bool SupportsBinaryBody => true;
}
