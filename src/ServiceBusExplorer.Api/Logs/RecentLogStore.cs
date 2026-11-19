using System.Diagnostics;

namespace ServiceBusExplorer.Api.Logs;

/// <summary>
/// One line of the backend's log as the Logs screen shows it. Of an exception it carries the names of its types and
/// the method of this application that threw it, never its message or its stack: either can hold a secret.
/// </summary>
public sealed record RecentLogLine(long Id, DateTimeOffset Time, string Level, string Source, string Category, string Text, string? ErrorType, string? Where);

/// <summary>
/// The last lines the backend logged, in memory only, for the Logs screen of Developer mode. Keeps Information and
/// above for this application's categories and Warning and above for every other; nothing is written to disk.
/// </summary>
public sealed class RecentLogStore(Func<DateTimeOffset>? now = null) : ILoggerProvider
{
    /// <summary>How many lines are kept before the oldest is dropped.</summary>
    public const int Capacity = 2000;

    private const int MaxTextLength = 1000;
    private const string OwnNamespace = "ServiceBusExplorer";

    private readonly Func<DateTimeOffset> _now = now ?? (() => DateTimeOffset.UtcNow);
    private readonly Lock _lock = new();
    private readonly Queue<RecentLogLine> _lines = new();
    private long _lastId;

    /// <summary>The lines whose id is greater than <paramref name="id"/>, oldest first.</summary>
    public IReadOnlyList<RecentLogLine> After(long id)
    {
        lock (_lock)
        {
            return _lines.Where(line => line.Id > id).ToList();
        }
    }

    /// <summary>Forgets every line; ids keep counting, so a reader's "after" stays valid.</summary>
    public void Clear()
    {
        lock (_lock)
        {
            _lines.Clear();
        }
    }

    /// <summary>Adds a line that did not come through a logger, such as a request that answered an error.</summary>
    public void Add(LogLevel level, string category, string text, Exception? exception = null)
    {
        var words = text.Length > MaxTextLength ? text[..MaxTextLength] : text;
        lock (_lock)
        {
            _lines.Enqueue(new RecentLogLine(++_lastId, _now(), level.ToString(), "Backend", category, words, TypesOf(exception), ThrownIn(exception)));
            while (_lines.Count > Capacity) _lines.Dequeue();
        }
    }

    /// <inheritdoc />
    public ILogger CreateLogger(string categoryName) => new Writer(this, categoryName);

    /// <inheritdoc />
    public void Dispose()
    {
    }

    private static string? TypesOf(Exception? exception)
    {
        if (exception == null) return null;
        var names = new List<string>();
        for (var e = exception; e != null && names.Count < 5; e = e.InnerException) names.Add(e.GetType().Name);
        return string.Join(" <- ", names);
    }

    private static string? ThrownIn(Exception? exception)
    {
        if (exception == null) return null;
        var method = new StackTrace(exception).GetFrames()
            .Select(frame => frame.GetMethod())
            .FirstOrDefault(m => m?.DeclaringType?.FullName?.StartsWith(OwnNamespace, StringComparison.Ordinal) == true);
        return method == null ? null : $"{method.DeclaringType!.Name}.{method.Name}";
    }

    private sealed class Writer(RecentLogStore store, string category) : ILogger
    {
        private readonly bool _own = category.StartsWith(OwnNamespace, StringComparison.Ordinal);
        private readonly string _short = category[(category.LastIndexOf('.') + 1)..];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None && logLevel >= (_own ? LogLevel.Information : LogLevel.Warning);

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (IsEnabled(logLevel)) store.Add(logLevel, _short, formatter(state, null), exception);
        }
    }
}
