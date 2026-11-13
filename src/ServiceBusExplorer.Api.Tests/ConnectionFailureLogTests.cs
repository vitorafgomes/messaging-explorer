using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// A secret never reaches a log on a failed connection test or connect: every log entry the API writes on those
/// paths, and everything written to the console, is searched for a sentinel secret. Every endpoint is a closed
/// port on loopback; nothing leaves the machine.
/// </summary>
public class ConnectionFailureLogTests
{
    private const string SharedAccessKey = "SENTINEL-KEY-0f3c";
    private const string ClientSecret = "SENTINEL-SECRET-7a91";
    private const string RabbitUser = "sentinel-user";
    private const string RabbitPassword = "SENTINEL-PASS-52d8";

    private static readonly string[] Needles =
    [
        SharedAccessKey,
        ClientSecret,
        RabbitPassword,
        Convert.ToBase64String(Encoding.ASCII.GetBytes($"{RabbitUser}:{RabbitPassword}")),
    ];

    private sealed record Entry(string Category, LogLevel Level, string? ExceptionType, string Text);

    private sealed class CaptureProvider : ILoggerProvider
    {
        public ConcurrentQueue<Entry> Entries { get; } = new();

        public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, Entries);

        public void Dispose()
        {
        }

        private sealed class CaptureLogger(string category, ConcurrentQueue<Entry> entries) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var text = new StringBuilder(formatter(state, exception));
                if (state is IEnumerable<KeyValuePair<string, object?>> pairs)
                {
                    foreach (var pair in pairs)
                    {
                        text.Append('\n').Append(pair.Key).Append('=').Append(pair.Value);
                    }
                }
                for (var e = exception; e != null; e = e.InnerException)
                {
                    text.Append('\n').Append(e.ToString());
                    foreach (System.Collections.DictionaryEntry item in e.Data)
                    {
                        text.Append('\n').Append(item.Key).Append('=').Append(item.Value);
                    }
                }
                entries.Enqueue(new Entry(category, logLevel, exception?.GetType().FullName, text.ToString()));
            }
        }
    }

    private static int ClosedLoopbackPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static async Task<(List<Entry> Entries, string Console)> CaptureAsync(Func<ApiFactory, HttpClient, Task> act)
    {
        var capture = new CaptureProvider();
        var console = new StringWriter();
        var originalOut = Console.Out;
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureLogging(l =>
        {
            l.AddProvider(capture);
            l.AddFilter<CaptureProvider>(null, LogLevel.Trace);
        }));
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        Console.SetOut(TextWriter.Synchronized(console));
        try
        {
            await act(baseFactory, client);
        }
        finally
        {
            Console.SetOut(originalOut);
        }

        return (capture.Entries.ToList(), console.ToString());
    }

    private static void AssertNoSecret(List<Entry> entries, string console)
    {
        foreach (var needle in Needles)
        {
            var leaked = entries.FirstOrDefault(e => e.Text.Contains(needle, StringComparison.Ordinal));
            Assert.True(leaked == null, $"A secret reached the log at {leaked?.Category} ({leaked?.Level}): {leaked?.Text}");
            Assert.DoesNotContain(needle, console, StringComparison.Ordinal);
        }
    }

    private static Entry AssertLoggedFailure(List<Entry> entries, string category, LogLevel level)
    {
        var entry = entries.FirstOrDefault(e => e.Category == category && e.Level == level && e.ExceptionType != null);
        Assert.True(entry != null,
            $"No {level} with an exception from {category}; captured: {string.Join(" | ", entries.Select(e => $"{e.Category}/{e.Level}/{e.ExceptionType}"))}");
        return entry!;
    }

    private static async Task PostTestAsync(HttpClient client, ServiceBusConnection connection)
    {
        using var response = await client.PostAsJsonAsync("/api/connections/test", connection);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.False(body.GetProperty("success").GetBoolean());
    }

    private static async Task ConnectAsync(ApiFactory factory, HttpClient client, ServiceBusConnection connection)
    {
        await factory.SeedConnectionAsync(connection);
        using var response = await client.PostAsync($"/api/connections/{connection.Id}/connect", null);
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    }

    [Theory]
    [InlineData("Endpoint=not a uri;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=" + SharedAccessKey, typeof(UriFormatException))]
    [InlineData("Endpoint=sb://127.0.0.1/;SharedAccessKey=" + SharedAccessKey, typeof(ArgumentException))]
    [InlineData("Endpoint=sb://127.0.0.1/;SharedAccessKeyName=Root;SharedAccessKey=" + SharedAccessKey + ";EntityPath", typeof(FormatException))]
    public async Task A_failed_test_of_a_malformed_Azure_connection_string_never_logs_the_key(string connectionString, Type expectedException)
    {
        var (entries, console) = await CaptureAsync((_, client) => PostTestAsync(client, new ServiceBusConnection
        {
            Name = "malformed",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = connectionString,
        }));

        var failure = AssertLoggedFailure(entries, typeof(AzureServiceBusProvider).FullName!, LogLevel.Warning);
        Assert.Equal(expectedException.FullName, failure.ExceptionType);
        AssertNoSecret(entries, console);
    }

    [Fact]
    public async Task A_failed_test_of_an_unreachable_Azure_namespace_never_logs_the_key()
    {
        var connectionString =
            $"Endpoint=sb://127.0.0.1:{ClosedLoopbackPort()}/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey={SharedAccessKey};UseDevelopmentEmulator=true";

        var (entries, console) = await CaptureAsync((_, client) => PostTestAsync(client, new ServiceBusConnection
        {
            Name = "unreachable",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = connectionString,
        }));

        var failure = AssertLoggedFailure(entries, typeof(AzureServiceBusProvider).FullName!, LogLevel.Warning);
        Assert.Equal(typeof(AggregateException).FullName, failure.ExceptionType);
        Assert.Contains("Connection refused (127.0.0.1:", failure.Text, StringComparison.Ordinal);
        AssertNoSecret(entries, console);
    }

    [Fact]
    public async Task A_failed_connect_with_a_malformed_Azure_connection_string_never_logs_the_key()
    {
        var (entries, console) = await CaptureAsync((factory, client) => ConnectAsync(factory, client, new ServiceBusConnection
        {
            Id = Guid.NewGuid().ToString(),
            Name = "malformed-connect",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = "Endpoint=sb://127.0.0.1/;SharedAccessKey=" + SharedAccessKey,
        }));

        AssertLoggedFailure(entries, typeof(ProviderFactory).FullName!, LogLevel.Error);
        AssertLoggedFailure(entries, "ServiceBusExplorer.Api.Controllers.ConnectionsController", LogLevel.Error);
        AssertNoSecret(entries, console);
    }

    /// <summary>
    /// The credential is refused while it is built, before any token request, so the test stays on this machine;
    /// a token request would reach the public Microsoft Entra authority, which this suite never contacts.
    /// </summary>
    [Fact]
    public async Task A_failed_test_of_a_service_principal_never_logs_the_client_secret()
    {
        var (entries, console) = await CaptureAsync((_, client) => PostTestAsync(client, new ServiceBusConnection
        {
            Name = "service-principal",
            ProviderType = ProviderType.AzureServiceBus,
            AuthType = AzureAuthType.ServicePrincipal,
            FullyQualifiedNamespace = "localhost",
            TenantId = "not a tenant id",
            ServicePrincipalClientId = "22222222-2222-2222-2222-222222222222",
            ClientSecret = ClientSecret,
        }));

        var failure = AssertLoggedFailure(entries, typeof(AzureServiceBusProvider).FullName!, LogLevel.Warning);
        Assert.Equal(typeof(ArgumentException).FullName, failure.ExceptionType);
        Assert.Contains("ClientSecretCredential", failure.Text, StringComparison.Ordinal);
        AssertNoSecret(entries, console);
    }

    [Fact]
    public async Task A_failed_test_of_an_unreachable_RabbitMQ_management_port_never_writes_the_password()
    {
        var (entries, console) = await CaptureAsync((_, client) => PostTestAsync(client, new ServiceBusConnection
        {
            Name = "rabbit-test",
            ProviderType = ProviderType.RabbitMQ,
            HostName = "127.0.0.1",
            Port = ClosedLoopbackPort(),
            ManagementPort = ClosedLoopbackPort(),
            UserName = RabbitUser,
            Password = RabbitPassword,
        }));

        Assert.Contains("[RabbitMQ] Management API error", console, StringComparison.Ordinal);
        AssertNoSecret(entries, console);
    }

    [Fact]
    public async Task A_failed_connect_to_an_unreachable_RabbitMQ_broker_never_logs_the_password()
    {
        var (entries, console) = await CaptureAsync((factory, client) => ConnectAsync(factory, client, new ServiceBusConnection
        {
            Id = Guid.NewGuid().ToString(),
            Name = "rabbit-connect",
            ProviderType = ProviderType.RabbitMQ,
            HostName = "127.0.0.1",
            Port = ClosedLoopbackPort(),
            ManagementPort = ClosedLoopbackPort(),
            UserName = RabbitUser,
            Password = RabbitPassword,
        }));

        AssertLoggedFailure(entries, typeof(ProviderFactory).FullName!, LogLevel.Error);
        AssertLoggedFailure(entries, "ServiceBusExplorer.Api.Controllers.ConnectionsController", LogLevel.Error);
        AssertNoSecret(entries, console);
    }
}
