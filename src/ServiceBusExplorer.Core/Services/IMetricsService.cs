using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Services;

/// <summary>
/// Service interface for fetching Azure Monitor metrics for Service Bus entities.
/// </summary>
public interface IMetricsService
{
    /// <summary>
    /// Fetches Azure Monitor metrics for a specific queue.
    /// </summary>
    /// <param name="queueName">Name of the queue to fetch metrics for.</param>
    /// <param name="timeRange">Time range for the metrics query.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Metrics data containing time series for the specified queue.</returns>
    Task<MetricsData> GetQueueMetricsAsync(string queueName, MetricsTimeRange timeRange, CancellationToken cancellationToken = default);

    /// <summary>
    /// Fetches Azure Monitor metrics for a specific topic.
    /// </summary>
    /// <param name="topicName">Name of the topic to fetch metrics for.</param>
    /// <param name="timeRange">Time range for the metrics query.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Metrics data containing time series for the specified topic.</returns>
    Task<MetricsData> GetTopicMetricsAsync(string topicName, MetricsTimeRange timeRange, CancellationToken cancellationToken = default);

    /// <summary>
    /// Fetches Azure Monitor metrics for a specific subscription.
    /// </summary>
    /// <param name="topicName">Name of the parent topic.</param>
    /// <param name="subscriptionName">Name of the subscription to fetch metrics for.</param>
    /// <param name="timeRange">Time range for the metrics query.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Metrics data containing time series for the specified subscription.</returns>
    Task<MetricsData> GetSubscriptionMetricsAsync(string topicName, string subscriptionName, MetricsTimeRange timeRange, CancellationToken cancellationToken = default);
}
