using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Api.Monitoring;

namespace ServiceBusExplorer.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class MonitoringController : ControllerBase
{
    private readonly MonitoringStore _store;
    private readonly IConfiguration _configuration;
    private readonly ILogger<MonitoringController> _logger;

    public MonitoringController(MonitoringStore store, IConfiguration configuration, ILogger<MonitoringController> logger)
    {
        _store = store;
        _configuration = configuration;
        _logger = logger;
    }

    [HttpGet("snapshot")]
    public ActionResult<MonitoringStatus> GetSnapshot()
    {
        return Ok(new MonitoringStatus
        {
            Snapshot = _store.GetLatest(),
            PollIntervalSeconds = (int)MonitoringBackgroundService.ReadInterval(_configuration).TotalSeconds,
            LastPollFailedAt = _store.LastFailureAt
        });
    }

    [HttpGet("history")]
    public ActionResult GetHistory([FromQuery] int count = 20)
    {
        if (count < 1) count = 1;
        if (count > 120) count = 120;

        var history = _store.GetHistory(count);
        return Ok(history);
    }

    /// <summary>
    /// Reads the counts of one queue (<c>?queue=</c>) or one subscription (<c>?topic=&amp;subscription=</c>) from the
    /// broker now, outside the poll.
    /// </summary>
    [HttpGet("counts")]
    public async Task<ActionResult> GetCounts([FromQuery] string? queue, [FromQuery] string? topic, [FromQuery] string? subscription, CancellationToken cancellationToken)
    {
        var isQueue = !string.IsNullOrEmpty(queue) && string.IsNullOrEmpty(topic) && string.IsNullOrEmpty(subscription);
        var isSubscription = string.IsNullOrEmpty(queue) && !string.IsNullOrEmpty(topic) && !string.IsNullOrEmpty(subscription);
        if (!isQueue && !isSubscription)
            return BadRequest(new { message = "Name either a queue, or a topic and one of its subscriptions." });

        var provider = ConnectionsController.GetCurrentProvider();
        if (provider == null)
            return BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });

        try
        {
            if (isQueue)
            {
                var read = await provider.GetQueueCountsAsync(queue!, cancellationToken);
                return read == null
                    ? NotFound(new { message = "The queue was not found." })
                    : Ok(MonitoringEntityDto.FromQueue(read, provider.Capabilities));
            }

            var counts = await provider.GetSubscriptionCountsAsync(topic!, subscription!, cancellationToken);
            return counts == null
                ? NotFound(new { message = "The subscription was not found." })
                : Ok(MonitoringSubscriptionDto.FromSubscription(topic!, counts, provider.Capabilities));
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogError(ex, "Reading the counts of {Entity} failed", isQueue ? queue : $"{topic}/subscriptions/{subscription}");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "An internal error occurred." });
        }
    }
}
