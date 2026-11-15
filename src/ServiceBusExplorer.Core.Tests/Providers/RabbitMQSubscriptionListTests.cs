using System.Net;
using System.Text;
using Moq;
using RabbitMQ.Client;
using ServiceBusExplorer.Core.Providers.RabbitMQ;
using ServiceBusExplorer.Core.Providers.RabbitMQ.Models;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// Listing the subscriptions of an exchange, as the monitoring poll does every period: the management requests it
/// costs and the bindings it lists; and the topic read, which shows the same subscriptions from one queue listing.
/// </summary>
public class RabbitMQSubscriptionListTests
{
    private const string Bindings = """
        [
          {"source":"events","destination":"orders","destination_type":"queue","routing_key":"order.*","properties_key":"order.*"},
          {"source":"events","destination":"audit-exchange","destination_type":"exchange","routing_key":"#","properties_key":"%23"}
        ]
        """;

    private sealed class CountingHandler : HttpMessageHandler
    {
        public List<string> Paths { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = Uri.UnescapeDataString(request.RequestUri!.AbsolutePath);
            Paths.Add(path);
            var body = path.EndsWith("/bindings/source") ? Bindings : """{"name":"orders","messages_ready":3}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task Listing_the_subscriptions_of_an_exchange_reads_only_the_queues_it_binds_and_skips_an_exchange_bound_to_it()
    {
        var handler = new CountingHandler();
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        using var client = new RabbitMQManagementClient(new HttpClient(handler), "http://127.0.0.1:15672/api", "/", "user", "password");
        var provider = new RabbitMQProvider(connection.Object, client);

        var subscriptions = (await provider.GetSubscriptionsAsync("events")).ToList();

        Assert.Equal(["orders"], subscriptions.Select(s => s.Name));
        Assert.Equal(
            ["/api/exchanges///events/bindings/source", "/api/queues///orders", "/api/queues///orders.dlq"],
            handler.Paths);
    }

    private const string Queues = """
        [
          {"name":"orders","state":"idle","messages_ready":3},
          {"name":"orders.dlq","state":"running","messages_ready":2}
        ]
        """;

    /// <summary>Answers the topic read: the exchange, its bindings, and the queue listing with the given status code.</summary>
    private sealed class TopicHandler(HttpStatusCode queuesStatus) : HttpMessageHandler
    {
        public List<string> Paths { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = Uri.UnescapeDataString(request.RequestUri!.AbsolutePath);
            Paths.Add(path);
            var (status, body) = path switch
            {
                _ when path.EndsWith("/bindings/source") => (HttpStatusCode.OK, Bindings),
                "/api/queues//" => (queuesStatus, Queues),
                _ => (HttpStatusCode.OK, """{"name":"events","type":"topic"}""")
            };
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private static (RabbitMQProvider Provider, TopicHandler Handler, RabbitMQManagementClient Client) TopicProvider(HttpStatusCode queuesStatus)
    {
        var handler = new TopicHandler(queuesStatus);
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        var client = new RabbitMQManagementClient(new HttpClient(handler), "http://127.0.0.1:15672/api", "/", "user", "password");
        return (new RabbitMQProvider(connection.Object, client), handler, client);
    }

    [Fact]
    public async Task A_topic_read_shows_each_bound_queues_state_and_counts_from_the_one_queue_listing_and_no_rule_count()
    {
        var (provider, handler, client) = TopicProvider(HttpStatusCode.OK);
        using var owned = client;

        var topic = Assert.IsType<RabbitMQExchangeInfo>(await provider.GetTopicAsync("events"));

        Assert.Equal([("orders", "idle", 3L, 2L, (int?)null)], topic.Subscriptions.Select(s => (s.Name, s.Status, s.ActiveMessageCount, s.DeadLetterMessageCount, s.RuleCount)));
        Assert.Equal(1, handler.Paths.Count(p => p.StartsWith("/api/queues")));
    }

    [Fact]
    public async Task A_failed_queue_listing_fails_the_topic_read_instead_of_showing_invented_statuses()
    {
        var (provider, _, client) = TopicProvider(HttpStatusCode.InternalServerError);
        using var owned = client;

        var error = await Assert.ThrowsAsync<HttpRequestException>(() => provider.GetTopicAsync("events"));

        Assert.Equal(HttpStatusCode.InternalServerError, error.StatusCode);
    }
}
