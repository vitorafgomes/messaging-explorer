using System.Net;

namespace ServiceBusExplorer.Api.Tests;

public class CorsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public CorsTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Preflight_from_evil_origin_is_not_allowed()
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/connections");
        request.Headers.Add("Origin", "http://evil.localhost:1234");
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "X-Api-Key");

        var response = await client.SendAsync(request);

        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Preflight_from_configured_frontend_is_allowed()
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/connections");
        request.Headers.Add("Origin", "http://localhost:4297");
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "X-Api-Key");

        var response = await client.SendAsync(request);

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Equal("http://localhost:4297",
            response.Headers.GetValues("Access-Control-Allow-Origin").First());
    }
}
