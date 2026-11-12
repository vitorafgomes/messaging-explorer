using System.Globalization;
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

    /// <summary>A provider whose messaging client is given, for tests of the message operations.</summary>
    internal AzureServiceBusProvider(ServiceBusClient client) : this()
    {
        _client = client;
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
        return await GetQueueCoreAsync(_adminClient!, queueName);
    }

    /// <summary>
    /// Reads a queue's configuration and runtime properties in parallel and maps both; null when either call says the queue does not exist.
    /// </summary>
    internal static async Task<QueueInfo?> GetQueueCoreAsync(ServiceBusAdministrationClient adminClient, string queueName)
    {
        var propsTask = adminClient.GetQueueAsync(queueName);
        var runtimePropsTask = adminClient.GetQueueRuntimePropertiesAsync(queueName);

        try
        {
            await Task.WhenAll(propsTask, runtimePropsTask);
        }
        catch (Exception) when (IsEntityNotFound(propsTask) || IsEntityNotFound(runtimePropsTask))
        {
            return null;
        }

        return MapToQueueInfo(propsTask.Result.Value, runtimePropsTask.Result.Value);
    }

    private static bool IsEntityNotFound(Task task) =>
        task.Exception?.InnerException is ServiceBusException { Reason: ServiceBusFailureReason.MessagingEntityNotFound };

    /// <inheritdoc />
    public Task CreateQueueAsync(string queueName)
    {
        return CreateQueueAsync(queueName, null);
    }

    /// <inheritdoc />
    public async Task CreateQueueAsync(string queueName, QueueCreateOptions? options)
    {
        EnsureConnected();
        await CreateQueueCoreAsync(_adminClient!, queueName, options);
    }

    /// <summary>
    /// Creates a queue with the broker's defaults when <paramref name="options"/> is null, otherwise with every
    /// option that is set; failures the caller can act on arrive as the provider-neutral exceptions. The name and
    /// options are checked against the Azure Service Bus rules first; a violation reaches no broker call.
    /// </summary>
    internal static async Task CreateQueueCoreAsync(ServiceBusAdministrationClient adminClient, string queueName, QueueCreateOptions? options)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateQueueCreate(queueName, options));

        try
        {
            if (options == null)
            {
                await adminClient.CreateQueueAsync(queueName);
                return;
            }

            var queue = new CreateQueueOptions(queueName)
            {
                RequiresSession = options.RequiresSession,
                EnablePartitioning = options.EnablePartitioning,
                DeadLetteringOnMessageExpiration = options.DeadLetteringOnMessageExpiration,
                RequiresDuplicateDetection = options.RequiresDuplicateDetection
            };
            if (options.DefaultMessageTimeToLive is { } ttl) queue.DefaultMessageTimeToLive = ttl;
            if (options.LockDuration is { } lockDuration) queue.LockDuration = lockDuration;
            if (options.MaxDeliveryCount is { } maxDeliveryCount) queue.MaxDeliveryCount = maxDeliveryCount;
            if (options.DuplicateDetectionHistoryTimeWindow is { } window) queue.DuplicateDetectionHistoryTimeWindow = window;
            if (options.MaxSizeInMegabytes is { } maxSize) queue.MaxSizeInMegabytes = maxSize;
            if (options.AutoDeleteOnIdle is { } autoDelete) queue.AutoDeleteOnIdle = autoDelete;
            if (options.EnableBatchedOperations is { } batched) queue.EnableBatchedOperations = batched;
            if (!string.IsNullOrEmpty(options.ForwardTo)) queue.ForwardTo = options.ForwardTo;
            if (!string.IsNullOrEmpty(options.ForwardDeadLetteredMessagesTo)) queue.ForwardDeadLetteredMessagesTo = options.ForwardDeadLetteredMessagesTo;
            if (options.UserMetadata != null) queue.UserMetadata = options.UserMetadata;

            await adminClient.CreateQueueAsync(queue);
        }
        catch (Exception ex) when (ToProviderNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
    }

    /// <inheritdoc />
    public async Task UpdateQueueAsync(string queueName, QueueUpdateOptions options, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        await UpdateQueueCoreAsync(_adminClient!, queueName, options, cancellationToken);
    }

    /// <summary>
    /// Checks the options against the Azure Service Bus rules, then reads the queue's properties once, changes
    /// only the options that are set and writes them back once.
    /// The write is last-write-wins: the SDK sends it with <c>If-Match: *</c>.
    /// </summary>
    internal static async Task UpdateQueueCoreAsync(ServiceBusAdministrationClient adminClient, string queueName, QueueUpdateOptions options, CancellationToken cancellationToken)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateQueueUpdate(queueName, options));

        try
        {
            QueueProperties queue = (await adminClient.GetQueueAsync(queueName, cancellationToken)).Value;
            if (options.DefaultMessageTimeToLive is { } ttl) queue.DefaultMessageTimeToLive = ttl;
            if (options.LockDuration is { } lockDuration) queue.LockDuration = lockDuration;
            if (options.MaxDeliveryCount is { } maxDeliveryCount) queue.MaxDeliveryCount = maxDeliveryCount;
            if (options.DeadLetteringOnMessageExpiration is { } deadLettering) queue.DeadLetteringOnMessageExpiration = deadLettering;
            if (options.DuplicateDetectionHistoryTimeWindow is { } window) queue.DuplicateDetectionHistoryTimeWindow = window;
            if (options.MaxSizeInMegabytes is { } maxSize) queue.MaxSizeInMegabytes = maxSize;
            if (options.AutoDeleteOnIdle is { } autoDelete) queue.AutoDeleteOnIdle = autoDelete;
            if (options.EnableBatchedOperations is { } batched) queue.EnableBatchedOperations = batched;
            if (options.ForwardTo != null) queue.ForwardTo = NullIfEmpty(options.ForwardTo);
            if (options.ForwardDeadLetteredMessagesTo != null) queue.ForwardDeadLetteredMessagesTo = NullIfEmpty(options.ForwardDeadLetteredMessagesTo);
            if (options.UserMetadata != null) queue.UserMetadata = options.UserMetadata;
            if (options.Status != null) queue.Status = ToEntityStatus(options.Status);

            await adminClient.UpdateQueueAsync(queue, cancellationToken);
        }
        catch (Exception ex) when (ToProviderNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
    }

    /// <summary>
    /// The SDK failures a caller can act on, as provider-neutral exceptions that carry the SDK exception only as
    /// the inner exception; null for every other failure, which reaches the caller unchanged.
    /// </summary>
    private static Exception? ToProviderNeutral(Exception ex) => ex switch
    {
        ServiceBusException { Reason: ServiceBusFailureReason.MessagingEntityAlreadyExists } => new EntityAlreadyExistsException(ex),
        ServiceBusException { Reason: ServiceBusFailureReason.MessagingEntityNotFound } => new EntityNotFoundException(ex),
        ServiceBusException { Reason: ServiceBusFailureReason.QuotaExceeded } => new InvalidEntityConfigurationException(ex),
        ArgumentException or InvalidOperationException => new InvalidEntityConfigurationException(ex),
        _ => null
    };

    private static EntityStatus ToEntityStatus(string status) => status switch
    {
        "Active" => EntityStatus.Active,
        "Disabled" => EntityStatus.Disabled,
        "SendDisabled" => EntityStatus.SendDisabled,
        "ReceiveDisabled" => EntityStatus.ReceiveDisabled,
        _ => throw new ArgumentException("Unknown entity status.", nameof(status))
    };

    private static void ThrowIfInvalid(IReadOnlyList<string> violations)
    {
        if (violations.Count > 0)
            throw new InvalidEntityConfigurationException(violations);
    }

    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;

    /// <summary>
    /// The entity path of a forward target as the broker returns it: the path of an absolute address without its
    /// leading slash, URL-decoded; any other value as is; null or empty as null. The SDK writes a bare name as an
    /// absolute address, so a read gives back the address, not the name that was set.
    /// </summary>
    internal static string? ToEntityPath(string? forwardTarget)
    {
        if (string.IsNullOrEmpty(forwardTarget)) return null;
        if (forwardTarget.Contains("://") && Uri.TryCreate(forwardTarget, UriKind.Absolute, out var address))
            return Uri.UnescapeDataString(address.AbsolutePath.StartsWith('/') ? address.AbsolutePath[1..] : address.AbsolutePath);
        return forwardTarget;
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

    private static QueueInfo MapToQueueInfo(QueueProperties props, QueueRuntimeProperties runtimeProps)
    {
        return new QueueInfo
        {
            Name = runtimeProps.Name,
            ActiveMessageCount = runtimeProps.ActiveMessageCount,
            DeadLetterMessageCount = runtimeProps.DeadLetterMessageCount,
            ScheduledMessageCount = runtimeProps.ScheduledMessageCount,
            TransferMessageCount = runtimeProps.TransferMessageCount,
            TransferDeadLetterMessageCount = runtimeProps.TransferDeadLetterMessageCount,
            SizeInBytes = runtimeProps.SizeInBytes,
            CreatedAt = runtimeProps.CreatedAt,
            UpdatedAt = runtimeProps.UpdatedAt,
            AccessedAt = runtimeProps.AccessedAt,
            Status = props.Status.ToString(),
            EnablePartitioning = props.EnablePartitioning,
            DefaultMessageTimeToLive = props.DefaultMessageTimeToLive,
            LockDuration = props.LockDuration,
            MaxDeliveryCount = props.MaxDeliveryCount,
            MaxSizeInMegabytes = props.MaxSizeInMegabytes,
            RequiresSession = props.RequiresSession,
            DeadLetteringOnMessageExpiration = props.DeadLetteringOnMessageExpiration,
            ForwardTo = ToEntityPath(props.ForwardTo),
            ForwardDeadLetteredMessagesTo = ToEntityPath(props.ForwardDeadLetteredMessagesTo),
            AutoDeleteOnIdle = props.AutoDeleteOnIdle,
            EnableBatchedOperations = props.EnableBatchedOperations,
            UserMetadata = props.UserMetadata,
            RequiresDuplicateDetection = props.RequiresDuplicateDetection,
            DuplicateDetectionHistoryTimeWindow = props.DuplicateDetectionHistoryTimeWindow,
            MaxMessageSizeInKilobytes = props.MaxMessageSizeInKilobytes
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
        await CreateTopicCoreAsync(_adminClient!, topicName, options);
    }

    /// <summary>
    /// Creates a topic with the broker's defaults when <paramref name="options"/> is null, otherwise with every
    /// option that is set; failures the caller can act on arrive as the provider-neutral exceptions.
    /// </summary>
    internal static async Task CreateTopicCoreAsync(ServiceBusAdministrationClient adminClient, string topicName, TopicCreateOptions? options)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateTopicCreate(topicName, options));

        try
        {
            if (options == null)
            {
                await adminClient.CreateTopicAsync(topicName);
                return;
            }

            var topic = new CreateTopicOptions(topicName)
            {
                EnablePartitioning = options.EnablePartitioning,
                RequiresDuplicateDetection = options.RequiresDuplicateDetection
            };
            if (options.DefaultMessageTimeToLive is { } ttl) topic.DefaultMessageTimeToLive = ttl;
            if (options.DuplicateDetectionHistoryTimeWindow is { } window) topic.DuplicateDetectionHistoryTimeWindow = window;
            if (options.MaxSizeInMegabytes is { } maxSize) topic.MaxSizeInMegabytes = maxSize;
            if (options.AutoDeleteOnIdle is { } autoDelete) topic.AutoDeleteOnIdle = autoDelete;
            if (options.EnableBatchedOperations is { } batched) topic.EnableBatchedOperations = batched;
            if (options.SupportOrdering is { } ordering) topic.SupportOrdering = ordering;
            if (options.UserMetadata != null) topic.UserMetadata = options.UserMetadata;

            await adminClient.CreateTopicAsync(topic);
        }
        catch (Exception ex) when (ToProviderNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
    }

    /// <inheritdoc />
    public async Task UpdateTopicAsync(string topicName, TopicUpdateOptions options, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        await UpdateTopicCoreAsync(_adminClient!, topicName, options, cancellationToken);
    }

    /// <summary>
    /// Reads the topic's properties once, changes only the options that are set and writes them back once.
    /// The write is last-write-wins: the SDK sends it with <c>If-Match: *</c>.
    /// </summary>
    internal static async Task UpdateTopicCoreAsync(ServiceBusAdministrationClient adminClient, string topicName, TopicUpdateOptions options, CancellationToken cancellationToken)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateTopicUpdate(options));

        try
        {
            TopicProperties topic = (await adminClient.GetTopicAsync(topicName, cancellationToken)).Value;
            if (options.DefaultMessageTimeToLive is { } ttl) topic.DefaultMessageTimeToLive = ttl;
            if (options.DuplicateDetectionHistoryTimeWindow is { } window) topic.DuplicateDetectionHistoryTimeWindow = window;
            if (options.MaxSizeInMegabytes is { } maxSize) topic.MaxSizeInMegabytes = maxSize;
            if (options.AutoDeleteOnIdle is { } autoDelete) topic.AutoDeleteOnIdle = autoDelete;
            if (options.EnableBatchedOperations is { } batched) topic.EnableBatchedOperations = batched;
            if (options.SupportOrdering is { } ordering) topic.SupportOrdering = ordering;
            if (options.UserMetadata != null) topic.UserMetadata = options.UserMetadata;
            if (options.Status != null) topic.Status = ToEntityStatus(options.Status);

            await adminClient.UpdateTopicAsync(topic, cancellationToken);
        }
        catch (Exception ex) when (ToProviderNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
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
        await CreateSubscriptionCoreAsync(_adminClient!, topicName, subscriptionName, options);
    }

    /// <inheritdoc />
    public async Task DeleteSubscriptionAsync(string topicName, string subscriptionName)
    {
        EnsureConnected();
        await _adminClient!.DeleteSubscriptionAsync(topicName, subscriptionName);
    }

    /// <summary>
    /// Creates a subscription with the broker's defaults when <paramref name="options"/> is null, otherwise with
    /// every option that is set; failures the caller can act on arrive as the provider-neutral exceptions. A
    /// missing topic arrives as <see cref="EntityNotFoundException"/>. With a filter expression the subscription and
    /// its one SQL rule, named <c>CustomFilter</c>, are created in a single call instead of the default rule, so an
    /// expression the broker refuses creates nothing.
    /// </summary>
    internal static async Task CreateSubscriptionCoreAsync(ServiceBusAdministrationClient adminClient, string topicName, string subscriptionName, SubscriptionCreateOptions? options)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateSubscriptionCreate(topicName, subscriptionName, options));

        try
        {
            if (options == null)
            {
                await adminClient.CreateSubscriptionAsync(topicName, subscriptionName);
                return;
            }

            var subscription = new CreateSubscriptionOptions(topicName, subscriptionName)
            {
                RequiresSession = options.RequiresSession,
                DeadLetteringOnMessageExpiration = options.DeadLetteringOnMessageExpiration
            };
            if (options.DefaultMessageTimeToLive is { } ttl) subscription.DefaultMessageTimeToLive = ttl;
            if (options.LockDuration is { } lockDuration) subscription.LockDuration = lockDuration;
            if (options.MaxDeliveryCount is { } maxDeliveryCount) subscription.MaxDeliveryCount = maxDeliveryCount;
            if (options.DeadLetteringOnFilterEvaluationExceptions is { } filterDeadLettering) subscription.EnableDeadLetteringOnFilterEvaluationExceptions = filterDeadLettering;
            if (options.AutoDeleteOnIdle is { } autoDelete) subscription.AutoDeleteOnIdle = autoDelete;
            if (options.EnableBatchedOperations is { } batched) subscription.EnableBatchedOperations = batched;
            if (!string.IsNullOrEmpty(options.ForwardTo)) subscription.ForwardTo = options.ForwardTo;
            if (!string.IsNullOrEmpty(options.ForwardDeadLetteredMessagesTo)) subscription.ForwardDeadLetteredMessagesTo = options.ForwardDeadLetteredMessagesTo;
            if (options.UserMetadata != null) subscription.UserMetadata = options.UserMetadata;

            if (string.IsNullOrWhiteSpace(options.FilterExpression))
                await adminClient.CreateSubscriptionAsync(subscription);
            else
                await adminClient.CreateSubscriptionAsync(subscription, new CreateRuleOptions(FilteredSubscriptionRuleName, new SqlRuleFilter(options.FilterExpression)));
        }
        catch (Exception ex) when (ToProviderNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
    }

    /// <inheritdoc />
    public async Task UpdateSubscriptionAsync(string topicName, string subscriptionName, SubscriptionUpdateOptions options, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        await UpdateSubscriptionCoreAsync(_adminClient!, topicName, subscriptionName, options, cancellationToken);
    }

    /// <summary>
    /// Reads the subscription's properties once, changes only the options that are set and writes them back once.
    /// The write is last-write-wins: the SDK sends it with <c>If-Match: *</c>.
    /// </summary>
    internal static async Task UpdateSubscriptionCoreAsync(ServiceBusAdministrationClient adminClient, string topicName, string subscriptionName, SubscriptionUpdateOptions options, CancellationToken cancellationToken)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateSubscriptionUpdate(topicName, options));

        try
        {
            SubscriptionProperties subscription = (await adminClient.GetSubscriptionAsync(topicName, subscriptionName, cancellationToken)).Value;
            if (options.DefaultMessageTimeToLive is { } ttl) subscription.DefaultMessageTimeToLive = ttl;
            if (options.LockDuration is { } lockDuration) subscription.LockDuration = lockDuration;
            if (options.MaxDeliveryCount is { } maxDeliveryCount) subscription.MaxDeliveryCount = maxDeliveryCount;
            if (options.DeadLetteringOnMessageExpiration is { } deadLettering) subscription.DeadLetteringOnMessageExpiration = deadLettering;
            if (options.DeadLetteringOnFilterEvaluationExceptions is { } filterDeadLettering) subscription.EnableDeadLetteringOnFilterEvaluationExceptions = filterDeadLettering;
            if (options.AutoDeleteOnIdle is { } autoDelete) subscription.AutoDeleteOnIdle = autoDelete;
            if (options.EnableBatchedOperations is { } batched) subscription.EnableBatchedOperations = batched;
            if (options.ForwardTo != null) subscription.ForwardTo = NullIfEmpty(options.ForwardTo);
            if (options.ForwardDeadLetteredMessagesTo != null) subscription.ForwardDeadLetteredMessagesTo = NullIfEmpty(options.ForwardDeadLetteredMessagesTo);
            if (options.UserMetadata != null) subscription.UserMetadata = options.UserMetadata;
            if (options.Status != null) subscription.Status = ToEntityStatus(options.Status);

            await adminClient.UpdateSubscriptionAsync(subscription, cancellationToken);
        }
        catch (Exception ex) when (ToProviderNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
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
    internal static SubscriptionInfo MapToSubscriptionInfo(SubscriptionProperties props, SubscriptionRuntimeProperties runtimeProps)
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
            ForwardTo = ToEntityPath(props.ForwardTo),
            ForwardDeadLetteredMessagesTo = ToEntityPath(props.ForwardDeadLetteredMessagesTo)
        };
    }

    /// <summary>
    /// A rule as the API shows it. True and false filters derive from the SQL filter, so they are matched first and
    /// carry no expression; a correlation filter keeps every field, and each property value its invariant-culture text.
    /// </summary>
    internal static SubscriptionRuleInfo MapToSubscriptionRuleInfo(RuleProperties rule)
    {
        var mapped = new SubscriptionRuleInfo { Name = rule.Name, SqlAction = (rule.Action as SqlRuleAction)?.SqlExpression };
        switch (rule.Filter)
        {
            case TrueRuleFilter:
                mapped.FilterType = RuleFilterType.True;
                break;
            case FalseRuleFilter:
                mapped.FilterType = RuleFilterType.False;
                break;
            case SqlRuleFilter sql:
                mapped.FilterType = RuleFilterType.Sql;
                mapped.SqlExpression = sql.SqlExpression;
                break;
            case CorrelationRuleFilter correlation:
                mapped.FilterType = RuleFilterType.Correlation;
                mapped.Correlation = new CorrelationFilterInfo
                {
                    CorrelationId = correlation.CorrelationId,
                    MessageId = correlation.MessageId,
                    To = correlation.To,
                    ReplyTo = correlation.ReplyTo,
                    Subject = correlation.Subject,
                    SessionId = correlation.SessionId,
                    ReplyToSessionId = correlation.ReplyToSessionId,
                    ContentType = correlation.ContentType,
                    ApplicationProperties = correlation.ApplicationProperties.Select(p => MapToRuleApplicationProperty(p.Key, p.Value)).ToList()
                };
                break;
        }

        return mapped;
    }

    private static RuleApplicationProperty MapToRuleApplicationProperty(string name, object? value) => value switch
    {
        string text => new() { Name = name, Type = RulePropertyType.String, Value = text },
        long whole => new() { Name = name, Type = RulePropertyType.Int64, Value = whole.ToString(CultureInfo.InvariantCulture) },
        double number => new() { Name = name, Type = RulePropertyType.Double, Value = number.ToString(CultureInfo.InvariantCulture) },
        bool flag => new() { Name = name, Type = RulePropertyType.Boolean, Value = flag ? "true" : "false" },
        _ => new() { Name = name, Type = RulePropertyType.Other, Value = Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty }
    };

    #endregion

    #region Subscription Rules

    private const string FilteredSubscriptionRuleName = "CustomFilter";

    /// <inheritdoc />
    public async Task<IReadOnlyList<SubscriptionRuleInfo>> GetRulesAsync(string topicName, string subscriptionName, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        return await GetRulesCoreAsync(_adminClient!, topicName, subscriptionName, cancellationToken);
    }

    /// <summary>
    /// Lists the rules of a subscription in one paged enumeration. A missing topic can list as empty, so only an
    /// empty list asks whether the subscription exists; a missing one throws <see cref="EntityNotFoundException"/>.
    /// </summary>
    internal static async Task<IReadOnlyList<SubscriptionRuleInfo>> GetRulesCoreAsync(ServiceBusAdministrationClient adminClient, string topicName, string subscriptionName, CancellationToken cancellationToken)
    {
        try
        {
            var rules = new List<SubscriptionRuleInfo>();
            await foreach (var rule in adminClient.GetRulesAsync(topicName, subscriptionName, cancellationToken))
                rules.Add(MapToSubscriptionRuleInfo(rule));

            if (rules.Count == 0 && !(await adminClient.SubscriptionExistsAsync(topicName, subscriptionName, cancellationToken)).Value)
                throw new EntityNotFoundException();
            return rules;
        }
        catch (ServiceBusException ex) when (ex.Reason == ServiceBusFailureReason.MessagingEntityNotFound)
        {
            throw new EntityNotFoundException(ex);
        }
    }

    /// <inheritdoc />
    public async Task<SubscriptionRuleInfo> CreateRuleAsync(string topicName, string subscriptionName, SubscriptionRuleInfo rule, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        return await CreateRuleCoreAsync(_adminClient!, topicName, subscriptionName, rule, cancellationToken);
    }

    /// <summary>
    /// Checks the rule against the Azure Service Bus rules, then adds it in one call and maps what the broker stored.
    /// The expression and the action reach the broker only as values of the rule object.
    /// </summary>
    internal static async Task<SubscriptionRuleInfo> CreateRuleCoreAsync(ServiceBusAdministrationClient adminClient, string topicName, string subscriptionName, SubscriptionRuleInfo rule, CancellationToken cancellationToken)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateRule(rule.Name, rule));

        try
        {
            var options = new CreateRuleOptions(rule.Name, ToRuleFilter(rule)) { Action = ToRuleAction(rule) };
            return MapToSubscriptionRuleInfo((await adminClient.CreateRuleAsync(topicName, subscriptionName, options, cancellationToken)).Value);
        }
        catch (Exception ex) when (ToRuleNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
    }

    /// <inheritdoc />
    public async Task<SubscriptionRuleInfo> UpdateRuleAsync(string topicName, string subscriptionName, string ruleName, SubscriptionRuleInfo rule, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        return await UpdateRuleCoreAsync(_adminClient!, topicName, subscriptionName, ruleName, rule, cancellationToken);
    }

    /// <summary>
    /// Checks the rule, then reads the stored rule once, replaces its filter and action and writes it back once under
    /// the same name. The write is last-write-wins: the SDK sends it with <c>If-Match: *</c>.
    /// </summary>
    internal static async Task<SubscriptionRuleInfo> UpdateRuleCoreAsync(ServiceBusAdministrationClient adminClient, string topicName, string subscriptionName, string ruleName, SubscriptionRuleInfo rule, CancellationToken cancellationToken)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateRule(ruleName, rule));

        try
        {
            RuleProperties stored = (await adminClient.GetRuleAsync(topicName, subscriptionName, ruleName, cancellationToken)).Value;
            stored.Filter = ToRuleFilter(rule);
            stored.Action = ToRuleAction(rule);
            return MapToSubscriptionRuleInfo((await adminClient.UpdateRuleAsync(topicName, subscriptionName, stored, cancellationToken)).Value);
        }
        catch (Exception ex) when (ToRuleNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
    }

    /// <inheritdoc />
    public async Task DeleteRuleAsync(string topicName, string subscriptionName, string ruleName, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        await DeleteRuleCoreAsync(_adminClient!, topicName, subscriptionName, ruleName, cancellationToken);
    }

    /// <summary>Deletes one rule, the last one included; a missing rule or subscription throws <see cref="EntityNotFoundException"/>.</summary>
    internal static async Task DeleteRuleCoreAsync(ServiceBusAdministrationClient adminClient, string topicName, string subscriptionName, string ruleName, CancellationToken cancellationToken)
    {
        ThrowIfInvalid(EntityConfigurationValidator.ValidateRuleName(ruleName));

        try
        {
            await adminClient.DeleteRuleAsync(topicName, subscriptionName, ruleName, cancellationToken);
        }
        catch (Exception ex) when (ToRuleNeutral(ex) is { } neutral)
        {
            throw neutral;
        }
    }

    /// <summary>
    /// As <see cref="ToProviderNeutral"/>, except that a refusal carries the fixed rule text: the broker answers a
    /// filter or an action that does not parse with HTTP 400, which the SDK raises as <see cref="ArgumentException"/>.
    /// </summary>
    private static Exception? ToRuleNeutral(Exception ex) => ToProviderNeutral(ex) switch
    {
        InvalidEntityConfigurationException => InvalidEntityConfigurationException.RuleRefused(ex),
        var neutral => neutral
    };

    private static RuleFilter ToRuleFilter(SubscriptionRuleInfo rule) => rule.FilterType switch
    {
        RuleFilterType.Sql => new SqlRuleFilter(rule.SqlExpression),
        RuleFilterType.True => new TrueRuleFilter(),
        RuleFilterType.False => new FalseRuleFilter(),
        _ => ToCorrelationRuleFilter(rule.Correlation!)
    };

    private static CorrelationRuleFilter ToCorrelationRuleFilter(CorrelationFilterInfo correlation)
    {
        var filter = new CorrelationRuleFilter
        {
            CorrelationId = correlation.CorrelationId,
            MessageId = correlation.MessageId,
            To = correlation.To,
            ReplyTo = correlation.ReplyTo,
            Subject = correlation.Subject,
            SessionId = correlation.SessionId,
            ReplyToSessionId = correlation.ReplyToSessionId,
            ContentType = correlation.ContentType
        };
        foreach (var property in correlation.ApplicationProperties ?? [])
            filter.ApplicationProperties[property.Name!] = EntityConfigurationValidator.ParsePropertyValue(property.Type, property.Value)!;
        return filter;
    }

    private static SqlRuleAction? ToRuleAction(SubscriptionRuleInfo rule) =>
        string.IsNullOrWhiteSpace(rule.SqlAction) ? null : new SqlRuleAction(rule.SqlAction);

    #endregion

    #region Message Operations

    /// <summary>
    /// The receiver on a queue or subscription, or on one of its dead-letter queues: the one place a
    /// <see cref="MessageSubQueue"/> becomes the SDK's <see cref="SubQueue"/>, for every message operation.
    /// </summary>
    internal static ServiceBusReceiver CreateReceiver(
        ServiceBusClient client,
        string entityName,
        string? subscriptionName,
        MessageSubQueue subQueue,
        ServiceBusReceiverOptions? options = null)
    {
        options ??= new ServiceBusReceiverOptions();
        options.SubQueue = subQueue switch
        {
            MessageSubQueue.Active => SubQueue.None,
            MessageSubQueue.DeadLetter => SubQueue.DeadLetter,
            MessageSubQueue.TransferDeadLetter => SubQueue.TransferDeadLetter,
            _ => throw new ArgumentOutOfRangeException(nameof(subQueue))
        };
        return client.CreateReceiver(EntityPathOf(entityName, subscriptionName), options);
    }

    private static string EntityPathOf(string entityName, string? subscriptionName) =>
        subscriptionName != null ? $"{entityName}/subscriptions/{subscriptionName}" : entityName;

    private const string EntityDisabledError = "The entity is disabled for this operation.";
    private const string NotScheduledError = "This message is not scheduled any more.";
    private const string CancelFailedError = "The broker did not cancel this message.";
    private const int PeekBatchSize = 250;

    private static bool IsEntityDisabled(ServiceBusException ex) => ex.Reason == ServiceBusFailureReason.MessagingEntityDisabled;

    /// <summary>
    /// Runs a single-message operation and answers the broker's refusal of a disabled entity as
    /// <see cref="EntityDisabledException"/>; every other failure reaches the caller as it was.
    /// </summary>
    private static async Task<T> RefuseDisabledAsync<T>(Func<Task<T>> operation)
    {
        try
        {
            return await operation();
        }
        catch (ServiceBusException ex) when (IsEntityDisabled(ex))
        {
            throw new EntityDisabledException(ex);
        }
    }

    private static Task RefuseDisabledAsync(Func<Task> operation) =>
        RefuseDisabledAsync(async () =>
        {
            await operation();
            return true;
        });

    /// <inheritdoc />
    public async Task<MessageSearchResult> SearchMessagesAsync(
        string entityName,
        MessageSearchRequest request,
        MessageSubQueue subQueue = MessageSubQueue.Active,
        string? subscriptionName = null,
        CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        await using var receiver = CreateReceiver(_client!, entityName, subscriptionName, subQueue,
            new ServiceBusReceiverOptions { ReceiveMode = ServiceBusReceiveMode.PeekLock });

        return await RefuseDisabledAsync(() => SearchCoreAsync(receiver, request, subQueue != MessageSubQueue.Active, cancellationToken));
    }

    internal static async Task<MessageSearchResult> SearchCoreAsync(ServiceBusReceiver receiver, MessageSearchRequest request, bool isDeadLetter, CancellationToken cancellationToken)
    {
        var matches = new List<IMessage>();
        int totalPeeked = 0;
        long fromSequenceNumber = 0;
        int skipped = 0;
        const int batchSize = 100;

        while (matches.Count < request.Count)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var batch = await receiver.PeekMessagesAsync(batchSize, fromSequenceNumber, cancellationToken);
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
    public async Task<IEnumerable<IMessage>> PeekMessagesAsync(string entityName, int count = 10, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        await using var receiver = CreateReceiver(_client!, entityName, subscriptionName, subQueue);
        var messages = await RefuseDisabledAsync(() => PeekCoreAsync(receiver, count, cancellationToken));

        return messages.Select(m => MapToMessageInfo(m, subQueue != MessageSubQueue.Active));
    }

    /// <summary>
    /// Peeks up to <paramref name="count"/> messages in batches of at most 250, the SDK's limit per call. A batch
    /// shorter than asked is not the end: the broker returns one where a scheduled message or a dropped duplicate
    /// sits between messages. The peek goes on from the last sequence number until a batch is empty or
    /// <paramref name="count"/> is reached; every batch that is not empty brings it closer to <paramref name="count"/>,
    /// so it makes at most <paramref name="count"/> plus one calls. The caller's token is checked before each call
    /// and handed to the SDK, so an aborted request stops the peek.
    /// </summary>
    internal static async Task<List<ServiceBusReceivedMessage>> PeekCoreAsync(ServiceBusReceiver receiver, int count, CancellationToken cancellationToken)
    {
        var allMessages = new List<ServiceBusReceivedMessage>();
        long? fromSequenceNumber = null;

        while (allMessages.Count < count)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var messages = await receiver.PeekMessagesAsync(Math.Min(count - allMessages.Count, PeekBatchSize), fromSequenceNumber, cancellationToken);
            if (messages.Count == 0)
            {
                break;
            }

            allMessages.AddRange(messages);
            fromSequenceNumber = messages[^1].SequenceNumber + 1;
        }

        return allMessages;
    }

    /// <inheritdoc />
    public async Task SendMessageAsync(string entityName, SendMessageRequest request)
    {
        EnsureConnected();
        await using var sender = _client!.CreateSender(entityName);

        var message = CreateServiceBusMessage(request);
        await RefuseDisabledAsync(() => sender.SendMessageAsync(message));
    }

    /// <inheritdoc />
    public async Task SendMessagesAsync(string entityName, IEnumerable<SendMessageRequest> requests)
    {
        EnsureConnected();
        await using var sender = _client!.CreateSender(entityName);

        var messages = requests.Select(CreateServiceBusMessage).ToList();
        await RefuseDisabledAsync(() => sender.SendMessagesAsync(messages));
    }

    /// <inheritdoc />
    public async Task<IEnumerable<IMessage>> ReceiveMessagesAsync(string entityName, int count = 10, string? subscriptionName = null)
    {
        EnsureConnected();

        await using var receiver = CreateReceiver(_client!, entityName, subscriptionName, MessageSubQueue.Active);

        return await RefuseDisabledAsync(async () =>
        {
            var messages = await receiver.ReceiveMessagesAsync(count, TimeSpan.FromSeconds(5));

            var result = new List<MessageInfo>();
            foreach (var message in messages)
            {
                result.Add(MapToMessageInfo(message, false));
                await receiver.CompleteMessageAsync(message);
            }

            return (IEnumerable<IMessage>)result;
        });
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

        // For subscriptions, always send to the TOPIC (not to the subscription directly)
        // This means the message will pass through all subscription filters.
        var targetPath = entityName; // Always send to queue or topic

        await using var sender = _client!.CreateSender(targetPath);

        // Phase 1: Peek directly at the target sequence number (O(1) - jumps straight to it)
        await using var peekReceiver = CreateReceiver(_client!, entityName, subscriptionName, MessageSubQueue.DeadLetter);
        var peekedMessages = await peekReceiver.PeekMessagesAsync(1, fromSequenceNumber: sequenceNumber);

        if (peekedMessages.Count == 0 || peekedMessages[0].SequenceNumber != sequenceNumber)
        {
            throw new InvalidOperationException($"Message with sequence number {sequenceNumber} not found in dead letter queue.");
        }

        // Phase 2: Create and send the new message immediately from peeked content
        var newMessage = new ServiceBusMessage(peekedMessages[0]);
        await RefuseDisabledAsync(() => sender.SendMessageAsync(newMessage));

        // Phase 3: Try to complete (remove) the original from DLQ with a hard limit
        // Use ReceiveAndDelete mode so we don't need to abandon messages
        // We receive small batches and check each one
        await using var receiver = CreateReceiver(_client!, entityName, subscriptionName, MessageSubQueue.DeadLetter, new ServiceBusReceiverOptions
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
    public async Task PurgeMessagesAsync(string entityName, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        await RefuseDisabledAsync(() => PurgeEntityAsync(entityName, subQueue, subscriptionName, cancellationToken));
    }

    /// <summary>
    /// Session-aware drain of an entire entity (active or dead-letter). Shared by
    /// <see cref="PurgeMessagesAsync"/> and the drain-all path of <see cref="DeleteMessagesAsync"/>.
    /// Returns the number of messages removed (0 when the count is unknown).
    /// </summary>
    private async Task<long> PurgeEntityAsync(string entityName, MessageSubQueue subQueue, string? subscriptionName, CancellationToken cancellationToken)
    {
        // Check if the entity requires sessions
        var requiresSession = false;
        if (subscriptionName != null)
        {
            var props = await _adminClient!.GetSubscriptionAsync(entityName, subscriptionName, cancellationToken);
            requiresSession = props.Value.RequiresSession;
        }
        else
        {
            var props = await _adminClient!.GetQueueAsync(entityName, cancellationToken);
            requiresSession = props.Value.RequiresSession;
        }

        // Dead-letter sub-queues do not support session receivers even if the parent entity requires sessions.
        // Always use the non-session receiver for dead-letter queues.
        if (requiresSession && subQueue == MessageSubQueue.Active)
        {
            // Server-side purge is a management operation and does not need a session lock.
            await using var receiver = CreateReceiver(_client!, entityName, subscriptionName, MessageSubQueue.Active);
            return await TryPurgeServerSideAsync(receiver, cancellationToken)
                ?? await PurgeSessionEntityAsync(EntityPathOf(entityName, subscriptionName), cancellationToken);
        }

        return await PurgeNonSessionEntityAsync(entityName, subQueue, subscriptionName, cancellationToken);
    }

    private async Task<long> PurgeNonSessionEntityAsync(string entityName, MessageSubQueue subQueue, string? subscriptionName, CancellationToken cancellationToken)
    {
        await using var receiver = CreateReceiver(_client!, entityName, subscriptionName, subQueue, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.ReceiveAndDelete,
            PrefetchCount = DrainPrefetchCount
        });

        return await DrainAllAsync(receiver, cancellationToken);
    }

    private async Task<long> PurgeSessionEntityAsync(string entityPath, CancellationToken cancellationToken)
    {
        long drained = 0;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(10));

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
                    drained += messages.Count;
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

        return drained;
    }

    // Shared batch-scan tuning. A large prefetch lets the receiver stream messages
    // continuously instead of returning a handful per call, which is what made the
    // previous attempt-capped loop miss most targets at scale.
    private const int ScanPrefetchCount = 250;
    private const int ScanReceiveBatchSize = 250;
    private const int CompleteChunkSize = 20;
    private const int DrainPrefetchCount = 250;
    private const int DrainReceiveBatchSize = 250;
    private const int NotFoundInScanWindow = 2;
    private static readonly TimeSpan ScanReceiveWait = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ScanSafetyTimeout = TimeSpan.FromMinutes(2);
    private const string NotFoundError = "Not found within scan window";
    private const string MoveDuplicateError = "Message was moved to the target but could not be removed from the source and may be duplicated: {0}";

    /// <inheritdoc />
    public async Task<BatchOperationResult> DeleteMessagesAsync(string entityName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, bool all = false, CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        var result = new BatchOperationResult();

        if (!all && (sequenceNumbers == null || sequenceNumbers.Length == 0))
        {
            return result;
        }

        // Fast path: delete everything. Session-aware, so a session-enabled active
        // queue does not blow up on a non-session receiver (the DLQ sub-queue never
        // requires sessions, which is why only the active side used to fail).
        if (all)
        {
            result.SuccessCount = checked((int)await RefuseDisabledAsync(() => PurgeEntityAsync(entityName, subQueue, subscriptionName, cancellationToken)));
            return result;
        }

        await using var receiver = CreateReceiver(_client!, entityName, subscriptionName, subQueue, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.PeekLock,
            PrefetchCount = ScanPrefetchCount
        });

        return await DeleteMessagesCoreAsync(receiver, sequenceNumbers!, cancellationToken);
    }

    /// <summary>
    /// Server-side batch delete (up to 4000 messages per request, no payload transfer).
    /// Returns null when the broker does not support it (for example the emulator),
    /// so the caller can fall back to a client-side drain.
    /// </summary>
    internal static async Task<long?> TryPurgeServerSideAsync(ServiceBusReceiver receiver, CancellationToken cancellationToken)
    {
        // ponytail: PurgeMessagesAsync is still internal in Azure.Messaging.ServiceBus 7.20.x
        // (the AMQP batch-delete operation itself is GA). Call it directly once the SDK makes it public.
        if (ServerSidePurgeMethod is null)
        {
            return null;
        }

        try
        {
            var task = (Task<int>)ServerSidePurgeMethod.Invoke(receiver, new object?[] { null, cancellationToken })!;
            var purged = await task;
            // Zero is ambiguous (empty entity or silently unsupported): let the drain confirm.
            return purged > 0 ? purged : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            // Broker (for example the emulator) or SDK does not support server-side purge.
            return null;
        }
    }

    private static readonly System.Reflection.MethodInfo? ServerSidePurgeMethod = typeof(ServiceBusReceiver).GetMethod(
        "PurgeMessagesAsync",
        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public,
        new[] { typeof(DateTimeOffset?), typeof(CancellationToken) });

    /// <summary>
    /// Drains every message from a <see cref="ServiceBusReceiveMode.ReceiveAndDelete"/> receiver.
    /// Prefers the server-side purge and falls back to a receive loop.
    /// Returns the number of messages removed.
    /// </summary>
    internal static async Task<long> DrainAllAsync(ServiceBusReceiver receiver, CancellationToken cancellationToken)
    {
        var purged = await TryPurgeServerSideAsync(receiver, cancellationToken);
        if (purged is not null)
        {
            return purged.Value;
        }

        long drained = 0;
        var consecutiveEmpty = 0;

        while (consecutiveEmpty < NotFoundInScanWindow)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var messages = await receiver.ReceiveMessagesAsync(DrainReceiveBatchSize, ScanReceiveWait, cancellationToken);
            if (messages.Count == 0)
            {
                consecutiveEmpty++;
                continue;
            }

            consecutiveEmpty = 0;
            drained += messages.Count;
        }

        return drained;
    }

    /// <summary>
    /// Selective delete over a PeekLock receiver. Completes the targeted sequence
    /// numbers in parallel chunks and abandons everything else. Terminates once the
    /// read position has passed the largest target, the entity is drained, or the
    /// safety timeout elapses — never on a fixed attempt count.
    /// </summary>
    internal static async Task<BatchOperationResult> DeleteMessagesCoreAsync(ServiceBusReceiver receiver, long[] sequenceNumbers, CancellationToken cancellationToken)
    {
        var result = new BatchOperationResult();
        var targets = new HashSet<long>(sequenceNumbers);
        var located = new HashSet<long>();
        var maxTargetSeq = sequenceNumbers.Max();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(ScanSafetyTimeout);
        var token = timeoutCts.Token;

        var seen = new HashSet<long>();
        long maxSeenSeq = long.MinValue;
        var consecutiveEmpty = 0;
        var noProgressRounds = 0;
        var missingError = NotFoundError;

        try
        {
            while (located.Count < targets.Count)
            {
                token.ThrowIfCancellationRequested();

                var messages = await receiver.ReceiveMessagesAsync(ScanReceiveBatchSize, ScanReceiveWait, token);
                if (messages.Count == 0)
                {
                    if (++consecutiveEmpty >= NotFoundInScanWindow)
                        break;
                    continue;
                }
                consecutiveEmpty = 0;

                var toComplete = new List<ServiceBusReceivedMessage>();
                var toAbandon = new List<ServiceBusReceivedMessage>();
                var newSequenceNumbers = 0;

                foreach (var message in messages)
                {
                    if (seen.Add(message.SequenceNumber))
                        newSequenceNumbers++;
                    if (message.SequenceNumber > maxSeenSeq)
                        maxSeenSeq = message.SequenceNumber;

                    if (targets.Contains(message.SequenceNumber) && !located.Contains(message.SequenceNumber))
                        toComplete.Add(message);
                    else
                        toAbandon.Add(message);
                }

                await CompleteInChunksAsync(receiver, toComplete, located, result, token);

                // Abandon non-targets in parallel so they return to the queue quickly.
                if (toAbandon.Count > 0)
                    await Task.WhenAll(toAbandon.Select(m => receiver.AbandonMessageAsync(m, cancellationToken: token)));

                // Stop once the read position has moved past the largest target: every
                // message up to that point has been observed, so any still-missing target
                // does not exist in the entity.
                if (maxSeenSeq >= maxTargetSeq && toComplete.Count == 0)
                    break;

                // Guard against abandon churn when no message at/after maxTargetSeq exists:
                // if a batch brings no new sequence numbers and no targets, we are recycling.
                if (newSequenceNumbers == 0 && toComplete.Count == 0)
                {
                    if (++noProgressRounds >= NotFoundInScanWindow)
                        break;
                }
                else
                {
                    noProgressRounds = 0;
                }
            }
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            // Safety timeout elapsed; fall through and report whatever is still missing.
        }
        catch (ServiceBusException ex) when (IsEntityDisabled(ex))
        {
            if (located.Count == 0)
                throw new EntityDisabledException(ex);
            missingError = EntityDisabledError;
        }
        catch (ServiceBusException)
        {
            // Transient broker failure mid-scan: stop and return partial results rather
            // than surfacing an unhandled error. Located targets keep their outcome; the
            // rest are reported as not found below.
        }

        foreach (var sequenceNumber in targets.Except(located))
        {
            result.FailureCount++;
            result.Failures.Add(new BatchOperationFailure
            {
                SequenceNumber = sequenceNumber,
                Error = missingError
            });
        }

        return result;
    }

    /// <summary>
    /// Completes the supplied messages in parallel chunks, recording the real per-message
    /// error (for example <c>MessageLockLost</c>) on failure. Every attempted message is
    /// marked located so it is never re-completed on redelivery nor reported as not found.
    /// </summary>
    private static async Task CompleteInChunksAsync(
        ServiceBusReceiver receiver,
        List<ServiceBusReceivedMessage> messages,
        HashSet<long> located,
        BatchOperationResult result,
        CancellationToken cancellationToken)
    {
        for (var i = 0; i < messages.Count; i += CompleteChunkSize)
        {
            var chunk = messages.Skip(i).Take(CompleteChunkSize).ToList();
            var tasks = chunk.Select(async message =>
            {
                try
                {
                    await receiver.CompleteMessageAsync(message, cancellationToken);
                    return (message.SequenceNumber, Success: true, Error: (string?)null);
                }
                catch (Exception ex)
                {
                    return (message.SequenceNumber, Success: false, Error: ex.Message);
                }
            });

            foreach (var r in await Task.WhenAll(tasks))
            {
                located.Add(r.SequenceNumber);
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

    /// <inheritdoc />
    public async Task<BatchOperationResult> ResubmitDeadLetterMessagesAsync(string entityName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.DeadLetter, string? subscriptionName = null, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        if (subQueue == MessageSubQueue.Active)
            throw new ArgumentOutOfRangeException(nameof(subQueue), "A resubmit reads a dead-letter queue.");

        var result = new BatchOperationResult();

        if (sequenceNumbers == null || sequenceNumbers.Length == 0)
        {
            return result;
        }

        // For subscriptions, always send to the TOPIC (not to the subscription directly)
        // This means the message will pass through all subscription filters.
        var targetPath = entityName; // Always send to queue or topic

        await using var receiver = CreateReceiver(_client!, entityName, subscriptionName, subQueue, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.PeekLock,
            PrefetchCount = ScanPrefetchCount
        });
        await using var sender = _client!.CreateSender(targetPath);

        return await ResubmitCoreAsync(receiver, sender, sequenceNumbers, cancellationToken);
    }

    /// <summary>
    /// Resubmits dead-lettered messages in per-batch cycles: each cycle receives a batch,
    /// sends its targets to the destination, then completes them immediately. Because a
    /// message is completed within the same cycle it was received, its PeekLock never ages
    /// out across the whole selection, which is what previously caused duplicates.
    /// Ordering is send-before-complete (at-least-once): if the complete fails after a
    /// successful send, the message is reported as a possible duplicate and never resent.
    /// </summary>
    internal static async Task<BatchOperationResult> ResubmitCoreAsync(
        ServiceBusReceiver receiver,
        ServiceBusSender sender,
        long[] sequenceNumbers,
        CancellationToken cancellationToken)
    {
        var result = new BatchOperationResult();
        var targets = new HashSet<long>(sequenceNumbers);
        var located = new HashSet<long>();
        var maxTargetSeq = sequenceNumbers.Max();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(ScanSafetyTimeout);
        var token = timeoutCts.Token;

        var seen = new HashSet<long>();
        long maxSeenSeq = long.MinValue;
        var consecutiveEmpty = 0;
        var noProgressRounds = 0;
        var missingError = NotFoundError;

        try
        {
            while (located.Count < targets.Count)
            {
                token.ThrowIfCancellationRequested();

                var messages = await receiver.ReceiveMessagesAsync(ScanReceiveBatchSize, ScanReceiveWait, token);
                if (messages.Count == 0)
                {
                    if (++consecutiveEmpty >= NotFoundInScanWindow)
                        break;
                    continue;
                }
                consecutiveEmpty = 0;

                var cycleTargets = new List<ServiceBusReceivedMessage>();
                var toAbandon = new List<ServiceBusReceivedMessage>();
                var newSequenceNumbers = 0;

                foreach (var message in messages)
                {
                    if (seen.Add(message.SequenceNumber))
                        newSequenceNumbers++;
                    if (message.SequenceNumber > maxSeenSeq)
                        maxSeenSeq = message.SequenceNumber;

                    if (targets.Contains(message.SequenceNumber) && !located.Contains(message.SequenceNumber))
                        cycleTargets.Add(message);
                    else
                        toAbandon.Add(message);
                }

                if (cycleTargets.Count > 0)
                {
                    // Send first (at-least-once), then complete immediately in the same cycle.
                    await SendResubmitBatchAsync(sender, cycleTargets, token);
                    await CompleteResubmittedAsync(receiver, cycleTargets, located, result, token);
                }

                if (toAbandon.Count > 0)
                    await Task.WhenAll(toAbandon.Select(m => receiver.AbandonMessageAsync(m, cancellationToken: token)));

                if (maxSeenSeq >= maxTargetSeq && cycleTargets.Count == 0)
                    break;

                if (newSequenceNumbers == 0 && cycleTargets.Count == 0)
                {
                    if (++noProgressRounds >= NotFoundInScanWindow)
                        break;
                }
                else
                {
                    noProgressRounds = 0;
                }
            }
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            // Safety timeout elapsed; fall through and report whatever is still missing.
        }
        catch (ServiceBusException ex) when (IsEntityDisabled(ex))
        {
            if (located.Count == 0)
                throw new EntityDisabledException(ex);
            missingError = EntityDisabledError;
        }
        catch (ServiceBusException)
        {
            // Transient broker failure mid-scan: stop and return partial results rather
            // than surfacing an unhandled error. Already-resubmitted targets keep their
            // outcome; the rest are reported as not found below.
        }

        foreach (var sequenceNumber in targets.Except(located))
        {
            result.FailureCount++;
            result.Failures.Add(new BatchOperationFailure
            {
                SequenceNumber = sequenceNumber,
                Error = missingError
            });
        }

        return result;
    }

    /// <summary>
    /// Sends the supplied dead-lettered messages to the destination, splitting them across
    /// as many <see cref="ServiceBusMessageBatch"/> instances as their size requires.
    /// </summary>
    private static async Task SendResubmitBatchAsync(
        ServiceBusSender sender,
        List<ServiceBusReceivedMessage> messages,
        CancellationToken cancellationToken)
    {
        var batch = await sender.CreateMessageBatchAsync(cancellationToken);
        try
        {
            foreach (var received in messages)
            {
                var outgoing = new ServiceBusMessage(received);

                if (batch.TryAddMessage(outgoing))
                    continue;

                if (batch.Count == 0)
                {
                    // Message is larger than an empty batch; send it on its own.
                    await sender.SendMessageAsync(outgoing, cancellationToken);
                    continue;
                }

                await sender.SendMessagesAsync(batch, cancellationToken);
                batch.Dispose();
                batch = await sender.CreateMessageBatchAsync(cancellationToken);

                if (!batch.TryAddMessage(outgoing))
                    await sender.SendMessageAsync(outgoing, cancellationToken);
            }

            if (batch.Count > 0)
                await sender.SendMessagesAsync(batch, cancellationToken);
        }
        finally
        {
            batch.Dispose();
        }
    }

    /// <summary>
    /// Completes messages already sent to the destination. A complete failure means the
    /// message was resubmitted but could not be removed from the DLQ, so it is reported as
    /// a possible duplicate — it is never resent.
    /// </summary>
    private static async Task CompleteResubmittedAsync(
        ServiceBusReceiver receiver,
        List<ServiceBusReceivedMessage> messages,
        HashSet<long> located,
        BatchOperationResult result,
        CancellationToken cancellationToken)
    {
        for (var i = 0; i < messages.Count; i += CompleteChunkSize)
        {
            var chunk = messages.Skip(i).Take(CompleteChunkSize).ToList();
            var tasks = chunk.Select(async message =>
            {
                try
                {
                    await receiver.CompleteMessageAsync(message, cancellationToken);
                    return (message.SequenceNumber, Success: true, Error: (string?)null);
                }
                catch (Exception ex)
                {
                    return (message.SequenceNumber, Success: false, Error: ex.Message);
                }
            });

            foreach (var r in await Task.WhenAll(tasks))
            {
                located.Add(r.SequenceNumber);
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
                        Error = $"Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: {r.Error}"
                    });
                }
            }
        }
    }

    /// <inheritdoc />
    public async Task<BatchOperationResult> MoveMessagesAsync(string sourceEntityName, string targetQueueName, long[] sequenceNumbers, MessageSubQueue subQueue = MessageSubQueue.Active, string? subscriptionName = null, CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        var result = new BatchOperationResult();

        if (sequenceNumbers == null || sequenceNumbers.Length == 0)
        {
            return result;
        }

        await using var receiver = CreateReceiver(_client!, sourceEntityName, subscriptionName, subQueue, new ServiceBusReceiverOptions
        {
            ReceiveMode = ServiceBusReceiveMode.PeekLock,
            PrefetchCount = ScanPrefetchCount
        });
        await using var sender = _client!.CreateSender(targetQueueName);

        return await MoveCoreAsync(receiver, sender, sequenceNumbers, cancellationToken);
    }

    /// <summary>
    /// Moves messages to the target queue in per-batch cycles: each cycle receives a batch,
    /// sends its targets to the destination, then completes them immediately. Because a
    /// message is completed within the same cycle it was received, its PeekLock never ages
    /// out across the whole selection, which is what previously caused duplicates.
    /// Ordering is send-before-complete (at-least-once): if the complete fails after a
    /// successful send, the message is reported as a possible duplicate and never resent.
    /// </summary>
    internal static async Task<BatchOperationResult> MoveCoreAsync(
        ServiceBusReceiver receiver,
        ServiceBusSender sender,
        long[] sequenceNumbers,
        CancellationToken cancellationToken)
    {
        var result = new BatchOperationResult();
        var targets = new HashSet<long>(sequenceNumbers);
        var located = new HashSet<long>();
        var maxTargetSeq = sequenceNumbers.Max();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(ScanSafetyTimeout);
        var token = timeoutCts.Token;

        var seen = new HashSet<long>();
        long maxSeenSeq = long.MinValue;
        var consecutiveEmpty = 0;
        var noProgressRounds = 0;
        var missingError = NotFoundError;

        try
        {
            while (located.Count < targets.Count)
            {
                token.ThrowIfCancellationRequested();

                var messages = await receiver.ReceiveMessagesAsync(ScanReceiveBatchSize, ScanReceiveWait, token);
                if (messages.Count == 0)
                {
                    if (++consecutiveEmpty >= NotFoundInScanWindow)
                        break;
                    continue;
                }
                consecutiveEmpty = 0;

                var cycleTargets = new List<ServiceBusReceivedMessage>();
                var toAbandon = new List<ServiceBusReceivedMessage>();
                var newSequenceNumbers = 0;

                foreach (var message in messages)
                {
                    if (seen.Add(message.SequenceNumber))
                        newSequenceNumbers++;
                    if (message.SequenceNumber > maxSeenSeq)
                        maxSeenSeq = message.SequenceNumber;

                    if (targets.Contains(message.SequenceNumber) && !located.Contains(message.SequenceNumber))
                        cycleTargets.Add(message);
                    else
                        toAbandon.Add(message);
                }

                if (cycleTargets.Count > 0)
                {
                    // Send first (at-least-once), then complete immediately in the same cycle.
                    await SendResubmitBatchAsync(sender, cycleTargets, token);
                    await CompleteMovedAsync(receiver, cycleTargets, located, result, token);
                }

                if (toAbandon.Count > 0)
                    await Task.WhenAll(toAbandon.Select(m => receiver.AbandonMessageAsync(m, cancellationToken: token)));

                if (maxSeenSeq >= maxTargetSeq && cycleTargets.Count == 0)
                    break;

                if (newSequenceNumbers == 0 && cycleTargets.Count == 0)
                {
                    if (++noProgressRounds >= NotFoundInScanWindow)
                        break;
                }
                else
                {
                    noProgressRounds = 0;
                }
            }
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            // Safety timeout elapsed; fall through and report whatever is still missing.
        }
        catch (ServiceBusException ex) when (IsEntityDisabled(ex))
        {
            if (located.Count == 0)
                throw new EntityDisabledException(ex);
            missingError = EntityDisabledError;
        }
        catch (ServiceBusException)
        {
            // Transient broker failure mid-scan: stop and return partial results rather
            // than surfacing an unhandled error. Already-moved targets keep their outcome;
            // the rest are reported as not found below.
        }

        foreach (var sequenceNumber in targets.Except(located))
        {
            result.FailureCount++;
            result.Failures.Add(new BatchOperationFailure
            {
                SequenceNumber = sequenceNumber,
                Error = missingError
            });
        }

        return result;
    }

    /// <summary>
    /// Completes messages already sent to the target queue. A complete failure means the
    /// message was moved but could not be removed from the source, so it is reported as a
    /// possible duplicate — it is never resent.
    /// </summary>
    private static async Task CompleteMovedAsync(
        ServiceBusReceiver receiver,
        List<ServiceBusReceivedMessage> messages,
        HashSet<long> located,
        BatchOperationResult result,
        CancellationToken cancellationToken)
    {
        for (var i = 0; i < messages.Count; i += CompleteChunkSize)
        {
            var chunk = messages.Skip(i).Take(CompleteChunkSize).ToList();
            var tasks = chunk.Select(async message =>
            {
                try
                {
                    await receiver.CompleteMessageAsync(message, cancellationToken);
                    return (message.SequenceNumber, Success: true, Error: (string?)null);
                }
                catch (Exception ex)
                {
                    return (message.SequenceNumber, Success: false, Error: ex.Message);
                }
            });

            foreach (var r in await Task.WhenAll(tasks))
            {
                located.Add(r.SequenceNumber);
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
                        Error = string.Format(MoveDuplicateError, r.Error)
                    });
                }
            }
        }
    }

    /// <inheritdoc />
    public async Task<BatchOperationResult> CancelScheduledMessagesAsync(string queueName, long[] sequenceNumbers, CancellationToken cancellationToken = default)
    {
        EnsureConnected();
        ThrowIfInvalid(EntityConfigurationValidator.ValidateScheduledSequenceNumbers(sequenceNumbers));

        await using var sender = _client!.CreateSender(queueName);
        return await CancelScheduledCoreAsync(sender, queueName, _logger, sequenceNumbers, cancellationToken);
    }

    /// <summary>
    /// Cancels the scheduled messages in one broker call. The broker refuses the whole call when one sequence number
    /// is not a scheduled message, and cancels none; only then is each number cancelled on its own, so the result says
    /// which ones were not scheduled. A number already cancelled is accepted again by the broker. A disabled entity
    /// before anything was cancelled throws <see cref="EntityDisabledException"/>; found midway, it fails the numbers
    /// not yet tried with the text of <see cref="EntityDisabledException"/> and retries nothing. A failed number carries
    /// one of three fixed sentences; the causes are logged once per request, never one line per number. The caller's
    /// token stops the operation.
    /// </summary>
    internal static async Task<BatchOperationResult> CancelScheduledCoreAsync(
        ServiceBusSender sender, string queueName, ILogger logger, long[] sequenceNumbers, CancellationToken cancellationToken)
    {
        var causes = new List<Exception>();
        var result = await CancelEachScheduledAsync(sender, sequenceNumbers, causes, cancellationToken);
        if (result.FailureCount > 0)
        {
            logger.LogWarning(causes[0], "Cancel of scheduled messages on queue {QueueName} left {FailureCount} sequence numbers not cancelled; causes: {Causes}",
                queueName, result.FailureCount, string.Join(", ", causes.Select(CauseOf).Distinct()));
        }

        return result;
    }

    private static async Task<BatchOperationResult> CancelEachScheduledAsync(
        ServiceBusSender sender, long[] sequenceNumbers, List<Exception> causes, CancellationToken cancellationToken)
    {
        var result = new BatchOperationResult();
        try
        {
            await sender.CancelScheduledMessagesAsync(sequenceNumbers, cancellationToken);
            result.SuccessCount = sequenceNumbers.Length;
            return result;
        }
        catch (ServiceBusException ex) when (IsEntityDisabled(ex))
        {
            throw new EntityDisabledException(ex);
        }
        catch (ServiceBusException ex) when (ex.Reason == ServiceBusFailureReason.MessageNotFound)
        {
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            causes.Add(ex);
            foreach (var sequenceNumber in sequenceNumbers)
                AddFailure(result, sequenceNumber, CancelFailureText(ex));
            return result;
        }

        for (var i = 0; i < sequenceNumbers.Length; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                await sender.CancelScheduledMessagesAsync(new[] { sequenceNumbers[i] }, cancellationToken);
                result.SuccessCount++;
            }
            catch (ServiceBusException ex) when (IsEntityDisabled(ex))
            {
                if (result.SuccessCount + result.FailureCount == 0)
                    throw new EntityDisabledException(ex);
                causes.Add(ex);
                foreach (var sequenceNumber in sequenceNumbers[i..])
                    AddFailure(result, sequenceNumber, EntityDisabledError);
                break;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                causes.Add(ex);
                AddFailure(result, sequenceNumbers[i], CancelFailureText(ex));
            }
        }

        return result;
    }

    private static string CancelFailureText(Exception ex) =>
        ex is ServiceBusException { Reason: ServiceBusFailureReason.MessageNotFound } ? NotScheduledError : CancelFailedError;

    private static string CauseOf(Exception ex) => ex is ServiceBusException sb ? sb.Reason.ToString() : ex.GetType().Name;

    private static void AddFailure(BatchOperationResult result, long sequenceNumber, string error)
    {
        result.FailureCount++;
        result.Failures.Add(new BatchOperationFailure { SequenceNumber = sequenceNumber, Error = error });
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

    internal static MessageInfo MapToMessageInfo(ServiceBusReceivedMessage message, bool isDeadLettered)
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
            State = message.State.ToString(),
            SizeInBytes = message.Body.ToMemory().Length,
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
