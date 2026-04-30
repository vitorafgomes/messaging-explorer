namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Request model for batch resubmit operations.
/// </summary>
public class ResubmitBatchRequest
{
    /// <summary>
    /// Array of sequence numbers to resubmit from dead letter queue.
    /// </summary>
    public long[] SequenceNumbers { get; set; } = Array.Empty<long>();
}
