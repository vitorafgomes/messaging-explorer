using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Services;

/// <summary>
/// Null-object <see cref="IMetricsService"/> used when the AzureMonitor configuration
/// section is missing or incomplete. Every call throws <see cref="InvalidOperationException"/>
/// with a message containing "not properly configured" so that <c>MetricsController</c>
/// translates it into a 503 response.
/// </summary>
public sealed class UnconfiguredMetricsService : IMetricsService
{
    private const string NotConfiguredMessage =
        "Azure Monitor metrics service is not properly configured. " +
        "Populate the AzureMonitor section (SubscriptionId, ResourceGroup, Namespace) in appsettings.";

    public Task<MetricsData> GetQueueMetricsAsync(
        string queueName,
        MetricsTimeRange timeRange,
        CancellationToken cancellationToken = default)
        => throw new InvalidOperationException(NotConfiguredMessage);

    public Task<MetricsData> GetTopicMetricsAsync(
        string topicName,
        MetricsTimeRange timeRange,
        CancellationToken cancellationToken = default)
        => throw new InvalidOperationException(NotConfiguredMessage);

    public Task<MetricsData> GetSubscriptionMetricsAsync(
        string topicName,
        string subscriptionName,
        MetricsTimeRange timeRange,
        CancellationToken cancellationToken = default)
        => throw new InvalidOperationException(NotConfiguredMessage);
}
