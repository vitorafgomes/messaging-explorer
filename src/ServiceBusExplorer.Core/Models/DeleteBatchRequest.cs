namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Request model for batch delete operations.
/// </summary>
public class DeleteBatchRequest
{
    /// <summary>
    /// Array of sequence numbers to delete. Ignored when <see cref="All"/> is true.
    /// </summary>
    public long[] SequenceNumbers { get; set; } = Array.Empty<long>();

    /// <summary>
    /// When true, deletes every message in the target entity via a fast drain path,
    /// bypassing the per-sequence-number scan. The frontend should set this only when
    /// the user selected all messages with no active filter and the selection count
    /// matches the entity's message count.
    /// </summary>
    public bool All { get; set; }
}
