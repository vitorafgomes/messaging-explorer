namespace ServiceBusExplorer.Core.Models;

public class SessionInfo
{
    public string SessionId { get; set; } = string.Empty;
    public string? State { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
}
