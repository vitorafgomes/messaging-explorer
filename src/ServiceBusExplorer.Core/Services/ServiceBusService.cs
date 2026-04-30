using System.Collections.Generic;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Services;

public class ServiceBusService : IServiceBusService, IAsyncDisposable
{
    private readonly ILogger<ServiceBusService> _logger;
    private ServiceBusClient? _client;
    private ServiceBusAdministrationClient? _adminClient;
    private string? _connectionString;

    /// <summary>
    /// Initializes a new instance of the ServiceBusService class.
    /// </summary>
    /// <param name="logger">Optional logger for structured logging. If null, a null logger is used.</param>
    public ServiceBusService(ILogger<ServiceBusService>? logger = null)
    {
        _logger = logger ?? NullLogger<ServiceBusService>.Instance;
    }

    public bool IsConnected => _client != null;
    public string? CurrentNamespace { get; private set; }

    public async Task<bool> TestConnectionAsync(string connectionString)
    {
        try
        {
            var adminClient = new ServiceBusAdministrationClient(connectionString);
            await adminClient.GetQueuesAsync().GetAsyncEnumerator().MoveNextAsync();
            return true;
        }
        catch
        {
            return false;
        }
    }

    public Task ConnectAsync(string connectionString)
    {
        _connectionString = connectionString;
        _client = new ServiceBusClient(connectionString);
        _adminClient = new ServiceBusAdministrationClient(connectionString);

        // Extract namespace from connection string
        var parts = connectionString.Split(';');
        foreach (var part in parts)
        {
            if (part.StartsWith("Endpoint=", StringComparison.OrdinalIgnoreCase))
            {
                var endpoint = part.Substring("Endpoint=".Length);
                var uri = new Uri(endpoint);
                CurrentNamespace = uri.Host.Split('.')[0];
                break;
            }
        }

        return Task.CompletedTask;
    }

    public async Task DisconnectAsync()
    {
        if (_client != null)
        {
            await _client.DisposeAsync();
        }
        _client = null;
        _adminClient = null;
        _connectionString = null;
        CurrentNamespace = null;
    }

    #region Queues

    public async Task<IEnumerable<QueueInfo>> GetQueuesAsync()
    {
        EnsureConnected();
        var queues = new List<QueueInfo>();

        await foreach (var queue in _adminClient!.GetQueuesRuntimePropertiesAsync())
        {
            queues.Add(MapToQueueInfo(queue));
        }

        return queues;
    }

    public async Task<QueueInfo?> GetQueueAsync(string queueName)
    {
        EnsureConnected();
        try
        {
            var response = await _adminClient!.GetQueueRuntimePropertiesAsync(queueName);
            return MapToQueueInfo(response.Value);
        }
        catch (ServiceBusException ex) when (ex.Reason == ServiceBusFailureReason.MessagingEntityNotFound)
        {
            return null;
        }
    }

    public async Task CreateQueueAsync(string queueName)
    {
        EnsureConnected();
        await _adminClient!.CreateQueueAsync(queueName);
    }

    public async Task DeleteQueueAsync(string queueName)
    {
        EnsureConnected();
        await _adminClient!.DeleteQueueAsync(queueName);
    }

    private static QueueInfo MapToQueueInfo(QueueRuntimeProperties props)
    {
        return new QueueInfo
        {
            Name = props.Name,
            ActiveMessageCount = props.ActiveMessageCount,
            DeadLetterMessageCount = props.DeadLetterMessageCount,
            ScheduledMessageCount = props.ScheduledMessageCount,
            TransferMessageCount = props.TransferMessageCount,
            SizeInBytes = props.SizeInBytes,
            CreatedAt = props.CreatedAt,
            UpdatedAt = props.UpdatedAt,
            AccessedAt = props.AccessedAt
        };
    }

    #endregion

    #region Topics

