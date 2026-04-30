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

    #endregion

    #region Message Operations

    /// <summary>
    /// Searches messages by peeking in batches and filtering server-side.
    /// </summary>
    Task<MessageSearchResult> SearchMessagesAsync(
        string entityName,
        MessageSearchRequest request,
        bool isDeadLetter = false,
        string? subscriptionName = null);

    /// <summary>
    /// Peeks messages from a queue or subscription without removing them.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="count">The maximum number of messages to peek.</param>
    /// <param name="isDeadLetter">Whether to peek from the dead letter queue.</param>
    /// <param name="subscriptionName">The subscription name if peeking from a topic subscription.</param>
    /// <returns>A collection of messages.</returns>
    Task<IEnumerable<IMessage>> PeekMessagesAsync(string entityName, int count = 10, bool isDeadLetter = false, string? subscriptionName = null);

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
    /// <param name="isDeadLetter">Whether to purge the dead letter queue instead.</param>
    /// <param name="subscriptionName">The subscription name if purging a topic subscription.</param>
    Task PurgeMessagesAsync(string entityName, bool isDeadLetter = false, string? subscriptionName = null);

    /// <summary>
    /// Deletes multiple messages by their sequence numbers.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="sequenceNumbers">Array of sequence numbers to delete.</param>
    /// <param name="isDeadLetter">Whether to delete from the dead letter queue.</param>
    /// <param name="subscriptionName">The subscription name if deleting from a topic subscription.</param>
    /// <returns>Result containing success count and failure details.</returns>
    Task<BatchOperationResult> DeleteMessagesAsync(string entityName, long[] sequenceNumbers, bool isDeadLetter = false, string? subscriptionName = null);

    /// <summary>
    /// Resubmits multiple dead-lettered messages back to the original queue or topic.
    /// </summary>
    /// <param name="entityName">The name of the queue or topic.</param>
    /// <param name="sequenceNumbers">Array of sequence numbers to resubmit.</param>
    /// <param name="subscriptionName">The subscription name if resubmitting from a topic subscription.</param>
    /// <returns>Result containing success count and failure details.</returns>
    Task<BatchOperationResult> ResubmitDeadLetterMessagesAsync(string entityName, long[] sequenceNumbers, string? subscriptionName = null);

    /// <summary>
    /// Moves multiple messages from one queue or subscription to another queue.
    /// </summary>
    /// <param name="sourceEntityName">The name of the source queue or topic.</param>
    /// <param name="targetQueueName">The name of the target queue.</param>
    /// <param name="sequenceNumbers">Array of sequence numbers to move.</param>
    /// <param name="isDeadLetter">Whether to move from the dead letter queue.</param>
    /// <param name="subscriptionName">The subscription name if moving from a topic subscription.</param>
    /// <returns>Result containing success count and failure details.</returns>
    Task<BatchOperationResult> MoveMessagesAsync(string sourceEntityName, string targetQueueName, long[] sequenceNumbers, bool isDeadLetter = false, string? subscriptionName = null);

    #endregion

    #region Session Operations

    /// <summary>
    /// Gets active sessions for a session-enabled queue or subscription.
    /// </summary>
    Task<IEnumerable<SessionInfo>> GetSessionsAsync(string entityName, string? subscriptionName = null, int maxSessions = 50);

    /// <summary>
    /// Sets the state of a specific session.
    /// </summary>
    Task SetSessionStateAsync(string entityName, string sessionId, string? state, string? subscriptionName = null);

    #endregion
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
    /// Provider-specific additional options.
    /// </summary>
    public Dictionary<string, object>? AdditionalOptions { get; set; }
}
