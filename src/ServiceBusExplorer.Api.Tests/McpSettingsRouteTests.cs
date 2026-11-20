using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.McpGateTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The routes of the MCP server group of Settings: off with nothing offered by default, a token answered once and
/// stored only as its hash, a connection offered at the level read only and never one of a production environment,
/// and a settings file that cannot be read or written handled without a crash or a leak.
/// </summary>
public class McpSettingsRouteTests
{
    private static async Task<JsonElement> StateAsync(HttpClient client)
    {
        using var response = await client.GetAsync("/api/mcp");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    private static Task SeedAsync(ApiFactory factory, ServiceBusConnection connection) =>
        factory.Services.GetRequiredService<IConnectionManager>().SaveConnectionAsync(connection);

    [Fact]
    public async Task The_state_starts_off_with_no_token_nothing_offered_and_the_logs_not_allowed_and_sits_behind_the_api_key()
    {
        using var factory = new ApiFactory();
        using var anonymous = factory.CreateClient();
        using var client = KeyedClient(factory);

        using var refused = await anonymous.GetAsync("/api/mcp");
        var state = await StateAsync(client);

        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
        Assert.Equal((false, false, JsonValueKind.Null, false, 0),
            (state.GetProperty("enabled").GetBoolean(), state.GetProperty("hasToken").GetBoolean(), state.GetProperty("tokenCreatedAt").ValueKind,
             state.GetProperty("logsAllowed").GetBoolean(), state.GetProperty("connections").GetArrayLength()));
        Assert.Matches(@"^http://127\.0\.0\.1:\d+/mcp$", state.GetProperty("url").GetString());
        Assert.Equal(["read"], state.GetProperty("levels").EnumerateArray().Select(l => l.GetString()));
        var supports = state.GetProperty("supports");
        Assert.Equal((true, false, false), (supports.GetProperty("logs").GetBoolean(), supports.GetProperty("appSettings").GetBoolean(), supports.GetProperty("confirmation").GetBoolean()));
    }

    [Fact]
    public async Task The_token_is_answered_once_and_stored_only_as_its_hash()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);

        using var created = await client.PostAsync("/api/mcp/token", null);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        using var answer = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var token = answer.RootElement.GetProperty("token").GetString()!;
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        using (await client.PutAsJsonAsync("/api/mcp/enabled", new { enabled = true })) { }
        using var logsChanged = await client.PutAsJsonAsync("/api/mcp/logs", new { allowed = true });
        var later = await StateAsync(client);
        var file = await File.ReadAllTextAsync(Path.Combine(factory.DataPath, McpSettingsStore.FileName));

