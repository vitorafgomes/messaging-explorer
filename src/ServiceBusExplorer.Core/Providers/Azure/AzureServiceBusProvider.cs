using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// Azure Service Bus provider implementation.
/// Implements <see cref="IMessagingProvider"/> to provide Azure Service Bus messaging operations.
/// </summary>
public class AzureServiceBusProvider : IMessagingProvider
{
    private readonly ILogger<AzureServiceBusProvider> _logger;
    private ServiceBusClient? _client;
    private ServiceBusAdministrationClient? _adminClient;
    private AzureConnectionConfig? _currentConfig;

    public AzureServiceBusProvider(ILogger<AzureServiceBusProvider>? logger = null)
    {
        _logger = logger ?? NullLogger<AzureServiceBusProvider>.Instance;
    }

    #region Provider Information

    /// <inheritdoc />
    public ProviderType ProviderType => ProviderType.AzureServiceBus;

    /// <inheritdoc />
    public IProviderCapabilities Capabilities => AzureProviderCapabilities.Instance;

    #endregion

    #region Connection Management

    /// <inheritdoc />
    public bool IsConnected => _client != null;

    /// <inheritdoc />
    public string? CurrentTarget { get; private set; }

    /// <inheritdoc />
    public IConnectionConfig? CurrentConnection => _currentConfig;

    /// <inheritdoc />
    public async Task<bool> TestConnectionAsync(IConnectionConfig config)
    {
        if (config is not AzureConnectionConfig azureConfig)
        {
            throw new ArgumentException($"Expected {nameof(AzureConnectionConfig)}, got {config.GetType().Name}", nameof(config));
        }

        if (!azureConfig.IsValid())
        {
            _logger.LogWarning("Azure config validation failed for connection {ConnectionName}", azureConfig.Name);
            return false;
        }

        try
        {
            _logger.LogInformation("Testing connection to Service Bus for {ConnectionName} via {AuthType}",
                azureConfig.Name, azureConfig.AuthType);
            // Do not log the connection string or any portion of it.
            var adminClient = azureConfig.AuthType == AzureAuthType.ConnectionString
                ? new ServiceBusAdministrationClient(azureConfig.ConnectionString)
                : new ServiceBusAdministrationClient(
                    azureConfig.FullyQualifiedNamespace,
                    AzureCredentialFactory.Create(azureConfig));

            // Try to get namespace properties - lightweight operation to test connection
            var namespaceProperties = await adminClient.GetNamespacePropertiesAsync();

            _logger.LogInformation("Service Bus connection test succeeded for namespace {Namespace}", namespaceProperties.Value.Name);
            return true;
        }
        catch (Exception ex)
        {
            // Azure SDK exceptions can embed connection strings into their messages.
            // Pass the exception object to the logger (stack captured) and keep the
            // template clean of any sensitive field.
            _logger.LogWarning(ex, "Service Bus connection test failed ({ExceptionType})", ex.GetType().Name);
            return false;
        }
    }

