using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Services;
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
    public async Task The_connection_list_names_the_namespace_host_of_a_connection_string_and_never_its_key()
    {
        var id = Guid.NewGuid().ToString();
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = id,
            Name = "list-target",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = "Endpoint=sb://list-target-ns.servicebus.windows.net/;SharedAccessKeyName=list-key-name-sentinel;SharedAccessKey=list-key-sentinel"
        });

        var client = CreateAuthedClient();
        var payload = await client.GetStringAsync("/api/connections");
        var listed = JsonDocument.Parse(payload).RootElement.EnumerateArray().Single(c => c.GetProperty("id").GetString() == id);

        Assert.Equal("list-target-ns.servicebus.windows.net", listed.GetProperty("namespace").GetString());
        Assert.Equal("***", listed.GetProperty("connectionString").GetString());
        Assert.DoesNotContain("list-key-sentinel", payload);
        Assert.DoesNotContain("list-key-name-sentinel", payload);
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

    [Fact]
    public async Task GetConnection_by_id_returns_masked_password()
    {
        var id = Guid.NewGuid().ToString();
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = id,
            Name = "rabbit-conn",
            ProviderType = ProviderType.RabbitMQ,
            HostName = "rabbit.local",
            UserName = "guest",
            Password = "rabbit-password-sentinel"
        });

        var client = CreateAuthedClient();
        var dto = await client.GetFromJsonAsync<JsonElement>($"/api/connections/{id}");

        Assert.Equal("***", dto.GetProperty("password").GetString());
    }

    [Fact]
    public async Task Export_default_returns_masked_password()
    {
        var id = Guid.NewGuid().ToString();
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = id,
            Name = "rabbit-export-masked",
            ProviderType = ProviderType.RabbitMQ,
            HostName = "rabbit.local",
            UserName = "guest",
            Password = "rabbit-export-password-should-not-leak"
        });

        var client = CreateAuthedClient();
        var response = await client.PostAsync("/api/connections/export", content: null);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadAsStringAsync();

        using var doc = JsonDocument.Parse(payload);
        var entry = doc.RootElement.EnumerateArray()
            .Single(e => e.GetProperty("Id").GetString() == id);
        Assert.Equal("***", entry.GetProperty("Password").GetString());
        Assert.DoesNotContain("rabbit-export-password-should-not-leak", payload);
    }

    [Fact]
    public async Task Save_connection_response_never_returns_a_raw_secret()
    {
        var id = Guid.NewGuid().ToString();
        await _factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = id,
            Name = "post-before",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = "Endpoint=sb://post-cs-sentinel",
            Password = "post-password-sentinel",
            ClientSecret = "post-client-secret-sentinel"
        });

        var client = CreateAuthedClient();
        var response = await client.PostAsJsonAsync("/api/connections", new
        {
            id,
            name = "post-after",
            providerType = "AzureServiceBus",
            connectionString = "***",
            password = "***",
            clientSecret = "***"
        });
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(payload);
        var dto = doc.RootElement;

        Assert.Equal("post-after", dto.GetProperty("name").GetString());
        Assert.Equal("***", dto.GetProperty("connectionString").GetString());
        Assert.Equal("***", dto.GetProperty("password").GetString());
        Assert.Equal("***", dto.GetProperty("clientSecret").GetString());
        Assert.DoesNotContain("sentinel", payload);
    }

    /// <summary>
    /// The edit dialog without Replace sends the mask for the stored secret; with Replace it sends the new value.
    /// The connection test is a stub that accepts, so a replaced secret reaches the save.
    /// </summary>
    [Theory]
    [InlineData("connectionString", false)]
    [InlineData("password", false)]
    [InlineData("clientSecret", false)]
    [InlineData("connectionString", true)]
    [InlineData("password", true)]
    [InlineData("clientSecret", true)]
    public async Task An_edit_save_keeps_a_stored_secret_it_did_not_replace_and_stores_one_it_replaced(string field, bool replace)
    {
        var tests = 0;
        var providerFactory = ErrorBodyTests.StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.TestConnectionAsync)
            ? Task.FromResult(++tests > 0)
            : throw new NotSupportedException(m.Name));
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(providerFactory)));
        var manager = factory.Services.GetRequiredService<IConnectionManager>();
        var storedSecrets = new Dictionary<string, string>
        {
            ["connectionString"] = "stored-connection-string",
            ["password"] = "stored-password",
            ["clientSecret"] = "stored-client-secret"
        };
        await manager.SaveConnectionAsync(new ServiceBusConnection
        {
            Id = "edit-1",
            Name = "before",
            ConnectionString = storedSecrets["connectionString"],
            Password = storedSecrets["password"],
            ClientSecret = storedSecrets["clientSecret"]
        });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        var body = new Dictionary<string, object?>
        {
            ["id"] = "edit-1",
            ["name"] = "after",
            ["providerType"] = "AzureServiceBus",
            ["connectionString"] = "***",
            ["password"] = "***",
            ["clientSecret"] = "***"
        };
        body[field] = replace ? "replaced-value" : "***";

        using var response = await client.PostAsJsonAsync("/api/connections", body);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("stored-", payload);
        Assert.DoesNotContain("replaced-value", payload);
        var stored = await manager.GetConnectionWithSecretAsync("edit-1");
        Assert.Equal("after", stored?.Name);
        var actual = field switch
        {
            "connectionString" => stored?.ConnectionString,
            "password" => stored?.Password,
            _ => stored?.ClientSecret
        };
        var expected = replace ? "replaced-value" : storedSecrets[field];
        Assert.True(expected == actual,
            $"{field}: a save {(replace ? "with Replace must store the new value" : "without Replace must keep the stored value")}, stored was '{actual}'");
        Assert.True((replace ? 1 : 0) == tests,
            $"{field}: a replaced secret is tested before it is saved and an untouched one is not, tests run: {tests}");
    }

    /// <summary>
    /// An edit that changes only a TLS flag of a stored RabbitMQ connection reaches the broker differently, so it
    /// is tested before it is saved, as a change of host or port is.
    /// </summary>
    [Theory]
    [InlineData("useSsl")]
    [InlineData("useManagementSsl")]
    public async Task An_edit_that_changes_only_a_TLS_flag_is_tested_before_it_is_saved(string flag)
    {
        var tests = 0;
        var providerFactory = ErrorBodyTests.StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.TestConnectionAsync)
            ? Task.FromResult(++tests > 0)
            : throw new NotSupportedException(m.Name));
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(providerFactory)));
        var manager = factory.Services.GetRequiredService<IConnectionManager>();
        await manager.SaveConnectionAsync(new ServiceBusConnection
        {
            Id = "tls-1",
            Name = "rabbit",
            ProviderType = ProviderType.RabbitMQ,
            HostName = "localhost",
            Port = 5672,
            UserName = "user",
            Password = "stored-password"
        });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        var body = new Dictionary<string, object?>
        {
            ["id"] = "tls-1",
            ["name"] = "rabbit",
            ["providerType"] = "RabbitMQ",
            ["hostName"] = "localhost",
            ["port"] = 5672,
            ["userName"] = "user",
            ["password"] = "***",
            ["connectionString"] = "",
            [flag] = true
        };

        using var response = await client.PostAsJsonAsync("/api/connections", body);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(tests == 1, $"{flag}: a TLS change is a change of how the broker is reached and must be tested, tests run: {tests}");
        var stored = await manager.GetConnectionWithSecretAsync("tls-1");
        Assert.True(flag == "useSsl" ? stored?.UseSsl == true : stored?.UseManagementSsl == true, $"{flag} is stored");
        Assert.Equal("stored-password", stored?.Password);
    }

    /// <summary>
    /// An edit of an Azure connection that changes only the transport or the proxy changes how the broker is reached,
    /// so it is tested before it is saved, as a TLS flag of RabbitMQ is.
    /// </summary>
    [Theory]
    [InlineData("useWebSockets")]
    [InlineData("proxyAddress")]
    public async Task An_edit_that_changes_only_the_transport_or_the_proxy_is_tested_before_it_is_saved(string field)
    {
        var tests = 0;
        var providerFactory = ErrorBodyTests.StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.TestConnectionAsync)
            ? Task.FromResult(++tests > 0)
            : throw new NotSupportedException(m.Name));
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(providerFactory)));
        var manager = factory.Services.GetRequiredService<IConnectionManager>();
        await manager.SaveConnectionAsync(new ServiceBusConnection
        {
            Id = "transport-1",
            Name = "azure",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = "Endpoint=sb://contoso-test.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=stored-key",
            UseWebSockets = field == "proxyAddress",
        });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        var body = new Dictionary<string, object?>
        {
            ["id"] = "transport-1",
            ["name"] = "azure",
            ["providerType"] = "AzureServiceBus",
            ["connectionString"] = "***",
            ["useWebSockets"] = true,
            ["proxyAddress"] = field == "proxyAddress" ? "http://proxy.example:8080" : null,
        };

        using var response = await client.PostAsJsonAsync("/api/connections", body);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(tests == 1, $"{field}: a transport or proxy change is a change of how the broker is reached and must be tested, tests run: {tests}");
        var stored = await manager.GetConnectionWithSecretAsync("transport-1");
        Assert.True(stored?.UseWebSockets == true, "useWebSockets is stored");
        Assert.Equal(field == "proxyAddress" ? "http://proxy.example:8080" : null, stored?.ProxyAddress);
        Assert.Contains("stored-key", stored?.ConnectionString, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_edit_that_changes_only_the_name_of_a_proxied_connection_is_not_tested()
    {
        var tests = 0;
        var providerFactory = ErrorBodyTests.StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.TestConnectionAsync)
            ? Task.FromResult(++tests > 0)
            : throw new NotSupportedException(m.Name));
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(providerFactory)));
        var manager = factory.Services.GetRequiredService<IConnectionManager>();
        await manager.SaveConnectionAsync(new ServiceBusConnection
        {
            Id = "transport-2",
            Name = "azure",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = "Endpoint=sb://contoso-test.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=stored-key",
            UseWebSockets = true,
            ProxyAddress = "http://proxy.example:8080",
        });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.PostAsJsonAsync("/api/connections", new Dictionary<string, object?>
        {
            ["id"] = "transport-2",
            ["name"] = "renamed",
            ["providerType"] = "AzureServiceBus",
            ["connectionString"] = "***",
            ["useWebSockets"] = true,
            ["proxyAddress"] = "http://proxy.example:8080",
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(tests == 0, $"A rename keeps the transport and the proxy, so it is metadata only and not tested, tests run: {tests}");
        Assert.Equal("renamed", (await manager.GetConnectionAsync("transport-2"))?.Name);
    }
}