        Assert.Matches("^[A-Za-z0-9_-]{43}$", token);
        Assert.True(answer.RootElement.GetProperty("state").GetProperty("hasToken").GetBoolean(), "the answer to a new token says a token exists");
        Assert.True(later.GetProperty("tokenCreatedAt").GetDateTimeOffset() > DateTimeOffset.UtcNow.AddMinutes(-5), "the state says when the token was created");
        foreach (var (what, text) in new[]
        {
            ("the state in the answer", answer.RootElement.GetProperty("state").GetRawText()),
            ("a later state", later.GetRawText()),
            ("a later change", await logsChanged.Content.ReadAsStringAsync()),
        })
        {
            Assert.False(text.Contains(token, StringComparison.Ordinal), $"the token is answered once: {what} carried it");
            Assert.False(text.Contains(Convert.ToHexString(hash), StringComparison.OrdinalIgnoreCase) || text.Contains(Convert.ToBase64String(hash), StringComparison.Ordinal),
                $"the hash of the token is never answered: {what} carried it");
        }
        Assert.False(file.Contains(token, StringComparison.Ordinal), "the token is stored only as a hash: the settings file holds the plain token");
        Assert.Contains(Convert.ToHexString(hash), file);
    }

    [Fact]
    public async Task A_connection_is_offered_at_the_level_read_only_never_from_a_production_environment_and_withdrawn_idempotently()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);
        await factory.Services.GetRequiredService<IConnectionGroupManager>().SaveGroupAsync(
            new ConnectionGroup { Id = "env-prod", Name = "prod", Type = "environment", IsProduction = true });
        await SeedAsync(factory, new ServiceBusConnection { Id = "c1", Name = "dev", ConnectionString = "Endpoint=sb://dev.example/" });
        await SeedAsync(factory, new ServiceBusConnection { Id = "c-prod", Name = "prod", ConnectionString = "Endpoint=sb://prod.example/", EnvironmentId = "env-prod" });

        using var unknown = await client.PutAsJsonAsync("/api/mcp/connections/no-such-id", new { level = "read" });
        using var send = await client.PutAsJsonAsync("/api/mcp/connections/c1", new { level = "send" });
        using var production = await client.PutAsJsonAsync("/api/mcp/connections/c-prod", new { level = "read" });
        using var offered = await client.PutAsJsonAsync("/api/mcp/connections/c1", new { level = "read" });
        var afterOffer = await StateAsync(client);
        using var withdrawn = await client.DeleteAsync("/api/mcp/connections/c1");
        using var again = await client.DeleteAsync("/api/mcp/connections/c1");

        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, send.StatusCode);
        Assert.True(production.StatusCode == HttpStatusCode.Conflict, $"a production connection cannot be offered in this phase: it answered {(int)production.StatusCode}");
        using (var body = JsonDocument.Parse(await production.Content.ReadAsStringAsync()))
            Assert.Equal(McpController.ProductionRefused, body.RootElement.GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.OK, offered.StatusCode);
        var only = Assert.Single(afterOffer.GetProperty("connections").EnumerateArray());
        Assert.Equal(("c1", "read"), (only.GetProperty("connectionId").GetString(), only.GetProperty("level").GetString()));
        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (withdrawn.StatusCode, again.StatusCode));
        Assert.Equal(0, (await StateAsync(client)).GetProperty("connections").GetArrayLength());
    }

    [Fact]
    public async Task The_switches_change_the_state_and_the_activity_is_cleared_on_delete()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);
        factory.Services.GetRequiredService<McpActivityLog>().Add(new McpActivity(DateTimeOffset.UtcNow, "Assistant", "List queues", "This app", "Refused: not offered", "error"));

        using var enabled = await client.PutAsJsonAsync("/api/mcp/enabled", new { enabled = true });
        using var logs = await client.PutAsJsonAsync("/api/mcp/logs", new { allowed = true });
        using var activity = JsonDocument.Parse(await client.GetStringAsync("/api/mcp/activity"));
        using var cleared = await client.DeleteAsync("/api/mcp/activity");
        using var afterClear = JsonDocument.Parse(await client.GetStringAsync("/api/mcp/activity"));

        using (var doc = JsonDocument.Parse(await enabled.Content.ReadAsStringAsync())) Assert.True(doc.RootElement.GetProperty("enabled").GetBoolean());
        using (var doc = JsonDocument.Parse(await logs.Content.ReadAsStringAsync())) Assert.True(doc.RootElement.GetProperty("logsAllowed").GetBoolean());
        var line = Assert.Single(activity.RootElement.EnumerateArray());
        Assert.Equal(("Assistant", "List queues", "This app", "Refused: not offered", "error"),
            (line.GetProperty("assistant").GetString(), line.GetProperty("asked").GetString(), line.GetProperty("where").GetString(),
             line.GetProperty("outcome").GetString(), line.GetProperty("kind").GetString()));
        Assert.Equal(HttpStatusCode.NoContent, cleared.StatusCode);
        Assert.Equal(0, afterClear.RootElement.GetArrayLength());
    }

    [Fact]
    public async Task A_settings_file_that_cannot_be_read_starts_off_with_nothing_offered_and_the_api_still_answers()
    {
        using var factory = new ApiFactory();
        await File.WriteAllTextAsync(Path.Combine(factory.DataPath, McpSettingsStore.FileName), """{ "Enabled": true, "Connections": { "c1": """);
        using var client = KeyedClient(factory);

        var state = await StateAsync(client);
        using var anonymous = factory.CreateClient();
        using var mcp = await anonymous.SendAsync(McpRequest(InitializeBody, bearer: "Bearer anything"));

        Assert.True(!state.GetProperty("enabled").GetBoolean() && state.GetProperty("connections").GetArrayLength() == 0 && !state.GetProperty("hasToken").GetBoolean(),
            $"a settings file that cannot be read starts disabled with nothing offered; the state was {state}");
        Assert.Equal(HttpStatusCode.NotFound, mcp.StatusCode);
    }

    [Fact]
    public async Task A_settings_file_that_cannot_be_written_answers_500_with_the_fixed_sentence_and_changes_nothing()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);
        Directory.CreateDirectory(Path.Combine(factory.DataPath, McpSettingsStore.FileName + ".tmp"));

        using var enabled = await client.PutAsJsonAsync("/api/mcp/enabled", new { enabled = true });
        using var token = await client.PostAsync("/api/mcp/token", null);

        Assert.Equal((HttpStatusCode.InternalServerError, HttpStatusCode.InternalServerError), (enabled.StatusCode, token.StatusCode));
        Assert.Equal("""{"message":"An internal error occurred."}""", await enabled.Content.ReadAsStringAsync());
        Assert.Equal("""{"message":"An internal error occurred."}""", await token.Content.ReadAsStringAsync());
        var state = await StateAsync(client);
        Assert.True(!state.GetProperty("enabled").GetBoolean() && !state.GetProperty("hasToken").GetBoolean(),
            $"a change that could not be written does not take effect; the state was {state}");
    }
}
