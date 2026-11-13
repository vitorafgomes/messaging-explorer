using System.Net;
using System.Text;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// The management client releases every HTTP response it receives, on success and on failure.
/// </summary>
public class RabbitMQManagementClientTests
{
    private static readonly Dictionary<string, (string Body, Func<RabbitMQManagementClient, Task> Call)> Calls = new()
    {
        ["TestConnection"] = ("{}", c => c.TestConnectionAsync()),
        ["GetOverview"] = ("{}", c => c.GetOverviewAsync()),
        ["GetQueues"] = ("[]", c => c.GetQueuesAsync()),
        ["GetQueue"] = ("{}", c => c.GetQueueAsync("orders")),
        ["CreateQueue"] = ("", c => c.CreateQueueAsync("orders")),
        ["DeleteQueue"] = ("", c => c.DeleteQueueAsync("orders")),
        ["PurgeQueue"] = ("", c => c.PurgeQueueAsync("orders")),
        ["GetMessages"] = ("[]", c => c.GetMessagesAsync("orders")),
        ["GetExchanges"] = ("[]", c => c.GetExchangesAsync()),
        ["GetExchange"] = ("{}", c => c.GetExchangeAsync("events")),
        ["CreateExchange"] = ("", c => c.CreateExchangeAsync("events")),
        ["DeleteExchange"] = ("", c => c.DeleteExchangeAsync("events")),
        ["PublishMessage"] = ("{\"routed\":true}", c => c.PublishMessageAsync("events", "key", "payload")),
        ["GetQueueBindings"] = ("[]", c => c.GetQueueBindingsAsync("orders")),
        ["GetExchangeBindings"] = ("[]", c => c.GetExchangeBindingsAsync("events")),
        ["CreateQueueBinding"] = ("", c => c.CreateQueueBindingAsync("events", "orders")),
        ["CreateExchangeBinding"] = ("", c => c.CreateExchangeBindingAsync("events", "audit")),
        ["DeleteQueueBinding"] = ("", c => c.DeleteQueueBindingAsync("events", "orders", "~")),
        ["DeleteExchangeBinding"] = ("", c => c.DeleteExchangeBindingAsync("events", "audit", "~"))
    };

    public static TheoryData<string> CallNames => new(Calls.Keys);

    [Theory]
    [MemberData(nameof(CallNames))]
    public async Task Every_management_call_disposes_its_http_response(string callName)
    {
        var (body, call) = Calls[callName];
        var handler = new RecordingHandler(HttpStatusCode.OK, body);
        using var client = NewClient(handler);

        await call(client);

        var content = Assert.Single(handler.Contents);
        Assert.True(content.Disposed, $"{callName} left its HTTP response undisposed");
    }

    [Fact]
    public async Task A_management_call_the_broker_answers_with_500_throws_and_still_disposes_the_response()
    {
        var handler = new RecordingHandler(HttpStatusCode.InternalServerError, "broker failure");
        using var client = NewClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() => client.GetQueuesAsync());

        var content = Assert.Single(handler.Contents);
        Assert.True(content.Disposed, "the failed response was left undisposed");
    }

    public static TheoryData<string> ReadsThatTakeAToken => new() { "GetQueue", "GetExchangeBindings" };

    [Theory]
    [MemberData(nameof(ReadsThatTakeAToken))]
    public async Task A_counts_read_stops_when_the_callers_token_is_cancelled_instead_of_waiting_for_the_broker(string read)
    {
        using var client = NewClient(new HangingHandler());
        using var cts = new CancellationTokenSource();
        Task call = read == "GetQueue"
            ? client.GetQueueAsync("orders", cts.Token)
            : client.GetExchangeBindingsAsync("events", cts.Token);

        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    private sealed class HangingHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new InvalidOperationException("unreachable");
        }
    }

    private static RabbitMQManagementClient NewClient(HttpMessageHandler handler) =>
        new(new HttpClient(handler), "http://127.0.0.1:15672/api", "/", "user", "password");

    private sealed class TrackedContent(string body) : StringContent(body, Encoding.UTF8, "application/json")
    {
        public bool Disposed { get; private set; }

        protected override void Dispose(bool disposing)
        {
            Disposed = true;
            base.Dispose(disposing);
        }
    }

    private sealed class RecordingHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public List<TrackedContent> Contents { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var content = new TrackedContent(body);
            Contents.Add(content);
            return Task.FromResult(new HttpResponseMessage(status) { Content = content, RequestMessage = request });
        }
    }
}
