using Azure;
using Moq;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>Pages that hold the enumeration open for a moment and count how many are open at once.</summary>
internal sealed class CountingPages<T>(T[] values, int[] open, int[] mostOpen) : AsyncPageable<T> where T : notnull
{
    public override async IAsyncEnumerable<Page<T>> AsPages(string? continuationToken = null, int? pageSizeHint = null)
    {
        var now = Interlocked.Increment(ref open[0]);
        lock (mostOpen) mostOpen[0] = Math.Max(mostOpen[0], now);
        await Task.Delay(20);
        Interlocked.Decrement(ref open[0]);
        yield return Page<T>.FromValues(values, null, Mock.Of<Response>());
    }
}
