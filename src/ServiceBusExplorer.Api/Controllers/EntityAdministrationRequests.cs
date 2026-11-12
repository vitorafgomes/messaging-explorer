using ServiceBusExplorer.Core.Abstractions;

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
