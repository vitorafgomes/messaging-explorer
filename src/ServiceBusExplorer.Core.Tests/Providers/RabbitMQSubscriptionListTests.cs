using System.Net;
using System.Text;
using Moq;
using RabbitMQ.Client;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// Listing the subscriptions of an exchange, as the monitoring poll does every period: the management requests it
/// costs and the bindings it lists.
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
}
