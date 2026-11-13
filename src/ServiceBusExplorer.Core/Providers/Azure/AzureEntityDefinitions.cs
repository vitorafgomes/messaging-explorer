using System.Globalization;
using System.Text.Json;
using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Microsoft.Extensions.Logging;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// The export and import of entity definitions through the administration client. The export reads configuration
/// only, from the paged enumerations: queues and topics once each, subscriptions once per topic, rules once per
/// subscription. The import checks the whole document first, reads the namespace the same way, and creates only
/// what does not exist.
/// </summary>
internal static class AzureEntityDefinitions
{
    /// <summary>The most subscription or rule enumerations the export runs at once.</summary>
    internal const int ExportParallelism = 8;

    private const string DefaultRuleName = "$Default";
    internal const string TopicNotCreated = "Its topic was not created.";
    internal const string NotFound = "The broker did not find an entity it needs: its topic or a forward target.";
    internal const string NotCreated = "The broker did not create it.";
    internal const string CreatedMeanwhile = "It was created by someone else during the import. Left as it is.";
    internal const string RulesIncomplete = "The subscription was created, but not with all of its rules.";
    internal const string MatchNothingRuleKept = "The subscription was created without rules, but the rule that holds its messages back could not be removed.";

    /// <summary>
    /// Reads every entity and rule into one document. For a file (<paramref name="forFile"/>), a namespace above the
    /// bounds an import accepts is refused with <see cref="InvalidEntityConfigurationException"/> naming the count and the
    /// limit, before its rules are read when the entities are already too many: a file the app cannot import is never written.
    /// </summary>
    internal static async Task<EntityDefinitionsDocument> ExportCoreAsync(ServiceBusAdministrationClient adminClient, CancellationToken cancellationToken, bool forFile = true)
    {
        var queuesRead = ReadAllAsync(adminClient.GetQueuesAsync(cancellationToken), ToDefinition);
        var topicsRead = ReadAllAsync(adminClient.GetTopicsAsync(cancellationToken), ToDefinition);
        await Task.WhenAll(queuesRead, topicsRead);
        var topics = topicsRead.Result;

        var parallel = new ParallelOptions { MaxDegreeOfParallelism = ExportParallelism, CancellationToken = cancellationToken };
        await Parallel.ForEachAsync(topics, parallel, async (topic, token) =>
            topic.Subscriptions = ByName(await ReadAllAsync(adminClient.GetSubscriptionsAsync(topic.Name, token), ToDefinition), s => s.Name));

        var subscriptions = topics.SelectMany(t => t.Subscriptions!.Select(s => (Topic: t.Name!, Subscription: s!))).ToList();
        var entities = queuesRead.Result.Count + topics.Count + subscriptions.Count;
        if (forFile && entities > EntityConfigurationValidator.MaxDefinitionEntities)
            throw TooLarge($"{entities} queues, topics and subscriptions", EntityConfigurationValidator.MaxDefinitionEntities);

        await Parallel.ForEachAsync(subscriptions, parallel, async (pair, token) =>
            pair.Subscription.Rules = ByName(
                await ReadAllAsync(adminClient.GetRulesAsync(pair.Topic, pair.Subscription.Name, token), AzureServiceBusProvider.MapToSubscriptionRuleInfo),
                r => r.Name));

        var rules = subscriptions.Sum(s => s.Subscription.Rules!.Count);
        if (forFile && rules > EntityConfigurationValidator.MaxDefinitionRules)
            throw TooLarge($"{rules} rules", EntityConfigurationValidator.MaxDefinitionRules);

        return new EntityDefinitionsDocument
        {
            Version = EntityDefinitionsDocument.CurrentVersion,
            ExportedAt = DateTimeOffset.UtcNow,
            Entities = new EntityDefinitions
            {
                Queues = ByName(queuesRead.Result, q => q.Name),
                Topics = ByName(topics, t => t.Name)
            }
        };
    }

    // ponytail: one file per namespace; a namespace above the bounds needs a chunked export, not built.
    private static InvalidEntityConfigurationException TooLarge(string held, int limit) =>
        new([$"The namespace holds {held}; a definitions file holds at most {limit}, so it cannot be exported."]);

