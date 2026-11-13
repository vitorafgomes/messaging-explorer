namespace ServiceBusExplorer.Core.Models;

/// <summary>A session seen in a passive scan of an entity's messages; reading its state would need its lock.</summary>
public class SessionInfo
{
    public string SessionId { get; set; } = string.Empty;

    /// <summary>The messages of this session seen within the scan, not every message it holds.</summary>
    public int MessageCount { get; set; }

    /// <summary>The sequence number of the first message of this session seen in the scan.</summary>
    public long FirstSequenceNumber { get; set; }
}

/// <summary>The sessions found by one passive scan, in order of first appearance.</summary>
public class SessionList
{
    public IReadOnlyList<SessionInfo> Sessions { get; set; } = [];

    /// <summary>How many messages the scan counted.</summary>
    public int ScannedMessages { get; set; }

    /// <summary>True when the scan stopped at its message or session limit, so more sessions or messages may exist.</summary>
    public bool Truncated { get; set; }
}

/// <summary>One session as read while it was accepted.</summary>
public class SessionDetail
{
    public string SessionId { get; set; } = string.Empty;

    /// <summary>Null when the session has no state; the UTF-8 text, or base64 when <see cref="StateIsBinary"/>.</summary>
    public string? State { get; set; }

    /// <summary>True when the stored bytes are not valid UTF-8 and <see cref="State"/> holds them as base64.</summary>
    public bool StateIsBinary { get; set; }

    /// <summary>The lock this read held; informational, it was released before the answer.</summary>
    public DateTimeOffset LockedUntil { get; set; }

    /// <summary>Up to the requested number of the session's messages, peeked under the same accept; null when none were asked for.</summary>
    public IReadOnlyList<MessageInfo>? Messages { get; set; }
}
