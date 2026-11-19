namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Result of a batch operation on messages.
/// </summary>
public class BatchOperationResult
{
    /// <summary>
    /// Total number of messages processed successfully.
    /// </summary>
    public int SuccessCount { get; set; }

    /// <summary>
    /// Total number of messages that failed to process.
    /// </summary>
    public int FailureCount { get; set; }

    /// <summary>
    /// Details about failed messages.
    /// </summary>
    public List<BatchOperationFailure> Failures { get; set; } = new();

    /// <summary>
    /// The new message id of each message sent with one, by sequence number. Filled only when the request asked for
    /// new ids and the target detects duplicates; the copy keeps its original id in the application property
    /// <c>x-original-message-id</c>.
    /// </summary>
    public Dictionary<long, string> NewMessageIds { get; set; } = new();

    /// <summary>
    /// How many unselected messages of an entity with a delivery limit the scan received and released, which raised
    /// the delivery count of each by one. A lower bound: a message the receiver prefetched and never handed over is
    /// not counted.
    /// </summary>
    public int UnselectedDeliveryCountRaised { get; set; }

    /// <summary>
    /// Sequence numbers of unselected messages that were already at their last delivery when the scan received them,
    /// so releasing them sent them to the dead-letter queue. A lower bound too: a message the receiver prefetched and
    /// never handed over may reach its last delivery when its lock expires and be dead-lettered without being listed.
    /// </summary>
    public List<long> UnselectedDeadLettered { get; set; } = new();

    /// <summary>
    /// Overall success status.
    /// </summary>
    public bool Success => FailureCount == 0;
}

/// <summary>
/// Details about a failed message in a batch operation.
/// </summary>
public class BatchOperationFailure
{
    /// <summary>
    /// Sequence number of the message that failed.
    /// </summary>
    public long SequenceNumber { get; set; }

    /// <summary>
    /// Error message describing the failure.
    /// </summary>
    public string Error { get; set; } = string.Empty;

    /// <summary>
    /// True when the message was sent, or may have been, and was not removed from its source: sending it again would
    /// deliver a second copy, so a caller never retries it.
    /// </summary>
    public bool PossibleDuplicate { get; set; }
}
