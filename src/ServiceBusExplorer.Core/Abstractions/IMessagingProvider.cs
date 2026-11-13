using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;

namespace ServiceBusExplorer.Core.Abstractions;

/// <summary>
/// Core interface for messaging providers.
/// Abstracts all messaging provider operations, allowing seamless switching between
/// different providers (Azure Service Bus, RabbitMQ, etc.) at runtime.
/// </summary>
public interface IMessagingProvider : IAsyncDisposable
{
    #region Provider Information

    /// <summary>
    /// Gets the type of this messaging provider.
    /// </summary>
    ProviderType ProviderType { get; }

    /// <summary>
    /// Gets the capabilities supported by this provider.
    /// Used by UI and API to gracefully handle feature differences between providers.
    /// </summary>
    IProviderCapabilities Capabilities { get; }

    #endregion

    #region Connection Management

    /// <summary>
    /// Tests the connection to the messaging provider using the specified configuration.
    /// </summary>
    /// <param name="config">The connection configuration to test.</param>
    /// <returns>True if the connection is successful; otherwise, false.</returns>
    Task<bool> TestConnectionAsync(IConnectionConfig config);

    /// <summary>
    /// Establishes a connection to the messaging provider using the specified configuration.
    /// </summary>
    /// <param name="config">The connection configuration.</param>
    Task ConnectAsync(IConnectionConfig config);

    /// <summary>
    /// Disconnects from the messaging provider asynchronously.
    /// </summary>
    Task DisconnectAsync();

    /// <summary>
    /// Gets a value indicating whether the provider is currently connected.
    /// </summary>
    bool IsConnected { get; }

    /// <summary>
    /// Gets the current connection target identifier.
    /// For Azure Service Bus: the namespace name.
    /// For RabbitMQ: the virtual host or hostname.
    /// </summary>
    string? CurrentTarget { get; }

    /// <summary>
    /// Gets the current connection configuration, if connected.
    /// </summary>
    IConnectionConfig? CurrentConnection { get; }

    #endregion

    #region Queue Operations

    /// <summary>
    /// Gets all queues from the messaging provider.
    /// </summary>
    /// <returns>A collection of queue entities.</returns>
    Task<IEnumerable<IQueueEntity>> GetQueuesAsync();

    /// <summary>
    /// Gets a specific queue by name.
    /// </summary>
    /// <param name="queueName">The name of the queue.</param>
    /// <returns>The queue entity, or null if not found.</returns>
    Task<IQueueEntity?> GetQueueAsync(string queueName);

    /// <summary>
    /// Creates a new queue with the specified name.
    /// </summary>
    /// <param name="queueName">The name of the queue to create.</param>
    Task CreateQueueAsync(string queueName);

    /// <summary>
    /// Creates a new queue with the specified options.
    /// </summary>
    /// <param name="queueName">The name of the queue to create.</param>
    /// <param name="options">Provider-specific queue creation options.</param>
    Task CreateQueueAsync(string queueName, QueueCreateOptions? options);

    /// <summary>
    /// Deletes a queue by name.
    /// </summary>
    /// <param name="queueName">The name of the queue to delete.</param>
    Task DeleteQueueAsync(string queueName);

    /// <summary>
    /// Changes the given settings of an existing queue; a null option leaves its setting as it is.
    /// A provider that cannot update entities throws <see cref="NotSupportedException"/> and declares it in
    /// <see cref="IProviderCapabilities.SupportsEntityUpdate"/>.
    /// </summary>
    /// <param name="queueName">The name of the queue.</param>
    /// <param name="options">The settings to change.</param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    Task UpdateQueueAsync(string queueName, QueueUpdateOptions options, CancellationToken cancellationToken = default);

    #endregion

    #region Topic/Exchange Operations

    /// <summary>
    /// Gets all topics/exchanges from the messaging provider.
    /// For Azure Service Bus: returns topics.
    /// For RabbitMQ: returns exchanges.
    /// </summary>
    /// <returns>A collection of topic entities.</returns>
    Task<IEnumerable<ITopicEntity>> GetTopicsAsync();

