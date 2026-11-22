using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Api.Mcp;
using static ServiceBusExplorer.Api.Tests.McpGateTests;
using static ServiceBusExplorer.Api.Tests.McpToolTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The settings of the app an assistant may read and change: off by default, behind the key and never the MCP token,
/// only theme, developerMode and updateChannel with their fixed values handed to the app, at most 20 waiting for at
/// most ten seconds, an answer of the app validated, and every call recorded with fixed words.
/// </summary>
public class McpAppSettingsTests
{
    private static readonly object Reported = new { applied = true, code = (string?)null, settings = new { theme = "dark", developerMode = true, updateChannel = (string?)null } };

    private static async Task<JsonElement> AppRequestsAsync(Host host)
    {
        using var doc = JsonDocument.Parse(await host.Keyed.GetStringAsync("/api/mcp/app-requests"));
        return doc.RootElement.Clone();
    }

    /// <summary>Waits, at most 5 seconds, until <paramref name="count"/> requests wait for the app.</summary>
    private static async Task<JsonElement> WaitForAppAsync(Host host, int count = 1)
    {
        var until = DateTime.UtcNow.AddSeconds(5);
        while (true)
        {
            var waiting = await AppRequestsAsync(host);
            if (waiting.GetArrayLength() >= count || DateTime.UtcNow > until) return waiting;
            await Task.Delay(20);
        }
    }

    /// <summary>Waits for the one request of a tool call, answers it with <paramref name="body"/> and returns it.</summary>
    private static async Task<JsonElement> AnswerOnlyAppRequestAsync(Host host, object body)
    {
        var waiting = await WaitForAppAsync(host);
        Assert.True(waiting.GetArrayLength() == 1, $"the tool hands one request to the app; the requests waiting were {waiting}");
        using var answered = await host.Keyed.PostAsJsonAsync($"/api/mcp/app-requests/{waiting[0].GetProperty("id").GetString()}/answer", body);
        Assert.Equal(HttpStatusCode.NoContent, answered.StatusCode);
        return waiting[0].Clone();
    }

    /// <summary>Calls a tool that must answer without handing anything to the app, failing with <paramref name="requirement"/> when it waits.</summary>
    private static async Task<(bool IsError, string Text)> CallUnhandedAsync(Host host, string tool, object? arguments, string requirement)
    {
        var call = host.CallAsync(tool, arguments);
        Assert.True(await Task.WhenAny(call, Task.Delay(TimeSpan.FromSeconds(5))) == call, $"{requirement}: {tool} waited for the app instead");
        return await call;
    }

    private static async Task<Host> AllowedHostAsync(TimeSpan? appWait = null)
    {
        var host = new Host(new Broker(), appWait: appWait ?? TimeSpan.FromSeconds(30));
        await host.StartAsync();
        using var allowed = await host.Keyed.PutAsJsonAsync("/api/mcp/app-settings", new { allowed = true });
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        return host;
    }

    private static (string?, string?, string?, string?) Line(JsonElement line) =>
        (line.GetProperty("asked").GetString(), line.GetProperty("where").GetString(), line.GetProperty("outcome").GetString(), line.GetProperty("kind").GetString());

