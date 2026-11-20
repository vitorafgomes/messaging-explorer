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
/// stored only as its hash, a connection offered at read or readAndSend, a production one included, marked as never
/// asked only when it is a broker on this computer, and a settings file that cannot be read or written handled without
/// a crash or a leak.
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
        Assert.Equal(["read", "readAndSend", "all"], state.GetProperty("levels").EnumerateArray().Select(l => l.GetString()));
        var supports = state.GetProperty("supports");
        Assert.Equal((true, true, true, true), (supports.GetProperty("logs").GetBoolean(), supports.GetProperty("appSettings").GetBoolean(), supports.GetProperty("confirmation").GetBoolean(),
            supports.GetProperty("entities").GetBoolean()));
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
    public async Task A_connection_is_offered_at_read_or_readAndSend_a_production_one_included_and_withdrawn_idempotently()
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
        using var offered = await client.PutAsJsonAsync("/api/mcp/connections/c1", new { level = "readAndSend" });
        var afterOffer = await StateAsync(client);
        using var withdrawn = await client.DeleteAsync("/api/mcp/connections/c1");
        using var again = await client.DeleteAsync("/api/mcp/connections/c1");

        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, send.StatusCode);
        using (var body = JsonDocument.Parse(await send.Content.ReadAsStringAsync()))
            Assert.Equal("level must be read, readAndSend or all.", body.RootElement.GetProperty("message").GetString());
        Assert.True(production.StatusCode == HttpStatusCode.OK, $"a production connection can be offered now that the app asks before each operation: it answered {(int)production.StatusCode}");
        Assert.Equal(HttpStatusCode.OK, offered.StatusCode);
        var listed = afterOffer.GetProperty("connections").EnumerateArray()
            .ToDictionary(c => c.GetProperty("connectionId").GetString()!, c => (c.GetProperty("level").GetString(), c.GetProperty("production").GetBoolean(), c.GetProperty("canNeverAsk").GetBoolean(), c.GetProperty("neverAsk").GetBoolean()));
        Assert.Equal(("readAndSend", false, false, false), listed["c1"]);
        Assert.Equal(("read", true, false, false), listed["c-prod"]);
        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (withdrawn.StatusCode, again.StatusCode));
        Assert.Equal(["c-prod"], (await StateAsync(client)).GetProperty("connections").EnumerateArray().Select(c => c.GetProperty("connectionId").GetString()));
    }

    [Fact]
    public async Task Never_asked_is_accepted_only_for_a_broker_on_this_computer_that_is_not_production_and_stops_counting_when_that_changes()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);
        var groups = factory.Services.GetRequiredService<IConnectionGroupManager>();
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "env-prod", Name = "prod", Type = "environment", IsProduction = true });
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "env-local", Name = "local", Type = "environment" });
        await SeedAsync(factory, new ServiceBusConnection { Id = "c-emulator", Name = "emulator", ConnectionString = "Endpoint=sb://localhost;SharedAccessKeyName=k;SharedAccessKey=v;UseDevelopmentEmulator=true", EnvironmentId = "env-local" });
        await SeedAsync(factory, new ServiceBusConnection { Id = "c-rabbit", Name = "rabbit", ProviderType = ServiceBusExplorer.Core.Providers.ProviderType.RabbitMQ, HostName = "127.0.0.1" });
        await SeedAsync(factory, new ServiceBusConnection { Id = "c-remote", Name = "remote", ConnectionString = "Endpoint=sb://localhost.evil.example/;SharedAccessKeyName=k;SharedAccessKey=v" });
        await SeedAsync(factory, new ServiceBusConnection { Id = "c-prod", Name = "prod", ProviderType = ServiceBusExplorer.Core.Providers.ProviderType.RabbitMQ, HostName = "localhost", EnvironmentId = "env-prod" });

        using var emulator = await client.PutAsJsonAsync("/api/mcp/connections/c-emulator", new { level = "readAndSend", neverAsk = true });
        using var rabbit = await client.PutAsJsonAsync("/api/mcp/connections/c-rabbit", new { level = "readAndSend", neverAsk = true });
        using var remote = await client.PutAsJsonAsync("/api/mcp/connections/c-remote", new { level = "readAndSend", neverAsk = true });
        using var production = await client.PutAsJsonAsync("/api/mcp/connections/c-prod", new { level = "readAndSend", neverAsk = true });
        using var levelOnly = await client.PutAsJsonAsync("/api/mcp/connections/c-rabbit", new { level = "read" });
        var marked = await StateAsync(client);
        using (var unmark = await client.PutAsJsonAsync("/api/mcp/connections/c-emulator", new { level = "readAndSend", neverAsk = false })) Assert.Equal(HttpStatusCode.OK, unmark.StatusCode);
        var unmarked = await StateAsync(client);
        using (var mark = await client.PutAsJsonAsync("/api/mcp/connections/c-emulator", new { level = "readAndSend", neverAsk = true })) Assert.Equal(HttpStatusCode.OK, mark.StatusCode);
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "env-local", Name = "local", Type = "environment", IsProduction = true });
        await SeedAsync(factory, new ServiceBusConnection { Id = "c-rabbit", Name = "rabbit", ProviderType = ServiceBusExplorer.Core.Providers.ProviderType.RabbitMQ, HostName = "10.0.0.5" });
        var changed = await StateAsync(client);

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (emulator.StatusCode, rabbit.StatusCode));
        foreach (var (what, refused) in new[] { ("a host that is not this computer", remote), ("a production connection", production) })
        {
            Assert.True(refused.StatusCode == HttpStatusCode.BadRequest, $"only a broker on this computer can be marked as never asked: {what} answered {(int)refused.StatusCode}");
            using var body = JsonDocument.Parse(await refused.Content.ReadAsStringAsync());
            Assert.Equal(McpController.NeverAskRefused, body.RootElement.GetProperty("message").GetString());
        }
        Assert.Equal(HttpStatusCode.OK, levelOnly.StatusCode);
        static Dictionary<string, (bool CanNeverAsk, bool NeverAsk)> Marks(JsonElement state) => state.GetProperty("connections").EnumerateArray()
            .ToDictionary(c => c.GetProperty("connectionId").GetString()!, c => (c.GetProperty("canNeverAsk").GetBoolean(), c.GetProperty("neverAsk").GetBoolean()));
        Assert.True(Marks(marked)["c-rabbit"] == (true, true), "a body with only the level keeps the never-asked mark the connection had");
        Assert.True(Marks(unmarked)["c-emulator"] == (true, false), "an explicit neverAsk false removes the mark");
        Assert.Equal(new Dictionary<string, (bool, bool)> { ["c-emulator"] = (true, true), ["c-rabbit"] = (true, true) }, Marks(marked));
        Assert.Equal(new Dictionary<string, (bool, bool)> { ["c-emulator"] = (false, false), ["c-rabbit"] = (false, false) }, Marks(changed));
    }

    [Theory]
    [InlineData("localhost", true)]
    [InlineData("LOCALHOST", true)]
    [InlineData("127.0.0.1", true)]
    [InlineData("127.1.2.3", true)]
    [InlineData("[::1]", true)]
    [InlineData("::1", true)]
    [InlineData("localhost.evil.example", false)]
    [InlineData("127.0.0.1.evil.example", false)]
    [InlineData("10.0.0.5", false)]
    [InlineData("broker.example.com", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void A_host_is_this_computer_only_when_it_is_localhost_or_a_loopback_address(string? host, bool loopback)
    {
        Assert.True(McpToolCalls.IsLoopbackHost(host) == loopback, $"only a broker on this computer can be marked as never asked: {host ?? "no host"} must be loopback {loopback}");
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

    [Theory]
    [InlineData("all", "all", true)]
    [InlineData("readAndSend", "all", false)]
    [InlineData("all", "read", true)]
    [InlineData("all", "a level that does not exist", false)]
    [InlineData("a level that does not exist", "read", false)]
    [InlineData(null, "read", false)]
    public void A_level_covers_the_levels_below_it_and_never_one_that_does_not_exist(string? offered, string needed, bool covers) =>
        Assert.True(McpSettingsStore.Covers(offered, needed) == covers, $"offered {offered ?? "nothing"} covers {needed}: expected {covers}");
}