    internal static async Task<DefinitionsImportResult> ImportCoreAsync(
        ServiceBusAdministrationClient adminClient, EntityDefinitionsDocument document, bool dryRun, ILogger logger, CancellationToken cancellationToken)
    {
        var violations = EntityConfigurationValidator.ValidateDefinitions(document);
        if (violations.Count > 0)
            throw new InvalidEntityConfigurationException(violations);

        var existing = (await ExportCoreAsync(adminClient, cancellationToken, forFile: false)).Entities!;
        var existingQueues = existing.Queues!.ToDictionary(q => q!.Name!, q => q!, StringComparer.OrdinalIgnoreCase);
        var existingTopics = existing.Topics!.ToDictionary(t => t!.Name!, t => t!, StringComparer.OrdinalIgnoreCase);

        var result = new DefinitionsImportResult { DryRun = dryRun };
        var queues = new List<(QueueDefinition Queue, DefinitionImportItem Item)>();
        var topics = new List<(TopicDefinition Topic, DefinitionImportItem Item)>();
        var subscriptions = new List<(TopicDefinition Topic, DefinitionImportItem TopicItem, SubscriptionDefinition Subscription, DefinitionImportItem Item)>();

        foreach (var queue in document.Entities!.Queues?.OfType<QueueDefinition>() ?? [])
        {
            var item = Classify(DefinitionEntityKind.Queue, queue.Name!, null,
                existingQueues.TryGetValue(queue.Name!, out var found) ? QueueDifferences(queue.Options, found.Options!) : null);
            result.Items.Add(item);
            if (item.Outcome == DefinitionImportOutcome.Create) queues.Add((queue, item));
        }

        foreach (var topic in document.Entities.Topics?.OfType<TopicDefinition>() ?? [])
        {
            existingTopics.TryGetValue(topic.Name!, out var foundTopic);
            var topicItem = Classify(DefinitionEntityKind.Topic, topic.Name!, null, foundTopic is null ? null : TopicDifferences(topic.Options, foundTopic.Options!));
            result.Items.Add(topicItem);
            if (topicItem.Outcome == DefinitionImportOutcome.Create) topics.Add((topic, topicItem));

            var foundSubscriptions = (foundTopic?.Subscriptions ?? []).ToDictionary(s => s!.Name!, s => s!, StringComparer.OrdinalIgnoreCase);
            foreach (var subscription in topic.Subscriptions?.OfType<SubscriptionDefinition>() ?? [])
            {
                var item = Classify(DefinitionEntityKind.Subscription, subscription.Name!, topic.Name,
                    foundSubscriptions.TryGetValue(subscription.Name!, out var found) ? SubscriptionDifferences(subscription, found) : null);
                result.Items.Add(item);
                if (item.Outcome == DefinitionImportOutcome.Create) subscriptions.Add((topic, topicItem, subscription, item));
            }
        }

        if (dryRun) return result;

        foreach (var (topic, item) in topics)
            await CreateAsync(item, () => AzureServiceBusProvider.CreateTopicCoreAsync(adminClient, topic.Name!, topic.Options, cancellationToken), logger, cancellationToken);

        foreach (var (queue, item) in InForwardOrder(queues))
            await CreateAsync(item, () => AzureServiceBusProvider.CreateQueueCoreAsync(adminClient, queue.Name!, queue.Options, cancellationToken), logger, cancellationToken);

        foreach (var (topic, topicItem, subscription, item) in subscriptions)
        {
            if (topicItem.Outcome == DefinitionImportOutcome.Failed)
            {
                item.Outcome = DefinitionImportOutcome.Failed;
                item.Reason = TopicNotCreated;
                continue;
            }

            await CreateSubscriptionAsync(adminClient, topic.Name!, subscription, item, logger, cancellationToken);
        }

        return result;
    }

