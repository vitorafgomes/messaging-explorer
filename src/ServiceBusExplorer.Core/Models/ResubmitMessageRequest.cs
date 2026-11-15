namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// The optional body of the single resubmit of a dead-lettered message.
/// </summary>
public class ResubmitMessageRequest
{
    /// <summary>
    /// When the target detects duplicates, send the copy with a new message id and keep the original in the
    /// application property <c>x-original-message-id</c>. When false, such a target refuses the resubmit and nothing is
    /// sent or removed.
    /// </summary>
    public bool NewMessageIdOnDuplicateDetection { get; set; }
}
