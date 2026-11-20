using System.ComponentModel;
using Microsoft.AspNetCore.Mvc;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>
/// The tools that move and remove messages: dead-letter, resubmit, move, delete, purge and cancel scheduled. Each acts on
/// the connection active in the app, offered at all, and always asks the user in the app first, whatever the
/// never-asked mark; capabilities refuse before anybody is asked. After the allow each runs the code path of its route,
/// with the same checks, bounds and the caller's token, and answers what the route answers. Nothing is retried.
/// </summary>
[McpServerToolType]
public sealed class McpRemoveTools(McpToolCalls calls, ILogger<McpRemoveTools> logger)
{
    /// <summary>The answer when the connection is not offered at all.</summary>
    public const string LevelRefused = "This connection is not offered for moving or removing messages. The user can change that in Settings, MCP server.";

    /// <summary>The answer when the provider names a message by its position instead of a broker identity.</summary>
    public const string PositionRefused = "This provider names a message by its position, which can change between the read and the call. Do this in the app, which checks it.";

    /// <summary>The answer when the provider declares no operations on chosen messages.</summary>
    public const string BulkRefused = "This provider does not support moving or removing chosen messages.";

    /// <summary>The answer of move_messages when its target is neither a queue nor a topic.</summary>
    public const string TargetNotFound = "The target was not found.";

    /// <summary>The most sequence numbers one call takes.</summary>
    public const int MaxSequenceNumbers = 100;

    private const string AskNote = " The user is always asked in the app first and may deny it. Operations are at least once: a message sent and not removed from its source is reported as a possible duplicate, never sent again.";
    private const string SequenceNumbersDescription = "The sequence numbers, 1 to 100, as numbers or numeric strings.";
    private const string ReasonDescription = "Why you want to do it; the user sees it. Required.";
    private const string SubscriptionDescription = "The subscription of the topic; omit it for a queue.";
    private const string EntityDescription = "The queue, or the topic when a subscription is given.";

