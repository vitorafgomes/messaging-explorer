using System.Net;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.ErrorBodyTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// A failed connect answers why, as one code from a fixed set with a fixed sentence, and never the text of the
/// exception: that text can carry the connection string, the user name, the password or a key.
/// </summary>
public class ConnectFailureReasonTests
{
    private const string Sentinel = "SENTINEL+KEY/0f3c=";
    private const string SentinelUser = "sentinel-user";

    private static readonly string[] Needles = new[] { Sentinel, SentinelUser }
        .SelectMany(secret => new[] { secret, Uri.EscapeDataString(secret), JsonSerializer.Serialize(secret)[1..^1] })
        .Distinct()
        .ToArray();

    /// <summary>The broker's failure as the SDK would throw it: a message that carries the secret, the cause inside.</summary>
    private static Exception Failure(Exception cause) =>
        new IOException($"None of the endpoints were reachable for Endpoint=sb://h/;SharedAccessKey={Sentinel};User={SentinelUser}",
            new AggregateException(new InvalidOperationException($"connect failed for {SentinelUser}", cause)));

    private static async Task<(HttpStatusCode Status, string Body)> ConnectFailingWith(Exception failure)
    {
        var providerFactory = StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.CreateConnectedProviderAsync)
            ? Task.FromException<ServiceBusExplorer.Core.Abstractions.IMessagingProvider>(failure)
            : throw new NotSupportedException(m.Name));
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(providerFactory)));
        await factory.Services.GetRequiredService<IConnectionManager>().SaveConnectionAsync(new ServiceBusConnection
        {
            Id = "c1",
            Name = "failing",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = $"Endpoint=sb://h/;SharedAccessKeyName=Root;SharedAccessKey={Sentinel}",
        });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.PostAsync("/api/connections/c1/connect", null);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private static void AssertNoSecret(string body)
    {
        foreach (var needle in Needles)
        {
            Assert.False(body.Contains(needle, StringComparison.Ordinal), $"The connect error body must never carry a secret or the user name; it carried {needle}: {body}");
        }
    }

    public static TheoryData<string, string, string> Reasons => new()
    {
        { nameof(SocketError.ConnectionRefused), "connection-refused", "The broker refused the connection on its port." },
        { nameof(SocketError.HostNotFound), "host-not-found", "The host name was not found." },
        { nameof(SocketError.TimedOut), "timeout", "The broker did not answer in time." },
        { nameof(TimeoutException), "timeout", "The broker did not answer in time." },
        { nameof(AuthenticationException), "tls", "The TLS handshake with the broker failed." },
    };

    private static Exception Cause(string name) => name switch
    {
        nameof(TimeoutException) => new TimeoutException($"timed out for {SentinelUser}"),
        nameof(AuthenticationException) => new AuthenticationException($"handshake failed for {SentinelUser}"),
        _ => new SocketException((int)Enum.Parse<SocketError>(name)),
    };

    [Theory]
    [MemberData(nameof(Reasons))]
    public async Task A_failed_connect_answers_its_reason_as_a_fixed_code_and_sentence_and_never_the_exception_text(string cause, string code, string message)
    {
        var (status, body) = await ConnectFailingWith(Failure(Cause(cause)));

        Assert.Equal(HttpStatusCode.InternalServerError, status);
        AssertNoSecret(body);
        using var doc = JsonDocument.Parse(body);
        Assert.True(doc.RootElement.TryGetProperty("code", out var answered), $"A connect that failed with {cause} must answer a reason code; it answered {body}");
        Assert.Equal(code, answered.GetString());
        Assert.Equal(message, doc.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public async Task A_failed_connect_whose_reason_is_not_known_answers_the_general_body_without_a_code_or_a_secret()
    {
        var (status, body) = await ConnectFailingWith(Failure(new InvalidOperationException($"ACCESS_REFUSED for {SentinelUser}")));

        Assert.Equal(HttpStatusCode.InternalServerError, status);
        Assert.Equal("{\"message\":\"An internal error occurred.\"}", body);
        AssertNoSecret(body);
    }

    [Fact]
    public async Task A_real_connect_to_a_closed_RabbitMQ_port_answers_connection_refused_without_the_password()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        using var factory = new ApiFactory();
        await factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = "rabbit",
            Name = "rabbit",
            ProviderType = ProviderType.RabbitMQ,
            HostName = "127.0.0.1",
            Port = port,
            ManagementPort = port,
            UserName = SentinelUser,
            Password = Sentinel,
        });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.PostAsync("/api/connections/rabbit/connect", null);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        using var doc = JsonDocument.Parse(body);
        Assert.True(doc.RootElement.TryGetProperty("code", out var code), $"A refused AMQP port must answer a reason code; it answered {body}");
        Assert.Equal("connection-refused", code.GetString());
        AssertNoSecret(body);
    }
}
