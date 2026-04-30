using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Services;

public interface IServiceBusService
{
    // Connection
    Task<bool> TestConnectionAsync(string connectionString);
    Task ConnectAsync(string connectionString);
    Task DisconnectAsync();
    bool IsConnected { get; }
    string? CurrentNamespace { get; }

    // Queues
    Task<IEnumerable<QueueInfo>> GetQueuesAsync();
    Task<QueueInfo?> GetQueueAsync(string queueName);
    Task CreateQueueAsync(string queueName);
    Task DeleteQueueAsync(string queueName);

    // Topics
    Task<IEnumerable<TopicInfo>> GetTopicsAsync();
    Task<TopicInfo?> GetTopicAsync(string topicName);
    Task CreateTopicAsync(string topicName);
    Task DeleteTopicAsync(string topicName);

    // Subscriptions
    Task<IEnumerable<SubscriptionInfo>> GetSubscriptionsAsync(string topicName);
    Task<SubscriptionInfo?> GetSubscriptionAsync(string topicName, string subscriptionName);
    Task CreateSubscriptionAsync(string topicName, string subscriptionName);
    Task DeleteSubscriptionAsync(string topicName, string subscriptionName);

    // Messages
    Task<IEnumerable<MessageInfo>> PeekMessagesAsync(string queueOrTopicName, int count = 10, bool isDeadLetter = false, string? subscriptionName = null);
    Task SendMessageAsync(string queueOrTopicName, SendMessageRequest message);
    Task SendMessagesAsync(string queueOrTopicName, IEnumerable<SendMessageRequest> messages);
    Task<IEnumerable<MessageInfo>> ReceiveMessagesAsync(string queueOrTopicName, int count = 10, string? subscriptionName = null);
    Task DeadLetterMessageAsync(string queueOrTopicName, long sequenceNumber, string? subscriptionName = null);
    Task ResubmitDeadLetterMessageAsync(string queueOrTopicName, long sequenceNumber, string? subscriptionName = null);
    Task PurgeMessagesAsync(string queueOrTopicName, bool isDeadLetter = false, string? subscriptionName = null);
}
