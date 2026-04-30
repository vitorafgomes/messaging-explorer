using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using ServiceBusExplorer.Core.Providers.RabbitMQ.Models;

namespace ServiceBusExplorer.Core.Providers.RabbitMQ;

/// <summary>
/// HTTP client for RabbitMQ Management API (port 15672).
/// Provides administrative operations like listing queues/exchanges, creating/deleting entities, and getting message counts.
/// </summary>
public class RabbitMQManagementClient : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly string _virtualHost;
    private readonly JsonSerializerOptions _jsonOptions;
    private bool _disposed;

    /// <summary>
    /// Initializes a new instance of the <see cref="RabbitMQManagementClient"/> class.
    /// </summary>
    /// <param name="config">The RabbitMQ connection configuration.</param>
    public RabbitMQManagementClient(RabbitMQConnectionConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);

        _baseUrl = config.GetManagementApiUrl();
        _virtualHost = config.VirtualHost;

        _httpClient = new HttpClient();
        ConfigureAuthentication(config.UserName, config.Password);

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="RabbitMQManagementClient"/> class with a custom HttpClient.
    /// Used for testing purposes.
    /// </summary>
    /// <param name="httpClient">The HttpClient to use.</param>
    /// <param name="baseUrl">The base URL for the Management API.</param>
    /// <param name="virtualHost">The virtual host to use.</param>
    /// <param name="userName">The username for authentication.</param>
    /// <param name="password">The password for authentication.</param>
    internal RabbitMQManagementClient(HttpClient httpClient, string baseUrl, string virtualHost, string userName, string password)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _baseUrl = baseUrl ?? throw new ArgumentNullException(nameof(baseUrl));
        _virtualHost = virtualHost ?? throw new ArgumentNullException(nameof(virtualHost));

        ConfigureAuthentication(userName, password);

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
    }

    private void ConfigureAuthentication(string userName, string password)
    {
        var credentials = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{userName}:{password}"));
        _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    #region Connection Testing

    /// <summary>
    /// Tests the connection to the RabbitMQ Management API.
    /// </summary>
    /// <returns>True if the connection is successful, false otherwise.</returns>
    public async Task<bool> TestConnectionAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_baseUrl}/overview");

            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"[RabbitMQ] Management API returned {response.StatusCode}");
            }

            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[RabbitMQ] Management API error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Gets the RabbitMQ server overview information.
    /// </summary>
    /// <returns>The overview information as a dictionary.</returns>
    public async Task<ManagementOverview?> GetOverviewAsync()
    {
        var response = await _httpClient.GetAsync($"{_baseUrl}/overview");
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<ManagementOverview>(_jsonOptions);
    }

    #endregion

    #region Queue Operations

    /// <summary>
    /// Gets all queues in the configured virtual host.
    /// </summary>
    /// <returns>A list of queue information.</returns>
    public async Task<IEnumerable<RabbitMQQueueInfo>> GetQueuesAsync()
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var response = await _httpClient.GetAsync($"{_baseUrl}/queues/{encodedVHost}");
        response.EnsureSuccessStatusCode();

        var apiQueues = await response.Content.ReadFromJsonAsync<List<ManagementQueueResponse>>(_jsonOptions);
        return apiQueues?.Select(MapToQueueInfo) ?? Enumerable.Empty<RabbitMQQueueInfo>();
    }

    /// <summary>
    /// Gets a specific queue by name.
    /// </summary>
    /// <param name="queueName">The name of the queue.</param>
    /// <returns>The queue information, or null if not found.</returns>
    public async Task<RabbitMQQueueInfo?> GetQueueAsync(string queueName)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(queueName);

        var response = await _httpClient.GetAsync($"{_baseUrl}/queues/{encodedVHost}/{encodedName}");

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        var apiQueue = await response.Content.ReadFromJsonAsync<ManagementQueueResponse>(_jsonOptions);
        return apiQueue != null ? MapToQueueInfo(apiQueue) : null;
    }

    /// <summary>
    /// Creates a new queue.
    /// </summary>
    /// <param name="queueName">The name of the queue to create.</param>
    /// <param name="durable">Whether the queue should survive broker restart.</param>
    /// <param name="autoDelete">Whether the queue should be deleted when no longer in use.</param>
    /// <param name="arguments">Optional queue arguments.</param>
    public async Task CreateQueueAsync(string queueName, bool durable = true, bool autoDelete = false, Dictionary<string, object>? arguments = null)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(queueName);

        var body = new ManagementQueueCreateRequest
        {
            Durable = durable,
            AutoDelete = autoDelete,
            Arguments = arguments ?? new Dictionary<string, object>()
        };

        var response = await _httpClient.PutAsJsonAsync(
            $"{_baseUrl}/queues/{encodedVHost}/{encodedName}",
            body,
            _jsonOptions);

        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Deletes a queue.
    /// </summary>
    /// <param name="queueName">The name of the queue to delete.</param>
    /// <param name="ifUnused">Only delete if the queue has no consumers.</param>
    /// <param name="ifEmpty">Only delete if the queue is empty.</param>
    public async Task DeleteQueueAsync(string queueName, bool ifUnused = false, bool ifEmpty = false)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(queueName);

        var queryParams = new List<string>();
        if (ifUnused) queryParams.Add("if-unused=true");
        if (ifEmpty) queryParams.Add("if-empty=true");

        var queryString = queryParams.Count > 0 ? "?" + string.Join("&", queryParams) : "";

        var response = await _httpClient.DeleteAsync($"{_baseUrl}/queues/{encodedVHost}/{encodedName}{queryString}");
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Purges all messages from a queue.
    /// </summary>
    /// <param name="queueName">The name of the queue to purge.</param>
    public async Task PurgeQueueAsync(string queueName)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(queueName);

        var response = await _httpClient.DeleteAsync($"{_baseUrl}/queues/{encodedVHost}/{encodedName}/contents");
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            throw new HttpRequestException($"Purge queue '{queueName}' failed with status {(int)response.StatusCode}: {body}");
        }
    }

    /// <summary>
    /// Gets messages from a queue (peek).
    /// </summary>
    /// <param name="queueName">The name of the queue.</param>
    /// <param name="count">The number of messages to get.</param>
    /// <param name="ackMode">The acknowledgment mode: "ack_requeue_true" (peek), "ack_requeue_false" (consume).</param>
    /// <param name="encoding">The encoding for the message body: "auto", "base64".</param>
    /// <returns>A list of messages.</returns>
    public async Task<IEnumerable<ManagementMessageResponse>> GetMessagesAsync(string queueName, int count = 10, string ackMode = "ack_requeue_true", string encoding = "auto")
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(queueName);

        var request = new ManagementGetMessagesRequest
        {
            Count = count,
            AckMode = ackMode,
            Encoding = encoding
        };

        var response = await _httpClient.PostAsJsonAsync(
            $"{_baseUrl}/queues/{encodedVHost}/{encodedName}/get",
            request,
            _jsonOptions);

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<List<ManagementMessageResponse>>(_jsonOptions)
            ?? Enumerable.Empty<ManagementMessageResponse>();
    }

    #endregion

    #region Exchange Operations

    /// <summary>
    /// Gets all exchanges in the configured virtual host.
    /// </summary>
    /// <returns>A list of exchange information.</returns>
    public async Task<IEnumerable<RabbitMQExchangeInfo>> GetExchangesAsync()
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var response = await _httpClient.GetAsync($"{_baseUrl}/exchanges/{encodedVHost}");
        response.EnsureSuccessStatusCode();

        var apiExchanges = await response.Content.ReadFromJsonAsync<List<ManagementExchangeResponse>>(_jsonOptions);
        return apiExchanges?.Select(MapToExchangeInfo) ?? Enumerable.Empty<RabbitMQExchangeInfo>();
    }

    /// <summary>
    /// Gets a specific exchange by name.
    /// </summary>
    /// <param name="exchangeName">The name of the exchange.</param>
    /// <returns>The exchange information, or null if not found.</returns>
    public async Task<RabbitMQExchangeInfo?> GetExchangeAsync(string exchangeName)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(exchangeName);

        var response = await _httpClient.GetAsync($"{_baseUrl}/exchanges/{encodedVHost}/{encodedName}");

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        var apiExchange = await response.Content.ReadFromJsonAsync<ManagementExchangeResponse>(_jsonOptions);
        return apiExchange != null ? MapToExchangeInfo(apiExchange) : null;
    }

    /// <summary>
    /// Creates a new exchange.
    /// </summary>
    /// <param name="exchangeName">The name of the exchange to create.</param>
    /// <param name="exchangeType">The type of exchange: direct, fanout, topic, headers.</param>
    /// <param name="durable">Whether the exchange should survive broker restart.</param>
    /// <param name="autoDelete">Whether the exchange should be deleted when no longer in use.</param>
    /// <param name="internal">Whether the exchange is internal (cannot receive messages from clients).</param>
    /// <param name="arguments">Optional exchange arguments.</param>
    public async Task CreateExchangeAsync(string exchangeName, string exchangeType = "direct", bool durable = true, bool autoDelete = false, bool @internal = false, Dictionary<string, object>? arguments = null)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(exchangeName);

        var body = new ManagementExchangeCreateRequest
        {
            Type = exchangeType,
            Durable = durable,
            AutoDelete = autoDelete,
            Internal = @internal,
            Arguments = arguments ?? new Dictionary<string, object>()
        };

        var response = await _httpClient.PutAsJsonAsync(
            $"{_baseUrl}/exchanges/{encodedVHost}/{encodedName}",
            body,
            _jsonOptions);

        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Deletes an exchange.
    /// </summary>
    /// <param name="exchangeName">The name of the exchange to delete.</param>
    /// <param name="ifUnused">Only delete if the exchange has no bindings.</param>
    public async Task DeleteExchangeAsync(string exchangeName, bool ifUnused = false)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(exchangeName);

        var queryString = ifUnused ? "?if-unused=true" : "";

        var response = await _httpClient.DeleteAsync($"{_baseUrl}/exchanges/{encodedVHost}/{encodedName}{queryString}");
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Publishes a message to an exchange.
    /// </summary>
    /// <param name="exchangeName">The name of the exchange.</param>
    /// <param name="routingKey">The routing key for the message.</param>
    /// <param name="payload">The message payload.</param>
    /// <param name="properties">Optional message properties.</param>
    /// <param name="payloadEncoding">The encoding of the payload: "string", "base64".</param>
    public async Task PublishMessageAsync(string exchangeName, string routingKey, string payload, Dictionary<string, object>? properties = null, string payloadEncoding = "string")
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(exchangeName);

        var request = new ManagementPublishRequest
        {
            RoutingKey = routingKey,
            Payload = payload,
            PayloadEncoding = payloadEncoding,
            Properties = properties ?? new Dictionary<string, object>()
        };

        var response = await _httpClient.PostAsJsonAsync(
            $"{_baseUrl}/exchanges/{encodedVHost}/{encodedName}/publish",
            request,
            _jsonOptions);

        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Publishes a message directly to a queue via the default exchange.
    /// The default exchange routes messages to the queue whose name matches the routing key.
    /// </summary>
    /// <param name="queueName">The name of the target queue.</param>
    /// <param name="payload">The message payload.</param>
    /// <param name="properties">Optional message properties.</param>
    /// <param name="payloadEncoding">The encoding of the payload: "string", "base64".</param>
    public async Task PublishToQueueAsync(string queueName, string payload,
        Dictionary<string, object>? properties = null, string payloadEncoding = "string")
    {
        // Publishing to the default exchange ("amq.default" in Management API)
        // with routing key = queueName routes the message directly to the named queue
        await PublishMessageAsync("amq.default", queueName, payload, properties, payloadEncoding);
    }

    #endregion

    #region Binding Operations

    /// <summary>
    /// Gets all bindings for a queue.
    /// </summary>
    /// <param name="queueName">The name of the queue.</param>
    /// <returns>A list of bindings for the queue.</returns>
    public async Task<IEnumerable<RabbitMQBindingInfo>> GetQueueBindingsAsync(string queueName)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(queueName);

        var response = await _httpClient.GetAsync($"{_baseUrl}/queues/{encodedVHost}/{encodedName}/bindings");
        response.EnsureSuccessStatusCode();

        var apiBindings = await response.Content.ReadFromJsonAsync<List<ManagementBindingResponse>>(_jsonOptions);
        return apiBindings?.Select(MapToBindingInfo) ?? Enumerable.Empty<RabbitMQBindingInfo>();
    }

    /// <summary>
    /// Gets all bindings for an exchange (bindings where this exchange is the source).
    /// </summary>
    /// <param name="exchangeName">The name of the exchange.</param>
    /// <returns>A list of bindings for the exchange.</returns>
    public async Task<IEnumerable<RabbitMQBindingInfo>> GetExchangeBindingsAsync(string exchangeName)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedName = Uri.EscapeDataString(exchangeName);

        var response = await _httpClient.GetAsync($"{_baseUrl}/exchanges/{encodedVHost}/{encodedName}/bindings/source");
        response.EnsureSuccessStatusCode();

        var apiBindings = await response.Content.ReadFromJsonAsync<List<ManagementBindingResponse>>(_jsonOptions);
        return apiBindings?.Select(MapToBindingInfo) ?? Enumerable.Empty<RabbitMQBindingInfo>();
    }

    /// <summary>
    /// Creates a binding between an exchange and a queue.
    /// </summary>
    /// <param name="exchangeName">The source exchange name.</param>
    /// <param name="queueName">The destination queue name.</param>
    /// <param name="routingKey">The routing key for the binding.</param>
    /// <param name="arguments">Optional binding arguments.</param>
    public async Task CreateQueueBindingAsync(string exchangeName, string queueName, string routingKey = "", Dictionary<string, object>? arguments = null)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedExchange = Uri.EscapeDataString(exchangeName);
        var encodedQueue = Uri.EscapeDataString(queueName);

        var body = new ManagementBindingCreateRequest
        {
            RoutingKey = routingKey,
            Arguments = arguments ?? new Dictionary<string, object>()
        };

        var response = await _httpClient.PostAsJsonAsync(
            $"{_baseUrl}/bindings/{encodedVHost}/e/{encodedExchange}/q/{encodedQueue}",
            body,
            _jsonOptions);

        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Creates a binding between two exchanges.
    /// </summary>
    /// <param name="sourceExchange">The source exchange name.</param>
    /// <param name="destinationExchange">The destination exchange name.</param>
    /// <param name="routingKey">The routing key for the binding.</param>
    /// <param name="arguments">Optional binding arguments.</param>
    public async Task CreateExchangeBindingAsync(string sourceExchange, string destinationExchange, string routingKey = "", Dictionary<string, object>? arguments = null)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedSource = Uri.EscapeDataString(sourceExchange);
        var encodedDest = Uri.EscapeDataString(destinationExchange);

        var body = new ManagementBindingCreateRequest
        {
            RoutingKey = routingKey,
            Arguments = arguments ?? new Dictionary<string, object>()
        };

        var response = await _httpClient.PostAsJsonAsync(
            $"{_baseUrl}/bindings/{encodedVHost}/e/{encodedSource}/e/{encodedDest}",
            body,
            _jsonOptions);

        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Deletes a binding between an exchange and a queue.
    /// </summary>
    /// <param name="exchangeName">The source exchange name.</param>
    /// <param name="queueName">The destination queue name.</param>
    /// <param name="propertiesKey">The properties key identifying the binding.</param>
    public async Task DeleteQueueBindingAsync(string exchangeName, string queueName, string propertiesKey)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedExchange = Uri.EscapeDataString(exchangeName);
        var encodedQueue = Uri.EscapeDataString(queueName);
        var encodedProps = Uri.EscapeDataString(propertiesKey);

        var response = await _httpClient.DeleteAsync(
            $"{_baseUrl}/bindings/{encodedVHost}/e/{encodedExchange}/q/{encodedQueue}/{encodedProps}");

        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Deletes a binding between two exchanges.
    /// </summary>
    /// <param name="sourceExchange">The source exchange name.</param>
    /// <param name="destinationExchange">The destination exchange name.</param>
    /// <param name="propertiesKey">The properties key identifying the binding.</param>
    public async Task DeleteExchangeBindingAsync(string sourceExchange, string destinationExchange, string propertiesKey)
    {
        var encodedVHost = EncodeVirtualHost(_virtualHost);
        var encodedSource = Uri.EscapeDataString(sourceExchange);
        var encodedDest = Uri.EscapeDataString(destinationExchange);
        var encodedProps = Uri.EscapeDataString(propertiesKey);

        var response = await _httpClient.DeleteAsync(
            $"{_baseUrl}/bindings/{encodedVHost}/e/{encodedSource}/e/{encodedDest}/{encodedProps}");

        response.EnsureSuccessStatusCode();
    }

    #endregion

    #region Helper Methods

    /// <summary>
    /// URL-encodes the virtual host, handling the "/" default case.
    /// </summary>
    private static string EncodeVirtualHost(string virtualHost)
    {
        // The default virtual host "/" should be encoded as "%2F"
        return Uri.EscapeDataString(virtualHost);
    }

    private static RabbitMQQueueInfo MapToQueueInfo(ManagementQueueResponse response)
    {
        return new RabbitMQQueueInfo
        {
            Name = response.Name ?? string.Empty,
            VirtualHost = response.Vhost ?? "/",
            Durable = response.Durable,
            AutoDelete = response.AutoDelete,
            Exclusive = response.Exclusive,

            // Message counts
            TotalMessages = response.Messages,
            MessagesReady = response.MessagesReady,
            MessagesUnacknowledged = response.MessagesUnacked,
            ActiveMessageCount = response.MessagesReady,

            // Consumer count
            ConsumerCount = response.Consumers,

            // State and node
            State = response.State ?? "running",
            Node = response.Node,

            // Queue type
            QueueType = response.Type ?? "classic",

            // Dead letter configuration
            DeadLetterExchange = GetArgumentValue<string>(response.Arguments, "x-dead-letter-exchange"),
            DeadLetterRoutingKey = GetArgumentValue<string>(response.Arguments, "x-dead-letter-routing-key"),

            // TTL and limits
            MessageTtlMilliseconds = GetArgumentValue<long?>(response.Arguments, "x-message-ttl"),
            MaxLength = GetArgumentValue<long?>(response.Arguments, "x-max-length"),
            MaxLengthBytes = GetArgumentValue<long?>(response.Arguments, "x-max-length-bytes"),
            OverflowBehavior = GetArgumentValue<string>(response.Arguments, "x-overflow"),

            // Rate statistics
            MessageRateDeliver = response.MessageStats?.DeliverDetails?.Rate ?? 0,
            MessageRatePublish = response.MessageStats?.PublishDetails?.Rate ?? 0,

            // Arguments
            Arguments = response.Arguments ?? new Dictionary<string, object>(),

            // Abstract interface properties
            Status = response.State ?? "running",
            SizeInBytes = response.MessageBytes,
            CreatedAt = DateTimeOffset.UtcNow, // Not available from API
            UpdatedAt = DateTimeOffset.UtcNow,
            AccessedAt = DateTimeOffset.UtcNow,

            // Default values for unsupported features
            DeadLetterMessageCount = 0, // Would need to query DLX queue
            ScheduledMessageCount = 0, // Not supported in RabbitMQ
            TransferMessageCount = 0, // Azure-specific concept
            DefaultMessageTimeToLive = response.Arguments?.ContainsKey("x-message-ttl") == true
                ? TimeSpan.FromMilliseconds(Convert.ToInt64(response.Arguments["x-message-ttl"]))
                : TimeSpan.MaxValue, // Use TimeSpan.MaxValue instead of converting long.MaxValue
            LockDuration = TimeSpan.Zero, // Azure-specific concept
            MaxDeliveryCount = 0, // Not directly supported
            MaxSizeInMegabytes = 0, // Not directly limited
            RequiresSession = false, // Not supported in RabbitMQ
            DeadLetteringOnMessageExpiration = response.Arguments?.ContainsKey("x-dead-letter-exchange") == true,
            EnablePartitioning = false // Not the same concept in RabbitMQ
        };
    }

    private static RabbitMQExchangeInfo MapToExchangeInfo(ManagementExchangeResponse response)
    {
        return new RabbitMQExchangeInfo
        {
            Name = response.Name ?? string.Empty,
            VirtualHost = response.Vhost ?? "/",
            ExchangeType = response.Type ?? "direct",
            Durable = response.Durable,
            AutoDelete = response.AutoDelete,
            Internal = response.Internal,

            // Rate statistics
            MessageRateIn = response.MessageStats?.PublishInDetails?.Rate ?? 0,
            MessageRateOut = response.MessageStats?.PublishOutDetails?.Rate ?? 0,

            // Alternate exchange
            AlternateExchange = GetArgumentValue<string>(response.Arguments, "alternate-exchange"),

            // Arguments
            Arguments = response.Arguments ?? new Dictionary<string, object>(),

            // Abstract interface properties
            Status = "Active",
            SizeInBytes = 0, // Exchanges don't have size
            CreatedAt = DateTimeOffset.UtcNow, // Not available from API
            UpdatedAt = DateTimeOffset.UtcNow,
            AccessedAt = DateTimeOffset.UtcNow,

            // Default values for topic-specific properties
            SubscriptionCount = 0, // Would need to count bindings
            ScheduledMessageCount = 0, // Not supported
            DefaultMessageTimeToLive = TimeSpan.MaxValue,
            AutoDeleteOnIdle = TimeSpan.Zero,
            DuplicateDetectionHistoryTimeWindow = TimeSpan.Zero,
            MaxSizeInMegabytes = 0,
            MaxMessageSizeInKilobytes = 128 * 1024, // RabbitMQ default max
            RequiresDuplicateDetection = false,
            EnableBatchedOperations = true,
            SupportOrdering = false,
            EnableExpress = false,
            EnablePartitioning = false,
            UserMetadata = string.Empty
        };
    }

    private static RabbitMQBindingInfo MapToBindingInfo(ManagementBindingResponse response)
    {
        return new RabbitMQBindingInfo
        {
            Source = response.Source ?? string.Empty,
            Destination = response.Destination ?? string.Empty,
            DestinationType = response.DestinationType ?? "queue",
            RoutingKey = response.RoutingKey ?? string.Empty,
            VirtualHost = response.Vhost ?? "/",
            Arguments = response.Arguments ?? new Dictionary<string, object>(),
            PropertiesKey = response.PropertiesKey
        };
    }

    private static T? GetArgumentValue<T>(Dictionary<string, object>? arguments, string key)
    {
        if (arguments == null || !arguments.TryGetValue(key, out var value))
        {
            return default;
        }

        if (value is T typedValue)
        {
            return typedValue;
        }

        if (value is JsonElement jsonElement)
        {
            try
            {
                return jsonElement.Deserialize<T>();
            }
            catch
            {
                return default;
            }
        }

        try
        {
            return (T)Convert.ChangeType(value, typeof(T));
        }
        catch
        {
            return default;
        }
    }

    #endregion

    #region IDisposable

    /// <summary>
    /// Disposes the HTTP client.
    /// </summary>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Disposes the HTTP client.
    /// </summary>
    /// <param name="disposing">Whether to dispose managed resources.</param>
    protected virtual void Dispose(bool disposing)
    {
        if (!_disposed)
        {
            if (disposing)
            {
                _httpClient.Dispose();
            }
            _disposed = true;
        }
    }

    #endregion
}

