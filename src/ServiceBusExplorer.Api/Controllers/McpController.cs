using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>
/// What the MCP server group of Settings reads and changes, the requests of assistants waiting for the user's
/// answer, and those waiting for the app to read or change its settings. It answers the token once, at creation, and never its hash.
/// </summary>
[ApiController]
[Route("api/mcp")]
public class McpController(
    McpSettingsStore settings,
    McpActivityLog activity,
    McpRequests requests,
    McpAppRequests appRequests,
    IConnectionManager connections,
    IConnectionGroupManager groups) : ControllerBase
{
    /// <summary>The answer when never asked is asked for a connection that is not a broker on this computer, or is production.</summary>
    public const string NeverAskRefused = "Only a broker on this computer can be marked as never asked.";

    /// <summary>The state of the MCP server.</summary>
    [HttpGet]
    public async Task<ActionResult<McpState>> Get() => Ok(await StateAsync());

    /// <summary>Turns the MCP server on or off.</summary>
    [HttpPut("enabled")]
    public async Task<ActionResult<McpState>> SetEnabled([FromBody] McpEnabledRequest request)
    {
        settings.SetEnabled(request.Enabled);
        if (!request.Enabled) EndAllWaiting();
        return Ok(await StateAsync());
    }

    /// <summary>Creates a token, which replaces the one before it, and answers it this once.</summary>
    [HttpPost("token")]
    public async Task<ActionResult<McpTokenCreated>> CreateToken()
    {
        var token = settings.CreateToken();
        EndAllWaiting();
        return Ok(new McpTokenCreated(token, await StateAsync()));
    }

    /// <summary>
    /// Offers a stored connection to assistants at a level, a production one included, and marks it as never asked or
    /// not; an omitted mark keeps the one it had. Only a broker on this computer that is not production can be marked.
    /// </summary>
    [HttpPut("connections/{id}")]
    public async Task<ActionResult<McpState>> Offer(string id, [FromBody] McpOfferRequest request)
    {
        if (await connections.GetConnectionAsync(id) is not { } connection)
            return NotFound(new { message = "No stored connection has this id." });
        if (request.Level is null || !McpSettingsStore.Levels.Contains(request.Level))
            return BadRequest(new { message = "level must be read, readAndSend or all." });
        if (request.NeverAsk == true && !(await McpToolCalls.ProtectionAsync(groups, connection)).CanNeverAsk)
            return BadRequest(new { message = NeverAskRefused });

        settings.Offer(id, request.Level, request.NeverAsk);
        return Ok(await StateAsync());
    }

    /// <summary>Stops offering a connection; one that is not offered changes nothing.</summary>
    [HttpDelete("connections/{id}")]
    public async Task<ActionResult<McpState>> Withdraw(string id)
    {
        settings.Withdraw([id]);
        return Ok(await StateAsync());
    }

    /// <summary>Allows or refuses the read_logs tool.</summary>
    [HttpPut("logs")]
    public async Task<ActionResult<McpState>> SetLogsAllowed([FromBody] McpLogsRequest request)
    {
        settings.SetLogsAllowed(request.Allowed);
        return Ok(await StateAsync());
    }

    /// <summary>Allows or refuses the tools that read and change settings of the app; a body without allowed is 400.</summary>
    [HttpPut("app-settings")]
    public async Task<ActionResult<McpState>> SetAppSettingsAllowed([FromBody] McpAppSettingsRequest request)
    {
        if (request.Allowed is not { } allowed) return BadRequest(new { message = "allowed must be true or false." });
        settings.SetAppSettingsAllowed(allowed);
        if (!allowed) appRequests.EndAll();
        return Ok(await StateAsync());
    }

    /// <summary>The requests of assistants waiting for the app to read or change its settings, oldest first.</summary>
    [HttpGet("app-requests")]
    public ActionResult<IReadOnlyList<McpAppRequest>> GetAppRequests() => Ok(appRequests.Waiting());

    /// <summary>The answer of the app to a body that does not say what it did and what its settings are.</summary>
    public const string InvalidAppAnswer = "The answer is not valid.";

    /// <summary>
    /// The app's answer to a waiting request; 404 when it is not waiting any more or the user does not allow these tools;
    /// 400 when the body is not valid, and the request keeps waiting.
    /// </summary>
    [HttpPost("app-requests/{id}/answer")]
    public IActionResult AnswerAppRequest(string id, [FromBody] McpAppAnswer answer)
    {
        if (!settings.Current.AppSettingsAllowed) return NotFound(new { message = NotWaitingAnswer });
        if (!McpAppRequests.IsValid(answer)) return BadRequest(new { message = InvalidAppAnswer });
        return appRequests.Answer(id, answer) ? NoContent() : NotFound(new { message = NotWaitingAnswer });
    }

    private const string NotWaitingAnswer = "This request is no longer waiting.";

    /// <summary>Ends every request waiting for the user or for the app; each tool that waited is refused and does nothing.</summary>
    private void EndAllWaiting()
    {
        requests.EndAll();
        appRequests.EndAll();
    }

    /// <summary>The requests of assistants waiting for the user's answer, oldest first.</summary>
    [HttpGet("requests")]
    public ActionResult<IReadOnlyList<McpPendingRequest>> GetRequests() => Ok(requests.Waiting());

    /// <summary>The answer when an allow does not carry the word the request asks for, typed exactly.</summary>
    public const string WrongWord = "Type the name exactly as shown to allow this.";

    /// <summary>
    /// Allows or denies a waiting request; 404 when it is not waiting any more, 400 when an allow does not carry the word
    /// the request asks for, typed exactly, and the request keeps waiting.
    /// </summary>
    [HttpPost("requests/{id}/answer")]
    public IActionResult AnswerRequest(string id, [FromBody] McpAnswerRequest answer) => requests.Answer(id, answer.Allow, answer.Typed) switch
    {
        McpAnswerResult.Answered => NoContent(),
        McpAnswerResult.WrongWord => BadRequest(new { message = WrongWord }),
        _ => NotFound(new { message = "No request with this id is waiting." }),
    };

    /// <summary>The tool calls of assistants since the API started, newest first.</summary>
    [HttpGet("activity")]
    public ActionResult<IReadOnlyList<McpActivity>> GetActivity() => Ok(activity.Newest());

    /// <summary>Forgets the tool calls recorded.</summary>
    [HttpDelete("activity")]
    public IActionResult ClearActivity()
    {
        activity.Clear();
        return NoContent();
    }

    private async Task<McpState> StateAsync()
    {
        var current = settings.Current;
        var offered = new List<McpOfferedConnection>();
        foreach (var (connectionId, level) in current.Connections)
        {
            var (production, canNeverAsk) = await connections.GetConnectionAsync(connectionId) is { } connection
                ? await McpToolCalls.ProtectionAsync(groups, connection)
                : (false, false);
            offered.Add(new McpOfferedConnection(connectionId, level, production, canNeverAsk, canNeverAsk && current.NeverAsk.Contains(connectionId)));
        }

        return new McpState(
            current.Enabled,
            settings.EndpointUrl,
            current.TokenHash is not null,
            current.TokenCreatedAt,
            McpSettingsStore.Levels,
            new McpSupports(Logs: true, AppSettings: true, Confirmation: true, Entities: true),
            current.LogsAllowed,
            current.AppSettingsAllowed,
            offered);
    }
}

