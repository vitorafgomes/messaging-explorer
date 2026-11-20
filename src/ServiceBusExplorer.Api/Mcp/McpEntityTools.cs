using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>
/// The tools that create, change and delete queues, topics, subscriptions and subscription rules. Each acts on the
/// connection active in the app, offered at all, and always asks the user in the app first, whatever the never-asked
/// mark; the capabilities, the shape of the name and the lookups the request needs refuse before anybody is asked.
/// After the allow each runs the body of its route and answers what the route answers. Nothing is retried.
/// </summary>
[McpServerToolType]
public sealed class McpEntityTools(McpToolCalls calls, ILogger<McpEntityTools> logger)
{
    /// <summary>The answer when the connection is not offered at all.</summary>
    public const string LevelRefused = "This connection is not offered for changing entities. The user can change that in Settings, MCP server.";

    /// <summary>What a create or a delete whose route answers no body answers.</summary>
    public static readonly object Success = new { success = true };

    /// <summary>How many characters of a value a fact of a request shows before "...".</summary>
    public const int MaxFactLength = 200;

    private const string AskNote = " The user is always asked in the app first and may deny it.";
    private const string DeleteNote = " The user is always asked in the app first, types the name to allow it, and may deny it.";
    private const string ReasonDescription = "Why you want to do it; the user sees it. Required.";
    private const string TopicDescription = "The topic.";
    private const string SubscriptionDescription = "The subscription of the topic.";
    private const string TimeSpanNote = " Durations are written as d.hh:mm:ss.";
    private const string StatusNote = " status is Active, Disabled, SendDisabled or ReceiveDisabled, as the entity allows.";
    private const string RuleDescription = "The rule: filterType Sql, Correlation, True or False; sqlExpression for Sql; correlation { correlationId, messageId, to, replyTo, subject, sessionId, replyToSessionId, contentType, applicationProperties: [{ name, type, value }] } for Correlation; sqlAction, optional.";

    private static readonly JsonSerializerOptions FactJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly Dictionary<string, string> DeleteNotes = new()
    {
        ["queue"] = "The queue and every message in it are removed and cannot be brought back.",
        ["topic"] = "The topic, its subscriptions and every message in them are removed and cannot be brought back.",
        ["subscription"] = "The subscription and every message in it are removed and cannot be brought back.",
        ["rule"] = "The rule is removed. If it was the last rule, the subscription receives nothing until another is added.",
    };