    public async Task<IEnumerable<TopicInfo>> GetTopicsAsync()
    {
        EnsureConnected();
        var topics = new List<TopicInfo>();

        await foreach (var topic in _adminClient!.GetTopicsRuntimePropertiesAsync())
        {
            topics.Add(MapToTopicInfo(topic));
        }

        return topics;
    }

    public async Task<TopicInfo?> GetTopicAsync(string topicName)
    {
        EnsureConnected();
        try
        {
            // Fetch BOTH configuration properties and runtime properties
            var propsTask = _adminClient!.GetTopicAsync(topicName);
            var runtimePropsTask = _adminClient!.GetTopicRuntimePropertiesAsync(topicName);

            await Task.WhenAll(propsTask, runtimePropsTask);

            var props = propsTask.Result.Value;
            var runtimeProps = runtimePropsTask.Result.Value;

            var topicInfo = MapToTopicInfo(props, runtimeProps);

            // Load subscriptions
            await foreach (var sub in _adminClient.GetSubscriptionsRuntimePropertiesAsync(topicName))
            {
                topicInfo.Subscriptions.Add(MapToSubscriptionInfo(sub));
            }

            return topicInfo;
        }
        catch (ServiceBusException ex) when (ex.Reason == ServiceBusFailureReason.MessagingEntityNotFound)
        {
            return null;
        }
    }

    public async Task CreateTopicAsync(string topicName)
    {
        EnsureConnected();
        await _adminClient!.CreateTopicAsync(topicName);
    }

    public async Task DeleteTopicAsync(string topicName)
    {
        EnsureConnected();
        await _adminClient!.DeleteTopicAsync(topicName);
    }

    // Overload for listing topics (runtime properties only)
    private static TopicInfo MapToTopicInfo(TopicRuntimeProperties runtimeProps)
    {
        return new TopicInfo
        {
            // Basic properties
            Name = runtimeProps.Name,

            // Runtime statistics
            SizeInBytes = runtimeProps.SizeInBytes,
            SubscriptionCount = runtimeProps.SubscriptionCount,
            ScheduledMessageCount = runtimeProps.ScheduledMessageCount,

            // Timestamps
            CreatedAt = runtimeProps.CreatedAt,
            UpdatedAt = runtimeProps.UpdatedAt,
            AccessedAt = runtimeProps.AccessedAt
        };
    }

    // Full mapping with configuration properties
    private static TopicInfo MapToTopicInfo(TopicProperties props, TopicRuntimeProperties runtimeProps)
    {
        return new TopicInfo
        {
            // Basic properties
            Name = runtimeProps.Name,

            // Runtime statistics
            SizeInBytes = runtimeProps.SizeInBytes,
            SubscriptionCount = runtimeProps.SubscriptionCount,
            ScheduledMessageCount = runtimeProps.ScheduledMessageCount,

            // Timestamps
            CreatedAt = runtimeProps.CreatedAt,
            UpdatedAt = runtimeProps.UpdatedAt,
            AccessedAt = runtimeProps.AccessedAt,

            // Configuration properties - Durations
            DefaultMessageTimeToLive = props.DefaultMessageTimeToLive,
            AutoDeleteOnIdle = props.AutoDeleteOnIdle,
            DuplicateDetectionHistoryTimeWindow = props.DuplicateDetectionHistoryTimeWindow,

            // Configuration properties - Size and capacity
            MaxSizeInMegabytes = props.MaxSizeInMegabytes,
            MaxMessageSizeInKilobytes = props.MaxMessageSizeInKilobytes ?? 256, // Default to 256 KB if null

            // Configuration properties - Features
            RequiresDuplicateDetection = props.RequiresDuplicateDetection,
            EnablePartitioning = props.EnablePartitioning,
            EnableBatchedOperations = props.EnableBatchedOperations,
            SupportOrdering = props.SupportOrdering,
            // Note: EnableExpress is not available in Azure.Messaging.ServiceBus SDK
            // It was available in the legacy Microsoft.Azure.ServiceBus library
            EnableExpress = false, // Default to false as it's deprecated

            // Configuration properties - Status and metadata
            Status = props.Status.ToString(),
            UserMetadata = props.UserMetadata ?? string.Empty
        };
    }

