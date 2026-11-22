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
    public Task<ActionResult> CreateQueue([FromBody] CreateQueueRequest request) => Add(GetProvider(), _logger, request);

    [HttpPatch("{name}")]
    public async Task<ActionResult<IQueueEntity>> UpdateQueue(string name, [FromBody] QueueUpdateOptions options) =>
        await Change(GetProvider(), _logger, name, options, HttpContext.RequestAborted);

    [HttpDelete("{name}")]
    public Task<ActionResult> DeleteQueue(string name) => Remove(GetProvider(), name);

    /// <summary>
    /// The create of a queue, shared by the route and by the create_queue tool: 400 when no provider is connected or
    /// the name is blank, 201 with no body when created, and the answers of
    /// <see cref="EntityAdministrationResults.Failure"/> otherwise.
    /// </summary>
    internal static async Task<ActionResult> Add(IMessagingProvider? provider, ILogger logger, CreateQueueRequest request)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });

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
            return new CreatedAtActionResult(nameof(GetQueue), null, new { name }, null);
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, logger, "queue", name, "queue");
        }
    }

    /// <summary>
    /// The edit of a queue, shared by the route and by the update_queue tool: the queue as read after the edit, 404
    /// when it is gone, 400 when the provider cannot update, and the answers of
    /// <see cref="EntityAdministrationResults.Failure"/> otherwise.
    /// </summary>
    internal static async Task<ActionResult> Change(IMessagingProvider? provider, ILogger logger, string name, QueueUpdateOptions options, CancellationToken cancellationToken)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });

        try
        {
            await provider.UpdateQueueAsync(name, options, cancellationToken);
            var queue = await provider.GetQueueAsync(name);
            return queue == null ? EntityAdministrationResults.NotFound("queue") : new OkObjectResult(queue);
        }
        catch (NotSupportedException)
        {
            return EntityAdministrationResults.NotSupported();
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, logger, "queue", name, "queue");
        }
    }

    /// <summary>
    /// The delete of a queue, shared by the route and by the delete_queue tool: 204 when deleted; a failure is thrown
    /// to the caller, which for the route is the error handler of the application.
    /// </summary>
    internal static async Task<ActionResult> Remove(IMessagingProvider? provider, string name)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });

        await provider.DeleteQueueAsync(name);
        return new NoContentResult();
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
            return EntityAdministrationResults.Unhandled(ex);
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
        CancelScheduled(GetProvider(), _logger, name, request, HttpContext.RequestAborted);

    /// <summary>
    /// The cancel of scheduled messages of a queue and of a topic: 400 when the provider declares no scheduled messages
    /// or refuses the sequence numbers, 409 for a disabled entity, the constant 500 for any other failure, and the
    /// result per sequence number otherwise.
    /// </summary>
    internal static async Task<ActionResult> CancelScheduled(IMessagingProvider? provider, ILogger logger, string name, CancelScheduledRequest request, CancellationToken cancellationToken)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (!provider.Capabilities.SupportsScheduledMessages)
            return EntityAdministrationResults.ScheduledMessagesNotSupported();

        try
        {
            var result = await provider.CancelScheduledMessagesAsync(name, request.SequenceNumbers, cancellationToken);
            return new OkObjectResult(result);
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return new BadRequestObjectResult(new { message = ex.Message });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Cancel scheduled messages failed for {EntityName}", name);
            return EntityAdministrationResults.Unhandled(ex);
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
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    [HttpPost("{name}/messages/deadletter-batch")]
    public Task<ActionResult> DeadLetterMessages(string name, [FromBody] DeferredBatchRequest request) =>
        DeadLetterBatch(GetProvider(), _logger, name, null, request, HttpContext.RequestAborted);

    /// <summary>
    /// The dead-letter of active messages of a queue, or of a subscription when <paramref name="subscription"/> is given,
    /// shared by the routes and by the dead_letter_messages tool, through <see cref="ActiveBatch"/>.
    /// </summary>
    internal static Task<ActionResult> DeadLetterBatch(IMessagingProvider? provider, ILogger logger, string name, string? subscription, DeferredBatchRequest request, CancellationToken cancellationToken) =>
        ActiveBatch(provider, logger, PathOf(name, subscription), request, c => c.SupportsManualDeadLetter ? null : EntityAdministrationResults.ManualDeadLetterNotSupported(),
            p => p.DeadLetterMessagesAsync(name, request.SequenceNumbers, subscription, request.Reason, request.Description, cancellationToken));

    [HttpPost("{name}/messages/defer-batch")]
    public Task<ActionResult> DeferMessages(string name, [FromBody] DeferredBatchRequest request) =>
        ActiveBatch(GetProvider(), _logger, name, request, c => c.SupportsDeferral ? null : EntityAdministrationResults.DeferralNotSupported(),
            p => p.DeferMessagesAsync(name, request.SequenceNumbers, cancellationToken: HttpContext.RequestAborted));

    /// <summary>
    /// The dead-letter and the defer of active messages of a queue and of a subscription, each named by its sequence
    /// number: 400 when <paramref name="notSupported"/> answers for the provider's capabilities or the request holds no
    /// sequence number or more than <see cref="DeferredBatchRequest.MaxSequenceNumbers"/>, both before the provider is
    /// called; 409 for a disabled entity, the constant 500 for anything else, and the result per sequence number,
    /// refusals included, otherwise.
    /// </summary>
    internal static async Task<ActionResult> ActiveBatch(IMessagingProvider? provider, ILogger logger, string entityPath, DeferredBatchRequest request, Func<IProviderCapabilities, ActionResult?> notSupported, Func<IMessagingProvider, Task<BatchOperationResult>> operation)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (notSupported(provider.Capabilities) is { } refused)
            return refused;
        if (request.SequenceNumbers is not { Length: >= 1 and <= DeferredBatchRequest.MaxSequenceNumbers })
            return new BadRequestObjectResult(new { message = $"sequenceNumbers must hold 1 to {DeferredBatchRequest.MaxSequenceNumbers} sequence numbers." });

        try
        {
            return new OkObjectResult(await operation(provider));
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Active messages batch failed for {EntityPath}", entityPath);
            return EntityAdministrationResults.Unhandled(ex);
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
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    [HttpPost("{name}/deadletter/resubmit-batch")]
    public Task<ActionResult> ResubmitDeadLetterMessages(string name, [FromBody] ResubmitBatchRequest request) =>
        ResubmitBatch(GetProvider(), _logger, name, null, request, MessageSubQueue.DeadLetter, HttpContext.RequestAborted);

    [HttpPost("{name}/transferdeadletter/resubmit-batch")]
    public Task<ActionResult> ResubmitTransferDeadLetterMessages(string name, [FromBody] ResubmitBatchRequest request) =>
        ResubmitBatch(GetProvider(), _logger, name, null, request, MessageSubQueue.TransferDeadLetter, HttpContext.RequestAborted);

    [HttpDelete("{name}/messages")]
    public Task<ActionResult> PurgeMessages(string name) => Purge(GetProvider(), _logger, name, null, MessageSubQueue.Active, HttpContext.RequestAborted);

    [HttpDelete("{name}/deadletter")]
    public Task<ActionResult> PurgeDeadLetterMessages(string name) => Purge(GetProvider(), _logger, name, null, MessageSubQueue.DeadLetter, HttpContext.RequestAborted);

    [HttpPost("{name}/messages/delete-batch")]
    public Task<ActionResult> DeleteMessages(string name, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(GetProvider(), _logger, name, null, request, MessageSubQueue.Active, HttpContext.RequestAborted);

    [HttpPost("{name}/deadletter/delete-batch")]
    public Task<ActionResult> DeleteDeadLetterMessages(string name, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(GetProvider(), _logger, name, null, request, MessageSubQueue.DeadLetter, HttpContext.RequestAborted);

    [HttpPost("{name}/transferdeadletter/delete-batch")]
    public Task<ActionResult> DeleteTransferDeadLetterMessages(string name, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(GetProvider(), _logger, name, null, request, MessageSubQueue.TransferDeadLetter, HttpContext.RequestAborted);

    [HttpPost("{name}/messages/move-batch")]
    public Task<ActionResult> MoveMessages(string name, [FromBody] MoveBatchRequest request) =>
        MoveBatch(GetProvider(), _logger, name, null, request, MessageSubQueue.Active, HttpContext.RequestAborted);

    [HttpPost("{name}/deadletter/move-batch")]
    public Task<ActionResult> MoveDeadLetterMessages(string name, [FromBody] MoveBatchRequest request) =>
        MoveBatch(GetProvider(), _logger, name, null, request, MessageSubQueue.DeadLetter, HttpContext.RequestAborted);

    /// <summary>
    /// The resubmit of dead-letter or transfer dead-letter messages of a queue, or of a subscription when
    /// <paramref name="subscription"/> is given, shared by the routes and by the resubmit_messages tool: 400 when no
    /// provider is connected or it declares no transfer dead-letter queue, 409 for a disabled entity, the constant 500
    /// or the 502 of a refusal as not authorised for any other failure, and the result per sequence number otherwise.
    /// </summary>
    internal static async Task<ActionResult> ResubmitBatch(IMessagingProvider? provider, ILogger logger, string name, string? subscription, ResubmitBatchRequest request, MessageSubQueue subQueue, CancellationToken cancellationToken)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;

        try
        {
            var result = await provider.ResubmitDeadLetterMessagesAsync(name, request.SequenceNumbers, subQueue, subscription, request.NewMessageIdOnDuplicateDetection, cancellationToken: cancellationToken);
            return new OkObjectResult(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Resubmit {SubQueue} batch failed for {EntityPath}", subQueue, PathOf(name, subscription));
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    /// <summary>
    /// The purge of the active or the dead-letter messages of a queue, or of a subscription when
    /// <paramref name="subscription"/> is given, shared by the routes and by the purge_messages tool: 400 when no
    /// provider is connected or it refuses the entity, 409 for a disabled entity, the constant 500 or the 502 of a
    /// refusal as not authorised for any other failure, and { success } otherwise.
    /// </summary>
    internal static async Task<ActionResult> Purge(IMessagingProvider? provider, ILogger logger, string name, string? subscription, MessageSubQueue subQueue, CancellationToken cancellationToken)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });

        try
        {
            await provider.PurgeMessagesAsync(name, subQueue, subscription, cancellationToken: cancellationToken);
            return new OkObjectResult(new { success = true });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return new BadRequestObjectResult(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Purge {SubQueue} messages failed for {EntityPath}", subQueue, PathOf(name, subscription));
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    /// <summary>
    /// The delete of chosen messages of a queue, or of a subscription when <paramref name="subscription"/> is given,
    /// from one of its sub-queues, shared by the routes and by the delete_messages tool: 400 when no provider is
    /// connected, it declares no transfer dead-letter queue, all is asked of that queue or the provider refuses the
    /// numbers, 409 for a disabled entity, the constant 500 or the 502 of a refusal as not authorised for any other
    /// failure, and the result per sequence number otherwise.
    /// </summary>
    internal static async Task<ActionResult> DeleteBatch(IMessagingProvider? provider, ILogger logger, string name, string? subscription, DeleteBatchRequest request, MessageSubQueue subQueue, CancellationToken cancellationToken)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;
        if (request.All && subQueue == MessageSubQueue.TransferDeadLetter)
            return EntityAdministrationResults.DeleteAllOfTransferDeadLetter();

        try
        {
            var result = await provider.DeleteMessagesAsync(name, request.SequenceNumbers, subQueue, subscription, all: request.All, cancellationToken: cancellationToken);
            return new OkObjectResult(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return new BadRequestObjectResult(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Delete {SubQueue} messages batch failed for {EntityPath}", subQueue, PathOf(name, subscription));
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    /// <summary>
    /// The move of chosen messages of a queue, or of a subscription when <paramref name="subscription"/> is given, to a
    /// queue, shared by the routes and by the move_messages tool: 400 when no provider is connected or it declares no
    /// transfer dead-letter queue, 409 for a disabled entity, the constant 500 or the 502 of a refusal as not
    /// authorised for any other failure, and the result per sequence number otherwise.
    /// </summary>
    internal static async Task<ActionResult> MoveBatch(IMessagingProvider? provider, ILogger logger, string name, string? subscription, MoveBatchRequest request, MessageSubQueue subQueue, CancellationToken cancellationToken)
    {
        if (provider == null)
            return new BadRequestObjectResult(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;

        try
        {
            var result = await provider.MoveMessagesAsync(name, request.TargetQueueName, request.SequenceNumbers, subQueue, subscription, request.NewMessageIdOnDuplicateDetection, cancellationToken: cancellationToken);
            return new OkObjectResult(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Move {SubQueue} messages failed from {EntityPath} to {TargetQueueName}", subQueue, PathOf(name, subscription), request.TargetQueueName);
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    private static string PathOf(string name, string? subscription) => subscription is null ? name : $"{name}/{subscription}";
}
