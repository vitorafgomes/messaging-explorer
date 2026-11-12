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

/// <summary>
/// A rule of a subscription: a filter that decides which messages the subscription receives and an optional SQL
/// action applied to each one. <see cref="SqlExpression"/> is set only for <see cref="RuleFilterType.Sql"/>,
/// <see cref="Correlation"/> only for <see cref="RuleFilterType.Correlation"/>. On a write a null
/// <see cref="FilterType"/> is refused; on a read it is always set.
/// </summary>
public class SubscriptionRuleInfo
{
    public string? Name { get; set; }
    public RuleFilterType? FilterType { get; set; }
    public string? SqlExpression { get; set; }
    public CorrelationFilterInfo? Correlation { get; set; }
    public string? SqlAction { get; set; }
}

/// <summary>
/// The kinds of filter a subscription rule can hold. <see cref="RoutingKey"/> is read-only: it shows the routing key
/// of a RabbitMQ binding in <see cref="SubscriptionRuleInfo.SqlExpression"/> and is never accepted on a write.
/// </summary>
public enum RuleFilterType
{
    Sql,
    Correlation,
    True,
    False,
    RoutingKey
}

/// <summary>
/// A correlation filter: a message matches when every field that is set equals the message's value. A null or
/// blank field is not part of the filter.
/// </summary>
public class CorrelationFilterInfo
{
    public string? CorrelationId { get; set; }
    public string? MessageId { get; set; }
    public string? To { get; set; }
    public string? ReplyTo { get; set; }
    public string? Subject { get; set; }
    public string? SessionId { get; set; }
    public string? ReplyToSessionId { get; set; }
    public string? ContentType { get; set; }
    public List<RuleApplicationProperty>? ApplicationProperties { get; set; } = new();
}

/// <summary>
/// An application property a correlation filter matches on. <see cref="Value"/> is the invariant-culture text of
/// the value; <see cref="Type"/> says how to read it.
/// </summary>
public class RuleApplicationProperty
{
    public string? Name { get; set; }
    public RulePropertyType? Type { get; set; }
    public string? Value { get; set; }
}

/// <summary>
/// The value types of a correlation filter property. <see cref="Other"/> is a stored value of any other type,
/// read as its text; it cannot be written.
/// </summary>
public enum RulePropertyType
{
    String,
    Int64,
    Double,
    Boolean,
    Other
}
