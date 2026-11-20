using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The MCP endpoint is off until the user turns it on, and then answers only a request that carries the MCP token as
/// a bearer and, when it names an origin, names this computer. The API key opens nothing there, and the MCP token
/// opens nothing else.
/// </summary>
public class McpGateTests
{
    internal const string InitializeBody = """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"gate-test","version":"1.0"}}}""";

    internal static HttpClient KeyedClient(ApiFactory factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        return client;
    }

    /// <summary>Turns the server on and creates a token through the routes; answers the plain token.</summary>
    internal static async Task<string> EnableWithTokenAsync(ApiFactory factory)
    {
        using var keyed = KeyedClient(factory);
        using var enabled = await keyed.PutAsJsonAsync("/api/mcp/enabled", new { enabled = true });
        Assert.Equal(HttpStatusCode.OK, enabled.StatusCode);
        using var created = await keyed.PostAsync("/api/mcp/token", null);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        using var doc = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("token").GetString()!;
    }

    /// <summary>A JSON-RPC request to /mcp as an MCP client over Streamable HTTP sends it.</summary>
    internal static HttpRequestMessage McpRequest(string body, string path = "/mcp", string? bearer = null, string? origin = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Accept.ParseAdd("text/event-stream");
        if (bearer is not null) request.Headers.TryAddWithoutValidation("Authorization", bearer);
        if (origin is not null) request.Headers.TryAddWithoutValidation("Origin", origin);
        return request;
    }

    [Fact]
    public async Task The_mcp_endpoint_answers_404_while_the_user_has_not_turned_it_on_even_with_a_token_and_the_api_key()
    {
        using var factory = new ApiFactory();
        var token = await EnableWithTokenAsync(factory);
        using var keyed = KeyedClient(factory);
        using (await keyed.PutAsJsonAsync("/api/mcp/enabled", new { enabled = false })) { }
        using var client = factory.CreateClient();

        using var withToken = await client.SendAsync(McpRequest(InitializeBody, bearer: "Bearer " + token));
        using var get = await keyed.GetAsync("/mcp");

        Assert.True(withToken.StatusCode == HttpStatusCode.NotFound, $"off until the user turns it on: /mcp must answer 404 while disabled, it answered {(int)withToken.StatusCode}");
        Assert.True(get.StatusCode == HttpStatusCode.NotFound, $"off until the user turns it on: /mcp must answer 404 to the API key while disabled, it answered {(int)get.StatusCode}");
    }

    [Fact]
    public async Task The_mcp_endpoint_answers_404_by_default()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.SendAsync(McpRequest(InitializeBody, bearer: "Bearer anything"));