    #endregion

    #region Subscriptions

    public async Task<IEnumerable<SubscriptionInfo>> GetSubscriptionsAsync(string topicName)
    {
        EnsureConnected();
        var subscriptions = new List<SubscriptionInfo>();

        await foreach (var sub in _adminClient!.GetSubscriptionsRuntimePropertiesAsync(topicName))
        {
            subscriptions.Add(MapToSubscriptionInfo(sub));
        }

        return subscriptions;
    }

    public async Task<SubscriptionInfo?> GetSubscriptionAsync(string topicName, string subscriptionName)
    {
        EnsureConnected();
        try
        {
            // Get both configuration properties and runtime properties
            var propsTask = _adminClient!.GetSubscriptionAsync(topicName, subscriptionName);
            var runtimePropsTask = _adminClient!.GetSubscriptionRuntimePropertiesAsync(topicName, subscriptionName);

            await Task.WhenAll(propsTask, runtimePropsTask);

            var props = propsTask.Result.Value;
            var runtimeProps = runtimePropsTask.Result.Value;

            var subscriptionInfo = MapToSubscriptionInfo(props, runtimeProps);

            // Load subscription rules
            await foreach (var rule in _adminClient.GetRulesAsync(topicName, subscriptionName))
            {
                subscriptionInfo.Rules.Add(MapToSubscriptionRuleInfo(rule));
            }

            return subscriptionInfo;
        }
        catch (ServiceBusException ex) when (ex.Reason == ServiceBusFailureReason.MessagingEntityNotFound)
        {
            return null;
        }
    }

    public async Task CreateSubscriptionAsync(string topicName, string subscriptionName)
    {
        EnsureConnected();
        await _adminClient!.CreateSubscriptionAsync(topicName, subscriptionName);
    }

    public async Task DeleteSubscriptionAsync(string topicName, string subscriptionName)
    {
        EnsureConnected();
        await _adminClient!.DeleteSubscriptionAsync(topicName, subscriptionName);
    }

    // Overload for listing subscriptions (runtime properties only)
    private static SubscriptionInfo MapToSubscriptionInfo(SubscriptionRuntimeProperties runtimeProps)
    {
        return new SubscriptionInfo
        {
            // Basic properties
            TopicName = runtimeProps.TopicName,
            Name = runtimeProps.SubscriptionName,

            // Runtime counters
            ActiveMessageCount = runtimeProps.ActiveMessageCount,
            DeadLetterMessageCount = runtimeProps.DeadLetterMessageCount,
            TransferMessageCount = runtimeProps.TransferMessageCount,
            TransferDeadLetterMessageCount = runtimeProps.TransferDeadLetterMessageCount,

            // Timestamps
            CreatedAt = runtimeProps.CreatedAt,
            UpdatedAt = runtimeProps.UpdatedAt,
            AccessedAt = runtimeProps.AccessedAt
        };
    }