#region Management API Response Models

/// <summary>
/// RabbitMQ Management API overview response.
/// </summary>
public class ManagementOverview
{
    /// <summary>
    /// The RabbitMQ version.
    /// </summary>
    [JsonPropertyName("rabbitmq_version")]
    public string? RabbitmqVersion { get; set; }

    /// <summary>
    /// The cluster name.
    /// </summary>
    [JsonPropertyName("cluster_name")]
    public string? ClusterName { get; set; }

    /// <summary>
    /// The Erlang version.
    /// </summary>
    [JsonPropertyName("erlang_version")]
    public string? ErlangVersion { get; set; }

    /// <summary>
    /// The management plugin version.
    /// </summary>
    [JsonPropertyName("management_version")]
    public string? ManagementVersion { get; set; }

    /// <summary>
    /// Queue totals.
    /// </summary>
    [JsonPropertyName("queue_totals")]
    public QueueTotals? QueueTotals { get; set; }

    /// <summary>
    /// Object totals.
    /// </summary>
    [JsonPropertyName("object_totals")]
    public ObjectTotals? ObjectTotals { get; set; }
}

/// <summary>
/// Queue totals from the overview.
/// </summary>
public class QueueTotals
{
    /// <summary>
    /// Total number of messages.
    /// </summary>
    [JsonPropertyName("messages")]
    public long Messages { get; set; }

