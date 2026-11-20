using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.McpToolTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The requests waiting for the user: a production connection asks before every read but list_connections and
/// read_logs, at most 20 requests wait, and only the per-launch key answers one, never the MCP token.
/// </summary>
public class McpRequestTests
{
    [Fact]
    public async Task A_production_connection_asks_before_every_read_and_list_connections_and_read_logs_never_ask()
    {
        var broker = new Broker { Messages = [new MessageInfo { MessageId = "m1", SequenceNumber = 1, Body = "b" }] };
        await using var host = new Host(broker);
        await host.StartAsync();
        var groups = host.Factory.Services.GetRequiredService<IConnectionGroupManager>();
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "env-prod", Name = "prod", Type = "environment", IsProduction = true });
        var connection = Offered();
        connection.EnvironmentId = "env-prod";
        await host.SeedAsync(connection);
        await host.OfferAsync(connection.Id);
        await host.ConnectAsync(connection.Id);
        using (var allowed = await host.Keyed.PutAsJsonAsync("/api/mcp/logs", new { allowed = true })) Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);

        var listed = await host.CallUnaskedAsync("list_connections", null, "list_connections never asks, even on a production connection");
        var logs = await host.CallUnaskedAsync("read_logs", null, "read_logs never asks, even on a production connection");
        var queues = host.CallAsync("list_queues");
        var queuesRequest = await host.AnswerOnlyRequestAsync(allow: true);
        var queuesAnswer = await queues;
        var asked = new List<(string Title, string Facts, (bool, string) Answer)>();
        foreach (var (tool, arguments) in new (string, object)[]
        {
            ("list_topics", new { }),
            ("list_subscriptions", new { topic = "events" }),
            ("list_rules", new { topic = "events", subscription = "audit" }),
            ("peek_messages", new { entity = "orders", subQueue = "deadLetter", count = 5, reason = "find why order 42 failed" }),
        })
        {
            var call = host.CallAsync(tool, arguments);
            var request = await host.AnswerOnlyRequestAsync(allow: false);
            asked.Add((request.GetProperty("title").GetString()!,
                string.Join(" | ", request.GetProperty("facts").EnumerateArray().Select(f => $"{f.GetProperty("label").GetString()}: {f.GetProperty("value").GetString()}")),
                await call));
        }

        Assert.False(listed.IsError || logs.IsError, $"list_connections and read_logs never ask: {listed.Text} {logs.Text}");
        Assert.Equal(("read", "Assistant asks to list the queues", "This is a production connection. What is read is sent to the assistant and to the company that runs it.", "Allow this read"),
            (queuesRequest.GetProperty("kind").GetString(), queuesRequest.GetProperty("title").GetString(), queuesRequest.GetProperty("note").GetString(), queuesRequest.GetProperty("allowLabel").GetString()));
        Assert.Equal([("On", "offered-name (prod)"), ("It said why", "It gave no reason")],
            queuesRequest.GetProperty("facts").EnumerateArray().Select(f => (f.GetProperty("label").GetString(), f.GetProperty("value").GetString())));
        Assert.False(queuesAnswer.IsError, $"a read the user allowed on a production connection answers: {queuesAnswer.Text}");
        Assert.Equal(
        [
            ("Assistant asks to list the topics", "On: offered-name (prod) | It said why: It gave no reason", (true, McpToolCalls.DeniedSentence)),
            ("Assistant asks to list the subscriptions of events", "Of: events | On: offered-name (prod) | It said why: It gave no reason", (true, McpToolCalls.DeniedSentence)),
            ("Assistant asks to list the rules of audit", "Of: events/audit | On: offered-name (prod) | It said why: It gave no reason", (true, McpToolCalls.DeniedSentence)),
            ("Assistant asks to read up to 5 messages", "From: orders (deadLetter) | On: offered-name (prod) | It said why: find why order 42 failed", (true, McpToolCalls.DeniedSentence)),
        ], asked);
        Assert.True(broker.Peeks + broker.TopicLists + broker.SubscriptionLists == 0, "a read the user denied never reaches the provider");
        var lines = (await host.ActivityAsync()).EnumerateArray().Select(l => (l.GetProperty("asked").GetString(), l.GetProperty("outcome").GetString())).ToList();
        Assert.Equal(("List queues", "1 listed, allowed by you"), lines[4]);
        Assert.Equal(("Peek 5 messages", "Denied by you"), lines[0]);
    }

    [Fact]
    public async Task At_most_20_requests_wait_and_a_21st_is_refused_at_once()
    {
        var broker = new Broker();
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered", "readAndSend");
        await host.ConnectAsync("c-offered");

        var waitingCalls = Enumerable.Range(0, McpRequests.Capacity).Select(i => host.CallAsync("send_message", new { entity = "orders", body = $"m{i}", reason = "r" })).ToList();
        var waiting = await host.WaitForRequestsAsync(McpRequests.Capacity);
        var refused = await host.CallUnaskedAsync("send_message", new { entity = "orders", body = "m20", reason = "r" }, "at most 20 requests wait: a 21st is refused at once");
        var stillWaiting = (await host.RequestsAsync()).GetArrayLength();
        foreach (var request in waiting.EnumerateArray())
        {
            using var denied = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{request.GetProperty("id").GetString()}/answer", new { allow = false });
        }
        await Task.WhenAll(waitingCalls);

        Assert.Equal(McpRequests.Capacity, waiting.GetArrayLength());
        Assert.True(refused == (true, McpToolCalls.TooManySentence), $"at most 20 requests wait: a 21st is refused at once with the fixed sentence; it answered {refused}");
        Assert.True(stillWaiting == McpRequests.Capacity, $"the 21st request is never shown; {stillWaiting} waited");
        Assert.Equal(0, broker.SendCalls);
        var activity = await host.ActivityAsync();
        Assert.Equal("Refused: too many waiting", activity.EnumerateArray().Last().GetProperty("outcome").GetString());

        const string UtcTime = @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$";
        var times = waiting.EnumerateArray().Select(r => r.GetProperty("time").GetString()!).ToList();
        var fields = times.Concat(waiting.EnumerateArray().Select(r => r.GetProperty("expiresAt").GetString()!))
            .Concat(activity.EnumerateArray().Select(l => l.GetProperty("time").GetString()!)).ToList();
        Assert.All(fields, t => Assert.True(System.Text.RegularExpressions.Regex.IsMatch(t, UtcTime),
            $"every time of a request and of the record is ISO 8601 in UTC of one width, so text order is time order; one was {t}"));
        Assert.True(times.SequenceEqual(times.Order(StringComparer.Ordinal)),
            $"the requests are answered oldest first and their times as text are in that order: {string.Join(", ", times)}");
    }

    [Fact]
    public async Task A_second_answer_is_refused_at_once_and_never_changes_the_first()
    {
        var requests = new McpRequests(new McpRequestOptions(TimeSpan.FromSeconds(30)));
        var asked = requests.AskAsync("Assistant", "send", "Assistant asks to send 1 message", [], "note", "Send 1 message", CancellationToken.None);
        var id = Assert.Single(requests.Waiting()).Id;

        var first = requests.Answer(id, allow: false);
        var second = requests.Answer(id, allow: true);
        var outcome = await asked;

        Assert.True(first && !second, $"a request already answered is not waiting any more, so a retried answer is refused; the answers returned {first} and {second}");
        Assert.True(outcome == McpAnswer.Denied, $"a second answer never changes the outcome of the first; the request ended {outcome}");
        Assert.Empty(requests.Waiting());
    }

    [Fact]
    public async Task The_mcp_token_cannot_answer_a_request_and_the_key_answers_it_once()
    {
        var broker = new Broker();
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered", "readAndSend");
        await host.ConnectAsync("c-offered");
        using var bearerOnly = host.Factory.CreateClient();
        bearerOnly.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer " + host.Token);

        var call = host.CallAsync("send_message", new { entity = "orders", body = "a", reason = "r" });
        var id = (await host.WaitForRequestsAsync())[0].GetProperty("id").GetString();
        using var byToken = await bearerOnly.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = true });
        using var listByToken = await bearerOnly.GetAsync("/api/mcp/requests");
        var afterToken = await host.RequestsAsync();
        using var byKey = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = false });
        using var again = await host.Keyed.PostAsJsonAsync($"/api/mcp/requests/{id}/answer", new { allow = true });
        var answer = await call;

        Assert.True(byToken.StatusCode == HttpStatusCode.Unauthorized, $"the MCP token cannot answer its own request: it answered {(int)byToken.StatusCode}");
        Assert.True(listByToken.StatusCode == HttpStatusCode.Unauthorized, $"the MCP token cannot read the requests: it answered {(int)listByToken.StatusCode}");
        Assert.True(afterToken.GetArrayLength() == 1, $"a request the token tried to answer still waits; the requests were {afterToken}");
        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NotFound), (byKey.StatusCode, again.StatusCode));
        Assert.Equal((true, McpToolCalls.DeniedSentence), answer);
        Assert.Equal(0, broker.SendCalls);
    }
}
