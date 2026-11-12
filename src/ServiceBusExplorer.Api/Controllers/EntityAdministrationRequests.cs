using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>
/// The body of <c>POST api/queues</c>: the name and, optionally, the settings to create the queue with.
/// Without options the queue is created with the broker's defaults.
/// </summary>
public class CreateQueueRequest
{
    public string? Name { get; set; }
    public QueueCreateBody? Options { get; set; }
}

/// <summary>
/// The settings a queue can be created with. Typed fields only: nothing here binds a provider-specific dictionary.
/// </summary>
public class QueueCreateBody
{
    public TimeSpan? DefaultMessageTimeToLive { get; set; }
    public TimeSpan? LockDuration { get; set; }
    public int? MaxDeliveryCount { get; set; }
    public bool? RequiresSession { get; set; }
    public bool? EnablePartitioning { get; set; }
    public bool? DeadLetteringOnMessageExpiration { get; set; }
    public bool? RequiresDuplicateDetection { get; set; }
    public TimeSpan? DuplicateDetectionHistoryTimeWindow { get; set; }
    public long? MaxSizeInMegabytes { get; set; }
    public TimeSpan? AutoDeleteOnIdle { get; set; }
    public bool? EnableBatchedOperations { get; set; }
    public string? ForwardTo { get; set; }
    public string? ForwardDeadLetteredMessagesTo { get; set; }
    public string? UserMetadata { get; set; }

    public QueueCreateOptions ToOptions() => new()
    {
        DefaultMessageTimeToLive = DefaultMessageTimeToLive,
        LockDuration = LockDuration,
        MaxDeliveryCount = MaxDeliveryCount,
        RequiresSession = RequiresSession ?? false,
        EnablePartitioning = EnablePartitioning ?? false,
        DeadLetteringOnMessageExpiration = DeadLetteringOnMessageExpiration ?? false,
        RequiresDuplicateDetection = RequiresDuplicateDetection ?? false,
        DuplicateDetectionHistoryTimeWindow = DuplicateDetectionHistoryTimeWindow,
        MaxSizeInMegabytes = MaxSizeInMegabytes,
        AutoDeleteOnIdle = AutoDeleteOnIdle,
        EnableBatchedOperations = EnableBatchedOperations,
        ForwardTo = ForwardTo,
        ForwardDeadLetteredMessagesTo = ForwardDeadLetteredMessagesTo,
        UserMetadata = UserMetadata
    };
}

/// <summary>
/// The body of <c>POST api/topics</c>: the name and, optionally, the settings to create the topic with.
/// </summary>
public class CreateTopicRequest
{
    public string? Name { get; set; }
    public TopicCreateBody? Options { get; set; }
}

/// <summary>
/// The settings a topic can be created with. Typed fields only.
/// </summary>
public class TopicCreateBody
{
    public TimeSpan? DefaultMessageTimeToLive { get; set; }
    public bool? EnablePartitioning { get; set; }
    public bool? RequiresDuplicateDetection { get; set; }
    public TimeSpan? DuplicateDetectionHistoryTimeWindow { get; set; }
    public long? MaxSizeInMegabytes { get; set; }
    public TimeSpan? AutoDeleteOnIdle { get; set; }
    public bool? EnableBatchedOperations { get; set; }
    public bool? SupportOrdering { get; set; }
    public string? UserMetadata { get; set; }

    public TopicCreateOptions ToOptions() => new()
    {
        DefaultMessageTimeToLive = DefaultMessageTimeToLive,
        EnablePartitioning = EnablePartitioning ?? false,
        RequiresDuplicateDetection = RequiresDuplicateDetection ?? false,
        DuplicateDetectionHistoryTimeWindow = DuplicateDetectionHistoryTimeWindow,
        MaxSizeInMegabytes = MaxSizeInMegabytes,
        AutoDeleteOnIdle = AutoDeleteOnIdle,
        EnableBatchedOperations = EnableBatchedOperations,
        SupportOrdering = SupportOrdering,
        UserMetadata = UserMetadata
    };
}

/// <summary>
/// The body of <c>POST api/topics/{topicName}/subscriptions</c>: the name and, optionally, the settings to
/// create the subscription with. No filter or rule: the subscription gets the broker's default rule.
/// </summary>
public class CreateSubscriptionRequest
{
    public string? Name { get; set; }
    public SubscriptionCreateBody? Options { get; set; }
}