    /// <summary>
    /// Number of messages ready for delivery.
    /// </summary>
    [JsonPropertyName("messages_ready")]
    public long MessagesReady { get; set; }

    /// <summary>
    /// Number of unacknowledged messages.
    /// </summary>
    [JsonPropertyName("messages_unacknowledged")]
    public long MessagesUnacknowledged { get; set; }
}

/// <summary>
/// Object totals from the overview.
/// </summary>
public class ObjectTotals
{
    /// <summary>
    /// Total number of connections.
    /// </summary>
    [JsonPropertyName("connections")]
    public int Connections { get; set; }

    /// <summary>
    /// Total number of channels.
    /// </summary>
    [JsonPropertyName("channels")]
    public int Channels { get; set; }

    /// <summary>
    /// Total number of exchanges.
    /// </summary>
    [JsonPropertyName("exchanges")]
    public int Exchanges { get; set; }

    /// <summary>
    /// Total number of queues.
    /// </summary>
    [JsonPropertyName("queues")]
    public int Queues { get; set; }

    /// <summary>
    /// Total number of consumers.
    /// </summary>
    [JsonPropertyName("consumers")]
    public int Consumers { get; set; }
}

/// <summary>
/// Queue response from Management API.
/// </summary>
internal class ManagementQueueResponse
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("vhost")]
    public string? Vhost { get; set; }

    [JsonPropertyName("durable")]
    public bool Durable { get; set; }

    [JsonPropertyName("auto_delete")]
    public bool AutoDelete { get; set; }

    [JsonPropertyName("exclusive")]
    public bool Exclusive { get; set; }

    [JsonPropertyName("messages")]
    public long Messages { get; set; }

    [JsonPropertyName("messages_ready")]
    public long MessagesReady { get; set; }

    [JsonPropertyName("messages_unacknowledged")]
    public long MessagesUnacked { get; set; }

    [JsonPropertyName("message_bytes")]
    public long MessageBytes { get; set; }

    [JsonPropertyName("consumers")]
    public int Consumers { get; set; }

    [JsonPropertyName("state")]
    public string? State { get; set; }

    [JsonPropertyName("node")]
    public string? Node { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("arguments")]
    public Dictionary<string, object>? Arguments { get; set; }

    [JsonPropertyName("message_stats")]
    public MessageStats? MessageStats { get; set; }
}