    /// <summary>Moves active messages, named by their sequence numbers, to the dead-letter queue.</summary>
    [McpServerTool(Name = "dead_letter_messages", ReadOnly = false, Destructive = true, Idempotent = false, Title = "Dead-letter messages")]
    [Description("Moves active messages of a queue or a subscription, named by their sequence numbers, to its dead-letter queue." + AskNote + " Answers { successCount, failureCount, failures: [{ sequenceNumber, error, possibleDuplicate }], ... }.")]
    public Task<CallToolResult> DeadLetterMessages(
        McpServer server,
        [Description(EntityDescription)] string entity,
        [Description(SequenceNumbersDescription)] long[] sequenceNumbers,
        [Description(ReasonDescription)] string? reason = null,
        [Description(SubscriptionDescription)] string? subscription = null,
        [Description("The dead-letter reason the messages carry.")] string? deadLetterReason = null,
        [Description("The dead-letter description the messages carry.")] string? deadLetterDescription = null,
        CancellationToken cancellationToken = default)
    {
        var n = sequenceNumbers?.Length ?? 0;
        return calls.RunAsync(server, $"Dead-letter {Messages(n)}", logger, async call =>
        {
            McpToolCalls.RequireReason(call, reason);
            var target = await PrepareAsync(call, entity, subscription, "active", sequenceNumbers, numbered: true, bulk: false, MessageSubQueue.Active);
            if (!target.Active.Provider.Capabilities.SupportsManualDeadLetter)
                call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.ManualDeadLetterNotSupported()), "Refused: no dead-letter by sequence number");
            await LookupAsync(call, target);
            await AskAsync(call, target, reason, "deadLetter", $"asks to dead-letter {Messages(n)}", [], "The messages leave the active queue and wait in its dead-letter queue.",
                $"Dead-letter {Messages(n)}", danger: false, typed: false, cancellationToken);
            var request = new DeferredBatchRequest { SequenceNumbers = sequenceNumbers!, Reason = deadLetterReason, Description = deadLetterDescription };
            return Batch(call, await QueuesController.DeadLetterBatch(target.Active.Provider, logger, entity, subscription, request, cancellationToken), "dead-lettered");
        });
    }

    /// <summary>Resubmits dead-letter or transfer dead-letter messages to the entity they came from.</summary>
    [McpServerTool(Name = "resubmit_messages", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Resubmit messages")]
    [Description("Sends dead-letter or transfer dead-letter messages of a queue or a subscription, named by their sequence numbers, again: to the queue, or to the topic of the subscription, and then removes them from the dead-letter queue." + AskNote + " Answers { successCount, failureCount, failures, newMessageIds, ... }.")]
    public Task<CallToolResult> ResubmitMessages(
        McpServer server,
        [Description(EntityDescription)] string entity,
        [Description(SequenceNumbersDescription)] long[] sequenceNumbers,
        [Description(ReasonDescription)] string? reason = null,
        [Description(SubscriptionDescription)] string? subscription = null,
        [Description("deadLetter or transferDeadLetter.")] string subQueue = "deadLetter",
        [Description("True to give each message a new message id when the target detects duplicates.")] bool newMessageIds = false,
        CancellationToken cancellationToken = default)
    {
        var n = sequenceNumbers?.Length ?? 0;
        return calls.RunAsync(server, $"Resubmit {Messages(n)}", logger, async call =>
        {
            McpToolCalls.RequireReason(call, reason);
            var target = await PrepareAsync(call, entity, subscription, subQueue, sequenceNumbers, numbered: true, bulk: true, MessageSubQueue.DeadLetter, MessageSubQueue.TransferDeadLetter);
            await LookupAsync(call, target);
            var note = subscription is null
                ? $"Each message is sent to {target.Shown} again and then removed from the {Words(target.SubQueue)}. One that is sent and cannot be removed is reported as a possible duplicate."
                : $"Each message is published to the topic {McpToolCalls.Clean(target.Entity, 100)} again, so every subscription it matches receives it, and is then removed from the {Words(target.SubQueue)}. One that is sent and cannot be removed is reported as a possible duplicate.";
            await AskAsync(call, target, reason, "resubmit", $"asks to resubmit {Messages(n)}", [], note, $"Resubmit {Messages(n)}", danger: false, typed: false, cancellationToken);
            var request = new ResubmitBatchRequest { SequenceNumbers = sequenceNumbers!, NewMessageIdOnDuplicateDetection = newMessageIds };
            return Batch(call, await QueuesController.ResubmitBatch(target.Active.Provider, logger, entity, subscription, request, target.SubQueue!.Value, cancellationToken), "resubmitted");
        });
    }

    /// <summary>Moves messages to a queue: sends each there, then removes it from its source.</summary>
    [McpServerTool(Name = "move_messages", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Move messages")]
    [Description("Moves messages of a queue or a subscription, named by their sequence numbers, to another queue: each is sent there and then removed from its source." + AskNote + " Answers { successCount, failureCount, failures, newMessageIds, ... }.")]
    public Task<CallToolResult> MoveMessages(
        McpServer server,
        [Description(EntityDescription)] string entity,
        [Description(SequenceNumbersDescription)] long[] sequenceNumbers,
        [Description("The queue the messages go to.")] string target,
        [Description(ReasonDescription)] string? reason = null,
        [Description(SubscriptionDescription)] string? subscription = null,
        [Description("active, deadLetter or transferDeadLetter.")] string subQueue = "active",
        CancellationToken cancellationToken = default)
    {
        var n = sequenceNumbers?.Length ?? 0;
        return calls.RunAsync(server, $"Move {Messages(n)}", logger, async call =>
        {
            McpToolCalls.RequireReason(call, reason);
            var source = await PrepareAsync(call, entity, subscription, subQueue, sequenceNumbers, numbered: true, bulk: true, MessageSubQueue.Active, MessageSubQueue.DeadLetter, MessageSubQueue.TransferDeadLetter);
            await LookupAsync(call, source);
            McpToolCalls.RequireExactNames(call, target);
            var provider = source.Active.Provider;
            if (await provider.GetQueueAsync(target) is null
                && (!provider.Capabilities.SupportsTopics || await provider.GetTopicAsync(target, cancellationToken) is null))
                call.Refuse(TargetNotFound, "Refused: target not found");
            var shownTarget = McpToolCalls.Clean(target, 100);
            await AskAsync(call, source, reason, "move", $"asks to move {Messages(n)}", [new McpFact("To", shownTarget)],
                $"Each message is sent to {shownTarget} and then removed from its source. One that is sent and cannot be removed is reported as a possible duplicate.",
                $"Move {Messages(n)}", danger: false, typed: false, cancellationToken);
            var request = new MoveBatchRequest { SequenceNumbers = sequenceNumbers!, TargetQueueName = target ?? "" };
            return Batch(call, await QueuesController.MoveBatch(source.Active.Provider, logger, entity, subscription, request, source.SubQueue!.Value, cancellationToken), "moved");
        });
    }

    /// <summary>Deletes messages named by their sequence numbers.</summary>
    [McpServerTool(Name = "delete_messages", ReadOnly = false, Destructive = true, Idempotent = false, Title = "Delete messages")]
    [Description("Deletes messages of a queue or a subscription, from its active, dead-letter or transfer dead-letter queue, named by their sequence numbers. The user is always asked in the app first, types the name of the queue or the subscription to allow it, and may deny it. A deleted message cannot be brought back. Answers { successCount, failureCount, failures, ... }.")]
    public Task<CallToolResult> DeleteMessages(
        McpServer server,
        [Description(EntityDescription)] string entity,
        [Description("active, deadLetter or transferDeadLetter.")] string subQueue,
        [Description(SequenceNumbersDescription)] long[] sequenceNumbers,
        [Description(ReasonDescription)] string? reason = null,
        [Description(SubscriptionDescription)] string? subscription = null,
        CancellationToken cancellationToken = default)
    {
        var n = sequenceNumbers?.Length ?? 0;
        return calls.RunAsync(server, $"Delete {Messages(n)}", logger, async call =>
        {
            McpToolCalls.RequireReason(call, reason);
            var target = await PrepareAsync(call, entity, subscription, subQueue, sequenceNumbers, numbered: true, bulk: true, MessageSubQueue.Active, MessageSubQueue.DeadLetter, MessageSubQueue.TransferDeadLetter);
            await LookupAsync(call, target);
            await AskAsync(call, target, reason, "delete", $"asks to delete {Messages(n)}", [], "A deleted message cannot be brought back. Only the messages named by their sequence numbers are removed.",
                $"Delete {Messages(n)}", danger: true, typed: true, cancellationToken);
            var request = new DeleteBatchRequest { SequenceNumbers = sequenceNumbers! };
            return Batch(call, await QueuesController.DeleteBatch(target.Active.Provider, logger, entity, subscription, request, target.SubQueue!.Value, cancellationToken), "deleted");
        });
    }

    /// <summary>Removes every message of the active or the dead-letter queue of a queue or a subscription.</summary>
    [McpServerTool(Name = "purge_messages", ReadOnly = false, Destructive = true, Idempotent = false, Title = "Purge messages")]
    [Description("Removes every message of the active or the dead-letter queue of a queue or a subscription. The user is always asked in the app first, types the name of the queue or the subscription to allow it, and may deny it. A purged message cannot be brought back. Answers { success }.")]
    public Task<CallToolResult> PurgeMessages(
        McpServer server,
        [Description(EntityDescription)] string entity,
        [Description("active or deadLetter.")] string subQueue,
        [Description(ReasonDescription)] string? reason = null,
        [Description(SubscriptionDescription)] string? subscription = null,
        CancellationToken cancellationToken = default)
    {
        var what = subscription is null ? "the queue" : "the subscription";
        return calls.RunAsync(server, $"Purge {what}", logger, async call =>
        {
            McpToolCalls.RequireReason(call, reason);
            var target = await PrepareAsync(call, entity, subscription, subQueue, null, numbered: false, bulk: false, MessageSubQueue.Active, MessageSubQueue.DeadLetter);
            var counted = await LookupAsync(call, target);
            var count = target.Active.Provider.Capabilities.SupportsMessageCounts ? counted : null;
            await AskAsync(call, target, reason, "purge", $"asks to purge {target.Shown}",
                [new McpFact("Messages", count is { } c ? $"All of them: {c} counted now" : "All of them: this broker gives no count")],
                "Every message there is removed and cannot be brought back.", $"Purge {what}", danger: true, typed: true, cancellationToken);
            var result = await QueuesController.Purge(target.Active.Provider, logger, entity, subscription, target.SubQueue!.Value, cancellationToken);
            var answer = Unwrap(call, result);
            call.Outcome = count is { } before ? $"Purged, {before} counted before" : "Purged";
            return answer;
        });
    }

    /// <summary>Cancels scheduled messages of a queue or a topic.</summary>
    [McpServerTool(Name = "cancel_scheduled_messages", ReadOnly = false, Destructive = true, Idempotent = false, Title = "Cancel scheduled messages")]
    [Description("Cancels scheduled messages of a queue or a topic, named by their sequence numbers: each is removed and never delivered. The user is always asked in the app first and may deny it. Answers { successCount, failureCount, failures, ... }.")]
    public Task<CallToolResult> CancelScheduledMessages(
        McpServer server,
        [Description("The queue or the topic.")] string entity,
        [Description(SequenceNumbersDescription)] long[] sequenceNumbers,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default)
    {
        var n = sequenceNumbers?.Length ?? 0;
        var scheduled = n == 1 ? "1 scheduled message" : $"{n} scheduled messages";
        return calls.RunAsync(server, $"Cancel {scheduled}", logger, async call =>
        {
            McpToolCalls.RequireReason(call, reason);
            var target = await PrepareAsync(call, entity, null, null, sequenceNumbers, numbered: true, bulk: false);
            var provider = target.Active.Provider;
            if (!provider.Capabilities.SupportsScheduledMessages)
                call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.ScheduledMessagesNotSupported()), "Refused: no scheduled messages");
            if (await provider.GetQueueAsync(entity) is null
                && (!provider.Capabilities.SupportsTopics || await provider.GetTopicAsync(entity, cancellationToken) is null))
                call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("entity")), "Refused: not found");
            await AskAsync(call, target, reason, "cancelScheduled", $"asks to cancel {scheduled}", [], "A cancelled message is removed and is never delivered.",
                $"Cancel {Messages(n)}", danger: true, typed: false, cancellationToken);
            var request = new CancelScheduledRequest { SequenceNumbers = sequenceNumbers! };
            return Batch(call, await QueuesController.CancelScheduled(provider, logger, entity, request, cancellationToken), "cancelled");
        });
    }

    /// <summary>What a call acts on, once the checks before the question held.</summary>
    private sealed record Target(McpActive Active, string Entity, string? Subscription, MessageSubQueue? SubQueue, long[]? SequenceNumbers)
    {
        /// <summary>The entity, and its subscription, as the request shows them.</summary>
        public string Shown => Subscription is null ? McpToolCalls.Clean(Entity, 100) : $"{McpToolCalls.Clean(Entity, 100)} / {McpToolCalls.Clean(Subscription, 100)}";
    }

    /// <summary>
    /// The checks before anything is asked, in order: the connection offered at all, the sub-queue among
    /// <paramref name="allowed"/>, a provider that names a message by a broker identity, 1 to
    /// <see cref="MaxSequenceNumbers"/> sequence numbers, and the capabilities the sub-queue and the operation need.
    /// A null <paramref name="subQueue"/> is the scheduled messages; a call that is not <paramref name="numbered"/> takes no
    /// sequence numbers.
    /// </summary>
    private async Task<Target> PrepareAsync(McpToolCalls.ToolCall call, string entity, string? subscription, string? subQueue, long[]? sequenceNumbers, bool numbered, bool bulk, params MessageSubQueue[] allowed)
    {
        var active = await calls.ActiveAsync(call, entity);
        var provider = active.Provider;
        var target = new Target(active, entity, subscription, null, sequenceNumbers);

        if (!McpSettingsStore.Covers(active.Level, McpSettingsStore.AllLevel))
            call.Refuse(LevelRefused, "Refused: not offered for moving or removing");
        McpToolCalls.RequireExactNames(call, entity, subscription);
        MessageSubQueue? queue = null;
        if (subQueue is not null)
        {
            queue = ParseSubQueue(subQueue);
            if (queue is null || !allowed.Contains(queue.Value))
                call.Refuse($"subQueue must be {string.Join(", ", allowed.Select(Name).SkipLast(1))} or {Name(allowed[^1])}.", "Refused: unknown sub-queue");
            target = target with { SubQueue = queue };
        }
        call.Where = $"{target.Shown} ({(queue is null ? "scheduled" : Words(queue))}) on {active.Connection.Name}";

        if (numbered)
        {
            if (!provider.Capabilities.SupportsSequenceNumbers)
                call.Refuse(PositionRefused, "Refused: named by position");
            if (sequenceNumbers is not { Length: >= 1 and <= MaxSequenceNumbers })
                call.Refuse($"sequenceNumbers must hold 1 to {MaxSequenceNumbers} sequence numbers.", "Refused: count");
        }
        if (subscription is not null && !provider.Capabilities.SupportsSubscriptions)
            call.Refuse("This provider does not support subscriptions.", "Refused: no subscriptions");
        if (queue == MessageSubQueue.DeadLetter && !provider.Capabilities.SupportsDeadLetterQueue)
            call.Refuse("This provider does not support the dead-letter queue.", "Refused: no dead-letter queue");
        if (queue is { } q && EntityAdministrationResults.SubQueueNotSupported(provider, q) is { } noTransfer)
            call.Refuse(McpToolCalls.MessageOf(noTransfer), "Refused: no transfer dead-letter queue");
        if (bulk && !provider.Capabilities.SupportsBulkMessageOperations)
            call.Refuse(BulkRefused, "Refused: no bulk operations");
        return target;
    }

    /// <summary>
    /// The queue, or the subscription, read once before the question; refused as not found when it does not exist.
    /// Answers the count of its sub-queue as the broker gives it.
    /// </summary>
    private static async Task<long?> LookupAsync(McpToolCalls.ToolCall call, Target target)
    {
        var provider = target.Active.Provider;
        long? count = null;
        if (target.Subscription is null)
        {
            if (await provider.GetQueueAsync(target.Entity) is { } queue)
                count = target.SubQueue == MessageSubQueue.DeadLetter ? queue.DeadLetterMessageCount : queue.ActiveMessageCount;
            else
                call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("queue")), "Refused: not found");
        }
        else if (await provider.GetSubscriptionAsync(target.Entity, target.Subscription) is { } subscription)
            count = target.SubQueue == MessageSubQueue.DeadLetter ? subscription.DeadLetterMessageCount : subscription.ActiveMessageCount;
        else
            call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("subscription")), "Refused: not found");
        return count;
    }

    /// <summary>Asks the user with the facts every request of these tools carries; the call needs the level all after the allow.</summary>
    private async Task AskAsync(McpToolCalls.ToolCall call, Target target, string reason, string kind, string title, IReadOnlyList<McpFact> extra, string note, string allowLabel, bool danger, bool typed, CancellationToken cancellationToken)
    {
        List<McpFact> facts = [new McpFact("From", $"{target.Shown}, {(target.SubQueue is null ? "scheduled" : Words(target.SubQueue))}")];
        facts.AddRange(extra.Where(f => f.Label == "To"));
        facts.Add(new McpFact("On", await calls.OnAsync(target.Active.Connection)));
        facts.Add(extra.FirstOrDefault(f => f.Label == "Messages") ?? new McpFact("Messages", Numbers(target.SequenceNumbers!)));
        facts.Add(new McpFact("It said why", McpToolCalls.Reason(reason)));
        await calls.AskAsync(call, target.Active, kind, $"{call.Assistant} {title}", facts, note, allowLabel, McpSettingsStore.AllLevel, cancellationToken, danger,
            typed ? new McpTyped(target.Subscription is null ? "Type the queue name to allow it" : "Type the subscription name to allow it", McpToolCalls.Clean(target.Subscription ?? target.Entity, 100)) : null);
    }

    /// <summary>The route's answer as the tool's: its value when it is 200, else its fixed sentence as a refusal after the allow.</summary>
    private static object Unwrap(McpToolCalls.ToolCall call, ActionResult result)
    {
        if (result is OkObjectResult ok) return ok.Value!;
        call.Refuse(McpToolCalls.MessageOf((ObjectResult)result), "Failed, allowed by you");
        return null!;
    }

    /// <summary>The route's batch result, with how many were done and how many not in the record.</summary>
    private static object Batch(McpToolCalls.ToolCall call, ActionResult result, string verb)
    {
        var answer = (BatchOperationResult)Unwrap(call, result);
        call.Outcome = answer.FailureCount == 0 ? $"{answer.SuccessCount} {verb}" : $"{answer.SuccessCount} {verb}, {answer.FailureCount} not {verb}";
        if (answer.FailureCount > 0) call.Kind = "error";
        return answer;
    }

    private static string Messages(int n) => n == 1 ? "1 message" : $"{n} messages";

    private static string Numbers(long[] sequenceNumbers) => sequenceNumbers.Length == 1
        ? $"1, sequence number {sequenceNumbers[0]}"
        : $"{sequenceNumbers.Length}, sequence numbers {sequenceNumbers.Min()} to {sequenceNumbers.Max()}";

    private static string Words(MessageSubQueue? subQueue) => subQueue switch
    {
        MessageSubQueue.DeadLetter => "dead-letter queue",
        MessageSubQueue.TransferDeadLetter => "transfer dead-letter queue",
        _ => "active",
    };

    private static string Name(MessageSubQueue subQueue) => subQueue switch
    {
        MessageSubQueue.DeadLetter => "deadLetter",
        MessageSubQueue.TransferDeadLetter => "transferDeadLetter",
        _ => "active",
    };

    private static MessageSubQueue? ParseSubQueue(string value) => value.ToLowerInvariant() switch
    {
        "active" => MessageSubQueue.Active,
        "deadletter" => MessageSubQueue.DeadLetter,
        "transferdeadletter" => MessageSubQueue.TransferDeadLetter,
        _ => null,
    };
}
