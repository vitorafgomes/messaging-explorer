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
using static ServiceBusExplorer.Api.Tests.ErrorBodyTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// A connect records when the connection was last used, an edit save keeps that time, and a failed record never fails the connect.
/// </summary>
public class ConnectionLastUsedTests
{
    private static IProviderFactory ConnectingFactory()
    {
        var provider = StubProxy.For<IMessagingProvider>(m => m.Name switch
        {
            "get_ProviderType" => ProviderType.AzureServiceBus,
            "get_CurrentTarget" => "fake-target",
            "get_IsConnected" => true,
            "DisconnectAsync" => Task.CompletedTask,
            "DisposeAsync" => ValueTask.CompletedTask,
            _ => throw new NotSupportedException(m.Name)
        });
        return StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.CreateConnectedProviderAsync)
            ? Task.FromResult(provider)
            : throw new NotSupportedException(m.Name));
    }

    private static HttpClient KeyedClient(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        return client;
    }

    [Fact]
    public async Task A_connect_records_the_last_use_and_an_edit_save_keeps_it()
    {
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(ConnectingFactory())));
        var manager = factory.Services.GetRequiredService<IConnectionManager>();
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = "c1", Name = "before", ConnectionString = "Endpoint=sb://fake/" });
        using var client = KeyedClient(factory);

        try
        {
            using var connected = await client.PostAsync("/api/connections/c1/connect", null);
            Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
            var stamped = (await manager.GetConnectionAsync("c1"))?.LastUsedAt;
            Assert.True(stamped.HasValue, "a successful connect must store LastUsedAt");

            using var saved = await client.PostAsJsonAsync("/api/connections", new
            {
                id = "c1", name = "after", providerType = "AzureServiceBus", connectionString = "***"
            });
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

            var after = await manager.GetConnectionAsync("c1");
            Assert.Equal("after", after?.Name);
            Assert.Equal(stamped, after?.LastUsedAt);
            using var doc = JsonDocument.Parse(await saved.Content.ReadAsStringAsync());
            Assert.Equal(stamped, doc.RootElement.GetProperty("lastUsedAt").GetDateTime());
        }
        finally
        {
            using var _ = await client.PostAsync("/api/connections/disconnect", null);
        }
    }

    [Fact]
    public async Task A_connect_whose_last_use_cannot_be_written_still_answers_connected()
    {
        var stored = new ServiceBusConnection { Id = "c2", Name = "conn", ConnectionString = "Endpoint=sb://fake/" };
        var manager = StubProxy.For<IConnectionManager>(m => m.Name switch
        {
            nameof(IConnectionManager.GetConnectionWithSecretAsync) => Task.FromResult<ServiceBusConnection?>(stored),
            nameof(IConnectionManager.MarkUsedAsync) => throw new UnauthorizedAccessException("workspace.json is read-only"),
            _ => throw new NotSupportedException(m.Name)
        });
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton(ConnectingFactory());
            s.AddSingleton(manager);
            s.AddSingleton(StubProxy.For<IConnectionGroupManager>(m => throw new NotSupportedException(m.Name)));
        }));
        using var client = KeyedClient(factory);

        try
        {
            using var response = await client.PostAsync("/api/connections/c2/connect", null);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.True(doc.RootElement.GetProperty("connected").GetBoolean(), "the provider is connected, so a failed timestamp write must not report a failed connect");
            Assert.Equal("fake-target", doc.RootElement.GetProperty("target").GetString());
        }
        finally
        {
            using var _ = await client.PostAsync("/api/connections/disconnect", null);
        }
    }
}