/// <summary>
/// Exchange response from Management API.
/// </summary>
internal class ManagementExchangeResponse
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("vhost")]
    public string? Vhost { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("durable")]
    public bool Durable { get; set; }

    [JsonPropertyName("auto_delete")]
    public bool AutoDelete { get; set; }

    [JsonPropertyName("internal")]
    public bool Internal { get; set; }

    [JsonPropertyName("arguments")]
    public Dictionary<string, object>? Arguments { get; set; }

    [JsonPropertyName("message_stats")]
    public ExchangeMessageStats? MessageStats { get; set; }
}

/// <summary>
/// Binding response from Management API.
/// </summary>
internal class ManagementBindingResponse
{
    [JsonPropertyName("source")]
    public string? Source { get; set; }

    [JsonPropertyName("destination")]
    public string? Destination { get; set; }

    [JsonPropertyName("destination_type")]
    public string? DestinationType { get; set; }

    [JsonPropertyName("routing_key")]
    public string? RoutingKey { get; set; }

    [JsonPropertyName("vhost")]
    public string? Vhost { get; set; }

    [JsonPropertyName("arguments")]
    public Dictionary<string, object>? Arguments { get; set; }

    [JsonPropertyName("properties_key")]
    public string? PropertiesKey { get; set; }
}