    // Full mapping with configuration properties
    private static SubscriptionInfo MapToSubscriptionInfo(SubscriptionProperties props, SubscriptionRuntimeProperties runtimeProps)
    {
        return new SubscriptionInfo
        {
            // Basic properties
            TopicName = runtimeProps.TopicName,
            Name = runtimeProps.SubscriptionName,

            // Runtime counters
            ActiveMessageCount = runtimeProps.ActiveMessageCount,
            DeadLetterMessageCount = runtimeProps.DeadLetterMessageCount,
            TransferMessageCount = runtimeProps.TransferMessageCount,
            TransferDeadLetterMessageCount = runtimeProps.TransferDeadLetterMessageCount,

            // Timestamps
            CreatedAt = runtimeProps.CreatedAt,
            UpdatedAt = runtimeProps.UpdatedAt,
            AccessedAt = runtimeProps.AccessedAt,

            // Configuration properties
            DefaultMessageTimeToLive = props.DefaultMessageTimeToLive,
            AutoDeleteOnIdle = props.AutoDeleteOnIdle,
            LockDuration = props.LockDuration,
            MaxDeliveryCount = props.MaxDeliveryCount,
            RequiresSession = props.RequiresSession,
            DeadLetteringOnMessageExpiration = props.DeadLetteringOnMessageExpiration,
            DeadLetteringOnFilterEvaluationExceptions = props.EnableDeadLetteringOnFilterEvaluationExceptions,
            EnableBatchedOperations = props.EnableBatchedOperations,
            Status = props.Status.ToString(),
            UserMetadata = props.UserMetadata,
            ForwardTo = props.ForwardTo,
            ForwardDeadLetteredMessagesTo = props.ForwardDeadLetteredMessagesTo
        };
    }

    private static SubscriptionRuleInfo MapToSubscriptionRuleInfo(RuleProperties rule)
    {
        var ruleInfo = new SubscriptionRuleInfo
        {
            Name = rule.Name
        };

        // Map filter
        if (rule.Filter is SqlRuleFilter sqlFilter)
        {
            ruleInfo.FilterType = "SqlFilter";
            ruleInfo.FilterExpression = sqlFilter.SqlExpression;
        }
        else if (rule.Filter is CorrelationRuleFilter correlationFilter)
        {
            ruleInfo.FilterType = "CorrelationFilter";
            ruleInfo.FilterExpression = $"CorrelationId: {correlationFilter.CorrelationId ?? "N/A"}";
            ruleInfo.CorrelationProperties = correlationFilter.ApplicationProperties?.ToDictionary(kvp => kvp.Key, kvp => kvp.Value);
        }
        else if (rule.Filter is TrueRuleFilter)
        {
            ruleInfo.FilterType = "TrueFilter";
            ruleInfo.FilterExpression = "1=1 (matches all messages)";
        }
        else if (rule.Filter is FalseRuleFilter)
        {
            ruleInfo.FilterType = "FalseFilter";
            ruleInfo.FilterExpression = "1=0 (matches no messages)";
        }

        // Map action
        if (rule.Action is SqlRuleAction sqlAction)
        {
            ruleInfo.ActionExpression = sqlAction.SqlExpression;
        }

        return ruleInfo;
    }

    #endregion

    #region Messages

    public async Task<IEnumerable<MessageInfo>> PeekMessagesAsync(string queueOrTopicName, int count = 10, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{queueOrTopicName}/subscriptions/{subscriptionName}"
            : queueOrTopicName;

        if (isDeadLetter)
        {
            entityPath = $"{entityPath}/$deadletterqueue";
        }

        await using var receiver = _client!.CreateReceiver(entityPath);

        // Azure Service Bus SDK limits PeekMessagesAsync to 250 messages per call
        // If more messages are requested, we need to make multiple calls
        const int maxMessagesPerPeek = 250;
        var allMessages = new List<ServiceBusReceivedMessage>();
        var remainingCount = count;
        long? fromSequenceNumber = null;

        while (remainingCount > 0)
        {
            var batchSize = Math.Min(remainingCount, maxMessagesPerPeek);
            IReadOnlyList<ServiceBusReceivedMessage> messages;

            if (fromSequenceNumber.HasValue)
            {
                messages = await receiver.PeekMessagesAsync(batchSize, fromSequenceNumber.Value);
            }
            else
            {
                messages = await receiver.PeekMessagesAsync(batchSize);
            }

            if (messages.Count == 0)
            {
                // No more messages available
                break;
            }

            allMessages.AddRange(messages);
            remainingCount -= messages.Count;

            // Set the sequence number for the next batch (start from the last message's sequence number + 1)
            if (messages.Count > 0)
            {
                fromSequenceNumber = messages[messages.Count - 1].SequenceNumber + 1;
            }

            // If we got fewer messages than requested, there are no more messages
            if (messages.Count < batchSize)
            {
                break;
            }
        }

        return allMessages.Select(MapToMessageInfo);
    }

