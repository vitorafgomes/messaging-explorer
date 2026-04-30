using System.Collections.Concurrent;

namespace ServiceBusExplorer.Api.Monitoring;

public class MonitoringStore
{
    private const int MaxEntries = 120;
    private readonly ConcurrentQueue<MonitoringSnapshot> _snapshots = new();
    private int _count;

    public void Add(MonitoringSnapshot snapshot)
    {
        _snapshots.Enqueue(snapshot);
        Interlocked.Increment(ref _count);

        while (Interlocked.CompareExchange(ref _count, 0, 0) > MaxEntries)
        {
            if (_snapshots.TryDequeue(out _))
                Interlocked.Decrement(ref _count);
            else
                break;
        }
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
    }
}
