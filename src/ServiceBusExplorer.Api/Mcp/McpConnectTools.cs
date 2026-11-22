using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>
/// connect_to: an assistant asks to make an offered connection the active one in the app. The user is always asked,
/// whatever the connection's never-asked mark and whether or not a connection is active; only after the allow, and
/// only while the connection is still offered, the app connects as the connect route does.
/// </summary>
[McpServerToolType]
public sealed class McpConnectTools(
    McpSettingsStore settings,
    McpToolCalls calls,
    IConnectionManager connections,
    IConnectionGroupManager groups,
    IProviderFactory providerFactory,
    ILogger<McpConnectTools> logger)
{
    /// <summary>The answer when no offered connection has the id or the name given; it names nothing.</summary>
    public const string NotOffered = "No offered connection has that id or name.";

    /// <summary>The answer when a name matches more than one offered connection.</summary>
    public const string Ambiguous = "More than one offered connection has that name. Use its id from list_connections.";

    /// <summary>How a request names an active connection the user did not offer.</summary>
    public const string UnofferedActive = "A connection not offered to assistants";

    /// <summary>Makes an offered connection the active one, after the user allows it in the app.</summary>
    [McpServerTool(Name = "connect_to", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Connect to an offered connection")]
    [Description("Makes a connection the user offered the active one in the app. The user is always asked in the app first and may deny it; once connected, every screen of the app shows it and anything running on the connection active before is interrupted. Answers { connected, connection, providerType }, or { connected, connection, alreadyActive } when it is already active.")]
    public Task<CallToolResult> ConnectTo(
        McpServer server,
        [Description("The id or the exact name of an offered connection, as list_connections answers them.")] string connection,
        [Description("Why you want to connect to it; the user sees it. Required.")] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, "Connect to a connection", logger, async call =>
    {
        McpToolCalls.RequireReason(call, reason);
        var target = await OfferedAsync(call, connection);
        call.Asked = $"Connect to {target.Name}";

        var (activeProvider, activeId) = ConnectionsController.GetCurrent();
        if (activeProvider is not null && activeId == target.Id)
        {
            call.Kind = "plain";
            call.Outcome = "Already active";
            return new { connected = true, connection = target.Name, alreadyActive = true };
        }

        var to = await calls.OnAsync(target);
        var active = activeProvider is null ? null
            : settings.LevelOf(activeId) is not null && await connections.GetConnectionAsync(activeId!) is { } stored ? stored : null;
        var from = activeProvider is null ? "No connection is active" : active is null ? UnofferedActive : await calls.OnAsync(active);
        var activeName = active?.Name ?? UnofferedActive.ToLowerInvariant();
        var note = activeProvider is null
            ? $"Every screen of the app then shows {target.Name}."
            : $"The app disconnects from {activeName}. Every screen then shows {target.Name}, and anything running on {activeName} is interrupted.";
        if ((await McpToolCalls.ProtectionAsync(groups, target)).Production) note = "This is a production connection. " + note;

        await calls.AskUserAsync(
            call,
            "connect",
            $"{call.Assistant} asks to connect to {target.Name}",
            [new McpFact("From", from), new McpFact("To", to), new McpFact("It said why", McpToolCalls.Reason(reason))],
            note,
            $"Connect to {target.Name}",
            cancellationToken);

        if (settings.LevelOf(target.Id) is null)
            call.Refuse(NotOffered, "Refused: not offered");
        call.Allowed = true;

        var result = await ConnectionsController.ConnectStoredAsync(target.Id, connections, providerFactory, logger);
        if (!result.Found)
            call.Refuse(NotOffered, "Refused: not offered");
        if (result.Provider is null)
            call.Refuse(result.Failure!.Value.Message, "Failed, allowed by you");

        call.Outcome = "Connected";
        return new { connected = true, connection = target.Name, providerType = result.Provider.ProviderType.ToString() };
    });

    /// <summary>
    /// The offered connection whose id is <paramref name="connection"/>, else the one offered connection with that exact
    /// name; otherwise the call is refused with <see cref="NotOffered"/> or <see cref="Ambiguous"/>. The connection read
    /// is masked.
    /// </summary>
    private async Task<ServiceBusConnection> OfferedAsync(McpToolCalls.ToolCall call, string? connection)
    {
        var offered = settings.Current.Connections;
        var stored = (await connections.GetConnectionsAsync()).Where(c => offered.ContainsKey(c.Id)).ToList();
        if (stored.FirstOrDefault(c => c.Id == connection) is { } byId)
            return byId;
        var named = stored.Where(c => c.Name == connection).ToList();
        if (named.Count > 1)
            call.Refuse(Ambiguous, "Refused: more than one with that name");
        if (named.Count == 0)
            call.Refuse(NotOffered, "Refused: not offered");
        return named[0];
    }
}