    public async Task SendMessageAsync(string queueOrTopicName, SendMessageRequest request)
    {
        EnsureConnected();
        await using var sender = _client!.CreateSender(queueOrTopicName);

        var message = CreateServiceBusMessage(request);
        await sender.SendMessageAsync(message);
    }

    public async Task SendMessagesAsync(string queueOrTopicName, IEnumerable<SendMessageRequest> requests)
    {
        EnsureConnected();
        await using var sender = _client!.CreateSender(queueOrTopicName);

        var messages = requests.Select(CreateServiceBusMessage).ToList();
        await sender.SendMessagesAsync(messages);
    }

    public async Task<IEnumerable<MessageInfo>> ReceiveMessagesAsync(string queueOrTopicName, int count = 10, string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{queueOrTopicName}/subscriptions/{subscriptionName}"
            : queueOrTopicName;

        await using var receiver = _client!.CreateReceiver(entityPath);
        var messages = await receiver.ReceiveMessagesAsync(count, TimeSpan.FromSeconds(5));

        var result = new List<MessageInfo>();
        foreach (var message in messages)
        {
            result.Add(MapToMessageInfo(message));
            await receiver.CompleteMessageAsync(message);
        }

        return result;
    }

    public async Task DeadLetterMessageAsync(string queueOrTopicName, long sequenceNumber, string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{queueOrTopicName}/subscriptions/{subscriptionName}"
            : queueOrTopicName;

        await using var receiver = _client!.CreateReceiver(entityPath);
        var message = await receiver.ReceiveDeferredMessageAsync(sequenceNumber);

        if (message != null)
        {
            await receiver.DeadLetterMessageAsync(message, "Manual dead letter", "Moved to dead letter by user");
        }
    }

    public async Task ResubmitDeadLetterMessageAsync(string queueOrTopicName, long sequenceNumber, string? subscriptionName = null)
    {
        EnsureConnected();

        var deadLetterPath = subscriptionName != null
            ? $"{queueOrTopicName}/subscriptions/{subscriptionName}/$deadletterqueue"
            : $"{queueOrTopicName}/$deadletterqueue";

        // IMPORTANTE: Para subscriptions, sempre enviamos para o TÓPICO (não para a subscription diretamente)
        // Isso significa que a mensagem passará pelos filtros de todas as subscriptions.
        // Se a subscription original tiver filtros SQL ou de correlação, a mensagem pode não
        // voltar para ela se não atender aos critérios do filtro.
        var targetPath = queueOrTopicName; // Sempre envia para queue ou topic

        _logger.LogInformation(
            "Starting dead letter message resubmit for sequence number {SequenceNumber} from {DeadLetterPath} to {TargetPath}",
            sequenceNumber, deadLetterPath, targetPath);

        await using var receiver = _client!.CreateReceiver(deadLetterPath, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.PeekLock
        });
        await using var sender = _client!.CreateSender(targetPath);

        // Phase 1: O(1) peek-based validation - verify message exists at sequence number before attempting receive
        _logger.LogDebug("Validating message exists at sequence number {SequenceNumber} via peek", sequenceNumber);
        var peekedMessages = await receiver.PeekMessagesAsync(maxMessages: 1, fromSequenceNumber: sequenceNumber);

        if (peekedMessages.Count == 0 || peekedMessages[0].SequenceNumber != sequenceNumber)
        {
            _logger.LogDebug(
                "Peek validation failed: expected sequence number {ExpectedSequenceNumber}, found {ActualCount} message(s)",
                sequenceNumber, peekedMessages.Count);
            var errorMsg = $"Message with sequence number {sequenceNumber} not found in dead letter queue. " +
                           "The message may have been already processed, expired, or never existed.";
            throw new InvalidOperationException(errorMsg);
        }

