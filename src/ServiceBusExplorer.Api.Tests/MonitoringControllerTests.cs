using System.Net;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Monitoring;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using static ServiceBusExplorer.Api.Tests.EntityAdministrationTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The monitoring routes as the web app reads them: the snapshot with the poll's period and its last failure, and
/// the on-demand counts of one queue or one subscription.
/// </summary>
public class MonitoringControllerTests : IClassFixture<ApiFactory>
{
    private const string Sentinel = "BROKER-DETAIL-SENTINEL";
    private const string ConstantBody = "{\"message\":\"An internal error occurred.\"}";
    private readonly ApiFactory _factory;

    public MonitoringControllerTests(ApiFactory factory) => _factory = factory;

    private static readonly QueueInfo Queue = new()
    {
        Name = "orders", ActiveMessageCount = 11, DeadLetterMessageCount = 13, TransferMessageCount = 15,
        ScheduledMessageCount = 12, TransferDeadLetterMessageCount = 14
    };

    private static readonly SubscriptionInfo Subscription = new()
    {
        TopicName = "events", Name = "audit", ActiveMessageCount = 1, DeadLetterMessageCount = 2, TransferMessageCount = 3,
        ScheduledMessageCount = 99, TransferDeadLetterMessageCount = 4
    };

    private static Func<MethodInfo, object?[], object?> Reads(IQueueEntity? queue, SubscriptionInfo? subscription) => (m, _) => m.Name switch
    {
        nameof(IMessagingProvider.GetQueueCountsAsync) => Task.FromResult(queue),
        nameof(IMessagingProvider.GetSubscriptionCountsAsync) => Task.FromResult(subscription),
        _ => null
    };

    private static Func<MethodInfo, object?[], object?> Throws(Exception failure) => (m, _) => m.Name switch
    {
        nameof(IMessagingProvider.GetQueueCountsAsync) => Task.FromException<IQueueEntity?>(failure),
        nameof(IMessagingProvider.GetSubscriptionCountsAsync) => Task.FromException<SubscriptionInfo?>(failure),
        _ => null
    };

    [Theory]
    [InlineData(-5)]
    [InlineData(0)]
    public async Task A_history_count_below_one_answers_the_history_instead_of_failing_the_request(int count)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        var response = await client.GetAsync($"/api/monitoring/history?count={count}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Array, body.RootElement.ValueKind);
    }

