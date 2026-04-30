namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Request model for fetching Azure Monitor metrics for a Service Bus entity.
/// </summary>
public class MetricsRequest
{
    /// <summary>
    /// Name of the Service Bus entity (queue, topic, or subscription name).
    /// </summary>
    public string EntityName { get; set; } = string.Empty;

    /// <summary>
    /// Type of the Service Bus entity.
    /// </summary>
    public EntityType EntityType { get; set; }

    /// <summary>
    /// Time range for the metrics query.
    /// </summary>
    public MetricsTimeRange TimeRange { get; set; }

    /// <summary>
    /// For subscriptions, the parent topic name.
    /// </summary>
    public string? TopicName { get; set; }
}

/// <summary>
/// Defines the supported time ranges for metrics queries.
/// </summary>
public enum MetricsTimeRange
{
    /// <summary>
    /// Last 1 hour of metrics data.
    /// </summary>
    OneHour = 0,

    /// <summary>
    /// Last 6 hours of metrics data.
    /// </summary>
    SixHours = 1,

    /// <summary>
    /// Last 12 hours of metrics data.
    /// </summary>
    TwelveHours = 2,

    /// <summary>
    /// Last 24 hours of metrics data.
    /// </summary>
    TwentyFourHours = 3,

    /// <summary>
    /// Last 7 days of metrics data.
    /// </summary>
    SevenDays = 4
}

/// <summary>
/// Defines the types of Service Bus entities for metrics queries.
/// </summary>
public enum EntityType
{
    /// <summary>
    /// Service Bus Queue.
    /// </summary>
    Queue = 0,

    /// <summary>
    /// Service Bus Topic.
    /// </summary>
    Topic = 1,

    /// <summary>
    /// Service Bus Subscription.
    /// </summary>
    Subscription = 2
}
