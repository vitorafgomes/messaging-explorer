using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// What the Azure Service Bus provider does correctly today, against the emulator. Entity tests use
/// the provider connected to the management endpoint, message tests the one connected to the AMQP
/// endpoint.
/// </summary>
[Collection(AzureServiceBusCollection.Name)]
public sealed class AzureServiceBusProviderTests(AzureServiceBusFixture fixture) : IAsyncLifetime
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

    private async Task<long> DeadLetterSequenceOfAsync(string queue, string body) =>
        (await _messaging.PeekMessagesAsync(queue, 10, subQueue: MessageSubQueue.DeadLetter)).Single(m => m.Body == body).SequenceNumber!.Value;

    [Fact]
    public async Task TestConnection_is_true_for_the_emulator_management_endpoint()
    {
        Assert.True(await new AzureServiceBusProvider().TestConnectionAsync(fixture.CreateManagementConfig()));
    }

    [Fact]
    public async Task TestConnection_is_false_for_a_closed_port()
    {
        var config = fixture.CreateManagementConfig();
        var endpoint = AzureServiceBusFixture.EndpointOf(config.ConnectionString);
        config.ConnectionString = config.ConnectionString.Replace($":{endpoint.Port}/", ":1/");

        Assert.False(await new AzureServiceBusProvider().TestConnectionAsync(config));
    }

    [Fact]
    public async Task TestConnection_is_false_for_the_messaging_endpoint_because_it_probes_the_management_api()
    {
        Assert.False(await new AzureServiceBusProvider().TestConnectionAsync(fixture.CreateMessagingConfig()));
    }

    [Fact]
    public async Task Connect_opens_the_connection_and_disconnect_closes_it()
    {
        var provider = await fixture.ConnectMessagingAsync();
        var connectedWhileOpen = provider.IsConnected;

        await provider.DisconnectAsync();

        Assert.True(connectedWhileOpen);
        Assert.False(provider.IsConnected);
        Assert.Null(provider.CurrentTarget);
        await Assert.ThrowsAsync<InvalidOperationException>(() => provider.PeekMessagesAsync("queue.1"));
    }

    [Fact]
    public async Task A_created_queue_is_listed_read_and_deleted()
    {
        var queue = Name(_queues, "crud");

        await _management.CreateQueueAsync(queue);
        var listed = (await _management.GetQueuesAsync()).Select(q => q.Name).ToList();
        var read = await _management.GetQueueAsync(queue);
        await _management.DeleteQueueAsync(queue);

        Assert.Contains(queue, listed);
        Assert.Equal(queue, read?.Name);
        Assert.Null(await _management.GetQueueAsync(queue));
        Assert.False((await fixture.Admin.QueueExistsAsync(queue)).Value);
    }

    [Fact]
    public async Task Queue_details_show_the_configured_values_and_the_status_instead_of_zeros()
    {
        var queue = Name(_queues, "details");
        await _management.CreateQueueAsync(queue, new QueueCreateOptions
        {
            LockDuration = TimeSpan.FromSeconds(45),
            MaxDeliveryCount = 3,
            RequiresSession = true,
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(30),
            DeadLetteringOnMessageExpiration = true
        });

        var shown = await _management.GetQueueAsync(queue);

        Assert.NotNull(shown);
        Assert.Equal(queue, shown.Name);
        Assert.Equal(
            (TimeSpan.FromSeconds(45), 3, true, TimeSpan.FromMinutes(30), true, 100L, "Active"),
            (shown.LockDuration, shown.MaxDeliveryCount, shown.RequiresSession, shown.DefaultMessageTimeToLive, shown.DeadLetteringOnMessageExpiration, shown.MaxSizeInMegabytes, shown.Status));
    }

    [Fact]
    public async Task A_created_topic_and_subscription_are_listed_read_and_deleted()
    {
        var topic = Name(_topics, "topic");

        await _management.CreateTopicAsync(topic);
        await _management.CreateSubscriptionAsync(topic, "audit");
        var topics = (await _management.GetTopicsAsync()).Select(t => t.Name).ToList();
        var read = Assert.IsType<TopicInfo>(await _management.GetTopicAsync(topic));
        var listed = Assert.Single(await _management.GetSubscriptionsAsync(topic));
        var subscription = await _management.GetSubscriptionAsync(topic, "audit");
        await _management.DeleteSubscriptionAsync(topic, "audit");
        var afterSubscriptionDelete = await _management.GetSubscriptionAsync(topic, "audit");
        await _management.DeleteTopicAsync(topic);

        Assert.Contains(topic, topics);
        Assert.Equal("audit", Assert.Single(read.Subscriptions).Name);
        Assert.Equal("audit", listed.Name);
        Assert.Equal(topic, subscription?.TopicName);
        Assert.Equal("$Default", Assert.Single(subscription!.Rules).Name);
        Assert.Null(afterSubscriptionDelete);
        Assert.Null(await _management.GetTopicAsync(topic));
    }

    private const string RuleRefusal = "The broker refused this rule. Check the expression.";

    private static SubscriptionRuleInfo DefaultRule => new() { Name = "$Default", FilterType = RuleFilterType.True };

    private async Task<string> TopicWithSubscriptionAsync(string tag)
    {
        var topic = Name(_topics, tag);
        await _management.CreateTopicAsync(topic);
        await _management.CreateSubscriptionAsync(topic, "audit");
        return topic;
    }

    private async Task<List<string?>> RuleNamesAsync(string topic) =>
        (await _management.GetRulesAsync(topic, "audit")).Select(r => r.Name).ToList();

    [Fact]
    public async Task The_default_rule_of_a_subscription_is_listed_and_read_as_a_true_filter()
    {
        var topic = await TopicWithSubscriptionAsync("default-rule");

        var listed = Assert.Single(await _management.GetRulesAsync(topic, "audit"));
        var read = Assert.Single((await _management.GetSubscriptionAsync(topic, "audit"))!.Rules);

        Assert.Equivalent(DefaultRule, listed, strict: true);
        Assert.Equivalent(DefaultRule, read, strict: true);
    }

    [Fact]
    public async Task A_sql_rule_with_an_action_and_a_correlation_rule_with_typed_properties_are_added_and_read_back_with_their_types()
    {
        var topic = await TopicWithSubscriptionAsync("add-rules");
        var sql = new SubscriptionRuleInfo
        {
            Name = "physical-goods",
            FilterType = RuleFilterType.Sql,
            SqlExpression = "category = 'physical' AND total > 0",
            SqlAction = "SET priority = 'normal'"
        };
        var correlation = new SubscriptionRuleInfo
        {
            Name = "by-tenant",
            FilterType = RuleFilterType.Correlation,
            Correlation = new CorrelationFilterInfo
            {
                CorrelationId = "c-1", MessageId = "m-1", To = "billing", ReplyTo = "replies", Subject = "order.created",
                SessionId = "s-1", ReplyToSessionId = "rs-1", ContentType = "application/json",
                ApplicationProperties =
                [
                    new() { Name = "tenant", Type = RulePropertyType.String, Value = "contoso-uk" },
                    new() { Name = "priority", Type = RulePropertyType.Int64, Value = "3" },
                    new() { Name = "urgent", Type = RulePropertyType.Boolean, Value = "true" }
                ]
            }
        };

        var createdSql = await _management.CreateRuleAsync(topic, "audit", sql);
        var createdCorrelation = await _management.CreateRuleAsync(topic, "audit", correlation);
        var listed = await _management.GetRulesAsync(topic, "audit");
        var stored = Assert.IsType<CorrelationRuleFilter>((await fixture.Admin.GetRuleAsync(topic, "audit", "by-tenant")).Value.Filter);

        Assert.Equivalent(sql, createdSql, strict: true);
        Assert.Equivalent(correlation, createdCorrelation, strict: true);
        Assert.Equivalent(new[] { DefaultRule, sql, correlation }, listed, strict: true);
        Assert.Equal(new Dictionary<string, object> { ["tenant"] = "contoso-uk", ["priority"] = 3L, ["urgent"] = true }, stored.ApplicationProperties);
    }

    [Fact]
    public async Task Replacing_a_rule_keeps_its_name_and_changes_its_filter_and_its_action()
    {
        var topic = await TopicWithSubscriptionAsync("replace-rule");
        await _management.CreateRuleAsync(topic, "audit", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.Sql, SqlExpression = "total > 0", SqlAction = "SET checked = TRUE" });
        var expected = new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.Correlation, Correlation = new CorrelationFilterInfo { Subject = "order.created" } };

        var replaced = await _management.UpdateRuleAsync(topic, "audit", "orders",
            new SubscriptionRuleInfo { FilterType = RuleFilterType.Correlation, Correlation = new CorrelationFilterInfo { Subject = "order.created" } });
        var listed = (await _management.GetRulesAsync(topic, "audit")).Single(r => r.Name == "orders");

        Assert.Equivalent(expected, replaced, strict: true);
        Assert.Equivalent(expected, listed, strict: true);
    }

    [Fact]
    public async Task Deleting_a_rule_and_then_the_last_one_leaves_the_subscription_with_no_rule()
    {
        var topic = await TopicWithSubscriptionAsync("delete-rules");
        await _management.CreateRuleAsync(topic, "audit", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.False });

        await _management.DeleteRuleAsync(topic, "audit", "$Default");
        var afterOne = await RuleNamesAsync(topic);
        await _management.DeleteRuleAsync(topic, "audit", "orders");
        var afterLast = await RuleNamesAsync(topic);

        Assert.Equal(["orders"], afterOne);
        Assert.Empty(afterLast);
    }

    [Fact]
    public async Task A_rule_whose_expression_or_action_does_not_parse_is_refused_with_the_fixed_text_and_nothing_is_created()
    {
        var topic = await TopicWithSubscriptionAsync("bad-rule");

        var filter = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => _management.CreateRuleAsync(topic, "audit",
            new SubscriptionRuleInfo { Name = "bad-filter", FilterType = RuleFilterType.Sql, SqlExpression = "this is (( not sql" }));
        var action = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => _management.CreateRuleAsync(topic, "audit",
            new SubscriptionRuleInfo { Name = "bad-action", FilterType = RuleFilterType.True, SqlAction = "this is (( not sql" }));

        Assert.Equal((RuleRefusal, RuleRefusal), (filter.Message, action.Message));
        Assert.Equal(["$Default"], await RuleNamesAsync(topic));
    }

    [Fact]
    public async Task A_rule_name_that_exists_is_already_exists()
    {
        var topic = await TopicWithSubscriptionAsync("duplicate-rule");

        await Assert.ThrowsAsync<EntityAlreadyExistsException>(() => _management.CreateRuleAsync(topic, "audit", DefaultRule));
    }

    [Fact]
    public async Task A_missing_rule_subscription_or_topic_is_not_found()
    {
        var topic = await TopicWithSubscriptionAsync("missing-rule");
        var rule = new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.True };

        await Assert.ThrowsAsync<EntityNotFoundException>(() => _management.UpdateRuleAsync(topic, "audit", "orders", rule));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => _management.DeleteRuleAsync(topic, "audit", "orders"));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => _management.CreateRuleAsync(topic, "missing", rule));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => _management.GetRulesAsync(topic, "missing"));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => _management.GetRulesAsync(AzureServiceBusFixture.UniqueName("no-topic"), "audit"));
    }

    [Fact]
    public async Task A_subscription_created_with_an_invalid_filter_does_not_exist_afterwards_and_can_be_created_again()
    {
        var topic = Name(_topics, "bad-filter");
        await _management.CreateTopicAsync(topic);

        var refused = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            _management.CreateSubscriptionAsync(topic, "filtered", new SubscriptionCreateOptions { FilterExpression = "this is (( not sql" }));
        Assert.Equal("The broker refused this configuration.", refused.Message);
        Assert.Null(await _management.GetSubscriptionAsync(topic, "filtered"));

        await _management.CreateSubscriptionAsync(topic, "filtered", new SubscriptionCreateOptions { FilterExpression = "category = 'physical'" });
        var created = await _management.GetSubscriptionAsync(topic, "filtered");

        var rule = Assert.Single(created!.Rules);
        Assert.Equal(("CustomFilter", RuleFilterType.Sql, "category = 'physical'"), (rule.Name, rule.FilterType, rule.SqlExpression));
    }

    [Fact]
    public async Task Body_content_type_subject_ids_session_and_a_string_property_survive_send_then_peek()
    {
        var queue = await CreateQueueAsync("fields", o => o.RequiresSession = true);

        await _messaging.SendMessageAsync(queue, new SendMessageRequest
        {
            Body = "{\"order\":42}",
            ContentType = "application/json",
            Subject = "order-created",
            CorrelationId = "correlation-1",
            MessageId = "message-1",
            SessionId = "session-1",
            ApplicationProperties = new Dictionary<string, object> { ["tenant"] = "contoso" }
        });
        var message = Assert.Single(await _messaging.PeekMessagesAsync(queue, 1));

        Assert.Equal("{\"order\":42}", message.Body);
        Assert.Equal("application/json", message.ContentType);
        Assert.Equal("order-created", message.Subject);
        Assert.Equal("correlation-1", message.CorrelationId);
        Assert.Equal("message-1", message.MessageId);
        Assert.Equal("session-1", message.SessionId);
        Assert.Equal("contoso", message.ApplicationProperties["tenant"]);
    }

    [Fact]
    public async Task A_searched_message_says_whether_it_is_active_or_scheduled_and_its_size_in_bytes()
    {
        var queue = await CreateQueueAsync("state");
        await _messaging.SendMessageAsync(queue, new SendMessageRequest { Body = "now €" });
        await _messaging.SendMessageAsync(queue, new SendMessageRequest { Body = "later", ScheduledEnqueueTime = DateTimeOffset.UtcNow.AddMinutes(10) });

        var found = await _messaging.SearchMessagesAsync(queue, new MessageSearchRequest { Property = "body", Count = 10 });

        Assert.Equal(
            [("now €", "Active", 7L), ("later", "Scheduled", 5L)],
            found.Messages.Select(m => (m.Body, m.State, m.SizeInBytes)).ToList());
    }

    [Fact]
    public async Task The_session_list_holds_every_session_of_a_queue()
    {
        var queue = await CreateQueueAsync("session-list", o => o.RequiresSession = true);
        var sessionIds = Enumerable.Range(0, 20).Select(i => $"session-{i:D2}").ToList();
        foreach (var sessionId in sessionIds)
        {
            await _messaging.SendMessageAsync(queue, new SendMessageRequest { Body = sessionId, SessionId = sessionId });
        }

        var listed = (await _messaging.GetSessionsAsync(queue, null, 1000)).Sessions.Select(s => s.SessionId).ToList();

        Assert.Equal(sessionIds, listed);
    }

    [Fact]
    public async Task Receive_returns_the_message_and_removes_it()
    {
        var queue = await CreateQueueAsync("receive");
        await fixture.SendAsync(queue, "only");

        var received = Assert.Single(await _messaging.ReceiveMessagesAsync(queue, 10));

        Assert.Equal("only", received.Body);
        Assert.Empty(await fixture.DrainAsync(queue));
    }

    [Fact]
    public async Task A_message_sent_to_a_topic_reaches_each_subscription()
    {
        var topic = Name(_topics, "fanout");
        await fixture.Admin.CreateTopicAsync(topic);
        await fixture.Admin.CreateSubscriptionAsync(topic, "first");
        await fixture.Admin.CreateSubscriptionAsync(topic, "second");

        await _messaging.SendMessageAsync(topic, new SendMessageRequest { Body = "broadcast" });

        Assert.Equal("broadcast", Assert.Single(await PeekSubscriptionWhenForwardedAsync(topic, "first")).Body);
        Assert.Equal("broadcast", Assert.Single(await PeekSubscriptionWhenForwardedAsync(topic, "second")).Body);
    }

    private async Task<List<IMessage>> PeekSubscriptionWhenForwardedAsync(string topic, string subscription)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (true)
        {
            var peeked = (await _messaging.PeekMessagesAsync(topic, 10, subscriptionName: subscription)).ToList();
            if (peeked.Count > 0 || DateTime.UtcNow > deadline)
            {
                return peeked;
            }

            await Task.Delay(100);
        }
    }

    [Fact]
    public async Task A_message_over_the_max_delivery_count_and_an_explicitly_dead_lettered_one_are_on_the_dead_letter_side()
    {
        var queue = await CreateQueueAsync("dlq", o => o.MaxDeliveryCount = 2);
        await fixture.SendAsync(queue, "poison", "rejected");
        await using (var receiver = fixture.Client.CreateReceiver(queue))
        {
            for (var delivery = 0; delivery < 2; delivery++)
            {
                var poison = await receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(5));
                Assert.Equal("poison", poison.Body.ToString());
                await receiver.AbandonMessageAsync(poison);
            }

            var rejected = await receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(5));
            Assert.Equal("rejected", rejected.Body.ToString());
            await receiver.DeadLetterMessageAsync(rejected, "rejected-by-test", "explicit");
        }

        var deadLetters = (await _messaging.PeekMessagesAsync(queue, 10, subQueue: MessageSubQueue.DeadLetter)).ToList();

        Assert.Equal(
            [("poison", "MaxDeliveryCountExceeded"), ("rejected", "rejected-by-test")],
            deadLetters.Select(m => (m.Body, m.DeadLetterReason)).ToList());
        Assert.All(deadLetters, m => Assert.True(m.IsDeadLettered));
        Assert.Empty(await _messaging.PeekMessagesAsync(queue, 10));
    }

    [Fact]
    public async Task Bulk_delete_of_a_selected_dead_letter_message_removes_only_that_one()
    {
        var queue = await CreateQueueAsync("bulk-delete");
        await fixture.SendToDeadLetterAsync(queue, "m1", "m2", "m3");
        var target = await DeadLetterSequenceOfAsync(queue, "m2");

        var result = await _messaging.DeleteMessagesAsync(queue, [target], subQueue: MessageSubQueue.DeadLetter);

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(["m1", "m3"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(queue)));
    }

    [Fact]
    public async Task Bulk_resubmit_sends_a_selected_dead_letter_message_back_to_its_queue_and_removes_it()
    {
        var queue = await CreateQueueAsync("bulk-resubmit");
        await fixture.SendToDeadLetterAsync(queue, "m1", "m2");
        var target = await DeadLetterSequenceOfAsync(queue, "m1");

        var result = await _messaging.ResubmitDeadLetterMessagesAsync(queue, [target]);

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(["m1"], await fixture.DrainAsync(queue));
        Assert.Equal(["m2"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(queue)));
    }

    [Fact]
    public async Task Bulk_move_sends_a_selected_dead_letter_message_to_another_queue_and_removes_it()
    {
        var source = await CreateQueueAsync("move-source");
        var target = await CreateQueueAsync("move-target");
        await fixture.SendToDeadLetterAsync(source, "m1", "m2");
        var selected = await DeadLetterSequenceOfAsync(source, "m2");

        var result = await _messaging.MoveMessagesAsync(source, target, [selected], subQueue: MessageSubQueue.DeadLetter);

        Assert.Equal((1, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal(["m2"], await fixture.DrainAsync(target));
        Assert.Equal(["m1"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(source)));
    }

    [Fact]
    public async Task Bulk_delete_resubmit_and_move_with_an_already_cancelled_token_throw_and_change_nothing()
    {
        var source = await CreateQueueAsync("cancel-source");
        var target = await CreateQueueAsync("cancel-target");
        await fixture.SendToDeadLetterAsync(source, "m1");
        var selected = await DeadLetterSequenceOfAsync(source, "m1");
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            _messaging.DeleteMessagesAsync(source, [selected], subQueue: MessageSubQueue.DeadLetter, cancellationToken: cancelled.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            _messaging.ResubmitDeadLetterMessagesAsync(source, [selected], cancellationToken: cancelled.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            _messaging.MoveMessagesAsync(source, target, [selected], subQueue: MessageSubQueue.DeadLetter, cancellationToken: cancelled.Token));

        Assert.Equal(["m1"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(source)));
        Assert.Empty(await fixture.DrainAsync(source));
        Assert.Empty(await fixture.DrainAsync(target));
    }

    [Fact]
    public async Task A_queue_created_with_options_has_those_options()
    {
        var target = await CreateQueueAsync("fwd-target");
        var queue = Name(_queues, "create-options");

        await _management.CreateQueueAsync(queue, new QueueCreateOptions
        {
            LockDuration = TimeSpan.FromSeconds(45),
            MaxDeliveryCount = 7,
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(30),
            DeadLetteringOnMessageExpiration = true,
            RequiresDuplicateDetection = true,
            DuplicateDetectionHistoryTimeWindow = TimeSpan.FromMinutes(5),
            ForwardTo = target,
            ForwardDeadLetteredMessagesTo = target
        });
        var read = Assert.IsType<QueueInfo>(await _management.GetQueueAsync(queue));

        Assert.Equal(
            (TimeSpan.FromSeconds(45), 7, TimeSpan.FromMinutes(30), true, true, TimeSpan.FromMinutes(5)),
            (read.LockDuration, read.MaxDeliveryCount, read.DefaultMessageTimeToLive, read.DeadLetteringOnMessageExpiration, read.RequiresDuplicateDetection, read.DuplicateDetectionHistoryTimeWindow));
        Assert.Equal((target, target), (read.ForwardTo, read.ForwardDeadLetteredMessagesTo));
    }

    [Fact]
    public async Task Creating_a_queue_that_exists_reports_that_it_already_exists()
    {
        var queue = await CreateQueueAsync("exists");

        await Assert.ThrowsAsync<EntityAlreadyExistsException>(() => _management.CreateQueueAsync(queue, new QueueCreateOptions { MaxDeliveryCount = 3 }));
    }

    [Fact]
    public async Task Editing_a_queue_changes_lock_duration_max_delivery_count_and_time_to_live_and_keeps_the_rest()
    {
        var queue = Name(_queues, "edit");
        await _management.CreateQueueAsync(queue, new QueueCreateOptions
        {
            LockDuration = TimeSpan.FromSeconds(45),
            MaxDeliveryCount = 3,
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(30),
            DeadLetteringOnMessageExpiration = true,
            RequiresDuplicateDetection = true,
            DuplicateDetectionHistoryTimeWindow = TimeSpan.FromMinutes(5)
        });

        await _management.UpdateQueueAsync(queue, new QueueUpdateOptions
        {
            LockDuration = TimeSpan.FromMinutes(2),
            MaxDeliveryCount = 10,
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(45)
        });
        var read = Assert.IsType<QueueInfo>(await _management.GetQueueAsync(queue));

        Assert.Equal((TimeSpan.FromMinutes(2), 10, TimeSpan.FromMinutes(45)), (read.LockDuration, read.MaxDeliveryCount, read.DefaultMessageTimeToLive));
        Assert.Equal((true, true, TimeSpan.FromMinutes(5), "Active"), (read.DeadLetteringOnMessageExpiration, read.RequiresDuplicateDetection, read.DuplicateDetectionHistoryTimeWindow, read.Status));
    }

    [Fact]
    public async Task An_empty_forward_target_clears_the_forwarding_of_a_queue()
    {
        var target = await CreateQueueAsync("fwd-target");
        var queue = Name(_queues, "fwd-clear");
        await _management.CreateQueueAsync(queue, new QueueCreateOptions { ForwardTo = target });
        var forwarding = Assert.IsType<QueueInfo>(await _management.GetQueueAsync(queue)).ForwardTo;

        await _management.UpdateQueueAsync(queue, new QueueUpdateOptions { ForwardTo = "" });
        var read = Assert.IsType<QueueInfo>(await _management.GetQueueAsync(queue));

        Assert.Equal(target, forwarding);
        Assert.True(string.IsNullOrEmpty(read.ForwardTo), $"ForwardTo is still '{read.ForwardTo}'");
    }

    [Fact]
    public async Task A_queue_disabled_for_sending_reads_send_disabled_and_reads_active_once_enabled_again()
    {
        var queue = await CreateQueueAsync("status");

        await _management.UpdateQueueAsync(queue, new QueueUpdateOptions { Status = "SendDisabled" });
        var disabled = (await _management.GetQueueAsync(queue))?.Status;
        await _management.UpdateQueueAsync(queue, new QueueUpdateOptions { Status = "Active" });
        var enabled = (await _management.GetQueueAsync(queue))?.Status;

        Assert.Equal(("SendDisabled", "Active"), (disabled, enabled));
    }

    [Fact]
    public async Task A_topic_created_with_options_has_those_options_and_an_edit_changes_only_what_it_sends()
    {
        var topic = Name(_topics, "topic-options");

        await _management.CreateTopicAsync(topic, new TopicCreateOptions
        {
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(30),
            RequiresDuplicateDetection = true,
            DuplicateDetectionHistoryTimeWindow = TimeSpan.FromMinutes(5)
        });
        var created = Assert.IsType<TopicInfo>(await _management.GetTopicAsync(topic));
        await _management.UpdateTopicAsync(topic, new TopicUpdateOptions { DefaultMessageTimeToLive = TimeSpan.FromMinutes(45), Status = "SendDisabled" });
        var edited = Assert.IsType<TopicInfo>(await _management.GetTopicAsync(topic));

        Assert.Equal(
            (TimeSpan.FromMinutes(30), true, TimeSpan.FromMinutes(5), "Active"),
            (created.DefaultMessageTimeToLive, created.RequiresDuplicateDetection, created.DuplicateDetectionHistoryTimeWindow, created.Status));
        Assert.Equal(
            (TimeSpan.FromMinutes(45), "SendDisabled", true, TimeSpan.FromMinutes(5)),
            (edited.DefaultMessageTimeToLive, edited.Status, edited.RequiresDuplicateDetection, edited.DuplicateDetectionHistoryTimeWindow));
    }

    [Fact]
    public async Task A_subscription_created_with_options_has_those_options_and_an_edit_changes_only_what_it_sends()
    {
        var target = await CreateQueueAsync("fwd-target");
        var topic = Name(_topics, "sub-options");
        await _management.CreateTopicAsync(topic);

        await _management.CreateSubscriptionAsync(topic, "audit", new SubscriptionCreateOptions
        {
            LockDuration = TimeSpan.FromSeconds(45),
            MaxDeliveryCount = 7,
            DefaultMessageTimeToLive = TimeSpan.FromMinutes(30),
            DeadLetteringOnMessageExpiration = true,
            ForwardTo = target
        });
        var created = await _management.GetSubscriptionAsync(topic, "audit");
        await _management.UpdateSubscriptionAsync(topic, "audit", new SubscriptionUpdateOptions
        {
            LockDuration = TimeSpan.FromMinutes(2),
            MaxDeliveryCount = 10,
            ForwardTo = "",
            Status = "ReceiveDisabled"
        });
        var edited = await _management.GetSubscriptionAsync(topic, "audit");

        Assert.NotNull(created);
        Assert.NotNull(edited);
        Assert.Equal(
            (TimeSpan.FromSeconds(45), 7, TimeSpan.FromMinutes(30), true, "Active"),
            (created.LockDuration, created.MaxDeliveryCount, created.DefaultMessageTimeToLive, created.DeadLetteringOnMessageExpiration, created.Status));
        Assert.Equal(target, created.ForwardTo);
        Assert.Equal(
            (TimeSpan.FromMinutes(2), 10, "ReceiveDisabled", TimeSpan.FromMinutes(30), true),
            (edited.LockDuration, edited.MaxDeliveryCount, edited.Status, edited.DefaultMessageTimeToLive, edited.DeadLetteringOnMessageExpiration));
        Assert.True(string.IsNullOrEmpty(edited.ForwardTo), $"ForwardTo is still '{edited.ForwardTo}'");
    }

    /// <summary>Replaces the pinned defect where a peek stopped at the short batch a dropped duplicate leaves.</summary>
    [Fact]
    public async Task Peeking_10_messages_of_a_queue_that_holds_2_returns_both_across_the_gap_a_dropped_duplicate_leaves()
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

        Assert.Equal(["one", "three"], peeked);
        Assert.Equal(["one", "three"], await fixture.DrainAsync(queue));
    }

    [Fact]
    public async Task A_peek_lists_a_scheduled_message_behind_an_active_one_with_its_state()
    {
        var queue = await CreateQueueAsync("peek-scheduled");
        await using (var sender = fixture.Client.CreateSender(queue))
        {
            await sender.SendMessageAsync(new ServiceBusMessage("first"));
            await sender.ScheduleMessageAsync(new ServiceBusMessage("later"), DateTimeOffset.UtcNow.AddHours(1));
            await sender.SendMessageAsync(new ServiceBusMessage("second"));
        }

        var peeked = (await _messaging.PeekMessagesAsync(queue, 10)).Select(m => (m.Body, m.State)).ToList();

        Assert.Equal([("first", "Active"), ("later", "Scheduled"), ("second", "Active")], peeked);
    }

    [Fact]
    public async Task The_transfer_dead_letter_queue_of_a_queue_without_one_answers_empty_and_is_not_its_dead_letter_queue()
    {
        var queue = await CreateQueueAsync("tdlq-queue");
        await fixture.SendToDeadLetterAsync(queue, "dead");
        await fixture.SendAsync(queue, "active");
        var dead = await DeadLetterSequenceOfAsync(queue, "dead");

        var outcome = await TransferDeadLetterOperationsAsync(queue, null, dead);

        Assert.Equal((0, 0, 0, "Not found within scan window", 0, "Not found within scan window"), outcome);
        Assert.Equal(["dead"], await fixture.DrainAsync(AzureServiceBusFixture.DeadLetterOf(queue)));
        Assert.Equal(["active"], await fixture.DrainAsync(queue));
    }

    /// <summary>
    /// Peeks, searches, deletes and resubmits the given sequence number on the transfer dead-letter queue and returns
    /// the peeked count, the searched count, the messages scanned, and each batch's successes and single failure.
    /// </summary>
    private async Task<(int, int, int, string, int, string)> TransferDeadLetterOperationsAsync(string entity, string? subscription, long sequenceNumber)
    {
        const MessageSubQueue transfer = MessageSubQueue.TransferDeadLetter;
        var peeked = await _messaging.PeekMessagesAsync(entity, 10, transfer, subscription);
        var found = await _messaging.SearchMessagesAsync(entity, new MessageSearchRequest { Query = "dead" }, transfer, subscription);
        var deleted = await _messaging.DeleteMessagesAsync(entity, [sequenceNumber], transfer, subscription);
        var resubmitted = await _messaging.ResubmitDeadLetterMessagesAsync(entity, [sequenceNumber], transfer, subscription);
        return (peeked.Count(), found.Messages.Count(), found.TotalPeeked,
            Assert.Single(deleted.Failures).Error, resubmitted.SuccessCount, Assert.Single(resubmitted.Failures).Error);
    }

    private async Task<long[]> ScheduleAsync(string queue, params string[] bodies)
    {
        await using var sender = fixture.Client.CreateSender(queue);
        var sequenceNumbers = new List<long>();
        foreach (var body in bodies)
        {
            sequenceNumbers.Add(await sender.ScheduleMessageAsync(new ServiceBusMessage(body), DateTimeOffset.UtcNow.AddHours(1)));
        }

        return [.. sequenceNumbers];
    }

    private async Task SetStatusAsync(string queue, EntityStatus status)
    {
        var properties = (await fixture.Admin.GetQueueAsync(queue)).Value;
        properties.Status = status;
        await fixture.Admin.UpdateQueueAsync(properties);
    }

    private async Task<List<(string? Body, string State)>> PeekBodiesAndStatesAsync(string queue) =>
        (await _messaging.PeekMessagesAsync(queue, 10)).Select(m => (m.Body, m.State)).ToList();

    [Fact]
    public async Task Cancelling_two_scheduled_messages_deletes_both_before_they_are_delivered()
    {
        var queue = await CreateQueueAsync("cancel-two");
        var scheduled = await ScheduleAsync(queue, "s1", "s2");
        await fixture.SendAsync(queue, "active");

        var result = await _messaging.CancelScheduledMessagesAsync(queue, scheduled);

        Assert.Equal((2, 0), (result.SuccessCount, result.FailureCount));
        Assert.Equal([("active", "Active")], await PeekBodiesAndStatesAsync(queue));
    }

    [Fact]
    public async Task A_send_a_batch_send_and_a_cancel_on_a_send_disabled_queue_answer_the_neutral_exception_and_change_nothing()
    {
        var queue = await CreateQueueAsync("send-disabled");
        var scheduled = await ScheduleAsync(queue, "later");
        await SetStatusAsync(queue, EntityStatus.SendDisabled);

        var errors = new Exception[]
        {
            await Assert.ThrowsAsync<EntityDisabledException>(() => _messaging.SendMessageAsync(queue, new SendMessageRequest { Body = "one" })),
            await Assert.ThrowsAsync<EntityDisabledException>(() => _messaging.SendMessagesAsync(queue, [new SendMessageRequest { Body = "two" }])),
            await Assert.ThrowsAsync<EntityDisabledException>(() => _messaging.CancelScheduledMessagesAsync(queue, scheduled))
        };

        Assert.All(errors, e => Assert.Equal("The entity is disabled for this operation.", e.Message));
        Assert.Equal([("later", "Scheduled")], await PeekBodiesAndStatesAsync(queue));
    }

    [Fact]
    public async Task A_receive_from_a_receive_disabled_queue_answers_the_neutral_exception_and_removes_nothing()
    {
        var queue = await CreateQueueAsync("receive-disabled");
        await fixture.SendAsync(queue, "kept");
        await SetStatusAsync(queue, EntityStatus.ReceiveDisabled);

        await Assert.ThrowsAsync<EntityDisabledException>(() => _messaging.ReceiveMessagesAsync(queue));

        Assert.Equal([("kept", "Active")], await PeekBodiesAndStatesAsync(queue));
    }

    [Fact]
    public async Task A_resubmit_into_a_send_disabled_queue_answers_the_neutral_exception_and_the_message_stays_dead_lettered()
    {
        var queue = await CreateQueueAsync("resubmit-disabled");
        await fixture.SendToDeadLetterAsync(queue, "dead");
        var dead = await DeadLetterSequenceOfAsync(queue, "dead");
        await SetStatusAsync(queue, EntityStatus.SendDisabled);

        await Assert.ThrowsAsync<EntityDisabledException>(() => _messaging.ResubmitDeadLetterMessagesAsync(queue, [dead]));

        Assert.Equal(["dead"], (await _messaging.PeekMessagesAsync(queue, 10, MessageSubQueue.DeadLetter)).Select(m => m.Body));
        Assert.Empty(await _messaging.PeekMessagesAsync(queue, 10));
    }

    [Fact]
    public async Task A_dead_letter_peek_from_the_sequence_number_of_the_third_message_does_not_return_the_first_two()
    {
        var queue = await CreateQueueAsync("dlq-from");
        await fixture.SendToDeadLetterAsync(queue, "m1", "m2", "m3", "m4", "m5");
        var third = await DeadLetterSequenceOfAsync(queue, "m3");

        var peeked = await _messaging.PeekMessagesAsync(queue, 10, MessageSubQueue.DeadLetter, fromSequenceNumber: third);

        Assert.Equal(["m3", "m4", "m5"], peeked.Select(m => m.Body));
        Assert.Equal(third, peeked.First().SequenceNumber);
        Assert.Equal(["m1", "m2", "m3", "m4", "m5"],
            (await _messaging.PeekMessagesAsync(queue, 10, MessageSubQueue.DeadLetter, fromSequenceNumber: 0)).Select(m => m.Body));
    }

    /// <summary>
    /// Finds the entity and answers null for one that does not exist. It does not prove that the counts equal the
    /// broker: the emulator reports every runtime count as zero, so equality is proven only against RabbitMQ.
    /// </summary>
    [Fact]
    public async Task A_counts_read_finds_a_created_queue_and_subscription_and_is_null_for_an_entity_that_does_not_exist()
    {
        var queue = Name(_queues, "counts");
        var topic = Name(_topics, "counts");
        await _management.CreateQueueAsync(queue);
        await _management.CreateTopicAsync(topic);
        await _management.CreateSubscriptionAsync(topic, "audit");

        var queueCounts = await _management.GetQueueCountsAsync(queue, CancellationToken.None);
        var subscriptionCounts = await _management.GetSubscriptionCountsAsync(topic, "audit", CancellationToken.None);

        Assert.Equal(queue, queueCounts?.Name);
        Assert.Equal(("audit", topic), (subscriptionCounts?.Name, subscriptionCounts?.TopicName));
        Assert.Null(await _management.GetQueueCountsAsync(AzureServiceBusFixture.UniqueName("missing"), CancellationToken.None));
        Assert.Null(await _management.GetSubscriptionCountsAsync(topic, "missing", CancellationToken.None));
    }
}
