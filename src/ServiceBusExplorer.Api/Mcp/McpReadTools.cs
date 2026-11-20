using System.ComponentModel;
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Api.Logs;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>
/// The tools of the first phase: they read and change nothing. Each one but list_connections and read_logs acts on
/// the connection active in the app, and only when the user offered it; otherwise it is refused with one sentence
/// that names no connection. Every call, answered or refused, is recorded in <see cref="McpActivityLog"/>.
/// </summary>
[McpServerToolType]
public sealed class McpReadTools(
    McpSettingsStore settings,
    McpActivityLog activity,
    IConnectionManager connections,
    IConnectionGroupManager groups,
    RecentLogStore logs,
    ILogger<McpReadTools> logger)
{
    /// <summary>The answer when nothing offered is active: the same whether nothing is connected or what is connected is not offered.</summary>
    public const string NotOffered = "No connection offered to assistants is active in the app. Ask the user to connect to one they offered.";

    /// <summary>The answer of read_logs while the user has not allowed it.</summary>
    public const string LogsRefused = "The user has not allowed assistants to read the logs of this app. Ask the user to allow it in Settings, MCP server.";

    /// <summary>How many characters of a message body a peek answers.</summary>
    public const int MaxBodyLength = 8000;

    private const string ThisApp = "This app";

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    /// <summary>The connections the user offered to assistants, and which one is active in the app.</summary>
    [McpServerTool(Name = "list_connections", ReadOnly = true, Title = "List the offered connections")]
    [Description("Lists the connections the user offered to assistants: id, name, provider, target, and which one is active in the app. Connections that are not offered are not listed.")]
    public Task<string> ListConnections(McpServer server) => Call(server, "List the offered connections", async call =>
    {
        var activeId = ConnectionsController.GetCurrent().ConnectionId;
        var offered = settings.Current.Connections;
        var stored = (await connections.GetConnectionsAsync()).Where(c => offered.ContainsKey(c.Id)).ToList();
        call.Kind = "plain";
        call.Outcome = $"{stored.Count} listed";
        return stored.Select(c => new
        {
            id = c.Id,
            name = c.Name,
            providerType = c.ProviderType.ToString(),
            target = TargetOf(c),
            level = offered[c.Id],
            active = c.Id == activeId,
        });
    });

    /// <summary>The queues of the active offered connection with their counts.</summary>
    [McpServerTool(Name = "list_queues", ReadOnly = true, Title = "List queues")]
    [Description("Lists the queues of the connection active in the app, with the message counts the broker gives.")]
    public Task<string> ListQueues(McpServer server) => Call(server, "List queues", async call =>
    {
        var provider = await ActiveAsync(call);
        var queues = (await provider.GetQueuesAsync()).ToList();
        call.Outcome = $"{queues.Count} listed";
        return queues.Select(q => new
        {
            name = q.Name,
            status = q.Status,
            activeMessageCount = q.ActiveMessageCount,
            deadLetterMessageCount = q.DeadLetterMessageCount,
            scheduledMessageCount = q.ScheduledMessageCount,
            transferMessageCount = q.TransferMessageCount,
            transferDeadLetterMessageCount = q.TransferDeadLetterMessageCount,
        });
    });

    /// <summary>The topics of the active offered connection.</summary>
    [McpServerTool(Name = "list_topics", ReadOnly = true, Title = "List topics")]
    [Description("Lists the topics of the connection active in the app, with their subscription and scheduled message counts.")]
    public Task<string> ListTopics(McpServer server) => Call(server, "List topics", async call =>
    {
        var provider = await ActiveAsync(call);
        if (!provider.Capabilities.SupportsTopics) call.Refuse("This provider does not support topics.", "Refused: no topics");
        var topics = (await provider.GetTopicsAsync()).ToList();
        call.Outcome = $"{topics.Count} listed";
        return topics.Select(t => new
        {
            name = t.Name,
            status = t.Status,
            subscriptionCount = t.SubscriptionCount,
            scheduledMessageCount = t.ScheduledMessageCount,
        });
    });

    /// <summary>The subscriptions of a topic of the active offered connection with their counts.</summary>
    [McpServerTool(Name = "list_subscriptions", ReadOnly = true, Title = "List subscriptions")]
    [Description("Lists the subscriptions of a topic of the connection active in the app, with the message counts the broker gives.")]
    public Task<string> ListSubscriptions(McpServer server, [Description("The topic.")] string topic) => Call(server, "List subscriptions", async call =>
    {
        var provider = await ActiveAsync(call, topic);
        if (!provider.Capabilities.SupportsSubscriptions) call.Refuse("This provider does not support subscriptions.", "Refused: no subscriptions");
        var subscriptions = (await provider.GetSubscriptionsAsync(topic)).ToList();
        call.Outcome = $"{subscriptions.Count} listed";
        return subscriptions.Select(s => new
        {
            name = s.Name,
            status = s.Status,
            activeMessageCount = s.ActiveMessageCount,
            deadLetterMessageCount = s.DeadLetterMessageCount,
            scheduledMessageCount = s.ScheduledMessageCount,
            transferMessageCount = s.TransferMessageCount,
            transferDeadLetterMessageCount = s.TransferDeadLetterMessageCount,
        });
    });

    /// <summary>The rules of a subscription of the active offered connection, when the provider has rules.</summary>
    [McpServerTool(Name = "list_rules", ReadOnly = true, Title = "List subscription rules")]
    [Description("Lists the filter rules of a subscription of the connection active in the app.")]
    public Task<string> ListRules(McpServer server, [Description("The topic.")] string topic, [Description("The subscription.")] string subscription, CancellationToken cancellationToken) =>
        Call(server, "List rules", async call =>
        {
            var provider = await ActiveAsync(call, $"{topic}/{subscription}");
            if (!provider.Capabilities.SupportsSubscriptionRules) call.Refuse(MessageOf(EntityAdministrationResults.RulesNotSupported()), "Refused: no rules");
            var rules = await provider.GetRulesAsync(topic, subscription, cancellationToken);
            call.Outcome = $"{rules.Count} listed";
            return rules;
        });

    /// <summary>
    /// Reads messages of an entity of the active offered connection without locking or removing them; each body is
    /// cut at <see cref="MaxBodyLength"/> characters.
    /// </summary>
    [McpServerTool(Name = "peek_messages", ReadOnly = true, Title = "Peek messages")]
    [Description("Reads messages of a queue, or of a subscription of a topic, of the connection active in the app, without locking or removing them. A body longer than 8000 characters is cut and marked bodyTruncated.")]
    public Task<string> PeekMessages(
        McpServer server,
        [Description("The queue, or the topic when a subscription is given.")] string entity,
        [Description("The subscription of the topic; omit it for a queue.")] string? subscription = null,
        [Description("active, deadLetter or transferDeadLetter.")] string subQueue = "active",
        [Description("How many messages, 1 to 50.")] int count = 10,
        [Description("The first sequence number to read; omit it to read from the head.")] long? fromSequenceNumber = null,
        CancellationToken cancellationToken = default)
    {
        count = Math.Clamp(count, 1, 50);
        return Call(server, $"Peek {count} messages", async call =>
        {
            var where = subscription is null ? entity : $"{entity}/{subscription}";
            var provider = await ActiveAsync(call, $"{where} ({subQueue})");
            if (ParseSubQueue(subQueue) is not { } queue)
            {
                call.Refuse("subQueue must be active, deadLetter or transferDeadLetter.", "Refused: unknown sub-queue");
                return null;
            }
            if (subscription is not null && !provider.Capabilities.SupportsSubscriptions)
                call.Refuse("This provider does not support subscriptions.", "Refused: no subscriptions");
            if (queue == MessageSubQueue.DeadLetter && !provider.Capabilities.SupportsDeadLetterQueue)
                call.Refuse("This provider does not support the dead-letter queue.", "Refused: no dead-letter queue");
            if (EntityAdministrationResults.SubQueueNotSupported(provider, queue) is { } noTransfer)
                call.Refuse(MessageOf(noTransfer), "Refused: no transfer dead-letter queue");
            if (EntityAdministrationResults.PeekPosition(provider, queue, fromSequenceNumber?.ToString(CultureInfo.InvariantCulture), out var from) is { } badPosition)
                call.Refuse(MessageOf(badPosition), "Refused: position");

            var messages = (await provider.PeekMessagesAsync(entity, count, queue, subscription, from, includeBody: true, cancellationToken)).ToList();
            call.Outcome = $"{messages.Count} read";
            return messages.Select(m => new
            {
                sequenceNumber = m.SequenceNumber,
                messageId = m.MessageId,
                enqueuedTime = m.EnqueuedTime,
                deliveryCount = m.DeliveryCount,
                state = m.State,
                contentType = m.ContentType,
                subject = m.Subject,
                correlationId = m.CorrelationId,
                sessionId = m.SessionId,
                sizeInBytes = m.SizeInBytes,
                deadLetterReason = m.DeadLetterReason,
                deadLetterErrorDescription = m.DeadLetterErrorDescription,
                applicationProperties = m.ApplicationProperties,
                bodyEncoding = m.BodyEncoding,
                body = m.Body is { Length: > MaxBodyLength } cut ? cut[..MaxBodyLength] : m.Body,
                bodyTruncated = m.Body is { Length: > MaxBodyLength },
            });
        });
    }

    /// <summary>The lines of the backend's log, newest first, when the user allowed it.</summary>
    [McpServerTool(Name = "read_logs", ReadOnly = true, Title = "Read the logs of the app")]
    [Description("Reads the lines the backend of the app logged, newest first. They carry no secret, no message body and no exception text. Needs the user's permission in Settings.")]
    public Task<string> ReadLogs(
        McpServer server,
        [Description("The lowest level to answer: Information, Warning, Error or Critical.")] string? level = null,
        [Description("Only lines whose text contains this, ignoring case.")] string? contains = null,
        [Description("How many lines, 1 to 200.")] int limit = 50)
    {
        limit = Math.Clamp(limit, 1, 200);
        return Call(server, $"Read {limit} log lines", call =>
        {
            if (!settings.Current.LogsAllowed) call.Refuse(LogsRefused, "Refused: logs not allowed");
            LogLevel? lowest = null;
            if (level is not null)
            {
                if (!Enum.TryParse<LogLevel>(level, ignoreCase: true, out var parsed) || !Enum.IsDefined(parsed))
                    call.Refuse("level must be Trace, Debug, Information, Warning, Error or Critical.", "Refused: unknown level");
                lowest = parsed;
            }

            var lines = logs.After(0)
                .Where(l => lowest is null || (Enum.TryParse<LogLevel>(l.Level, out var lineLevel) && lineLevel >= lowest))
                .Where(l => contains is null || l.Text.Contains(contains, StringComparison.OrdinalIgnoreCase))
                .Reverse()
                .Take(limit)
                .ToList();
            call.Kind = "plain";
            call.Outcome = $"{lines.Count} read";
            return Task.FromResult<object?>(lines);
        });
    }

    /// <summary>
    /// True when the environment <paramref name="connection"/> belongs to is marked as production. This phase never
    /// offers such a connection and never reads one.
    /// </summary>
    internal static async Task<bool> IsProductionAsync(IConnectionGroupManager groups, ServiceBusConnection connection) =>
        connection.EnvironmentId is { } environmentId && (await groups.GetGroupAsync(environmentId))?.IsProduction == true;

    private static string? TargetOf(ServiceBusConnection connection) => connection.ProviderType == ProviderType.RabbitMQ
        ? $"{connection.HostName ?? "localhost"}:{connection.Port ?? 5672}"
        : connection.Namespace ?? connection.FullyQualifiedNamespace;

    private static MessageSubQueue? ParseSubQueue(string value) => value.ToLowerInvariant() switch
    {
        "active" => MessageSubQueue.Active,
        "deadletter" => MessageSubQueue.DeadLetter,
        "transferdeadletter" => MessageSubQueue.TransferDeadLetter,
        _ => null,
    };

    private static string MessageOf(ObjectResult result) =>
        (string)result.Value!.GetType().GetProperty("message")!.GetValue(result.Value)!;

    private static string FailureSentence(Exception ex) => ex switch
    {
        EntityDisabledException => MessageOf(EntityAdministrationResults.EntityDisabled()),
        MessageReadFailedException => ex.Message,
        EntityNotFoundException => MessageOf(EntityAdministrationResults.NotFound("entity")),
        _ => MessageOf(EntityAdministrationResults.Unhandled(ex)),
    };

    private async Task<string> Call(McpServer server, string asked, Func<ToolCall, Task<object?>> work)
    {
        var call = new ToolCall();
        var assistant = server.ClientInfo?.Name is { Length: > 0 } name ? (name.Length > 100 ? name[..100] : name) : "Assistant";
        void Record(string kind) => activity.Add(new McpActivity(DateTimeOffset.UtcNow, assistant, asked, call.Where, call.Outcome, kind));

        try
        {
            var answer = await work(call);
            Record(call.Kind);
            return JsonSerializer.Serialize(answer, JsonOptions);
        }
        catch (McpException)
        {
            Record("error");
            throw;
        }
        catch (OperationCanceledException)
        {
            call.Outcome = "Cancelled";
            Record("error");
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "An MCP tool call failed: {Asked} ({ExceptionType})", asked, ex.GetType().Name);
            call.Outcome = "Failed";
            Record("error");
            throw new McpException(FailureSentence(ex));
        }
    }

    private async Task<IMessagingProvider> ActiveAsync(ToolCall call, string? entity = null)
    {
        var (provider, connectionId) = ConnectionsController.GetCurrent();
        if (provider is null || settings.LevelOf(connectionId) != McpSettingsStore.ReadLevel)
            call.Refuse(NotOffered, "Refused: not offered");
        var connection = await connections.GetConnectionAsync(connectionId!);
        if (connection is null || await IsProductionAsync(groups, connection))
            call.Refuse(NotOffered, "Refused: not offered");
        call.Where = entity is null ? connection.Name : $"{entity} on {connection.Name}";
        return provider;
    }

    /// <summary>Where a call acts and how it ended, filled in as the call goes.</summary>
    private sealed class ToolCall
    {
        public string Where { get; set; } = ThisApp;

        public string Outcome { get; set; } = "Refused";

        public string Kind { get; set; } = "ok";

        [System.Diagnostics.CodeAnalysis.DoesNotReturn]
        public void Refuse(string sentence, string outcome)
        {
            Outcome = outcome;
            throw new McpException(sentence);
        }
    }
}
