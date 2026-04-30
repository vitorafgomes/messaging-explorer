using RabbitMQ.Client;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ.Services;
using System.Text;

namespace ServiceBusExplorer.Core.Providers.RabbitMQ;

/// <summary>
/// RabbitMQ provider implementation.
/// Implements <see cref="IMessagingProvider"/> to provide RabbitMQ messaging operations.
/// </summary>
public class RabbitMQProvider : IMessagingProvider
{
    private IConnection? _connection;
    private IModel? _channel;
    private RabbitMQManagementClient? _managementClient;
    private RabbitMQConnectionConfig? _currentConfig;
    private readonly RabbitMQPatternDetector _patternDetector = new();

    #region Provider Information

    /// <inheritdoc />
    public ProviderType ProviderType => ProviderType.RabbitMQ;

    /// <inheritdoc />
    public IProviderCapabilities Capabilities => RabbitMQProviderCapabilities.Instance;

    #endregion

    #region Connection Management

    /// <inheritdoc />
    public bool IsConnected => _connection != null && _connection.IsOpen;

    /// <inheritdoc />
    public string? CurrentTarget { get; private set; }

    /// <inheritdoc />
    public IConnectionConfig? CurrentConnection => _currentConfig;

    /// <inheritdoc />
    public async Task<bool> TestConnectionAsync(IConnectionConfig config)
    {
        if (config is not RabbitMQConnectionConfig rabbitConfig)
        {
            throw new ArgumentException($"Expected {nameof(RabbitMQConnectionConfig)}, got {config.GetType().Name}", nameof(config));
        }

        if (!rabbitConfig.IsValid())
        {
            Console.WriteLine($"[RabbitMQ] Config validation failed for '{rabbitConfig.Name}'");
            return false;
        }

        try
        {
            Console.WriteLine($"[RabbitMQ] Testing connection to {rabbitConfig.HostName}:{rabbitConfig.ManagementPort}...");
            using var testClient = new RabbitMQManagementClient(rabbitConfig);
            var result = await testClient.TestConnectionAsync();
            Console.WriteLine($"[RabbitMQ] Test result: {(result ? "Success" : "Failed")}");
            return result;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[RabbitMQ] Test failed: {ex.Message}");
            return false;
        }
    }