/// <summary>
/// Message statistics for queues.
/// </summary>
internal class MessageStats
{
    [JsonPropertyName("deliver_details")]
    public RateDetails? DeliverDetails { get; set; }

    [JsonPropertyName("publish_details")]
    public RateDetails? PublishDetails { get; set; }
}

/// <summary>
/// Message statistics for exchanges.
/// </summary>
internal class ExchangeMessageStats
{
    [JsonPropertyName("publish_in_details")]
    public RateDetails? PublishInDetails { get; set; }

    [JsonPropertyName("publish_out_details")]
    public RateDetails? PublishOutDetails { get; set; }
}

/// <summary>
/// Rate details for message statistics.
/// </summary>
internal class RateDetails
{
    [JsonPropertyName("rate")]
    public double Rate { get; set; }
}

/// <summary>
/// Message response from Management API.
/// </summary>
public class ManagementMessageResponse
{
    /// <summary>
    /// The message payload.
    /// </summary>
    [JsonPropertyName("payload")]
    public string? Payload { get; set; }

    /// <summary>
    /// The payload encoding.
    /// </summary>
    [JsonPropertyName("payload_encoding")]
    public string? PayloadEncoding { get; set; }

    /// <summary>
    /// The payload size in bytes.
    /// </summary>
    [JsonPropertyName("payload_bytes")]
    public long PayloadBytes { get; set; }

