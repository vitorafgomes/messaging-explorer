using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Export and import of entity definitions against the emulator, through the provider connected to the management
/// endpoint. The export reads the whole namespace, so each test looks only at the entities it made.
/// </summary>
[Collection(AzureServiceBusCollection.Name)]
public sealed class AzureServiceBusDefinitionsTests(AzureServiceBusFixture fixture) : IAsyncLifetime
{
    /// <summary>The JSON the API writes: camelCase, enums as names.</summary>
    private static readonly JsonSerializerOptions ApiJson = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private readonly List<string> _queues = [];
    private readonly List<string> _topics = [];
    private IMessagingProvider _management = null!;

    public async Task InitializeAsync()
    {
        _management = await fixture.ConnectManagementAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var queue in _queues) await fixture.DeleteQueueAsync(queue);
        foreach (var topic in _topics) await fixture.DeleteTopicAsync(topic);
        await _management.DisposeAsync();
    }

    private string Name(List<string> owner, string tag)
    {
        var name = AzureServiceBusFixture.UniqueName(tag);
        owner.Add(name);
        return name;
    }

    /// <summary>
    /// A queue that forwards its dead letters to a second queue, with settings away from the defaults, and a topic whose
    /// subscription holds one SQL rule and no default rule.
    /// </summary>
    private async Task<(string Queue, string Target, string Topic)> ArrangeAsync()
    {
        var target = Name(_queues, "defs-target");
        await fixture.Admin.CreateQueueAsync(target);
        var queue = Name(_queues, "defs");
        await fixture.Admin.CreateQueueAsync(new CreateQueueOptions(queue)
        {
            MaxDeliveryCount = 7,
            LockDuration = TimeSpan.FromSeconds(45),
            ForwardDeadLetteredMessagesTo = target
        });
        var topic = Name(_topics, "defs");
        await fixture.Admin.CreateTopicAsync(topic);
        await fixture.Admin.CreateSubscriptionAsync(
            new CreateSubscriptionOptions(topic, "audit") { MaxDeliveryCount = 3 },
            new CreateRuleOptions("high-value", new SqlRuleFilter("total > 100")));
        return (queue, target, topic);
    }

    [Fact]
    public async Task Export_reads_the_queues_topics_subscriptions_and_rules_of_the_namespace_with_their_configuration()
    {
        var (queue, target, topic) = await ArrangeAsync();

        var document = await _management.ExportDefinitionsAsync();

        Assert.Equal(EntityDefinitionsDocument.CurrentVersion, document.Version);
        var exportedQueue = document.Entities!.Queues!.Single(q => q!.Name == queue)!.Options!;
        Assert.Equal((7, TimeSpan.FromSeconds(45), target, "Active"),
            (exportedQueue.MaxDeliveryCount, exportedQueue.LockDuration, exportedQueue.ForwardDeadLetteredMessagesTo, exportedQueue.Status));
        var subscription = Assert.Single(document.Entities.Topics!.Single(t => t!.Name == topic)!.Subscriptions!)!;
        Assert.Equal(("audit", 3), (subscription.Name, subscription.Options!.MaxDeliveryCount));
        var rule = Assert.Single(subscription.Rules!)!;
        Assert.Equal(("high-value", RuleFilterType.Sql, "total > 100"), (rule.Name, rule.FilterType, rule.SqlExpression));
    }

    [Fact]
    public async Task The_exported_document_holds_no_part_of_the_connection_secret()
    {
        await ArrangeAsync();
        var key = ServiceBusConnectionStringProperties.Parse(fixture.ManagementConnectionString).SharedAccessKey;
        Assert.False(string.IsNullOrEmpty(key));

        var json = JsonSerializer.Serialize(await _management.ExportDefinitionsAsync(), ApiJson);

        Assert.DoesNotContain(key, json);
        Assert.DoesNotContain("SharedAccessKey", json);
        Assert.DoesNotContain("Endpoint=", json);
        Assert.DoesNotContain("sb://", json);
    }

    /// <summary>The exported entities under new names, so the same namespace can receive them as new.</summary>
    private EntityDefinitionsDocument Renamed(EntityDefinitionsDocument exported, string queue, string target, string topic,
        out string newQueue, out string newTarget, out string newTopic)
    {
        newQueue = Name(_queues, "defs-copy");
        newTarget = Name(_queues, "defs-copy-target");
        newTopic = Name(_topics, "defs-copy");
        var queueDefinition = exported.Entities!.Queues!.Single(q => q!.Name == queue)!;
        var targetDefinition = exported.Entities.Queues!.Single(q => q!.Name == target)!;
        var topicDefinition = exported.Entities.Topics!.Single(t => t!.Name == topic)!;
        queueDefinition.Name = newQueue;
        queueDefinition.Options!.ForwardDeadLetteredMessagesTo = newTarget;
        targetDefinition.Name = newTarget;
        topicDefinition.Name = newTopic;
        return new EntityDefinitionsDocument
        {
            Version = 1,
            Entities = new EntityDefinitions { Queues = [queueDefinition, targetDefinition], Topics = [topicDefinition] }
        };
    }

    [Fact]
    public async Task A_dry_run_writes_nothing_and_the_import_then_creates_each_entity_with_its_configuration_and_only_its_own_rules()
    {
        var (queue, target, topic) = await ArrangeAsync();
        var document = Renamed(await _management.ExportDefinitionsAsync(), queue, target, topic, out var newQueue, out var newTarget, out var newTopic);

        var dryRun = await _management.ImportDefinitionsAsync(document, dryRun: true);

        Assert.All(dryRun.Items, i => Assert.Equal(DefinitionImportOutcome.Create, i.Outcome));
        Assert.Equal(4, dryRun.Items.Count);
        Assert.False((await fixture.Admin.QueueExistsAsync(newQueue)).Value);
        Assert.False((await fixture.Admin.TopicExistsAsync(newTopic)).Value);

        var imported = await _management.ImportDefinitionsAsync(document, dryRun: false);

        Assert.All(imported.Items, i => Assert.Equal((DefinitionImportOutcome.Created, null), (i.Outcome, i.Reason)));
        QueueProperties copy = await fixture.Admin.GetQueueAsync(newQueue);
        Assert.Equal((7, TimeSpan.FromSeconds(45)), (copy.MaxDeliveryCount, copy.LockDuration));
        Assert.EndsWith(newTarget, copy.ForwardDeadLetteredMessagesTo, StringComparison.OrdinalIgnoreCase);
        var rules = new List<RuleProperties>();
        await foreach (var rule in fixture.Admin.GetRulesAsync(newTopic, "audit")) rules.Add(rule);
        Assert.Equal(["high-value"], rules.Select(r => r.Name));

        var again = await _management.ImportDefinitionsAsync(document, dryRun: true);
        Assert.All(again.Items, i => Assert.Equal(DefinitionImportOutcome.Exists, i.Outcome));
    }

    [Fact]
    public async Task Import_reports_an_existing_queue_with_another_configuration_as_differing_and_leaves_it_unchanged()
    {
        var (queue, _, _) = await ArrangeAsync();
        var exported = await _management.ExportDefinitionsAsync();
        var definition = exported.Entities!.Queues!.Single(q => q!.Name == queue)!;
        definition.Options!.MaxDeliveryCount = 2;
        var document = new EntityDefinitionsDocument { Version = 1, Entities = new EntityDefinitions { Queues = [definition], Topics = [] } };

        var dryRun = await _management.ImportDefinitionsAsync(document, dryRun: true);
        var imported = await _management.ImportDefinitionsAsync(document, dryRun: false);

        Assert.Equal((DefinitionImportOutcome.Differs, "maxDeliveryCount"), (Assert.Single(dryRun.Items).Outcome, Assert.Single(dryRun.Items[0].DifferingFields!)));
        Assert.Equal(DefinitionImportOutcome.Differs, Assert.Single(imported.Items).Outcome);
        QueueProperties after = await fixture.Admin.GetQueueAsync(queue);
        Assert.Equal(7, after.MaxDeliveryCount);
    }
}
