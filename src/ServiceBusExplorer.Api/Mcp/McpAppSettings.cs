using System.ComponentModel;
using System.Text.Json.Serialization;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>A request of an assistant waiting for the app to read or change one of its settings.</summary>
/// <param name="Id">The id the answer names.</param>
/// <param name="Time">When the assistant asked.</param>
/// <param name="Assistant">The client's name as it gave it, or "Assistant".</param>
/// <param name="Setting">"theme", "developerMode" or "updateChannel"; null asks only for the settings.</param>
/// <param name="Value">The value to set, one of <see cref="McpAppRequests.Changeable"/>; null when only reading.</param>
public sealed record McpAppRequest(
    string Id,
    [property: JsonConverter(typeof(McpUtcTimeConverter))] DateTimeOffset Time,
    string Assistant,
    string? Setting,
    string? Value);

/// <summary>The settings of the app as the app reports them; updateChannel null means the web build, which has no updates.</summary>
public sealed record McpAppSettingsValues(string? Theme, bool? DeveloperMode, string? UpdateChannel);

/// <summary>The body of POST api/mcp/app-requests/{id}/answer.</summary>
/// <param name="Applied">True when the app did what was asked.</param>
/// <param name="Code">Null, "desktopOnly" or "failed".</param>
/// <param name="Settings">The settings after the request, required.</param>
public sealed record McpAppAnswer(bool? Applied, string? Code, McpAppSettingsValues? Settings);

/// <summary>
/// The requests of assistants waiting for the app to read or change its settings, in memory, at most
/// <see cref="Capacity"/>. A tool waits <see cref="DefaultWait"/> in the app; the request is removed once answered,
/// expired or cancelled by the tool's token.
/// </summary>
public sealed class McpAppRequests(TimeSpan wait)
{
    /// <summary>How many requests may wait at once.</summary>
    public const int Capacity = 20;

    /// <summary>How long a tool waits for the app in the app.</summary>
    public static readonly TimeSpan DefaultWait = TimeSpan.FromSeconds(10);

    /// <summary>The settings an assistant may change and the values each takes. Nothing else is ever handed to the app.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> Changeable = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        ["theme"] = ["system", "light", "dark"],
        ["developerMode"] = ["on", "off"],
        ["updateChannel"] = ["latest", "beta"],
    };

    private readonly Lock _lock = new();
    private readonly List<(McpAppRequest Request, TaskCompletionSource<McpAppAnswer> Answer)> _waiting = [];

    /// <summary>The requests waiting, oldest first.</summary>
    public IReadOnlyList<McpAppRequest> Waiting()
    {
        lock (_lock) { return _waiting.Select(w => w.Request).ToList(); }
    }

    /// <summary>
    /// True when <paramref name="answer"/> says whether it was applied, carries no code but "desktopOnly" or "failed",
    /// and reports a theme, Developer mode and an update channel each of its fixed values.
    /// </summary>
    public static bool IsValid(McpAppAnswer? answer) =>
        answer is { Applied: not null, Code: null or "desktopOnly" or "failed", Settings: { Theme: { } theme, DeveloperMode: not null } settings }
        && Changeable["theme"].Contains(theme)
        && (settings.UpdateChannel is null || Changeable["updateChannel"].Contains(settings.UpdateChannel));

    /// <summary>Answers a waiting request; false when no request with <paramref name="id"/> is waiting.</summary>
    public bool Answer(string id, McpAppAnswer answer)
    {
        TaskCompletionSource<McpAppAnswer> waiting;
        lock (_lock)
        {
            var index = _waiting.FindIndex(w => w.Request.Id == id);
            if (index < 0) return false;
            waiting = _waiting[index].Answer;
            _waiting.RemoveAt(index);
        }
        waiting.TrySetResult(answer);
        return true;
    }

    /// <summary>
    /// Hands a request to the app and waits for its answer. Waited is false when <see cref="Capacity"/> already wait;
    /// Answer is null when the app did not answer in time. A cancelled <paramref name="cancellationToken"/> removes the
    /// request and throws.
    /// </summary>
    public async Task<(bool Waited, McpAppAnswer? Answer)> AskAsync(string assistant, string? setting, string? value, CancellationToken cancellationToken)
    {
        var answer = new TaskCompletionSource<McpAppAnswer>(TaskCreationOptions.RunContinuationsAsynchronously);
        McpAppRequest request;
        lock (_lock)
        {
            if (_waiting.Count >= Capacity) return (false, null);
            request = new McpAppRequest(Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow, assistant, setting, value);
            _waiting.Add((request, answer));
        }

        try
        {
            return (true, await answer.Task.WaitAsync(wait, cancellationToken));
        }
        catch (TimeoutException)
        {
            lock (_lock) { _waiting.RemoveAll(w => w.Request.Id == request.Id); }
            return (true, answer.Task.IsCompleted ? await answer.Task : null);
        }
        finally
        {
            lock (_lock) { _waiting.RemoveAll(w => w.Request.Id == request.Id); }
        }
    }
}

