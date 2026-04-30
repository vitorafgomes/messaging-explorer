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
}
