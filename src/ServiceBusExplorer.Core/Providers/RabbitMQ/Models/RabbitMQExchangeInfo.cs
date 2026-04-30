using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Providers.RabbitMQ.Models;

/// <summary>
/// RabbitMQ exchange information implementing the abstract topic entity interface.
/// Exchanges in RabbitMQ are analogous to topics in Azure Service Bus.
/// </summary>
public class RabbitMQExchangeInfo : ITopicEntity
{
    // IMessagingEntity properties
    public string Name { get; set; } = string.Empty;
    public long SizeInBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset AccessedAt { get; set; }
    public string Status { get; set; } = string.Empty;
    public bool EnablePartitioning { get; set; }

    // ITopicEntity properties
    public int SubscriptionCount { get; set; }
    public long ScheduledMessageCount { get; set; }
    public TimeSpan DefaultMessageTimeToLive { get; set; }
    public TimeSpan AutoDeleteOnIdle { get; set; }
    public TimeSpan DuplicateDetectionHistoryTimeWindow { get; set; }
    public long MaxSizeInMegabytes { get; set; }
    public long MaxMessageSizeInKilobytes { get; set; }
    public bool RequiresDuplicateDetection { get; set; }
    public bool EnableBatchedOperations { get; set; }
    public bool SupportOrdering { get; set; }
    public bool EnableExpress { get; set; }
    public string UserMetadata { get; set; } = string.Empty;

    // RabbitMQ-specific properties

    /// <summary>
    /// The virtual host where this exchange is located.
    /// </summary>
    public string VirtualHost { get; set; } = "/";

    /// <summary>
    /// The type of the exchange.
    /// Common values: "direct", "fanout", "topic", "headers".
    /// </summary>
    public string ExchangeType { get; set; } = "direct";

    /// <summary>
    /// Indicates whether the exchange is durable (survives broker restart).
    /// </summary>
    public bool Durable { get; set; }

    /// <summary>
    /// Indicates whether the exchange will be automatically deleted when no longer in use.
    /// </summary>
    public bool AutoDelete { get; set; }

    /// <summary>
    /// Indicates whether this is an internal exchange.
    /// Internal exchanges cannot receive messages published by clients directly.
    /// </summary>
    public bool Internal { get; set; }

    /// <summary>
    /// The message delivery rate per second.
    /// </summary>
    public double MessageRateIn { get; set; }

    /// <summary>
    /// The message publish rate per second.
    /// </summary>
    public double MessageRateOut { get; set; }

    /// <summary>
    /// The number of queues bound to this exchange.
    /// </summary>
    public int BoundQueueCount { get; set; }

    /// <summary>
    /// The alternate exchange for unroutable messages.
    /// Messages that cannot be routed will be sent to this exchange.
    /// Null if no alternate exchange is configured.
    /// </summary>
    public string? AlternateExchange { get; set; }

    /// <summary>
    /// Exchange arguments/options as key-value pairs.
    /// Contains all custom exchange arguments set during declaration.
    /// </summary>
    public Dictionary<string, object> Arguments { get; set; } = new();

    /// <summary>
    /// The bindings associated with this exchange.
    /// Contains information about queues and other exchanges bound to this exchange.
    /// </summary>
    public List<RabbitMQBindingInfo> Bindings { get; set; } = new();

    /// <summary>
    /// Subscriptions mapped from bindings for frontend compatibility.
    /// Each binding is converted to a SubscriptionInfo for the UI tree view.
    /// </summary>
    public List<SubscriptionInfo> Subscriptions
    {
        get
        {
            return Bindings.Select(binding => new SubscriptionInfo
            {
                TopicName = Name,
                Name = binding.Destination,
                Status = "Active",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
                AccessedAt = DateTimeOffset.UtcNow,
                DefaultMessageTimeToLive = TimeSpan.Zero,
                AutoDeleteOnIdle = TimeSpan.Zero,
                LockDuration = TimeSpan.Zero,
                MaxDeliveryCount = 0,
                RequiresSession = false,
                DeadLetteringOnMessageExpiration = false,
                DeadLetteringOnFilterEvaluationExceptions = false,
                EnableBatchedOperations = false,
                ActiveMessageCount = 0,
                DeadLetterMessageCount = 0,
                TransferMessageCount = 0,
                ScheduledMessageCount = 0,
                TransferDeadLetterMessageCount = 0,
                Rules = new List<SubscriptionRuleInfo>
                {
                    new()
                    {
                        Name = "RoutingKey",
                        FilterType = "RoutingKey",
                        FilterExpression = binding.RoutingKey
                    }
                }
            }).ToList();
        }
    }

    /// <summary>
    /// Detected messaging pattern for this exchange.
    /// Automatically detected based on exchange type, bindings, and topology.
    /// </summary>
    public PatternDetectionResult? DetectedPattern { get; set; }

    /// <summary>
    /// Additional patterns that may apply to this exchange.
    /// An exchange may use multiple patterns simultaneously (e.g., Routing + Publisher Confirms).
    /// </summary>
    public List<PatternDetectionResult> SecondaryPatterns { get; set; } = new();
}

/// <summary>
/// Represents a binding in RabbitMQ connecting an exchange to a queue or another exchange.
/// </summary>
public class RabbitMQBindingInfo
{
    /// <summary>
    /// The source exchange name.
    /// </summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>
    /// The destination (queue or exchange name).
    /// </summary>
    public string Destination { get; set; } = string.Empty;

    /// <summary>
    /// The type of destination.
    /// Common values: "queue", "exchange".
    /// </summary>
    public string DestinationType { get; set; } = "queue";

    /// <summary>
    /// The routing key used for this binding.
    /// </summary>
    public string RoutingKey { get; set; } = string.Empty;

    /// <summary>
    /// The virtual host where this binding is located.
    /// </summary>
    public string VirtualHost { get; set; } = "/";

    /// <summary>
    /// Binding arguments/options as key-value pairs.
    /// Used for header exchange bindings and custom configurations.
    /// </summary>
    public Dictionary<string, object> Arguments { get; set; } = new();

    /// <summary>
    /// A unique key that identifies this binding (for use in API operations).
    /// </summary>
    public string? PropertiesKey { get; set; }
}
