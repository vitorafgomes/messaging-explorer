namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Request model for the delete, resubmit and dead-letter of deferred messages, each named by its sequence number.
/// </summary>
public class DeferredBatchRequest
{
    /// <summary>The most sequence numbers one call accepts.</summary>
    public const int MaxSequenceNumbers = 1000;

    /// <summary>
    /// The sequence numbers of the deferred messages: 1 to <see cref="MaxSequenceNumbers"/>, each positive, none repeated.
    /// </summary>
    public long[] SequenceNumbers { get; set; } = Array.Empty<long>();

    /// <summary>
    /// For a resubmit into a target that detects duplicates: send each copy with a new message id and keep the original
    /// in the application property <c>x-original-message-id</c>. When false, such a target refuses the call and
    /// nothing is sent or removed. Read by the resubmit only.
    /// </summary>
    public bool NewMessageIdOnDuplicateDetection { get; set; }

    /// <summary>The dead-letter reason written on each message. Read by the dead-letter only.</summary>
    public string? Reason { get; set; }

    /// <summary>The dead-letter error description written on each message. Read by the dead-letter only.</summary>
    public string? Description { get; set; }
}
