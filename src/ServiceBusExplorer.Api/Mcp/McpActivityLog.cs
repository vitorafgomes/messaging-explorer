namespace ServiceBusExplorer.Api.Mcp;

/// <summary>
/// One tool call of an assistant as the Settings screen shows it. It never carries a message body, a secret or the
/// name of a connection that is not offered.
/// </summary>
/// <param name="Time">When the call was answered.</param>
/// <param name="Assistant">The client's name as it gave it, or "Assistant".</param>
/// <param name="Asked">What was asked, in words.</param>
/// <param name="Where">The entity and the offered connection, or "This app".</param>
/// <param name="Outcome">What happened, in words.</param>
/// <param name="Kind">"ok" for a broker read that succeeded, "plain" for an answer that read no broker, "error" for a refusal or a failure.</param>
public sealed record McpActivity([property: System.Text.Json.Serialization.JsonConverter(typeof(McpUtcTimeConverter))] DateTimeOffset Time, string Assistant, string Asked, string Where, string Outcome, string Kind);

/// <summary>The tool calls of assistants since the API started, in memory only, the last <see cref="Capacity"/> kept.</summary>
public sealed class McpActivityLog
{
    /// <summary>How many calls are kept before the oldest is dropped.</summary>
    public const int Capacity = 500;

    private readonly Lock _lock = new();
    private readonly LinkedList<McpActivity> _entries = new();

    /// <summary>The calls kept, newest first.</summary>
    public IReadOnlyList<McpActivity> Newest()
    {
        lock (_lock) { return _entries.ToList(); }
    }

    /// <summary>Records a call.</summary>
    public void Add(McpActivity activity)
    {
        lock (_lock)
        {
            _entries.AddFirst(activity);
            while (_entries.Count > Capacity) _entries.RemoveLast();
        }
    }

    /// <summary>Forgets every call.</summary>
    public void Clear()
    {
        lock (_lock) { _entries.Clear(); }
    }
}
