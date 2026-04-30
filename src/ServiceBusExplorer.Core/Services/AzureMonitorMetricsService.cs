using Azure;
using Azure.Core;
using Azure.Identity;
using Azure.Monitor.Query;
using Azure.Monitor.Query.Models;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Services;

/// <summary>
/// Implementation of <see cref="IMetricsService"/> that fetches Service Bus metrics from Azure Monitor.
/// Uses the Azure.Monitor.Query SDK to retrieve time-series metrics data for queues, topics, and subscriptions.
/// Implements caching to reduce API calls and improve performance.
/// </summary>
public class AzureMonitorMetricsService : IMetricsService
{
    private readonly ILogger<AzureMonitorMetricsService> _logger;
    private readonly IMemoryCache _cache;
    private readonly MetricsQueryClient? _metricsClient;
    private readonly string? _subscriptionId;
    private readonly string? _resourceGroup;
    private readonly string? _namespace;
    private readonly bool _isConfigured;

    // Cache duration: 30 seconds to balance between freshness and API throttling
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);

    // Azure Monitor metric names for Service Bus
    private const string IncomingMessagesMetric = "IncomingMessages";
    private const string OutgoingMessagesMetric = "OutgoingMessages";
    private const string ActiveMessagesMetric = "ActiveMessages";
    private const string SuccessfulRequestsMetric = "SuccessfulRequests";
    private const string ServerErrorsMetric = "ServerErrors";
    private const string UserErrorsMetric = "UserErrors";

    /// <summary>
    /// Initializes a new instance of the <see cref="AzureMonitorMetricsService"/> class.
    /// </summary>
    /// <param name="subscriptionId">Azure subscription ID containing the Service Bus namespace.</param>
    /// <param name="resourceGroup">Azure resource group containing the Service Bus namespace.</param>
    /// <param name="namespace">Service Bus namespace name.</param>
    /// <param name="credential">Optional Azure credential. If null, DefaultAzureCredential will be used.</param>
    /// <param name="cache">Memory cache for storing metrics data.</param>
    /// <param name="logger">Optional logger for structured logging.</param>
    public AzureMonitorMetricsService(
        string? subscriptionId,
        string? resourceGroup,
        string? @namespace,
        TokenCredential? credential = null,
        IMemoryCache? cache = null,
        ILogger<AzureMonitorMetricsService>? logger = null)
    {
        _logger = logger ?? NullLogger<AzureMonitorMetricsService>.Instance;
        _cache = cache ?? new MemoryCache(new MemoryCacheOptions());
        _subscriptionId = subscriptionId;
        _resourceGroup = resourceGroup;
        _namespace = @namespace;

        // Check if service is properly configured
        _isConfigured = !string.IsNullOrWhiteSpace(_subscriptionId)
                     && !string.IsNullOrWhiteSpace(_resourceGroup)
                     && !string.IsNullOrWhiteSpace(_namespace);

        if (_isConfigured)
        {
            try
            {
                // Use provided credential or fall back to DefaultAzureCredential
                var azureCredential = credential ?? new DefaultAzureCredential();
                _metricsClient = new MetricsQueryClient(azureCredential);
                _logger.LogInformation(
                    "AzureMonitorMetricsService initialized for namespace {Namespace} in resource group {ResourceGroup}",
                    _namespace, _resourceGroup);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to initialize MetricsQueryClient. Metrics will be unavailable.");
                _isConfigured = false;
            }
        }
        else
        {
            _logger.LogWarning(
                "AzureMonitorMetricsService not configured. Missing: {Missing}",
                string.Join(", ",
                    new[] {
                        string.IsNullOrWhiteSpace(subscriptionId) ? "subscriptionId" : null,
                        string.IsNullOrWhiteSpace(resourceGroup) ? "resourceGroup" : null,
                        string.IsNullOrWhiteSpace(@namespace) ? "namespace" : null
                    }.Where(x => x != null)));
        }
    }

    /// <inheritdoc />
    public async Task<MetricsData> GetQueueMetricsAsync(
        string queueName,
        MetricsTimeRange timeRange,
        CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var cacheKey = $"queue:{queueName}:{timeRange}";
        if (_cache.TryGetValue<MetricsData>(cacheKey, out var cachedData) && cachedData != null)
        {
            _logger.LogDebug("Returning cached metrics for queue {QueueName}", queueName);
            return cachedData;
        }

        var resourceId = BuildResourceId("queues", queueName);
        var metricsData = await FetchMetricsAsync(resourceId, timeRange, cancellationToken);

        // Cache the result
        _cache.Set(cacheKey, metricsData, CacheDuration);

        return metricsData;
    }

    /// <inheritdoc />
    public async Task<MetricsData> GetTopicMetricsAsync(
        string topicName,
        MetricsTimeRange timeRange,
        CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var cacheKey = $"topic:{topicName}:{timeRange}";
        if (_cache.TryGetValue<MetricsData>(cacheKey, out var cachedData) && cachedData != null)
        {
            _logger.LogDebug("Returning cached metrics for topic {TopicName}", topicName);
            return cachedData;
        }

        var resourceId = BuildResourceId("topics", topicName);
        var metricsData = await FetchMetricsAsync(resourceId, timeRange, cancellationToken);

        // Cache the result
        _cache.Set(cacheKey, metricsData, CacheDuration);

        return metricsData;
    }

    /// <inheritdoc />
    public async Task<MetricsData> GetSubscriptionMetricsAsync(
        string topicName,
        string subscriptionName,
        MetricsTimeRange timeRange,
        CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var cacheKey = $"subscription:{topicName}:{subscriptionName}:{timeRange}";
        if (_cache.TryGetValue<MetricsData>(cacheKey, out var cachedData) && cachedData != null)
        {
            _logger.LogDebug("Returning cached metrics for subscription {SubscriptionName}", subscriptionName);
            return cachedData;
        }

        var resourceId = BuildResourceId($"topics/{topicName}/subscriptions", subscriptionName);
        var metricsData = await FetchMetricsAsync(resourceId, timeRange, cancellationToken);

        // Cache the result
        _cache.Set(cacheKey, metricsData, CacheDuration);

        return metricsData;
    }

    /// <summary>
    /// Fetches metrics from Azure Monitor for the specified resource.
    /// </summary>
    private async Task<MetricsData> FetchMetricsAsync(
        string resourceId,
        MetricsTimeRange timeRange,
        CancellationToken cancellationToken)
    {
        if (_metricsClient == null)
        {
            throw new InvalidOperationException("Metrics client is not initialized.");
        }

        var (startTime, endTime, granularity) = GetTimeRangeParameters(timeRange);

        try
        {
            _logger.LogDebug(
                "Fetching metrics for resource {ResourceId} from {StartTime} to {EndTime}",
                resourceId, startTime, endTime);

            // Fetch all required metrics in parallel
            var metrics = new List<string>
            {
                IncomingMessagesMetric,
                OutgoingMessagesMetric,
                ActiveMessagesMetric,
                SuccessfulRequestsMetric,
                ServerErrorsMetric,
                UserErrorsMetric
            };

            var response = await _metricsClient.QueryResourceAsync(
                resourceId,
                metrics,
                new MetricsQueryOptions
                {
                    TimeRange = new QueryTimeRange(startTime, endTime),
                    Granularity = granularity
                },
                cancellationToken);

            return MapToMetricsData(response.Value, startTime, endTime);
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            _logger.LogWarning(ex, "Resource not found: {ResourceId}", resourceId);
            return CreateEmptyMetricsData(startTime, endTime);
        }
        catch (RequestFailedException ex)
        {
            _logger.LogError(ex, "Failed to fetch metrics from Azure Monitor: {ErrorCode}", ex.ErrorCode);
            throw new InvalidOperationException($"Failed to fetch metrics from Azure Monitor: {ex.Message}", ex);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error while fetching metrics");
            throw;
        }
    }

    /// <summary>
    /// Maps Azure Monitor query result to our MetricsData model.
    /// </summary>
    private MetricsData MapToMetricsData(MetricsQueryResult result, DateTimeOffset startTime, DateTimeOffset endTime)
    {
        var metricsData = new MetricsData
        {
            StartTime = startTime,
            EndTime = endTime,
            Series = new List<MetricsSeries>()
        };

        foreach (var metric in result.Metrics)
        {
            foreach (var timeSeries in metric.TimeSeries)
            {
                var series = new MetricsSeries
                {
                    Name = GetFriendlyMetricName(metric.Name),
                    Data = new List<MetricsDataPoint>()
                };

                foreach (var dataPoint in timeSeries.Values)
                {
                    // Use Total aggregation if available, otherwise use Average
                    var value = dataPoint.Total ?? dataPoint.Average ?? 0;

                    series.Data.Add(new MetricsDataPoint
                    {
                        Timestamp = dataPoint.TimeStamp,
                        Value = value
                    });
                }

                metricsData.Series.Add(series);
            }
        }

        return metricsData;
    }

    /// <summary>
    /// Creates an empty MetricsData object for when no data is available.
    /// </summary>
    private MetricsData CreateEmptyMetricsData(DateTimeOffset startTime, DateTimeOffset endTime)
    {
        return new MetricsData
        {
            StartTime = startTime,
            EndTime = endTime,
            Series = new List<MetricsSeries>()
        };
    }

    /// <summary>
    /// Gets friendly display name for Azure Monitor metric names.
    /// </summary>
    private string GetFriendlyMetricName(string metricName)
    {
        return metricName switch
        {
            IncomingMessagesMetric => "Incoming Messages",
            OutgoingMessagesMetric => "Outgoing Messages",
            ActiveMessagesMetric => "Active Messages",
            SuccessfulRequestsMetric => "Successful Requests",
            ServerErrorsMetric => "Server Errors",
            UserErrorsMetric => "User Errors",
            _ => metricName
        };
    }

    /// <summary>
    /// Calculates the time range parameters based on the specified MetricsTimeRange.
    /// </summary>
    private (DateTimeOffset StartTime, DateTimeOffset EndTime, TimeSpan? Granularity) GetTimeRangeParameters(
        MetricsTimeRange timeRange)
    {
        var endTime = DateTimeOffset.UtcNow;
        DateTimeOffset startTime;
        TimeSpan? granularity;

        switch (timeRange)
        {
            case MetricsTimeRange.OneHour:
                startTime = endTime.AddHours(-1);
                granularity = TimeSpan.FromMinutes(1);
                break;

            case MetricsTimeRange.SixHours:
                startTime = endTime.AddHours(-6);
                granularity = TimeSpan.FromMinutes(5);
                break;

            case MetricsTimeRange.TwelveHours:
                startTime = endTime.AddHours(-12);
                granularity = TimeSpan.FromMinutes(15);
                break;

            case MetricsTimeRange.TwentyFourHours:
                startTime = endTime.AddHours(-24);
                granularity = TimeSpan.FromMinutes(30);
                break;

            case MetricsTimeRange.SevenDays:
                startTime = endTime.AddDays(-7);
                granularity = TimeSpan.FromHours(1);
                break;

            default:
                throw new ArgumentException($"Unsupported time range: {timeRange}", nameof(timeRange));
        }

        return (startTime, endTime, granularity);
    }

    /// <summary>
    /// Builds the Azure resource ID for the specified Service Bus entity.
    /// </summary>
    private string BuildResourceId(string entityType, string entityName)
    {
        return $"/subscriptions/{_subscriptionId}/resourceGroups/{_resourceGroup}/providers/Microsoft.ServiceBus/namespaces/{_namespace}/{entityType}/{entityName}";
    }

    /// <summary>
    /// Ensures the service is properly configured before making API calls.
    /// </summary>
    private void EnsureConfigured()
    {
        if (!_isConfigured)
        {
            throw new InvalidOperationException(
                "Azure Monitor metrics service is not properly configured. " +
                "Please provide subscriptionId, resourceGroup, and namespace.");
        }
    }
}
