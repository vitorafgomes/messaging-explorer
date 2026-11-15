namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Request model for batch move operations.
/// </summary>
public class MoveBatchRequest
{
    /// <summary>
    /// Array of sequence numbers to move.
    /// </summary>
    public long[] SequenceNumbers { get; set; } = Array.Empty<long>();

    /// <summary>
    /// Name of the target queue to move messages to.
    /// </summary>
    public string TargetQueueName { get; set; } = string.Empty;

    /// <summary>
    /// When the target detects duplicates, send each copy with a new message id and keep the original in the
    /// application property <c>x-original-message-id</c>. When false, such a target refuses the call and nothing is
    /// sent or removed.
    /// </summary>
    public bool NewMessageIdOnDuplicateDetection { get; set; }
}
