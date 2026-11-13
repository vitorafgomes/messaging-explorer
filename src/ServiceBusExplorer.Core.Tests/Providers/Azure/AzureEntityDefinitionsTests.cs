using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// Export and import of the definitions of a namespace against a mocked <see cref="ServiceBusAdministrationClient"/>:
/// what the document holds, what a dry run answers, what an import creates and what it leaves alone, and the document
/// refused as untrusted input before the broker is called.
/// </summary>
public class AzureEntityDefinitionsTests
{
    private const string BrokerText = "BROKER-DETAIL-SENTINEL";

    /// <summary>A namespace as the mocked administration client lists it, and every write the import sends to it, in order.</summary>
    private sealed class Namespace
    {
        public List<QueueProperties> Queues { get; } = [];
        public List<TopicProperties> Topics { get; } = [];
        public Dictionary<string, List<SubscriptionProperties>> Subscriptions { get; } = [];
        public Dictionary<string, List<RuleProperties>> Rules { get; } = [];
        public Dictionary<string, Exception> Failures { get; } = [];
        public List<string> Writes { get; } = [];
        public List<CreateQueueOptions> CreatedQueues { get; } = [];
        public Action<string>? OnWrite { get; set; }

        public Mock<ServiceBusAdministrationClient> Admin()
        {
            var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
            admin.Setup(a => a.GetQueuesAsync(It.IsAny<CancellationToken>())).Returns(() => Pages(Queues.ToArray()));
            admin.Setup(a => a.GetTopicsAsync(It.IsAny<CancellationToken>())).Returns(() => Pages(Topics.ToArray()));
            admin.Setup(a => a.GetSubscriptionsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .Returns((string topic, CancellationToken _) => Pages(Subscriptions.GetValueOrDefault(topic, []).ToArray()));
            admin.Setup(a => a.GetRulesAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .Returns((string topic, string subscription, CancellationToken _) => Pages(Rules.GetValueOrDefault($"{topic}/{subscription}", []).ToArray()));
            admin.Setup(a => a.CreateTopicAsync(It.IsAny<CreateTopicOptions>(), It.IsAny<CancellationToken>()))
                .Returns((CreateTopicOptions o, CancellationToken _) => Write<TopicProperties>($"topic {o.Name}"));
            admin.Setup(a => a.CreateQueueAsync(It.IsAny<CreateQueueOptions>(), It.IsAny<CancellationToken>()))
                .Returns((CreateQueueOptions o, CancellationToken _) =>
                {
                    CreatedQueues.Add(o);
                    return Write<QueueProperties>($"queue {o.Name}");
                });
            admin.Setup(a => a.CreateSubscriptionAsync(It.IsAny<CreateSubscriptionOptions>(), It.IsAny<CreateRuleOptions>(), It.IsAny<CancellationToken>()))
                .Returns((CreateSubscriptionOptions o, CreateRuleOptions r, CancellationToken _) =>
                    Write<SubscriptionProperties>($"subscription {o.TopicName}/{o.SubscriptionName} with rule {r.Name} {r.Filter.GetType().Name}"));
            admin.Setup(a => a.CreateRuleAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CreateRuleOptions>(), It.IsAny<CancellationToken>()))
                .Returns((string t, string s, CreateRuleOptions r, CancellationToken _) => Write<RuleProperties>($"rule {t}/{s}/{r.Name}"));
            admin.Setup(a => a.DeleteRuleAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .Returns((string t, string s, string r, CancellationToken _) => Write($"delete rule {t}/{s}/{r}"));
            return admin;
        }

        private Task<Response<T>> Write<T>(string write)
        {
            Writes.Add(write);
            OnWrite?.Invoke(write);
            return Failures.TryGetValue(write, out var error)
                ? Task.FromException<Response<T>>(error)
                : Task.FromResult(Response.FromValue(default(T)!, Mock.Of<Response>()));
        }

        private Task<Response> Write(string write)
        {
            Writes.Add(write);
            return Failures.TryGetValue(write, out var error) ? Task.FromException<Response>(error) : Task.FromResult(Mock.Of<Response>());
        }
    }

    private static AsyncPageable<T> Pages<T>(params T[] values) where T : notnull =>
        AsyncPageable<T>.FromPages([Page<T>.FromValues(values, null, Mock.Of<Response>())]);

    private static IEnumerable<Page<T>> FailingPages<T>(Exception error)
    {
        yield return Throw<Page<T>>(error);
    }

    private static T Throw<T>(Exception error) => throw error;

    private static QueueProperties Queue(string name, int maxDeliveryCount = 10, string? forwardTo = null, EntityStatus? status = null) =>
        ServiceBusModelFactory.QueueProperties(
            name: name,
            lockDuration: TimeSpan.FromSeconds(30),
            maxSizeInMegabytes: 1024,
            requiresDuplicateDetection: false,
            requiresSession: false,
            defaultMessageTimeToLive: TimeSpan.FromHours(1),
            autoDeleteOnIdle: TimeSpan.MaxValue,
            deadLetteringOnMessageExpiration: false,
            duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            maxDeliveryCount: maxDeliveryCount,
            enableBatchedOperations: true,
            status: status ?? EntityStatus.Active,
            forwardTo: forwardTo,
            forwardDeadLetteredMessagesTo: null,
            userMetadata: "",
            enablePartitioning: false);

    private static TopicProperties Topic(string name) =>
        ServiceBusModelFactory.TopicProperties(
            name: name,
            maxSizeInMegabytes: 1024,
            requiresDuplicateDetection: false,
            defaultMessageTimeToLive: TimeSpan.FromHours(1),
            autoDeleteOnIdle: TimeSpan.MaxValue,
            duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            enableBatchedOperations: true,
            status: EntityStatus.Active,
            enablePartitioning: false);

    private static SubscriptionProperties Subscription(string topic, string name, string? forwardTo = null) =>
        ServiceBusModelFactory.SubscriptionProperties(
            topicName: topic,
            subscriptionName: name,
            lockDuration: TimeSpan.FromSeconds(30),
            requiresSession: false,
            defaultMessageTimeToLive: TimeSpan.FromHours(1),
            autoDeleteOnIdle: TimeSpan.MaxValue,
            deadLetteringOnMessageExpiration: false,
            maxDeliveryCount: 10,
            enableBatchedOperations: true,
            status: EntityStatus.Active,
            forwardTo: forwardTo,
            forwardDeadLetteredMessagesTo: null,
            userMetadata: "");

    private static RuleProperties DefaultRule() => ServiceBusModelFactory.RuleProperties("$Default", new TrueRuleFilter(), null);

    private static RuleProperties SqlRule(string name, string expression) => ServiceBusModelFactory.RuleProperties(name, new SqlRuleFilter(expression), null);

    private static async Task<EntityDefinitionsDocument> ExportAsync(Namespace ns, CancellationToken cancellationToken = default) =>
        await AzureEntityDefinitions.ExportCoreAsync(ns.Admin().Object, cancellationToken);

    private static Task<DefinitionsImportResult> ImportAsync(Namespace ns, EntityDefinitionsDocument document, bool dryRun, CancellationToken cancellationToken = default) =>
        AzureEntityDefinitions.ImportCoreAsync(ns.Admin().Object, document, dryRun, NullLogger.Instance, cancellationToken);

    private static string Row(DefinitionImportItem item) =>
        $"{item.Kind} {(item.Topic is null ? "" : item.Topic + "/")}{item.Name}: {item.Outcome}"
        + (item.DifferingFields is null ? "" : $" [{string.Join(", ", item.DifferingFields)}]")
        + (item.Reason is null ? "" : $" ({item.Reason})");

    /// <summary>
    /// A source namespace: queue orders, queue billing forwarding to orders, topic events with subscription audit (only
    /// a SQL rule) and subscription email (the default rule).
    /// </summary>
    private static Namespace Source()
    {
        var ns = new Namespace();
        ns.Queues.AddRange([Queue("orders"), Queue("billing", forwardTo: "sb://example.servicebus.windows.net/orders", status: EntityStatus.SendDisabled)]);
        ns.Topics.Add(Topic("events"));
        ns.Subscriptions["events"] = [Subscription("events", "email"), Subscription("events", "audit", forwardTo: "sb://example.servicebus.windows.net/billing")];
        ns.Rules["events/audit"] = [SqlRule("high-value", "total > 100")];
        ns.Rules["events/email"] = [DefaultRule()];
        return ns;
    }

    [Fact]
    public async Task Export_writes_every_queue_topic_subscription_and_rule_with_its_configuration_into_one_version_1_document()
    {
        var document = await ExportAsync(Source());

        Assert.Equal(EntityDefinitionsDocument.CurrentVersion, document.Version);
        Assert.NotNull(document.ExportedAt);
        var queues = document.Entities!.Queues!;
        Assert.Equal(["billing", "orders"], queues.Select(q => q!.Name));
        var billing = queues[0]!.Options!;
        Assert.Equal(
            (TimeSpan.FromSeconds(30), 10, 1024L, TimeSpan.FromHours(1), TimeSpan.MaxValue, TimeSpan.FromMinutes(10), true, "orders", "", "", "SendDisabled"),
            (billing.LockDuration, billing.MaxDeliveryCount, billing.MaxSizeInMegabytes, billing.DefaultMessageTimeToLive, billing.AutoDeleteOnIdle,
                billing.DuplicateDetectionHistoryTimeWindow, billing.EnableBatchedOperations, billing.ForwardTo, billing.ForwardDeadLetteredMessagesTo, billing.UserMetadata, billing.Status));
        var topic = Assert.Single(document.Entities.Topics!)!;
        Assert.Equal(("events", TimeSpan.FromHours(1), "Active"), (topic.Name, topic.Options!.DefaultMessageTimeToLive, topic.Options.Status));
        Assert.Equal(["audit", "email"], topic.Subscriptions!.Select(s => s!.Name));
        var audit = topic.Subscriptions![0]!;
        Assert.Equal(("billing", 10), (audit.Options!.ForwardTo, audit.Options.MaxDeliveryCount));
        var rule = Assert.Single(audit.Rules!)!;
        Assert.Equal(("high-value", RuleFilterType.Sql, "total > 100"), (rule.Name, rule.FilterType, rule.SqlExpression));
        Assert.Equal(("$Default", RuleFilterType.True), (topic.Subscriptions[1]!.Rules![0]!.Name, topic.Subscriptions[1]!.Rules![0]!.FilterType));
    }

    [Fact]
    public async Task When_a_rule_enumeration_fails_the_export_fails_and_answers_no_partial_document()
    {
        var ns = Source();
        var admin = ns.Admin();
        admin.Setup(a => a.GetRulesAsync("events", "audit", It.IsAny<CancellationToken>()))
            .Returns(AsyncPageable<RuleProperties>.FromPages(FailingPages<RuleProperties>(new ServiceBusException(BrokerText, ServiceBusFailureReason.ServiceBusy))));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => AzureEntityDefinitions.ExportCoreAsync(admin.Object, CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task A_cancelled_token_stops_the_export()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => ExportAsync(Source(), cancelled.Token));
    }

    /// <summary>Pages that hold the enumeration open for a moment and count how many are open at once.</summary>
    private sealed class CountingPages<T>(T[] values, int[] open, int[] mostOpen) : AsyncPageable<T> where T : notnull
    {
        public override async IAsyncEnumerable<Page<T>> AsPages(string? continuationToken = null, int? pageSizeHint = null)
        {
            var now = Interlocked.Increment(ref open[0]);
            lock (mostOpen) mostOpen[0] = Math.Max(mostOpen[0], now);
            await Task.Delay(20);
            Interlocked.Decrement(ref open[0]);
            yield return Page<T>.FromValues(values, null, Mock.Of<Response>());
        }
    }

    [Fact]
    public async Task The_export_reads_the_rules_of_at_most_eight_subscriptions_at_once()
    {
        var ns = new Namespace();
        ns.Topics.Add(Topic("events"));
        ns.Subscriptions["events"] = Enumerable.Range(0, 40).Select(i => Subscription("events", $"s{i:00}")).ToList();
        int[] open = [0], mostOpen = [0];
        var admin = ns.Admin();
        admin.Setup(a => a.GetRulesAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(() => new CountingPages<RuleProperties>([DefaultRule()], open, mostOpen));

        var document = await AzureEntityDefinitions.ExportCoreAsync(admin.Object, CancellationToken.None);

        Assert.Equal(40, document.Entities!.Topics![0]!.Subscriptions!.Count(s => s!.Rules!.Count == 1));
        Assert.InRange(mostOpen[0], 2, AzureEntityDefinitions.ExportParallelism);
    }

    [Fact]
    public async Task A_dry_run_answers_create_exists_and_differs_with_the_differing_fields_and_writes_nothing()
    {
        var document = await ExportAsync(Source());
        var target = Source();
        target.Queues.RemoveAt(0);
        target.Queues[0] = Queue("billing", maxDeliveryCount: 5, forwardTo: "sb://example.servicebus.windows.net/orders", status: EntityStatus.SendDisabled);
        target.Rules["events/audit"] = [SqlRule("high-value", "total > 500")];
        target.Subscriptions["events"].RemoveAt(0);

        var result = await ImportAsync(target, document, dryRun: true);

        Assert.True(result.DryRun);
        Assert.Equal(
        [
            "Queue billing: Differs [maxDeliveryCount]",
            "Queue orders: Create",
            "Topic events: Exists",
            "Subscription events/audit: Differs [rules]",
            "Subscription events/email: Create"
        ], result.Items.Select(Row));
        Assert.Empty(target.Writes);
    }

    [Fact]
    public async Task Import_only_creates_an_existing_entity_that_differs_is_reported_and_left_unchanged()
    {
        var document = await ExportAsync(Source());
        var target = Source();
        target.Queues[1] = Queue("billing", maxDeliveryCount: 5, forwardTo: "sb://example.servicebus.windows.net/orders", status: EntityStatus.SendDisabled);
        target.Queues.RemoveAt(0);

        var admin = target.Admin();
        var result = await AzureEntityDefinitions.ImportCoreAsync(admin.Object, document, dryRun: false, NullLogger.Instance, CancellationToken.None);

        Assert.False(result.DryRun);
        Assert.Contains("Queue billing: Differs [maxDeliveryCount]", result.Items.Select(Row));
        Assert.Equal(["queue orders"], target.Writes);
        admin.Verify(a => a.UpdateQueueAsync(It.IsAny<QueueProperties>(), It.IsAny<CancellationToken>()), Times.Never);
        admin.Verify(a => a.DeleteQueueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Import_into_an_empty_namespace_creates_topics_then_queues_in_forward_order_then_subscriptions_each_with_its_own_rules()
    {
        var document = await ExportAsync(Source());
        var target = new Namespace();

        var result = await ImportAsync(target, document, dryRun: false);

        Assert.Equal(
        [
            "topic events",
            "queue orders",
            "queue billing",
            "subscription events/audit with rule high-value SqlRuleFilter",
            "subscription events/email with rule $Default TrueRuleFilter"
        ], target.Writes);
        Assert.All(result.Items, item => Assert.Equal(DefinitionImportOutcome.Created, item.Outcome));
        Assert.Equal(5, result.Items.Count);
        Assert.Equal(("SendDisabled", "orders"), (target.CreatedQueues.Single(q => q.Name == "billing").Status.ToString(), target.CreatedQueues.Single(q => q.Name == "billing").ForwardTo));
    }

    [Fact]
    public async Task A_subscription_with_several_rules_is_created_with_the_first_and_then_given_the_others()
    {
        var source = Source();
        source.Rules["events/audit"] = [SqlRule("high-value", "total > 100"), SqlRule("priority", "priority = 'high'")];
        var document = await ExportAsync(source);
        var target = new Namespace();
        target.Topics.Add(Topic("events"));
        target.Queues.AddRange([Queue("orders"), Queue("billing")]);
        target.Subscriptions["events"] = [Subscription("events", "email")];

        await ImportAsync(target, document, dryRun: false);

        Assert.Equal(["subscription events/audit with rule high-value SqlRuleFilter", "rule events/audit/priority"], target.Writes);
    }

    [Fact]
    public async Task A_subscription_exported_without_rules_is_created_with_a_rule_that_matches_nothing_which_is_then_removed()
    {
        var source = Source();
        source.Rules["events/audit"] = [];
        var document = await ExportAsync(source);
        var target = new Namespace();
        target.Topics.Add(Topic("events"));
        target.Queues.AddRange([Queue("orders"), Queue("billing")]);
        target.Subscriptions["events"] = [Subscription("events", "email")];

        var result = await ImportAsync(target, document, dryRun: false);

        Assert.Equal(["subscription events/audit with rule $Default FalseRuleFilter", "delete rule events/audit/$Default"], target.Writes);
        Assert.Contains("Subscription events/audit: Created", result.Items.Select(Row));
    }

    [Fact]
    public async Task When_one_create_fails_the_others_are_still_created_and_the_failure_is_reported_with_a_fixed_reason()
    {
        var document = await ExportAsync(Source());
        var target = new Namespace();
        target.Failures["queue orders"] = new ServiceBusException(BrokerText, ServiceBusFailureReason.ServiceBusy);
        target.Failures["topic events"] = new ServiceBusException(BrokerText, ServiceBusFailureReason.MessagingEntityNotFound);

        var result = await ImportAsync(target, document, dryRun: false);

        Assert.Equal(["topic events", "queue orders", "queue billing"], target.Writes);
        Assert.Equal(
        [
            "Queue billing: Created",
            "Queue orders: Failed (The broker did not create it.)",
            "Topic events: Failed (The broker did not find an entity it needs: its topic or a forward target.)",
            "Subscription events/audit: Failed (Its topic was not created.)",
            "Subscription events/email: Failed (Its topic was not created.)"
        ], result.Items.Select(Row));
        Assert.DoesNotContain(result.Items, i => i.Reason?.Contains(BrokerText) == true);
    }

    [Fact]
    public async Task When_a_further_rule_fails_the_subscription_is_reported_failed_as_created_without_all_of_its_rules()
    {
        var source = Source();
        source.Rules["events/audit"] = [SqlRule("high-value", "total > 100"), SqlRule("priority", "priority = 'high'"), SqlRule("region", "region = 'eu'")];
        var document = await ExportAsync(source);
        var target = new Namespace();
        target.Failures["rule events/audit/priority"] = new ServiceBusException(BrokerText, ServiceBusFailureReason.ServiceTimeout);

        var result = await ImportAsync(target, document, dryRun: false);

        Assert.Contains($"Subscription events/audit: Failed ({AzureEntityDefinitions.RulesIncomplete})", result.Items.Select(Row));
        Assert.DoesNotContain("rule events/audit/region", target.Writes);
        Assert.Contains("Subscription events/email: Created", result.Items.Select(Row));
    }

    [Fact]
    public async Task When_the_rule_that_matches_nothing_cannot_be_removed_the_subscription_is_reported_failed()
    {
        var source = Source();
        source.Rules["events/audit"] = [];
        var document = await ExportAsync(source);
        var target = new Namespace();
        target.Failures["delete rule events/audit/$Default"] = new ServiceBusException(BrokerText, ServiceBusFailureReason.ServiceBusy);

        var result = await ImportAsync(target, document, dryRun: false);

        Assert.Contains($"Subscription events/audit: Failed ({AzureEntityDefinitions.MatchNothingRuleKept})", result.Items.Select(Row));
    }

    [Fact]
    public async Task An_entity_someone_else_creates_during_the_import_is_left_as_it_is_and_said_so()
    {
        var document = await ExportAsync(Source());
        var target = new Namespace();
        target.Failures["queue orders"] = new ServiceBusException(BrokerText, ServiceBusFailureReason.MessagingEntityAlreadyExists);

        var result = await ImportAsync(target, document, dryRun: false);

        Assert.Contains($"Queue orders: Exists ({AzureEntityDefinitions.CreatedMeanwhile})", result.Items.Select(Row));
    }

    [Fact]
    public async Task Cancelling_during_the_import_stops_it_before_the_next_create()
    {
        var document = await ExportAsync(Source());
        var target = new Namespace();
        using var cancel = new CancellationTokenSource();
        target.OnWrite = write => { if (write == "topic events") cancel.Cancel(); };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => ImportAsync(target, document, dryRun: false, cancel.Token));

        Assert.Equal(["topic events"], target.Writes);
    }

    [Fact]
    public async Task A_first_rule_outside_the_limits_creates_no_subscription()
    {
        var ns = new Namespace();

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => AzureServiceBusProvider.CreateSubscriptionCoreAsync(
            ns.Admin().Object, "events", "audit", null, new SubscriptionRuleInfo { Name = "high-value", FilterType = RuleFilterType.Sql }));

        Assert.Equal("sqlExpression is required for filterType Sql and must be 1 to 1024 characters.", error.Message);
        Assert.Empty(ns.Writes);
    }

    private static EntityDefinitionsDocument Document(params QueueDefinition?[] queues) => new()
    {
        Version = 1,
        Entities = new EntityDefinitions { Queues = queues.ToList(), Topics = [] }
    };

    private static async Task<string> RefusedAsync(EntityDefinitionsDocument document)
    {
        var target = new Namespace();
        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => ImportAsync(target, document, dryRun: true));
        Assert.Empty(target.Writes);
        return error.Message;
    }

    [Theory]
    [InlineData(null)]
    [InlineData(2)]
    public async Task A_document_of_an_unknown_version_is_refused_before_the_namespace_is_read(int? version)
    {
        var document = Document(new QueueDefinition { Name = "orders" });
        document.Version = version;

        Assert.Equal("version must be 1.", await RefusedAsync(document));
    }

    [Fact]
    public async Task A_document_without_entities_is_refused()
    {
        Assert.Equal("entities is required.", await RefusedAsync(new EntityDefinitionsDocument { Version = 1 }));
    }

    [Fact]
    public async Task A_document_of_more_than_5000_queues_topics_and_subscriptions_is_refused()
    {
        var document = Document(Enumerable.Range(0, 4000).Select(i => new QueueDefinition { Name = $"q{i}" }).ToArray());
        document.Entities!.Topics = [new TopicDefinition { Name = "events", Subscriptions = Enumerable.Range(0, 1000).Select(i => (SubscriptionDefinition?)new SubscriptionDefinition { Name = $"s{i}" }).ToList() }];

        Assert.Equal("entities must hold at most 5000 queues, topics and subscriptions.", await RefusedAsync(document));
    }

    [Fact]
    public async Task A_document_of_more_than_10000_rules_is_refused()
    {
        var rules = Enumerable.Range(0, 10001).Select(i => (SubscriptionRuleInfo?)new SubscriptionRuleInfo { Name = $"r{i}", FilterType = RuleFilterType.True }).ToList();
        var document = Document();
        document.Entities!.Topics = [new TopicDefinition { Name = "events", Subscriptions = [new SubscriptionDefinition { Name = "audit", Rules = rules }] }];

        Assert.Equal("entities must hold at most 10000 rules.", await RefusedAsync(document));
    }

    [Fact]
    public async Task A_null_entry_in_any_list_is_refused_by_its_place_in_the_document()
    {
        var document = Document((QueueDefinition?)null);
        document.Entities!.Topics =
        [
            null,
            new TopicDefinition { Name = "events", Subscriptions = [null, new SubscriptionDefinition { Name = "audit", Rules = [null] }] }
        ];

        Assert.Equal(
            "entities.queues[0] must be an object. entities.topics[0] must be an object. entities.topics[1].subscriptions[0] must be an object. "
            + "entities.topics[1].subscriptions[1].rules[0] must be an object.",
            await RefusedAsync(document));
    }

    [Fact]
    public async Task A_name_used_twice_in_any_case_is_refused_for_queues_and_topics_subscriptions_and_rules()
    {
        var document = Document(new QueueDefinition { Name = "orders" });
        var rule = new SubscriptionRuleInfo { Name = "all", FilterType = RuleFilterType.True };
        document.Entities!.Topics =
        [
            new TopicDefinition
            {
                Name = "ORDERS",
                Subscriptions =
                [
                    new SubscriptionDefinition { Name = "audit", Rules = [rule, new SubscriptionRuleInfo { Name = "ALL", FilterType = RuleFilterType.False }] },
                    new SubscriptionDefinition { Name = "Audit" }
                ]
            }
        ];

        Assert.Equal(
            "entities.topics[0]: name is used by another queue or topic in the document; names are not case-sensitive. "
            + "entities.topics[0].subscriptions[0].rules[1]: name is used by another rule of the subscription in the document; names are not case-sensitive. "
            + "entities.topics[0].subscriptions[1]: name is used by another subscription of the topic in the document; names are not case-sensitive.",
            await RefusedAsync(document));
    }

    [Fact]
    public async Task Every_name_setting_and_rule_goes_through_the_create_rules_and_is_refused_by_its_place_in_the_document()
    {
        var document = Document(
            new QueueDefinition { Name = "orders", Options = new QueueCreateOptions { LockDuration = TimeSpan.FromMinutes(6) } },
            new QueueDefinition { Name = "bad name" },
            new QueueDefinition { Name = "billing", Options = new QueueCreateOptions { Status = "Paused" } });
        document.Entities!.Topics =
        [
            new TopicDefinition
            {
                Name = "events",
                Subscriptions = [new SubscriptionDefinition { Name = "audit", Rules = [new SubscriptionRuleInfo { Name = "high-value", FilterType = RuleFilterType.Sql }] }]
            }
        ];

        Assert.Equal(
            "entities.queues[0]: lockDuration must be between 00:00:05 and 00:05:00. "
            + "entities.queues[1]: name must be 1 to 260 characters of letters, digits, '.', '-', '_' or '/', not starting or ending with '/'. "
            + "entities.queues[2]: status must be one of Active, Disabled, SendDisabled, ReceiveDisabled. "
            + "entities.topics[0].subscriptions[0].rules[0]: sqlExpression is required for filterType Sql and must be 1 to 1024 characters.",
            await RefusedAsync(document));
    }

    [Fact]
    public async Task At_most_twenty_violations_are_listed_and_the_rest_are_counted()
    {
        var document = Document(Enumerable.Range(0, 25).Select(_ => new QueueDefinition { Name = "" }).ToArray());

        var message = await RefusedAsync(document);

        Assert.StartsWith("entities.queues[0]: name is required. ", message);
        Assert.EndsWith("entities.queues[19]: name is required. And 5 more.", message);
    }

    [Theory]
    [InlineData("queues")]
    [InlineData("topics")]
    [InlineData("subscriptions")]
    public async Task When_a_queue_topic_or_subscription_enumeration_fails_the_export_fails_and_answers_no_partial_document(string failing)
    {
        var admin = Source().Admin();
        var error = new ServiceBusException(BrokerText, ServiceBusFailureReason.ServiceBusy);
        switch (failing)
        {
            case "queues":
                admin.Setup(a => a.GetQueuesAsync(It.IsAny<CancellationToken>())).Returns(AsyncPageable<QueueProperties>.FromPages(FailingPages<QueueProperties>(error)));
                break;
            case "topics":
                admin.Setup(a => a.GetTopicsAsync(It.IsAny<CancellationToken>())).Returns(AsyncPageable<TopicProperties>.FromPages(FailingPages<TopicProperties>(error)));
                break;
            default:
                admin.Setup(a => a.GetSubscriptionsAsync("events", It.IsAny<CancellationToken>())).Returns(AsyncPageable<SubscriptionProperties>.FromPages(FailingPages<SubscriptionProperties>(error)));
                break;
        }

        var thrown = await Assert.ThrowsAsync<ServiceBusException>(() => AzureEntityDefinitions.ExportCoreAsync(admin.Object, CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, thrown.Reason);
    }

    [Fact]
    public async Task When_a_subscription_create_fails_it_is_reported_with_a_fixed_reason_and_its_sibling_is_still_created()
    {
        var document = await ExportAsync(Source());
        var target = new Namespace();
        target.Failures["subscription events/audit with rule high-value SqlRuleFilter"] = new ServiceBusException(BrokerText, ServiceBusFailureReason.ServiceBusy);

        var result = await ImportAsync(target, document, dryRun: false);

        Assert.Contains("Subscription events/audit: Failed (The broker did not create it.)", result.Items.Select(Row));
        Assert.Contains("Subscription events/email: Created", result.Items.Select(Row));
        Assert.Contains("subscription events/email with rule $Default TrueRuleFilter", target.Writes);
    }
}