    /// <summary>
    /// Whether the message was redelivered.
    /// </summary>
    [JsonPropertyName("redelivered")]
    public bool Redelivered { get; set; }

    /// <summary>
    /// The exchange the message was published to.
    /// </summary>
    [JsonPropertyName("exchange")]
    public string? Exchange { get; set; }

    /// <summary>
    /// The routing key used to route the message.
    /// </summary>
    [JsonPropertyName("routing_key")]
    public string? RoutingKey { get; set; }

    /// <summary>
    /// The message properties.
    /// </summary>
    [JsonPropertyName("properties")]
    public MessageProperties? Properties { get; set; }

    /// <summary>
    /// The message count in the queue.
    /// </summary>
    [JsonPropertyName("message_count")]
    public long MessageCount { get; set; }
}

/// <summary>
/// Message properties from Management API.
/// </summary>
public class MessageProperties
{
    /// <summary>
    /// The content type.
    /// </summary>
    [JsonPropertyName("content_type")]
    public string? ContentType { get; set; }

    /// <summary>
    /// The content encoding.
    /// </summary>
    [JsonPropertyName("content_encoding")]
    public string? ContentEncoding { get; set; }

    /// <summary>
    /// The message headers.
    /// </summary>
    [JsonPropertyName("headers")]
    public Dictionary<string, object>? Headers { get; set; }

