using System.Globalization;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

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
    private const int MaxSqlLength = 1024;
    private const int MaxCorrelationFieldLength = 128;
    private const int MaxPropertyNameLength = 128;
    private const int MaxScheduledSequenceNumbers = 500;
    private const string DefaultRuleName = "$Default";
    private const NumberStyles DoubleStyles = NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent;

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

    /// <summary>
    /// The sequence numbers of a cancel of scheduled messages: 1 to 500 of them, each positive, none repeated.
    /// </summary>
    public static IReadOnlyList<string> ValidateScheduledSequenceNumbers(long[]? sequenceNumbers)
    {
        var errors = new List<string>();
        if (sequenceNumbers is null || sequenceNumbers.Length is < 1 or > MaxScheduledSequenceNumbers)
        {
            errors.Add($"sequenceNumbers must hold 1 to {MaxScheduledSequenceNumbers} sequence numbers.");
            return errors;
        }

        if (sequenceNumbers.Any(n => n <= 0))
            errors.Add("sequenceNumbers must be positive whole numbers.");
        if (sequenceNumbers.Distinct().Count() != sequenceNumbers.Length)
            errors.Add("sequenceNumbers must not repeat a sequence number.");
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

    /// <summary>The name of a rule to add, replace or delete: 1 to 50 characters, or the reserved <c>$Default</c>.</summary>
    public static IReadOnlyList<string> ValidateRuleName(string? name)
    {
        var errors = new List<string>();
        CheckRuleName(errors, name);
        return errors;
    }

    /// <summary>
    /// A rule to add or to replace under <paramref name="name"/>: its name, its filter and its action. Blank text
    /// counts as absent, as the broker treats it: a blank correlation field is not part of the filter and a blank
    /// action is no action.
    /// </summary>
    public static IReadOnlyList<string> ValidateRule(string? name, SubscriptionRuleInfo rule)
    {
        var errors = new List<string>();
        CheckRuleName(errors, name);

        var hasExpression = !string.IsNullOrWhiteSpace(rule.SqlExpression);
        if (rule.FilterType is not (RuleFilterType.Sql or RuleFilterType.Correlation or RuleFilterType.True or RuleFilterType.False))
            errors.Add("filterType must be one of Sql, Correlation, True, False.");
        else if (rule.FilterType == RuleFilterType.Sql)
        {
            if (!hasExpression || rule.SqlExpression!.Length > MaxSqlLength)
                errors.Add($"sqlExpression is required for filterType Sql and must be 1 to {MaxSqlLength} characters.");
        }
        else if (hasExpression)
            errors.Add("sqlExpression must be null unless filterType is Sql.");

        if (rule.FilterType == RuleFilterType.Correlation)
            CheckCorrelation(errors, rule.Correlation);
        else if (rule.Correlation is not null)
            errors.Add("correlation must be null unless filterType is Correlation.");

        if (rule.SqlAction?.Length > MaxSqlLength)
            errors.Add($"sqlAction must be at most {MaxSqlLength} characters.");
        return errors;
    }

    /// <summary>
    /// The value of a correlation property read as its declared type with the invariant culture: a string as is, an
    /// Int64 as a whole number, a Double as a finite number with '.' as the decimal point, a Boolean as <c>true</c>
    /// or <c>false</c> in any case. Null when it does not parse or the type cannot be written.
    /// </summary>
    public static object? ParsePropertyValue(RulePropertyType? type, string? text) => type switch
    {
        RulePropertyType.String => text,
        RulePropertyType.Int64 when long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var whole) => whole,
        RulePropertyType.Double when double.TryParse(text, DoubleStyles, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number) => number,
        RulePropertyType.Boolean when string.Equals(text, "true", StringComparison.OrdinalIgnoreCase) => true,
        RulePropertyType.Boolean when string.Equals(text, "false", StringComparison.OrdinalIgnoreCase) => false,
        _ => null
    };

    private static void CheckRuleName(List<string> errors, string? name)
    {
        if (name == DefaultRuleName) return;
        if (string.IsNullOrEmpty(name) || name.Length > MaxSubscriptionNameLength || !name.All(IsSubscriptionNameChar))
            errors.Add($"name must be 1 to {MaxSubscriptionNameLength} characters of letters, digits, '.', '-' or '_', or {DefaultRuleName}.");
    }

    private static void CheckCorrelation(List<string> errors, CorrelationFilterInfo? correlation)
    {
        if (correlation is null)
        {
            errors.Add("correlation is required for filterType Correlation.");
            return;
        }

        (string Field, string? Value)[] systemFields =
        [
            ("correlationId", correlation.CorrelationId), ("messageId", correlation.MessageId), ("to", correlation.To),
            ("replyTo", correlation.ReplyTo), ("subject", correlation.Subject), ("sessionId", correlation.SessionId),
            ("replyToSessionId", correlation.ReplyToSessionId), ("contentType", correlation.ContentType)
        ];
        foreach (var (field, value) in systemFields)
        {
            if (value?.Length > MaxCorrelationFieldLength)
                errors.Add($"correlation.{field} must be at most {MaxCorrelationFieldLength} characters.");
        }

        var properties = correlation.ApplicationProperties ?? [];
        for (var i = 0; i < properties.Count; i++)
            CheckProperty(errors, $"correlation.applicationProperties[{i}]", properties[i], properties.Take(i));

        if (properties.Count == 0 && systemFields.All(f => string.IsNullOrWhiteSpace(f.Value)))
            errors.Add("correlation must set at least one field or one application property.");
    }

    private static void CheckProperty(List<string> errors, string field, RuleApplicationProperty property, IEnumerable<RuleApplicationProperty> before)
    {
        if (string.IsNullOrEmpty(property.Name) || property.Name.Length > MaxPropertyNameLength)
            errors.Add($"{field}.name must be 1 to {MaxPropertyNameLength} characters.");
        else if (before.Any(p => p.Name == property.Name))
            errors.Add($"{field}.name must be unique in the list.");

        switch (property.Type)
        {
            case null:
                errors.Add($"{field}.type must be one of String, Int64, Double, Boolean.");
                break;
            case RulePropertyType.Other:
                errors.Add($"{field}.type Other is read-only and cannot be written.");
                break;
            default:
                if (ParsePropertyValue(property.Type, property.Value) is null)
                    errors.Add($"{field}.value of '{property.Name}' must be {ValueRule(property.Type.Value)}.");
                break;
        }
    }

    private static string ValueRule(RulePropertyType type) => type switch
    {
        RulePropertyType.Int64 => "a whole number (Int64)",
        RulePropertyType.Double => "a finite number with '.' as the decimal point (Double)",
        RulePropertyType.Boolean => "true or false (Boolean)",
        _ => "a string (String)"
    };

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