    [Fact]
    public async Task On_demand_refresh_of_one_queue_reads_its_counts_now_with_the_request_token_and_answers_them()
    {
        var answered = await SendAsync("GET", "/api/monitoring/counts?queue=orders", null, Reads(Queue, null));

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"name":"orders","activeMessageCount":11,"deadLetterMessageCount":13,"transferMessageCount":15,"scheduledMessageCount":12,"transferDeadLetterMessageCount":14}""", answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(nameof(IMessagingProvider.GetQueueCountsAsync), call.Method);
        Assert.Equal(new[] { "orders" }, call.Args.OfType<string>());
        Assert.True(call.Args.OfType<CancellationToken>().Single().CanBeCanceled);
    }

    [Fact]
    public async Task On_demand_refresh_of_one_subscription_answers_its_counts_with_the_scheduled_count_not_counted()
    {
        var answered = await SendAsync("GET", "/api/monitoring/counts?topic=events&subscription=audit", null, Reads(null, Subscription));

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"topicName":"events","name":"audit","activeMessageCount":1,"deadLetterMessageCount":2,"transferMessageCount":3,"scheduledMessageCount":null,"transferDeadLetterMessageCount":4}""", answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(nameof(IMessagingProvider.GetSubscriptionCountsAsync), call.Method);
        Assert.Equal(new[] { "events", "audit" }, call.Args.OfType<string>());
        Assert.True(call.Args.OfType<CancellationToken>().Single().CanBeCanceled);
    }

    [Fact]
    public async Task On_demand_refresh_on_a_provider_without_scheduled_or_transfer_dead_letter_answers_those_counts_as_null()
    {
        var answered = await SendAsync("GET", "/api/monitoring/counts?queue=orders", null, Reads(Queue, null), ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        using var body = JsonDocument.Parse(answered.Body);
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("scheduledMessageCount").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("transferDeadLetterMessageCount").ValueKind);
        Assert.Equal(11, body.RootElement.GetProperty("activeMessageCount").GetInt64());
    }

    [Theory]
    [InlineData("/api/monitoring/counts?queue=gone", "{\"message\":\"The queue was not found.\"}")]
    [InlineData("/api/monitoring/counts?topic=events&subscription=gone", "{\"message\":\"The subscription was not found.\"}")]
    public async Task On_demand_refresh_of_an_unknown_entity_answers_404_with_a_fixed_text(string path, string expected)
    {
        var answered = await SendAsync("GET", path, null, Reads(null, null));

        Assert.Equal((HttpStatusCode.NotFound, expected), (answered.Status, answered.Body));
    }

    [Theory]
    [InlineData("/api/monitoring/counts")]
    [InlineData("/api/monitoring/counts?queue=")]
    [InlineData("/api/monitoring/counts?topic=events")]
    [InlineData("/api/monitoring/counts?subscription=audit")]
    [InlineData("/api/monitoring/counts?queue=orders&topic=events")]
    [InlineData("/api/monitoring/counts?queue=orders&topic=events&subscription=audit")]
    public async Task On_demand_refresh_that_names_neither_one_queue_nor_one_subscription_answers_400_and_never_calls_the_provider(string path)
    {
        var answered = await SendAsync("GET", path, null, Reads(Queue, Subscription));

        Assert.Equal((HttpStatusCode.BadRequest, "{\"message\":\"Name either a queue, or a topic and one of its subscriptions.\"}"), (answered.Status, answered.Body));
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData("/api/monitoring/counts?queue=orders")]
    [InlineData("/api/monitoring/counts?topic=events&subscription=audit")]
    public async Task On_demand_refresh_whose_broker_read_throws_answers_the_constant_500_without_the_broker_text(string path)
    {
        var answered = await SendAsync("GET", path, null, Throws(new InvalidOperationException(Sentinel)));

        Assert.Equal((HttpStatusCode.InternalServerError, ConstantBody), (answered.Status, answered.Body));
        Assert.Single(answered.Calls);
    }

    [Fact]
    public async Task On_demand_refresh_hands_a_name_with_reserved_characters_to_the_provider_unchanged()
    {
        var answered = await SendAsync("GET", "/api/monitoring/counts?topic=t%2F1&subscription=a%2Bb%2550%25", null, Reads(null, Subscription));

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal(new[] { "t/1", "a+b%50%" }, Assert.Single(answered.Calls).Args.OfType<string>());
    }

    [Theory]
    [InlineData("/api/monitoring/counts?queue=orders")]
    [InlineData("/api/monitoring/snapshot")]
    public async Task The_monitoring_routes_answer_401_without_the_api_key(string path)
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task The_snapshot_route_answers_no_snapshot_before_the_first_poll_and_never_an_empty_one_that_looks_like_an_empty_namespace()
    {
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.UseSetting(MonitoringBackgroundService.IntervalKey, "5"));
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        var body = await client.GetStringAsync("/api/monitoring/snapshot");

        Assert.Equal("""{"snapshot":null,"pollIntervalSeconds":30,"lastPollFailedAt":null}""", body);
    }

    [Fact]
    public async Task The_snapshot_route_answers_the_last_snapshot_with_the_time_the_poll_after_it_failed()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        var store = factory.Services.GetRequiredService<MonitoringStore>();
        var collectedAt = new DateTimeOffset(2026, 11, 13, 9, 0, 0, TimeSpan.Zero);
        var failedAt = collectedAt.AddSeconds(30);
        store.Add(new MonitoringSnapshot { Timestamp = collectedAt, Queues = { new MonitoringEntityDto { Name = "orders", ActiveMessageCount = 3 } } });
        store.RecordFailure(failedAt);

        using var body = JsonDocument.Parse(await client.GetStringAsync("/api/monitoring/snapshot"));

        var root = body.RootElement;
        Assert.Equal(collectedAt, root.GetProperty("snapshot").GetProperty("timestamp").GetDateTimeOffset());
        Assert.Equal("orders", root.GetProperty("snapshot").GetProperty("queues")[0].GetProperty("name").GetString());
        Assert.Equal(failedAt, root.GetProperty("lastPollFailedAt").GetDateTimeOffset());
        Assert.Equal(30, root.GetProperty("pollIntervalSeconds").GetInt32());
    }
}