    /// <inheritdoc />
    public Task ConnectAsync(IConnectionConfig config)
    {
        if (config is not AzureConnectionConfig azureConfig)
        {
            throw new ArgumentException($"Expected {nameof(AzureConnectionConfig)}, got {config.GetType().Name}", nameof(config));
        }

        if (!azureConfig.IsValid())
        {
            throw new InvalidOperationException("Invalid Azure Service Bus connection configuration.");
        }

        _currentConfig = azureConfig;

        if (azureConfig.AuthType == AzureAuthType.ConnectionString)
        {
            _client = new ServiceBusClient(azureConfig.ConnectionString);
            _adminClient = new ServiceBusAdministrationClient(azureConfig.ConnectionString);
        }
        else
        {
            var credential = AzureCredentialFactory.Create(azureConfig);
            _client = new ServiceBusClient(azureConfig.FullyQualifiedNamespace, credential);
            _adminClient = new ServiceBusAdministrationClient(azureConfig.FullyQualifiedNamespace, credential);
        }

        // Use the config's own display logic so both auth paths produce a clean short name.
        CurrentTarget = azureConfig.GetDisplayTarget();

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public async Task DisconnectAsync()
    {
        if (_client != null)
        {
            await _client.DisposeAsync();
        }
        _client = null;
        _adminClient = null;
        _currentConfig = null;
        CurrentTarget = null;
    }

    #endregion

    #region Queue Operations

    /// <inheritdoc />
    public async Task<IEnumerable<IQueueEntity>> GetQueuesAsync()
    {
        EnsureConnected();
        var queues = new List<QueueInfo>();

        await foreach (var queue in _adminClient!.GetQueuesRuntimePropertiesAsync())
        {
            queues.Add(MapToQueueInfo(queue));
        }

        return queues;
    }

    /// <inheritdoc />
    public async Task<IQueueEntity?> GetQueueAsync(string queueName)
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

    /// <inheritdoc />
    public Task CreateQueueAsync(string queueName)
    {
        return CreateQueueAsync(queueName, null);
    }

    /// <inheritdoc />
    public async Task CreateQueueAsync(string queueName, QueueCreateOptions? options)
    {
        EnsureConnected();

        if (options == null)
        {
            await _adminClient!.CreateQueueAsync(queueName);
            return;
        }

        var queueOptions = new CreateQueueOptions(queueName);

        if (options.DefaultMessageTimeToLive.HasValue)
            queueOptions.DefaultMessageTimeToLive = options.DefaultMessageTimeToLive.Value;

        if (options.LockDuration.HasValue)
            queueOptions.LockDuration = options.LockDuration.Value;

        if (options.MaxDeliveryCount.HasValue)
            queueOptions.MaxDeliveryCount = options.MaxDeliveryCount.Value;

        queueOptions.RequiresSession = options.RequiresSession;
        queueOptions.EnablePartitioning = options.EnablePartitioning;
        queueOptions.DeadLetteringOnMessageExpiration = options.DeadLetteringOnMessageExpiration;

        await _adminClient!.CreateQueueAsync(queueOptions);
    }

    /// <inheritdoc />
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

    #region Topic/Exchange Operations

    /// <inheritdoc />
    public async Task<IEnumerable<ITopicEntity>> GetTopicsAsync()
    {
        EnsureConnected();
        var topics = new List<TopicInfo>();

        await foreach (var topic in _adminClient!.GetTopicsRuntimePropertiesAsync())
        {
            topics.Add(MapToTopicInfo(topic));
        }

        return topics;
    }

    /// <inheritdoc />
    public async Task<ITopicEntity?> GetTopicAsync(string topicName)
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

    /// <inheritdoc />
    public Task CreateTopicAsync(string topicName)
    {
        return CreateTopicAsync(topicName, null);
    }

    /// <inheritdoc />
    public async Task CreateTopicAsync(string topicName, TopicCreateOptions? options)
    {
        EnsureConnected();

        if (options == null)
        {
            await _adminClient!.CreateTopicAsync(topicName);
            return;
        }

        var topicOptions = new CreateTopicOptions(topicName);

        if (options.DefaultMessageTimeToLive.HasValue)
            topicOptions.DefaultMessageTimeToLive = options.DefaultMessageTimeToLive.Value;

        topicOptions.EnablePartitioning = options.EnablePartitioning;
        topicOptions.RequiresDuplicateDetection = options.RequiresDuplicateDetection;

        await _adminClient!.CreateTopicAsync(topicOptions);
    }

    /// <inheritdoc />
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
            EnableExpress = false, // Default to false as it's deprecated

            // Configuration properties - Status and metadata
            Status = props.Status.ToString(),
            UserMetadata = props.UserMetadata ?? string.Empty
        };
    }

    #endregion

    #region Subscription/Binding Operations

    /// <inheritdoc />
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

    /// <inheritdoc />
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

    /// <inheritdoc />
    public Task CreateSubscriptionAsync(string topicName, string subscriptionName)
    {
        return CreateSubscriptionAsync(topicName, subscriptionName, null);
    }

    /// <inheritdoc />
    public async Task CreateSubscriptionAsync(string topicName, string subscriptionName, SubscriptionCreateOptions? options)
    {
        EnsureConnected();

        if (options == null)
        {
            await _adminClient!.CreateSubscriptionAsync(topicName, subscriptionName);
            return;
        }

        var subscriptionOptions = new CreateSubscriptionOptions(topicName, subscriptionName);

        if (options.DefaultMessageTimeToLive.HasValue)
            subscriptionOptions.DefaultMessageTimeToLive = options.DefaultMessageTimeToLive.Value;

        if (options.LockDuration.HasValue)
            subscriptionOptions.LockDuration = options.LockDuration.Value;

        if (options.MaxDeliveryCount.HasValue)
            subscriptionOptions.MaxDeliveryCount = options.MaxDeliveryCount.Value;

        subscriptionOptions.RequiresSession = options.RequiresSession;
        subscriptionOptions.DeadLetteringOnMessageExpiration = options.DeadLetteringOnMessageExpiration;

        await _adminClient!.CreateSubscriptionAsync(subscriptionOptions);

        // If a filter expression is provided, replace the default rule with a SQL filter
        if (!string.IsNullOrWhiteSpace(options.FilterExpression))
        {
            // Delete the default true filter rule
            try
            {
                await _adminClient.DeleteRuleAsync(topicName, subscriptionName, "$Default");
            }
            catch (ServiceBusException)
            {
                // Rule might not exist
            }

            // Create the new filter rule
            var rule = new CreateRuleOptions("CustomFilter", new SqlRuleFilter(options.FilterExpression));
            await _adminClient.CreateRuleAsync(topicName, subscriptionName, rule);
        }
    }

    /// <inheritdoc />
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

    #region Message Operations

    /// <inheritdoc />
    public async Task<MessageSearchResult> SearchMessagesAsync(
        string entityName,
        MessageSearchRequest request,
        bool isDeadLetter = false,
        string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}"
            : entityName;

        if (isDeadLetter)
            entityPath += "/$deadletterqueue";

        var matches = new List<IMessage>();
        int totalPeeked = 0;
        long fromSequenceNumber = 0;
        int skipped = 0;
        const int batchSize = 100;

        await using var receiver = _client!.CreateReceiver(entityPath,
            new ServiceBusReceiverOptions { ReceiveMode = ServiceBusReceiveMode.PeekLock });

        while (matches.Count < request.Count)
        {
            var batch = await receiver.PeekMessagesAsync(batchSize, fromSequenceNumber);
            if (!batch.Any()) break;

            totalPeeked += batch.Count;

            foreach (var msg in batch)
            {
                var mapped = MapToMessageInfo(msg, isDeadLetter);
                if (MatchesSearch(mapped, request))
                {
                    if (skipped < request.Skip)
                    {
                        skipped++;
                        continue;
                    }
                    matches.Add(mapped);
                    if (matches.Count >= request.Count) break;
                }
            }

            fromSequenceNumber = batch.Last().SequenceNumber + 1;
            if (totalPeeked >= 10_000) break;
        }

        return new MessageSearchResult
        {
            Messages = matches,
            TotalPeeked = totalPeeked,
            TotalMatches = matches.Count + skipped,
            HasMore = totalPeeked >= 10_000 || matches.Count >= request.Count
        };
    }

    private static bool MatchesSearch(IMessage message, MessageSearchRequest request)
    {
        var fields = request.Property switch
        {
            "body" => new[] { message.Body ?? "" },
            "messageId" => new[] { message.MessageId ?? "" },
            "subject" => new[] { message.Subject ?? "" },
            "correlationId" => new[] { message.CorrelationId ?? "" },
            _ => new[]
            {
                message.Body ?? "",
                message.MessageId ?? "",
                message.Subject ?? "",
                message.CorrelationId ?? "",
                message.ApplicationProperties != null
                    ? System.Text.Json.JsonSerializer.Serialize(message.ApplicationProperties)
                    : ""
            }
        };

        foreach (var field in fields)
        {
            if (request.IsRegex)
            {
                var options = request.CaseSensitive
                    ? System.Text.RegularExpressions.RegexOptions.None
                    : System.Text.RegularExpressions.RegexOptions.IgnoreCase;
                if (System.Text.RegularExpressions.Regex.IsMatch(field, request.Query, options))
                    return true;
            }
            else
            {
                var comparison = request.CaseSensitive
                    ? StringComparison.Ordinal
                    : StringComparison.OrdinalIgnoreCase;
                if (field.Contains(request.Query, comparison)) return true;
            }
        }

        return false;
    }

    /// <inheritdoc />
    public async Task<IEnumerable<IMessage>> PeekMessagesAsync(string entityName, int count = 10, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}"
            : entityName;

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

        return allMessages.Select(m => MapToMessageInfo(m, isDeadLetter));
    }

    /// <inheritdoc />
    public async Task SendMessageAsync(string entityName, SendMessageRequest request)
    {
        EnsureConnected();
        await using var sender = _client!.CreateSender(entityName);

        var message = CreateServiceBusMessage(request);
        await sender.SendMessageAsync(message);
    }

    /// <inheritdoc />
    public async Task SendMessagesAsync(string entityName, IEnumerable<SendMessageRequest> requests)
    {
        EnsureConnected();
        await using var sender = _client!.CreateSender(entityName);

        var messages = requests.Select(CreateServiceBusMessage).ToList();
        await sender.SendMessagesAsync(messages);
    }

    /// <inheritdoc />
    public async Task<IEnumerable<IMessage>> ReceiveMessagesAsync(string entityName, int count = 10, string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}"
            : entityName;

        await using var receiver = _client!.CreateReceiver(entityPath);
        var messages = await receiver.ReceiveMessagesAsync(count, TimeSpan.FromSeconds(5));

        var result = new List<MessageInfo>();
        foreach (var message in messages)
        {
            result.Add(MapToMessageInfo(message, false));
            await receiver.CompleteMessageAsync(message);
        }

        return result;
    }

    /// <inheritdoc />
    public async Task DeadLetterMessageAsync(string entityName, long sequenceNumber, string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}"
            : entityName;

        await using var receiver = _client!.CreateReceiver(entityPath);
        var message = await receiver.ReceiveDeferredMessageAsync(sequenceNumber);

        if (message != null)
        {
            await receiver.DeadLetterMessageAsync(message, "Manual dead letter", "Moved to dead letter by user");
        }
    }

    /// <inheritdoc />
    public async Task ResubmitDeadLetterMessageAsync(string entityName, long sequenceNumber, string? subscriptionName = null)
    {
        EnsureConnected();

        var deadLetterPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}/$deadletterqueue"
            : $"{entityName}/$deadletterqueue";

        // For subscriptions, always send to the TOPIC (not to the subscription directly)
        // This means the message will pass through all subscription filters.
        var targetPath = entityName; // Always send to queue or topic

        await using var sender = _client!.CreateSender(targetPath);

        // Phase 1: Peek directly at the target sequence number (O(1) - jumps straight to it)
        await using var peekReceiver = _client!.CreateReceiver(deadLetterPath);
        var peekedMessages = await peekReceiver.PeekMessagesAsync(1, fromSequenceNumber: sequenceNumber);

        if (peekedMessages.Count == 0 || peekedMessages[0].SequenceNumber != sequenceNumber)
        {
            throw new InvalidOperationException($"Message with sequence number {sequenceNumber} not found in dead letter queue.");
        }

        // Phase 2: Create and send the new message immediately from peeked content
        var newMessage = new ServiceBusMessage(peekedMessages[0]);
        await sender.SendMessageAsync(newMessage);

        // Phase 3: Try to complete (remove) the original from DLQ with a hard limit
        // Use ReceiveAndDelete mode so we don't need to abandon messages
        // We receive small batches and check each one
        await using var receiver = _client!.CreateReceiver(deadLetterPath, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.PeekLock,
            PrefetchCount = 50
        });

        const int maxReceiveAttempts = 5;
        for (var attempt = 0; attempt < maxReceiveAttempts; attempt++)
        {
            var messages = await receiver.ReceiveMessagesAsync(100, TimeSpan.FromSeconds(3));

            if (messages.Count == 0)
                break;

            var found = false;
            var abandonTasks = new List<Task>();

            foreach (var msg in messages)
            {
                if (msg.SequenceNumber == sequenceNumber)
                {
                    await receiver.CompleteMessageAsync(msg);
                    found = true;
                }
                else
                {
                    abandonTasks.Add(receiver.AbandonMessageAsync(msg));
                }
            }

            await Task.WhenAll(abandonTasks);

            if (found)
                return;
        }

        // Message was already resubmitted successfully even if we couldn't remove it from DLQ
    }

    /// <inheritdoc />
    public async Task PurgeMessagesAsync(string entityName, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}"
            : entityName;

        if (isDeadLetter)
        {
            entityPath = $"{entityPath}/$deadletterqueue";
        }

        // Check if the entity requires sessions
        var requiresSession = false;
        if (subscriptionName != null)
        {
            var props = await _adminClient!.GetSubscriptionAsync(entityName, subscriptionName);
            requiresSession = props.Value.RequiresSession;
        }
        else
        {
            var props = await _adminClient!.GetQueueAsync(entityName);
            requiresSession = props.Value.RequiresSession;
        }

        // Dead-letter sub-queues do not support session receivers even if the parent entity requires sessions.
        // Always use the non-session receiver for dead-letter queues.
        if (requiresSession && !isDeadLetter)
        {
            await PurgeSessionEntityAsync(entityPath);
        }
        else
        {
            await PurgeNonSessionEntityAsync(entityPath);
        }
    }

    private async Task PurgeNonSessionEntityAsync(string entityPath)
    {
        await using var receiver = _client!.CreateReceiver(entityPath, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.ReceiveAndDelete,
            PrefetchCount = 100
        });

        var consecutiveEmpty = 0;
        while (consecutiveEmpty < 2)
        {
            var messages = await receiver.ReceiveMessagesAsync(100, TimeSpan.FromSeconds(5));
            if (!messages.Any())
                consecutiveEmpty++;
            else
                consecutiveEmpty = 0;
        }
    }

    private async Task PurgeSessionEntityAsync(string entityPath)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        while (!cts.Token.IsCancellationRequested)
        {
            try
            {
                await using var sessionReceiver = await _client!.AcceptNextSessionAsync(
                    entityPath,
                    new ServiceBusSessionReceiverOptions { ReceiveMode = ServiceBusReceiveMode.ReceiveAndDelete },
                    cts.Token);

                // Reset timeout — there are still active sessions
                cts.CancelAfter(TimeSpan.FromSeconds(10));

                // Drain all messages from this session
                while (true)
                {
                    var messages = await sessionReceiver.ReceiveMessagesAsync(100, TimeSpan.FromSeconds(2));
                    if (!messages.Any())
                        break;
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (ServiceBusException ex) when (ex.Reason == ServiceBusFailureReason.ServiceTimeout)
            {
                break;
            }
        }
    }

    /// <inheritdoc />
    public async Task<BatchOperationResult> DeleteMessagesAsync(string entityName, long[] sequenceNumbers, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var result = new BatchOperationResult();

        if (sequenceNumbers == null || sequenceNumbers.Length == 0)
        {
            return result;
        }

        var entityPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}"
            : entityName;

        if (isDeadLetter)
        {
            entityPath = $"{entityPath}/$deadletterqueue";
        }

        await using var receiver = _client!.CreateReceiver(entityPath, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.PeekLock
        });

        // Convert to HashSet for faster lookups
        var targetSequenceNumbers = new HashSet<long>(sequenceNumbers);
        var processedSequenceNumbers = new HashSet<long>();

        // Process messages in batches
        const int batchSize = 100;
        const int maxAttempts = 10;
        var attemptCount = 0;

        while (processedSequenceNumbers.Count < targetSequenceNumbers.Count && attemptCount < maxAttempts)
        {
            attemptCount++;

            var messages = await receiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(5));

            if (messages.Count == 0)
            {
                break;
            }

            foreach (var message in messages)
            {
                if (targetSequenceNumbers.Contains(message.SequenceNumber))
                {
                    try
                    {
                        // Complete the message to delete it
                        await receiver.CompleteMessageAsync(message);
                        processedSequenceNumbers.Add(message.SequenceNumber);
                        result.SuccessCount++;
                    }
                    catch (Exception ex)
                    {
                        result.FailureCount++;
                        result.Failures.Add(new BatchOperationFailure
                        {
                            SequenceNumber = message.SequenceNumber,
                            Error = ex.Message
                        });
                    }
                }
                else
                {
                    // Not one of our target messages, abandon it back to the queue
                    await receiver.AbandonMessageAsync(message);
                }
            }
        }

        // Check for messages that were not found
        var notFoundSequenceNumbers = targetSequenceNumbers.Except(processedSequenceNumbers);
        foreach (var sequenceNumber in notFoundSequenceNumbers)
        {
            result.FailureCount++;
            result.Failures.Add(new BatchOperationFailure
            {
                SequenceNumber = sequenceNumber,
                Error = "Message not found in queue"
            });
        }

        return result;
    }

    /// <inheritdoc />
    public async Task<BatchOperationResult> ResubmitDeadLetterMessagesAsync(string entityName, long[] sequenceNumbers, string? subscriptionName = null)
    {
        EnsureConnected();

        var result = new BatchOperationResult();

        if (sequenceNumbers == null || sequenceNumbers.Length == 0)
        {
            return result;
        }

        var deadLetterPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}/$deadletterqueue"
            : $"{entityName}/$deadletterqueue";

        // For subscriptions, always send to the TOPIC (not to the subscription directly)
        // This means the message will pass through all subscription filters.
        var targetPath = entityName; // Always send to queue or topic

        await using var receiver = _client!.CreateReceiver(deadLetterPath, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.PeekLock
        });
        await using var sender = _client!.CreateSender(targetPath);

        // Convert to HashSet for faster lookups
        var targetSequenceNumbers = new HashSet<long>(sequenceNumbers);
        var processedSequenceNumbers = new HashSet<long>();

        // Phase 1: Receive target messages from DLQ
        const int receiveBatchSize = 250;
        var messagesToResubmit = new List<ServiceBusReceivedMessage>();
        var consecutiveEmptyBatches = 0;

        while (processedSequenceNumbers.Count < targetSequenceNumbers.Count && consecutiveEmptyBatches < 3)
        {
            var messages = await receiver.ReceiveMessagesAsync(receiveBatchSize, TimeSpan.FromSeconds(10));

            if (messages.Count == 0)
            {
                consecutiveEmptyBatches++;
                continue;
            }

            consecutiveEmptyBatches = 0;
            var messagesToAbandon = new List<ServiceBusReceivedMessage>();

            foreach (var message in messages)
            {
                if (targetSequenceNumbers.Contains(message.SequenceNumber))
                {
                    messagesToResubmit.Add(message);
                    processedSequenceNumbers.Add(message.SequenceNumber);
                }
                else
                {
                    messagesToAbandon.Add(message);
                }
            }

            // Abandon non-target messages in parallel for speed
            if (messagesToAbandon.Count > 0)
            {
                await Task.WhenAll(messagesToAbandon.Select(m => receiver.AbandonMessageAsync(m)));
            }
        }

        // Phase 2: Send collected messages using ServiceBusMessageBatch
        if (messagesToResubmit.Count > 0)
        {
            var batch = await sender.CreateMessageBatchAsync();

            foreach (var message in messagesToResubmit)
            {
                var newMessage = new ServiceBusMessage(message);

                if (!batch.TryAddMessage(newMessage))
                {
                    // Batch is full, send it
                    await sender.SendMessagesAsync(batch);
                    batch.Dispose();

                    // Create a new batch starting with this message
                    batch = await sender.CreateMessageBatchAsync();
                    batch.TryAddMessage(newMessage);
                }
            }

            // Send the final batch
            await sender.SendMessagesAsync(batch);
            batch.Dispose();

            // Phase 3: Complete all sent messages from DLQ in parallel batches
            const int completeBatchSize = 20;
            for (var i = 0; i < messagesToResubmit.Count; i += completeBatchSize)
            {
                var chunk = messagesToResubmit.Skip(i).Take(completeBatchSize).ToList();
                var completeTasks = chunk.Select(async message =>
                {
                    try
                    {
                        await receiver.CompleteMessageAsync(message);
                        return (message.SequenceNumber, Success: true, Error: (string?)null);
                    }
                    catch (Exception ex)
                    {
                        return (message.SequenceNumber, Success: false, Error: ex.Message);
                    }
                });

                var results = await Task.WhenAll(completeTasks);
                foreach (var r in results)
                {
                    if (r.Success)
                    {
                        result.SuccessCount++;
                    }
                    else
                    {
                        result.FailureCount++;
                        result.Failures.Add(new BatchOperationFailure
                        {
                            SequenceNumber = r.SequenceNumber,
                            Error = r.Error ?? "Failed to complete message"
                        });
                    }
                }
            }
        }

        // Check for messages that were not found
        var notFoundSequenceNumbers = targetSequenceNumbers.Except(processedSequenceNumbers);
        foreach (var sequenceNumber in notFoundSequenceNumbers)
        {
            result.FailureCount++;
            result.Failures.Add(new BatchOperationFailure
            {
                SequenceNumber = sequenceNumber,
                Error = "Message not found in dead letter queue"
            });
        }

        return result;
    }

    /// <inheritdoc />
    public async Task<BatchOperationResult> MoveMessagesAsync(string sourceEntityName, string targetQueueName, long[] sequenceNumbers, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var result = new BatchOperationResult();

        if (sequenceNumbers == null || sequenceNumbers.Length == 0)
        {
            return result;
        }

        // Construct the source path (queue/subscription, with optional dead letter)
        var entityPath = subscriptionName != null
            ? $"{sourceEntityName}/subscriptions/{subscriptionName}"
            : sourceEntityName;

        var sourcePath = isDeadLetter
            ? $"{entityPath}/$deadletterqueue"
            : entityPath;

        await using var receiver = _client!.CreateReceiver(sourcePath, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.PeekLock
        });
        await using var sender = _client!.CreateSender(targetQueueName);

        // Convert to HashSet for faster lookups
        var targetSequenceNumbers = new HashSet<long>(sequenceNumbers);
        var processedSequenceNumbers = new HashSet<long>();

        // Process messages in batches
        const int batchSize = 100;
        const int maxAttempts = 10;
        var attemptCount = 0;

        while (processedSequenceNumbers.Count < targetSequenceNumbers.Count && attemptCount < maxAttempts)
        {
            attemptCount++;

            var messages = await receiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(5));

            if (messages.Count == 0)
            {
                break;
            }

            foreach (var message in messages)
            {
                if (targetSequenceNumbers.Contains(message.SequenceNumber))
                {
                    try
                    {
                        // Create new message keeping all original properties
                        var newMessage = new ServiceBusMessage(message);

                        // Send to the target queue
                        await sender.SendMessageAsync(newMessage);

                        // Remove from source queue
                        await receiver.CompleteMessageAsync(message);

                        processedSequenceNumbers.Add(message.SequenceNumber);
                        result.SuccessCount++;
                    }
                    catch (Exception ex)
                    {
                        result.FailureCount++;
                        result.Failures.Add(new BatchOperationFailure
                        {
                            SequenceNumber = message.SequenceNumber,
                            Error = ex.Message
                        });

                        // Abandon the message back to source queue if move failed
                        try
                        {
                            await receiver.AbandonMessageAsync(message);
                        }
                        catch
                        {
                            // Ignore abandon errors - message will eventually be unlocked
                        }
                    }
                }
                else
                {
                    // Not one of our target messages, abandon it back to the source queue
                    await receiver.AbandonMessageAsync(message);
                }
            }
        }

        // Check for messages that were not found
        var notFoundSequenceNumbers = targetSequenceNumbers.Except(processedSequenceNumbers);
        foreach (var sequenceNumber in notFoundSequenceNumbers)
        {
            result.FailureCount++;
            result.Failures.Add(new BatchOperationFailure
            {
                SequenceNumber = sequenceNumber,
                Error = $"Message not found in {(isDeadLetter ? "dead letter queue" : "queue")}"
            });
        }

        return result;
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

    private static MessageInfo MapToMessageInfo(ServiceBusReceivedMessage message, bool isDeadLettered)
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
            IsDeadLettered = isDeadLettered,
            DeadLetterSource = message.DeadLetterSource,
            DeadLetterReason = message.DeadLetterReason,
            DeadLetterErrorDescription = message.DeadLetterErrorDescription,
            ApplicationProperties = message.ApplicationProperties.ToDictionary(kvp => kvp.Key, kvp => kvp.Value)
        };
    }

    #endregion

    #region Session Operations

    /// <inheritdoc />
    public async Task<IEnumerable<SessionInfo>> GetSessionsAsync(string entityName, string? subscriptionName = null, int maxSessions = 50)
    {
        EnsureConnected();

        var entityPath = subscriptionName != null
            ? $"{entityName}/subscriptions/{subscriptionName}"
            : entityName;

        var sessions = new List<SessionInfo>();
        var seen = new HashSet<string>();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        while (sessions.Count < maxSessions && !cts.Token.IsCancellationRequested)
        {
            try
            {
                await using var receiver = await _client!.AcceptNextSessionAsync(
                    entityPath,
                    new ServiceBusSessionReceiverOptions { ReceiveMode = ServiceBusReceiveMode.PeekLock },
                    cts.Token);

                if (!seen.Add(receiver.SessionId))
                {
                    break;
                }

                BinaryData? stateData = await receiver.GetSessionStateAsync(cts.Token);
                string? stateString = null;
                if (stateData != null && stateData.ToMemory().Length > 0)
                {
                    try { stateString = stateData.ToString(); }
                    catch { stateString = Convert.ToBase64String(stateData.ToMemory().ToArray()); }
                }

                sessions.Add(new SessionInfo
                {
                    SessionId = receiver.SessionId,
                    LockedUntil = receiver.SessionLockedUntil,
                    State = stateString
                });
            }
            catch (ServiceBusException ex) when (ex.Reason == ServiceBusFailureReason.ServiceTimeout)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        return sessions;
    }

    /// <inheritdoc />
    public async Task SetSessionStateAsync(string entityName, string sessionId, string? state, string? subscriptionName = null)
    {
        EnsureConnected();

        ServiceBusSessionReceiver receiver;
        if (subscriptionName != null)
        {
            receiver = await _client!.AcceptSessionAsync(entityName, subscriptionName, sessionId);
        }
        else
        {
            receiver = await _client!.AcceptSessionAsync(entityName, sessionId);
        }

        await using (receiver)
        {
            var stateData = state != null ? BinaryData.FromString(state) : null;
            await receiver.SetSessionStateAsync(stateData);
        }
    }

    #endregion

    #region Helper Methods

    private void EnsureConnected()
    {
        if (!IsConnected)
            throw new InvalidOperationException("Not connected to Azure Service Bus. Please connect first.");
    }

    #endregion

    #region IAsyncDisposable

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (_client != null)
        {
            await _client.DisposeAsync();
            _client = null;
        }
        _adminClient = null;
        _currentConfig = null;
        CurrentTarget = null;
    }

    #endregion
}