    /// <summary>Creates a queue.</summary>
    [McpServerTool(Name = "create_queue", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Create a queue")]
    [Description("Creates a queue, with the broker's defaults for every option not given." + AskNote + TimeSpanNote + " Answers { success }.")]
    public Task<CallToolResult> CreateQueue(
        McpServer server,
        [Description("The name of the queue.")] string name,
        [Description("The options of the queue; omit for the broker's defaults.")] QueueCreateBody? options = null,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Create", "queue", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "queue", name, null, null, update: false, cancellationToken);
            await AskAsync(call, active, "create", "queue", name, null, null, Options(options), reason!, cancellationToken);
            return Done(call, await QueuesController.Add(active.Provider, logger, new CreateQueueRequest { Name = name, Options = options }), "Created");
        });

    /// <summary>Changes the settings or the status of a queue.</summary>
    [McpServerTool(Name = "update_queue", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Change a queue")]
    [Description("Changes only the settings given of a queue, its status included." + StatusNote + AskNote + TimeSpanNote + " Answers the queue as read after the change.")]
    public Task<CallToolResult> UpdateQueue(
        McpServer server,
        [Description("The name of the queue.")] string name,
        [Description("The settings to change; a setting not given stays as it is.")] QueueUpdateOptions options,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Change", "queue", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "queue", name, null, null, update: true, cancellationToken);
            await AskAsync(call, active, "change", "queue", name, null, null, Sets(options), reason!, cancellationToken);
            return Done(call, await QueuesController.Change(active.Provider, logger, name, options ?? new(), cancellationToken), "Changed");
        });

    /// <summary>Deletes a queue and every message in it.</summary>
    [McpServerTool(Name = "delete_queue", ReadOnly = false, Destructive = true, Idempotent = false, Title = "Delete a queue")]
    [Description("Deletes a queue and every message in it." + DeleteNote + " A deleted queue cannot be brought back. Answers { success }.")]
    public Task<CallToolResult> DeleteQueue(
        McpServer server,
        [Description("The name of the queue.")] string name,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Delete", "queue", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "queue", name, null, null, update: false, cancellationToken);
            var queue = await active.Provider.GetQueueAsync(name);
            if (queue is null) call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("queue")), "Refused: not found");
            var holds = active.Provider.Capabilities.SupportsMessageCounts
                ? $"{queue.ActiveMessageCount} active and {queue.DeadLetterMessageCount} dead-letter messages counted now"
                : "This broker gives no count";
            await AskAsync(call, active, "delete", "queue", name, null, null, [new McpFact("Holds", holds)], reason!, cancellationToken);
            return Done(call, await QueuesController.Remove(active.Provider, name), "Deleted");
        });

    /// <summary>Creates a topic.</summary>
    [McpServerTool(Name = "create_topic", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Create a topic")]
    [Description("Creates a topic, with the broker's defaults for every option not given." + AskNote + TimeSpanNote + " Answers { success }.")]
    public Task<CallToolResult> CreateTopic(
        McpServer server,
        [Description("The name of the topic.")] string name,
        [Description("The options of the topic; omit for the broker's defaults.")] TopicCreateBody? options = null,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Create", "topic", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "topic", name, null, null, update: false, cancellationToken);
            await AskAsync(call, active, "create", "topic", name, null, null, Options(options), reason!, cancellationToken);
            return Done(call, await TopicsController.Add(active.Provider, logger, new CreateTopicRequest { Name = name, Options = options }), "Created");
        });

    /// <summary>Changes the settings or the status of a topic.</summary>
    [McpServerTool(Name = "update_topic", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Change a topic")]
    [Description("Changes only the settings given of a topic, its status included." + StatusNote + AskNote + TimeSpanNote + " Answers the topic as read after the change.")]
    public Task<CallToolResult> UpdateTopic(
        McpServer server,
        [Description("The name of the topic.")] string name,
        [Description("The settings to change; a setting not given stays as it is.")] TopicUpdateOptions options,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Change", "topic", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "topic", name, null, null, update: true, cancellationToken);
            await AskAsync(call, active, "change", "topic", name, null, null, Sets(options), reason!, cancellationToken);
            return Done(call, await TopicsController.Change(active.Provider, logger, name, options ?? new(), cancellationToken), "Changed");
        });

    /// <summary>Deletes a topic, its subscriptions and every message in them.</summary>
    [McpServerTool(Name = "delete_topic", ReadOnly = false, Destructive = true, Idempotent = false, Title = "Delete a topic")]
    [Description("Deletes a topic, its subscriptions and every message in them." + DeleteNote + " A deleted topic cannot be brought back. Answers { success }.")]
    public Task<CallToolResult> DeleteTopic(
        McpServer server,
        [Description("The name of the topic.")] string name,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Delete", "topic", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "topic", name, null, null, update: false, cancellationToken);
            var topic = await active.Provider.GetTopicAsync(name, cancellationToken);
            if (topic is null) call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("topic")), "Refused: not found");
            var holds = topic.SubscriptionCount == 1 ? "1 subscription" : $"{topic.SubscriptionCount} subscriptions";
            await AskAsync(call, active, "delete", "topic", name, null, null, [new McpFact("Holds", holds)], reason!, cancellationToken);
            return Done(call, await TopicsController.Remove(active.Provider, name), "Deleted");
        });

    /// <summary>Creates a subscription of a topic.</summary>
    [McpServerTool(Name = "create_subscription", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Create a subscription")]
    [Description("Creates a subscription of a topic, with the broker's default rule and the broker's defaults for every option not given." + AskNote + TimeSpanNote + " Answers { success }.")]
    public Task<CallToolResult> CreateSubscription(
        McpServer server,
        [Description(TopicDescription)] string topic,
        [Description("The name of the subscription.")] string name,
        [Description("The options of the subscription; omit for the broker's defaults.")] SubscriptionCreateBody? options = null,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Create", "subscription", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "subscription", name, topic, null, update: false, cancellationToken);
            await AskAsync(call, active, "create", "subscription", name, topic, null, Options(options), reason!, cancellationToken);
            return Done(call, await TopicsController.AddSubscription(active.Provider, logger, topic, new CreateSubscriptionRequest { Name = name, Options = options }), "Created");
        });

    /// <summary>Changes the settings or the status of a subscription.</summary>
    [McpServerTool(Name = "update_subscription", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Change a subscription")]
    [Description("Changes only the settings given of a subscription, its status included; an empty forwardTo clears it." + StatusNote + AskNote + TimeSpanNote + " Answers the subscription as read after the change.")]
    public Task<CallToolResult> UpdateSubscription(
        McpServer server,
        [Description(TopicDescription)] string topic,
        [Description("The name of the subscription.")] string name,
        [Description("The settings to change; a setting not given stays as it is.")] SubscriptionUpdateOptions options,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Change", "subscription", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "subscription", name, topic, null, update: true, cancellationToken);
            await AskAsync(call, active, "change", "subscription", name, topic, null, Sets(options), reason!, cancellationToken);
            return Done(call, await TopicsController.ChangeSubscription(active.Provider, logger, topic, name, options ?? new(), cancellationToken), "Changed");
        });

    /// <summary>Deletes a subscription and every message in it.</summary>
    [McpServerTool(Name = "delete_subscription", ReadOnly = false, Destructive = true, Idempotent = false, Title = "Delete a subscription")]
    [Description("Deletes a subscription of a topic and every message in it." + DeleteNote + " A deleted subscription cannot be brought back. Answers { success }.")]
    public Task<CallToolResult> DeleteSubscription(
        McpServer server,
        [Description(TopicDescription)] string topic,
        [Description("The name of the subscription.")] string name,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Delete", "subscription", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "subscription", name, topic, null, update: false, cancellationToken, parent: false);
            var subscription = await active.Provider.GetSubscriptionAsync(topic, name);
            if (subscription is null) call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("subscription")), "Refused: not found");
            var holds = active.Provider.Capabilities.SupportsMessageCounts
                ? $"{subscription.ActiveMessageCount} active and {subscription.DeadLetterMessageCount} dead-letter messages counted now"
                : "This broker gives no count";
            await AskAsync(call, active, "delete", "subscription", name, topic, null, [new McpFact("Holds", holds)], reason!, cancellationToken);
            return Done(call, await TopicsController.RemoveSubscription(active.Provider, topic, name), "Deleted");
        });

    /// <summary>Adds a rule to a subscription.</summary>
    [McpServerTool(Name = "create_rule", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Create a subscription rule")]
    [Description("Adds a rule to a subscription of a topic." + AskNote + " Answers the rule as the broker answered it.")]
    public Task<CallToolResult> CreateRule(
        McpServer server,
        [Description(TopicDescription)] string topic,
        [Description(SubscriptionDescription)] string subscription,
        [Description("The name of the rule.")] string name,
        [Description(RuleDescription)] SubscriptionRuleRequest rule,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Create", "rule", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "rule", name, topic, subscription, update: false, cancellationToken, rule: rule);
            await AskAsync(call, active, "create", "rule", name, topic, subscription, Rule(rule, ""), reason!, cancellationToken);
            rule.Name = name;
            return Done(call, await TopicsController.AddRule(active.Provider, logger, topic, subscription, rule, cancellationToken), "Created");
        });

    /// <summary>Replaces the filter and the action of a rule.</summary>
    [McpServerTool(Name = "update_rule", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Change a subscription rule")]
    [Description("Replaces the filter and the action of a rule of a subscription; a rule cannot be renamed." + AskNote + " Answers the rule as the broker answered it.")]
    public Task<CallToolResult> UpdateRule(
        McpServer server,
        [Description(TopicDescription)] string topic,
        [Description(SubscriptionDescription)] string subscription,
        [Description("The name of the rule.")] string name,
        [Description(RuleDescription)] SubscriptionRuleRequest rule,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Change", "rule", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "rule", name, topic, subscription, update: true, cancellationToken, rule: rule);
            await AskAsync(call, active, "change", "rule", name, topic, subscription, Rule(rule, "Sets "), reason!, cancellationToken);
            return Done(call, await TopicsController.ChangeRule(active.Provider, logger, topic, subscription, name, rule, cancellationToken), "Changed");
        });

    /// <summary>Deletes a rule of a subscription.</summary>
    [McpServerTool(Name = "delete_rule", ReadOnly = false, Destructive = true, Idempotent = false, Title = "Delete a subscription rule")]
    [Description("Deletes a rule of a subscription of a topic; a subscription without a rule receives nothing." + DeleteNote + " Answers { success }.")]
    public Task<CallToolResult> DeleteRule(
        McpServer server,
        [Description(TopicDescription)] string topic,
        [Description(SubscriptionDescription)] string subscription,
        [Description("The name of the rule.")] string name,
        [Description(ReasonDescription)] string? reason = null,
        CancellationToken cancellationToken = default) =>
        calls.RunAsync(server, Asked("Delete", "rule", name), logger, async call =>
        {
            var active = await PrepareAsync(call, reason, "rule", name, topic, subscription, update: false, cancellationToken);
            await AskAsync(call, active, "delete", "rule", name, topic, subscription, [], reason!, cancellationToken);
            return Done(call, await TopicsController.RemoveRule(active.Provider, logger, topic, subscription, name, cancellationToken), "Deleted");
        });

    /// <summary>
    /// The checks before anything is asked, in order: a reason, the connection offered at all, the capabilities the
    /// route needs, the name as the route takes it, and the topic or the subscription it goes in, read once.
    /// A delete of a subscription reads the subscription itself instead of its topic.
    /// </summary>
    private async Task<McpActive> PrepareAsync(McpToolCalls.ToolCall call, string? reason, string kind, string name, string? topic, string? subscription, bool update, CancellationToken cancellationToken, bool parent = true, SubscriptionRuleRequest? rule = null)
    {
        McpToolCalls.RequireReason(call, reason);
        var active = await calls.ActiveAsync(call);
        call.Where = topic is null ? active.Connection.Name : $"{In(topic, subscription)} on {active.Connection.Name}";
        if (!McpSettingsStore.Covers(active.Level, McpSettingsStore.AllLevel))
            call.Refuse(LevelRefused, "Refused: not offered for changing entities");

        var provider = active.Provider;
        var capabilities = provider.Capabilities;
        if (kind != "queue" && !capabilities.SupportsTopics)
            call.Refuse("This provider does not support topics.", "Refused: no topics");
        if (kind is "subscription" or "rule" && !capabilities.SupportsSubscriptions)
            call.Refuse("This provider does not support subscriptions.", "Refused: no subscriptions");
        if (kind == "rule" && !capabilities.SupportsSubscriptionRules)
            call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.RulesNotSupported()), "Refused: no rules");
        if (update && kind != "rule" && !capabilities.SupportsEntityUpdate)
            call.Refuse(EntityAdministrationResults.UpdateNotSupported, "Refused: no update");

        if (string.IsNullOrWhiteSpace(name))
            call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NameRequired()), "Refused: no name");
        McpToolCalls.RequireExactNames(call, name, topic, subscription);
        if (rule?.Name is { } named && named != name)
            call.Refuse(TopicsController.RuleRenamed, "Refused: another rule name");

        if (parent && kind == "subscription" && await provider.GetTopicAsync(topic!, cancellationToken) is null)
            call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("topic")), "Refused: not found");
        if (kind == "rule" && await provider.GetSubscriptionAsync(topic!, subscription!) is null)
            call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("subscription")), "Refused: not found");
        return active;
    }

    /// <summary>
    /// Asks the user, with the facts On, In, <paramref name="details"/> and It said why, every value cut at
    /// <see cref="MaxFactLength"/>. A delete is dangerous and asks for the name typed. The call needs the level all
    /// after the allow.
    /// </summary>
    private async Task AskAsync(McpToolCalls.ToolCall call, McpActive active, string verb, string kind, string name, string? topic, string? subscription, List<McpFact> details, string reason, CancellationToken cancellationToken)
    {
        List<McpFact> facts = [new McpFact("On", Cut(await calls.OnAsync(active.Connection)))];
        if (topic is not null) facts.Add(new McpFact("In", Cut(subscription is null ? $"the topic {topic}" : $"{topic} / {subscription}")));
        facts.AddRange(details);
        facts.Add(new McpFact("It said why", Cut(reason)));
        var (requestKind, note, delete) = verb switch
        {
            "create" => ("createEntity", $"A new {kind} is created on the broker.", false),
            "change" => ("updateEntity", "Only the settings listed are changed. A setting the broker does not allow to change is refused by the broker.", false),
            _ => ("deleteEntity", DeleteNotes[kind], true),
        };
        var label = char.ToUpperInvariant(verb[0]) + verb[1..];
        await calls.AskAsync(call, active, requestKind, $"{call.Assistant} asks to {verb} the {kind} {McpToolCalls.Clean(name, 100)}", facts, note, $"{label} the {kind}",
            McpSettingsStore.AllLevel, cancellationToken, danger: delete,
            typed: delete ? new McpTyped($"Type the {kind} name to allow it", McpToolCalls.Clean(name, 260)) : null);
    }

    /// <summary>The route's answer as the tool's: its body, or <see cref="Success"/> when it has none; its fixed sentence as a refusal after the allow when it is not a success.</summary>
    private static object Done(McpToolCalls.ToolCall call, ActionResult result, string outcome)
    {
        if (result is ObjectResult { StatusCode: >= 400 } failed)
            call.Refuse(McpToolCalls.MessageOf(failed), "Failed, allowed by you");
        call.Outcome = outcome;
        return result is ObjectResult { Value: { } value } ? value : Success;
    }

    /// <summary>One fact per option set, named as the route's model names it; "Options" "The broker's defaults" when none is.</summary>
    private static List<McpFact> Options(object? options)
    {
        var facts = Settings(options, "");
        return facts.Count > 0 ? facts : [new McpFact("Options", "The broker's defaults")];
    }

    /// <summary>One fact "Sets field" per setting an update gives.</summary>
    private static List<McpFact> Sets(object? options) => Settings(options, "Sets ");

    private static List<McpFact> Settings(object? options, string prefix)
    {
        if (options is null) return [];
        return JsonSerializer.SerializeToElement(options, options.GetType(), FactJson).EnumerateObject()
            .Select(p => new McpFact(prefix + p.Name, Cut(p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.GetRawText())))
            .ToList();
    }

    /// <summary>The filter of a rule as one line, then its action when it has one.</summary>
    private static List<McpFact> Rule(SubscriptionRuleRequest rule, string prefix)
    {
        var filter = rule.FilterType switch
        {
            "Sql" => rule.SqlExpression ?? "",
            "Correlation" => $"Correlation {JsonSerializer.Serialize(rule.Correlation, FactJson)}",
            { } other => other,
            null => "No filter given",
        };
        List<McpFact> facts = [new McpFact(prefix == "" ? "Filter" : "Sets filter", Cut(filter))];
        if (!string.IsNullOrWhiteSpace(rule.SqlAction)) facts.Add(new McpFact(prefix + "sqlAction", Cut(rule.SqlAction)));
        return facts;
    }

    /// <summary>Text without control characters, cut at <see cref="MaxFactLength"/> characters with "..." after the cut.</summary>
    private static string Cut(string? text)
    {
        var kept = McpToolCalls.Clean(text, int.MaxValue);
        return kept.Length > MaxFactLength ? kept[..MaxFactLength] + "..." : kept;
    }

    private static string In(string topic, string? subscription) =>
        subscription is null ? McpToolCalls.Clean(topic, 100) : $"{McpToolCalls.Clean(topic, 100)} / {McpToolCalls.Clean(subscription, 100)}";

    private static string Asked(string verb, string kind, string name) => $"{verb} the {kind} {McpToolCalls.Clean(name, 100)}";
}
