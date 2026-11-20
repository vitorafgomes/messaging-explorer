using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>The active offered connection a tool acts on, read once before the tool asks the user or calls the provider.</summary>
/// <param name="Provider">The provider in the slot when the tool started.</param>
/// <param name="Connection">The stored connection, masked.</param>
/// <param name="Level">The level it is offered at.</param>
/// <param name="Production">True when its environment is marked as production.</param>
/// <param name="NeverAsk">True when the user marked it as never asked and it is on this computer and not production.</param>
public sealed record McpActive(IMessagingProvider Provider, ServiceBusConnection Connection, string Level, bool Production, bool NeverAsk);

/// <summary>
/// What the tools of the reading and the sending phases share: every call recorded in <see cref="McpActivityLog"/>
/// however it ended, a refusal answered as an error result, the active offered connection, and the request to the user
/// in the app before an operation that must ask.
/// </summary>
public sealed class McpToolCalls(
    McpSettingsStore settings,
    McpActivityLog activity,
    McpRequests requests,
    IConnectionManager connections,
    IConnectionGroupManager groups)
{
    /// <summary>The answer when the user denied the request.</summary>
    public const string DeniedSentence = "The user denied this request.";

    /// <summary>The answer when the user did not answer in time.</summary>
    public const string NoAnswerSentence = "The user did not answer in two minutes, so the request was denied.";

    /// <summary>The answer when <see cref="McpRequests.Capacity"/> requests already wait.</summary>
    public const string TooManySentence = "Too many requests are waiting for the user. Try again after they answer.";

    /// <summary>What a request to read a production connection tells the user.</summary>
    public const string ProductionReadNote = "This is a production connection. What is read is sent to the assistant and to the company that runs it.";

    /// <summary>How many characters of the reason an assistant gives are shown.</summary>
    public const int MaxReasonLength = 200;

    private const string AllowedSuffix = ", allowed by you";

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    /// <summary>
    /// Runs one tool call and records it. A refusal and a broker failure are answered as an error result with a fixed
    /// sentence, never thrown and never the broker's text; a failure keeps its own Warning line in <paramref name="logger"/>.
    /// </summary>
    public async Task<CallToolResult> RunAsync(McpServer server, string asked, ILogger logger, Func<ToolCall, Task<object?>> work)
    {
        var call = new ToolCall { Assistant = Clean(server.ClientInfo?.Name, 100) is { Length: > 0 } name ? name : "Assistant" };
        void Record(string kind) => activity.Add(new McpActivity(DateTimeOffset.UtcNow, call.Assistant, call.Asked ?? asked, call.Where, call.Outcome, kind));

        try
        {
            var answer = await work(call);
            if (call.Allowed) call.Outcome += AllowedSuffix;
            Record(call.Kind);
            return Answer(JsonSerializer.Serialize(answer, JsonOptions), isError: false);
        }
        catch (McpException refused)
        {
            Record("error");
            return Answer(refused.Message, isError: true);
        }
        catch (OperationCanceledException)
        {
            call.Outcome = "Cancelled";
            Record("error");
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "An MCP tool call failed: {Asked} ({ExceptionType})", asked, ex.GetType().Name);
            call.Outcome = call.Allowed ? "Failed" + AllowedSuffix : "Failed";
            Record("error");
            return Answer(FailureSentence(ex), isError: true);
        }
    }

    /// <summary>
    /// The active connection when the user offered it, at either level; otherwise the call is refused with
    /// <see cref="McpReadTools.NotOffered"/>, which names no connection. <paramref name="entity"/> goes into the record
    /// cut at 100 characters.
    /// </summary>
    public async Task<McpActive> ActiveAsync(ToolCall call, string? entity = null)
    {
        var (provider, connectionId) = ConnectionsController.GetCurrent();
        var level = settings.LevelOf(connectionId);
        if (provider is null || level is null)
            call.Refuse(McpReadTools.NotOffered, "Refused: not offered");
        var connection = await connections.GetConnectionAsync(connectionId!);
        if (connection is null)
            call.Refuse(McpReadTools.NotOffered, "Refused: not offered");
        var (production, canNeverAsk) = await ProtectionAsync(groups, connection);
        call.Where = entity is null ? connection.Name : $"{Clean(entity, 100)} on {connection.Name}";
        return new McpActive(provider, connection, level, production, canNeverAsk && settings.IsNeverAsk(connectionId));
    }

    /// <summary>
    /// When a production connection is active, asks the user before a read and waits for the answer; otherwise does
    /// nothing. <paramref name="what"/> is the end of the title, such as "list the queues".
    /// </summary>
    public async Task AskToReadAsync(ToolCall call, McpActive active, string what, McpFact? entity, string? reason, CancellationToken cancellationToken)
    {
        if (!active.Production) return;
        List<McpFact> facts = entity is null ? [] : [entity];
        facts.Add(new McpFact("On", await OnAsync(active.Connection)));
        facts.Add(new McpFact("It said why", Reason(reason)));
        await AskAsync(call, active, "read", $"{call.Assistant} asks to {what}", facts, ProductionReadNote, "Allow this read", McpSettingsStore.ReadLevel, cancellationToken);
    }

    /// <summary>
    /// Shows a request to the user and waits. Denied, unanswered or refused for too many waiting, the call is refused
    /// with its sentence. Allowed, the call goes on only while the same provider and connection are active and still
    /// offered at a level that covers <paramref name="needed"/>. A <paramref name="typed"/> word must be typed by the
    /// user before the app takes the allow.
    /// </summary>
    public async Task AskAsync(ToolCall call, McpActive active, string kind, string title, IReadOnlyList<McpFact> facts, string note, string allowLabel, string needed, CancellationToken cancellationToken, bool danger = false, McpTyped? typed = null)
    {
        await AskUserAsync(call, kind, title, facts, note, allowLabel, cancellationToken, danger, typed);
        var (provider, connectionId) = ConnectionsController.GetCurrent();
        if (!ReferenceEquals(provider, active.Provider) || connectionId != active.Connection.Id
            || !McpSettingsStore.Covers(settings.LevelOf(connectionId), needed))
            call.Refuse(McpReadTools.NotOffered, "Refused: not offered");
        call.Allowed = true;
    }

    /// <summary>
    /// Shows a request to the user and waits; returns only when the user allowed it and the call was not cancelled.
    /// Denied, unanswered or refused for too many waiting, the call is refused with its sentence. What must still hold
    /// after the allow is the caller's to check.
    /// </summary>
    public async Task AskUserAsync(ToolCall call, string kind, string title, IReadOnlyList<McpFact> facts, string note, string allowLabel, CancellationToken cancellationToken, bool danger = false, McpTyped? typed = null)
    {
        switch (await requests.AskAsync(call.Assistant, kind, title, facts, note, allowLabel, cancellationToken, danger, typed))
        {
            case McpAnswer.Denied:
                call.Refuse(DeniedSentence, "Denied by you");
                break;
            case McpAnswer.NoAnswer:
                call.Refuse(NoAnswerSentence, "Denied: no answer in two minutes");
                break;
            case McpAnswer.TooMany:
                call.Refuse(TooManySentence, "Refused: too many waiting");
                break;
        }

        cancellationToken.ThrowIfCancellationRequested();
    }

    /// <summary>Where the connection is, as a request shows it: its name, then its client and environment when it has them.</summary>
    public async Task<string> OnAsync(ServiceBusConnection connection)
    {
        var parts = new List<string>();
        if (connection.ClientId is { } clientId && await groups.GetGroupAsync(clientId) is { } client) parts.Add(client.Name);
        if (connection.EnvironmentId is { } environmentId && await groups.GetGroupAsync(environmentId) is { } environment) parts.Add(environment.Name);
        return parts.Count == 0 ? connection.Name : $"{connection.Name} ({string.Join(", ", parts)})";
    }

    /// <summary>The reason an assistant gave, without control characters and cut at <see cref="MaxReasonLength"/>, or "It gave no reason".</summary>
    public static string Reason(string? reason) => Clean(reason, MaxReasonLength) is { Length: > 0 } kept ? kept : "It gave no reason";

    /// <summary>
    /// Whether <paramref name="connection"/> is of an environment marked as production, and whether it can be marked as
    /// never asked: only when it is not production and its broker is on this computer.
    /// </summary>
    public static async Task<(bool Production, bool CanNeverAsk)> ProtectionAsync(IConnectionGroupManager groups, ServiceBusConnection connection)
    {
        var production = connection.EnvironmentId is { } environmentId && (await groups.GetGroupAsync(environmentId))?.IsProduction == true;
        return (production, !production && IsLoopbackHost(HostOf(connection)));
    }

    /// <summary>
    /// The host the connection reaches: for RabbitMQ its host name, localhost when none is set as the provider does; for
    /// Azure Service Bus the endpoint host of the connection string, which the masked connection carries as its
    /// namespace, or the fully qualified namespace of the other sign-ins.
    /// </summary>
    public static string? HostOf(ServiceBusConnection connection) => connection.ProviderType switch
    {
        ProviderType.RabbitMQ => connection.HostName ?? "localhost",
        _ when (connection.AuthType ?? AzureAuthType.ConnectionString) == AzureAuthType.ConnectionString => connection.Namespace,
        _ => connection.FullyQualifiedNamespace,
    };

    /// <summary>
    /// True when <paramref name="host"/> is this computer: localhost in any letter case, an address of 127.0.0.0/8, or
    /// ::1 with or without brackets. A name that only starts with localhost is not.
    /// </summary>
    public static bool IsLoopbackHost(string? host)
    {
        var value = host?.Trim() ?? "";
        if (value.Length > 2 && value[0] == '[' && value[^1] == ']') value = value[1..^1];
        return value.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || (IPAddress.TryParse(value, out var address) && IPAddress.IsLoopback(address));
    }

    /// <summary>Text an assistant supplied, without control characters, trimmed and cut at <paramref name="max"/> characters.</summary>
    public static string Clean(string? text, int max)
    {
        var kept = new string((text ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        return kept.Length > max ? kept[..max] : kept;
    }

    /// <summary>The message of a fixed answer of <see cref="EntityAdministrationResults"/>.</summary>
    internal static string MessageOf(ObjectResult result) =>
        (string)result.Value!.GetType().GetProperty("message")!.GetValue(result.Value)!;

    private static string FailureSentence(Exception ex) => ex switch
    {
        EntityDisabledException => MessageOf(EntityAdministrationResults.EntityDisabled()),
        MessageReadFailedException or InvalidEntityConfigurationException => ex.Message,
        EntityNotFoundException => MessageOf(EntityAdministrationResults.NotFound("entity")),
        _ => MessageOf(EntityAdministrationResults.Unhandled(ex)),
    };

    /// <summary>
    /// An answer the SDK hands on as it is: a refusal or a failure returned as an error result, never thrown, is not
    /// logged by the SDK as an unhandled exception and carries no prefix before its sentence.
    /// </summary>
    private static CallToolResult Answer(string text, bool isError) => new() { IsError = isError, Content = [new TextContentBlock { Text = text }] };

    /// <summary>Who called, where a call acts and how it ended, filled in as the call goes.</summary>
    public sealed class ToolCall
    {
        /// <summary>The client's name, or "Assistant".</summary>
        public string Assistant { get; init; } = "Assistant";

        /// <summary>What was asked, set by a tool that knows it only once it resolved its target; null keeps what the call started with.</summary>
        public string? Asked { get; set; }

        /// <summary>The entity and the offered connection, or "This app".</summary>
        public string Where { get; set; } = "This app";

        /// <summary>What happened, in words.</summary>
        public string Outcome { get; set; } = "Refused";

        /// <summary>"ok", "plain" or "error", as <see cref="McpActivity.Kind"/>.</summary>
        public string Kind { get; set; } = "ok";

        /// <summary>True once the user allowed the call in the app.</summary>
        public bool Allowed { get; set; }

        /// <summary>Ends the call with <paramref name="sentence"/> as its answer and <paramref name="outcome"/> in the record.</summary>
        [System.Diagnostics.CodeAnalysis.DoesNotReturn]
        public void Refuse(string sentence, string outcome)
        {
            Outcome = outcome;
            throw new McpException(sentence);
        }
    }
}
