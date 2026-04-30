using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>
/// Controller for fetching Azure Monitor metrics for Service Bus entities.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class MetricsController : ControllerBase
{
    private readonly IMetricsService _metricsService;
    private readonly ILogger<MetricsController> _logger;

    public MetricsController(IMetricsService metricsService, ILogger<MetricsController> logger)
    {
        _metricsService = metricsService;
        _logger = logger;
    }

    /// <summary>
    /// Gets Azure Monitor metrics for a specific queue.
    /// </summary>
    /// <param name="queueName">Name of the queue to fetch metrics for.</param>
    /// <param name="timeRange">Time range for the metrics query (default: 1 hour).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Metrics data containing time series for the specified queue.</returns>
    [HttpGet("queues/{queueName}")]
    public async Task<ActionResult<MetricsData>> GetQueueMetrics(
        string queueName,
        [FromQuery] MetricsTimeRange timeRange = MetricsTimeRange.OneHour,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(queueName))
        {
            return BadRequest(new { message = "Queue name is required." });
        }

        try
        {
            _logger.LogInformation("Fetching metrics for queue '{QueueName}' with time range '{TimeRange}'", queueName, timeRange);
            var metrics = await _metricsService.GetQueueMetricsAsync(queueName, timeRange, cancellationToken);
            return Ok(metrics);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("not properly configured"))
        {
            _logger.LogWarning(ex, "Azure Monitor metrics not configured");
            return StatusCode(503, new {
                message = "Azure Monitor metrics are not configured.",
                configurationRequired = true
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching metrics for queue '{QueueName}'", queueName);
            return StatusCode(500, new { message = "Failed to fetch queue metrics." });
        }
    }

    /// <summary>
    /// Gets Azure Monitor metrics for a specific topic.
    /// </summary>
    /// <param name="topicName">Name of the topic to fetch metrics for.</param>
    /// <param name="timeRange">Time range for the metrics query (default: 1 hour).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Metrics data containing time series for the specified topic.</returns>
    [HttpGet("topics/{topicName}")]
    public async Task<ActionResult<MetricsData>> GetTopicMetrics(
        string topicName,
        [FromQuery] MetricsTimeRange timeRange = MetricsTimeRange.OneHour,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(topicName))
        {
            return BadRequest(new { message = "Topic name is required." });
        }

        try
        {
            _logger.LogInformation("Fetching metrics for topic '{TopicName}' with time range '{TimeRange}'", topicName, timeRange);
            var metrics = await _metricsService.GetTopicMetricsAsync(topicName, timeRange, cancellationToken);
            return Ok(metrics);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("not properly configured"))
        {
            _logger.LogWarning(ex, "Azure Monitor metrics not configured");
            return StatusCode(503, new {
                message = "Azure Monitor metrics are not configured.",
                configurationRequired = true
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching metrics for topic '{TopicName}'", topicName);
            return StatusCode(500, new { message = "Failed to fetch topic metrics." });
        }
    }

    /// <summary>
    /// Gets Azure Monitor metrics for a specific subscription.
    /// </summary>
    /// <param name="topicName">Name of the parent topic.</param>
    /// <param name="subscriptionName">Name of the subscription to fetch metrics for.</param>
    /// <param name="timeRange">Time range for the metrics query (default: 1 hour).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Metrics data containing time series for the specified subscription.</returns>
    [HttpGet("topics/{topicName}/subscriptions/{subscriptionName}")]
    public async Task<ActionResult<MetricsData>> GetSubscriptionMetrics(
        string topicName,
        string subscriptionName,
        [FromQuery] MetricsTimeRange timeRange = MetricsTimeRange.OneHour,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(topicName))
        {
            return BadRequest(new { message = "Topic name is required." });
        }

        if (string.IsNullOrWhiteSpace(subscriptionName))
        {
            return BadRequest(new { message = "Subscription name is required." });
        }

        try
        {
            _logger.LogInformation(
                "Fetching metrics for subscription '{SubscriptionName}' on topic '{TopicName}' with time range '{TimeRange}'",
                subscriptionName, topicName, timeRange);

            var metrics = await _metricsService.GetSubscriptionMetricsAsync(topicName, subscriptionName, timeRange, cancellationToken);
            return Ok(metrics);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("not properly configured"))
        {
            _logger.LogWarning(ex, "Azure Monitor metrics not configured");
            return StatusCode(503, new {
                message = "Azure Monitor metrics are not configured.",
                configurationRequired = true
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching metrics for subscription '{SubscriptionName}' on topic '{TopicName}'", subscriptionName, topicName);
            return StatusCode(500, new { message = "Failed to fetch subscription metrics." });
        }
    }
}
