namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Response model containing Azure Monitor metrics data with time series.
/// </summary>
public class MetricsData
{
    /// <summary>
    /// Collection of metric series (e.g., incoming messages, outgoing messages, active messages).
    /// </summary>
    public List<MetricsSeries> Series { get; set; } = new();

    /// <summary>
    /// Start time of the metrics data range.
    /// </summary>
    public DateTimeOffset StartTime { get; set; }

    /// <summary>
    /// End time of the metrics data range.
    /// </summary>
    public DateTimeOffset EndTime { get; set; }
}

/// <summary>
/// Represents a single metric series with name and data points.
/// </summary>
public class MetricsSeries
{
    /// <summary>
    /// Name of the metric (e.g., "Incoming Messages", "Outgoing Messages", "Active Messages").
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Collection of data points for this metric series.
    /// </summary>
    public List<MetricsDataPoint> Data { get; set; } = new();
}

/// <summary>
/// Represents a single data point in a metric series with timestamp and value.
/// </summary>
public class MetricsDataPoint
{
    /// <summary>
    /// Timestamp of the data point.
    /// </summary>
    public DateTimeOffset Timestamp { get; set; }

    /// <summary>
    /// Metric value at the given timestamp.
    /// </summary>
    public double Value { get; set; }
}
