using System.Net;

namespace ServiceBusExplorer.Api.Tests;

public class AuthMiddlewareTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public AuthMiddlewareTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Request_without_api_key_returns_401()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/connections");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Request_with_wrong_api_key_returns_401()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", "wrong-secret");
        var response = await client.GetAsync("/api/connections");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Request_with_correct_api_key_returns_200()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        var response = await client.GetAsync("/api/connections");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Health_endpoint_is_public()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
