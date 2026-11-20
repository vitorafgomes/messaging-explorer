using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>What the MCP server group of Settings reads and changes. It answers the token once, at creation, and never its hash.</summary>
[ApiController]
[Route("api/mcp")]
public class McpController(
    McpSettingsStore settings,
    McpActivityLog activity,
    IConnectionManager connections,
    IConnectionGroupManager groups) : ControllerBase
{
    /// <summary>The answer when the connection to offer is in an environment marked as production.</summary>
    public const string ProductionRefused = "A production connection can be offered once the app can ask you before each operation.";

    /// <summary>The state of the MCP server.</summary>
    [HttpGet]
    public ActionResult<McpState> Get() => Ok(State());

    /// <summary>Turns the MCP server on or off.</summary>
    [HttpPut("enabled")]
    public ActionResult<McpState> SetEnabled([FromBody] McpEnabledRequest request)
    {
        settings.SetEnabled(request.Enabled);
        return Ok(State());
    }

    /// <summary>Creates a token, which replaces the one before it, and answers it this once.</summary>
    [HttpPost("token")]
    public ActionResult<McpTokenCreated> CreateToken()
    {
        var token = settings.CreateToken();
        return Ok(new McpTokenCreated(token, State()));
    }

    /// <summary>Offers a stored connection to assistants at a level this version supports.</summary>
    [HttpPut("connections/{id}")]
    public async Task<ActionResult<McpState>> Offer(string id, [FromBody] McpOfferRequest request)
    {
        if (await connections.GetConnectionAsync(id) is not { } connection)
            return NotFound(new { message = "No stored connection has this id." });
        if (request.Level != McpSettingsStore.ReadLevel)
            return BadRequest(new { message = "This version offers a connection at the level read only." });
        if (await McpReadTools.IsProductionAsync(groups, connection))
            return Conflict(new { message = ProductionRefused });

        settings.Offer(id, request.Level);
        return Ok(State());
    }

    /// <summary>Stops offering a connection; one that is not offered changes nothing.</summary>
    [HttpDelete("connections/{id}")]
    public ActionResult<McpState> Withdraw(string id)
    {
        settings.Withdraw([id]);
        return Ok(State());
    }

    /// <summary>Allows or refuses the read_logs tool.</summary>
    [HttpPut("logs")]
    public ActionResult<McpState> SetLogsAllowed([FromBody] McpLogsRequest request)
    {
        settings.SetLogsAllowed(request.Allowed);
        return Ok(State());
    }

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

    private McpState State()
    {
        var current = settings.Current;
        return new McpState(
            current.Enabled,
            settings.EndpointUrl,
            current.TokenHash is not null,
            current.TokenCreatedAt,
            [McpSettingsStore.ReadLevel],
            new McpSupports(Logs: true, AppSettings: false, Confirmation: false),
            current.LogsAllowed,
            current.Connections.Select(c => new McpOfferedConnection(c.Key, c.Value)).ToList());
    }
}

/// <summary>The body of PUT api/mcp/enabled.</summary>
public sealed record McpEnabledRequest(bool Enabled);

/// <summary>The body of PUT api/mcp/logs.</summary>
public sealed record McpLogsRequest(bool Allowed);

/// <summary>The body of PUT api/mcp/connections/{id}.</summary>
public sealed record McpOfferRequest(string? Level);

/// <summary>The answer of POST api/mcp/token: the plain token, this one time, and the state.</summary>
public sealed record McpTokenCreated(string Token, McpState State);

/// <summary>What this version of the MCP server can do.</summary>
public sealed record McpSupports(bool Logs, bool AppSettings, bool Confirmation);

/// <summary>A connection offered to assistants and its level.</summary>
public sealed record McpOfferedConnection(string ConnectionId, string Level);

/// <summary>The state of the MCP server as Settings shows it. It never carries the token or its hash.</summary>
public sealed record McpState(
    bool Enabled,
    string Url,
    bool HasToken,
    DateTimeOffset? TokenCreatedAt,
    IReadOnlyList<string> Levels,
    McpSupports Supports,
    bool LogsAllowed,
    IReadOnlyList<McpOfferedConnection> Connections);
