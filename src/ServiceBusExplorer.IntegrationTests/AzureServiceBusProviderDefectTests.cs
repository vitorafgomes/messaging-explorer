using System.Runtime.Serialization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Azure.Core.Amqp;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Known defects of the Azure Service Bus provider, each pinned by a test of today's behaviour against
/// the emulator. Each test passes while the defect exists; the change that fixes one rewrites its test
/// to assert the behaviour named in its summary.
/// </summary>
[Collection(AzureServiceBusCollection.Name)]
public sealed class AzureServiceBusProviderDefectTests(AzureServiceBusFixture fixture) : IAsyncLifetime
{
    private readonly List<string> _queues = [];
    private readonly List<string> _topics = [];
    private IMessagingProvider _messaging = null!;
    private IMessagingProvider _management = null!;

    public async Task InitializeAsync()
    {
        _messaging = await fixture.ConnectMessagingAsync();
        _management = await fixture.ConnectManagementAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var queue in _queues) await fixture.DeleteQueueAsync(queue);
        foreach (var topic in _topics) await fixture.DeleteTopicAsync(topic);
        await _messaging.DisposeAsync();
        await _management.DisposeAsync();
    }

    private string Name(List<string> owner, string tag)
    {
        var name = AzureServiceBusFixture.UniqueName(tag);
        owner.Add(name);
        return name;
    }

    private async Task<string> CreateQueueAsync(string tag, Action<CreateQueueOptions>? configure = null)
    {
        var options = new CreateQueueOptions(Name(_queues, tag));
        configure?.Invoke(options);
        await fixture.Admin.CreateQueueAsync(options);
        return options.Name;
    }

    private async Task<long> SequenceOfAsync(string queue, string body, bool isDeadLetter = false) =>
        (await _messaging.PeekMessagesAsync(queue, 500, isDeadLetter)).Single(m => m.Body == body).SequenceNumber!.Value;

    /// <summary>Correct: a property value bound from JSON is sent as its string, number or boolean value.</summary>
    [Fact]
    public async Task Defect_send_with_an_application_property_bound_from_json_throws_and_sends_nothing()
    {
        var queue = await CreateQueueAsync("json-property");
        var fromJson = JsonDocument.Parse("{\"tenant\":\"contoso\"}").RootElement.GetProperty("tenant");

        var error = await Assert.ThrowsAsync<SerializationException>(() => _messaging.SendMessageAsync(queue, new SendMessageRequest
        {
            Body = "from-json",
            ApplicationProperties = new Dictionary<string, object> { ["tenant"] = fromJson }
        }));
        await _messaging.SendMessageAsync(queue, new SendMessageRequest
        {
            Body = "plain",
            ApplicationProperties = new Dictionary<string, object> { ["tenant"] = "contoso" }
        });

        Assert.Contains("System.Text.Json.JsonElement", error.Message);
        Assert.Equal(["plain"], await fixture.DrainAsync(queue));
    }

    /// <summary>Correct: peeking 10 messages of a queue that holds 2 returns both.</summary>
    [Fact]
    public async Task Defect_peek_stops_at_the_short_batch_a_dropped_duplicate_leaves_and_returns_fewer_messages_than_exist()
    {
        var queue = await CreateQueueAsync("short-peek", o =>
        {
            o.RequiresDuplicateDetection = true;
            o.DuplicateDetectionHistoryTimeWindow = TimeSpan.FromMinutes(5);
        });
        await using (var sender = fixture.Client.CreateSender(queue))
        {
            await sender.SendMessageAsync(new ServiceBusMessage("one") { MessageId = "same" });
            await sender.SendMessageAsync(new ServiceBusMessage("dropped") { MessageId = "same" });
            await sender.SendMessageAsync(new ServiceBusMessage("three") { MessageId = "other" });
        }

        var peeked = (await _messaging.PeekMessagesAsync(queue, 10)).Select(m => m.Body).ToList();

        Assert.Equal(["one"], peeked);
        Assert.Equal(["one", "three"], await fixture.DrainAsync(queue));
    }

    /// <summary>
    /// Correct: a resubmit into an entity with duplicate detection either delivers the message or
    /// reports it as not delivered; it never removes it from the dead-letter queue as a success.
    /// </summary>
    [Fact]
    public async Task Defect_resubmit_into_a_queue_with_duplicate_detection_reports_success_and_the_message_is_gone()
    {
        var queue = await CreateQueueAsync("dedup", o =>
        {
            o.RequiresDuplicateDetection = true;
            o.DuplicateDetectionHistoryTimeWindow = TimeSpan.FromMinutes(5);
        });
        await using (var sender = fixture.Client.CreateSender(queue))
        {
            await sender.SendMessageAsync(new ServiceBusMessage("order") { MessageId = "order-1" });
        }

        await using (var receiver = fixture.Client.CreateReceiver(queue))
        {
            await receiver.DeadLetterMessageAsync(await receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(5)));
        }

        var original = await SequenceOfAsync(queue, "order", isDeadLetter: true);

        var result = await _messaging.ResubmitDeadLetterMessagesAsync(queue, [original]);
        await fixture.SendAsync(queue, "sentinel");

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(["sentinel"], await fixture.DrainAsync(queue));
        Assert.Empty(await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(queue)));
    }

    /// <summary>Correct: a selective delete on an active queue leaves the delivery count of the messages it did not select unchanged.</summary>
    [Fact]
    public async Task Defect_selective_delete_on_an_active_queue_raises_the_delivery_count_of_the_unselected_messages()
    {
        var queue = await CreateQueueAsync("delivery-count", o => o.MaxDeliveryCount = 10);
        await fixture.SendAsync(queue, "m1", "m2", "m3");
        var before = (await _messaging.PeekMessagesAsync(queue, 10)).Select(m => (m.Body, m.DeliveryCount)).ToList();
        var target = await SequenceOfAsync(queue, "m3");

        var result = await _messaging.DeleteMessagesAsync(queue, [target]);
        var after = (await _messaging.PeekMessagesAsync(queue, 10)).Select(m => (m.Body, m.DeliveryCount)).ToList();

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal([("m1", 0), ("m2", 0), ("m3", 0)], before);
        Assert.Equal([("m1", 1), ("m2", 1)], after);
    }

    /// <summary>Correct: a selective delete on an active queue with a max delivery count of 1 leaves the messages it did not select in the queue.</summary>
    [Fact]
    public async Task Defect_selective_delete_on_an_active_queue_with_a_low_max_delivery_count_dead_letters_the_unselected_messages()
    {
        var queue = await CreateQueueAsync("low-mdc", o => o.MaxDeliveryCount = 1);
        await fixture.SendAsync(queue, "m1", "m2", "m3");
        var target = await SequenceOfAsync(queue, "m3");

        var result = await _messaging.DeleteMessagesAsync(queue, [target]);
        var deadLettered = (await _messaging.PeekMessagesAsync(queue, 10, isDeadLetter: true)).Select(m => (m.Body, m.DeadLetterReason)).ToList();

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal([("m1", "MaxDeliveryCountExceeded"), ("m2", "MaxDeliveryCountExceeded")], deadLettered);
        Assert.Empty(await fixture.DrainAsync(queue));
    }

    /// <summary>Correct: selective delete, move and receive work on a session-enabled queue, or are refused as unsupported before any broker call.</summary>
    [Fact]
    public async Task Defect_selective_delete_move_and_receive_on_a_session_enabled_queue_throw()
    {
        var queue = await CreateQueueAsync("sessions", o => o.RequiresSession = true);
        var target = await CreateQueueAsync("sessions-target");
        await _messaging.SendMessageAsync(queue, new SendMessageRequest { Body = "m1", SessionId = "s1" });
        var selected = await SequenceOfAsync(queue, "m1");

        var delete = await Assert.ThrowsAsync<InvalidOperationException>(() => _messaging.DeleteMessagesAsync(queue, [selected]));
        var move = await Assert.ThrowsAsync<InvalidOperationException>(() => _messaging.MoveMessagesAsync(queue, target, [selected]));
        var receive = await Assert.ThrowsAsync<InvalidOperationException>(() => _messaging.ReceiveMessagesAsync(queue, 1));

        Assert.All([delete, move, receive], e => Assert.Contains("requires sessions", e.Message));
        Assert.Equal(["m1"], (await _messaging.PeekMessagesAsync(queue, 10)).Select(m => m.Body));
        Assert.Empty(await fixture.DrainAsync(target));
    }

    /// <summary>
    /// Correct: resubmitting one dead-lettered message sends it and removes it from the dead-letter
    /// queue wherever it sits, or reports that it could not be removed.
    /// </summary>
    [Fact]
    public async Task Defect_single_resubmit_of_a_message_deep_in_the_dead_letter_queue_sends_it_and_leaves_it_there()
    {
        var queue = await CreateQueueAsync("deep-dlq");
        var bodies = Enumerable.Range(0, 350).Select(i => $"m{i}").ToArray();
        await fixture.SendToDeadLetterAsync(queue, bodies);
        var deepest = await SequenceOfAsync(queue, "m349", isDeadLetter: true);

        await _messaging.ResubmitDeadLetterMessageAsync(queue, deepest);
        var stillDeadLettered = (await _messaging.PeekMessagesAsync(queue, 500, isDeadLetter: true)).Select(m => m.SequenceNumber).ToList();

        Assert.Equal(["m349"], await fixture.DrainAsync(queue));
        Assert.Equal(350, stillDeadLettered.Count);
        Assert.Contains(deepest, stillDeadLettered);
    }

    /// <summary>Correct: a subscription with a filter that does not parse is not created, or keeps its default rule, and the error says why.</summary>
    [Fact]
    public async Task Defect_a_subscription_created_with_an_invalid_filter_is_left_with_no_rule_and_cannot_be_created_again()
    {
        var topic = Name(_topics, "bad-filter");
        await _management.CreateTopicAsync(topic);
        var options = new SubscriptionCreateOptions { FilterExpression = "this is (( not sql" };

        var parse = await Assert.ThrowsAsync<ArgumentException>(() => _management.CreateSubscriptionAsync(topic, "filtered", options));
        var left = await _management.GetSubscriptionAsync(topic, "filtered");
        var retry = await Assert.ThrowsAsync<EntityAlreadyExistsException>(() => _management.CreateSubscriptionAsync(topic, "filtered", options));

        Assert.Contains("error parsing the SQL expression", parse.Message);
        Assert.NotNull(left);
        Assert.Empty(left.Rules);
        Assert.Equal("The entity already exists.", retry.Message);
    }

    /// <summary>Correct: a send of many messages is split into batches that each fit, and every message is sent.</summary>
    [Fact]
    public async Task Defect_send_of_more_messages_than_fit_one_batch_fails_as_a_whole_and_sends_nothing()
    {
        var queue = await CreateQueueAsync("big-batch");
        var requests = Enumerable.Range(0, 40).Select(_ => new SendMessageRequest { Body = new string('x', 10_000) });

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => _messaging.SendMessagesAsync(queue, requests));

        Assert.Equal(ServiceBusFailureReason.MessageSizeExceeded, error.Reason);
        Assert.Empty(await fixture.DrainAsync(queue));
    }

    /// <summary>Correct: a message whose AMQP body is a value is shown with a readable body, and the other messages of the peek are still returned.</summary>
    [Fact]
    public async Task Defect_one_message_with_an_amqp_value_body_breaks_the_whole_peek()
    {
        var queue = await CreateQueueAsync("value-body");
        await fixture.SendAsync(queue, "readable");
        await using (var sender = fixture.Client.CreateSender(queue))
        {
            await sender.SendMessageAsync(new ServiceBusMessage(new AmqpAnnotatedMessage(AmqpMessageBody.FromValue(42))));
        }

        await Assert.ThrowsAsync<NotSupportedException>(async () => (await _messaging.PeekMessagesAsync(queue, 10)).ToList());
        Assert.Equal(["readable"], (await _messaging.PeekMessagesAsync(queue, 1)).Select(m => m.Body));
    }

    /// <summary>Correct: an invalid regular expression is answered as a validation error before any message is read.</summary>
    [Fact]
    public async Task Defect_search_with_an_invalid_regex_throws_the_regex_parse_error()
    {
        var queue = await CreateQueueAsync("bad-regex");
        await fixture.SendAsync(queue, "order 1");

        await Assert.ThrowsAsync<RegexParseException>(() =>
            _messaging.SearchMessagesAsync(queue, new MessageSearchRequest { Query = "(", IsRegex = true }));
    }

    /// <summary>Correct: a search whose last page is exactly full reports no more results.</summary>
    [Fact]
    public async Task Defect_search_reports_more_results_on_an_exactly_full_last_page()
    {
        var queue = await CreateQueueAsync("full-page");
        await fixture.SendAsync(queue, "order 1", "order 2");

        var result = await _messaging.SearchMessagesAsync(queue, new MessageSearchRequest { Query = "order", Count = 2 });

        Assert.Equal(["order 1", "order 2"], result.Messages.Select(m => m.Body));
        Assert.Equal((2, 2), (result.TotalPeeked, result.TotalMatches));
        Assert.True(result.HasMore);
    }

    /// <summary>Correct: connect fails when the broker cannot be reached, and the previous connection stays.</summary>
    [Fact]
    public async Task Defect_connect_to_a_closed_port_succeeds_without_contacting_the_broker()
    {
        var config = fixture.CreateMessagingConfig();
        var endpoint = AzureServiceBusFixture.EndpointOf(config.ConnectionString);
        config.ConnectionString = config.ConnectionString.Replace($":{endpoint.Port}/", ":1/");
        await using var provider = new AzureServiceBusProvider();

        await provider.ConnectAsync(config);

        Assert.True(provider.IsConnected);
        var firstCall = await Assert.ThrowsAsync<AggregateException>(() => provider.GetQueuesAsync());
        Assert.StartsWith("Retry failed after 4 tries", firstCall.Message);
    }

    /// <summary>Correct: the default rule of a subscription is reported as a true filter.</summary>
    [Fact]
    public async Task Defect_the_default_rule_of_a_subscription_is_reported_as_a_sql_filter()
    {
        var topic = Name(_topics, "default-rule");
        await _management.CreateTopicAsync(topic);
        await _management.CreateSubscriptionAsync(topic, "all");

        var subscription = await _management.GetSubscriptionAsync(topic, "all");
        Assert.NotNull(subscription);
        var rule = Assert.Single(subscription.Rules);
        var stored = (await fixture.Admin.GetRuleAsync(topic, "all", "$Default")).Value;

        Assert.IsType<TrueRuleFilter>(stored.Filter);
        Assert.Equal(("$Default", "SqlFilter", "1=1"), (rule.Name, rule.FilterType, rule.FilterExpression));
    }

    /// <summary>Correct: a connection to an IP address endpoint is shown with the whole address.</summary>
    [Fact]
    public async Task Defect_the_target_of_an_ip_address_endpoint_is_shown_as_its_first_octet()
    {
        await using var provider = await fixture.ConnectMessagingAsync();

        Assert.Equal("127.0.0.1", AzureServiceBusFixture.EndpointOf(fixture.MessagingConnectionString).Host);
        Assert.Equal("127", provider.CurrentTarget);
    }
}
