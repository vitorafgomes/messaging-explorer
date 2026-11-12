using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// The Azure Service Bus rules for the name and settings of a queue, topic or subscription to create or update,
/// checked before anything is sent to the broker. Each violation names the field, as the API spells it, and the
/// allowed range; an empty list means the request may go to the broker, which can still refuse it.
/// </summary>
internal static class EntityConfigurationValidator
{
    private static readonly TimeSpan MinLockDuration = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan MaxLockDuration = TimeSpan.FromMinutes(5);
    private const int MinMaxDeliveryCount = 1;
    private const int MaxMaxDeliveryCount = 2000;
    private static readonly TimeSpan MinDefaultMessageTimeToLive = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MinAutoDeleteOnIdle = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MinDuplicateDetectionHistoryTimeWindow = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan MaxDuplicateDetectionHistoryTimeWindow = TimeSpan.FromDays(7);
    private const int MaxUserMetadataLength = 1024;
    private const int MaxEntityPathLength = 260;
    private const int MaxSubscriptionNameLength = 50;

    private const string EntityPathRule = "1 to 260 characters of letters, digits, '.', '-', '_' or '/', not starting or ending with '/'";
    private static readonly string[] QueueStatuses = ["Active", "Disabled", "SendDisabled", "ReceiveDisabled"];
    private static readonly string[] TopicStatuses = ["Active", "Disabled", "SendDisabled"];
    private static readonly string[] SubscriptionStatuses = ["Active", "Disabled", "ReceiveDisabled"];

    public static IReadOnlyList<string> ValidateQueueCreate(string? name, QueueCreateOptions? options)
    {
        var errors = new List<string>();
        CheckEntityPathName(errors, name);
        if (options is null) return errors;
        CheckSettings(errors, options.DefaultMessageTimeToLive, options.LockDuration, options.MaxDeliveryCount,
            options.DuplicateDetectionHistoryTimeWindow, options.MaxSizeInMegabytes, options.AutoDeleteOnIdle, options.UserMetadata);
        CheckForward(errors, "forwardTo", options.ForwardTo, name, "the queue itself");
        CheckForward(errors, "forwardDeadLetteredMessagesTo", options.ForwardDeadLetteredMessagesTo, name, "the queue itself");
        return errors;
    }

    public static IReadOnlyList<string> ValidateQueueUpdate(string queueName, QueueUpdateOptions options)
    {
        var errors = new List<string>();
        CheckSettings(errors, options.DefaultMessageTimeToLive, options.LockDuration, options.MaxDeliveryCount,
            options.DuplicateDetectionHistoryTimeWindow, options.MaxSizeInMegabytes, options.AutoDeleteOnIdle, options.UserMetadata);
        CheckForward(errors, "forwardTo", options.ForwardTo, queueName, "the queue itself");
        CheckForward(errors, "forwardDeadLetteredMessagesTo", options.ForwardDeadLetteredMessagesTo, queueName, "the queue itself");
        CheckStatus(errors, options.Status, QueueStatuses);
        return errors;
    }

    public static IReadOnlyList<string> ValidateTopicCreate(string? name, TopicCreateOptions? options)
    {
        var errors = new List<string>();
        CheckEntityPathName(errors, name);
        if (options is null) return errors;
        CheckSettings(errors, options.DefaultMessageTimeToLive, null, null,
            options.DuplicateDetectionHistoryTimeWindow, options.MaxSizeInMegabytes, options.AutoDeleteOnIdle, options.UserMetadata);
        return errors;
    }

    public static IReadOnlyList<string> ValidateTopicUpdate(TopicUpdateOptions options)
    {
        var errors = new List<string>();
        CheckSettings(errors, options.DefaultMessageTimeToLive, null, null,
            options.DuplicateDetectionHistoryTimeWindow, options.MaxSizeInMegabytes, options.AutoDeleteOnIdle, options.UserMetadata);
        CheckStatus(errors, options.Status, TopicStatuses);
        return errors;
    }

    /// <summary>
    /// A subscription may not forward to its own topic: the broker treats that as forwarding to itself.
    /// </summary>
    public static IReadOnlyList<string> ValidateSubscriptionCreate(string topicName, string? name, SubscriptionCreateOptions? options)
    {
        var errors = new List<string>();
        if (string.IsNullOrEmpty(name))
            errors.Add("name is required.");
        else if (name.Length > MaxSubscriptionNameLength || !name.All(IsSubscriptionNameChar))
            errors.Add("name must be 1 to 50 characters of letters, digits, '.', '-' or '_'.");
        if (options is null) return errors;
        CheckSettings(errors, options.DefaultMessageTimeToLive, options.LockDuration, options.MaxDeliveryCount,
            null, null, options.AutoDeleteOnIdle, options.UserMetadata);
        CheckForward(errors, "forwardTo", options.ForwardTo, topicName, "the topic of the subscription");
        CheckForward(errors, "forwardDeadLetteredMessagesTo", options.ForwardDeadLetteredMessagesTo, topicName, "the topic of the subscription");
        return errors;
    }

