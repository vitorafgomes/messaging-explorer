using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>
/// A time of the MCP routes as ISO 8601 in UTC with seven fraction digits and Z, always the same width, so two of them
/// compared as text are in the order of time.
/// </summary>
public sealed class McpUtcTimeConverter : JsonConverter<DateTimeOffset>
{
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'";

    /// <inheritdoc />
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateTimeOffset.Parse(reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.UtcDateTime.ToString(Format, CultureInfo.InvariantCulture));
}

/// <summary>One line of what a request tells the user, such as "To" and the entity.</summary>
public sealed record McpFact(string Label, string Value);

/// <summary>The word the user types before the app takes an allow, and the words that ask for it.</summary>
/// <param name="Label">What the field asks for, such as "Type the queue name to allow it".</param>
/// <param name="Word">The word that must be typed exactly, letter case included.</param>
public sealed record McpTyped(string Label, string Word);

/// <summary>
/// A request of an assistant waiting for the user's answer in the app. It never carries a message body or a secret.
/// </summary>
/// <param name="Id">The id the answer names.</param>
/// <param name="Time">When the assistant asked.</param>
/// <param name="Assistant">The client's name as it gave it, or "Assistant".</param>
/// <param name="Kind">"read", "send", "connect", "deadLetter", "resubmit", "move", "delete", "purge" or "cancelScheduled".</param>
/// <param name="Title">What is asked, in one sentence.</param>
/// <param name="Facts">What, where, how many and why.</param>
/// <param name="Note">What the user should know before allowing it.</param>
/// <param name="AllowLabel">The words of the button that allows it.</param>
/// <param name="ExpiresAt">When the request is denied without an answer.</param>
/// <param name="Danger">True when what is asked removes messages for good: a delete or a purge.</param>
/// <param name="Typed">The word the user must type before allowing it, or null.</param>
public sealed record McpPendingRequest(
    string Id,
    [property: JsonConverter(typeof(McpUtcTimeConverter))] DateTimeOffset Time,
    string Assistant,
    string Kind,
    string Title,
    IReadOnlyList<McpFact> Facts,
    string Note,
    string AllowLabel,
    [property: JsonConverter(typeof(McpUtcTimeConverter))] DateTimeOffset ExpiresAt,
    bool Danger,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] McpTyped? Typed);

/// <summary>How a request ended.</summary>
public enum McpAnswer
{
    /// <summary>The user allowed it.</summary>
    Allowed,

    /// <summary>The user denied it.</summary>
    Denied,

    /// <summary>The user did not answer in time.</summary>
    NoAnswer,

    /// <summary>Too many requests were waiting; this one was never shown.</summary>
    TooMany,
}

/// <summary>What an answer of the user did to a request.</summary>
public enum McpAnswerResult
{
    /// <summary>The request was answered and stopped waiting.</summary>
    Answered,

    /// <summary>No request with the id is waiting.</summary>
    NotWaiting,

    /// <summary>An allow without the word typed exactly; the request keeps waiting.</summary>
    WrongWord,
}

/// <summary>How long a request waits for the user.</summary>
/// <param name="Wait">The wait; two minutes in the app.</param>
public sealed record McpRequestOptions(TimeSpan Wait)
{
    /// <summary>The wait of the app.</summary>
    public static readonly McpRequestOptions Default = new(TimeSpan.FromMinutes(2));
}

/// <summary>
/// The requests of assistants waiting for the user, in memory, at most <see cref="Capacity"/>. A tool waits for the
/// answer for <see cref="McpRequestOptions.Wait"/>; the request is removed once answered, expired or cancelled by the
/// tool's token.
/// </summary>
public sealed class McpRequests(McpRequestOptions options)
{
    /// <summary>How many requests may wait at once.</summary>
    public const int Capacity = 20;

    private readonly Lock _lock = new();
    private readonly List<(McpPendingRequest Request, TaskCompletionSource<bool> Answer)> _waiting = [];

    /// <summary>The requests waiting, oldest first.</summary>
    public IReadOnlyList<McpPendingRequest> Waiting()
    {
        lock (_lock) { return _waiting.Select(w => w.Request).ToList(); }
    }

    /// <summary>
    /// Answers a waiting request. An allow of a request with a typed word is taken only when <paramref name="typed"/> is
    /// that word exactly, letter case included; otherwise the request keeps waiting. A deny needs no word.
    /// </summary>
    public McpAnswerResult Answer(string id, bool allow, string? typed = null)
    {
        TaskCompletionSource<bool> answer;
        lock (_lock)
        {
            var index = _waiting.FindIndex(w => w.Request.Id == id);
            if (index < 0) return McpAnswerResult.NotWaiting;
            if (allow && _waiting[index].Request.Typed is { } word && !string.Equals(typed, word.Word, StringComparison.Ordinal))
                return McpAnswerResult.WrongWord;
            answer = _waiting[index].Answer;
            _waiting.RemoveAt(index);
        }
        answer.TrySetResult(allow);
        return McpAnswerResult.Answered;
    }

    /// <summary>
    /// Shows a request to the user and waits for the answer. A cancelled <paramref name="cancellationToken"/> removes
    /// the request and throws.
    /// </summary>
    public async Task<McpAnswer> AskAsync(string assistant, string kind, string title, IReadOnlyList<McpFact> facts, string note, string allowLabel, CancellationToken cancellationToken, bool danger = false, McpTyped? typed = null)
    {
        McpPendingRequest request;
        var answer = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_lock)
        {
            if (_waiting.Count >= Capacity) return McpAnswer.TooMany;
            var now = DateTimeOffset.UtcNow;
            request = new McpPendingRequest(Guid.NewGuid().ToString("N"), now, assistant, kind, title, facts, note, allowLabel, now + options.Wait, danger, typed);
            _waiting.Add((request, answer));
        }

        try
        {
            return await answer.Task.WaitAsync(options.Wait, cancellationToken) ? McpAnswer.Allowed : McpAnswer.Denied;
        }
        catch (TimeoutException)
        {
            lock (_lock) { _waiting.RemoveAll(w => w.Request.Id == request.Id); }
            if (!answer.Task.IsCompleted) return McpAnswer.NoAnswer;
            return await answer.Task ? McpAnswer.Allowed : McpAnswer.Denied;
        }
        finally
        {
            lock (_lock) { _waiting.RemoveAll(w => w.Request.Id == request.Id); }
        }
    }
}
