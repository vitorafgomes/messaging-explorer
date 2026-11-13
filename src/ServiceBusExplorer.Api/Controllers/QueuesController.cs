using Microsoft.AspNetCore.Mvc;
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
    public Task<ActionResult<IEnumerable<IMessage>>> PeekMessages(string name, [FromQuery] int count = 10) =>
        Peek(name, count, MessageSubQueue.Active, null, null);

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
        if (EntityAdministrationResults.PeekPosition(provider, fromSequenceNumber, out var from) is { } refused) return refused;
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
    }

    [HttpPost("{name}/messages")]
    public async Task<ActionResult> SendMessage(string name, [FromBody] SendMessageRequest message)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.SendMessageAsync(name, message);
            return Ok(new { success = true });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
    }

    [HttpPost("{name}/messages/batch")]
    public async Task<ActionResult> SendMessages(string name, [FromBody] IEnumerable<SendMessageRequest> messages)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.SendMessagesAsync(name, messages);
            return Ok(new { success = true, count = messages.Count() });
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
    }

    [HttpPost("{name}/messages/cancel-scheduled")]
    public async Task<ActionResult> CancelScheduledMessages(string name, [FromBody] CancelScheduledRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();
        if (!provider.Capabilities.SupportsScheduledMessages)
            return EntityAdministrationResults.ScheduledMessagesNotSupported();

        try
        {
            var result = await provider.CancelScheduledMessagesAsync(name, request.SequenceNumbers, HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Cancel scheduled messages failed for queue {QueueName}", name);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/deadletter/{sequenceNumber}/resubmit")]
    public async Task<ActionResult> ResubmitDeadLetterMessage(string name, long sequenceNumber)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.ResubmitDeadLetterMessageAsync(name, sequenceNumber);
            return Ok(new { success = true });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
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
            var result = await provider.ResubmitDeadLetterMessagesAsync(name, request.SequenceNumbers, subQueue, cancellationToken: HttpContext.RequestAborted);
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
            var result = await provider.MoveMessagesAsync(name, request.TargetQueueName, request.SequenceNumbers, subQueue, cancellationToken: HttpContext.RequestAborted);
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