    /// <summary>
    /// A subscription may not forward to its own topic: the broker treats that as forwarding to itself.
    /// </summary>
    public static IReadOnlyList<string> ValidateSubscriptionUpdate(string topicName, SubscriptionUpdateOptions options)
    {
        var errors = new List<string>();
        CheckSettings(errors, options.DefaultMessageTimeToLive, options.LockDuration, options.MaxDeliveryCount,
            null, null, options.AutoDeleteOnIdle, options.UserMetadata);
        CheckForward(errors, "forwardTo", options.ForwardTo, topicName, "the topic of the subscription");
        CheckForward(errors, "forwardDeadLetteredMessagesTo", options.ForwardDeadLetteredMessagesTo, topicName, "the topic of the subscription");
        CheckStatus(errors, options.Status, SubscriptionStatuses);
        return errors;
    }

    private static void CheckEntityPathName(List<string> errors, string? name)
    {
        if (string.IsNullOrEmpty(name))
            errors.Add("name is required.");
        else if (!IsEntityPath(name))
            errors.Add($"name must be {EntityPathRule}.");
    }

    private static void CheckSettings(
        List<string> errors,
        TimeSpan? defaultMessageTimeToLive,
        TimeSpan? lockDuration,
        int? maxDeliveryCount,
        TimeSpan? duplicateDetectionHistoryTimeWindow,
        long? maxSizeInMegabytes,
        TimeSpan? autoDeleteOnIdle,
        string? userMetadata)
    {
        if (defaultMessageTimeToLive < MinDefaultMessageTimeToLive)
            errors.Add($"defaultMessageTimeToLive must be at least {MinDefaultMessageTimeToLive}.");
        if (lockDuration < MinLockDuration || lockDuration > MaxLockDuration)
            errors.Add($"lockDuration must be between {MinLockDuration} and {MaxLockDuration}.");
        if (maxDeliveryCount < MinMaxDeliveryCount || maxDeliveryCount > MaxMaxDeliveryCount)
            errors.Add($"maxDeliveryCount must be between {MinMaxDeliveryCount} and {MaxMaxDeliveryCount}.");
        if (autoDeleteOnIdle < MinAutoDeleteOnIdle)
            errors.Add($"autoDeleteOnIdle must be at least {MinAutoDeleteOnIdle}.");
        if (duplicateDetectionHistoryTimeWindow < MinDuplicateDetectionHistoryTimeWindow || duplicateDetectionHistoryTimeWindow > MaxDuplicateDetectionHistoryTimeWindow)
            errors.Add($"duplicateDetectionHistoryTimeWindow must be between {MinDuplicateDetectionHistoryTimeWindow} and {MaxDuplicateDetectionHistoryTimeWindow}.");
        if (maxSizeInMegabytes < 1)
            errors.Add("maxSizeInMegabytes must be a positive whole number.");
        if (userMetadata?.Length > MaxUserMetadataLength)
            errors.Add($"userMetadata must be at most {MaxUserMetadataLength} characters.");
    }

    private static void CheckForward(List<string> errors, string field, string? target, string? self, string selfDescription)
    {
        if (string.IsNullOrEmpty(target)) return;
        if (!IsEntityPath(target))
            errors.Add($"{field} must be a queue or topic name of {EntityPathRule}.");
        else if (string.Equals(target, self, StringComparison.OrdinalIgnoreCase))
            errors.Add($"{field} must not be {selfDescription}.");
    }

    private static void CheckStatus(List<string> errors, string? status, string[] allowed)
    {
        if (status is not null && !allowed.Contains(status, StringComparer.Ordinal))
            errors.Add($"status must be one of {string.Join(", ", allowed)}.");
    }

    private static bool IsEntityPath(string name) =>
        name.Length <= MaxEntityPathLength
        && name[0] != '/'
        && name[^1] != '/'
        && name.All(c => IsSubscriptionNameChar(c) || c == '/');

    private static bool IsSubscriptionNameChar(char c) => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_';
}
