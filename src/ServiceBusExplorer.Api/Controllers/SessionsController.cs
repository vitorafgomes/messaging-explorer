using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>
/// The sessions of a queue or a subscription: a passive list that locks nothing, and one session opened at a time for
/// its state, its messages or a state write, released before the answer. Every failure is <c>{ "message": ... }</c>
/// with text this application authored.
/// </summary>
[ApiController, RawTargetRouteValues]
public class SessionsController : ControllerBase
{
    private const string QueueBase = "/api/queues/{name}/sessions";
    private const string SubscriptionBase = "/api/topics/{topicName}/subscriptions/{subscriptionName}/sessions";

    private readonly ILogger<SessionsController> _logger;

    public SessionsController(ILogger<SessionsController> logger)
    {
        _logger = logger;
    }

    private static IMessagingProvider? GetProvider() => ConnectionsController.GetCurrentProvider();

    [HttpGet(QueueBase)]
    public Task<ActionResult<SessionList>> GetQueueSessions(string name, [FromQuery] int maxMessages = 1000) =>
        List(name, null, maxMessages);

    [HttpGet(SubscriptionBase)]
    public Task<ActionResult<SessionList>> GetSubscriptionSessions(string topicName, string subscriptionName, [FromQuery] int maxMessages = 1000) =>
        List(topicName, subscriptionName, maxMessages);

    [HttpGet(QueueBase + "/{sessionId}")]
    public Task<ActionResult<SessionDetail>> GetQueueSession(string name, string sessionId, [FromQuery] int messageCount = 0) =>
        Run(name, null, sessionId, "read", (p, ct) => p.GetSessionAsync(name, null, sessionId, Math.Clamp(messageCount, 0, 1000), ct));

    [HttpGet(SubscriptionBase + "/{sessionId}")]
    public Task<ActionResult<SessionDetail>> GetSubscriptionSession(string topicName, string subscriptionName, string sessionId, [FromQuery] int messageCount = 0) =>
        Run(topicName, subscriptionName, sessionId, "read", (p, ct) => p.GetSessionAsync(topicName, subscriptionName, sessionId, Math.Clamp(messageCount, 0, 1000), ct));

    [HttpGet(QueueBase + "/{sessionId}/messages")]
    public Task<ActionResult<IEnumerable<IMessage>>> PeekQueueSessionMessages(string name, string sessionId, [FromQuery] int count = 10) =>
        Run(name, null, sessionId, "peek", (p, ct) => p.PeekSessionMessagesAsync(name, null, sessionId, Math.Clamp(count, 1, 1000), ct));

    [HttpGet(SubscriptionBase + "/{sessionId}/messages")]
    public Task<ActionResult<IEnumerable<IMessage>>> PeekSubscriptionSessionMessages(string topicName, string subscriptionName, string sessionId, [FromQuery] int count = 10) =>
        Run(topicName, subscriptionName, sessionId, "peek", (p, ct) => p.PeekSessionMessagesAsync(topicName, subscriptionName, sessionId, Math.Clamp(count, 1, 1000), ct));

    [HttpPut(QueueBase + "/{sessionId}/state")]
    public Task<ActionResult<SessionDetail>> SetQueueSessionState(
        string name, string sessionId, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] SetSessionStateRequest? request) =>
        SetState(name, null, sessionId, request);

    [HttpPut(SubscriptionBase + "/{sessionId}/state")]
    public Task<ActionResult<SessionDetail>> SetSubscriptionSessionState(
        string topicName, string subscriptionName, string sessionId, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] SetSessionStateRequest? request) =>
        SetState(topicName, subscriptionName, sessionId, request);

    private Task<ActionResult<SessionList>> List(string entityName, string? subscriptionName, int maxMessages) =>
        Run(entityName, subscriptionName, null, "list",
            (p, ct) => p.GetSessionsAsync(entityName, subscriptionName, Math.Clamp(maxMessages, 1, 5000), ct));

    private async Task<ActionResult<SessionDetail>> SetState(string entityName, string? subscriptionName, string sessionId, SetSessionStateRequest? request)
    {
        if (request?.State.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
        {
            return BadRequest(new { message = "state is required: the new state, or null to clear it." });
        }

        if (request.ExpectedState.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
        {
            return BadRequest(new { message = "expectedState is required: the state that was read, or null when the session had none." });
        }

        var state = request.State.ValueKind == JsonValueKind.String ? request.State.GetString() : null;
        var expectedState = request.ExpectedState.ValueKind == JsonValueKind.String ? request.ExpectedState.GetString() : null;
        return await Run(entityName, subscriptionName, sessionId, "state write",
            (p, ct) => p.SetSessionStateAsync(entityName, subscriptionName, sessionId, state, expectedState, ct));
    }

    private async Task<ActionResult<T>> Run<T>(
        string entityName, string? subscriptionName, string? sessionId, string operation, Func<IMessagingProvider, CancellationToken, Task<T>> call)
    {
        var provider = GetProvider();
        if (provider == null)
            return BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (!provider.Capabilities.SupportsSessions)
            return SessionsNotSupported();

        try
        {
            return Ok(await call(provider, HttpContext.RequestAborted));
        }
        catch (NotSupportedException)
        {
            return SessionsNotSupported();
        }
        catch (Exception ex) when (ex is SessionsNotEnabledException or BinarySessionStateException or InvalidEntityConfigurationException)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (EntityNotFoundException)
        {
            return EntityAdministrationResults.NotFound(subscriptionName == null ? "queue" : "subscription");
        }
        catch (SessionInUseException ex)
        {
            return Conflict(new { message = ex.Message, code = "SessionInUse" });
        }
        catch (SessionStateChangedException ex)
        {
            return Conflict(new { message = ex.Message, code = "SessionStateChanged" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Session {Operation} failed for {EntityPath} session {SessionId}",
                operation, subscriptionName == null ? entityName : $"{entityName}/{subscriptionName}", sessionId);
            return StatusCode(500, new { message = EntityAdministrationResults.InternalError });
        }
    }

    private BadRequestObjectResult SessionsNotSupported() => BadRequest(new { message = "This provider does not support sessions." });
}

/// <summary>A session state write: the new state, null to clear it, and the state the caller was shown.</summary>
public class SetSessionStateRequest
{
    /// <summary>Required: a string, or null to clear the state. Absent is <see cref="JsonValueKind.Undefined"/>.</summary>
    public JsonElement State { get; set; }

    /// <summary>Required: a string, or null when the session had no state. Absent is <see cref="JsonValueKind.Undefined"/>.</summary>
    public JsonElement ExpectedState { get; set; }
}