    [Fact]
    public async Task The_choice_is_off_by_default_persisted_turned_on_and_off_by_its_route_behind_the_key_and_the_mcp_token_opens_no_app_route()
    {
        using var factory = new ApiFactory();
        using var client = KeyedClient(factory);
        using var anonymous = factory.CreateClient();
        using var bearerOnly = factory.CreateClient();
        using (var created = await client.PostAsync("/api/mcp/token", null))
        using (var doc = JsonDocument.Parse(await created.Content.ReadAsStringAsync()))
            bearerOnly.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer " + doc.RootElement.GetProperty("token").GetString());
        using (await client.PutAsJsonAsync("/api/mcp/enabled", new { enabled = true })) { }

        using var start = JsonDocument.Parse(await client.GetStringAsync("/api/mcp"));
        var refused = new List<(string Route, HttpStatusCode Status)>();
        foreach (var http in new[] { anonymous, bearerOnly })
        {
            using var put = await http.PutAsJsonAsync("/api/mcp/app-settings", new { allowed = true });
            using var list = await http.GetAsync("/api/mcp/app-requests");
            using var answer = await http.PostAsJsonAsync("/api/mcp/app-requests/any/answer", Reported);
            refused.AddRange([("PUT app-settings", put.StatusCode), ("GET app-requests", list.StatusCode), ("POST answer", answer.StatusCode)]);
        }
        using var noAllowed = await client.PutAsJsonAsync("/api/mcp/app-settings", new { });
        using var on = await client.PutAsJsonAsync("/api/mcp/app-settings", new { allowed = true });
        using (await client.PutAsJsonAsync("/api/mcp/logs", new { allowed = true })) { }
        var persisted = new McpSettingsStore(factory.DataPath, "http://127.0.0.1:1/mcp").Current.AppSettingsAllowed;
        using var off = await client.PutAsJsonAsync("/api/mcp/app-settings", new { allowed = false });

        Assert.True(!start.RootElement.GetProperty("appSettingsAllowed").GetBoolean() && start.RootElement.GetProperty("supports").GetProperty("appSettings").GetBoolean(),
            $"the settings of the app are not allowed by default and the state says it supports them: {start.RootElement}");
        Assert.True(refused.All(r => r.Status == HttpStatusCode.Unauthorized),
            $"the app routes sit behind the key and the MCP token opens none of them: {string.Join(", ", refused.Select(r => $"{r.Route} {(int)r.Status}"))}");
        Assert.True(noAllowed.StatusCode == HttpStatusCode.BadRequest && (await noAllowed.Content.ReadFromJsonAsync<JsonElement>()).TryGetProperty("message", out _),
            $"a body without allowed is refused with a message; it answered {(int)noAllowed.StatusCode}");
        Assert.True((await on.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("appSettingsAllowed").GetBoolean(), "the route turns the choice on");
        Assert.True(persisted, "the choice is written to the settings file and survives a change of another switch");
        Assert.False((await off.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("appSettingsAllowed").GetBoolean(), "the route turns the choice off");
    }

    [Fact]
    public async Task Both_tools_are_refused_with_the_fixed_sentence_while_not_allowed_and_nothing_waits_for_the_app()
    {
        await using var host = new Host(new Broker(), appWait: TimeSpan.FromSeconds(30));
        await host.StartAsync();

        var read = await CallUnhandedAsync(host, "read_app_settings", null, "read_app_settings is refused while not allowed");
        var change = await CallUnhandedAsync(host, "change_app_setting", new { setting = "theme", value = "dark", reason = "r" }, "change_app_setting is refused while not allowed");

        Assert.True(read == (true, McpAppSettingsTools.NotAllowed) && change == (true, McpAppSettingsTools.NotAllowed),
            $"both tools are refused with the exact sentence while the user has not allowed them; they answered {read} and {change}");
        Assert.Equal(0, (await AppRequestsAsync(host)).GetArrayLength());
        Assert.Equal(
            [("Change a setting of the app", "This app", "Refused: not allowed", "error"), ("Read the settings of the app", "This app", "Refused: not allowed", "error")],
            (await host.ActivityAsync()).EnumerateArray().Select(Line));
    }

    [Fact]
    public async Task Read_app_settings_hands_a_request_with_no_setting_and_answers_what_the_app_reported_with_no_connection_active()
    {
        await using var host = await AllowedHostAsync();

        var call = host.CallAsync("read_app_settings");
        var request = await AnswerOnlyAppRequestAsync(host, Reported);
        var (isError, text) = await call;

        Assert.True((request.GetProperty("setting").ValueKind, request.GetProperty("value").ValueKind, request.GetProperty("assistant").GetString()) == (JsonValueKind.Null, JsonValueKind.Null, "Assistant"),
            $"read_app_settings hands a request with setting null: {request}");
        Assert.False(isError, $"read_app_settings needs no active connection: {text}");
        Assert.Equal("""{"settings":{"theme":"dark","developerMode":true,"updateChannel":null}}""", text);
        Assert.Equal(("Read the settings of the app", "This app", "Read", "plain"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
        var listed = await host.ListedToolAsync("read_app_settings");
        Assert.True(listed.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean(), $"read_app_settings is read only: {listed}");
    }

    [Theory]
    [InlineData("theme", "light")]
    [InlineData("developerMode", "on")]
    [InlineData("developerMode", "off")]
    [InlineData("updateChannel", "beta")]
    public async Task Change_app_setting_hands_exactly_the_setting_and_value_and_answers_what_the_app_reported(string setting, string value)
    {
        await using var host = await AllowedHostAsync();

        var call = host.CallAsync("change_app_setting", new { setting, value, reason = "the user asked for it" });
        var request = await AnswerOnlyAppRequestAsync(host, new { applied = true, settings = new { theme = "light", developerMode = false, updateChannel = "beta" } });
        var (isError, text) = await call;

        Assert.True((request.GetProperty("setting").GetString(), request.GetProperty("value").GetString()) == (setting, value),
            $"change_app_setting hands exactly the setting and the value to the app: {request}");
        Assert.False(isError, text);
        Assert.Equal($$$"""{"changed":{"setting":"{{{setting}}}","value":"{{{value}}}"},"settings":{"theme":"light","developerMode":false,"updateChannel":"beta"}}""", text);
        Assert.Equal(($"Set {setting} to {value}", "This app", "Changed", "plain"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
        var hints = (await host.ListedToolAsync("change_app_setting")).GetProperty("annotations");
        Assert.Equal((false, false, true), (hints.GetProperty("readOnlyHint").GetBoolean(), hints.GetProperty("destructiveHint").GetBoolean(), hints.GetProperty("idempotentHint").GetBoolean()));
    }

    public static readonly TheoryData<string, string, string, string> NotHandedOn = new()
    {
        { "mcpEnabled", "on", McpAppSettingsTools.NotASetting, "Refused: not a setting" },
        { "token", "x", McpAppSettingsTools.NotASetting, "Refused: not a setting" },
        { "clearData", "on", McpAppSettingsTools.NotASetting, "Refused: not a setting" },
        { "installUpdate", "on", McpAppSettingsTools.NotASetting, "Refused: not a setting" },
        { "logsAllowed", "on", McpAppSettingsTools.NotASetting, "Refused: not a setting" },
        { "appSettingsAllowed", "on", McpAppSettingsTools.NotASetting, "Refused: not a setting" },
        { "level", "all", McpAppSettingsTools.NotASetting, "Refused: not a setting" },
        { "Theme", "dark", McpAppSettingsTools.NotASetting, "Refused: not a setting" },
        { "theme", "blue", "This value is not valid for theme. Valid: system, light, dark.", "Refused: not a value" },
        { "theme", "Dark", "This value is not valid for theme. Valid: system, light, dark.", "Refused: not a value" },
        { "developerMode", "true", "This value is not valid for developerMode. Valid: on, off.", "Refused: not a value" },
        { "updateChannel", "nightly", "This value is not valid for updateChannel. Valid: latest, beta.", "Refused: not a value" },
        { "updateChannel", "", "This value is not valid for updateChannel. Valid: latest, beta.", "Refused: not a value" },
    };

    [Theory]
    [MemberData(nameof(NotHandedOn))]
    public async Task Only_the_three_settings_and_their_values_are_ever_handed_to_the_app(string setting, string value, string sentence, string outcome)
    {
        await using var host = await AllowedHostAsync();

        var answer = await CallUnhandedAsync(host, "change_app_setting", new { setting, value, reason = "r" }, $"{setting}={value} is refused before anything is handed to the app");

        Assert.True(answer == (true, sentence), $"only theme, developerMode and updateChannel with their fixed values are handed on; {setting}={value} answered {answer}");
        Assert.Equal(0, (await AppRequestsAsync(host)).GetArrayLength());
        Assert.Equal(("Change a setting of the app", "This app", outcome, "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \t ")]
    public async Task Change_app_setting_without_a_reason_is_refused_and_nothing_is_handed_to_the_app(string? reason)
    {
        await using var host = await AllowedHostAsync();
        var arguments = new Dictionary<string, object?> { ["setting"] = "theme", ["value"] = "dark" };
        if (reason is not null) arguments["reason"] = reason;

        var answer = await CallUnhandedAsync(host, "change_app_setting", arguments, "a change without a reason is refused at once");
        var schema = (await host.ListedToolAsync("change_app_setting")).GetProperty("inputSchema");

        Assert.True(answer == (true, McpToolCalls.ReasonRequired), $"a reason is required to change a setting of the app; it answered {answer}");
        Assert.Equal(0, (await AppRequestsAsync(host)).GetArrayLength());
        Assert.Equal(("Change a setting of the app", "This app", "Refused: no reason", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
        var required = schema.TryGetProperty("required", out var names) ? names.EnumerateArray().Select(n => n.GetString()).ToList() : [];
        Assert.True(!required.Contains("reason") && schema.GetProperty("properties").GetProperty("reason").GetProperty("description").GetString()!.Contains("Required", StringComparison.Ordinal),
            $"change_app_setting takes reason as optional in its schema and its description says it is required: {schema}");
    }

    [Fact]
    public async Task A_request_the_app_does_not_answer_in_the_wait_stops_waiting_and_the_wait_of_the_app_is_ten_seconds()
    {
        var requests = new McpAppRequests(TimeSpan.FromMilliseconds(100));

        var asked = requests.AskAsync("Assistant", "theme", "dark", CancellationToken.None);
        var waitedWhileOpen = requests.Waiting().Count;
        var finished = await Task.WhenAny(asked, Task.Delay(TimeSpan.FromSeconds(5))) == asked;

        Assert.Equal(TimeSpan.FromSeconds(10), McpAppRequests.DefaultWait);
        Assert.True(finished, "a request the app does not answer stops waiting after the wait");
        Assert.True(await asked == (true, null) && waitedWhileOpen == 1 && requests.Waiting().Count == 0,
            $"an unanswered request ends with no answer and stops waiting; it waited {waitedWhileOpen} and {requests.Waiting().Count} still wait");
    }

    [Fact]
    public async Task The_tool_fails_with_its_sentence_when_the_app_does_not_answer()
    {
        await using var host = await AllowedHostAsync(TimeSpan.FromMilliseconds(200));

        var answer = await CallUnhandedAsync(host, "change_app_setting", new { setting = "theme", value = "dark", reason = "r" }, "the tool stops waiting after the wait");

        Assert.True(answer == (true, McpAppSettingsTools.NoAnswer), $"a change the app does not answer fails with the fixed sentence; it answered {answer}");
        Assert.Equal(0, (await AppRequestsAsync(host)).GetArrayLength());
        Assert.Equal(("Set theme to dark", "This app", "Failed: the app did not answer", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Theory]
    [InlineData("turned off", "The MCP server was turned off.", "Refused: server turned off")]
    [InlineData("choice withdrawn", McpAppSettingsTools.NotAllowed, "Refused: not allowed")]
    [InlineData("new token", "The MCP token was replaced.", "Refused: token replaced")]
    public async Task A_change_waiting_for_the_app_when_the_server_is_turned_off_or_the_choice_withdrawn_is_refused_at_once_and_nothing_is_changed(string how, string sentence, string outcome)
    {
        await using var host = await AllowedHostAsync(TimeSpan.FromSeconds(60));

        var call = host.CallAsync("change_app_setting", new { setting = "theme", value = "dark", reason = "r" });
        var id = (await WaitForAppAsync(host))[0].GetProperty("id").GetString();
        using (var ended = how switch
        {
            "turned off" => await host.Keyed.PutAsJsonAsync("/api/mcp/enabled", new { enabled = false }),
            "choice withdrawn" => await host.Keyed.PutAsJsonAsync("/api/mcp/app-settings", new { allowed = false }),
            _ => await host.Keyed.PostAsync("/api/mcp/token", null),
        })
            Assert.Equal(HttpStatusCode.OK, ended.StatusCode);
        var left = (await AppRequestsAsync(host)).GetArrayLength();
        var endedInTime = await Task.WhenAny(call, Task.Delay(TimeSpan.FromSeconds(5))) == call;
        using var lateAnswer = await host.Keyed.PostAsJsonAsync($"/api/mcp/app-requests/{id}/answer", Reported);

        Assert.True(endedInTime && left == 0, $"a request waiting for the app ends at once when {how}; ended in time: {endedInTime}, still listed: {left}");
        var answer = await call;
        Assert.True(answer == (true, sentence), $"a tool waiting for the app when {how} is refused with exactly \"{sentence}\"; it answered {answer}");
        Assert.True(lateAnswer.StatusCode == HttpStatusCode.NotFound, $"an answer of the app after {how} finds nothing waiting; it answered {(int)lateAnswer.StatusCode}");
        Assert.Equal(("Set theme to dark", "This app", outcome, "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task An_answer_of_the_app_while_the_choice_is_off_is_404_even_for_a_request_still_waiting()
    {
        await using var host = new Host(new Broker(), appWait: TimeSpan.FromSeconds(30));
        await host.StartAsync();
        var requests = host.Factory.Services.GetRequiredService<McpAppRequests>();
        using var stop = new CancellationTokenSource();
        var asked = requests.AskAsync("Assistant", "theme", "dark", stop.Token);
        var id = Assert.Single(requests.Waiting()).Id;

        using var answered = await host.Keyed.PostAsJsonAsync($"/api/mcp/app-requests/{id}/answer", Reported);
        stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => asked);

        Assert.True(answered.StatusCode == HttpStatusCode.NotFound,
            $"while the choice is off, an answer of the app is 404 as for a request not waiting; it answered {(int)answered.StatusCode}");
    }

    [Theory]
    [InlineData("desktopOnly", McpAppSettingsTools.DesktopOnly, "Failed: desktop only")]
    [InlineData("failed", McpAppSettingsTools.NotChanged, "Failed")]
    [InlineData(null, McpAppSettingsTools.NotChanged, "Failed")]
    public async Task An_answer_that_was_not_applied_fails_the_call_with_the_sentence_of_its_code(string? code, string sentence, string outcome)
    {
        await using var host = await AllowedHostAsync();

        var call = host.CallAsync("change_app_setting", new { setting = "updateChannel", value = "beta", reason = "r" });
        await AnswerOnlyAppRequestAsync(host, new { applied = false, code, settings = new { theme = "system", developerMode = false, updateChannel = (string?)null } });
        var answer = await call;

        Assert.True(answer == (true, sentence), $"an answer not applied with code {code ?? "null"} fails with its sentence; it answered {answer}");
        Assert.Equal(("Set updateChannel to beta", "This app", outcome, "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task An_answer_that_is_not_valid_is_refused_and_the_request_keeps_waiting_and_an_answer_to_a_request_not_waiting_is_404()
    {
        await using var host = await AllowedHostAsync();
        var call = host.CallAsync("read_app_settings");
        var id = (await WaitForAppAsync(host))[0].GetProperty("id").GetString();
        var invalid = new object[]
        {
            new { code = (string?)null, settings = new { theme = "dark", developerMode = true } },
            new { applied = true },
            new { applied = true, code = "other", settings = new { theme = "dark", developerMode = true } },
            new { applied = true, settings = new { theme = "blue", developerMode = true } },
            new { applied = true, settings = new { developerMode = true } },
            new { applied = true, settings = new { theme = "dark" } },
            new { applied = true, settings = new { theme = "dark", developerMode = true, updateChannel = "nightly" } },
        };

        var refused = new List<(HttpStatusCode, string)>();
        foreach (var body in invalid)
        {
            using var response = await host.Keyed.PostAsJsonAsync($"/api/mcp/app-requests/{id}/answer", body);
            refused.Add((response.StatusCode, await response.Content.ReadAsStringAsync()));
        }
        var stillWaiting = (await AppRequestsAsync(host)).GetArrayLength();
        using var valid = await host.Keyed.PostAsJsonAsync($"/api/mcp/app-requests/{id}/answer", Reported);
        using var again = await host.Keyed.PostAsJsonAsync($"/api/mcp/app-requests/{id}/answer", Reported);
        using var unknown = await host.Keyed.PostAsJsonAsync("/api/mcp/app-requests/not-an-id/answer", Reported);
        var answer = await call;

        Assert.All(refused, r => Assert.True(r == (HttpStatusCode.BadRequest, $$"""{"message":"{{McpController.InvalidAppAnswer}}"}"""),
            $"an answer that is not valid is refused with the fixed message; one answered {r}"));
        Assert.True(stillWaiting == 1, $"a request answered with a body that is not valid keeps waiting; {stillWaiting} waited");
        Assert.Equal(HttpStatusCode.NoContent, valid.StatusCode);
        foreach (var notWaiting in new[] { again, unknown })
            Assert.True(notWaiting.StatusCode == HttpStatusCode.NotFound && (await notWaiting.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString() == "This request is no longer waiting.",
                $"an answer to a request that is not waiting is 404 with the fixed message; it answered {(int)notWaiting.StatusCode}");
        Assert.False(answer.IsError, answer.Text);
    }

    [Fact]
    public async Task A_cancelled_call_removes_its_request()
    {
        var requests = new McpAppRequests(TimeSpan.FromSeconds(30));
        using var cancellation = new CancellationTokenSource();

        var asked = requests.AskAsync("Assistant", "theme", "dark", cancellation.Token);
        var waitedWhileOpen = requests.Waiting().Count;
        await cancellation.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => asked);
        Assert.True(waitedWhileOpen == 1 && requests.Waiting().Count == 0, $"the caller's token cancels the wait and removes the request; {requests.Waiting().Count} still wait");
    }

    [Fact]
    public async Task At_most_20_requests_wait_for_the_app_and_a_21st_is_refused_at_once()
    {
        await using var host = await AllowedHostAsync();

        var waitingCalls = Enumerable.Range(0, McpAppRequests.Capacity).Select(_ => host.CallAsync("change_app_setting", new { setting = "theme", value = "dark", reason = "r" })).ToList();
        var waiting = await WaitForAppAsync(host, McpAppRequests.Capacity);
        var refused = await CallUnhandedAsync(host, "change_app_setting", new { setting = "theme", value = "light", reason = "r" }, "a 21st request is refused at once");
        var stillWaiting = (await AppRequestsAsync(host)).GetArrayLength();
        foreach (var request in waiting.EnumerateArray())
        {
            using (await host.Keyed.PostAsJsonAsync($"/api/mcp/app-requests/{request.GetProperty("id").GetString()}/answer", Reported)) { }
        }
        await Task.WhenAll(waitingCalls);

        Assert.Equal(McpAppRequests.Capacity, waiting.GetArrayLength());
        Assert.True(refused == (true, McpToolCalls.TooManySentence), $"at most 20 requests wait for the app: a 21st is refused at once; it answered {refused}");
        Assert.True(stillWaiting == McpAppRequests.Capacity, $"the 21st request is never handed on; {stillWaiting} waited");
        Assert.Contains((await host.ActivityAsync()).EnumerateArray(), l => Line(l) == ("Set theme to light", "This app", "Refused: too many waiting", "error"));
    }

    [Fact]
    public async Task No_record_line_holds_the_token_or_the_key_whatever_an_assistant_passes()
    {
        await using var host = await AllowedHostAsync();

        await CallUnhandedAsync(host, "change_app_setting", new { setting = host.Token, value = ApiFactory.TestApiSecret, reason = host.Token }, "a setting not on the list is refused at once");
        await CallUnhandedAsync(host, "change_app_setting", new { setting = "theme", value = host.Token, reason = host.Token }, "a value not on the list is refused at once");
        var call = host.CallAsync("change_app_setting", new { setting = "theme", value = "dark", reason = host.Token });
        var waiting = await AnswerOnlyAppRequestAsync(host, Reported);
        await call;

        AssertNoSecret(waiting.GetRawText(), host.Token, "the request handed to the app");
        AssertNoSecret(waiting.GetRawText(), ApiFactory.TestApiSecret, "the request handed to the app");
        var activity = await host.ActivityAsync();
        Assert.Equal(
            [("Set theme to dark", "This app", "Changed", "plain"), ("Change a setting of the app", "This app", "Refused: not a value", "error"), ("Change a setting of the app", "This app", "Refused: not a setting", "error")],
            activity.EnumerateArray().Select(Line));
        AssertNoSecret(activity.GetRawText(), host.Token, "the record of the app settings tools");
        AssertNoSecret(activity.GetRawText(), ApiFactory.TestApiSecret, "the record of the app settings tools");
    }
}
