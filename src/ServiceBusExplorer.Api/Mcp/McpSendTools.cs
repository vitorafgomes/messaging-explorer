using System.ComponentModel;
using System.Text;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>One message of send_messages: what send_message takes but the entity and the reason.</summary>
public sealed class McpOutgoingMessage
{
    /// <summary>The body, sent as UTF-8 text.</summary>
    [Description("The body, sent as UTF-8 text.")]
    public string Body { get; set; } = "";

    /// <summary>The content type; application/json when omitted.</summary>
    [Description("The content type; application/json when omitted.")]
    public string? ContentType { get; set; }

    /// <summary>The subject, or label; on RabbitMQ the routing key of a send to an exchange.</summary>
    [Description("The subject, or label; on RabbitMQ the routing key of a send to an exchange.")]
    public string? Subject { get; set; }

    /// <summary>The message id.</summary>
    [Description("The message id.")]
    public string? MessageId { get; set; }

    /// <summary>The correlation id.</summary>
    [Description("The correlation id.")]
    public string? CorrelationId { get; set; }

    /// <summary>The session id, for a broker that has sessions.</summary>
    [Description("The session id, for a broker that has sessions.")]
    public string? SessionId { get; set; }

    /// <summary>Application properties, names to text values.</summary>
    [Description("Application properties, names to text values.")]
    public Dictionary<string, string>? ApplicationProperties { get; set; }

    /// <summary>When the broker should enqueue it, in UTC, for a broker that schedules messages.</summary>
    [Description("When the broker should enqueue it, in UTC, for a broker that schedules messages.")]
    public DateTimeOffset? ScheduledEnqueueTimeUtc { get; set; }
}

/// <summary>
/// The sending tools. Each sends to a queue or a topic of the connection active in the app, offered at readAndSend,
/// through the provider calls and the checks of the send routes. It asks the user in the app first, unless the
/// connection is a local test broker the user marked as never asked; nothing is sent before the answer, after a
/// denial or without an answer. A message the broker did not accept is reported as not sent and never retried.
/// </summary>
[McpServerToolType]
public sealed class McpSendTools(McpToolCalls calls, ILogger<McpSendTools> logger)
{
    /// <summary>The answer when the connection is offered for reading only.</summary>
    public const string ReadOnlyRefused = "This connection is offered for reading only. The user can change that in Settings, MCP server.";

    /// <summary>The most messages one send_messages call takes.</summary>
    public const int MaxMessages = 100;

    private const string AskNote = " The user is asked in the app first and may deny it, unless they marked the broker as a local test broker; a message sent cannot be taken back.";

