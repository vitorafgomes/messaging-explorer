namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// The outcome of a send of many messages: how many the broker accepted, and each message it did not, named by its
/// position in the request. What was sent stays sent.
/// </summary>
public class SendMessagesResult
{
    /// <summary>
    /// Number of messages the broker accepted.
    /// </summary>
    public int SentCount { get; set; }

    /// <summary>
    /// One entry per message that was not sent or whose send the broker did not confirm.
    /// </summary>
    public List<SendMessageFailure> Failures { get; set; } = new();

    /// <summary>
    /// True when every message was sent.
    /// </summary>
    public bool Success => Failures.Count == 0;
}

/// <summary>
/// A message of a send of many that was not sent, or whose send the broker did not confirm.
/// </summary>
public class SendMessageFailure
{
    /// <summary>
    /// The message is larger than the broker accepts in one batch; it was not sent.
    /// </summary>
    public const string TooLarge = "Not sent: this message alone is larger than the broker accepts in one batch.";

    /// <summary>
    /// The send stopped, cancelled or failed, before this message was handed to the broker.
    /// </summary>
    public const string NotSent = "Not sent: the send stopped before this message.";

    /// <summary>
    /// The broker failed while this message was being sent; it may have been sent.
    /// </summary>
    public const string Unconfirmed = "The broker did not confirm this message; it may have been sent.";

    /// <summary>
    /// The position of the message in the request, from zero.
    /// </summary>
    public int Index { get; set; }

    /// <summary>
    /// One of the fixed sentences of this class; never the broker's text.
    /// </summary>
    public string Error { get; set; } = string.Empty;
}