    /// <summary>
    /// Gets a specific topic/exchange by name.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange.</param>
    /// <returns>The topic entity, or null if not found.</returns>
    Task<ITopicEntity?> GetTopicAsync(string topicName);

    /// <summary>
    /// Creates a new topic/exchange with the specified name.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange to create.</param>
    Task CreateTopicAsync(string topicName);

    /// <summary>
    /// Creates a new topic/exchange with the specified options.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange to create.</param>
    /// <param name="options">Provider-specific topic creation options.</param>
    Task CreateTopicAsync(string topicName, TopicCreateOptions? options);

    /// <summary>
    /// Deletes a topic/exchange by name.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange to delete.</param>
    Task DeleteTopicAsync(string topicName);

    /// <summary>
    /// Changes the given settings of an existing topic; a null option leaves its setting as it is.
    /// A provider that cannot update entities throws <see cref="NotSupportedException"/>.
    /// </summary>
    /// <param name="topicName">The name of the topic.</param>
    /// <param name="options">The settings to change.</param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    Task UpdateTopicAsync(string topicName, TopicUpdateOptions options, CancellationToken cancellationToken = default);

    #endregion

    #region Subscription/Binding Operations

    /// <summary>
    /// Gets all subscriptions/bindings for a topic/exchange.
    /// For Azure Service Bus: returns subscriptions.
    /// For RabbitMQ: returns queue bindings to the exchange.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange.</param>
    /// <returns>A collection of subscription information.</returns>
    Task<IEnumerable<SubscriptionInfo>> GetSubscriptionsAsync(string topicName);

    /// <summary>
    /// Gets a specific subscription/binding.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange.</param>
    /// <param name="subscriptionName">The name of the subscription/binding.</param>
    /// <returns>The subscription information, or null if not found.</returns>
    Task<SubscriptionInfo?> GetSubscriptionAsync(string topicName, string subscriptionName);

    /// <summary>
    /// Creates a new subscription/binding.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange.</param>
    /// <param name="subscriptionName">The name of the subscription/binding to create.</param>
    Task CreateSubscriptionAsync(string topicName, string subscriptionName);

    /// <summary>
    /// Creates a new subscription/binding with the specified options.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange.</param>
    /// <param name="subscriptionName">The name of the subscription/binding to create.</param>
    /// <param name="options">Provider-specific subscription creation options.</param>
    Task CreateSubscriptionAsync(string topicName, string subscriptionName, SubscriptionCreateOptions? options);

    /// <summary>
    /// Deletes a subscription/binding.
    /// </summary>
    /// <param name="topicName">The name of the topic/exchange.</param>
    /// <param name="subscriptionName">The name of the subscription/binding to delete.</param>
    Task DeleteSubscriptionAsync(string topicName, string subscriptionName);

    /// <summary>
    /// Changes the given settings of an existing subscription; a null option leaves its setting as it is.
    /// A provider that cannot update entities throws <see cref="NotSupportedException"/>.
    /// </summary>
    /// <param name="topicName">The name of the topic.</param>
    /// <param name="subscriptionName">The name of the subscription.</param>
    /// <param name="options">The settings to change.</param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    Task UpdateSubscriptionAsync(string topicName, string subscriptionName, SubscriptionUpdateOptions options, CancellationToken cancellationToken = default);

    #endregion

    #region Subscription Rules