    /// <summary>
    /// The delivery mode (1=non-persistent, 2=persistent).
    /// </summary>
    [JsonPropertyName("delivery_mode")]
    public int? DeliveryMode { get; set; }

    /// <summary>
    /// The message priority.
    /// </summary>
    [JsonPropertyName("priority")]
    public int? Priority { get; set; }

    /// <summary>
    /// The correlation ID.
    /// </summary>
    [JsonPropertyName("correlation_id")]
    public string? CorrelationId { get; set; }

    /// <summary>
    /// The reply-to queue.
    /// </summary>
    [JsonPropertyName("reply_to")]
    public string? ReplyTo { get; set; }

    /// <summary>
    /// The message expiration in milliseconds.
    /// </summary>
    [JsonPropertyName("expiration")]
    public string? Expiration { get; set; }

    /// <summary>
    /// The message ID.
    /// </summary>
    [JsonPropertyName("message_id")]
    public string? MessageId { get; set; }

    /// <summary>
    /// The message timestamp.
    /// </summary>
    [JsonPropertyName("timestamp")]
    public long? Timestamp { get; set; }

    /// <summary>
    /// The message type.
    /// </summary>
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    /// <summary>
    /// The user ID.
    /// </summary>
    [JsonPropertyName("user_id")]
    public string? UserId { get; set; }

