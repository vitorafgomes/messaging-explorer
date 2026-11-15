using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// POST api/connections/import/preview answers what an import-full would add and update, writes nothing and carries no secret.
/// </summary>
public class ImportPreviewTests
{
    private const string ConstantBody = "{\"message\":\"An internal error occurred.\"}";
    private const string FileSecret = "Endpoint=sb://file-secret-sentinel/;SharedAccessKey=a+b/c=";

    private static HttpClient KeyedClient(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        return client;
    }

    private static async Task SeedAsync(ApiFactory factory)
    {
        await factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = "stored-1", Name = "Contoso development", ProviderType = ProviderType.AzureServiceBus,
            Namespace = "contoso-dev.servicebus.windows.net", ConnectionString = "Endpoint=sb://stored-secret-sentinel/"
        });
        await factory.SeedConnectionAsync(new ServiceBusConnection
        {
            Id = "stored-2", Name = "Contoso RabbitMQ", ProviderType = ProviderType.RabbitMQ, HostName = "rabbit", Port = 5672
        });
        await factory.Services.GetRequiredService<IConnectionGroupManager>()
            .SaveGroupAsync(new ConnectionGroup { Id = "client-1", Name = "Contoso", Type = "client" });
    }

    private static string FileJson() => JsonSerializer.Serialize(new
    {
        Groups = new object[]
        {
            new { Id = "client-1", Name = "Contoso", Type = "client" },
            new { Id = "env-new", Name = "Development", Type = "environment", ParentId = "client-1", IsProduction = false }
        },
        Connections = new object[]
        {
            new { Id = "stored-1", Name = "Contoso development", ProviderType = 0, Namespace = "contoso-dev.servicebus.windows.net", ConnectionString = "***" },
            new { Id = "new-1", Name = "Contoso development, CLI", ProviderType = 0, FullyQualifiedNamespace = "contoso-dev.servicebus.windows.net",
                  ConnectionString = FileSecret, ClientId = "client-1", EnvironmentId = "env-new" }
        }
    });

    [Fact]
    public async Task The_preview_answers_what_the_import_adds_and_updates_and_writes_nothing()
    {
        using var factory = new ApiFactory();
        await SeedAsync(factory);
        var workspace = Path.Combine(factory.DataPath, "workspace.json");
        var before = File.ReadAllBytes(workspace);
        using var client = KeyedClient(factory);

        using var response = await client.PostAsJsonAsync("/api/connections/import/preview", new { configurationJson = FileJson() });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        Assert.Equal(2, root.GetProperty("add").GetInt32());
        Assert.Equal(2, root.GetProperty("update").GetInt32());
        Assert.True(root.GetProperty("secretsMasked").GetBoolean(), "a file with a masked secret must say so");
        Assert.Equal(new[] { "Contoso RabbitMQ" }, root.GetProperty("notInFile").EnumerateArray().Select(e => e.GetString()));

        var items = root.GetProperty("items").EnumerateArray().ToDictionary(e => e.GetProperty("name").GetString()!);
        Assert.Equal(4, items.Count);
        Assert.Equal("Client", items["Contoso"].GetProperty("kind").GetString());
        Assert.True(items["Contoso"].GetProperty("exists").GetBoolean());
        Assert.Equal("Environment of Contoso", items["Development"].GetProperty("kind").GetString());
        Assert.False(items["Development"].GetProperty("exists").GetBoolean());
        var updated = items["Contoso development"];
        Assert.True(updated.GetProperty("exists").GetBoolean());
        Assert.True(updated.GetProperty("keepsStoredSecret").GetBoolean(), "a stored connection arriving masked keeps its stored secret");
        Assert.Equal("contoso-dev.servicebus.windows.net", updated.GetProperty("target").GetString());
        var added = items["Contoso development, CLI"];
        Assert.False(added.GetProperty("exists").GetBoolean());
        Assert.Equal("Azure Service Bus", added.GetProperty("kind").GetString());
        Assert.Equal("Contoso, Development", added.GetProperty("placement").GetString());

        Assert.Equal(before, File.ReadAllBytes(workspace));
        Assert.Null(await factory.Services.GetRequiredService<IConnectionManager>().GetConnectionAsync("new-1"));
    }

    [Fact]
    public async Task The_preview_never_carries_a_secret_of_the_file_or_of_the_workspace()
    {
        using var factory = new ApiFactory();
        await SeedAsync(factory);
        using var client = KeyedClient(factory);

        using var response = await client.PostAsJsonAsync("/api/connections/import/preview", new { configurationJson = FileJson() });

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("file-secret-sentinel", body);
        Assert.DoesNotContain("stored-secret-sentinel", body);
        Assert.DoesNotContain("connectionString", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task The_preview_without_the_key_is_401()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync("/api/connections/import/preview", new { configurationJson = FileJson() });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_file_that_is_not_JSON_is_refused_with_400_and_a_constant_message()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);

        using var response = await client.PostAsJsonAsync("/api/connections/import/preview", new { configurationJson = "{ \"Connections\": [ " + FileSecret });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("file-secret-sentinel", body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Invalid JSON format.", doc.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public async Task An_empty_file_is_refused_with_400()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);

        using var response = await client.PostAsJsonAsync("/api/connections/import/preview", new { configurationJson = " " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("Configuration data is required", doc.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public async Task A_preview_over_an_unreadable_workspace_answers_the_constant_500()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);
        File.WriteAllText(Path.Combine(factory.DataPath, "workspace.json"), "{ \"Connections\": [ stored-secret-sentinel");

        using var response = await client.PostAsJsonAsync("/api/connections/import/preview", new { configurationJson = FileJson() });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(ConstantBody, body);
    }

    /// <summary>The file dev/brokers/messaging-explorer-import.json, found from the test's output folder up to the repository root.</summary>
    private static string LocalBrokersImportFile()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "dev", "brokers", "messaging-explorer-import.json");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("dev/brokers/messaging-explorer-import.json was not found above the test folder.");
    }

    [Fact]
    public async Task The_local_brokers_file_imports_its_three_connections_under_one_client_with_a_development_and_a_production_environment()
    {
        using var factory = new ApiFactory();
        var client = KeyedClient(factory);
        var file = await File.ReadAllTextAsync(LocalBrokersImportFile());

        using (var preview = await client.PostAsJsonAsync("/api/connections/import/preview", new { configurationJson = file }))
        {
            Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        }
        using (var import = await client.PostAsJsonAsync("/api/connections/import-full", new { configurationJson = file }))
        {
            Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        }

        var connections = JsonDocument.Parse(await client.GetStringAsync("/api/connections")).RootElement.EnumerateArray()
            .Select(c => (Name: c.GetProperty("name").GetString(), Provider: c.GetProperty("providerType").GetString(),
                Environment: c.GetProperty("environmentId").GetString()))
            .OrderBy(c => c.Name).ToList();
        Assert.Equal(new[] { "Local RabbitMQ", "Local Service Bus", "Local Service Bus (marked Production)" }, connections.Select(c => c.Name));
        Assert.Equal(new[] { "RabbitMQ", "AzureServiceBus", "AzureServiceBus" }, connections.Select(c => c.Provider));

        var groups = JsonDocument.Parse(await client.GetStringAsync("/api/connectiongroups")).RootElement.EnumerateArray().ToList();
        var production = groups.Single(g => g.GetProperty("name").GetString() == "Production (test)");
        Assert.True(production.GetProperty("isProduction").GetBoolean(), "the second environment is marked Production, for the typed-name confirmations");
        Assert.Equal(production.GetProperty("id").GetString(), connections.Single(c => c.Name == "Local Service Bus (marked Production)").Environment);
        Assert.Equal(new[] { "Development", "Local brokers", "Production (test)" }, groups.Select(g => g.GetProperty("name").GetString()).OrderBy(n => n));
    }
}