    /// <inheritdoc />
    public Task ConnectAsync(IConnectionConfig config)
    {
        if (config is not RabbitMQConnectionConfig rabbitConfig)
        {
            throw new ArgumentException($"Expected {nameof(RabbitMQConnectionConfig)}, got {config.GetType().Name}", nameof(config));
        }

        if (!rabbitConfig.IsValid())
        {
            throw new InvalidOperationException("Invalid RabbitMQ connection configuration.");
        }

        _currentConfig = rabbitConfig;

        // Create AMQP connection
        var factory = new ConnectionFactory
        {
            HostName = rabbitConfig.HostName,
            Port = rabbitConfig.Port,
            UserName = rabbitConfig.UserName,
            Password = rabbitConfig.Password,
            VirtualHost = rabbitConfig.VirtualHost,
            Ssl = { Enabled = rabbitConfig.UseSsl }
        };

        _connection = factory.CreateConnection();
        _channel = _connection.CreateModel();

        // Create Management API client
        _managementClient = new RabbitMQManagementClient(rabbitConfig);

        // Set current target to virtual host
        CurrentTarget = $"{rabbitConfig.HostName}:{rabbitConfig.Port}{rabbitConfig.VirtualHost}";

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DisconnectAsync()
    {
        _channel?.Close();
        _channel?.Dispose();
        _channel = null;

        _connection?.Close();
        _connection?.Dispose();
        _connection = null;

        _managementClient?.Dispose();
        _managementClient = null;

        _currentConfig = null;
        CurrentTarget = null;

        return Task.CompletedTask;
    }

    #endregion

    #region Queue Operations

    /// <inheritdoc />
    public async Task<IEnumerable<IQueueEntity>> GetQueuesAsync()
    {
        EnsureConnected();
        return await _managementClient!.GetQueuesAsync();
    }

    /// <inheritdoc />
    public async Task<IQueueEntity?> GetQueueAsync(string queueName)
    {
        EnsureConnected();
        return await _managementClient!.GetQueueAsync(queueName);
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

        var durable = options?.Durable ?? true;
        var autoDelete = options?.AutoDelete ?? false;
        var arguments = new Dictionary<string, object>();

        if (options != null)
        {
            if (options.DefaultMessageTimeToLive.HasValue)
            {
                arguments["x-message-ttl"] = (long)options.DefaultMessageTimeToLive.Value.TotalMilliseconds;
            }

            if (options.MaxDeliveryCount.HasValue)
            {
                // RabbitMQ doesn't have direct max delivery count, but we can set it as an argument
                // for potential use with dead letter exchanges
                arguments["x-delivery-limit"] = options.MaxDeliveryCount.Value;
            }

            if (options.DeadLetteringOnMessageExpiration)
            {
                // Set up dead letter exchange - use default DLX naming convention
                arguments["x-dead-letter-exchange"] = $"{queueName}.dlx";
            }

            // Merge any additional options
            if (options.AdditionalOptions != null)
            {
                foreach (var kvp in options.AdditionalOptions)
                {
                    arguments[kvp.Key] = kvp.Value;
                }
            }
        }

        await _managementClient!.CreateQueueAsync(
            queueName,
            durable,
            autoDelete,
            arguments.Count > 0 ? arguments : null);
    }

    /// <inheritdoc />
    public async Task DeleteQueueAsync(string queueName)
    {
        EnsureConnected();
        await _managementClient!.DeleteQueueAsync(queueName);
    }

    #endregion

    #region Topic/Exchange Operations

    /// <inheritdoc />
    public async Task<IEnumerable<ITopicEntity>> GetTopicsAsync()
    {
        EnsureConnected();
        var exchanges = await _managementClient!.GetExchangesAsync();

        // Filter out default/system exchanges (those starting with "amq." or empty name)
        var filteredExchanges = exchanges.Where(e => !string.IsNullOrEmpty(e.Name) && !e.Name.StartsWith("amq.")).ToList();

        // Load all queues for pattern detection
        var allQueues = await _managementClient.GetQueuesAsync();
        var queuesList = allQueues.OfType<RabbitMQQueueInfo>().ToList();

        // Detect patterns for each exchange
        foreach (var exchange in filteredExchanges)
        {
            try
            {
                // Load bindings for this exchange
                var bindings = await _managementClient.GetExchangeBindingsAsync(exchange.Name);
                exchange.Bindings = bindings.ToList();
                exchange.SubscriptionCount = exchange.Bindings.Count;

                // Find queues related to this exchange (bound queues)
                var relatedQueues = queuesList.Where(q =>
                    exchange.Bindings.Any(b => b.Destination == q.Name && b.DestinationType == "queue")
                ).ToList();

                // Detect pattern
                var patternInfo = _patternDetector.DetectExchangePattern(exchange, relatedQueues);
                exchange.DetectedPattern = patternInfo.PrimaryPattern;
                exchange.SecondaryPatterns = patternInfo.SecondaryPatterns;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[RabbitMQ] Error detecting pattern for exchange '{exchange.Name}': {ex.Message}");
                // Continue with other exchanges even if one fails
            }
        }

        return filteredExchanges;
    }

    /// <inheritdoc />
    public async Task<ITopicEntity?> GetTopicAsync(string topicName)
    {
        EnsureConnected();
        var exchange = await _managementClient!.GetExchangeAsync(topicName);

        if (exchange == null)
        {
            return null;
        }

        // Load bindings for this exchange
        var bindings = await _managementClient.GetExchangeBindingsAsync(topicName);
        exchange.Bindings = bindings.ToList();
        exchange.SubscriptionCount = exchange.Bindings.Count;

        try
        {
            // Load all queues for pattern detection
            var allQueues = await _managementClient.GetQueuesAsync();
            var queuesList = allQueues.OfType<RabbitMQQueueInfo>().ToList();

            // Find queues related to this exchange (bound queues)
            var relatedQueues = queuesList.Where(q =>
                exchange.Bindings.Any(b => b.Destination == q.Name && b.DestinationType == "queue")
            ).ToList();

            // Detect pattern
            var patternInfo = _patternDetector.DetectExchangePattern(exchange, relatedQueues);
            exchange.DetectedPattern = patternInfo.PrimaryPattern;
            exchange.SecondaryPatterns = patternInfo.SecondaryPatterns;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[RabbitMQ] Error detecting pattern for exchange '{exchange.Name}': {ex.Message}");
            // Return exchange without pattern detection if it fails
        }

        return exchange;
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

        var durable = options?.Durable ?? true;
        var autoDelete = options?.AutoDelete ?? false;
        var exchangeType = options?.ExchangeType ?? "topic"; // Default to topic exchange
        var arguments = new Dictionary<string, object>();

        if (options != null)
        {
            // Merge any additional options
            if (options.AdditionalOptions != null)
            {
                foreach (var kvp in options.AdditionalOptions)
                {
                    arguments[kvp.Key] = kvp.Value;
                }
            }
        }

        await _managementClient!.CreateExchangeAsync(
            topicName,
            exchangeType,
            durable,
            autoDelete,
            @internal: false,
            arguments.Count > 0 ? arguments : null);
    }

    /// <inheritdoc />
    public async Task DeleteTopicAsync(string topicName)
    {
        EnsureConnected();
        await _managementClient!.DeleteExchangeAsync(topicName);
    }

    #endregion

    #region Subscription/Binding Operations

    /// <inheritdoc />
    public async Task<IEnumerable<SubscriptionInfo>> GetSubscriptionsAsync(string topicName)
    {
        EnsureConnected();
        var bindings = await _managementClient!.GetExchangeBindingsAsync(topicName);

        var subscriptions = new List<SubscriptionInfo>();
        foreach (var binding in bindings)
        {
            var queue = await _managementClient.GetQueueAsync(binding.Destination);
            // Try to get the DLQ message count (convention: {queueName}.dlq)
            var dlqQueue = await _managementClient.GetQueueAsync($"{binding.Destination}.dlq");
            subscriptions.Add(MapBindingToSubscriptionInfo(topicName, binding, queue, dlqQueue));
        }

        return subscriptions;
    }

    /// <inheritdoc />
    public async Task<SubscriptionInfo?> GetSubscriptionAsync(string topicName, string subscriptionName)
    {
        EnsureConnected();
        var bindings = await _managementClient!.GetExchangeBindingsAsync(topicName);

        // In RabbitMQ, subscriptionName is typically the destination queue name
        var binding = bindings.FirstOrDefault(b =>
            b.Destination == subscriptionName || b.PropertiesKey == subscriptionName);

        if (binding == null)
        {
            return null;
        }

        var queue = await _managementClient.GetQueueAsync(binding.Destination);
        var dlqQueue = await _managementClient.GetQueueAsync($"{binding.Destination}.dlq");
        return MapBindingToSubscriptionInfo(topicName, binding, queue, dlqQueue);
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

        var routingKey = options?.RoutingKey ?? "#"; // Default to match all routing keys
        var arguments = new Dictionary<string, object>();

        if (options?.AdditionalOptions != null)
        {
            foreach (var kvp in options.AdditionalOptions)
            {
                arguments[kvp.Key] = kvp.Value;
            }
        }

        // First, ensure the queue exists
        var queue = await _managementClient!.GetQueueAsync(subscriptionName);
        if (queue == null)
        {
            // Create the queue with subscription options
            var queueArguments = new Dictionary<string, object>();

            if (options?.DefaultMessageTimeToLive.HasValue == true)
            {
                queueArguments["x-message-ttl"] = (long)options.DefaultMessageTimeToLive.Value.TotalMilliseconds;
            }

            if (options?.MaxDeliveryCount.HasValue == true)
            {
                queueArguments["x-delivery-limit"] = options.MaxDeliveryCount.Value;
            }

            if (options?.DeadLetteringOnMessageExpiration == true)
            {
                queueArguments["x-dead-letter-exchange"] = $"{subscriptionName}.dlx";
            }

            await _managementClient.CreateQueueAsync(
                subscriptionName,
                durable: true,
                autoDelete: false,
                queueArguments.Count > 0 ? queueArguments : null);
        }

        // Create the binding between exchange and queue
        await _managementClient.CreateQueueBindingAsync(
            topicName,
            subscriptionName,
            routingKey,
            arguments.Count > 0 ? arguments : null);
    }

    /// <inheritdoc />
    public async Task DeleteSubscriptionAsync(string topicName, string subscriptionName)
    {
        EnsureConnected();

        // Find the binding to delete
        var bindings = await _managementClient!.GetExchangeBindingsAsync(topicName);
        var binding = bindings.FirstOrDefault(b =>
            b.Destination == subscriptionName || b.PropertiesKey == subscriptionName);

        if (binding != null && binding.PropertiesKey != null)
        {
            await _managementClient.DeleteQueueBindingAsync(
                topicName,
                binding.Destination,
                binding.PropertiesKey);
        }
    }

    private static SubscriptionInfo MapBindingToSubscriptionInfo(string topicName, RabbitMQBindingInfo binding, RabbitMQQueueInfo? queue = null, RabbitMQQueueInfo? dlqQueue = null)
    {
        return new SubscriptionInfo
        {
            TopicName = topicName,
            Name = binding.Destination,
            ActiveMessageCount = queue?.ActiveMessageCount ?? 0,
            DeadLetterMessageCount = dlqQueue?.ActiveMessageCount ?? 0,
            Status = queue?.Status ?? "Active",
            CreatedAt = queue?.CreatedAt ?? DateTimeOffset.UtcNow,
            UpdatedAt = queue?.UpdatedAt ?? DateTimeOffset.UtcNow,
            AccessedAt = queue?.AccessedAt ?? DateTimeOffset.UtcNow,
            MaxDeliveryCount = queue?.MaxDeliveryCount ?? 0,
            DefaultMessageTimeToLive = queue?.DefaultMessageTimeToLive ?? TimeSpan.MaxValue,
            LockDuration = queue?.LockDuration ?? TimeSpan.Zero,
            DeadLetteringOnMessageExpiration = queue?.DeadLetteringOnMessageExpiration ?? false,
            // RabbitMQ binding uses routing key instead of filter expression
            Rules = new List<SubscriptionRuleInfo>
            {
                new()
                {
                    Name = "RoutingKey",
                    FilterType = "RoutingKey",
                    FilterExpression = binding.RoutingKey
                }
            }
        };
    }

    #endregion

    #region Message Operations

    /// <inheritdoc />
    public Task<IEnumerable<IMessage>> PeekMessagesAsync(string entityName, int count = 10, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        // Determine the queue to peek from
        var queueName = subscriptionName ?? entityName;

        if (isDeadLetter)
        {
            queueName = $"{queueName}.dlq";
        }

        // Use AMQP BasicGet directly for reliable message reading
        // Peek mode: get message, read body, then nack with requeue=true
        var messages = new List<IMessage>();
        for (var i = 0; i < count; i++)
        {
            var result = _channel!.BasicGet(queueName, autoAck: false);
            if (result == null)
                break;

            messages.Add(MapBasicGetToMessageInfo(result, isDeadLetter));

            // Nack with requeue to put the message back (peek behavior)
            _channel.BasicNack(result.DeliveryTag, multiple: false, requeue: true);
        }

        return Task.FromResult<IEnumerable<IMessage>>(messages);
    }

    /// <inheritdoc />
    public Task SendMessageAsync(string entityName, SendMessageRequest request)
    {
        EnsureConnected();

        var properties = _channel!.CreateBasicProperties();
        ConfigureBasicProperties(properties, request);

        var body = Encoding.UTF8.GetBytes(request.Body);

        // For queues, publish to default exchange with queue name as routing key
        // For exchanges, use the Subject or empty string as routing key
        var exchange = "";
        var routingKey = entityName;

        // Check if this is an exchange (topic) by trying to determine if it's a queue
        // In practice, the caller should know whether they're sending to a queue or exchange
        // For now, we'll use the convention that topics start with specific patterns or
        // if Subject is provided, we assume it's an exchange
        if (!string.IsNullOrEmpty(request.Subject))
        {
            exchange = entityName;
            routingKey = request.Subject;
        }

        _channel.BasicPublish(
            exchange: exchange,
            routingKey: routingKey,
            basicProperties: properties,
            body: body);

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task SendMessagesAsync(string entityName, IEnumerable<SendMessageRequest> requests)
    {
        EnsureConnected();

        foreach (var request in requests)
        {
            SendMessageAsync(entityName, request).Wait();
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task<IEnumerable<IMessage>> ReceiveMessagesAsync(string entityName, int count = 10, string? subscriptionName = null)
    {
        EnsureConnected();

        var queueName = subscriptionName ?? entityName;

        // Use AMQP BasicGet directly for reliable message reading
        // Consume mode: get message, read body, then ack to remove
        var messages = new List<IMessage>();
        for (var i = 0; i < count; i++)
        {
            var result = _channel!.BasicGet(queueName, autoAck: false);
            if (result == null)
                break;

            messages.Add(MapBasicGetToMessageInfo(result, false));

            // Ack to consume/remove the message
            _channel.BasicAck(result.DeliveryTag, multiple: false);
        }

        return Task.FromResult<IEnumerable<IMessage>>(messages);
    }

    /// <inheritdoc />
    public Task DeadLetterMessageAsync(string entityName, long sequenceNumber, string? subscriptionName = null)
    {
        // RabbitMQ doesn't support sequence numbers directly
        // Dead lettering is handled automatically through DLX configuration
        // This operation is not directly supported in RabbitMQ
        throw new NotSupportedException(
            "RabbitMQ does not support manual dead-lettering by sequence number. " +
            "Configure a Dead Letter Exchange (DLX) on the queue for automatic dead-lettering.");
    }

    /// <inheritdoc />
    public async Task ResubmitDeadLetterMessageAsync(string entityName, long sequenceNumber, string? subscriptionName = null)
    {
        EnsureConnected();

        var queueName = subscriptionName ?? entityName;
        var dlqName = $"{queueName}.dlq";

        // Consume 1 message from the DLQ
        var messages = (await _managementClient!.GetMessagesAsync(dlqName, 1, "ack_requeue_false", "auto")).ToList();
        if (messages.Count == 0)
        {
            throw new InvalidOperationException("No messages available in the dead letter queue.");
        }

        var msg = messages[0];
        var properties = MapPropertiesToPublishDictionary(msg.Properties);
        var payload = msg.Payload ?? string.Empty;
        var encoding = msg.PayloadEncoding == "base64" ? "base64" : "string";

        // Republish to the original queue
        if (subscriptionName != null)
        {
            // Subscription scenario: entityName is the topic/exchange, resubmit through the exchange
            await _managementClient.PublishMessageAsync(entityName, msg.RoutingKey ?? subscriptionName, payload, properties, encoding);
        }
        else
        {
            // Queue scenario: publish directly to the queue via default exchange
            await _managementClient.PublishToQueueAsync(queueName, payload, properties, encoding);
        }
    }

    /// <inheritdoc />
    public async Task<BatchOperationResult> DeleteMessagesAsync(string entityName, long[] sequenceNumbers, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var queueName = subscriptionName ?? entityName;
        if (isDeadLetter)
        {
            queueName = $"{queueName}.dlq";
        }

        var targetIndices = new HashSet<long>(sequenceNumbers);
        var maxIndex = sequenceNumbers.Max();
        var result = new BatchOperationResult();

        // Consume up to maxIndex messages from the queue
        var messages = (await _managementClient!.GetMessagesAsync(queueName, (int)maxIndex, "ack_requeue_false", "auto")).ToList();

        for (int i = 0; i < messages.Count; i++)
        {
            var position = i + 1; // 1-based index matching pseudo-sequence numbers
            var msg = messages[i];

            if (targetIndices.Contains(position))
            {
                // Target message: discard (don't republish) = delete
                result.SuccessCount++;
            }
            else
            {
                // Non-target message: republish back to the same queue
                try
                {
                    var properties = MapPropertiesToPublishDictionary(msg.Properties);
                    var payload = msg.Payload ?? string.Empty;
                    var encoding = msg.PayloadEncoding == "base64" ? "base64" : "string";
                    await _managementClient.PublishToQueueAsync(queueName, payload, properties, encoding);
                }
                catch (Exception ex)
                {
                    result.FailureCount++;
                    result.Failures.Add(new BatchOperationFailure
                    {
                        SequenceNumber = position,
                        Error = $"Failed to re-queue non-target message: {ex.Message}"
                    });
                }
            }
        }

        return result;
    }

    /// <inheritdoc />
    public async Task<BatchOperationResult> ResubmitDeadLetterMessagesAsync(string entityName, long[] sequenceNumbers, string? subscriptionName = null)
    {
        EnsureConnected();

        var queueName = subscriptionName ?? entityName;
        var dlqName = $"{queueName}.dlq";

        var targetIndices = new HashSet<long>(sequenceNumbers);
        var maxIndex = sequenceNumbers.Max();
        var result = new BatchOperationResult();

        // Consume up to maxIndex messages from the DLQ
        var messages = (await _managementClient!.GetMessagesAsync(dlqName, (int)maxIndex, "ack_requeue_false", "auto")).ToList();

        for (int i = 0; i < messages.Count; i++)
        {
            var position = i + 1;
            var msg = messages[i];
            var properties = MapPropertiesToPublishDictionary(msg.Properties);
            var payload = msg.Payload ?? string.Empty;
            var encoding = msg.PayloadEncoding == "base64" ? "base64" : "string";

            try
            {
                if (targetIndices.Contains(position))
                {
                    // Target message: resubmit to original queue/exchange
                    if (subscriptionName != null)
                    {
                        // Subscription scenario: entityName is the topic/exchange
                        await _managementClient.PublishMessageAsync(entityName, msg.RoutingKey ?? subscriptionName, payload, properties, encoding);
                    }
                    else
                    {
                        // Queue scenario: publish directly to the queue
                        await _managementClient.PublishToQueueAsync(queueName, payload, properties, encoding);
                    }
                    result.SuccessCount++;
                }
                else
                {
                    // Non-target message: republish back to the DLQ
                    await _managementClient.PublishToQueueAsync(dlqName, payload, properties, encoding);
                }
            }
            catch (Exception ex)
            {
                result.FailureCount++;
                result.Failures.Add(new BatchOperationFailure
                {
                    SequenceNumber = position,
                    Error = ex.Message
                });
            }
        }

        return result;
    }

    /// <inheritdoc />
    public async Task<BatchOperationResult> MoveMessagesAsync(string sourceEntityName, string targetQueueName, long[] sequenceNumbers, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var sourceQueue = sourceEntityName;
        if (isDeadLetter)
        {
            sourceQueue = $"{sourceEntityName}.dlq";
        }

        var targetIndices = new HashSet<long>(sequenceNumbers);
        var maxIndex = sequenceNumbers.Max();
        var result = new BatchOperationResult();

        // Consume up to maxIndex messages from the source queue
        var messages = (await _managementClient!.GetMessagesAsync(sourceQueue, (int)maxIndex, "ack_requeue_false", "auto")).ToList();

        for (int i = 0; i < messages.Count; i++)
        {
            var position = i + 1;
            var msg = messages[i];
            var properties = MapPropertiesToPublishDictionary(msg.Properties);
            var payload = msg.Payload ?? string.Empty;
            var encoding = msg.PayloadEncoding == "base64" ? "base64" : "string";

            try
            {
                if (targetIndices.Contains(position))
                {
                    // Target message: publish to the target queue
                    await _managementClient.PublishToQueueAsync(targetQueueName, payload, properties, encoding);
                    result.SuccessCount++;
                }
                else
                {
                    // Non-target message: republish back to the source queue
                    await _managementClient.PublishToQueueAsync(sourceQueue, payload, properties, encoding);
                }
            }
            catch (Exception ex)
            {
                result.FailureCount++;
                result.Failures.Add(new BatchOperationFailure
                {
                    SequenceNumber = position,
                    Error = ex.Message
                });
            }
        }

        return result;
    }

    /// <inheritdoc />
    public Task PurgeMessagesAsync(string entityName, bool isDeadLetter = false, string? subscriptionName = null)
    {
        EnsureConnected();

        var queueName = subscriptionName ?? entityName;

        if (isDeadLetter)
        {
            // Convention: DLX queue is named "{queueName}.dlq"
            queueName = $"{queueName}.dlq";
        }

        // Use AMQP channel directly for purge - more reliable than Management API
        _channel!.QueuePurge(queueName);
        return Task.CompletedTask;
    }

    private void ConfigureBasicProperties(IBasicProperties properties, SendMessageRequest request)
    {
        properties.ContentType = request.ContentType;
        properties.DeliveryMode = 2; // Persistent

        if (!string.IsNullOrEmpty(request.MessageId))
            properties.MessageId = request.MessageId;

        if (!string.IsNullOrEmpty(request.CorrelationId))
            properties.CorrelationId = request.CorrelationId;

        if (!string.IsNullOrEmpty(request.ReplyTo))
            properties.ReplyTo = request.ReplyTo;

        if (request.TimeToLive.HasValue)
            properties.Expiration = ((long)request.TimeToLive.Value.TotalMilliseconds).ToString();

        // Map application properties to headers
        if (request.ApplicationProperties != null && request.ApplicationProperties.Count > 0)
        {
            properties.Headers = new Dictionary<string, object>();
            foreach (var kvp in request.ApplicationProperties)
            {
                properties.Headers[kvp.Key] = kvp.Value;
            }
        }

        // Map additional properties to headers
        if (!string.IsNullOrEmpty(request.SessionId))
        {
            properties.Headers ??= new Dictionary<string, object>();
            properties.Headers["x-session-id"] = request.SessionId;
        }

        if (!string.IsNullOrEmpty(request.PartitionKey))
        {
            properties.Headers ??= new Dictionary<string, object>();
            properties.Headers["x-partition-key"] = request.PartitionKey;
        }

        if (!string.IsNullOrEmpty(request.To))
        {
            properties.Headers ??= new Dictionary<string, object>();
            properties.Headers["x-to"] = request.To;
        }
    }

    /// <summary>
    /// Maps a BasicGetResult from the AMQP channel to a MessageInfo.
    /// Uses direct byte access for reliable message body reading.
    /// </summary>
    private static MessageInfo MapBasicGetToMessageInfo(BasicGetResult result, bool isDeadLettered)
    {
        var props = result.BasicProperties;

        // Read body directly from AMQP bytes - no encoding issues
        var body = Encoding.UTF8.GetString(result.Body.Span);

        var applicationProperties = new Dictionary<string, object>();
        if (props?.Headers != null)
        {
            foreach (var kvp in props.Headers)
            {
                // RabbitMQ headers can be byte arrays (for string values)
                if (kvp.Value is byte[] headerBytes)
                    applicationProperties[kvp.Key] = Encoding.UTF8.GetString(headerBytes);
                else
                    applicationProperties[kvp.Key] = kvp.Value;
            }
        }

        // Parse timestamp
        var enqueuedTime = DateTimeOffset.UtcNow;
        if (props?.Timestamp.UnixTime > 0)
        {
            enqueuedTime = DateTimeOffset.FromUnixTimeSeconds(props.Timestamp.UnixTime);
        }

        // Parse expiration/TTL
        DateTimeOffset? expiresAt = null;
        var timeToLive = TimeSpan.MaxValue;
        if (!string.IsNullOrEmpty(props?.Expiration) && long.TryParse(props.Expiration, out var expirationMs))
        {
            timeToLive = TimeSpan.FromMilliseconds(expirationMs);
            expiresAt = enqueuedTime.Add(timeToLive);
        }

        // Check for dead-letter headers
        string? deadLetterSource = null;
        if (isDeadLettered && props?.Headers?.ContainsKey("x-first-death-exchange") == true)
        {
            var dlExchange = props.Headers["x-first-death-exchange"];
            deadLetterSource = dlExchange is byte[] dlBytes ? Encoding.UTF8.GetString(dlBytes) : dlExchange?.ToString();
        }

        return new MessageInfo
        {
            MessageId = props?.MessageId ?? Guid.NewGuid().ToString(),
            CorrelationId = props?.CorrelationId,
            ContentType = props?.ContentType ?? "application/octet-stream",
            Body = body,
            BodyType = "Text",
            ReplyTo = props?.ReplyTo,
            Subject = result.RoutingKey,
            DeliveryCount = result.Redelivered ? 2 : 1,
            EnqueuedTime = enqueuedTime,
            ExpiresAt = expiresAt,
            TimeToLive = timeToLive,
            ApplicationProperties = applicationProperties,
            IsDeadLettered = isDeadLettered,
            DeadLetterSource = deadLetterSource ?? (isDeadLettered ? result.Exchange : null),
            SequenceNumber = null,
            SessionId = applicationProperties.TryGetValue("x-session-id", out var sessionId) ? sessionId?.ToString() : null,
            PartitionKey = applicationProperties.TryGetValue("x-partition-key", out var partitionKey) ? partitionKey?.ToString() : null,
            To = applicationProperties.TryGetValue("x-to", out var to) ? to?.ToString() : null,
            ScheduledEnqueueTime = null
        };
    }

    private static MessageInfo MapToMessageInfo(ManagementMessageResponse message, bool isDeadLettered, long sequenceNumber = 0)
    {
        var props = message.Properties ?? new MessageProperties();

        var applicationProperties = new Dictionary<string, object>();
        if (props.Headers != null)
        {
            foreach (var kvp in props.Headers)
            {
                applicationProperties[kvp.Key] = kvp.Value;
            }
        }

        // Parse timestamp if available
        DateTimeOffset enqueuedTime = DateTimeOffset.UtcNow;
        if (props.Timestamp.HasValue)
        {
            enqueuedTime = DateTimeOffset.FromUnixTimeSeconds(props.Timestamp.Value);
        }

        // Parse expiration if available
        DateTimeOffset? expiresAt = null;
        TimeSpan timeToLive = TimeSpan.MaxValue;
        if (!string.IsNullOrEmpty(props.Expiration) && long.TryParse(props.Expiration, out var expirationMs))
        {
            timeToLive = TimeSpan.FromMilliseconds(expirationMs);
            expiresAt = enqueuedTime.Add(timeToLive);
        }

        // Decode base64 payload if needed
        var body = message.Payload ?? string.Empty;
        if (message.PayloadEncoding == "base64" && !string.IsNullOrEmpty(body))
        {
            try
            {
                var bytes = Convert.FromBase64String(body);
                body = Encoding.UTF8.GetString(bytes);
            }
            catch
            {
                // If decoding fails, keep the raw payload
            }
        }

        return new MessageInfo
        {
            MessageId = props.MessageId ?? Guid.NewGuid().ToString(),
            CorrelationId = props.CorrelationId,
            ContentType = props.ContentType ?? "application/octet-stream",
            Body = body,
            BodyType = "Text",
            ReplyTo = props.ReplyTo,
            Subject = message.RoutingKey,
            DeliveryCount = message.Redelivered ? 2 : 1,
            EnqueuedTime = enqueuedTime,
            ExpiresAt = expiresAt,
            TimeToLive = timeToLive,
            ApplicationProperties = applicationProperties,
            IsDeadLettered = isDeadLettered,
            DeadLetterSource = isDeadLettered ? message.Exchange : null,
            // Pseudo-sequence number (1-based index from peek) for frontend selection
            SequenceNumber = sequenceNumber,
            // These are Azure-specific, not applicable to RabbitMQ
            SessionId = applicationProperties.TryGetValue("x-session-id", out var sessionId) ? sessionId?.ToString() : null,
            PartitionKey = applicationProperties.TryGetValue("x-partition-key", out var partitionKey) ? partitionKey?.ToString() : null,
            To = applicationProperties.TryGetValue("x-to", out var to) ? to?.ToString() : null,
            ScheduledEnqueueTime = null
        };
    }

    /// <inheritdoc />
    public Task<MessageSearchResult> SearchMessagesAsync(
        string entityName,
        MessageSearchRequest request,
        bool isDeadLetter = false,
        string? subscriptionName = null)
        => Task.FromResult(new MessageSearchResult());

    #endregion

    #region Session Operations (Not supported)

    /// <inheritdoc />
    public Task<IEnumerable<SessionInfo>> GetSessionsAsync(string entityName, string? subscriptionName = null, int maxSessions = 50)
        => Task.FromResult(Enumerable.Empty<SessionInfo>());

    /// <inheritdoc />
    public Task SetSessionStateAsync(string entityName, string sessionId, string? state, string? subscriptionName = null)
        => throw new NotSupportedException("RabbitMQ does not support message sessions.");

    #endregion

    #region Helper Methods

    private void EnsureConnected()
    {
        if (!IsConnected)
            throw new InvalidOperationException("Not connected to RabbitMQ. Please connect first.");
    }

    private static Dictionary<string, object> MapPropertiesToPublishDictionary(MessageProperties? props)
    {
        var dict = new Dictionary<string, object>();
        if (props == null) return dict;

        if (props.ContentType != null) dict["content_type"] = props.ContentType;
        if (props.ContentEncoding != null) dict["content_encoding"] = props.ContentEncoding;
        if (props.DeliveryMode.HasValue) dict["delivery_mode"] = props.DeliveryMode.Value;
        if (props.Priority.HasValue) dict["priority"] = props.Priority.Value;
        if (props.CorrelationId != null) dict["correlation_id"] = props.CorrelationId;
        if (props.ReplyTo != null) dict["reply_to"] = props.ReplyTo;
        if (props.Expiration != null) dict["expiration"] = props.Expiration;
        if (props.MessageId != null) dict["message_id"] = props.MessageId;
        if (props.Timestamp.HasValue) dict["timestamp"] = props.Timestamp.Value;
        if (props.Type != null) dict["type"] = props.Type;
        if (props.UserId != null) dict["user_id"] = props.UserId;
        if (props.AppId != null) dict["app_id"] = props.AppId;
        if (props.Headers != null) dict["headers"] = props.Headers;

        return dict;
    }

    #endregion

    #region IAsyncDisposable

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
    }

    #endregion
}
