namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Request model for cancelling scheduled messages of a queue.
/// </summary>
public class CancelScheduledRequest
{
    /// <summary>
    /// The sequence numbers of the scheduled messages to cancel: 1 to 500, each positive, none repeated.
    /// </summary>
    public long[] SequenceNumbers { get; set; } = Array.Empty<long>();
}
