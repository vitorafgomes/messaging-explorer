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
}