    /// <summary>
    /// Creates the subscription with its first rule in one call, so it never holds the default rule it was not exported
    /// with, then adds the other rules. Without a rule list it gets the broker's default rule. With an empty list it is
    /// created with a <c>$Default</c> rule that matches nothing, which is then removed: no message reaches it either way.
    /// </summary>
    private static async Task CreateSubscriptionAsync(
        ServiceBusAdministrationClient adminClient, string topicName, SubscriptionDefinition subscription, DefinitionImportItem item, ILogger logger, CancellationToken cancellationToken)
    {
        var rules = subscription.Rules?.OfType<SubscriptionRuleInfo>().ToList();
        var firstRule = rules is null ? null : rules.FirstOrDefault() ?? new SubscriptionRuleInfo { Name = DefaultRuleName, FilterType = RuleFilterType.False };
        await CreateAsync(item, () => AzureServiceBusProvider.CreateSubscriptionCoreAsync(adminClient, topicName, subscription.Name!, subscription.Options, firstRule, cancellationToken), logger, cancellationToken);
        if (item.Outcome != DefinitionImportOutcome.Created || rules is null) return;

        if (rules.Count == 0)
        {
            await CreateAsync(item, () => AzureServiceBusProvider.DeleteRuleCoreAsync(adminClient, topicName, subscription.Name!, DefaultRuleName, cancellationToken), logger, cancellationToken, MatchNothingRuleKept);
            return;
        }

        foreach (var rule in rules.Skip(1))
        {
            await CreateAsync(item, () => AzureServiceBusProvider.CreateRuleCoreAsync(adminClient, topicName, subscription.Name!, rule, cancellationToken), logger, cancellationToken, RulesIncomplete);
            if (item.Outcome == DefinitionImportOutcome.Failed) return;
        }
    }

    /// <summary>
    /// Runs one broker call for <paramref name="item"/>: <see cref="DefinitionImportOutcome.Created"/> when it succeeds,
    /// <see cref="DefinitionImportOutcome.Failed"/> with a fixed reason when it fails, and left as it is when the entity
    /// appeared since the namespace was read. The caller's cancellation propagates; nothing else does.
    /// </summary>
    private static async Task CreateAsync(DefinitionImportItem item, Func<Task> call, ILogger logger, CancellationToken cancellationToken, string? failedAfterCreate = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            await call();
            item.Outcome = DefinitionImportOutcome.Created;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (EntityAlreadyExistsException) when (failedAfterCreate is null)
        {
            item.Outcome = DefinitionImportOutcome.Exists;
            item.Reason = CreatedMeanwhile;
        }
        catch (Exception ex)
        {
            item.Outcome = DefinitionImportOutcome.Failed;
            item.Reason = failedAfterCreate ?? ex switch
            {
                EntityNotFoundException => NotFound,
                InvalidEntityConfigurationException => ex.Message,
                _ => NotCreated
            };
            logger.LogWarning("Import of {EntityKind} {EntityName} in topic {TopicName} failed: {Cause}", item.Kind, item.Name, item.Topic, CauseOf(ex));
        }
    }

    private static string CauseOf(Exception ex) => (ex as ServiceBusException ?? ex.InnerException as ServiceBusException)?.Reason.ToString() ?? ex.GetType().Name;

    /// <summary>
    /// The queues to create, each after the queues of the document it forwards to, so the broker finds its target. A
    /// cycle is left in document order for the broker to refuse.
    /// </summary>
    private static IEnumerable<(QueueDefinition Queue, DefinitionImportItem Item)> InForwardOrder(List<(QueueDefinition Queue, DefinitionImportItem Item)> queues)
    {
        var pending = queues.ToList();
        var notYetCreated = new HashSet<string>(pending.Select(q => q.Queue.Name!), StringComparer.OrdinalIgnoreCase);
        while (pending.Count > 0)
        {
            var ready = pending.Where(q => !ForwardTargets(q.Queue).Any(t => notYetCreated.Contains(t) && !t.Equals(q.Queue.Name, StringComparison.OrdinalIgnoreCase))).ToList();
            if (ready.Count == 0) ready = pending.ToList();
            foreach (var queue in ready)
            {
                notYetCreated.Remove(queue.Queue.Name!);
                pending.Remove(queue);
                yield return queue;
            }
        }
    }

    private static IEnumerable<string> ForwardTargets(QueueDefinition queue) =>
        new[] { queue.Options?.ForwardTo, queue.Options?.ForwardDeadLetteredMessagesTo }.Where(t => !string.IsNullOrEmpty(t))!;