/// <summary>The body of PUT api/mcp/enabled.</summary>
public sealed record McpEnabledRequest(bool Enabled);

/// <summary>The body of PUT api/mcp/logs.</summary>
public sealed record McpLogsRequest(bool Allowed);

/// <summary>The body of PUT api/mcp/app-settings; a missing <paramref name="Allowed"/> is refused.</summary>
public sealed record McpAppSettingsRequest(bool? Allowed);

/// <summary>The body of PUT api/mcp/connections/{id}; a null <paramref name="NeverAsk"/> keeps the mark the connection had.</summary>
public sealed record McpOfferRequest(string? Level, bool? NeverAsk = null);

/// <summary>The body of POST api/mcp/requests/{id}/answer; <paramref name="Typed"/> is the word an allow carries when the request asks for one.</summary>
public sealed record McpAnswerRequest(bool Allow, string? Typed = null);

/// <summary>The answer of POST api/mcp/token: the plain token, this one time, and the state.</summary>
public sealed record McpTokenCreated(string Token, McpState State);

/// <summary>What this version of the MCP server can do.</summary>
public sealed record McpSupports(bool Logs, bool AppSettings, bool Confirmation, bool Entities);

/// <summary>
/// A connection offered to assistants: its level, whether it is production, whether it can be marked as never asked
/// (a broker on this computer, not production) and whether it is, which is never true while it cannot be.
/// </summary>
public sealed record McpOfferedConnection(string ConnectionId, string Level, bool Production, bool CanNeverAsk, bool NeverAsk);

/// <summary>The state of the MCP server as Settings shows it. It never carries the token or its hash.</summary>
public sealed record McpState(
    bool Enabled,
    string Url,
    bool HasToken,
    DateTimeOffset? TokenCreatedAt,
    IReadOnlyList<string> Levels,
    McpSupports Supports,
    bool LogsAllowed,
    bool AppSettingsAllowed,
    IReadOnlyList<McpOfferedConnection> Connections);
