using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;
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
    private static readonly TimeSpan ConfirmTimeout = TimeSpan.FromSeconds(10);

    private readonly ILogger _logger;
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
            _logger.LogWarning("The RabbitMQ connection '{Name}' is not valid, so it was not tested.", rabbitConfig.Name);
            return false;
        }

        try
        {
            using var testClient = new RabbitMQManagementClient(rabbitConfig, _logger);
            return await testClient.TestConnectionAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "The RabbitMQ connection test of {Host}:{Port} failed.", rabbitConfig.HostName, rabbitConfig.ManagementPort);
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

        try
        {
            _connection = factory.CreateConnection();
        }
        catch (BrokerUnreachableException ex) when (ex.InnerException is AuthenticationFailureException)
        {
            throw new BrokerCredentialsRefusedException(ex);
        }

        _channel = _connection.CreateModel();

        // Create Management API client
        _managementClient = new RabbitMQManagementClient(rabbitConfig, _logger);

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
        return WithDeadLetterCounts(await _managementClient!.GetQueuesAsync());
    }

    /// <inheritdoc />
    public async Task<IQueueEntity?> GetQueueAsync(string queueName)
    {
        EnsureConnected();
        return await WithDeadLetterCountAsync(await _managementClient!.GetQueueAsync(queueName), CancellationToken.None);
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

    /// <inheritdoc />
    public Task UpdateQueueAsync(string queueName, QueueUpdateOptions options, CancellationToken cancellationToken = default) =>
        Task.FromException(new NotSupportedException("RabbitMQ does not support updating entities."));

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
                _logger.LogWarning(ex, "The messaging pattern of the RabbitMQ exchange '{Exchange}' could not be detected.", exchange.Name);
            }
        }

        return filteredExchanges;
    }

    /// <inheritdoc />
    public async Task<ITopicEntity?> GetTopicAsync(string topicName, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        var exchange = await _managementClient!.GetExchangeAsync(topicName);

        if (exchange == null)
        {
            return null;
        }

        var bindings = await _managementClient.GetExchangeBindingsAsync(topicName, cancellationToken);
        exchange.Bindings = bindings.ToList();
        exchange.SubscriptionCount = exchange.Bindings.Count;

        var queuesList = (await _managementClient.GetQueuesAsync()).ToList();
        var queuesByName = queuesList.DistinctBy(q => q.Name).ToDictionary(q => q.Name);
        exchange.Subscriptions = exchange.Bindings
            .Where(b => b.DestinationType == "queue")
            .Select(b => MapBindingToSubscriptionInfo(topicName, b, queuesByName.GetValueOrDefault(b.Destination), queuesByName.GetValueOrDefault($"{b.Destination}.dlq")))
            .ToList();

        try
        {
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
            _logger.LogWarning(ex, "The messaging pattern of the RabbitMQ exchange '{Exchange}' could not be detected.", exchange.Name);
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

    /// <inheritdoc />
    public Task UpdateTopicAsync(string topicName, TopicUpdateOptions options, CancellationToken cancellationToken = default) =>
        Task.FromException(new NotSupportedException("RabbitMQ does not support updating entities."));

    #endregion

    #region Subscription/Binding Operations

    /// <inheritdoc />
    public async Task<IEnumerable<SubscriptionInfo>> GetSubscriptionsAsync(string topicName)
    {
        EnsureConnected();
        var bindings = await _managementClient!.GetExchangeBindingsAsync(topicName);

        var subscriptions = new List<SubscriptionInfo>();
        foreach (var binding in bindings.Where(b => b.DestinationType == "queue"))
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

    /// <inheritdoc />
    public Task UpdateSubscriptionAsync(string topicName, string subscriptionName, SubscriptionUpdateOptions options, CancellationToken cancellationToken = default) =>
        Task.FromException(new NotSupportedException("RabbitMQ does not support updating entities."));

    internal static SubscriptionInfo MapBindingToSubscriptionInfo(string topicName, RabbitMQBindingInfo binding, RabbitMQQueueInfo? queue = null, RabbitMQQueueInfo? dlqQueue = null)
    {
        return new SubscriptionInfo
        {
            TopicName = topicName,
            Name = binding.Destination,
            ActiveMessageCount = queue?.ActiveMessageCount ?? 0,
            DeadLetterMessageCount = dlqQueue?.ActiveMessageCount ?? 0,
            Status = queue?.Status ?? "Active",
            CreatedAt = queue?.CreatedAt ?? default,
            UpdatedAt = queue?.UpdatedAt ?? default,
            AccessedAt = queue?.AccessedAt ?? default,
            MaxDeliveryCount = queue?.MaxDeliveryCount ?? 0,
            DefaultMessageTimeToLive = queue?.DefaultMessageTimeToLive ?? TimeSpan.MaxValue,
            LockDuration = queue?.LockDuration ?? TimeSpan.Zero,
            DeadLetteringOnMessageExpiration = queue?.DeadLetteringOnMessageExpiration ?? false,
            Rules = [RoutingKeyRule(binding.RoutingKey)]
        };
    }

    /// <summary>
    /// The routing key of a binding shown as a read-only rule: filter type <see cref="RuleFilterType.RoutingKey"/> with
    /// the key in <see cref="SubscriptionRuleInfo.SqlExpression"/>. It is not a rule the provider can add or change.
    /// </summary>
    internal static SubscriptionRuleInfo RoutingKeyRule(string? routingKey) =>
        new() { Name = "RoutingKey", FilterType = RuleFilterType.RoutingKey, SqlExpression = routingKey };

    #endregion

    #region Subscription Rules

    /// <inheritdoc />
    public Task<IReadOnlyList<SubscriptionRuleInfo>> GetRulesAsync(string topicName, string subscriptionName, CancellationToken cancellationToken = default) =>
        Task.FromException<IReadOnlyList<SubscriptionRuleInfo>>(RulesNotSupported());

    /// <inheritdoc />
    public Task<SubscriptionRuleInfo> CreateRuleAsync(string topicName, string subscriptionName, SubscriptionRuleInfo rule, CancellationToken cancellationToken = default) =>
        Task.FromException<SubscriptionRuleInfo>(RulesNotSupported());

    /// <inheritdoc />
    public Task<SubscriptionRuleInfo> UpdateRuleAsync(string topicName, string subscriptionName, string ruleName, SubscriptionRuleInfo rule, CancellationToken cancellationToken = default) =>
        Task.FromException<SubscriptionRuleInfo>(RulesNotSupported());

    /// <inheritdoc />
    public Task DeleteRuleAsync(string topicName, string subscriptionName, string ruleName, CancellationToken cancellationToken = default) =>
        Task.FromException(RulesNotSupported());

    private static NotSupportedException RulesNotSupported() => new("RabbitMQ does not support subscription rules.");

    #endregion

    #region Message Operations

    /// <inheritdoc />
    public async Task<IEnumerable<IMessage>> PeekMessagesAsync(string entityName, int count = 10, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, long? fromSequenceNumber = null, bool includeBody = true, CancellationToken cancellationToken = default)
    {
        if (subQueue == MessageSubQueue.TransferDeadLetter)
            throw TransferDeadLetterNotSupported();
        if (fromSequenceNumber is not null)
            throw new NotSupportedException("RabbitMQ cannot peek from a sequence number.");
        EnsureConnected();

        var queueName = QueueOf(subscriptionName ?? entityName, subQueue);
        var isDeadLetter = subQueue == MessageSubQueue.DeadLetter;
        if (isDeadLetter && await _managementClient!.GetQueueAsync(queueName, cancellationToken) is null)
            return [];
        if (await IsStreamAsync(queueName, cancellationToken))
            throw new MessageReadFailedException(StreamNotRead);

        // Use AMQP BasicGet directly for reliable message reading
        // Peek mode: get message, read body, then nack with requeue=true
        var messages = new List<IMessage>();
        var channel = _channel!;
        ulong lastTag = 0;
        try
        {
            for (var i = 0; i < count; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var result = channel.BasicGet(queueName, autoAck: false);
                if (result == null)
                    break;

                lastTag = result.DeliveryTag;
                var message = MapBasicGetToMessageInfo(result, isDeadLetter, includeBody);
                message.SequenceNumber = messages.Count + 1;
                messages.Add(message);
            }
        }
        catch (Exception ex) when (ClosedReason(ex) is { } reason)
        {
            throw new MessageReadFailedException(reason.ReplyCode switch
            {
                404 => "the queue does not exist",
                405 => "the queue is exclusive to another connection",
                540 => "a stream is not read this way",
                _ => $"AMQP {reason.ReplyCode}"
            }, ex);
        }
        finally
        {
            if (lastTag != 0 && channel.IsOpen)
                channel.BasicNack(lastTag, multiple: true, requeue: true);
        }

        return messages;
    }

    /// <inheritdoc />
    /// <remarks>
    /// A failure is an <see cref="InvalidEntityConfigurationException"/> whose message says why the broker did not take
    /// the message; see <see cref="SendConfirmed"/> for where a send goes.
    /// </remarks>
    public async Task<long?> SendMessageAsync(string entityName, SendMessageRequest request)
    {
        EnsureConnected();

        var result = await Task.Run(() => SendConfirmed(entityName, [request], CancellationToken.None));
        if (result.Failures.Count > 0)
            throw new InvalidEntityConfigurationException([result.Failures[0].Error]);
        return null;
    }

    /// <inheritdoc />
    public async Task<SendMessagesResult> SendMessagesAsync(string entityName, IEnumerable<SendMessageRequest> requests, CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        var messages = requests.ToList();
        return await Task.Run(() => SendConfirmed(entityName, messages, cancellationToken), cancellationToken);
    }

    private const string SendNotRouted = "The broker could not route the message: no queue receives it.";
    private const string SendNotAccepted = "The broker did not accept the message.";
    private const string SendTimedOut = "The broker did not confirm the message in time; it may have been sent.";
    private const string SendNoSuchName = "No queue or exchange has this name.";

    /// <summary>
    /// Sends each message on a channel of its own with <c>mandatory</c> and a publisher confirm, one at a time, and stops
    /// at the first that fails: to the queue named <paramref name="entityName"/> through the default exchange when there
    /// is one, whatever the subject, and otherwise to the exchange of that name with the subject as routing key. A
    /// message the broker returned, did not accept or did not confirm in time fails with a sentence that says which,
    /// so a message no queue received is never counted as sent.
    /// </summary>
    private SendMessagesResult SendConfirmed(string entityName, List<SendMessageRequest> messages, CancellationToken cancellationToken)
    {
        var result = new SendMessagesResult();
        var isQueue = IsQueue(entityName);
        using var channel = _connection!.CreateModel();
        var returned = 0;
        channel.BasicReturn += (_, _) => Volatile.Write(ref returned, 1);
        channel.ConfirmSelect();

        for (var i = 0; i < messages.Count; i++)
        {
            string? error;
            if (cancellationToken.IsCancellationRequested)
            {
                if (result.SentCount == 0) cancellationToken.ThrowIfCancellationRequested();
                error = SendMessageFailure.NotSent;
            }
            else
            {
                var request = messages[i];
                var properties = channel.CreateBasicProperties();
                ConfigureBasicProperties(properties, request);
                Volatile.Write(ref returned, 0);
                try
                {
                    channel.BasicPublish(isQueue ? "" : entityName, isQueue ? entityName : request.Subject ?? "", mandatory: true, properties, Encoding.UTF8.GetBytes(request.Body));
                    var confirmed = channel.WaitForConfirms(ConfirmTimeout, out var timedOut);
                    error = timedOut ? SendTimedOut
                        : !confirmed ? SendNotAccepted
                        : Volatile.Read(ref returned) == 1 ? SendNotRouted
                        : null;
                }
                catch (Exception ex) when (ClosedReason(ex) is { ReplyCode: 404 })
                {
                    error = SendNoSuchName;
                }
                catch (Exception) when (result.SentCount > 0)
                {
                    error = SendMessageFailure.Unconfirmed;
                }
            }

            if (error == null)
            {
                result.SentCount++;
                continue;
            }

            result.Failures.Add(new SendMessageFailure { Index = i, Error = error });
            result.Failures.AddRange(Enumerable.Range(i + 1, messages.Count - i - 1).Select(n => new SendMessageFailure { Index = n, Error = SendMessageFailure.NotSent }));
            break;
        }

        return result;
    }

    /// <summary>
    /// Whether a queue has this name, asked on a channel of its own, since the broker closes it when there is none (404)
    /// and when the queue is exclusive to another connection (405), which is still a queue.
    /// </summary>
    private bool IsQueue(string name)
    {
        using var probe = _connection!.CreateModel();
        try
        {
            probe.QueueDeclarePassive(name);
            return true;
        }
        catch (OperationInterruptedException ex) when (ex.ShutdownReason is { ReplyCode: 404 or 405 })
        {
            return ex.ShutdownReason.ReplyCode == 405;
        }
    }

    private static ShutdownEventArgs? ClosedReason(Exception ex) => ex switch
    {
        AlreadyClosedException closed => closed.ShutdownReason,
        OperationInterruptedException interrupted => interrupted.ShutdownReason,
        _ => null
    };

    /// <inheritdoc />
    /// <remarks>A stream is refused before the broker is asked, as on a peek.</remarks>
    public async Task<IEnumerable<IMessage>> ReceiveMessagesAsync(string entityName, int count = 10, string? subscriptionName = null)
    {
        EnsureConnected();

        var queueName = subscriptionName ?? entityName;
        if (await IsStreamAsync(queueName, CancellationToken.None))
            throw new MessageReadFailedException(StreamNotRead);

        var messages = new List<IMessage>();
        for (var i = 0; i < count; i++)
        {
            var result = _channel!.BasicGet(queueName, autoAck: false);
            if (result == null)
                break;

            messages.Add(MapBasicGetToMessageInfo(result, false));
            _channel.BasicAck(result.DeliveryTag, multiple: false);
        }

        return messages;
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
    /// <remarks>
    /// Runs the batch resubmit with the one position, so the chosen message is the one sent. RabbitMQ has no duplicate
    /// detection, so <paramref name="newMessageIdOnDuplicateDetection"/> changes nothing.
    /// </remarks>
    public async Task ResubmitDeadLetterMessageAsync(string entityName, long sequenceNumber, string? subscriptionName = null, bool newMessageIdOnDuplicateDetection = false)
    {
        var result = await ResubmitDeadLetterMessagesAsync(entityName, [sequenceNumber], MessageSubQueue.DeadLetter, subscriptionName, newMessageIdOnDuplicateDetection);
        if (result.Failures.Count > 0)
            throw new InvalidOperationException(result.Failures[0].Error);
    }

    /// <inheritdoc />
    /// <remarks>
    /// The messages up to the last chosen position are held unacknowledged; the chosen ones are acknowledged, which
    /// removes them, and the others go back in their order. Nothing is published. A queue with a consumer is refused,
    /// since a position may no longer name the message that was shown. With <paramref name="all"/> the queue is purged,
    /// and a stream is refused first, as on a purge.
    /// </remarks>
    public async Task<BatchOperationResult> DeleteMessagesAsync(string entityName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, bool all = false, CancellationToken cancellationToken = default)
    {
        if (subQueue == MessageSubQueue.TransferDeadLetter)
            throw TransferDeadLetterNotSupported();

        EnsureConnected();

        var queueName = QueueOf(subscriptionName ?? entityName, subQueue);

        if (all)
        {
            if (await IsStreamAsync(queueName, cancellationToken))
                throw new InvalidEntityConfigurationException([StreamNotPurged]);
            return new BatchOperationResult { SuccessCount = checked((int)_channel!.QueuePurge(queueName)) };
        }

        if (sequenceNumbers == null || sequenceNumbers.Length == 0)
            return new BatchOperationResult();

        var positions = sequenceNumbers.Distinct().Order().ToArray();
        var stream = await IsStreamAsync(queueName, cancellationToken);
        return await Task.Run(() => TransferConfirmed(null, queueName, positions, "Not deleted", subQueue, stream, cancellationToken), cancellationToken);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Send first, remove after: each chosen message is published to its queue with a publisher confirm and is removed
    /// from the dead-letter queue only once the broker confirmed it. The messages are held unacknowledged meanwhile and
    /// the ones not chosen go back in their order. A dead-letter queue with a consumer is refused, since a position may
    /// no longer name the message that was shown. RabbitMQ has no duplicate detection, so
    /// <paramref name="newMessageIdOnDuplicateDetection"/> changes nothing.
    /// </remarks>
    public async Task<BatchOperationResult> ResubmitDeadLetterMessagesAsync(string entityName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.DeadLetter, string? subscriptionName = null, bool newMessageIdOnDuplicateDetection = false, CancellationToken cancellationToken = default)
    {
        if (subQueue == MessageSubQueue.TransferDeadLetter)
            throw TransferDeadLetterNotSupported();
        if (subQueue == MessageSubQueue.Active)
            throw new ArgumentOutOfRangeException(nameof(subQueue), "A resubmit reads a dead-letter queue.");

        EnsureConnected();

        if (sequenceNumbers == null || sequenceNumbers.Length == 0)
            return new BatchOperationResult();

        var queueName = subscriptionName ?? entityName;
        var positions = sequenceNumbers.Distinct().Order().ToArray();
        var stream = await IsStreamAsync($"{queueName}.dlq", cancellationToken);
        return await Task.Run(() => TransferConfirmed(queueName, $"{queueName}.dlq", positions, "Not resubmitted", MessageSubQueue.DeadLetter, stream, cancellationToken), cancellationToken);
    }

    /// <summary>A channel closed by the broker for access refused (403) or a failed precondition (406): the message was not taken.</summary>
    private static bool IsBrokerRefusal(Exception ex)
    {
        return ClosedForAFrameItReceived(ClosedReason(ex));
    }

    /// <summary>
    /// A close the broker answered to a frame of this channel, access refused (403) or a failed precondition (406): it
    /// processed every frame before that one. A 406 for an expired delivery comes from the broker's own clock instead.
    /// </summary>
    private static bool ClosedForAFrameItReceived(ShutdownEventArgs? reason) =>
        reason is { Initiator: ShutdownInitiator.Peer, ReplyCode: 403 or 406 }
        && !reason.ReplyText.Contains("delivery acknowledgement", StringComparison.OrdinalIgnoreCase);

    private const string StreamNotRead = "a stream is not read this way";
    private const string StreamNotPurged = "A stream cannot be purged: it keeps its messages until its retention removes them.";

    /// <summary>
    /// Whether the queue is a stream, read from the management API before the broker is asked for a message: a stream
    /// answers a get by closing the whole connection. When the management API cannot be reached, times out or
    /// answers what cannot be read, the type is unknown, the answer is false and the broker decides.
    /// </summary>
    private async Task<bool> IsStreamAsync(string queueName, CancellationToken cancellationToken)
    {
        try
        {
            return (await _managementClient!.GetQueueAsync(queueName, cancellationToken))?.QueueType == "stream";
        }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException
            || (ex is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        {
            return false;
        }
    }

    /// <summary>The highest position a bulk call holds messages up to: the most a peek shows.</summary>
    private const int MaxPosition = 1000;

    /// <summary>
    /// Holds the messages of <paramref name="sourceQueue"/> up to the last of <paramref name="positions"/> and, for each
    /// chosen one, publishes it to <paramref name="targetQueue"/> with a confirm and then acknowledges it, or only
    /// acknowledges it when there is no target; the others go back in their order. The publish and its confirm run on a
    /// channel of their own, so a publish the broker refuses closes that one and the held messages are still requeued
    /// by the channel that holds them, not returned by its death. The batch stops at the first
    /// failure, and a removal the broker did not prove is reported, never counted as a success. A position beyond
    /// <see cref="MaxPosition"/> is refused before anything is read, so the messages held are bounded.
    /// </summary>
    private BatchOperationResult TransferConfirmed(string? targetQueue, string sourceQueue, long[] positions, string not, MessageSubQueue subQueue, bool sourceIsStream, CancellationToken cancellationToken)
    {
        var source = subQueue == MessageSubQueue.DeadLetter ? "the dead-letter queue" : "the queue";
        var stoppedAfterAFailure = $"{not}: the batch stopped after an earlier message failed. The message is still in {source}.";
        var result = new BatchOperationResult();
        void Fail(long position, string error, bool possibleDuplicate = false)
        {
            result.FailureCount++;
            result.Failures.Add(new BatchOperationFailure { SequenceNumber = position, Error = error, PossibleDuplicate = possibleDuplicate });
        }
        BatchOperationResult FailAll(string error)
        {
            foreach (var position in positions) Fail(position, error);
            return result;
        }

        if (sourceIsStream)
            return FailAll($"{not}: {StreamNotRead}. Nothing was sent or removed.");
        if (positions[^1] > MaxPosition)
            return FailAll($"{not}: a position beyond {MaxPosition} cannot be reached. Nothing was sent or removed.");

        using var channel = _connection!.CreateModel();
        uint consumers;
        try
        {
            consumers = channel.QueueDeclarePassive(sourceQueue).ConsumerCount;
        }
        catch (OperationInterruptedException)
        {
            return FailAll(subQueue == MessageSubQueue.DeadLetter ? $"{not}: this queue has no dead-letter queue." : $"{not}: the queue does not exist.");
        }
        if (consumers > 0)
            return FailAll($"{not}: {source} has a consumer, so the position of a message may have changed. Nothing was sent or removed.");

        var returned = 0;
        using var publisher = targetQueue != null ? _connection.CreateModel() : null;
        if (publisher != null)
        {
            publisher.BasicReturn += (_, _) => Volatile.Write(ref returned, 1);
            publisher.ConfirmSelect();
        }
        var held = new List<BasicGetResult?>();
        var removed = new List<long>();
        string? stopped = null;
        try
        {
            try
            {
                while (held.Count < positions[^1])
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var delivery = channel.BasicGet(sourceQueue, autoAck: false);
                    if (delivery == null) break;
                    held.Add(delivery);
                }
            }
            catch (Exception ex) when (ex is AlreadyClosedException or OperationInterruptedException or IOException)
            {
                return FailAll($"{not}: {source} could not be read ({ex.Message}). Nothing was sent or removed.");
            }

            foreach (var position in positions)
            {
                if (stopped != null)
                {
                    Fail(position, stopped);
                    continue;
                }
                if (cancellationToken.IsCancellationRequested)
                {
                    Fail(position, $"{not}: the operation was cancelled. The message is still in {source}.");
                    continue;
                }
                if (position < 1 || position > held.Count)
                {
                    Fail(position, $"{not}: no message at this position in {source}.");
                    continue;
                }

                var message = held[(int)position - 1]!;
                if (publisher != null)
                {
                    try
                    {
                        Volatile.Write(ref returned, 0);
                        publisher.BasicPublish("", targetQueue, mandatory: true, message.BasicProperties, message.Body);
                    }
                    catch (Exception ex) when (ex is AlreadyClosedException or OperationInterruptedException or IOException)
                    {
                        Fail(position, $"{not}: {ex.Message}. The message is still in {source}.");
                        stopped = stoppedAfterAFailure;
                        continue;
                    }

                    bool confirmed, timedOut;
                    try
                    {
                        confirmed = publisher.WaitForConfirms(ConfirmTimeout, out timedOut);
                    }
                    catch (Exception ex) when (ex is AlreadyClosedException or OperationInterruptedException or IOException)
                    {
                        if (IsBrokerRefusal(ex))
                            Fail(position, $"{not}: the broker refused the message ({ex.Message}). It is still in {source}.");
                        else
                            Fail(position, $"The connection failed before the broker confirmed: the message may have been sent and is still in {source}. It may be duplicated.", possibleDuplicate: true);
                        stopped = stoppedAfterAFailure;
                        continue;
                    }
                    if (timedOut)
                    {
                        Fail(position, $"The broker did not confirm in time: the message may have been sent and is still in {source}. It may be duplicated.", possibleDuplicate: true);
                        stopped = stoppedAfterAFailure;
                        continue;
                    }
                    if (!confirmed || Volatile.Read(ref returned) == 1)
                    {
                        Fail(position, $"{not}: the broker did not accept the message. It is still in {source}.");
                        stopped = stoppedAfterAFailure;
                        continue;
                    }
                }

                try
                {
                    channel.BasicAck(message.DeliveryTag, multiple: false);
                    held[(int)position - 1] = null;
                    removed.Add(position);
                }
                catch (Exception ex) when (ex is AlreadyClosedException or OperationInterruptedException or IOException)
                {
                    Fail(position, targetQueue != null
                        ? $"Sent, but not removed from {source}. It may be duplicated."
                        : $"The removal from {source} was not confirmed. The message may still be there.", possibleDuplicate: targetQueue != null);
                    stopped = stoppedAfterAFailure;
                }
            }
        }
        finally
        {
            try
            {
                if (held.FindLast(kept => kept != null) is { } last && channel.IsOpen)
                    channel.BasicNack(last.DeliveryTag, multiple: true, requeue: true);
            }
            catch (Exception ex) when (ex is AlreadyClosedException or OperationInterruptedException or IOException)
            {
            }
        }

        if (RemovalsSettled(channel))
            result.SuccessCount += removed.Count;
        else
            foreach (var position in removed)
                Fail(position, targetQueue != null
                    ? $"Sent, but its removal from {source} was not confirmed. It may be duplicated."
                    : $"The removal from {source} was not confirmed. The message may still be there.", possibleDuplicate: targetQueue != null);

        return result;
    }

    /// <summary>
    /// Whether the broker processed every acknowledgement sent on the channel: a close it answered comes after them, and a
    /// channel it closed for a refusal processed the frames before the one it refused.
    /// </summary>
    private static bool RemovalsSettled(IModel channel)
    {
        if (!channel.IsOpen)
            return ClosedForAFrameItReceived(channel.CloseReason);
        try
        {
            channel.Close();
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <inheritdoc />
    /// <remarks>
    /// Send first, remove after, as a resubmit: each chosen message is published to the target queue with a publisher
    /// confirm and removed from its source only once the broker confirmed it; a target that does not exist returns the
    /// message, which then stays in the source. RabbitMQ has no duplicate detection, so
    /// <paramref name="newMessageIdOnDuplicateDetection"/> changes nothing.
    /// </remarks>
    public async Task<BatchOperationResult> MoveMessagesAsync(string sourceEntityName, string targetQueueName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, bool newMessageIdOnDuplicateDetection = false, CancellationToken cancellationToken = default)
    {
        if (subQueue == MessageSubQueue.TransferDeadLetter)
            throw TransferDeadLetterNotSupported();

        EnsureConnected();

        if (sequenceNumbers == null || sequenceNumbers.Length == 0)
            return new BatchOperationResult();

        var sourceQueue = QueueOf(subscriptionName ?? sourceEntityName, subQueue);
        var positions = sequenceNumbers.Distinct().Order().ToArray();
        var stream = await IsStreamAsync(sourceQueue, cancellationToken);
        return await Task.Run(() => TransferConfirmed(targetQueueName, sourceQueue, positions, "Not moved", subQueue, stream, cancellationToken), cancellationToken);
    }

    /// <inheritdoc />
    /// <remarks>A stream is refused before the broker is asked: it answers a purge by closing the whole connection.</remarks>
    public async Task PurgeMessagesAsync(string entityName, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, CancellationToken cancellationToken = default)
    {
        if (subQueue == MessageSubQueue.TransferDeadLetter)
            throw TransferDeadLetterNotSupported();

        EnsureConnected();

        var queueName = QueueOf(subscriptionName ?? entityName, subQueue);
        if (await IsStreamAsync(queueName, cancellationToken))
            throw new InvalidEntityConfigurationException([StreamNotPurged]);

        _channel!.QueuePurge(queueName);
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
    /// A header value as the screen and JSON can show it: the client hands text over as bytes at every depth, as in
    /// the x-death list a dead-lettered message carries, and a time as its own type.
    /// </summary>
    private static object HeaderValue(object? value) => value switch
    {
        null => "",
        byte[] bytes => Encoding.UTF8.GetString(bytes),
        AmqpTimestamp time => DateTimeOffset.FromUnixTimeSeconds(time.UnixTime).ToString("yyyy-MM-ddTHH:mm:ssZ", System.Globalization.CultureInfo.InvariantCulture),
        IDictionary<string, object> table => table.ToDictionary(entry => entry.Key, entry => HeaderValue(entry.Value)),
        System.Collections.IList list => list.Cast<object?>().Select(HeaderValue).ToList(),
        _ => value
    };

    /// <summary>
    /// Maps a BasicGetResult from the AMQP channel to a MessageInfo.
    /// Uses direct byte access for reliable message body reading.
    /// </summary>
    internal static MessageInfo MapBasicGetToMessageInfo(BasicGetResult result, bool isDeadLettered, bool includeBody = true)
    {
        var props = result.BasicProperties;

        // Read body directly from AMQP bytes - no encoding issues
        var body = includeBody ? Encoding.UTF8.GetString(result.Body.Span) : null;

        var applicationProperties = new Dictionary<string, object>();
        if (props?.Headers != null)
        {
            foreach (var kvp in props.Headers)
            {
                applicationProperties[kvp.Key] = HeaderValue(kvp.Value);
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
            ScheduledEnqueueTime = null,
            State = "Active",
            SizeInBytes = result.Body.Length
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
            ScheduledEnqueueTime = null,
            State = "Active",
            SizeInBytes = message.PayloadBytes
        };
    }

    /// <inheritdoc />
    public Task<MessageSearchResult> SearchMessagesAsync(
        string entityName,
        MessageSearchRequest request,
        MessageSubQueue subQueue = MessageSubQueue.Active,
        string? subscriptionName = null,
        CancellationToken cancellationToken = default)
        => Task.FromException<MessageSearchResult>(subQueue == MessageSubQueue.TransferDeadLetter
            ? TransferDeadLetterNotSupported()
            : new NotSupportedException("RabbitMQ does not support searching messages."));

    /// <inheritdoc />
    public Task<BatchOperationResult> CancelScheduledMessagesAsync(string entityName, long[] sequenceNumbers, CancellationToken cancellationToken = default) =>
        Task.FromException<BatchOperationResult>(new NotSupportedException("RabbitMQ does not support scheduled messages."));

    /// <inheritdoc />
    public Task<BatchOperationResult> DeleteDeferredMessagesAsync(string entityName, long[] sequenceNumbers, string? subscriptionName = null, CancellationToken cancellationToken = default) =>
        Task.FromException<BatchOperationResult>(DeferralNotSupported());

    /// <inheritdoc />
    public Task<BatchOperationResult> ResubmitDeferredMessagesAsync(string entityName, long[] sequenceNumbers, string? subscriptionName = null, bool newMessageIdOnDuplicateDetection = false, CancellationToken cancellationToken = default) =>
        Task.FromException<BatchOperationResult>(DeferralNotSupported());

    /// <inheritdoc />
    public Task<BatchOperationResult> DeadLetterDeferredMessagesAsync(string entityName, long[] sequenceNumbers, string? subscriptionName = null, string? reason = null, string? description = null, CancellationToken cancellationToken = default) =>
        Task.FromException<BatchOperationResult>(DeferralNotSupported());

    /// <inheritdoc />
    public Task<BatchOperationResult> DeadLetterMessagesAsync(string entityName, long[] sequenceNumbers, string? subscriptionName = null, string? reason = null, string? description = null, CancellationToken cancellationToken = default) =>
        Task.FromException<BatchOperationResult>(new NotSupportedException("RabbitMQ does not support dead-lettering a message by sequence number."));

    /// <inheritdoc />
    public Task<BatchOperationResult> DeferMessagesAsync(string entityName, long[] sequenceNumbers, string? subscriptionName = null, CancellationToken cancellationToken = default) =>
        Task.FromException<BatchOperationResult>(DeferralNotSupported());

    private static NotSupportedException DeferralNotSupported() => new("RabbitMQ does not support deferred messages.");

    /// <summary>
    /// The RabbitMQ queue of a sub-queue: the queue itself, or its dead-letter queue, named "{queue}.dlq" by convention.
    /// </summary>
    private static string QueueOf(string queueName, MessageSubQueue subQueue) =>
        subQueue == MessageSubQueue.DeadLetter ? $"{queueName}.dlq" : queueName;

    private static NotSupportedException TransferDeadLetterNotSupported() =>
        new("RabbitMQ does not support the transfer dead-letter queue.");

    #endregion

    #region Entity Definitions (Not supported)

    /// <inheritdoc />
    public Task<EntityDefinitionsDocument> ExportDefinitionsAsync(CancellationToken cancellationToken = default)
        => throw new NotSupportedException("RabbitMQ does not support entity definitions.");

    /// <inheritdoc />
    public Task<DefinitionsImportResult> ImportDefinitionsAsync(EntityDefinitionsDocument document, bool dryRun, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("RabbitMQ does not support entity definitions.");

    #endregion

    #region Session Operations (Not supported)

    /// <inheritdoc />
    public Task<SessionList> GetSessionsAsync(string entityName, string? subscriptionName, int maxMessages, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("RabbitMQ does not support message sessions.");

    /// <inheritdoc />
    public Task<SessionDetail> SetSessionStateAsync(string entityName, string? subscriptionName, string sessionId, string? state, string? expectedState, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("RabbitMQ does not support message sessions.");

    /// <inheritdoc />
    public Task<SessionDetail> GetSessionAsync(string entityName, string? subscriptionName, string sessionId, int messageCount = 0, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("RabbitMQ does not support message sessions.");

    /// <inheritdoc />
    public Task<IEnumerable<IMessage>> PeekSessionMessagesAsync(string entityName, string? subscriptionName, string sessionId, int count, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("RabbitMQ does not support message sessions.");

    #endregion

    #region Helper Methods

    private void EnsureConnected()
    {
        if (!IsConnected)
            throw new InvalidOperationException("Not connected to RabbitMQ. Please connect first.");
        if (_channel is { IsOpen: false })
            _channel = _connection!.CreateModel();
    }

    #endregion

    #region IAsyncDisposable

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
    }

    #endregion

    #region Construction

    public RabbitMQProvider(ILogger<RabbitMQProvider>? logger = null)
    {
        _logger = logger ?? NullLogger<RabbitMQProvider>.Instance;
    }

    /// <summary>
    /// A provider over a connection and a management client that are already open, for tests that answer the
    /// management API with a handler of their own.
    /// </summary>
    internal RabbitMQProvider(IConnection connection, RabbitMQManagementClient managementClient, IModel? channel = null) : this()
    {
        _connection = connection;
        _managementClient = managementClient;
        _channel = channel;
    }

    #endregion

    #region Counts

    /// <inheritdoc />
    public async Task<IQueueEntity?> GetQueueCountsAsync(string queueName, CancellationToken cancellationToken)
    {
        EnsureConnected();
        return await WithDeadLetterCountAsync(await _managementClient!.GetQueueAsync(queueName, cancellationToken), cancellationToken);
    }

    /// <inheritdoc />
    public async Task<SubscriptionInfo?> GetSubscriptionCountsAsync(string topicName, string subscriptionName, CancellationToken cancellationToken)
    {
        EnsureConnected();
        IEnumerable<RabbitMQBindingInfo> bindings;
        try
        {
            bindings = await _managementClient!.GetExchangeBindingsAsync(topicName, cancellationToken);
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }

        var binding = bindings.FirstOrDefault(b => b.Destination == subscriptionName || b.PropertiesKey == subscriptionName);
        if (binding == null)
        {
            return null;
        }

        var queue = await _managementClient.GetQueueAsync(binding.Destination, cancellationToken);
        var dlqQueue = await _managementClient.GetQueueAsync($"{binding.Destination}.dlq", cancellationToken);
        return MapBindingToSubscriptionInfo(topicName, binding, queue, dlqQueue);
    }

    /// <inheritdoc />
    public Task<NamespaceInfo> GetNamespacePropertiesAsync(CancellationToken cancellationToken) =>
        Task.FromException<NamespaceInfo>(new NotSupportedException("RabbitMQ has no namespace properties."));

    /// <summary>
    /// Fills each queue's dead-letter count with the ready messages of its <c>&lt;queue&gt;.dlq</c> from the same list,
    /// the convention a subscription's dead-letter count follows; zero when there is none.
    /// </summary>
    private static List<RabbitMQQueueInfo> WithDeadLetterCounts(IEnumerable<RabbitMQQueueInfo> queues)
    {
        var listed = queues.ToList();
        var byName = listed.ToDictionary(q => q.Name, StringComparer.Ordinal);
        foreach (var queue in listed)
        {
            queue.DeadLetterMessageCount = byName.TryGetValue($"{queue.Name}.dlq", out var deadLetter) ? deadLetter.ActiveMessageCount : 0;
        }

        return listed;
    }

    /// <summary>
    /// Reads the queue's <c>&lt;queue&gt;.dlq</c> and fills its dead-letter count with that queue's ready messages; zero
    /// when there is none.
    /// </summary>
    private async Task<RabbitMQQueueInfo?> WithDeadLetterCountAsync(RabbitMQQueueInfo? queue, CancellationToken cancellationToken)
    {
        if (queue == null)
        {
            return null;
        }

        var deadLetter = await _managementClient!.GetQueueAsync($"{queue.Name}.dlq", cancellationToken);
        queue.DeadLetterMessageCount = deadLetter?.ActiveMessageCount ?? 0;
        return queue;
    }

    #endregion
}