        _logger.LogDebug("Peek validation successful for sequence number {SequenceNumber}", sequenceNumber);

        try
        {
            // Phase 2: Optimized receive pattern
            // Note: Azure Service Bus does not support receiving dead letter messages directly by sequence number
            // (ReceiveDeferredMessageAsync only works for deferred messages, not dead letter messages).
            // We must iterate through received messages to find the target. However, since we validated via peek
            // that the message exists, we can use a more targeted approach with fewer retry attempts.
            ServiceBusReceivedMessage? targetMessage = null;
            var attemptCount = 0;
            var messagesProcessed = 0;

            // Reduced attempts since peek validation confirmed the message exists
            // If not found in 3 attempts, likely a race condition occurred
            const int maxAttempts = 3;
            const int batchSize = 100;

            _logger.LogDebug(
                "Starting receive phase with max {MaxAttempts} attempts and batch size {BatchSize}",
                maxAttempts, batchSize);

            while (targetMessage == null && attemptCount < maxAttempts)
            {
                attemptCount++;
                _logger.LogDebug("Receive attempt {AttemptNumber}/{MaxAttempts}", attemptCount, maxAttempts);

                var messages = await receiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(5));

                if (messages.Count == 0)
                {
                    _logger.LogDebug("No messages received in attempt {AttemptNumber}", attemptCount);
                    break;
                }

                _logger.LogDebug("Received {MessageCount} messages in attempt {AttemptNumber}", messages.Count, attemptCount);

                foreach (var msg in messages)
                {
                    messagesProcessed++;

                    if (msg.SequenceNumber == sequenceNumber)
                    {
                        targetMessage = msg;
                        _logger.LogDebug(
                            "Found target message with sequence number {SequenceNumber} after processing {MessagesProcessed} messages",
                            sequenceNumber, messagesProcessed);
                        // Exit loop immediately - don't process remaining messages in this batch
                        // They will remain locked and eventually unlock after lock timeout
                        break;
                    }
                    else
                    {
                        // Abandon non-target messages so they return to the queue immediately
                        await receiver.AbandonMessageAsync(msg);
                    }
                }
            }

            if (targetMessage == null)
            {
                // Message was validated via peek but not found during receive - likely a race condition
                // Another process may have consumed it between our peek and receive operations
                _logger.LogError(
                    "Race condition detected: Message {SequenceNumber} validated via peek but not found after {MessagesProcessed} messages in {AttemptCount} attempts",
                    sequenceNumber, messagesProcessed, attemptCount);
                var errorMsg = $"Message with sequence number {sequenceNumber} was validated via peek but could not be received " +
                               $"after processing {messagesProcessed} messages in {attemptCount} attempts. " +
                               "This may indicate the message was consumed by another process between validation and receive.";
                throw new InvalidOperationException(errorMsg);
            }

            // Cria nova mensagem mantendo todas as propriedades originais
            var newMessage = new ServiceBusMessage(targetMessage);

            // Envia para a fila ou tópico ativo
            // Para subscriptions: a mensagem será distribuída conforme os filtros configurados
            await sender.SendMessageAsync(newMessage);
            _logger.LogDebug("Message sent to target path {TargetPath}", targetPath);

            // Remove da Dead Letter Queue
            await receiver.CompleteMessageAsync(targetMessage);