    private static DefinitionImportItem Classify(DefinitionEntityKind kind, string name, string? topic, List<string>? differences) => new()
    {
        Kind = kind,
        Name = name,
        Topic = topic,
        Outcome = differences is null ? DefinitionImportOutcome.Create
            : differences.Count == 0 ? DefinitionImportOutcome.Exists
            : DefinitionImportOutcome.Differs,
        DifferingFields = differences is { Count: > 0 } ? differences : null
    };

    private static List<string> QueueDifferences(QueueCreateOptions? wanted, QueueCreateOptions actual)
    {
        var fields = new List<string>();
        if (wanted is null) return fields;
        Compare(fields, "defaultMessageTimeToLive", wanted.DefaultMessageTimeToLive, actual.DefaultMessageTimeToLive);
        Compare(fields, "lockDuration", wanted.LockDuration, actual.LockDuration);
        Compare(fields, "maxDeliveryCount", wanted.MaxDeliveryCount, actual.MaxDeliveryCount);
        Compare(fields, "requiresSession", wanted.RequiresSession, actual.RequiresSession);
        Compare(fields, "enablePartitioning", wanted.EnablePartitioning, actual.EnablePartitioning);
        Compare(fields, "deadLetteringOnMessageExpiration", wanted.DeadLetteringOnMessageExpiration, actual.DeadLetteringOnMessageExpiration);
        Compare(fields, "requiresDuplicateDetection", wanted.RequiresDuplicateDetection, actual.RequiresDuplicateDetection);
        Compare(fields, "duplicateDetectionHistoryTimeWindow", wanted.DuplicateDetectionHistoryTimeWindow, actual.DuplicateDetectionHistoryTimeWindow);
        Compare(fields, "maxSizeInMegabytes", wanted.MaxSizeInMegabytes, actual.MaxSizeInMegabytes);
        Compare(fields, "autoDeleteOnIdle", wanted.AutoDeleteOnIdle, actual.AutoDeleteOnIdle);
        Compare(fields, "enableBatchedOperations", wanted.EnableBatchedOperations, actual.EnableBatchedOperations);
        Compare(fields, "forwardTo", wanted.ForwardTo, actual.ForwardTo, StringComparison.OrdinalIgnoreCase);
        Compare(fields, "forwardDeadLetteredMessagesTo", wanted.ForwardDeadLetteredMessagesTo, actual.ForwardDeadLetteredMessagesTo, StringComparison.OrdinalIgnoreCase);
        Compare(fields, "userMetadata", wanted.UserMetadata, actual.UserMetadata, StringComparison.Ordinal);
        Compare(fields, "status", wanted.Status, actual.Status, StringComparison.Ordinal);
        return fields;
    }

    private static List<string> TopicDifferences(TopicCreateOptions? wanted, TopicCreateOptions actual)
    {
        var fields = new List<string>();
        if (wanted is null) return fields;
        Compare(fields, "defaultMessageTimeToLive", wanted.DefaultMessageTimeToLive, actual.DefaultMessageTimeToLive);
        Compare(fields, "enablePartitioning", wanted.EnablePartitioning, actual.EnablePartitioning);
        Compare(fields, "requiresDuplicateDetection", wanted.RequiresDuplicateDetection, actual.RequiresDuplicateDetection);
        Compare(fields, "duplicateDetectionHistoryTimeWindow", wanted.DuplicateDetectionHistoryTimeWindow, actual.DuplicateDetectionHistoryTimeWindow);
        Compare(fields, "maxSizeInMegabytes", wanted.MaxSizeInMegabytes, actual.MaxSizeInMegabytes);
        Compare(fields, "autoDeleteOnIdle", wanted.AutoDeleteOnIdle, actual.AutoDeleteOnIdle);
        Compare(fields, "enableBatchedOperations", wanted.EnableBatchedOperations, actual.EnableBatchedOperations);
        Compare(fields, "supportOrdering", wanted.SupportOrdering, actual.SupportOrdering);
        Compare(fields, "userMetadata", wanted.UserMetadata, actual.UserMetadata, StringComparison.Ordinal);
        Compare(fields, "status", wanted.Status, actual.Status, StringComparison.Ordinal);
        return fields;
    }

