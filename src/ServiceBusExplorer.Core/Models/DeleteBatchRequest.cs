namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Request model for batch delete operations.
/// </summary>
public class DeleteBatchRequest
{
    /// <summary>
    /// Array of sequence numbers to delete.
    /// </summary>
    public long[] SequenceNumbers { get; set; } = Array.Empty<long>();
}