        Assert.True(response.StatusCode == HttpStatusCode.NotFound, $"off until the user turns it on: a new install must answer 404 on /mcp, it answered {(int)response.StatusCode}");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("Bearer wrong-token")]
    [InlineData("Bearer")]
    [InlineData("Basic dXNlcjpwYXNz")]
    [InlineData("the-token-without-a-scheme")]
    public async Task A_request_without_the_right_bearer_is_refused_401_with_one_body_whatever_was_wrong(string? authorization)
    {
        using var factory = new ApiFactory();
        await EnableWithTokenAsync(factory);
        using var client = factory.CreateClient();

        using var response = await client.SendAsync(McpRequest(InitializeBody, bearer: authorization));

        Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"behind a token of its own: /mcp must refuse {authorization ?? "no Authorization header"} with 401, it answered {(int)response.StatusCode}");
        Assert.Equal("""{"message":"Unauthorized"}""", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_request_is_refused_401_while_no_token_was_ever_created()
    {
        using var factory = new ApiFactory();
        using var keyed = KeyedClient(factory);
        using (await keyed.PutAsJsonAsync("/api/mcp/enabled", new { enabled = true })) { }
        using var client = factory.CreateClient();

        using var response = await client.SendAsync(McpRequest(InitializeBody, bearer: "Bearer "));
        using var guessed = await client.SendAsync(McpRequest(InitializeBody, bearer: "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));

        Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"behind a token of its own: with no token created /mcp must answer 401, it answered {(int)response.StatusCode}");
        Assert.True(guessed.StatusCode == HttpStatusCode.Unauthorized, $"behind a token of its own: with no token created no bearer opens /mcp, it answered {(int)guessed.StatusCode}");
    }

    [Fact]
    public async Task The_api_key_alone_does_not_open_the_mcp_endpoint_in_any_letter_case()
    {
        using var factory = new ApiFactory();
        await EnableWithTokenAsync(factory);
        using var client = factory.CreateClient();

        foreach (var path in new[] { "/mcp", "/MCP", "/Mcp/" })
        {
            var request = McpRequest(InitializeBody, path);
            request.Headers.Add("X-Api-Key", ApiFactory.TestApiSecret);
            using var response = await client.SendAsync(request);
            Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"behind a token of its own: the API key alone must not open {path}, it answered {(int)response.StatusCode}");
        }
    }

    [Fact]
    public async Task The_right_bearer_opens_the_mcp_endpoint_and_a_new_token_ends_the_old_one()
    {
        using var factory = new ApiFactory();
        var first = await EnableWithTokenAsync(factory);
        using var client = factory.CreateClient();

        using var opened = await client.SendAsync(McpRequest(InitializeBody, bearer: "Bearer " + first));
        Assert.True(opened.StatusCode == HttpStatusCode.OK, $"the MCP token must open /mcp, it answered {(int)opened.StatusCode}: {await opened.Content.ReadAsStringAsync()}");
        Assert.Contains("serverInfo", await opened.Content.ReadAsStringAsync());

        await EnableWithTokenAsync(factory);
        using var old = await client.SendAsync(McpRequest(InitializeBody, bearer: "Bearer " + first));
        Assert.True(old.StatusCode == HttpStatusCode.Unauthorized, $"creating a new token ends the old one: the old token must answer 401, it answered {(int)old.StatusCode}");
    }

    [Theory]
    [InlineData("http://evil.example")]
    [InlineData("http://localhost.evil.example")]
    [InlineData("https://localhost")]
    [InlineData("null")]
    public async Task A_foreign_origin_is_refused_403_even_with_the_right_bearer(string origin)
    {
        using var factory = new ApiFactory();
        var token = await EnableWithTokenAsync(factory);
        using var client = factory.CreateClient();

        using var response = await client.SendAsync(McpRequest(InitializeBody, bearer: "Bearer " + token, origin: origin));

        Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"a foreign Origin is refused: /mcp must answer 403 to Origin {origin}, it answered {(int)response.StatusCode}");
    }

    [Theory]
    [InlineData("http://localhost:4297")]
    [InlineData("http://127.0.0.1")]
    [InlineData("http://[::1]:6274")]
    public async Task An_origin_on_this_computer_passes(string origin)
    {
        using var factory = new ApiFactory();
        var token = await EnableWithTokenAsync(factory);
        using var client = factory.CreateClient();

        using var response = await client.SendAsync(McpRequest(InitializeBody, bearer: "Bearer " + token, origin: origin));

        Assert.True(response.StatusCode == HttpStatusCode.OK, $"an Origin on this computer must pass, {origin} answered {(int)response.StatusCode}");
    }

    [Fact]
    public async Task The_mcp_token_alone_opens_no_api_route()
    {
        using var factory = new ApiFactory();
        var token = await EnableWithTokenAsync(factory);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer " + token);

        using var connections = await client.GetAsync("/api/connections");
        using var state = await client.GetAsync("/api/mcp");

        Assert.True(connections.StatusCode == HttpStatusCode.Unauthorized, $"the MCP token opens no other route: api/connections must answer 401, it answered {(int)connections.StatusCode}");
        Assert.True(state.StatusCode == HttpStatusCode.Unauthorized, $"the MCP token opens no other route: api/mcp must answer 401, it answered {(int)state.StatusCode}");
    }
}
