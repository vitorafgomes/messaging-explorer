using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Controllers;

[ApiController, RawTargetRouteValues]
[Route("api/[controller]")]
public class TopicsController : ControllerBase
{
    private readonly ILogger<TopicsController> _logger;

    public TopicsController(ILogger<TopicsController> logger)
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
    public async Task<ActionResult<IEnumerable<ITopicEntity>>> GetTopics()
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var topics = await provider.GetTopicsAsync();
        return Ok(topics);
    }

    [HttpGet("{name}")]
    public async Task<ActionResult<ITopicEntity>> GetTopic(string name)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var topic = await provider.GetTopicAsync(name);
        if (topic == null)
            return NotFound();

        return Ok(topic);
    }

    [HttpPost]
    public async Task<ActionResult> CreateTopic([FromBody] CreateTopicRequest request)
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
                await provider.CreateTopicAsync(name);
            else
                await provider.CreateTopicAsync(name, options);
            return CreatedAtAction(nameof(GetTopic), new { name }, null);
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "topic", name, "topic");
        }
    }

    [HttpPatch("{name}")]
    public async Task<ActionResult<ITopicEntity>> UpdateTopic(string name, [FromBody] TopicUpdateOptions options)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.UpdateTopicAsync(name, options, HttpContext.RequestAborted);
            var topic = await provider.GetTopicAsync(name);
            return topic == null ? EntityAdministrationResults.NotFound("topic") : Ok(topic);
        }
        catch (NotSupportedException)
        {
            return EntityAdministrationResults.NotSupported();
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "topic", name, "topic");
        }
    }

    [HttpDelete("{name}")]
    public async Task<ActionResult> DeleteTopic(string name)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        await provider.DeleteTopicAsync(name);
        return NoContent();
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

    // Subscriptions
    [HttpGet("{topicName}/subscriptions")]
    public async Task<ActionResult<IEnumerable<SubscriptionInfo>>> GetSubscriptions(string topicName)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var subscriptions = await provider.GetSubscriptionsAsync(topicName);
        return Ok(subscriptions);
    }

    [HttpGet("{topicName}/subscriptions/{subscriptionName}")]
    public async Task<ActionResult<SubscriptionInfo>> GetSubscription(string topicName, string subscriptionName)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var subscription = await provider.GetSubscriptionAsync(topicName, subscriptionName);
        if (subscription == null)
            return NotFound();

        return Ok(subscription);
    }

    [HttpPost("{topicName}/subscriptions")]
    public async Task<ActionResult> CreateSubscription(string topicName, [FromBody] CreateSubscriptionRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        if (string.IsNullOrWhiteSpace(request.Name))
            return EntityAdministrationResults.NameRequired();

        var options = request.Options?.ToOptions();

        var subscriptionName = request.Name;
        try
        {
            if (options == null)
                await provider.CreateSubscriptionAsync(topicName, subscriptionName);
            else
                await provider.CreateSubscriptionAsync(topicName, subscriptionName, options);
            return CreatedAtAction(nameof(GetSubscription), new { topicName, subscriptionName }, null);
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "subscription", $"{topicName}/{subscriptionName}", "topic");
        }
    }

    [HttpPatch("{topicName}/subscriptions/{subscriptionName}")]
    public async Task<ActionResult<SubscriptionInfo>> UpdateSubscription(string topicName, string subscriptionName, [FromBody] SubscriptionUpdateOptions options)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.UpdateSubscriptionAsync(topicName, subscriptionName, options, HttpContext.RequestAborted);
            var subscription = await provider.GetSubscriptionAsync(topicName, subscriptionName);
            return subscription == null ? EntityAdministrationResults.NotFound("subscription") : Ok(subscription);
        }
        catch (NotSupportedException)
        {
            return EntityAdministrationResults.NotSupported();
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "subscription", $"{topicName}/{subscriptionName}", "subscription");
        }
    }

    [HttpDelete("{topicName}/subscriptions/{subscriptionName}")]
    public async Task<ActionResult> DeleteSubscription(string topicName, string subscriptionName)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        await provider.DeleteSubscriptionAsync(topicName, subscriptionName);
        return NoContent();
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/messages/search")]
    public async Task<ActionResult<MessageSearchResult>> SearchSubscriptionMessages(
        string topicName, string subscriptionName, [FromBody] MessageSearchRequest request)
    {
        var provider = GetProvider();
        if (provider == null) return NoProviderConnected();
        try
        {
            var result = await provider.SearchMessagesAsync(topicName, request, subscriptionName: subscriptionName);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Search subscription messages failed for {TopicName}/{SubscriptionName}", topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/search")]
    public async Task<ActionResult<MessageSearchResult>> SearchSubscriptionDeadLetterMessages(
        string topicName, string subscriptionName, [FromBody] MessageSearchRequest request)
    {
        var provider = GetProvider();
        if (provider == null) return NoProviderConnected();
        try
        {
            var result = await provider.SearchMessagesAsync(topicName, request, isDeadLetter: true, subscriptionName: subscriptionName);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Search subscription dead-letter messages failed for {TopicName}/{SubscriptionName}", topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpGet("{topicName}/subscriptions/{subscriptionName}/messages")]
    public async Task<ActionResult<IEnumerable<IMessage>>> PeekMessages(string topicName, string subscriptionName, [FromQuery] int count = 10)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var messages = await provider.PeekMessagesAsync(topicName, count, subscriptionName: subscriptionName);
        return Ok(messages);
    }

    [HttpGet("{topicName}/subscriptions/{subscriptionName}/deadletter")]
    public async Task<ActionResult<IEnumerable<IMessage>>> PeekDeadLetterMessages(string topicName, string subscriptionName, [FromQuery] int count = 10)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var messages = await provider.PeekMessagesAsync(topicName, count, isDeadLetter: true, subscriptionName: subscriptionName);
        return Ok(messages);
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/messages/receive")]
    public async Task<ActionResult<IEnumerable<IMessage>>> ReceiveMessages(string topicName, string subscriptionName, [FromQuery] int count = 10)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        var messages = await provider.ReceiveMessagesAsync(topicName, count, subscriptionName);
        return Ok(messages);
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/{sequenceNumber}/resubmit")]
    public async Task<ActionResult> ResubmitDeadLetterMessage(string topicName, string subscriptionName, long sequenceNumber)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.ResubmitDeadLetterMessageAsync(topicName, sequenceNumber, subscriptionName);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Resubmit dead-letter failed for {TopicName}/{SubscriptionName} seq {SequenceNumber}", topicName, subscriptionName, sequenceNumber);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/resubmit-batch")]
    public async Task<ActionResult> ResubmitDeadLetterMessages(string topicName, string subscriptionName, [FromBody] ResubmitBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.ResubmitDeadLetterMessagesAsync(topicName, request.SequenceNumbers, subscriptionName, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Resubmit dead-letter batch failed for {TopicName}/{SubscriptionName}", topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpDelete("{topicName}/subscriptions/{subscriptionName}/messages")]
    public async Task<ActionResult> PurgeMessages(string topicName, string subscriptionName)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.PurgeMessagesAsync(topicName, subscriptionName: subscriptionName, cancellationToken: HttpContext.RequestAborted);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Purge messages failed for {TopicName}/{SubscriptionName}", topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpDelete("{topicName}/subscriptions/{subscriptionName}/deadletter")]
    public async Task<ActionResult> PurgeDeadLetterMessages(string topicName, string subscriptionName)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.PurgeMessagesAsync(topicName, isDeadLetter: true, subscriptionName: subscriptionName, cancellationToken: HttpContext.RequestAborted);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Purge dead-letter messages failed for {TopicName}/{SubscriptionName}", topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/messages/delete-batch")]
    public async Task<ActionResult> DeleteMessages(string topicName, string subscriptionName, [FromBody] DeleteBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.DeleteMessagesAsync(topicName, request.SequenceNumbers, subscriptionName: subscriptionName, all: request.All, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delete messages batch failed for {TopicName}/{SubscriptionName}", topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/delete-batch")]
    public async Task<ActionResult> DeleteDeadLetterMessages(string topicName, string subscriptionName, [FromBody] DeleteBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.DeleteMessagesAsync(topicName, request.SequenceNumbers, isDeadLetter: true, subscriptionName: subscriptionName, all: request.All, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delete dead-letter messages batch failed for {TopicName}/{SubscriptionName}", topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/messages/move-batch")]
    public async Task<ActionResult> MoveMessages(string topicName, string subscriptionName, [FromBody] MoveBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.MoveMessagesAsync(topicName, request.TargetQueueName, request.SequenceNumbers, subscriptionName: subscriptionName, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Move messages failed from {TopicName}/{SubscriptionName} to {TargetQueueName}", topicName, subscriptionName, request.TargetQueueName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/move-batch")]
    public async Task<ActionResult> MoveDeadLetterMessages(string topicName, string subscriptionName, [FromBody] MoveBatchRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.MoveMessagesAsync(topicName, request.TargetQueueName, request.SequenceNumbers, isDeadLetter: true, subscriptionName: subscriptionName, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Move dead-letter messages failed from {TopicName}/{SubscriptionName} to {TargetQueueName}", topicName, subscriptionName, request.TargetQueueName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }
}
