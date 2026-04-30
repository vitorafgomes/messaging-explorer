using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Controllers;

[ApiController]
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
    public async Task<ActionResult> CreateQueue([FromBody] CreateEntityRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        await provider.CreateQueueAsync(request.Name);
        return CreatedAtAction(nameof(GetQueue), new { name = request.Name }, null);
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
    public async Task<ActionResult<MessageSearchResult>> SearchMessages(
        string name, [FromBody] MessageSearchRequest request)
    {
        var provider = GetProvider();
        if (provider == null) return NoProviderConnected();
        try
        {
            var result = await provider.SearchMessagesAsync(name, request);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Search messages failed for queue {QueueName}", name);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/deadletter/search")]
    public async Task<ActionResult<MessageSearchResult>> SearchDeadLetterMessages(
        string name, [FromBody] MessageSearchRequest request)
    {
        var provider = GetProvider();
        if (provider == null) return NoProviderConnected();
        try
        {
            var result = await provider.SearchMessagesAsync(name, request, isDeadLetter: true);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Search dead-letter messages failed for queue {QueueName}", name);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpGet("{name}/messages")]
    public async Task<ActionResult<IEnumerable<IMessage>>> PeekMessages(string name, [FromQuery] int count = 10)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var messages = await provider.PeekMessagesAsync(name, count);
        return Ok(messages);
    }

    [HttpGet("{name}/deadletter")]
    public async Task<ActionResult<IEnumerable<IMessage>>> PeekDeadLetterMessages(string name, [FromQuery] int count = 10)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var messages = await provider.PeekMessagesAsync(name, count, isDeadLetter: true);
        return Ok(messages);
    }

    [HttpPost("{name}/messages")]
    public async Task<ActionResult> SendMessage(string name, [FromBody] SendMessageRequest message)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        await provider.SendMessageAsync(name, message);
        return Ok(new { success = true });
    }

    [HttpPost("{name}/messages/batch")]
    public async Task<ActionResult> SendMessages(string name, [FromBody] IEnumerable<SendMessageRequest> messages)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        await provider.SendMessagesAsync(name, messages);
        return Ok(new { success = true, count = messages.Count() });
    }

    [HttpPost("{name}/messages/receive")]
    public async Task<ActionResult<IEnumerable<IMessage>>> ReceiveMessages(string name, [FromQuery] int count = 10)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var messages = await provider.ReceiveMessagesAsync(name, count);
        return Ok(messages);
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
        catch (Exception ex)
        {
            _logger.LogError(ex, "Resubmit dead-letter message failed for queue {QueueName} seq {SequenceNumber}", name, sequenceNumber);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/deadletter/resubmit-batch")]
    public async Task<ActionResult> ResubmitDeadLetterMessages(string name, [FromBody] ResubmitBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.ResubmitDeadLetterMessagesAsync(name, request.SequenceNumbers);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Resubmit batch dead-letter failed for queue {QueueName}", name);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpDelete("{name}/messages")]
    public async Task<ActionResult> PurgeMessages(string name)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.PurgeMessagesAsync(name);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Purge messages failed for queue {QueueName}", name);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpDelete("{name}/deadletter")]
    public async Task<ActionResult> PurgeDeadLetterMessages(string name)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.PurgeMessagesAsync(name, isDeadLetter: true);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Purge dead-letter messages failed for queue {QueueName}", name);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/messages/delete-batch")]
    public async Task<ActionResult> DeleteMessages(string name, [FromBody] DeleteBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.DeleteMessagesAsync(name, request.SequenceNumbers);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delete messages batch failed for queue {QueueName}", name);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/deadletter/delete-batch")]
    public async Task<ActionResult> DeleteDeadLetterMessages(string name, [FromBody] DeleteBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.DeleteMessagesAsync(name, request.SequenceNumbers, isDeadLetter: true);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delete dead-letter messages batch failed for queue {QueueName}", name);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/messages/move-batch")]
    public async Task<ActionResult> MoveMessages(string name, [FromBody] MoveBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.MoveMessagesAsync(name, request.TargetQueueName, request.SequenceNumbers);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Move messages failed from queue {QueueName} to {TargetQueueName}", name, request.TargetQueueName);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }

    [HttpPost("{name}/deadletter/move-batch")]
    public async Task<ActionResult> MoveDeadLetterMessages(string name, [FromBody] MoveBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.MoveMessagesAsync(name, request.TargetQueueName, request.SequenceNumbers, isDeadLetter: true);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Move dead-letter messages failed from queue {QueueName} to {TargetQueueName}", name, request.TargetQueueName);
            return StatusCode(500, new { success = false, error = "An internal error occurred." });
        }
    }
}

public class CreateEntityRequest
{
    public string Name { get; set; } = string.Empty;
}