    /// <summary>
    /// The rules of a subscription. Throws <see cref="EntityNotFoundException"/> when the subscription does not
    /// exist; an empty list means the subscription exists and has no rule. A provider without rules throws
    /// <see cref="NotSupportedException"/> and declares it in <see cref="IProviderCapabilities.SupportsSubscriptionRules"/>;
    /// so do the three members below.
    /// </summary>
    Task<IReadOnlyList<SubscriptionRuleInfo>> GetRulesAsync(string topicName, string subscriptionName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds a rule to a subscription and returns it as stored. A rule outside the provider's limits throws
    /// <see cref="InvalidEntityConfigurationException"/> before the broker is called; an existing name throws
    /// <see cref="EntityAlreadyExistsException"/>; a missing subscription <see cref="EntityNotFoundException"/>.
    /// </summary>
    Task<SubscriptionRuleInfo> CreateRuleAsync(string topicName, string subscriptionName, SubscriptionRuleInfo rule, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces the filter and the action of the rule named <paramref name="ruleName"/> and returns it as stored;
    /// <see cref="SubscriptionRuleInfo.Name"/> of <paramref name="rule"/> is not read, so a rule cannot be renamed.
    /// A missing rule or subscription throws <see cref="EntityNotFoundException"/>.
    /// </summary>
    Task<SubscriptionRuleInfo> UpdateRuleAsync(string topicName, string subscriptionName, string ruleName, SubscriptionRuleInfo rule, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes a rule; deleting the last one leaves a subscription that receives nothing. A missing rule or
    /// subscription throws <see cref="EntityNotFoundException"/>.
    /// </summary>
    Task DeleteRuleAsync(string topicName, string subscriptionName, string ruleName, CancellationToken cancellationToken = default);

    #endregion

    #region Message Operations

    /// <summary>
    /// Searches messages by peeking in batches and filtering server-side. The caller's token stops the scan between
    /// two broker calls.
    /// </summary>
    Task<MessageSearchResult> SearchMessagesAsync(
        string entityName,
        MessageSearchRequest request,
        MessageSubQueue subQueue = MessageSubQueue.Active,
        string? subscriptionName = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Peeks messages from a queue or subscription without removing them: up to <paramref name="count"/>, fewer only
    /// when the sub-queue holds fewer.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="count">The maximum number of messages to peek.</param>
    /// <param name="subQueue">The queue of the entity to peek.</param>
    /// <param name="subscriptionName">The subscription name if peeking from a topic subscription.</param>
    /// <param name="cancellationToken">Token that stops the peek between two broker calls.</param>
    /// <returns>A collection of messages.</returns>
    Task<IEnumerable<IMessage>> PeekMessagesAsync(string entityName, int count = 10, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sends a message to a queue or topic.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="message">The message to send.</param>
    Task SendMessageAsync(string entityName, SendMessageRequest message);

    /// <summary>
    /// Sends multiple messages to a queue or topic in a batch.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="messages">The messages to send.</param>
    Task SendMessagesAsync(string entityName, IEnumerable<SendMessageRequest> messages);

    /// <summary>
    /// Receives and removes messages from a queue or subscription.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="count">The maximum number of messages to receive.</param>
    /// <param name="subscriptionName">The subscription name if receiving from a topic subscription.</param>
    /// <returns>A collection of received messages.</returns>
    Task<IEnumerable<IMessage>> ReceiveMessagesAsync(string entityName, int count = 10, string? subscriptionName = null);

    /// <summary>
    /// Moves a message to the dead letter queue.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="sequenceNumber">The sequence number or delivery tag of the message.</param>
    /// <param name="subscriptionName">The subscription name if operating on a topic subscription.</param>
    Task DeadLetterMessageAsync(string entityName, long sequenceNumber, string? subscriptionName = null);

    /// <summary>
    /// Resubmits a dead-lettered message back to the original queue or topic.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="sequenceNumber">The sequence number or delivery tag of the message.</param>
    /// <param name="subscriptionName">The subscription name if operating on a topic subscription.</param>
    Task ResubmitDeadLetterMessageAsync(string entityName, long sequenceNumber, string? subscriptionName = null);

    /// <summary>
    /// Purges all messages from a queue or subscription.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="subQueue">The queue of the entity to purge.</param>
    /// <param name="subscriptionName">The subscription name if purging a topic subscription.</param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    Task PurgeMessagesAsync(string entityName, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes multiple messages by their sequence numbers.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="sequenceNumbers">Array of sequence numbers to delete. Ignored when <paramref name="all"/> is true.</param>
    /// <param name="subQueue">The queue of the entity to delete from.</param>
    /// <param name="subscriptionName">The subscription name if deleting from a topic subscription.</param>
    /// <param name="all">
    /// When true, deletes every message in the target entity using a fast drain path
    /// instead of scanning for individual sequence numbers.
    /// </param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    /// <returns>Result containing success count and failure details.</returns>
    Task<BatchOperationResult> DeleteMessagesAsync(string entityName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, bool all = false, CancellationToken cancellationToken = default);

    /// <summary>
    /// Resubmits multiple dead-lettered messages back to the original queue or topic.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="sequenceNumbers">Array of sequence numbers to resubmit.</param>
    /// <param name="subQueue">The dead-letter queue to resubmit from; <see cref="MessageSubQueue.Active"/> is refused.</param>
    /// <param name="subscriptionName">The subscription name if resubmitting from a topic subscription.</param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    /// <returns>Result containing success count and failure details.</returns>
    Task<BatchOperationResult> ResubmitDeadLetterMessagesAsync(string entityName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.DeadLetter, string? subscriptionName = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Moves multiple messages from one queue or subscription to another queue.
    /// </summary>
    /// <param name="sourceEntityName">The name of the source queue or topic.</param>
    /// <param name="targetQueueName">The name of the target queue.</param>
    /// <param name="sequenceNumbers">Array of sequence numbers to move.</param>
    /// <param name="subQueue">The queue of the entity to move from.</param>
    /// <param name="subscriptionName">The subscription name if moving from a topic subscription.</param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    /// <returns>Result containing success count and failure details.</returns>
    Task<BatchOperationResult> MoveMessagesAsync(string sourceEntityName, string targetQueueName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Cancels scheduled messages of a queue, deleting each before it is ever delivered. The sequence numbers are
    /// checked before the broker is called: 1 to 500, each positive, none repeated, or
    /// <see cref="InvalidEntityConfigurationException"/>. The result has one failure per sequence number that could not
    /// be cancelled, for example one that is not a scheduled message; one such number does not fail the others. A
    /// provider without scheduled messages throws <see cref="NotSupportedException"/> and declares it in
    /// <see cref="IProviderCapabilities.SupportsScheduledMessages"/>.
    /// </summary>
    /// <param name="queueName">The name of the queue.</param>
    /// <param name="sequenceNumbers">The sequence numbers of the scheduled messages.</param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    Task<BatchOperationResult> CancelScheduledMessagesAsync(string queueName, long[] sequenceNumbers, CancellationToken cancellationToken = default);

    #endregion

    #region Session Operations

    /// <summary>
    /// Lists the sessions of a session-enabled queue or subscription from a peek of its first
    /// <paramref name="maxMessages"/> messages, in order of first appearance, at most 100. No session is accepted or
    /// locked. A session holding a state and no message is not listed. Throws <see cref="SessionsNotEnabledException"/>
    /// when a peeked message carries no session id, <see cref="EntityNotFoundException"/> when the entity does not
    /// exist, and <see cref="NotSupportedException"/> for a provider without sessions.
    /// </summary>
    Task<SessionList> GetSessionsAsync(string entityName, string? subscriptionName, int maxMessages, CancellationToken cancellationToken = default);

    /// <summary>
    /// Accepts one session, reads its state and releases it before returning. Throws
    /// <see cref="SessionInUseException"/> when another receiver holds the session or the accept waits too long.
    /// </summary>
    Task<SessionDetail> GetSessionAsync(string entityName, string? subscriptionName, string sessionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Accepts one session, peeks up to <paramref name="count"/> of its messages and releases it. Nothing is received,
    /// completed or removed.
    /// </summary>
    Task<IEnumerable<IMessage>> PeekSessionMessagesAsync(string entityName, string? subscriptionName, string sessionId, int count, CancellationToken cancellationToken = default);

    /// <summary>
    /// Accepts one session and writes <paramref name="state"/> (null or empty clears it) only when the current state
    /// equals <paramref name="expectedState"/>, where null or empty means no state; otherwise throws <see cref="SessionStateChangedException"/> and writes nothing.
    /// A binary current state throws <see cref="BinarySessionStateException"/>. A state over
    /// <see cref="MaxSessionStateBytes"/> UTF-8 bytes or a session id that is empty, white space or longer than
    /// <see cref="MaxSessionIdLength"/> throws <see cref="InvalidEntityConfigurationException"/> before any broker call.
    /// </summary>
    Task<SessionDetail> SetSessionStateAsync(string entityName, string? subscriptionName, string sessionId, string? state, string? expectedState, CancellationToken cancellationToken = default);

    /// <summary>The longest session id a broker accepts.</summary>
    const int MaxSessionIdLength = 128;

    /// <summary>The largest session state, in UTF-8 bytes, that can be written from here.</summary>
    const int MaxSessionStateBytes = 262144;

    #endregion
}

/// <summary>
/// The queue of a queue or subscription that a message operation reads: the entity itself, its dead-letter queue, or
/// its transfer dead-letter queue, where the broker puts the messages it could not forward to another entity.
/// </summary>
public enum MessageSubQueue
{
    Active,
    DeadLetter,
    TransferDeadLetter
}

/// <summary>
/// Options for creating a queue.
/// </summary>
public class QueueCreateOptions
{
    /// <summary>
    /// Whether the queue should be durable (survives restarts).
    /// </summary>
    public bool Durable { get; set; } = true;

    /// <summary>
    /// Whether the queue should auto-delete when no longer in use.
    /// </summary>
    public bool AutoDelete { get; set; } = false;

    /// <summary>
    /// The default time-to-live for messages in the queue.
    /// </summary>
    public TimeSpan? DefaultMessageTimeToLive { get; set; }

    /// <summary>
    /// The lock duration for message processing.
    /// </summary>
    public TimeSpan? LockDuration { get; set; }

    /// <summary>
    /// The maximum delivery count before dead-lettering.
    /// </summary>
    public int? MaxDeliveryCount { get; set; }

    /// <summary>
    /// Whether the queue requires sessions.
    /// </summary>
    public bool RequiresSession { get; set; } = false;

    /// <summary>
    /// Whether to enable partitioning.
    /// </summary>
    public bool EnablePartitioning { get; set; } = false;

    /// <summary>
    /// Whether to dead-letter messages on expiration.
    /// </summary>
    public bool DeadLetteringOnMessageExpiration { get; set; } = false;

    /// <summary>
    /// Whether the queue detects duplicate messages by message id. Azure Service Bus only.
    /// </summary>
    public bool RequiresDuplicateDetection { get; set; } = false;

    /// <summary>
    /// How long message ids are kept for duplicate detection. Azure Service Bus only.
    /// </summary>
    public TimeSpan? DuplicateDetectionHistoryTimeWindow { get; set; }

    /// <summary>
    /// The maximum size of the queue in megabytes. Azure Service Bus only.
    /// </summary>
    public long? MaxSizeInMegabytes { get; set; }

    /// <summary>
    /// The idle time after which the queue is deleted. Azure Service Bus only.
    /// </summary>
    public TimeSpan? AutoDeleteOnIdle { get; set; }

    /// <summary>
    /// Whether server-side batched operations are enabled; null keeps the broker default. Azure Service Bus only.
    /// </summary>
    public bool? EnableBatchedOperations { get; set; }

    /// <summary>
    /// The queue or topic every message is forwarded to; null or empty forwards nothing. Azure Service Bus only.
    /// </summary>
    public string? ForwardTo { get; set; }

    /// <summary>
    /// The queue or topic dead-lettered messages are forwarded to; null or empty forwards nothing. Azure Service Bus only.
    /// </summary>
    public string? ForwardDeadLetteredMessagesTo { get; set; }

    /// <summary>
    /// Free text the user keeps with the queue. Azure Service Bus only.
    /// </summary>
    public string? UserMetadata { get; set; }

    /// <summary>
    /// Provider-specific additional options.
    /// </summary>
    public Dictionary<string, object>? AdditionalOptions { get; set; }
}

/// <summary>
/// Options for creating a topic/exchange.
/// </summary>
public class TopicCreateOptions
{
    /// <summary>
    /// Whether the topic should be durable (survives restarts).
    /// </summary>
    public bool Durable { get; set; } = true;

    /// <summary>
    /// Whether the topic should auto-delete when no longer in use.
    /// </summary>
    public bool AutoDelete { get; set; } = false;

    /// <summary>
    /// The default time-to-live for messages in the topic.
    /// </summary>
    public TimeSpan? DefaultMessageTimeToLive { get; set; }

    /// <summary>
    /// Whether to enable partitioning.
    /// </summary>
    public bool EnablePartitioning { get; set; } = false;

    /// <summary>
    /// Whether to require duplicate detection.
    /// </summary>
    public bool RequiresDuplicateDetection { get; set; } = false;

    /// <summary>
    /// The exchange type for RabbitMQ (direct, fanout, topic, headers).
    /// Ignored for Azure Service Bus.
    /// </summary>
    public string? ExchangeType { get; set; }

    /// <summary>
    /// How long message ids are kept for duplicate detection. Azure Service Bus only.
    /// </summary>
    public TimeSpan? DuplicateDetectionHistoryTimeWindow { get; set; }

    /// <summary>
    /// The maximum size of the topic in megabytes. Azure Service Bus only.
    /// </summary>
    public long? MaxSizeInMegabytes { get; set; }

    /// <summary>
    /// The idle time after which the topic is deleted. Azure Service Bus only.
    /// </summary>
    public TimeSpan? AutoDeleteOnIdle { get; set; }

    /// <summary>
    /// Whether server-side batched operations are enabled; null keeps the broker default. Azure Service Bus only.
    /// </summary>
    public bool? EnableBatchedOperations { get; set; }

    /// <summary>
    /// Whether the topic keeps the order messages were sent in; null keeps the broker default. Azure Service Bus only.
    /// </summary>
    public bool? SupportOrdering { get; set; }

    /// <summary>
    /// Free text the user keeps with the topic. Azure Service Bus only.
    /// </summary>
    public string? UserMetadata { get; set; }

    /// <summary>
    /// Provider-specific additional options.
    /// </summary>
    public Dictionary<string, object>? AdditionalOptions { get; set; }
}

/// <summary>
/// Options for creating a subscription/binding.
/// </summary>
public class SubscriptionCreateOptions
{
    /// <summary>
    /// The default time-to-live for messages in the subscription.
    /// </summary>
    public TimeSpan? DefaultMessageTimeToLive { get; set; }

    /// <summary>
    /// The lock duration for message processing.
    /// </summary>
    public TimeSpan? LockDuration { get; set; }

    /// <summary>
    /// The maximum delivery count before dead-lettering.
    /// </summary>
    public int? MaxDeliveryCount { get; set; }

    /// <summary>
    /// Whether the subscription requires sessions.
    /// </summary>
    public bool RequiresSession { get; set; } = false;

    /// <summary>
    /// Whether to dead-letter messages on expiration.
    /// </summary>
    public bool DeadLetteringOnMessageExpiration { get; set; } = false;

    /// <summary>
    /// The routing key for RabbitMQ bindings.
    /// Ignored for Azure Service Bus (use filter expression instead).
    /// </summary>
    public string? RoutingKey { get; set; }

    /// <summary>
    /// The filter expression for Azure Service Bus subscriptions.
    /// Ignored for RabbitMQ (use routing key instead).
    /// </summary>
    public string? FilterExpression { get; set; }

    /// <summary>
    /// Whether a message whose filter evaluation fails is dead-lettered; null keeps the broker default. Azure Service Bus only.
    /// </summary>
    public bool? DeadLetteringOnFilterEvaluationExceptions { get; set; }

    /// <summary>
    /// The idle time after which the subscription is deleted. Azure Service Bus only.
    /// </summary>
    public TimeSpan? AutoDeleteOnIdle { get; set; }

    /// <summary>
    /// Whether server-side batched operations are enabled; null keeps the broker default. Azure Service Bus only.
    /// </summary>
    public bool? EnableBatchedOperations { get; set; }

    /// <summary>
    /// The queue or topic every message is forwarded to; null or empty forwards nothing. Azure Service Bus only.
    /// </summary>
    public string? ForwardTo { get; set; }

    /// <summary>
    /// The queue or topic dead-lettered messages are forwarded to; null or empty forwards nothing. Azure Service Bus only.
    /// </summary>
    public string? ForwardDeadLetteredMessagesTo { get; set; }

    /// <summary>
    /// Free text the user keeps with the subscription. Azure Service Bus only.
    /// </summary>
    public string? UserMetadata { get; set; }

    /// <summary>
    /// Provider-specific additional options.
    /// </summary>
    public Dictionary<string, object>? AdditionalOptions { get; set; }
}

/// <summary>
/// The settings of an existing queue to change. A null member leaves its setting as it is; an empty
/// <see cref="ForwardTo"/> or <see cref="ForwardDeadLetteredMessagesTo"/> clears that forward target.
/// <see cref="Status"/> is one of Active, Disabled, SendDisabled, ReceiveDisabled.
/// </summary>
public class QueueUpdateOptions
{
    public TimeSpan? DefaultMessageTimeToLive { get; set; }
    public TimeSpan? LockDuration { get; set; }
    public int? MaxDeliveryCount { get; set; }
    public bool? DeadLetteringOnMessageExpiration { get; set; }
    public TimeSpan? DuplicateDetectionHistoryTimeWindow { get; set; }
    public long? MaxSizeInMegabytes { get; set; }
    public TimeSpan? AutoDeleteOnIdle { get; set; }
    public bool? EnableBatchedOperations { get; set; }
    public string? ForwardTo { get; set; }
    public string? ForwardDeadLetteredMessagesTo { get; set; }
    public string? UserMetadata { get; set; }
    public string? Status { get; set; }
}

/// <summary>
/// The settings of an existing topic to change. A null member leaves its setting as it is.
/// <see cref="Status"/> is one of Active, Disabled, SendDisabled.
/// </summary>
public class TopicUpdateOptions
{
    public TimeSpan? DefaultMessageTimeToLive { get; set; }
    public TimeSpan? DuplicateDetectionHistoryTimeWindow { get; set; }
    public long? MaxSizeInMegabytes { get; set; }
    public TimeSpan? AutoDeleteOnIdle { get; set; }
    public bool? EnableBatchedOperations { get; set; }
    public bool? SupportOrdering { get; set; }
    public string? UserMetadata { get; set; }
    public string? Status { get; set; }
}

/// <summary>
/// The settings of an existing subscription to change. A null member leaves its setting as it is; an empty
/// <see cref="ForwardTo"/> or <see cref="ForwardDeadLetteredMessagesTo"/> clears that forward target.
/// <see cref="Status"/> is one of Active, Disabled, ReceiveDisabled.
/// </summary>
public class SubscriptionUpdateOptions
{
    public TimeSpan? DefaultMessageTimeToLive { get; set; }
    public TimeSpan? LockDuration { get; set; }
    public int? MaxDeliveryCount { get; set; }
    public bool? DeadLetteringOnMessageExpiration { get; set; }
    public bool? DeadLetteringOnFilterEvaluationExceptions { get; set; }
    public TimeSpan? AutoDeleteOnIdle { get; set; }
    public bool? EnableBatchedOperations { get; set; }
    public string? ForwardTo { get; set; }
    public string? ForwardDeadLetteredMessagesTo { get; set; }
    public string? UserMetadata { get; set; }
    public string? Status { get; set; }
}

/// <summary>
/// The session is locked by another receiver, or accepting it did not finish within the provider's wait. The message is
/// fixed; the broker's own error, if any, is the inner exception and is for the log only.
/// </summary>
public sealed class SessionInUseException(Exception? innerException = null)
    : Exception("The session is in use by another receiver. Try again in a moment.", innerException);

/// <summary>
/// The queue or subscription does not require sessions, so it has none to list or open. The message is fixed; the
/// broker's own error, if any, is the inner exception and is for the log only.
/// </summary>
public sealed class SessionsNotEnabledException(Exception? innerException = null)
    : Exception("This entity does not use sessions.", innerException);

/// <summary>The session state is not the one the caller expected, so nothing was written.</summary>
public sealed class SessionStateChangedException()
    : Exception("The session state changed since it was read. Reload it and try again.");

/// <summary>The session holds a state that is not UTF-8 text, so it cannot be edited as text; nothing was written.</summary>
public sealed class BinarySessionStateException()
    : Exception("This session holds a binary state and cannot be edited here.");
