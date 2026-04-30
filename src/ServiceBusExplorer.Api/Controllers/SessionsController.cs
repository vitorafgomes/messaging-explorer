using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SessionsController : ControllerBase
{
    private readonly ILogger<SessionsController> _logger;

    public SessionsController(ILogger<SessionsController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Gets the current messaging provider from ConnectionsController.
    /// Returns null if no provider is connected.
    /// </summary>
    private static IMessagingProvider? GetProvider() => ConnectionsController.GetCurrentProvider();

    /// <summary>
    /// Returns a BadRequest response indicating no provider is connected.
    /// </summary>
    private ActionResult NoProviderConnected()
    {
        return BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
    }

    [HttpGet("{entityName}")]
    public async Task<ActionResult<IEnumerable<SessionInfo>>> GetQueueSessions(
        string entityName, [FromQuery] int maxSessions = 50)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        if (!provider.Capabilities.SupportsSessions)
            return Ok(Enumerable.Empty<SessionInfo>());

        if (maxSessions < 1) maxSessions = 1;
        if (maxSessions > 100) maxSessions = 100;

        var sessions = await provider.GetSessionsAsync(entityName, maxSessions: maxSessions);
        return Ok(sessions);
    }

    [HttpGet("{topicName}/subscriptions/{subscriptionName}")]
    public async Task<ActionResult<IEnumerable<SessionInfo>>> GetSubscriptionSessions(
        string topicName, string subscriptionName, [FromQuery] int maxSessions = 50)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        if (!provider.Capabilities.SupportsSessions)
            return Ok(Enumerable.Empty<SessionInfo>());

        if (maxSessions < 1) maxSessions = 1;
        if (maxSessions > 100) maxSessions = 100;

        var sessions = await provider.GetSessionsAsync(topicName, subscriptionName, maxSessions);
        return Ok(sessions);
    }

    [HttpPut("{topicName}/subscriptions/{subscriptionName}/{sessionId}/state")]
    public async Task<ActionResult> SetSubscriptionSessionState(
        string topicName, string subscriptionName, string sessionId, [FromBody] SetSessionStateRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.SetSessionStateAsync(topicName, sessionId, request.State, subscriptionName);
            return Ok(new { success = true });
        }
        catch (NotSupportedException)
        {
            return BadRequest(new { message = "This provider does not support sessions." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Set subscription session state failed for {TopicName}/{SubscriptionName}/{SessionId}", topicName, subscriptionName, sessionId);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpPut("{entityName}/state/{sessionId}")]
    public async Task<ActionResult> SetQueueSessionState(
        string entityName, string sessionId, [FromBody] SetSessionStateRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.SetSessionStateAsync(entityName, sessionId, request.State);
            return Ok(new { success = true });
        }
        catch (NotSupportedException)
        {
            return BadRequest(new { message = "This provider does not support sessions." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Set queue session state failed for {EntityName}/{SessionId}", entityName, sessionId);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }
}

public class SetSessionStateRequest
{
    public string? State { get; set; }
}
