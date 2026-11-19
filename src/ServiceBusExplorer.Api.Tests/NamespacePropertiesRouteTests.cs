using System.Net;
using System.Reflection;
using System.Text.Json;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using static ServiceBusExplorer.Api.Tests.EntityAdministrationTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// <c>GET api/namespace/properties</c> as the web app calls it: the provider's read with the request token, the key,
/// the constant 500 on a failed read and the refusal of a provider without namespace properties.
/// </summary>
public class NamespacePropertiesRouteTests
{
    private const string Path = "/api/namespace/properties";
    private const string Sentinel = "BROKER-DETAIL-SENTINEL";
    private const string ConstantBody = "{\"message\":\"An internal error occurred.\"}";

    private static readonly NamespaceInfo Premium = new()
    {
        Name = "contoso-test",
        Tier = "Premium",
        MessagingUnits = 2,
        Alias = "contoso-alias",
        CreatedTime = new DateTimeOffset(2024, 3, 1, 9, 30, 0, TimeSpan.Zero),
        ModifiedTime = new DateTimeOffset(2026, 11, 2, 17, 5, 0, TimeSpan.Zero),
        MaxMessageSizeInBytes = 100L * 1024 * 1024
    };

    private static object? Reads(MethodInfo m, object?[] _) =>
        m.Name == nameof(IMessagingProvider.GetNamespacePropertiesAsync) ? Task.FromResult(Premium) : null;

    private static JsonElement Json(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    [Fact]
    public async Task The_route_answers_the_namespace_properties_read_with_the_request_token()
    {
        var answered = await SendAsync("GET", Path, null, Reads);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(nameof(IMessagingProvider.GetNamespacePropertiesAsync), call.Method);
        Assert.True(call.Args.OfType<CancellationToken>().Single().CanBeCanceled, "The read takes the request's token, so a closed panel stops it");
        var body = Json(answered.Body);
        Assert.Equal(("contoso-test", "Premium", 2, "contoso-alias", "2024-03-01T09:30:00+00:00", "2026-11-02T17:05:00+00:00", 100L * 1024 * 1024),
            (body.GetProperty("name").GetString(), body.GetProperty("tier").GetString(), body.GetProperty("messagingUnits").GetInt32(),
             body.GetProperty("alias").GetString(), body.GetProperty("createdTime").GetString(), body.GetProperty("modifiedTime").GetString(),
             body.GetProperty("maxMessageSizeInBytes").GetInt64()));
    }

    [Fact]
    public async Task A_failed_read_answers_the_constant_500_without_the_broker_text()
    {
        var answered = await SendAsync("GET", Path, null,
            Fails(nameof(IMessagingProvider.GetNamespacePropertiesAsync), new TimeoutException(Sentinel)));

        Assert.Equal((HttpStatusCode.InternalServerError, ConstantBody), (answered.Status, answered.Body));
    }

    [Fact]
    public async Task A_read_the_broker_refuses_as_not_authorised_answers_502_with_the_fixed_sentence_and_no_broker_text()
    {
        var answered = await SendAsync("GET", Path, null,
            Fails(nameof(IMessagingProvider.GetNamespacePropertiesAsync), new UnauthorizedAccessException(Sentinel)));

        Assert.Equal(HttpStatusCode.BadGateway, answered.Status);
        Assert.StartsWith("{\"message\":\"The broker refused this operation as not authorised.", answered.Body);
        Assert.DoesNotContain(Sentinel, answered.Body);
    }

    [Fact]
    public async Task A_provider_without_namespace_properties_answers_400_with_a_fixed_text_and_is_never_called()
    {
        var answered = await SendAsync("GET", Path, null, Reads, ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("This provider has no namespace properties.", Json(answered.Body).GetProperty("message").GetString());
        Assert.Empty(answered.Calls);
    }

    [Fact]
    public async Task Without_a_connection_the_route_answers_400()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync(Path);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("No messaging provider connected. Please connect to a provider first.", Json(await response.Content.ReadAsStringAsync()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task The_route_without_the_api_key_is_refused_with_401()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(Path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("AzureServiceBus", true)]
    [InlineData("RabbitMQ", false)]
    public async Task The_capabilities_answer_says_whether_the_provider_has_namespace_properties(string providerType, bool supported)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync($"/api/connections/providers/{providerType}/capabilities");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = Json(await response.Content.ReadAsStringAsync());
        Assert.Equal(supported, body.GetProperty("supportsNamespaceProperties").GetBoolean());
        Assert.Equal(supported ? 256 * 1024 : 128L * 1024 * 1024, body.GetProperty("maxMessageSizeInBytes").GetInt64());
    }
}
