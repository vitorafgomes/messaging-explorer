using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Azure Service Bus message information implementing the abstract message interface.
/// </summary>
public class MessageInfo : IMessage
{
    // IMessage core properties
    public string MessageId { get; set; } = string.Empty;
    public string? CorrelationId { get; set; }
    public string? ContentType { get; set; }
    public string Body { get; set; } = string.Empty;
    public string BodyType { get; set; } = "Text";
    public string? ReplyTo { get; set; }
    public string? To { get; set; }
    public string? Subject { get; set; }
    public int DeliveryCount { get; set; }
    public DateTimeOffset EnqueuedTime { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public TimeSpan TimeToLive { get; set; }

    // Application properties - stored as Dictionary but exposed as IReadOnlyDictionary via interface
    private Dictionary<string, object> _applicationProperties = new();
    public Dictionary<string, object> ApplicationProperties
    {
        get => _applicationProperties;
        set => _applicationProperties = value ?? new();
    }

    // Explicit interface implementation for IReadOnlyDictionary
    IReadOnlyDictionary<string, object> IMessage.ApplicationProperties => _applicationProperties;

    // Dead letter properties
    public bool IsDeadLettered { get; set; }
    public string? DeadLetterReason { get; set; }
    public string? DeadLetterErrorDescription { get; set; }
    public string? DeadLetterSource { get; set; }

    // Provider-specific nullable properties (Azure-supported)
    public long? SequenceNumber { get; set; }
    public string? SessionId { get; set; }
    public string? PartitionKey { get; set; }
    public DateTimeOffset? ScheduledEnqueueTime { get; set; }

    // Azure-specific additional properties (not in IMessage interface)
    public string? ReplyToSessionId { get; set; }
}