/// <summary>
/// The tools that read and change settings of the app: the theme, Developer mode and the update channel. They need no
/// connection and answer only while the user allowed them in Settings; that choice is the consent, so no change is
/// asked about, and every call is recorded in <see cref="McpActivityLog"/>. The settings live in the screen and the
/// desktop shell, so each call hands a request to the app and waits for its answer.
/// </summary>
[McpServerToolType]
public sealed class McpAppSettingsTools(
    McpSettingsStore settings,
    McpToolCalls calls,
    McpAppRequests requests,
    ILogger<McpAppSettingsTools> logger)
{
    /// <summary>The answer while the user has not allowed these tools.</summary>
    public const string NotAllowed = "The user has not let assistants change settings of this app. The user can change that in Settings, MCP server.";

    /// <summary>The answer to a setting that is not on the fixed list.</summary>
    public const string NotASetting = "An assistant can change only: theme, developerMode, updateChannel.";

    /// <summary>The answer when the app did not answer in time.</summary>
    public const string NoAnswer = "The app did not answer. Its window may be closed.";

    /// <summary>The answer when the app said the setting exists only in the desktop app.</summary>
    public const string DesktopOnly = "This setting exists only in the desktop app.";

    /// <summary>The answer when the app could not change the setting.</summary>
    public const string NotChanged = "The app could not change this setting.";

    /// <summary>The settings of the app, as the app reports them.</summary>
    [McpServerTool(Name = "read_app_settings", ReadOnly = true, Title = "Read the settings of the app")]
    [Description("Reads the theme, Developer mode and the update channel of the app, as the app reports them. updateChannel null means the web build, which has no updates. Needs the user's permission in Settings.")]
    public Task<CallToolResult> ReadAppSettings(McpServer server, CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, "Read the settings of the app", logger, async call =>
        {
            if (!settings.Current.AppSettingsAllowed) call.Refuse(NotAllowed, "Refused: not allowed");
            var reported = await HandAsync(call, null, null, cancellationToken);
            call.Kind = "plain";
            call.Outcome = "Read";
            return new { settings = reported };
        });

    /// <summary>Changes one setting of the fixed list and answers the settings as the app reports them after.</summary>
    [McpServerTool(Name = "change_app_setting", ReadOnly = false, Destructive = false, Idempotent = true, Title = "Change a setting of the app")]
    [Description("Changes one setting of the app: theme (system, light, dark), developerMode (on, off) or updateChannel (latest, beta). Nothing else can be changed. Needs the user's permission in Settings.")]
    public Task<CallToolResult> ChangeAppSetting(
        McpServer server,
        [Description("theme, developerMode or updateChannel.")] string setting,
        [Description("theme: system, light or dark; developerMode: on or off; updateChannel: latest or beta.")] string value,
        [Description("Why you want to change it. Required.")] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, "Change a setting of the app", logger, async call =>
        {
            if (!settings.Current.AppSettingsAllowed) call.Refuse(NotAllowed, "Refused: not allowed");
            McpToolCalls.RequireReason(call, reason);
            if (!McpAppRequests.Changeable.TryGetValue(setting, out var values)) call.Refuse(NotASetting, "Refused: not a setting");
            if (!values.Contains(value, StringComparer.Ordinal))
                call.Refuse($"This value is not valid for {setting}. Valid: {string.Join(", ", values)}.", "Refused: not a value");
            call.Asked = $"Set {setting} to {value}";
            var reported = await HandAsync(call, setting, value, cancellationToken);
            call.Kind = "plain";
            call.Outcome = "Changed";
            return new { changed = new { setting, value }, settings = reported };
        });

    private async Task<McpAppSettingsValues> HandAsync(McpToolCalls.ToolCall call, string? setting, string? value, CancellationToken cancellationToken)
    {
        var (waited, answer) = await requests.AskAsync(call.Assistant, setting, value, cancellationToken);
        if (!waited) call.Refuse(McpToolCalls.TooManySentence, "Refused: too many waiting");
        if (answer is null) call.Refuse(NoAnswer, "Failed: the app did not answer");
        if (answer.Applied != true)
        {
            if (answer.Code == "desktopOnly") call.Refuse(DesktopOnly, "Failed: desktop only");
            call.Refuse(NotChanged, "Failed");
        }
        return answer.Settings!;
    }
}
