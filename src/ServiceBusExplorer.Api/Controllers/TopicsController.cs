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

    [HttpGet("{topicName}/subscriptions/{subscriptionName}/rules")]
    public async Task<ActionResult<IReadOnlyList<SubscriptionRuleInfo>>> GetRules(string topicName, string subscriptionName)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            return Ok(await provider.GetRulesAsync(topicName, subscriptionName, HttpContext.RequestAborted));
        }
        catch (NotSupportedException)
        {
            return EntityAdministrationResults.RulesNotSupported();
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "rule", $"{topicName}/{subscriptionName}", "subscription");
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/rules")]
    public async Task<ActionResult<SubscriptionRuleInfo>> CreateRule(string topicName, string subscriptionName, [FromBody] SubscriptionRuleRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var rule = await provider.CreateRuleAsync(topicName, subscriptionName, request.ToRule(), HttpContext.RequestAborted);
            return CreatedAtAction(nameof(GetRules), new { topicName, subscriptionName }, rule);
        }
        catch (NotSupportedException)
        {
            return EntityAdministrationResults.RulesNotSupported();
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "rule", $"{topicName}/{subscriptionName}/{request.Name}", "subscription");
        }
    }

    [HttpPut("{topicName}/subscriptions/{subscriptionName}/rules/{ruleName}")]
    public async Task<ActionResult<SubscriptionRuleInfo>> UpdateRule(string topicName, string subscriptionName, string ruleName, [FromBody] SubscriptionRuleRequest request)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        if (request.Name != null && request.Name != ruleName)
            return BadRequest(new { message = "name must be absent or equal to the rule name in the path; a rule cannot be renamed." });

        try
        {
            return Ok(await provider.UpdateRuleAsync(topicName, subscriptionName, ruleName, request.ToRule(), HttpContext.RequestAborted));
        }
        catch (NotSupportedException)
        {
            return EntityAdministrationResults.RulesNotSupported();
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "rule", $"{topicName}/{subscriptionName}/{ruleName}", "rule");
        }
    }

    [HttpDelete("{topicName}/subscriptions/{subscriptionName}/rules/{ruleName}")]
    public async Task<ActionResult> DeleteRule(string topicName, string subscriptionName, string ruleName)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.DeleteRuleAsync(topicName, subscriptionName, ruleName, HttpContext.RequestAborted);
            return NoContent();
        }
        catch (NotSupportedException)
        {
            return EntityAdministrationResults.RulesNotSupported();
        }
        catch (Exception ex)
        {
            return EntityAdministrationResults.Failure(ex, _logger, "rule", $"{topicName}/{subscriptionName}/{ruleName}", "rule");
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/messages/search")]
    public Task<ActionResult<MessageSearchResult>> SearchSubscriptionMessages(
        string topicName, string subscriptionName, [FromBody] MessageSearchRequest request) =>
        Search(topicName, subscriptionName, request, MessageSubQueue.Active);

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/search")]
    public Task<ActionResult<MessageSearchResult>> SearchSubscriptionDeadLetterMessages(
        string topicName, string subscriptionName, [FromBody] MessageSearchRequest request) =>
        Search(topicName, subscriptionName, request, MessageSubQueue.DeadLetter);

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/transferdeadletter/search")]
    public Task<ActionResult<MessageSearchResult>> SearchSubscriptionTransferDeadLetterMessages(
        string topicName, string subscriptionName, [FromBody] MessageSearchRequest request) =>
        Search(topicName, subscriptionName, request, MessageSubQueue.TransferDeadLetter);

    private async Task<ActionResult<MessageSearchResult>> Search(string topicName, string subscriptionName, MessageSearchRequest request, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null) return NoProviderConnected();
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;
        try
        {
            var result = await provider.SearchMessagesAsync(topicName, request, subQueue, subscriptionName);
            return Ok(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Search {SubQueue} subscription messages failed for {TopicName}/{SubscriptionName}", subQueue, topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpGet("{topicName}/subscriptions/{subscriptionName}/messages")]
    public Task<ActionResult<IEnumerable<IMessage>>> PeekMessages(string topicName, string subscriptionName, [FromQuery] int count = 10) =>
        Peek(topicName, subscriptionName, count, MessageSubQueue.Active);

    [HttpGet("{topicName}/subscriptions/{subscriptionName}/deadletter")]
    public Task<ActionResult<IEnumerable<IMessage>>> PeekDeadLetterMessages(string topicName, string subscriptionName, [FromQuery] int count = 10) =>
        Peek(topicName, subscriptionName, count, MessageSubQueue.DeadLetter);

    [HttpGet("{topicName}/subscriptions/{subscriptionName}/transferdeadletter")]
    public Task<ActionResult<IEnumerable<IMessage>>> PeekTransferDeadLetterMessages(string topicName, string subscriptionName, [FromQuery] int count = 10) =>
        Peek(topicName, subscriptionName, count, MessageSubQueue.TransferDeadLetter);

    private async Task<ActionResult<IEnumerable<IMessage>>> Peek(string topicName, string subscriptionName, int count, MessageSubQueue subQueue)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;

        try
        {
            var messages = await provider.PeekMessagesAsync(topicName, count, subQueue, subscriptionName);
            return Ok(messages);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/messages/receive")]
    public async Task<ActionResult<IEnumerable<IMessage>>> ReceiveMessages(string topicName, string subscriptionName, [FromQuery] int count = 10)
    {
        if (count < 1) count = 1;
        if (count > 1000) count = 1000;

        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var messages = await provider.ReceiveMessagesAsync(topicName, count, subscriptionName);
            return Ok(messages);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
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
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Resubmit dead-letter failed for {TopicName}/{SubscriptionName} seq {SequenceNumber}", topicName, subscriptionName, sequenceNumber);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/resubmit-batch")]
    public Task<ActionResult> ResubmitDeadLetterMessages(string topicName, string subscriptionName, [FromBody] ResubmitBatchRequest request) =>
        ResubmitBatch(topicName, subscriptionName, request, MessageSubQueue.DeadLetter);

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/transferdeadletter/resubmit-batch")]
    public Task<ActionResult> ResubmitTransferDeadLetterMessages(string topicName, string subscriptionName, [FromBody] ResubmitBatchRequest request) =>
        ResubmitBatch(topicName, subscriptionName, request, MessageSubQueue.TransferDeadLetter);

    private async Task<ActionResult> ResubmitBatch(string topicName, string subscriptionName, ResubmitBatchRequest request, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;

        try
        {
            var result = await provider.ResubmitDeadLetterMessagesAsync(topicName, request.SequenceNumbers, subQueue, subscriptionName, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Resubmit {SubQueue} batch failed for {TopicName}/{SubscriptionName}", subQueue, topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpDelete("{topicName}/subscriptions/{subscriptionName}/messages")]
    public Task<ActionResult> PurgeMessages(string topicName, string subscriptionName) =>
        Purge(topicName, subscriptionName, MessageSubQueue.Active);

    [HttpDelete("{topicName}/subscriptions/{subscriptionName}/deadletter")]
    public Task<ActionResult> PurgeDeadLetterMessages(string topicName, string subscriptionName) =>
        Purge(topicName, subscriptionName, MessageSubQueue.DeadLetter);

    private async Task<ActionResult> Purge(string topicName, string subscriptionName, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            await provider.PurgeMessagesAsync(topicName, subQueue, subscriptionName, cancellationToken: HttpContext.RequestAborted);
            return Ok(new { success = true });
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Purge {SubQueue} messages failed for {TopicName}/{SubscriptionName}", subQueue, topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/messages/delete-batch")]
    public Task<ActionResult> DeleteMessages(string topicName, string subscriptionName, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(topicName, subscriptionName, request, MessageSubQueue.Active);

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/delete-batch")]
    public Task<ActionResult> DeleteDeadLetterMessages(string topicName, string subscriptionName, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(topicName, subscriptionName, request, MessageSubQueue.DeadLetter);

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/transferdeadletter/delete-batch")]
    public Task<ActionResult> DeleteTransferDeadLetterMessages(string topicName, string subscriptionName, [FromBody] DeleteBatchRequest request) =>
        DeleteBatch(topicName, subscriptionName, request, MessageSubQueue.TransferDeadLetter);

    private async Task<ActionResult> DeleteBatch(string topicName, string subscriptionName, DeleteBatchRequest request, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();
        if (EntityAdministrationResults.SubQueueNotSupported(provider, subQueue) is { } notSupported) return notSupported;
        if (request.All && subQueue == MessageSubQueue.TransferDeadLetter)
            return EntityAdministrationResults.DeleteAllOfTransferDeadLetter();

        try
        {
            var result = await provider.DeleteMessagesAsync(topicName, request.SequenceNumbers, subQueue, subscriptionName, all: request.All, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delete {SubQueue} messages batch failed for {TopicName}/{SubscriptionName}", subQueue, topicName, subscriptionName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/messages/move-batch")]
    public Task<ActionResult> MoveMessages(string topicName, string subscriptionName, [FromBody] MoveBatchRequest request) =>
        MoveBatch(topicName, subscriptionName, request, MessageSubQueue.Active);

    [HttpPost("{topicName}/subscriptions/{subscriptionName}/deadletter/move-batch")]
    public Task<ActionResult> MoveDeadLetterMessages(string topicName, string subscriptionName, [FromBody] MoveBatchRequest request) =>
        MoveBatch(topicName, subscriptionName, request, MessageSubQueue.DeadLetter);

    private async Task<ActionResult> MoveBatch(string topicName, string subscriptionName, MoveBatchRequest request, MessageSubQueue subQueue)
    {
        var provider = GetProvider();
        if (provider == null)
            return NoProviderConnected();

        try
        {
            var result = await provider.MoveMessagesAsync(topicName, request.TargetQueueName, request.SequenceNumbers, subQueue, subscriptionName, cancellationToken: HttpContext.RequestAborted);
            return Ok(result);
        }
        catch (EntityDisabledException)
        {
            return EntityAdministrationResults.EntityDisabled();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Move {SubQueue} messages failed from {TopicName}/{SubscriptionName} to {TargetQueueName}", subQueue, topicName, subscriptionName, request.TargetQueueName);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }
}
