using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// An error answer never carries exception text, and every 500 body has the same shape.
/// </summary>
public class ErrorBodyTests
{
    private const string ConstantBody = "{\"message\":\"An internal error occurred.\"}";
    private const string Sentinel = "LEAKED-EXCEPTION-SENTINEL";

    /// <summary>
    /// Answers every interface call through a delegate, so a test can fake a wide interface in a few lines.
    /// </summary>
    public class StubProxy : DispatchProxy
    {
        private Func<MethodInfo, object?>? _handler;

        public static T For<T>(Func<MethodInfo, object?> handler) where T : class
        {
            var proxy = Create<T, StubProxy>();
            ((StubProxy)(object)proxy)._handler = handler;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => _handler!(targetMethod!);
    }

    private static HttpClient KeyedClient(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        return client;
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Production")]
    public async Task An_unhandled_exception_answers_a_constant_500_body_and_never_the_exception_text(string environment)
    {
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.UseEnvironment(environment));
        using var client = KeyedClient(factory);
        File.WriteAllText(Path.Combine(baseFactory.DataPath, "workspace.json"), "{ \"Connections\": [ " + Sentinel);

        using var response = await client.GetAsync("/api/connections/any-id");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(ConstantBody, body);
        Assert.DoesNotContain(Sentinel, body);
        Assert.DoesNotContain("could not be read", body);
    }

    [Fact]
    public async Task Import_never_returns_the_message_of_an_argument_exception()
    {
        using var baseFactory = new ApiFactory();
        var manager = StubProxy.For<IConnectionManager>(_ => throw new ArgumentException(Sentinel));
        var groups = StubProxy.For<IConnectionGroupManager>(_ => throw new InvalidOperationException());
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton(manager);
            s.AddSingleton(groups);
        }));
        using var client = KeyedClient(factory);

        using var response = await client.PostAsJsonAsync("/api/connections/import", new { configurationJson = "[{}]" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(Sentinel, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Invalid or empty configuration data", doc.RootElement.GetProperty("message").GetString());
    }

    [Theory]
    [InlineData("POST", "/api/queues/q/deadletter/1/resubmit")]
    [InlineData("POST", "/api/topics/t/subscriptions/s/deadletter/1/resubmit")]
    [InlineData("PUT", "/api/queues/q/sessions/session-1/state")]
    public async Task A_caught_provider_failure_answers_500_with_the_message_key(string method, string path)
    {
        var provider = StubProxy.For<IMessagingProvider>(m => m.Name switch
        {
            "get_ProviderType" => ProviderType.AzureServiceBus,
            "get_Capabilities" => ServiceBusExplorer.Core.Providers.Azure.AzureProviderCapabilities.Instance,
            "get_CurrentTarget" => "fake-target",
            "get_IsConnected" => false,
            "DisconnectAsync" => Task.CompletedTask,
            "DisposeAsync" => ValueTask.CompletedTask,
            _ => throw new InvalidOperationException(Sentinel)
        });
        var providerFactory = StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.CreateConnectedProviderAsync)
            ? Task.FromResult(provider)
            : throw new NotSupportedException());
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(providerFactory)));
        await factory.Services.GetRequiredService<IConnectionManager>()
            .SaveConnectionAsync(new ServiceBusConnection { Id = "c1", Name = "fake", ConnectionString = "Endpoint=sb://fake/" });
        using var client = KeyedClient(factory);

        try
        {
            using var connected = await client.PostAsync("/api/connections/c1/connect", null);
            Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
            using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { state = "s", expectedState = (string?)null }) };
            using var response = await client.SendAsync(request);

            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            var body = await response.Content.ReadAsStringAsync();
            Assert.Equal(ConstantBody, body);
            Assert.DoesNotContain(Sentinel, body);
        }
        finally
        {
            using var _ = await client.PostAsync("/api/connections/disconnect", null);
        }
    }
}
