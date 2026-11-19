using System.Net;
using System.Text;
using Microsoft.Extensions.Logging;
using Moq;
using RabbitMQ.Client;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// What the RabbitMQ provider says through the application's logger instead of the console, and the dates of an
/// entity, which the broker does not report.
/// </summary>
public class RabbitMQLoggingAndDatesTests
{
    private const string PasswordSentinel = "Password.Sentinel.7f3a";

    private sealed class RecordingLogger : ILogger<RabbitMQProvider>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add((logLevel, formatter(state, exception)));
    }

    private sealed class FixedHandler(string body) : HttpMessageHandler
    {
        private static bool IsList(string path) => path.EndsWith('/') || path.EndsWith("/bindings/source", StringComparison.Ordinal);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(IsList(Uri.UnescapeDataString(request.RequestUri!.AbsolutePath)) ? "[]" : body, Encoding.UTF8, "application/json")
            });
    }

    private static async Task<(bool Result, RecordingLogger Logger, string Console)> TestConnection(RabbitMQConnectionConfig config)
    {
        var logger = new RecordingLogger();
        var original = Console.Out;
        using var console = new StringWriter();
        Console.SetOut(console);
        try
        {
            var result = await new RabbitMQProvider(logger).TestConnectionAsync(config);
            return (result, logger, console.ToString());
        }
        finally
        {
            Console.SetOut(original);
        }
    }

    [Fact]
    public async Task A_connection_test_the_broker_does_not_answer_is_a_warning_in_the_application_log_with_no_password_and_nothing_on_the_console()
    {
        var config = new RabbitMQConnectionConfig { Name = "local", HostName = "127.0.0.1", ManagementPort = 1, UserName = "user", Password = PasswordSentinel };

        var (result, logger, console) = await TestConnection(config);

        Assert.False(result);
        Assert.Contains(logger.Entries, e => e.Level == LogLevel.Warning && e.Message.StartsWith("The RabbitMQ management API at 127.0.0.1:1 did not answer the connection test"));
        Assert.DoesNotContain(logger.Entries, e => e.Message.Contains(PasswordSentinel));
        Assert.Equal(string.Empty, console);
    }

    [Fact]
    public async Task A_connection_that_is_not_valid_is_a_warning_in_the_application_log_and_nothing_on_the_console()
    {
        var (result, logger, console) = await TestConnection(new RabbitMQConnectionConfig { Name = "local", HostName = "", Password = PasswordSentinel });

        Assert.False(result);
        Assert.Equal([(LogLevel.Warning, "The RabbitMQ connection 'local' is not valid, so it was not tested.")], logger.Entries);
        Assert.Equal(string.Empty, console);
    }

    [Fact]
    public async Task A_queue_and_an_exchange_carry_no_date_because_the_broker_reports_none()
    {
        var connection = new Mock<IConnection>();
        connection.Setup(c => c.IsOpen).Returns(true);
        using var client = new RabbitMQManagementClient(new HttpClient(new FixedHandler("""{"name":"orders","messages_ready":3}""")), "http://127.0.0.1:15672/api", "/", "user", "password");
        var provider = new RabbitMQProvider(connection.Object, client);

        var queue = await provider.GetQueueAsync("orders");
        var exchange = await provider.GetTopicAsync("orders");

        Assert.Equal((default(DateTimeOffset), default(DateTimeOffset), default(DateTimeOffset)), (queue!.CreatedAt, queue.UpdatedAt, queue.AccessedAt));
        Assert.Equal((default(DateTimeOffset), default(DateTimeOffset), default(DateTimeOffset)), (exchange!.CreatedAt, exchange.UpdatedAt, exchange.AccessedAt));
    }
}