    /// <summary>Sends one message to a queue or a topic of the active offered connection.</summary>
    [McpServerTool(Name = "send_message", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Send a message")]
    [Description("Sends one message to a queue or a topic of the connection active in the app, when the user offered it for sending." + AskNote + " Answers { success, sequenceNumber }; the sequence number only for a scheduled message.")]
    public Task<CallToolResult> SendMessage(
        McpServer server,
        [Description("The queue or the topic.")] string entity,
        [Description("The body, sent as UTF-8 text.")] string body,
        [Description("Why you want to send it; the user sees it.")] string reason,
        [Description("The content type; application/json when omitted.")] string? contentType = null,
        [Description("The subject, or label; on RabbitMQ the routing key of a send to an exchange.")] string? subject = null,
        [Description("The message id.")] string? messageId = null,
        [Description("The correlation id.")] string? correlationId = null,
        [Description("The session id, for a broker that has sessions.")] string? sessionId = null,
        [Description("Application properties, names to text values.")] Dictionary<string, string>? applicationProperties = null,
        [Description("When the broker should enqueue it, in UTC, for a broker that schedules messages.")] DateTimeOffset? scheduledEnqueueTimeUtc = null,
        CancellationToken cancellationToken = default)
    {
        var message = new McpOutgoingMessage
        {
            Body = body, ContentType = contentType, Subject = subject, MessageId = messageId, CorrelationId = correlationId,
            SessionId = sessionId, ApplicationProperties = applicationProperties, ScheduledEnqueueTimeUtc = scheduledEnqueueTimeUtc,
        };
        return calls.RunAsync(server, "Send 1 message", logger, async call =>
        {
            var (active, requests) = await PrepareAsync(call, entity, [message], reason, cancellationToken);
            var sequenceNumber = await active.Provider.SendMessageAsync(entity, requests[0]);
            call.Outcome = "1 sent";
            return new { success = true, sequenceNumber };
        });
    }

    /// <summary>Sends 1 to <see cref="MaxMessages"/> messages to a queue or a topic of the active offered connection.</summary>
    [McpServerTool(Name = "send_messages", ReadOnly = false, Destructive = false, Idempotent = false, Title = "Send messages")]
    [Description("Sends 1 to 100 messages to a queue or a topic of the connection active in the app, when the user offered it for sending." + AskNote + " Answers { success, count, failures: [{ index, error }] }: what was sent stays sent, and each message not sent, or not confirmed, is named by its position.")]
    public Task<CallToolResult> SendMessages(
        McpServer server,
        [Description("The queue or the topic.")] string entity,
        [Description("The messages, 1 to 100.")] McpOutgoingMessage[] messages,
        [Description("Why you want to send them; the user sees it.")] string reason,
        CancellationToken cancellationToken = default)
    {
        var count = messages?.Length ?? 0;
        return calls.RunAsync(server, count == 1 ? "Send 1 message" : $"Send {count} messages", logger, async call =>
        {
            var (active, requests) = await PrepareAsync(call, entity, messages ?? [], reason, cancellationToken);
            var result = await active.Provider.SendMessagesAsync(entity, requests, cancellationToken);
            call.Outcome = result.Success ? $"{result.SentCount} sent" : $"{result.SentCount} sent, {result.Failures.Count} not sent";
            if (!result.Success) call.Kind = "error";
            return new { success = result.Success, count = result.SentCount, failures = result.Failures };
        });
    }

    /// <summary>
    /// Everything before the provider sends, in order: the connection offered for sending, the messages accepted as the
    /// send routes accept them, the entity found as a queue or a topic, the capabilities they need, and the user's
    /// answer when the connection must ask. Any of these refuses the call and nothing is sent.
    /// </summary>
    private async Task<(McpActive Active, List<SendMessageRequest> Requests)> PrepareAsync(
        McpToolCalls.ToolCall call, string entity, IReadOnlyList<McpOutgoingMessage> messages, string reason, CancellationToken cancellationToken)
    {
        var active = await calls.ActiveAsync(call, entity);
        var provider = active.Provider;
        if (!McpSettingsStore.Covers(active.Level, McpSettingsStore.ReadAndSendLevel))
            call.Refuse(ReadOnlyRefused, "Refused: read only");
        if (messages.Count is < 1 or > MaxMessages)
            call.Refuse($"send_messages takes 1 to {MaxMessages} messages.", "Refused: count");

        var requests = messages.Select(ToRequest).ToList();
        if (EntityAdministrationResults.BodyNotAccepted(provider, requests) is { } bodyRefused)
            call.Refuse(McpToolCalls.MessageOf(bodyRefused), "Refused: body");
        if (requests.Any(r => r.ScheduledEnqueueTime is not null) && !provider.Capabilities.SupportsScheduledMessages)
            call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.ScheduledMessagesNotSupported()), "Refused: no scheduled messages");
        if (requests.Any(r => !string.IsNullOrEmpty(r.SessionId)) && !provider.Capabilities.SupportsSessions)
            call.Refuse("This provider does not support sessions.", "Refused: no sessions");

        bool isQueue = await provider.GetQueueAsync(entity) is not null;
        if (!isQueue && !provider.Capabilities.SupportsTopics)
            call.Refuse("This provider does not support topics.", "Refused: no topics");
        if (!isQueue && await provider.GetTopicAsync(entity, cancellationToken) is null)
            call.Refuse(McpToolCalls.MessageOf(EntityAdministrationResults.NotFound("entity")), "Refused: not found");

        if (active.Production || !active.NeverAsk)
        {
            var n = requests.Count;
            var shown = McpToolCalls.Clean(entity, 100);
            var contentTypes = requests.Select(r => string.IsNullOrEmpty(r.ContentType) ? "no content type" : McpToolCalls.Clean(r.ContentType, 100)).Distinct().ToList();
            var bytes = requests.Sum(r => (long)Encoding.UTF8.GetByteCount(r.Body));
            await calls.AskAsync(
                call,
                active,
                "send",
                n == 1 ? $"{call.Assistant} asks to send 1 message" : $"{call.Assistant} asks to send {n} messages",
                [
                    new McpFact("To", isQueue ? $"{shown}, a queue" : $"{shown}, a topic"),
                    new McpFact("On", await calls.OnAsync(active.Connection)),
                    new McpFact("Messages", $"{n}, {string.Join(" and ", contentTypes)}, {bytes} bytes in all"),
                    new McpFact("It said why", McpToolCalls.Reason(reason)),
                ],
                isQueue
                    ? "Every consumer of this queue receives these messages. A message sent cannot be taken back."
                    : "Every subscription of this topic that these messages match receives them. A message sent cannot be taken back.",
                n == 1 ? "Send 1 message" : $"Send {n} messages",
                McpSettingsStore.ReadAndSendLevel,
                cancellationToken);
        }

        return (active, requests);
    }

    private static SendMessageRequest ToRequest(McpOutgoingMessage message)
    {
        var request = new SendMessageRequest
        {
            Body = message.Body ?? "",
            Subject = message.Subject,
            MessageId = message.MessageId,
            CorrelationId = message.CorrelationId,
            SessionId = message.SessionId,
            ApplicationProperties = message.ApplicationProperties?.ToDictionary(p => p.Key, p => (object)p.Value),
            ScheduledEnqueueTime = message.ScheduledEnqueueTimeUtc,
        };
        if (message.ContentType is not null) request.ContentType = message.ContentType;
        return request;
    }
}
