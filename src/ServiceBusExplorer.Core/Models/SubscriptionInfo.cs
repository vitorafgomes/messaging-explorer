namespace ServiceBusExplorer.Core.Models;

public class SubscriptionInfo
{
    public string TopicName { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public long ActiveMessageCount { get; set; }
    public long DeadLetterMessageCount { get; set; }
    public long TransferMessageCount { get; set; }
    public long ScheduledMessageCount { get; set; }
    public long TransferDeadLetterMessageCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset AccessedAt { get; set; }
    public TimeSpan DefaultMessageTimeToLive { get; set; }
    public TimeSpan AutoDeleteOnIdle { get; set; }
    public TimeSpan LockDuration { get; set; }
    public int MaxDeliveryCount { get; set; }
    public bool RequiresSession { get; set; }
    public bool DeadLetteringOnMessageExpiration { get; set; }
    public bool DeadLetteringOnFilterEvaluationExceptions { get; set; }
    public bool EnableBatchedOperations { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? UserMetadata { get; set; }
    public string? ForwardTo { get; set; }
    public string? ForwardDeadLetteredMessagesTo { get; set; }
    public List<SubscriptionRuleInfo> Rules { get; set; } = new();
}

public class SubscriptionRuleInfo
{
    public string Name { get; set; } = string.Empty;
    public string FilterType { get; set; } = string.Empty; // SqlFilter, CorrelationFilter, TrueFilter, FalseFilter
    public string? FilterExpression { get; set; }
    public string? ActionExpression { get; set; }
    public Dictionary<string, object>? CorrelationProperties { get; set; }
}
