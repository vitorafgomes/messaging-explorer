using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// POST api/connections/test of a stored connection whose secret arrives as the mask tests with the stored secret, as a
/// save does, and the answer carries no secret.
/// </summary>
public class ConnectionTestStoredSecretTests
{
    /// <summary>A provider factory that records the connection each test receives and answers success.</summary>
    private sealed class RecordingProviderFactory : IProviderFactory
    {
        public List<ServiceBusConnection> Tested { get; } = [];

        public Task<bool> TestConnectionAsync(ServiceBusConnection connection)
        {
            Tested.Add(connection);
            return Task.FromResult(true);
        }

        public IMessagingProvider CreateProvider(ProviderType providerType) => throw new NotSupportedException();
        public IMessagingProvider CreateProvider(IConnectionConfig config) => throw new NotSupportedException();
        public IMessagingProvider CreateProvider(ServiceBusConnection connection) => throw new NotSupportedException();
        public IConnectionConfig CreateConnectionConfig(ProviderType providerType) => throw new NotSupportedException();
        public IConnectionConfig CreateConnectionConfig(ServiceBusConnection connection) => throw new NotSupportedException();
        public Task<IMessagingProvider> CreateConnectedProviderAsync(ServiceBusConnection connection) => throw new NotSupportedException();
        public IProviderCapabilities GetProviderCapabilities(ProviderType providerType) => throw new NotSupportedException();
        public IEnumerable<ProviderType> GetSupportedProviderTypes() => throw new NotSupportedException();
        public IEnumerable<ProviderInfo> GetSupportedProviders() => throw new NotSupportedException();
    }

    private static (IProviderFactory Factory, List<ServiceBusConnection> Tested) RecordingFactory()
    {
        var factory = new RecordingProviderFactory();
        return (factory, factory.Tested);
    }

    private static HttpClient KeyedClient(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        return client;
    }

    [Theory]
    [InlineData("rabbit")]
    [InlineData("azure")]
    public async Task A_test_of_a_stored_connection_with_the_masked_secret_tests_with_the_stored_one_and_answers_no_secret(string kind)
    {
        var (recording, tested) = RecordingFactory();
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(recording)));
        var stored = kind == "rabbit"
            ? new ServiceBusConnection { Id = "s1", Name = "rabbit", ProviderType = ProviderType.RabbitMQ, HostName = "localhost", Port = 5672, UserName = "explorer", Password = "stored-password-sentinel" }
            : new ServiceBusConnection { Id = "s1", Name = "azure", ProviderType = ProviderType.AzureServiceBus, ConnectionString = "Endpoint=sb://localhost:5673;SharedAccessKey=stored-key-sentinel" };
        await factory.Services.GetRequiredService<IConnectionManager>().SaveConnectionAsync(stored);
        using var client = KeyedClient(factory);

        using var response = await client.PostAsJsonAsync("/api/connections/test", kind == "rabbit"
            ? (object)new { id = "s1", name = "rabbit", providerType = "RabbitMQ", hostName = "localhost", port = 5672, userName = "explorer", password = "***", connectionString = "" }
            : new { id = "s1", name = "azure", providerType = "AzureServiceBus", connectionString = "***" });
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(JsonDocument.Parse(body).RootElement.GetProperty("success").GetBoolean());
        var seen = Assert.Single(tested);
        Assert.Equal(kind == "rabbit" ? "stored-password-sentinel" : null, kind == "rabbit" ? seen.Password : null);
        Assert.Equal(kind == "azure" ? "Endpoint=sb://localhost:5673;SharedAccessKey=stored-key-sentinel" : null, kind == "azure" ? seen.ConnectionString : null);
        Assert.DoesNotContain("sentinel", body);
    }

    [Fact]
    public async Task A_test_with_the_masked_secret_and_no_stored_connection_tests_the_mask_as_typed_and_reads_no_other_secret()
    {
        var (recording, tested) = RecordingFactory();
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(recording)));
        using var client = KeyedClient(factory);

        using var response = await client.PostAsJsonAsync("/api/connections/test",
            new { id = "missing", name = "rabbit", providerType = "RabbitMQ", hostName = "localhost", password = "***", connectionString = "" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("***", Assert.Single(tested).Password);
    }
}
