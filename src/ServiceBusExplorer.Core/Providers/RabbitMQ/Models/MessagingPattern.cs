namespace ServiceBusExplorer.Core.Providers.RabbitMQ.Models;

/// <summary>
/// RabbitMQ/AMQP messaging patterns from official tutorials.
/// Reference: https://www.rabbitmq.com/tutorials
/// </summary>
public enum MessagingPattern
{
    /// <summary>
    /// No specific pattern detected or pattern cannot be determined.
    /// </summary>
    None = 0,

    /// <summary>
    /// Hello World: Single producer, single queue, single consumer.
    /// Simplest pattern - direct exchange with one binding.
    /// </summary>
    HelloWorld = 1,

    /// <summary>
    /// Work Queues (Task Queue): Multiple consumers competing for messages.
    /// Single queue with multiple consumers for load distribution.
    /// </summary>
    WorkQueue = 2,

    /// <summary>
    /// Publish/Subscribe: Fanout exchange broadcasting to multiple queues.
    /// All bound queues receive all messages.
    /// </summary>
    PubSub = 3,

    /// <summary>
    /// Routing: Direct exchange with selective message routing.
    /// Messages routed based on specific routing keys.
    /// </summary>
    Routing = 4,

    /// <summary>
    /// Topics: Topic exchange with wildcard routing patterns.
    /// Messages routed based on routing key patterns (* and #).
    /// </summary>
    Topics = 5,

    /// <summary>
    /// RPC (Request/Reply): Two queues for bidirectional communication.
    /// Uses correlation IDs and reply-to headers.
    /// </summary>
    RPC = 6,

    /// <summary>
    /// Publisher Confirms: Reliable publishing with acknowledgments.
    /// Exchange configured with publisher confirmation mode.
    /// </summary>
    PublisherConfirms = 7
}

/// <summary>
/// Pattern detection result with confidence scoring.
/// </summary>
public class PatternDetectionResult
{
    /// <summary>
    /// The detected messaging pattern.
    /// </summary>
    public MessagingPattern Pattern { get; set; } = MessagingPattern.None;

    /// <summary>
    /// Confidence score (0.0 to 1.0) indicating detection accuracy.
    /// 1.0 = definite match, 0.9+ = high confidence, 0.7+ = medium, 0.5+ = low.
    /// </summary>
    public double Confidence { get; set; }

    /// <summary>
    /// Human-readable explanation of why this pattern was detected.
    /// </summary>
    public string Reason { get; set; } = string.Empty;

    /// <summary>
    /// Additional metadata about the pattern characteristics.
    /// May include consumer counts, routing key patterns, binding details, etc.
    /// </summary>
    public Dictionary<string, object> Metadata { get; set; } = new();
}

/// <summary>
/// Exchange pattern information including detected patterns.
/// </summary>
public class ExchangePatternInfo
{
    /// <summary>
    /// The exchange name.
    /// </summary>
    public string ExchangeName { get; set; } = string.Empty;

    /// <summary>
    /// The exchange type (direct, fanout, topic, headers).
    /// </summary>
    public string ExchangeType { get; set; } = string.Empty;

    /// <summary>
    /// The primary detected pattern for this exchange.
    /// </summary>
    public PatternDetectionResult PrimaryPattern { get; set; } = new();

    /// <summary>
    /// Secondary patterns that may also apply to this exchange.
    /// For example, an exchange may use both Routing and Publisher Confirms.
    /// </summary>
    public List<PatternDetectionResult> SecondaryPatterns { get; set; } = new();
}

/// <summary>
/// Queue pattern information including detected patterns.
/// </summary>
public class QueuePatternInfo
{
    /// <summary>
    /// The queue name.
    /// </summary>
    public string QueueName { get; set; } = string.Empty;

    /// <summary>
    /// The primary detected pattern for this queue.
    /// </summary>
    public PatternDetectionResult PrimaryPattern { get; set; } = new();

    /// <summary>
    /// List of exchanges that have bindings to this queue.
    /// Useful for understanding the queue's role in the messaging topology.
    /// </summary>
    public List<string> RelatedExchanges { get; set; } = new();
}
