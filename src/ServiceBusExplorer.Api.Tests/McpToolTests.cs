using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ServiceBusExplorer.Api.Logs;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.ErrorBodyTests;
using static ServiceBusExplorer.Api.Tests.McpGateTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The reading tools offer an assistant only the connections the user chose, act on the one active in the app, answer
/// what the provider lists and peeks with bodies cut at 8000 characters, read the logs only when allowed, answer a
/// broker failure with a fixed sentence, and record every call without a body or a secret.
/// </summary>
public class McpToolTests
{
    private const string Sentinel = "SENTINEL-SECRET-7f3a+/=";
    private const string BodyMarker = "BODY-MARKER-4410";
    private const string HiddenName = "hidden-connection-name";
    private const string HiddenTarget = "hidden-broker-target";

    /// <summary>What the stub provider answers, and what it throws on a peek.</summary>
    private sealed class Broker
    {
        public bool SupportsRules { get; init; } = true;
        public bool SupportsTransferDeadLetter { get; init; } = true;
        public string Target { get; init; } = "offered-target";
        public List<IMessage> Messages { get; init; } = [];
        public Exception? PeekFailure { get; init; }
        public int Peeks { get; set; }
    }

    private static IProviderFactory FactoryFor(Broker broker)
    {
        var capabilities = StubProxy.For<IProviderCapabilities>(m => m.Name switch
        {
            "get_SupportsSubscriptionRules" => broker.SupportsRules,
            "get_SupportsTransferDeadLetter" => broker.SupportsTransferDeadLetter,
            "get_ProviderDisplayName" => "Stub",
            "get_ProviderVersion" => "1",
            _ when m.ReturnType == typeof(bool) => true,
            _ => throw new NotSupportedException(m.Name)
        });
        var provider = StubProxy.For<IMessagingProvider>(m => m.Name switch
        {
            "get_ProviderType" => ProviderType.AzureServiceBus,
            "get_CurrentTarget" => broker.Target,
            "get_IsConnected" => true,
            "get_Capabilities" => capabilities,
            "DisconnectAsync" => Task.CompletedTask,
            "DisposeAsync" => ValueTask.CompletedTask,
            nameof(IMessagingProvider.GetQueuesAsync) => Task.FromResult<IEnumerable<IQueueEntity>>(
                [new QueueInfo { Name = "orders", Status = "Active", ActiveMessageCount = 3, DeadLetterMessageCount = 2 }]),
            nameof(IMessagingProvider.GetTopicsAsync) => Task.FromResult<IEnumerable<ITopicEntity>>(
                [new TopicInfo { Name = "events", Status = "Active", SubscriptionCount = 1 }]),
            nameof(IMessagingProvider.GetSubscriptionsAsync) => Task.FromResult<IEnumerable<SubscriptionInfo>>(
                [new SubscriptionInfo { TopicName = "events", Name = "audit", ActiveMessageCount = 5 }]),
            nameof(IMessagingProvider.GetRulesAsync) => Task.FromResult<IReadOnlyList<SubscriptionRuleInfo>>(
                [new SubscriptionRuleInfo { Name = "$Default", SqlExpression = "1=1" }]),
            nameof(IMessagingProvider.PeekMessagesAsync) => Peek(broker),
            _ => throw new NotSupportedException(m.Name)
        });
        return StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.CreateConnectedProviderAsync)
            ? Task.FromResult(provider)
            : throw new NotSupportedException(m.Name));
    }

    private static Task<IEnumerable<IMessage>> Peek(Broker broker)
    {
        broker.Peeks++;
        return broker.PeekFailure is { } failure
            ? Task.FromException<IEnumerable<IMessage>>(failure)
            : Task.FromResult<IEnumerable<IMessage>>(broker.Messages);
    }

    private sealed class Host : IAsyncDisposable
    {
        private readonly ApiFactory _base;

        public Host(Broker broker)
        {
            _base = new ApiFactory();
            Factory = _base.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(FactoryFor(broker))));
            Keyed = Factory.CreateClient();
            Keyed.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
            Anonymous = Factory.CreateClient();
        }

        public WebApplicationFactory<Program> Factory { get; }
        public HttpClient Keyed { get; }
        public HttpClient Anonymous { get; }
        public string Token { get; private set; } = "";

        public async Task StartAsync()
        {
            using (var enabled = await Keyed.PutAsJsonAsync("/api/mcp/enabled", new { enabled = true })) Assert.Equal(HttpStatusCode.OK, enabled.StatusCode);
            using var created = await Keyed.PostAsync("/api/mcp/token", null);
            using var doc = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
            Token = doc.RootElement.GetProperty("token").GetString()!;
        }

        public Task SeedAsync(ServiceBusConnection connection) =>
            Factory.Services.GetRequiredService<IConnectionManager>().SaveConnectionAsync(connection);

        public async Task OfferAsync(string id)
        {
            using var offered = await Keyed.PutAsJsonAsync($"/api/mcp/connections/{id}", new { level = "read" });
            Assert.Equal(HttpStatusCode.OK, offered.StatusCode);
        }

        public async Task ConnectAsync(string id)
        {
            using var connected = await Keyed.PostAsync($"/api/connections/{id}/connect", null);
            Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
        }

        /// <summary>Calls a tool; a refusal is answered without the prefix the SDK puts before the sentence of the tool.</summary>
        public async Task<(bool IsError, string Text)> CallAsync(string tool, object? arguments = null)
        {
            var body = JsonSerializer.Serialize(new
            {
                jsonrpc = "2.0",
                id = 7,
                method = "tools/call",
                @params = new { name = tool, arguments = arguments ?? new { } }
            });
            using var response = await Anonymous.SendAsync(McpRequest(body, bearer: "Bearer " + Token));
            var raw = await response.Content.ReadAsStringAsync();
            Assert.True(response.StatusCode == HttpStatusCode.OK, $"tools/call {tool} answered {(int)response.StatusCode}: {raw}");
            using var doc = JsonDocument.Parse(JsonRpcPayload(raw));
            var result = doc.RootElement.GetProperty("result");
            var text = string.Concat(result.GetProperty("content").EnumerateArray().Select(c => c.GetProperty("text").GetString()));
            var failed = result.TryGetProperty("isError", out var isError) && isError.GetBoolean();
            var prefix = $"An error occurred invoking '{tool}': ";
            Assert.True(!failed || text.StartsWith(prefix, StringComparison.Ordinal), $"the SDK answers a refusal after its own prefix; {tool} answered {text}");
            return (failed, failed ? text[prefix.Length..] : text);
        }

        public async Task<JsonElement> ActivityAsync()
        {
            using var doc = JsonDocument.Parse(await Keyed.GetStringAsync("/api/mcp/activity"));
            return doc.RootElement.Clone();
        }

        public async ValueTask DisposeAsync()
        {
            using (await Keyed.PostAsync("/api/connections/disconnect", null)) { }
            Keyed.Dispose();
            Anonymous.Dispose();
            await Factory.DisposeAsync();
            await _base.DisposeAsync();
        }
    }

    /// <summary>The JSON-RPC message of an answer, whether it came as JSON or as a server-sent event.</summary>
    internal static string JsonRpcPayload(string raw) => raw.TrimStart().StartsWith('{')
        ? raw
        : raw.Split('\n').Where(l => l.StartsWith("data:", StringComparison.Ordinal)).Select(l => l["data:".Length..].Trim()).Last();

    private static ServiceBusConnection Offered(string id = "c-offered") => new()
    {
        Id = id,
        Name = "offered-name",
        ConnectionString = $"Endpoint=sb://offered.example/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey={Sentinel}",
    };

    private static ServiceBusConnection Hidden() => new()
    {
        Id = "c-hidden",
        Name = HiddenName,
        ProviderType = ProviderType.RabbitMQ,
        HostName = HiddenTarget,
        UserName = "guest",
        Password = Sentinel,
    };

    private static void AssertNoSecret(string answer, string token, string what)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        foreach (var secret in new[] { Sentinel, ApiFactory.TestApiSecret, token, Convert.ToHexString(hash), Convert.ToBase64String(hash) })
            Assert.False(answer.Contains(secret, StringComparison.OrdinalIgnoreCase), $"no tool answer carries an unmasked secret, the token or its hash: {what} answered {answer}");
    }

    [Fact]
    public async Task List_connections_answers_only_the_offered_connections_with_no_secret()
    {
        await using var host = new Host(new Broker());
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.SeedAsync(Hidden());
        await host.SeedAsync(new ServiceBusConnection
        {
            Id = "c-principal", Name = "principal-name", AuthType = ServiceBusExplorer.Core.Providers.Azure.AzureAuthType.ServicePrincipal,
            FullyQualifiedNamespace = "principal.example", TenantId = "tenant", ServicePrincipalClientId = "client", ClientSecret = Sentinel,
        });
        await host.OfferAsync("c-offered");
        await host.OfferAsync("c-principal");
        await host.ConnectAsync("c-offered");

        var (isError, text) = await host.CallAsync("list_connections");

        Assert.False(isError, text);
        using var doc = JsonDocument.Parse(text);
        var listed = doc.RootElement.EnumerateArray().ToDictionary(c => c.GetProperty("id").GetString()!);
        Assert.True(listed.Keys.Order().SequenceEqual(["c-offered", "c-principal"]), $"offers an assistant only the connections the user chose: list_connections answered {text}");
        Assert.Equal(("offered-name", "AzureServiceBus", "offered.example", "read", true),
            (listed["c-offered"].GetProperty("name").GetString(), listed["c-offered"].GetProperty("providerType").GetString(),
             listed["c-offered"].GetProperty("target").GetString(), listed["c-offered"].GetProperty("level").GetString(),
             listed["c-offered"].GetProperty("active").GetBoolean()));
        Assert.False(listed["c-principal"].GetProperty("active").GetBoolean(), "only the connection active in the app is marked active");
        Assert.DoesNotContain(HiddenName, text);
        Assert.DoesNotContain(HiddenTarget, text);
        AssertNoSecret(text, host.Token, "list_connections");
    }

    [Fact]
    public async Task A_tool_on_an_active_connection_that_is_not_offered_is_refused_and_names_nothing()
    {
        var broker = new Broker { Target = HiddenTarget };
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.SeedAsync(Hidden());
        await host.OfferAsync("c-offered");

        var (beforeConnectError, beforeConnect) = await host.CallAsync("list_queues");
        await host.ConnectAsync("c-hidden");
        var answers = new List<(bool IsError, string Text)>();
        foreach (var (tool, arguments) in new (string, object?)[]
        {
            ("list_queues", null), ("list_topics", null), ("list_subscriptions", new { topic = "events" }),
            ("list_rules", new { topic = "events", subscription = "audit" }), ("peek_messages", new { entity = "orders" }),
        })
        {
            answers.Add(await host.CallAsync(tool, arguments));
        }

        Assert.True(beforeConnectError && beforeConnect == McpReadTools.NotOffered, $"with nothing active a tool is refused with the fixed sentence; it answered {beforeConnect}");
        foreach (var (isError, text) in answers)
        {
            Assert.True(isError && text == McpReadTools.NotOffered,
                $"offers an assistant only the connections the user chose: a tool on an active connection that is not offered must be refused with the fixed sentence; it answered {text}");
        }
        Assert.Equal(0, broker.Peeks);
        var activity = await host.ActivityAsync();
        Assert.True(activity.GetArrayLength() == 6, $"every tool call, refused or not, is recorded; the record held {activity.GetArrayLength()} lines for 6 calls");
        Assert.All(activity.EnumerateArray(), a => Assert.Equal(("This app", "Refused: not offered", "error"),
            (a.GetProperty("where").GetString(), a.GetProperty("outcome").GetString(), a.GetProperty("kind").GetString())));
        Assert.DoesNotContain(HiddenName, activity.GetRawText());
        Assert.DoesNotContain(HiddenTarget, activity.GetRawText());
    }

    [Fact]
    public async Task An_offered_connection_whose_environment_became_production_is_refused()
    {
        await using var host = new Host(new Broker());
        await host.StartAsync();
        var groups = host.Factory.Services.GetRequiredService<IConnectionGroupManager>();
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "env-1", Name = "staging", Type = "environment" });
        var connection = Offered();
        connection.EnvironmentId = "env-1";
        await host.SeedAsync(connection);
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");
        await groups.SaveGroupAsync(new ConnectionGroup { Id = "env-1", Name = "staging", Type = "environment", IsProduction = true });

        var (isError, text) = await host.CallAsync("list_queues");

        Assert.True(isError && text == McpReadTools.NotOffered, $"this phase never reads a production connection; list_queues answered {text}");
    }

    [Fact]
    public async Task Reading_tools_answer_what_the_provider_lists_and_peeks_with_bodies_cut_at_8000_characters()
    {
        var longBody = BodyMarker + new string('x', 9000);
        var broker = new Broker
        {
            Messages =
            [
                new MessageInfo { MessageId = "m1", SequenceNumber = 41, Body = longBody },
                new MessageInfo { MessageId = "m2", SequenceNumber = 42, Body = "short " + BodyMarker },
            ],
        };
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        var queues = await host.CallAsync("list_queues");
        var topics = await host.CallAsync("list_topics");
        var subscriptions = await host.CallAsync("list_subscriptions", new { topic = "events" });
        var rules = await host.CallAsync("list_rules", new { topic = "events", subscription = "audit" });
        var peeked = await host.CallAsync("peek_messages", new { entity = "orders", subQueue = "deadLetter", count = 20 });

        Assert.False(queues.IsError || topics.IsError || subscriptions.IsError || rules.IsError || peeked.IsError, $"{queues.Text} {topics.Text} {subscriptions.Text} {rules.Text} {peeked.Text}");
        using (var doc = JsonDocument.Parse(queues.Text))
        {
            var queue = Assert.Single(doc.RootElement.EnumerateArray());
            Assert.Equal(("orders", 3L, 2L), (queue.GetProperty("name").GetString(), queue.GetProperty("activeMessageCount").GetInt64(), queue.GetProperty("deadLetterMessageCount").GetInt64()));
        }
        using (var doc = JsonDocument.Parse(topics.Text)) Assert.Equal("events", Assert.Single(doc.RootElement.EnumerateArray()).GetProperty("name").GetString());
        using (var doc = JsonDocument.Parse(subscriptions.Text))
        {
            var subscription = Assert.Single(doc.RootElement.EnumerateArray());
            Assert.Equal(("audit", 5L), (subscription.GetProperty("name").GetString(), subscription.GetProperty("activeMessageCount").GetInt64()));
        }
        using (var doc = JsonDocument.Parse(rules.Text)) Assert.Equal("1=1", Assert.Single(doc.RootElement.EnumerateArray()).GetProperty("sqlExpression").GetString());
        using (var doc = JsonDocument.Parse(peeked.Text))
        {
            var messages = doc.RootElement.EnumerateArray().ToList();
            Assert.Equal(2, messages.Count);
            Assert.True(messages[0].GetProperty("body").GetString() == longBody[..8000] && messages[0].GetProperty("bodyTruncated").GetBoolean(),
                "a body longer than 8000 characters is answered cut at 8000 and marked bodyTruncated");
            Assert.Equal((41L, "m1"), (messages[0].GetProperty("sequenceNumber").GetInt64(), messages[0].GetProperty("messageId").GetString()));
            Assert.True(messages[1].GetProperty("body").GetString() == "short " + BodyMarker && !messages[1].GetProperty("bodyTruncated").GetBoolean(),
                "a short body is answered whole and not marked truncated");
        }
        AssertNoSecret(queues.Text + topics.Text + subscriptions.Text + rules.Text + peeked.Text, host.Token, "the reading tools");
    }

    [Fact]
    public async Task A_capability_the_provider_does_not_declare_is_refused_with_a_fixed_sentence_and_not_attempted()
    {
        var broker = new Broker { SupportsRules = false, SupportsTransferDeadLetter = false };
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        var rules = await host.CallAsync("list_rules", new { topic = "events", subscription = "audit" });
        var transfer = await host.CallAsync("peek_messages", new { entity = "orders", subQueue = "transferDeadLetter" });
        var unknown = await host.CallAsync("peek_messages", new { entity = "orders", subQueue = "scheduled" });

        Assert.Equal((true, "This provider does not support subscription rules."), rules);
        Assert.Equal((true, "This provider does not support the transfer dead-letter queue."), transfer);
        Assert.Equal((true, "subQueue must be active, deadLetter or transferDeadLetter."), unknown);
        Assert.True(broker.Peeks == 0, "a capability the provider does not declare is refused, not attempted");
    }

    [Theory]
    [InlineData("broker")]
    [InlineData("timeout")]
    public async Task A_peek_the_broker_fails_answers_the_fixed_sentence_and_records_the_failure(string failure)
    {
        var broker = new Broker
        {
            PeekFailure = failure == "timeout"
                ? new TimeoutException(Sentinel)
                : new Azure.Messaging.ServiceBus.ServiceBusException(Sentinel, Azure.Messaging.ServiceBus.ServiceBusFailureReason.ServiceCommunicationProblem),
        };
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        var (isError, text) = await host.CallAsync("peek_messages", new { entity = "orders" });

        Assert.True(isError && text == "An internal error occurred.", $"a broker failure is answered with the fixed sentence, never the broker's text; it answered {text}");
        var line = Assert.Single((await host.ActivityAsync()).EnumerateArray());
        Assert.Equal(("Peek 10 messages", "orders (active) on offered-name", "Failed", "error"),
            (line.GetProperty("asked").GetString(), line.GetProperty("where").GetString(), line.GetProperty("outcome").GetString(), line.GetProperty("kind").GetString()));
        Assert.DoesNotContain("SENTINEL", line.GetRawText());
    }

    [Fact]
    public async Task Read_logs_answers_the_lines_of_the_store_newest_first_only_when_the_user_allowed_it()
    {
        await using var host = new Host(new Broker());
        await host.StartAsync();
        var store = host.Factory.Services.GetRequiredService<RecentLogStore>();
        store.Clear();
        store.Add(LogLevel.Information, "Test", "first line");
        store.Add(LogLevel.Warning, "Test", "second line");
        store.Add(LogLevel.Error, "Test", "third line");

        var refused = await host.CallAsync("read_logs");
        using (var allowed = await host.Keyed.PutAsJsonAsync("/api/mcp/logs", new { allowed = true })) Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        var all = await host.CallAsync("read_logs", new { contains = "LINE" });
        var warnings = await host.CallAsync("read_logs", new { level = "Warning", contains = "line", limit = 1 });

        Assert.True(refused.IsError && refused.Text == McpReadTools.LogsRefused, $"the logs are read only when the user allowed it; read_logs answered {refused.Text}");
        Assert.False(all.IsError, all.Text);
        using (var doc = JsonDocument.Parse(all.Text))
            Assert.Equal(["third line", "second line", "first line"], doc.RootElement.EnumerateArray().Select(l => l.GetProperty("text").GetString()));
        using (var doc = JsonDocument.Parse(warnings.Text))
            Assert.Equal(["third line"], doc.RootElement.EnumerateArray().Select(l => l.GetProperty("text").GetString()));
        var activity = (await host.ActivityAsync()).EnumerateArray().ToList();
        Assert.Equal(("Read 50 log lines", "This app", "Refused: logs not allowed", "error"),
            (activity[^1].GetProperty("asked").GetString(), activity[^1].GetProperty("where").GetString(), activity[^1].GetProperty("outcome").GetString(), activity[^1].GetProperty("kind").GetString()));
    }

    [Fact]
    public async Task Every_tool_call_is_recorded_newest_first_without_a_body_or_a_secret()
    {
        var broker = new Broker { Messages = [new MessageInfo { MessageId = "m1", SequenceNumber = 1, Body = BodyMarker + Sentinel }] };
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        await host.CallAsync("list_queues");
        await host.CallAsync("peek_messages", new { entity = "events", subscription = "audit", count = 500 });

        var activity = await host.ActivityAsync();
        var lines = activity.EnumerateArray().ToList();
        Assert.Equal(2, lines.Count);
        Assert.Equal(("Peek 50 messages", "events/audit (active) on offered-name", "1 read", "ok"),
            (lines[0].GetProperty("asked").GetString(), lines[0].GetProperty("where").GetString(), lines[0].GetProperty("outcome").GetString(), lines[0].GetProperty("kind").GetString()));
        Assert.Equal(("List queues", "offered-name", "1 listed", "ok"),
            (lines[1].GetProperty("asked").GetString(), lines[1].GetProperty("where").GetString(), lines[1].GetProperty("outcome").GetString(), lines[1].GetProperty("kind").GetString()));
        Assert.All(lines, l => Assert.Equal("Assistant", l.GetProperty("assistant").GetString()));
        Assert.All(lines, l => Assert.True(l.GetProperty("time").GetDateTimeOffset() > DateTimeOffset.UtcNow.AddMinutes(-5), "every line carries the time of the call"));
        Assert.False(activity.GetRawText().Contains(BodyMarker, StringComparison.Ordinal), "every tool call is recorded without a message body");
        AssertNoSecret(activity.GetRawText(), host.Token, "the activity record");
    }

    [Fact]
    public async Task A_deleted_connection_is_no_longer_offered()
    {
        await using var host = new Host(new Broker());
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.SeedAsync(Offered("c-cleared"));
        await host.OfferAsync("c-offered");
        await host.OfferAsync("c-cleared");

        using (var deleted = await host.Keyed.DeleteAsync("/api/connections/c-offered")) Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        using var state = JsonDocument.Parse(await host.Keyed.GetStringAsync("/api/mcp"));
        await host.SeedAsync(Offered());
        var (_, listed) = await host.CallAsync("list_connections");
        using (var cleared = await host.Keyed.DeleteAsync("/api/connections/clear-all")) Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        using var afterClear = JsonDocument.Parse(await host.Keyed.GetStringAsync("/api/mcp"));

        var offered = state.RootElement.GetProperty("connections").EnumerateArray().Select(c => c.GetProperty("connectionId").GetString()).ToList();
        Assert.True(offered.SequenceEqual(["c-cleared"]), $"a deleted connection is no longer offered; the state offered {string.Join(", ", offered)}");
        using (var doc = JsonDocument.Parse(listed))
            Assert.True(doc.RootElement.EnumerateArray().Select(c => c.GetProperty("id").GetString()).SequenceEqual(["c-cleared"]),
                $"a deleted connection is no longer offered, even when a connection with its id comes back; list_connections answered {listed}");
        Assert.True(afterClear.RootElement.GetProperty("connections").GetArrayLength() == 0, "clearing all data leaves nothing offered");
    }
}
