using System.Net.Http.Json;
using System.Text.Json;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Api.Tests;

public class ConnectionMaskingTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public ConnectionMaskingTests(ApiFactory factory) => _factory = factory;

    private HttpClient CreateAuthedClient()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        return client;
    }

    [Fact]
    public async Task GetConnection_by_id_returns_masked_connection_string()
    {
        var id = Guid.NewGuid().ToString();
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = id,
            Name = "test-conn",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = "Endpoint=sb://super-secret"
        });

        var client = CreateAuthedClient();
        var dto = await client.GetFromJsonAsync<JsonElement>($"/api/connections/{id}");

        Assert.Equal("***", dto.GetProperty("connectionString").GetString());
    }

    [Fact]
    public async Task Export_default_returns_masked_connections()
    {
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = Guid.NewGuid().ToString(),
            Name = "export-masked",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = "Endpoint=sb://masked-should-not-leak"
        });

        var client = CreateAuthedClient();
        var response = await client.PostAsync("/api/connections/export", content: null);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadAsStringAsync();

        Assert.Contains("***", payload);
        Assert.DoesNotContain("masked-should-not-leak", payload);
    }

    [Fact]
    public async Task Export_with_includeSecrets_true_returns_raw()
    {
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = Guid.NewGuid().ToString(),
            Name = "export-raw",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = "Endpoint=sb://raw-sentinel-123"
        });

        var client = CreateAuthedClient();
        var response = await client.PostAsync("/api/connections/export?includeSecrets=true", content: null);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadAsStringAsync();

        Assert.Contains("raw-sentinel-123", payload);
        Assert.NotNull(response.Content.Headers.ContentDisposition);
    }

    [Fact]
    public async Task GetConnection_by_id_returns_masked_client_secret()
    {
        var id = Guid.NewGuid().ToString();
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = id,
            Name = "sp-conn",
            ProviderType = ProviderType.AzureServiceBus,
            AuthType = AzureAuthType.ServicePrincipal,
            FullyQualifiedNamespace = "ns.servicebus.windows.net",
            TenantId = "tenant",
            ServicePrincipalClientId = "client",
            ClientSecret = "super-secret-sp"
        });

        var client = CreateAuthedClient();
        var dto = await client.GetFromJsonAsync<JsonElement>($"/api/connections/{id}");

        Assert.Equal("***", dto.GetProperty("clientSecret").GetString());
    }

    [Fact]
    public async Task Export_default_returns_masked_client_secret()
    {
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = Guid.NewGuid().ToString(),
            Name = "sp-export-masked",
            ProviderType = ProviderType.AzureServiceBus,
            AuthType = AzureAuthType.ServicePrincipal,
            FullyQualifiedNamespace = "ns.servicebus.windows.net",
            TenantId = "tenant",
            ServicePrincipalClientId = "client",
            ClientSecret = "sp-secret-should-not-leak"
        });

        var client = CreateAuthedClient();
        var response = await client.PostAsync("/api/connections/export", content: null);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadAsStringAsync();

        Assert.Contains("***", payload);
        Assert.DoesNotContain("sp-secret-should-not-leak", payload);
    }

    [Fact]
    public async Task Export_with_includeSecrets_true_returns_raw_client_secret()
    {
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = Guid.NewGuid().ToString(),
            Name = "sp-export-raw",
            ProviderType = ProviderType.AzureServiceBus,
            AuthType = AzureAuthType.ServicePrincipal,
            FullyQualifiedNamespace = "ns.servicebus.windows.net",
            TenantId = "tenant",
            ServicePrincipalClientId = "client",
            ClientSecret = "sp-raw-sentinel-xyz"
        });

        var client = CreateAuthedClient();
        var response = await client.PostAsync("/api/connections/export?includeSecrets=true", content: null);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadAsStringAsync();

        Assert.Contains("sp-raw-sentinel-xyz", payload);
    }
}