            _logger.LogInformation(
                "Successfully resubmitted dead letter message {SequenceNumber} from {DeadLetterPath} to {TargetPath} after processing {MessagesProcessed} messages",
                sequenceNumber, deadLetterPath, targetPath, messagesProcessed);
        }
        catch (ServiceBusException ex)
        {
            _logger.LogError(ex,
                "Failed to resubmit dead letter message {SequenceNumber} from {DeadLetterPath}: {ErrorMessage}",
                sequenceNumber, deadLetterPath, ex.Message);
            throw new InvalidOperationException($"Failed to resubmit message: {ex.Message}", ex);
        }
    }

    public async Task PurgeMessagesAsync(string queueOrTopicName, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{queueOrTopicName}/subscriptions/{subscriptionName}"
            : queueOrTopicName;

        if (isDeadLetter)
        {
            entityPath = $"{entityPath}/$deadletterqueue";
        }

        await using var receiver = _client!.CreateReceiver(entityPath, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.ReceiveAndDelete
        });

        while (true)
        {
            var messages = await receiver.ReceiveMessagesAsync(100, TimeSpan.FromSeconds(1));
            if (!messages.Any()) break;
        }
    }

    private static ServiceBusMessage CreateServiceBusMessage(SendMessageRequest request)
    {
        var message = new ServiceBusMessage(request.Body)
        {
            ContentType = request.ContentType
        };

        if (!string.IsNullOrEmpty(request.MessageId))
            message.MessageId = request.MessageId;
        if (!string.IsNullOrEmpty(request.CorrelationId))
            message.CorrelationId = request.CorrelationId;
        if (!string.IsNullOrEmpty(request.SessionId))
            message.SessionId = request.SessionId;
        if (!string.IsNullOrEmpty(request.PartitionKey))
            message.PartitionKey = request.PartitionKey;
        if (!string.IsNullOrEmpty(request.Subject))
            message.Subject = request.Subject;
        if (!string.IsNullOrEmpty(request.To))
            message.To = request.To;
        if (!string.IsNullOrEmpty(request.ReplyTo))
            message.ReplyTo = request.ReplyTo;
        if (request.TimeToLive.HasValue)
            message.TimeToLive = request.TimeToLive.Value;
        if (request.ScheduledEnqueueTime.HasValue)
            message.ScheduledEnqueueTime = request.ScheduledEnqueueTime.Value;

        if (request.ApplicationProperties != null)
        {
            foreach (var prop in request.ApplicationProperties)
            {
                message.ApplicationProperties[prop.Key] = prop.Value;
            }
        }

        return message;
    }

    private static MessageInfo MapToMessageInfo(ServiceBusReceivedMessage message)
    {
        string body;
        try
        {
            body = message.Body.ToString();
        }
        catch
        {
            body = Convert.ToBase64String(message.Body.ToArray());
        }

        return new MessageInfo
        {
            MessageId = message.MessageId,
            CorrelationId = message.CorrelationId,
            SessionId = message.SessionId,
            PartitionKey = message.PartitionKey,
            ReplyTo = message.ReplyTo,
            ReplyToSessionId = message.ReplyToSessionId,
            To = message.To,
            Subject = message.Subject,
            ContentType = message.ContentType,
            Body = body,
            SequenceNumber = message.SequenceNumber,
            DeliveryCount = message.DeliveryCount,
            EnqueuedTime = message.EnqueuedTime,
            ScheduledEnqueueTime = message.ScheduledEnqueueTime,
            ExpiresAt = message.ExpiresAt,
            TimeToLive = message.TimeToLive,
            DeadLetterSource = message.DeadLetterSource,
            DeadLetterReason = message.DeadLetterReason,
            DeadLetterErrorDescription = message.DeadLetterErrorDescription,
            ApplicationProperties = message.ApplicationProperties.ToDictionary(kvp => kvp.Key, kvp => kvp.Value)
        };
    }

    #endregion

    private void EnsureConnected()
    {
        if (!IsConnected)
            throw new InvalidOperationException("Not connected to Service Bus. Please connect first.");
    }

    public async ValueTask DisposeAsync()
    {
        if (_client != null)
        {
            await _client.DisposeAsync();
        }
    }
}