/// <summary>
/// The settings a subscription can be created with. Typed fields only.
/// </summary>
public class SubscriptionCreateBody
{
    public TimeSpan? DefaultMessageTimeToLive { get; set; }
    public TimeSpan? LockDuration { get; set; }
    public int? MaxDeliveryCount { get; set; }
    public bool? RequiresSession { get; set; }
    public bool? DeadLetteringOnMessageExpiration { get; set; }
    public bool? DeadLetteringOnFilterEvaluationExceptions { get; set; }
    public TimeSpan? AutoDeleteOnIdle { get; set; }
    public bool? EnableBatchedOperations { get; set; }
    public string? ForwardTo { get; set; }
    public string? ForwardDeadLetteredMessagesTo { get; set; }
    public string? UserMetadata { get; set; }

    public SubscriptionCreateOptions ToOptions() => new()
    {
        DefaultMessageTimeToLive = DefaultMessageTimeToLive,
        LockDuration = LockDuration,
        MaxDeliveryCount = MaxDeliveryCount,
        RequiresSession = RequiresSession ?? false,
        DeadLetteringOnMessageExpiration = DeadLetteringOnMessageExpiration ?? false,
        DeadLetteringOnFilterEvaluationExceptions = DeadLetteringOnFilterEvaluationExceptions,
        AutoDeleteOnIdle = AutoDeleteOnIdle,
        EnableBatchedOperations = EnableBatchedOperations,
        ForwardTo = ForwardTo,
        ForwardDeadLetteredMessagesTo = ForwardDeadLetteredMessagesTo,
        UserMetadata = UserMetadata
    };
}

/// <summary>
/// The body of <c>POST</c> and <c>PUT api/topics/{topicName}/subscriptions/{subscriptionName}/rules</c>. The filter
/// type and each property type bind as text, so a value outside the set reaches the provider's checks as null and is
/// refused with a <c>{ message }</c> body that names the field, never a model-binding error.
/// </summary>
public class SubscriptionRuleRequest
{
    public string? Name { get; set; }
    public string? FilterType { get; set; }
    public string? SqlExpression { get; set; }
    public CorrelationFilterRequest? Correlation { get; set; }
    public string? SqlAction { get; set; }

    public SubscriptionRuleInfo ToRule() => new()
    {
        Name = Name,
        FilterType = ParseName<RuleFilterType>(FilterType),
        SqlExpression = SqlExpression,
        Correlation = Correlation?.ToFilter(),
        SqlAction = SqlAction
    };

    /// <summary>The member of <typeparamref name="T"/> spelled exactly <paramref name="name"/>; null for anything else, numbers included.</summary>
    internal static T? ParseName<T>(string? name) where T : struct, Enum =>
        name is not null && Enum.GetNames<T>().Contains(name) ? Enum.Parse<T>(name) : null;
}

/// <summary>The correlation filter of a rule body. Typed fields only; property values are text.</summary>
public class CorrelationFilterRequest
{
    public string? CorrelationId { get; set; }
    public string? MessageId { get; set; }
    public string? To { get; set; }
    public string? ReplyTo { get; set; }
    public string? Subject { get; set; }
    public string? SessionId { get; set; }
    public string? ReplyToSessionId { get; set; }
    public string? ContentType { get; set; }
    public List<RuleApplicationPropertyRequest>? ApplicationProperties { get; set; }

    public CorrelationFilterInfo ToFilter() => new()
    {
        CorrelationId = CorrelationId,
        MessageId = MessageId,
        To = To,
        ReplyTo = ReplyTo,
        Subject = Subject,
        SessionId = SessionId,
        ReplyToSessionId = ReplyToSessionId,
        ContentType = ContentType,
        ApplicationProperties = ApplicationProperties?.Select(p => p.ToProperty()).ToList()
    };
}

/// <summary>One application property of a correlation filter body: its name, its type as text and its value as text.</summary>
public class RuleApplicationPropertyRequest
{
    public string? Name { get; set; }
    public string? Type { get; set; }
    public string? Value { get; set; }

    public RuleApplicationProperty ToProperty() => new()
    {
        Name = Name,
        Type = SubscriptionRuleRequest.ParseName<RulePropertyType>(Type),
        Value = Value
    };
}
