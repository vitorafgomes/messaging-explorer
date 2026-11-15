namespace ServiceBusExplorer.Core.Models;

public class SendMessageRequest
{
    public string Body { get; set; } = string.Empty;

    /// <summary>
    /// <see cref="MessageBodyEncoding.Text"/> (or null) to send <see cref="Body"/> as UTF-8 text,
    /// <see cref="MessageBodyEncoding.Base64"/> to send the bytes it encodes, for a provider that declares
    /// <see cref="Abstractions.IProviderCapabilities.SupportsBinaryBody"/>.
    /// </summary>
    public string? BodyEncoding { get; set; }
    public string ContentType { get; set; } = "application/json";
    public string? MessageId { get; set; }
    public string? CorrelationId { get; set; }
    public string? SessionId { get; set; }
    public string? PartitionKey { get; set; }
    public string? Subject { get; set; }
    public string? To { get; set; }
    public string? ReplyTo { get; set; }
    public TimeSpan? TimeToLive { get; set; }
    public DateTimeOffset? ScheduledEnqueueTime { get; set; }
    public Dictionary<string, object>? ApplicationProperties { get; set; }
}