    private static List<string> SubscriptionDifferences(SubscriptionDefinition wanted, SubscriptionDefinition actual)
    {
        var fields = new List<string>();
        if (wanted.Options is { } options)
        {
            var current = actual.Options!;
            Compare(fields, "defaultMessageTimeToLive", options.DefaultMessageTimeToLive, current.DefaultMessageTimeToLive);
            Compare(fields, "lockDuration", options.LockDuration, current.LockDuration);
            Compare(fields, "maxDeliveryCount", options.MaxDeliveryCount, current.MaxDeliveryCount);
            Compare(fields, "requiresSession", options.RequiresSession, current.RequiresSession);
            Compare(fields, "deadLetteringOnMessageExpiration", options.DeadLetteringOnMessageExpiration, current.DeadLetteringOnMessageExpiration);
            Compare(fields, "deadLetteringOnFilterEvaluationExceptions", options.DeadLetteringOnFilterEvaluationExceptions, current.DeadLetteringOnFilterEvaluationExceptions);
            Compare(fields, "autoDeleteOnIdle", options.AutoDeleteOnIdle, current.AutoDeleteOnIdle);
            Compare(fields, "enableBatchedOperations", options.EnableBatchedOperations, current.EnableBatchedOperations);
            Compare(fields, "forwardTo", options.ForwardTo, current.ForwardTo, StringComparison.OrdinalIgnoreCase);
            Compare(fields, "forwardDeadLetteredMessagesTo", options.ForwardDeadLetteredMessagesTo, current.ForwardDeadLetteredMessagesTo, StringComparison.OrdinalIgnoreCase);
            Compare(fields, "userMetadata", options.UserMetadata, current.UserMetadata, StringComparison.Ordinal);
            Compare(fields, "status", options.Status, current.Status, StringComparison.Ordinal);
        }

        if (wanted.Rules is not null && CanonicalRules(wanted.Rules) != CanonicalRules(actual.Rules!))
            fields.Add("rules");
        return fields;
    }

    /// <summary>A setting the document gives that differs; a setting it leaves out is not compared.</summary>
    private static void Compare<T>(List<string> fields, string field, T? wanted, T? actual) where T : struct
    {
        if (wanted.HasValue && !wanted.Equals(actual)) fields.Add(field);
    }

    private static void Compare(List<string> fields, string field, bool wanted, bool actual)
    {
        if (wanted != actual) fields.Add(field);
    }

