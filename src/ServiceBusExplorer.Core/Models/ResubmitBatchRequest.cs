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

    /// <summary>
    /// When the target detects duplicates, send each copy with a new message id and keep the original in the
    /// application property <c>x-original-message-id</c>. When false, such a target refuses the call and nothing is
    /// sent or removed.
    /// </summary>
    public bool NewMessageIdOnDuplicateDetection { get; set; }
}