    /// <summary>
    /// The app ID.
    /// </summary>
    [JsonPropertyName("app_id")]
    public string? AppId { get; set; }

    /// <summary>
    /// The cluster ID.
    /// </summary>
    [JsonPropertyName("cluster_id")]
    public string? ClusterId { get; set; }
}

#endregion

#region Management API Request Models

/// <summary>
/// Request to create a queue.
/// </summary>
internal class ManagementQueueCreateRequest
{
    [JsonPropertyName("durable")]
    public bool Durable { get; set; }

    [JsonPropertyName("auto_delete")]
    public bool AutoDelete { get; set; }

    [JsonPropertyName("arguments")]
    public Dictionary<string, object> Arguments { get; set; } = new();
}

/// <summary>
/// Request to create an exchange.
/// </summary>
internal class ManagementExchangeCreateRequest
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "direct";

    [JsonPropertyName("durable")]
    public bool Durable { get; set; }

    [JsonPropertyName("auto_delete")]
    public bool AutoDelete { get; set; }

    [JsonPropertyName("internal")]
    public bool Internal { get; set; }

    [JsonPropertyName("arguments")]
    public Dictionary<string, object> Arguments { get; set; } = new();
}

/// <summary>
/// Request to create a binding.
/// </summary>
internal class ManagementBindingCreateRequest
{
    [JsonPropertyName("routing_key")]
    public string RoutingKey { get; set; } = string.Empty;

    [JsonPropertyName("arguments")]
    public Dictionary<string, object> Arguments { get; set; } = new();
}

/// <summary>
/// Request to get messages from a queue.
/// </summary>
internal class ManagementGetMessagesRequest
{
    [JsonPropertyName("count")]
    public int Count { get; set; } = 10;

    [JsonPropertyName("ackmode")]
    public string AckMode { get; set; } = "ack_requeue_true";

    [JsonPropertyName("encoding")]
    public string Encoding { get; set; } = "auto";
}

/// <summary>
/// Request to publish a message to an exchange.
/// </summary>
internal class ManagementPublishRequest
{
    [JsonPropertyName("routing_key")]
    public string RoutingKey { get; set; } = string.Empty;

    [JsonPropertyName("payload")]
    public string Payload { get; set; } = string.Empty;

    [JsonPropertyName("payload_encoding")]
    public string PayloadEncoding { get; set; } = "string";

    [JsonPropertyName("properties")]
    public Dictionary<string, object> Properties { get; set; } = new();
}

#endregion
