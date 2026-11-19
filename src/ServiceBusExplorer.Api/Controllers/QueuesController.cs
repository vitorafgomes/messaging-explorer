using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Controllers;

[ApiController, RawTargetRouteValues]
[Route("api/[controller]")]
public class QueuesController : ControllerBase
{
    private readonly ILogger<QueuesController> _logger;

    public QueuesController(ILogger<QueuesController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Gets the current messaging provider from ConnectionsController.
    /// Returns null if no provider is connected.
    /// </summary>
    private static IMessagingProvider? GetProvider() => ConnectionsController.GetCurrentProvider();

    /// <summary>
    /// Returns a BadRequest response indicating no provider is connected.
    /// </summary>
    private ActionResult NoProviderConnected()
    {
        return BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<IQueueEntity>>> GetQueues()
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var queues = await provider.GetQueuesAsync();
        return Ok(queues);
    }

    [HttpGet("{name}")]
    public async Task<ActionResult<IQueueEntity>> GetQueue(string name)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var queue = await provider.GetQueueAsync(name);
        if (queue == null)
            return NotFound();

        return Ok(queue);
    }

    [HttpPost]
    public async Task<ActionResult> CreateQueue([FromBody] CreateQueueRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        if (string.IsNullOrWhiteSpace(request.Name))
            return EntityAdministrationResults.NameRequired();

        var options = request.Options?.ToOptions();

        var name = request.Name;
        try
        {
            if (options == null)
                await provider.CreateQueueAsync(name);
            else
                await provider.CreateQueueAsync(name, options);
            return CreatedAtAction(nameof(GetQueue), new { name }, null);
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "queue", name, "queue");
        }
    }

    [HttpPatch("{name}")]
    public async Task<ActionResult<IQueueEntity>> UpdateQueue(string name, [FromBody] QueueUpdateOptions options)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.UpdateQueueAsync(name, options, HttpContext.RequestAborted);
            var queue = await provider.GetQueueAsync(name);
            return queue == null ? EntityAdministrationResults.NotFound("queue") : Ok(queue);
        }
        catch (NotSupportedException)
        {
            return EntityAdministrationResults.NotSupported();
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "queue", name, "queue");
        }
    }

    [HttpDelete("{name}")]
    public async Task<ActionResult> DeleteQueue(string name)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        await provider.DeleteQueueAsync(name);
        return NoContent();
    }

    [HttpPost("{name}/messages/search")]
    public Task<ActionResult<MessageSearchResult>> SearchMessages(string name, [FromBody] MessageSearchRequest request) =>
        Search(name, request, MessageSubQueue.Active);

    [HttpPost("{name}/deadletter/search")]
    public Task<ActionResult<MessageSearchResult>> SearchDeadLetterMessages(string name, [FromBody] MessageSearchRequest request) =>
        Search(name, request, MessageSubQueue.DeadLetter);

    [HttpPost("{name}/transferdeadletter/search")]
    public Task<ActionResult<MessageSearchResult>> SearchTransferDeadLetterMessages(string name, [FromBody] MessageSearchRequest request) =>
        Search(name, request, MessageSubQueue.TransferDeadLetter);

    private async Task<ActionResult<MessageSearchResult>> Search(string name, MessageSearchRequest request, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null) return NoProviderConnected();
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;
        if (EntityAdministrationResults.SearchNotSupported(provider) is { } cannotSearch) return cannotSearch;
        try
        {
            var result = await provider.SearchMessagesAsync(name, request, subQueue, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Search {SubQueue} messages failed for queue {QueueName}", subQueue, name);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpGet("{name}/messages")]
    public Task<ActionResult<IEnumerable<IMessage>>> PeekMessages(string name, [FromQuery] int count = 10, [FromQuery] string? fromSequenceNumber = null) =>
        Peek(name, count, MessageSubQueue.Active, fromSequenceNumber, null);

    [HttpGet("{name}/deadletter")]
    public Task<ActionResult<IEnumerable<IMessage>>> PeekDeadLetterMessages(string name, [FromQuery] int count = 10, [FromQuery] string? fromSequenceNumber = null, [FromQuery] string? includeBody = null) =>
        Peek(name, count, MessageSubQueue.DeadLetter, fromSequenceNumber, includeBody);

    [HttpGet("{name}/transferdeadletter")]
    public Task<ActionResult<IEnumerable<IMessage>>> PeekTransferDeadLetterMessages(string name, [FromQuery] int count = 10, [FromQuery] string? fromSequenceNumber = null, [FromQuery] string? includeBody = null) =>
        Peek(name, count, MessageSubQueue.TransferDeadLetter, fromSequenceNumber, includeBody);

    private async Task<ActionResult<IEnumerable<IMessage>>> Peek(string name, int count, MessageSubQueue subQueue, string? fromSequenceNumber, string? includeBody)
    {
        count = Math.Clamp(count, 1, 1000);

        var provider = GetProvider();
        if (provider == null) return NoProviderConnected();
        if (EntityAdministrationResults.PeekPosition(provider, subQueue, fromSequenceNumber, out var from) is { } refused) return refused;
        if (EntityAdministrationResults.IncludeBody(includeBody, out var withBody) is { } badBody) return badBody;
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;

        try
        {
            var messages = await provider.PeekMessagesAsync(name, count, subQueue, fromSequenceNumber: from, includeBody: withBody, cancellationToken: HttpContext.RequestAborted);
            return Ok(messages);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (MessageReadFailedException ex)
        {
            return EntityAdministrationResults.ReadFailed(ex, _logger, name, subQueue);
        }
    }

    [HttpPost("{name}/messages")]
    public async Task<ActionResult> SendMessage(string name, [FromBody] SendMessageRequest message)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();
        if (EntityAdministrationResults.BodyNotAccepted(provider, [message]) is { } refused)
            return refused;

        try
        {
            var sequenceNumber = await provider.SendMessageAsync(name, message);
            return Ok(new { success = true, sequenceNumber });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// The most messages one batch send accepts. A request is one HTTP body the user picked from a file; the cap bounds
    /// how long one request holds the sender and how much a mistaken file can put on a broker.
    /// </summary>
    internal const int MaxSendBatch = 1000;

    [HttpPost("{name}/messages/batch")]
    public Task<ActionResult> SendMessages(string name, [FromBody] List<SendMessageRequest> messages) =>
        SendBatch(this, name, messages, HttpContext.RequestAborted);

    /// <summary>
    /// The batch send of a queue and of a topic: 1 to <see cref="MaxSendBatch"/> messages or 400 before the provider is
    /// called, 409 for a disabled entity, and the count sent with one failure per message not sent.
    /// </summary>
    internal static async Task<ActionResult> SendBatch(ControllerBase controller, string name, List<SendMessageRequest> messages, CancellationToken cancellationToken)
    {
        var provider = GetProvider();
        if (provider == null)
            return controller.BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (messages.Count is < 1 or > MaxSendBatch)
            return controller.BadRequest(new { message = $"A batch send holds 1 to {MaxSendBatch} messages." });
        if (EntityAdministrationResults.BodyNotAccepted(provider, messages) is { } refused)
            return refused;

        try
        {
            var result = await provider.SendMessagesAsync(name, messages, cancellationToken);
            return controller.Ok(new { success = result.Success, count = result.SentCount, failures = result.Failures });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
    }

    [HttpPost("{name}/messages/receive")]
    public async Task<ActionResult<IEnumerable<IMessage>>> ReceiveMessages(string name, [FromQuery] int count = 10)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var messages = await provider.ReceiveMessagesAsync(name, count);
            return Ok(messages);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (MessageReadFailedException ex)
        {
            return EntityAdministrationResults.ReadFailed(ex, _logger, name, MessageSubQueue.Active);
        }
    }

    [HttpPost("{name}/messages/cancel-scheduled")]
    public Task<ActionResult> CancelScheduledMessages(string name, [FromBody] CancelScheduledRequest request) =>
        CancelScheduled(this, _logger, name, request, HttpContext.RequestAborted);

    /// <summary>
    /// The cancel of scheduled messages of a queue and of a topic: 400 when the provider declares no scheduled messages
    /// or refuses the sequence numbers, 409 for a disabled entity, the constant 500 for any other failure, and the
    /// result per sequence number otherwise.
    /// </summary>
    internal static async Task<ActionResult> CancelScheduled(ControllerBase controller, ILogger logger, string name, CancelScheduledRequest request, CancellationToken cancellationToken)
    {
        var provider = GetProvider();
        if (provider == null)
            return controller.BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (!provider.Capabilities.SupportsScheduledMessages)
            return EntityAdministrationResults.ScheduledMessagesNotSupported();

        try
        {
            var result = await provider.CancelScheduledMessagesAsync(name, request.SequenceNumbers, cancellationToken);
            return controller.Ok(result);
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return controller.BadRequest(new { message = ex.Message });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Cancel scheduled messages failed for {EntityName}", name);
            return controller.StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/deferred/delete-batch")]
    public Task<ActionResult> DeleteDeferredMessages(string name, [FromBody] DeferredBatchRequest request) =>
        DeferredBatch(this, _logger, name, request, p => p.DeleteDeferredMessagesAsync(name, request.SequenceNumbers, cancellationToken: HttpContext.RequestAborted));

    [HttpPost("{name}/deferred/resubmit-batch")]
    public Task<ActionResult> ResubmitDeferredMessages(string name, [FromBody] DeferredBatchRequest request) =>
        DeferredBatch(this, _logger, name, request, p => p.ResubmitDeferredMessagesAsync(name, request.SequenceNumbers, newMessageIdOnDuplicateDetection: request.NewMessageIdOnDuplicateDetection, cancellationToken: HttpContext.RequestAborted));

    [HttpPost("{name}/deferred/deadletter-batch")]
    public Task<ActionResult> DeadLetterDeferredMessages(string name, [FromBody] DeferredBatchRequest request) =>
        DeferredBatch(this, _logger, name, request, p => p.DeadLetterDeferredMessagesAsync(name, request.SequenceNumbers, reason: request.Reason, description: request.Description, cancellationToken: HttpContext.RequestAborted));

    /// <summary>
    /// The delete, resubmit and dead-letter of deferred messages of a queue and of a subscription: 400 when the provider
    /// declares no deferral or the request holds no sequence number or more than
    /// <see cref="DeferredBatchRequest.MaxSequenceNumbers"/>, both before the provider is called; 400 with the
    /// provider's text when it refuses the numbers, 409 for a disabled entity, the constant 500 for anything else, and
    /// the result per sequence number otherwise.
    /// </summary>
    internal static async Task<ActionResult> DeferredBatch(ControllerBase controller, ILogger logger, string entityPath, DeferredBatchRequest request, Func<IMessagingProvider, Task<BatchOperationResult>> operation)
    {
        var provider = GetProvider();
        if (provider == null)
            return controller.BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (!provider.Capabilities.SupportsDeferral)
            return EntityAdministrationResults.DeferralNotSupported();
        if (request.SequenceNumbers is not { Length: >= 1 and <= DeferredBatchRequest.MaxSequenceNumbers })
            return controller.BadRequest(new { message = $"sequenceNumbers must hold 1 to {DeferredBatchRequest.MaxSequenceNumbers} sequence numbers." });

        try
        {
            return controller.Ok(await operation(provider));
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return controller.BadRequest(new { message = ex.Message });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Deferred messages batch failed for {EntityPath}", entityPath);
            return controller.StatusCode(500, new { message = EntityAdministrationResults.InternalError });
        }
    }

    [HttpPost("{name}/messages/deadletter-batch")]
    public Task<ActionResult> DeadLetterMessages(string name, [FromBody] DeferredBatchRequest request) =>
        ActiveBatch(this, _logger, name, request, c => c.SupportsManualDeadLetter ? null : EntityAdministrationResults.ManualDeadLetterNotSupported(),
            p => p.DeadLetterMessagesAsync(name, request.SequenceNumbers, reason: request.Reason, description: request.Description, cancellationToken: HttpContext.RequestAborted));

    [HttpPost("{name}/messages/defer-batch")]
    public Task<ActionResult> DeferMessages(string name, [FromBody] DeferredBatchRequest request) =>
        ActiveBatch(this, _logger, name, request, c => c.SupportsDeferral ? null : EntityAdministrationResults.DeferralNotSupported(),
            p => p.DeferMessagesAsync(name, request.SequenceNumbers, cancellationToken: HttpContext.RequestAborted));

    /// <summary>
    /// The dead-letter and the defer of active messages of a queue and of a subscription, each named by its sequence
    /// number: 400 when <paramref name="notSupported"/> answers for the provider's capabilities or the request holds no
    /// sequence number or more than <see cref="DeferredBatchRequest.MaxSequenceNumbers"/>, both before the provider is
    /// called; 409 for a disabled entity, the constant 500 for anything else, and the result per sequence number,
    /// refusals included, otherwise.
    /// </summary>
    internal static async Task<ActionResult> ActiveBatch(ControllerBase controller, ILogger logger, string entityPath, DeferredBatchRequest request, Func<IProviderCapabilities, ActionResult?> notSupported, Func<IMessagingProvider, Task<BatchOperationResult>> operation)
    {
        var provider = GetProvider();
        if (provider == null)
            return controller.BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (notSupported(provider.Capabilities) is { } refused)
            return refused;
        if (request.SequenceNumbers is not { Length: >= 1 and <= DeferredBatchRequest.MaxSequenceNumbers })
            return controller.BadRequest(new { message = $"sequenceNumbers must hold 1 to {DeferredBatchRequest.MaxSequenceNumbers} sequence numbers." });

        try
        {
            return controller.Ok(await operation(provider));
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Active messages batch failed for {EntityPath}", entityPath);
            return controller.StatusCode(500, new { message = EntityAdministrationResults.InternalError });
        }
    }

    [HttpPost("{name}/deadletter/{sequenceNumber}/resubmit")]
    public async Task<ActionResult> ResubmitDeadLetterMessage(string name, long sequenceNumber, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] ResubmitMessageRequest? request = null)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.ResubmitDeadLetterMessageAsync(name, sequenceNumber, newMessageIdOnDuplicateDetection: request?.NewMessageIdOnDuplicateDetection ?? false);
            return Ok(new { success = true });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (InvalidEntityConfigurationException ex)
        {
            _logger.LogWarning(ex, "Resubmit dead-letter message was refused for queue {QueueName} seq {SequenceNumber}", name, sequenceNumber);
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Resubmit dead-letter message failed for queue {QueueName} seq {SequenceNumber}", name, sequenceNumber);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/deadletter/resubmit-batch")]
    public Task<ActionResult> ResubmitDeadLetterMessages(string name, [FromBody] ResubmitBatchRequest request) =>
        ResubmitBatch(name, request, MessageSubQueue.DeadLetter);

    [HttpPost("{name}/transferdeadletter/resubmit-batch")]
    public Task<ActionResult> ResubmitTransferDeadLetterMessages(string name, [FromBody] ResubmitBatchRequest request) =>
        ResubmitBatch(name, request, MessageSubQueue.TransferDeadLetter);

    private async Task<ActionResult> ResubmitBatch(string name, ResubmitBatchRequest request, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;

        try
        {
            var result = await provider.ResubmitDeadLetterMessagesAsync(name, request.SequenceNumbers, subQueue, newMessageIdOnDuplicateDetection: request.NewMessageIdOnDuplicateDetection, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Resubmit batch {SubQueue} failed for queue {QueueName}", subQueue, name);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpDelete("{name}/messages")]
    public Task<ActionResult> PurgeMessages(string name) => Purge(name, MessageSubQueue.Active);

    [HttpDelete("{name}/deadletter")]
    public Task<ActionResult> PurgeDeadLetterMessages(string name) => Purge(name, MessageSubQueue.DeadLetter);

    private async Task<ActionResult> Purge(string name, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.PurgeMessagesAsync(name, subQueue, cancellationToken: HttpContext.RequestAborted);
            return Ok(new { success = true });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Purge {SubQueue} messages failed for queue {QueueName}", subQueue, name);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/messages/delete-batch")]
    public Task<ActionResult> DeleteMessages(string name, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(name, request, MessageSubQueue.Active);

    [HttpPost("{name}/deadletter/delete-batch")]
    public Task<ActionResult> DeleteDeadLetterMessages(string name, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(name, request, MessageSubQueue.DeadLetter);

    [HttpPost("{name}/transferdeadletter/delete-batch")]
    public Task<ActionResult> DeleteTransferDeadLetterMessages(string name, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(name, request, MessageSubQueue.TransferDeadLetter);

    private async Task<ActionResult> DeleteBatch(string name, DeleteBatchRequest request, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;
        if (request.All && subQueue == MessageSubQueue.TransferDeadLetter)
            return EntityAdministrationResults.DeleteAllOfTransferDeadLetter();

        try
        {
            var result = await provider.DeleteMessagesAsync(name, request.SequenceNumbers, subQueue, all: request.All, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delete {SubQueue} messages batch failed for queue {QueueName}", subQueue, name);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/messages/move-batch")]
    public Task<ActionResult> MoveMessages(string name, [FromBody] MoveBatchRequest request) =>
        MoveBatch(name, request, MessageSubQueue.Active);

    [HttpPost("{name}/deadletter/move-batch")]
    public Task<ActionResult> MoveDeadLetterMessages(string name, [FromBody] MoveBatchRequest request) =>
        MoveBatch(name, request, MessageSubQueue.DeadLetter);

    private async Task<ActionResult> MoveBatch(string name, MoveBatchRequest request, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.MoveMessagesAsync(name, request.TargetQueueName, request.SequenceNumbers, subQueue, newMessageIdOnDuplicateDetection: request.NewMessageIdOnDuplicateDetection, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Move {SubQueue} messages failed from queue {QueueName} to {TargetQueueName}", subQueue, name, request.TargetQueueName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }
}