    /// <summary>An empty text and no text are the same setting: no forward target, no metadata.</summary>
    private static void Compare(List<string> fields, string field, string? wanted, string? actual, StringComparison comparison)
    {
        if (wanted is not null && !string.Equals(NullIfEmpty(wanted), NullIfEmpty(actual), comparison)) fields.Add(field);
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;

    /// <summary>
    /// The rules as one text that is equal for two lists holding the same rules: ordered by name, blank text as none,
    /// each property value as its parsed value.
    /// </summary>
    private static string CanonicalRules(IEnumerable<SubscriptionRuleInfo?> rules) => JsonSerializer.Serialize(
        rules.OfType<SubscriptionRuleInfo>()
            .OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
            .Select(r => new object?[]
            {
                r.Name?.ToUpperInvariant(), r.FilterType?.ToString(), NullIfBlank(r.SqlExpression), NullIfBlank(r.SqlAction),
                r.Correlation is not { } c ? null : new object?[]
                {
                    NullIfBlank(c.CorrelationId), NullIfBlank(c.MessageId), NullIfBlank(c.To), NullIfBlank(c.ReplyTo), NullIfBlank(c.Subject),
                    NullIfBlank(c.SessionId), NullIfBlank(c.ReplyToSessionId), NullIfBlank(c.ContentType),
                    (c.ApplicationProperties ?? []).OrderBy(p => p.Name, StringComparer.Ordinal)
                        .Select(p => new[] { p.Name, p.Type?.ToString(), Convert.ToString(EntityConfigurationValidator.ParsePropertyValue(p.Type, p.Value) ?? p.Value, CultureInfo.InvariantCulture) })
                }
            }));

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static async Task<List<TOut>> ReadAllAsync<TIn, TOut>(AsyncPageable<TIn> pages, Func<TIn, TOut> map) where TIn : notnull
    {
        var items = new List<TOut>();
        await foreach (var item in pages)
            items.Add(map(item));
        return items;
    }

    private static List<T?> ByName<T>(List<T> items, Func<T, string?> name) where T : class =>
        items.OrderBy(name, StringComparer.Ordinal).Cast<T?>().ToList();

    private static QueueDefinition ToDefinition(QueueProperties queue) => new()
    {
        Name = queue.Name,
        Options = new QueueCreateOptions
        {
            DefaultMessageTimeToLive = queue.DefaultMessageTimeToLive,
            LockDuration = queue.LockDuration,
            MaxDeliveryCount = queue.MaxDeliveryCount,
            RequiresSession = queue.RequiresSession,
            EnablePartitioning = queue.EnablePartitioning,
            DeadLetteringOnMessageExpiration = queue.DeadLetteringOnMessageExpiration,
            RequiresDuplicateDetection = queue.RequiresDuplicateDetection,
            DuplicateDetectionHistoryTimeWindow = queue.DuplicateDetectionHistoryTimeWindow,
            MaxSizeInMegabytes = queue.MaxSizeInMegabytes,
            AutoDeleteOnIdle = queue.AutoDeleteOnIdle,
            EnableBatchedOperations = queue.EnableBatchedOperations,
            ForwardTo = AzureServiceBusProvider.ToEntityPath(queue.ForwardTo) ?? string.Empty,
            ForwardDeadLetteredMessagesTo = AzureServiceBusProvider.ToEntityPath(queue.ForwardDeadLetteredMessagesTo) ?? string.Empty,
            UserMetadata = queue.UserMetadata ?? string.Empty,
            Status = queue.Status.ToString()
        }
    };

    private static TopicDefinition ToDefinition(TopicProperties topic) => new()
    {
        Name = topic.Name,
        Options = new TopicCreateOptions
        {
            DefaultMessageTimeToLive = topic.DefaultMessageTimeToLive,
            EnablePartitioning = topic.EnablePartitioning,
            RequiresDuplicateDetection = topic.RequiresDuplicateDetection,
            DuplicateDetectionHistoryTimeWindow = topic.DuplicateDetectionHistoryTimeWindow,
            MaxSizeInMegabytes = topic.MaxSizeInMegabytes,
            AutoDeleteOnIdle = topic.AutoDeleteOnIdle,
            EnableBatchedOperations = topic.EnableBatchedOperations,
            SupportOrdering = topic.SupportOrdering,
            UserMetadata = topic.UserMetadata ?? string.Empty,
            Status = topic.Status.ToString()
        }
    };

    private static SubscriptionDefinition ToDefinition(SubscriptionProperties subscription) => new()
    {
        Name = subscription.SubscriptionName,
        Options = new SubscriptionCreateOptions
        {
            DefaultMessageTimeToLive = subscription.DefaultMessageTimeToLive,
            LockDuration = subscription.LockDuration,
            MaxDeliveryCount = subscription.MaxDeliveryCount,
            RequiresSession = subscription.RequiresSession,
            DeadLetteringOnMessageExpiration = subscription.DeadLetteringOnMessageExpiration,
            DeadLetteringOnFilterEvaluationExceptions = subscription.EnableDeadLetteringOnFilterEvaluationExceptions,
            AutoDeleteOnIdle = subscription.AutoDeleteOnIdle,
            EnableBatchedOperations = subscription.EnableBatchedOperations,
            ForwardTo = AzureServiceBusProvider.ToEntityPath(subscription.ForwardTo) ?? string.Empty,
            ForwardDeadLetteredMessagesTo = AzureServiceBusProvider.ToEntityPath(subscription.ForwardDeadLetteredMessagesTo) ?? string.Empty,
            UserMetadata = subscription.UserMetadata ?? string.Empty,
            Status = subscription.Status.ToString()
        }
    };
}
