using System.Collections.Concurrent;

namespace ServiceBusExplorer.Api.Monitoring;

public class MonitoringStore
{
    private const int MaxEntries = 120;
    private readonly ConcurrentQueue<MonitoringSnapshot> _snapshots = new();
    private readonly Lock _failureLock = new();
    private DateTimeOffset? _lastFailureAt;
    private int _count;

    public void Add(MonitoringSnapshot snapshot)
    {
        _snapshots.Enqueue(snapshot);
        Interlocked.Increment(ref _count);
        lock (_failureLock) _lastFailureAt = null;

        while (Interlocked.CompareExchange(ref _count, 0, 0) > MaxEntries)
        {
            if (_snapshots.TryDequeue(out _))
                Interlocked.Decrement(ref _count);
            else
                break;
        }
    }

    /// <summary>
    /// Records that a poll failed; the next snapshot added clears it.
    /// </summary>
    public void RecordFailure(DateTimeOffset at)
    {
        lock (_failureLock) _lastFailureAt = at;
    }

    public DateTimeOffset? LastFailureAt
    {
        get { lock (_failureLock) return _lastFailureAt; }
    }

    public MonitoringSnapshot? GetLatest()
    {
        var items = _snapshots.ToArray();
        return items.Length > 0 ? items[^1] : null;
    }

    public MonitoringSnapshot[] GetHistory(int count)
    {
        var items = _snapshots.ToArray();
        if (count >= items.Length)
            return items;

        return items[^count..];
    }

    public void Clear()
    {
        while (_snapshots.TryDequeue(out _)) { }
        Interlocked.Exchange(ref _count, 0);
        lock (_failureLock) _lastFailureAt = null;
    }
}
