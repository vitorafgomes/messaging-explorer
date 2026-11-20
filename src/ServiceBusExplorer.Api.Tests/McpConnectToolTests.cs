using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.McpToolTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// connect_to makes an offered connection the active one only after the user allows it in the app, whatever the
/// never-asked mark and whether a connection is active; it names only offered connections, answers at once for the one
/// already active, checks the offer again after the allow, and leaves the active connection as it was when denied,
/// unanswered, cancelled or failed.
/// </summary>
public class McpConnectToolTests
{
    private const string Reason = "check the orders queue of the local broker";

    private static ServiceBusConnection LocalBroker() => new()
    {
        Id = "c-local",
        Name = "local-name",
        ProviderType = ProviderType.RabbitMQ,
        HostName = "localhost",
        UserName = "guest",
        Password = Sentinel,
    };

    private static ServiceBusConnection Unoffered() => new()
    {
        Id = "c-unoffered",
        Name = "unoffered-name",
        ProviderType = ProviderType.RabbitMQ,
        HostName = "unoffered-host.example",
        UserName = "guest",
        Password = Sentinel,
    };

    /// <summary>
    /// The host with c-offered (Azure) and c-local (a local broker marked never asked) both offered; <paramref name="active"/>
    /// is connected through the route first, none when null.
    /// </summary>
    private static async Task<Host> StartAsync(Broker broker, string? active = "c-offered", TimeSpan? wait = null)
    {
        var host = new Host(broker, wait);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered", "read");
        await host.SeedAsync(LocalBroker());
        await host.OfferAsync("c-local", "read", neverAsk: true);
        if (active is not null) await host.ConnectAsync(active);
        return host;
    }

    private static async Task<string?> ActiveIdAsync(Host host)
    {
        using var doc = JsonDocument.Parse(await host.Keyed.GetStringAsync("/api/connections/status"));
        return doc.RootElement.TryGetProperty("connectionId", out var id) ? id.GetString() : null;
    }

    private static (string Asked, string Where, string Outcome, string Kind) Line(JsonElement line) =>
        (line.GetProperty("asked").GetString()!, line.GetProperty("where").GetString()!, line.GetProperty("outcome").GetString()!, line.GetProperty("kind").GetString()!);

    private static List<(string, string)> Facts(JsonElement request) =>
        request.GetProperty("facts").EnumerateArray().Select(f => (f.GetProperty("label").GetString()!, f.GetProperty("value").GetString()!)).ToList();

    [Fact]
    public async Task Connect_to_asks_even_a_never_asked_broker_and_an_allow_makes_it_active()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("connect_to", new { connection = "local-name", reason = Reason });
        var waiting = await host.WaitForRequestsAsync();
        var connectsWhileWaiting = broker.Connects.ToList();
        var activeWhileWaiting = await ActiveIdAsync(host);
        var request = await host.AnswerOnlyRequestAsync(allow: true);
        var (isError, text) = await call;

        Assert.True(waiting.GetArrayLength() == 1 && connectsWhileWaiting.SequenceEqual(["c-offered"]) && activeWhileWaiting == "c-offered",
            $"changing the active connection through a tool is itself an operation the user is asked about, also on a broker marked never asked: while the request waited the connects were [{string.Join(", ", connectsWhileWaiting)}] and the active connection {activeWhileWaiting}");
        Assert.Equal("connect", request.GetProperty("kind").GetString());
        Assert.False(isError, text);
        using (var doc = JsonDocument.Parse(text))
            Assert.Equal((true, "local-name", "AzureServiceBus", 3),
                (doc.RootElement.GetProperty("connected").GetBoolean(), doc.RootElement.GetProperty("connection").GetString(), doc.RootElement.GetProperty("providerType").GetString(), doc.RootElement.EnumerateObject().Count()));
        AssertNoSecret(text, host.Token, "connect_to");
        Assert.True(await ActiveIdAsync(host) == "c-local", "once the user allowed it, the named connection is the active one");
        Assert.True(broker.Connects.SequenceEqual(["c-offered", "c-local"]) && broker.Disposed.SequenceEqual(["c-offered"]),
            $"the allowed connect connects once and disposes the provider of the connection active before; connects [{string.Join(", ", broker.Connects)}], disposed [{string.Join(", ", broker.Disposed)}]");
        Assert.Equal(("Connect to local-name", "This app", "Connected, allowed by you", "ok"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task With_no_connection_active_connect_to_still_asks_and_says_so()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, active: null);

        var call = host.CallAsync("connect_to", new { connection = "c-offered", reason = Reason });
        var request = await host.AnswerOnlyRequestAsync(allow: true);
        var (isError, text) = await call;

        Assert.Equal([("From", "No connection is active"), ("To", "offered-name"), ("It said why", Reason)], Facts(request));
        Assert.Equal(("Assistant asks to connect to offered-name", "Every screen of the app then shows offered-name.", "Connect to offered-name"),
            (request.GetProperty("title").GetString(), request.GetProperty("note").GetString(), request.GetProperty("allowLabel").GetString()));
        Assert.False(isError, text);
        Assert.True(await ActiveIdAsync(host) == "c-offered", "with none active, the allowed connection becomes the active one");
        Assert.Empty(broker.Disposed);
    }

    [Theory]
    [InlineData("denied")]
    [InlineData("no answer")]
    [InlineData("cancelled")]
    public async Task A_connect_denied_unanswered_or_cancelled_changes_nothing(string ending)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, wait: ending == "no answer" ? TimeSpan.FromMilliseconds(300) : null);
        using var cancel = new CancellationTokenSource();

        var call = host.CallAsync("connect_to", new { connection = "c-local", reason = Reason }, cancel.Token);
        if (ending == "denied")
        {
            await host.AnswerOnlyRequestAsync(allow: false);
            Assert.Equal((true, McpToolCalls.DeniedSentence), await call);
        }
        else if (ending == "no answer")
        {
            Assert.Equal((true, McpToolCalls.NoAnswerSentence), await call.WaitAsync(TimeSpan.FromSeconds(10)));
        }
        else
        {
            await host.WaitForRequestsAsync();
            await cancel.CancelAsync();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
        }

        var outcome = ending switch { "denied" => "Denied by you", "no answer" => "Denied: no answer in two minutes", _ => "Cancelled" };
        Assert.True(await ActiveIdAsync(host) == "c-offered" && broker.Connects.SequenceEqual(["c-offered"]) && broker.Disposed.Count == 0,
            $"a connect {ending} changes nothing: the active connection was {await ActiveIdAsync(host)}, connects [{string.Join(", ", broker.Connects)}], disposed [{string.Join(", ", broker.Disposed)}]");
        var until = DateTime.UtcNow.AddSeconds(5);
        while ((await host.ActivityAsync()).GetArrayLength() == 0 && DateTime.UtcNow < until) await Task.Delay(20);
        Assert.Equal(("Connect to local-name", "This app", outcome, "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task The_request_says_from_which_connection_to_which_and_why_in_fixed_words_with_the_production_prefix()
    {
        var broker = new Broker();
        var groups = new[]
        {
            new ConnectionGroup { Id = "client-1", Name = "Contoso", Type = "client" },
            new ConnectionGroup { Id = "env-1", Name = "staging", Type = "environment" },
            new ConnectionGroup { Id = "env-prod", Name = "prod", Type = "environment", IsProduction = true },
        };
        await using var host = await StartAsync(broker);
        foreach (var group in groups) await host.Factory.Services.GetRequiredService<IConnectionGroupManager>().SaveGroupAsync(group);
        var active = Offered();
        (active.ClientId, active.EnvironmentId) = ("client-1", "env-1");
        await host.SeedAsync(active);
        var target = LocalBroker();
        (target.Name, target.ClientId, target.EnvironmentId) = ("prod-name", "client-1", "env-prod");
        await host.SeedAsync(target);

        var call = host.CallAsync("connect_to", new { connection = "prod-name", reason = "line one\nline\u0007two " + new string('r', 300) });
        var request = await host.AnswerOnlyRequestAsync(allow: false);
        await call;

        Assert.Equal([("From", "offered-name (Contoso, staging)"), ("To", "prod-name (Contoso, prod)"), ("It said why", ("line onelinetwo " + new string('r', 300))[..200])], Facts(request));
        Assert.Equal(("connect", "Assistant asks to connect to prod-name", "Connect to prod-name"),
            (request.GetProperty("kind").GetString(), request.GetProperty("title").GetString(), request.GetProperty("allowLabel").GetString()));
        Assert.True(request.GetProperty("note").GetString() == "This is a production connection. The app disconnects from offered-name. Every screen then shows prod-name, and anything running on offered-name is interrupted.",
            $"the request says what the switch interrupts, after the production prefix when the target is production; it said {request.GetProperty("note").GetString()}");
        AssertNoSecret(request.GetRawText(), host.Token, "a connect request");
    }

    [Fact]
    public async Task An_active_connection_that_is_not_offered_is_never_named_by_the_request_the_answer_or_the_record()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, active: null);
        await host.SeedAsync(Unoffered());
        await host.ConnectAsync("c-unoffered");

        var call = host.CallAsync("connect_to", new { connection = "c-local", reason = Reason });
        var request = await host.AnswerOnlyRequestAsync(allow: true);
        var (_, text) = await call;
        var activity = (await host.ActivityAsync()).GetRawText();

        Assert.Equal(("From", McpConnectTools.UnofferedActive), Facts(request)[0]);
        Assert.Equal("The app disconnects from a connection not offered to assistants. Every screen then shows local-name, and anything running on a connection not offered to assistants is interrupted.",
            request.GetProperty("note").GetString());
        foreach (var (what, said) in new[] { ("the request", request.GetRawText()), ("the answer", text), ("the record", activity) })
            Assert.True(!said.Contains("unoffered-name", StringComparison.Ordinal) && !said.Contains("unoffered-host", StringComparison.Ordinal) && !said.Contains("c-unoffered", StringComparison.Ordinal),
                $"nothing of a connection that is not offered is answered: {what} said {said}");
        Assert.Equal("c-local", await ActiveIdAsync(host));
    }

    [Fact]
    public async Task Only_an_offered_connection_can_be_named_by_id_or_exact_name_and_an_ambiguous_name_is_refused_without_asking()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);
        await host.SeedAsync(Unoffered());
        var twin = Offered("c-twin");
        await host.SeedAsync(twin);
        await host.OfferAsync("c-twin", "read");

        var byHiddenId = await host.CallUnaskedAsync("connect_to", new { connection = "c-unoffered", reason = Reason }, "a connection not offered is refused without asking");
        var byHiddenName = await host.CallUnaskedAsync("connect_to", new { connection = "unoffered-name", reason = Reason }, "a connection not offered is refused without asking");
        var notExact = await host.CallUnaskedAsync("connect_to", new { connection = "LOCAL-NAME", reason = Reason }, "a name that is not exact is refused without asking");
        var ambiguous = await host.CallUnaskedAsync("connect_to", new { connection = "offered-name", reason = Reason }, "an ambiguous name is refused without asking");

        Assert.True(byHiddenId == (true, McpConnectTools.NotOffered) && byHiddenName == (true, McpConnectTools.NotOffered) && notExact == (true, McpConnectTools.NotOffered),
            $"only an offered connection can be named, by id or exact name; the answers were {byHiddenId}, {byHiddenName}, {notExact}");
        Assert.True(ambiguous == (true, McpConnectTools.Ambiguous), $"a name that matches more than one offered connection is refused; it answered {ambiguous}");
        Assert.True(broker.Connects.SequenceEqual(["c-offered"]) && await ActiveIdAsync(host) == "c-offered", "a refused connect connects nothing");
        var lines = (await host.ActivityAsync()).EnumerateArray().Select(Line).ToList();
        Assert.Equal([
            ("Connect to a connection", "This app", "Refused: more than one with that name", "error"),
            ("Connect to a connection", "This app", "Refused: not offered", "error"),
            ("Connect to a connection", "This app", "Refused: not offered", "error"),
            ("Connect to a connection", "This app", "Refused: not offered", "error"),
        ], lines);
    }

    [Fact]
    public async Task The_connection_already_active_is_answered_at_once_without_asking()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker, active: "c-local");

        var (isError, text) = await host.CallUnaskedAsync("connect_to", new { connection = "local-name", reason = Reason }, "the connection already active is answered without asking");

        Assert.False(isError, text);
        using (var doc = JsonDocument.Parse(text))
            Assert.Equal((true, "local-name", true),
                (doc.RootElement.GetProperty("connected").GetBoolean(), doc.RootElement.GetProperty("connection").GetString(), doc.RootElement.GetProperty("alreadyActive").GetBoolean()));
        Assert.True(broker.Connects.SequenceEqual(["c-local"]) && broker.Disposed.Count == 0, "the connection already active is not connected again");
        Assert.Equal(("Connect to local-name", "This app", "Already active", "plain"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task A_connect_allowed_after_the_offer_was_withdrawn_is_refused_and_connects_nothing()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("connect_to", new { connection = "c-local", reason = Reason });
        await host.WaitForRequestsAsync();
        using (var withdrawn = await host.Keyed.DeleteAsync("/api/mcp/connections/c-local"))
            Assert.True(withdrawn.IsSuccessStatusCode, $"withdrawing the offer answered {(int)withdrawn.StatusCode}");
        await host.AnswerOnlyRequestAsync(allow: true);
        var answer = await call;

        Assert.True(answer == (true, McpConnectTools.NotOffered), $"an allow is checked again before connecting: a connection no longer offered is refused; it answered {answer}");
        Assert.True(broker.Connects.SequenceEqual(["c-offered"]) && await ActiveIdAsync(host) == "c-offered", "nothing is connected after the offer was withdrawn");
        Assert.Equal(("Connect to local-name", "This app", "Refused: not offered", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task A_connect_allowed_after_the_stored_connection_was_removed_under_its_offer_is_refused_and_connects_nothing()
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);

        var call = host.CallAsync("connect_to", new { connection = "c-local", reason = Reason });
        await host.WaitForRequestsAsync();
        await host.Factory.Services.GetRequiredService<IConnectionManager>().DeleteConnectionAsync("c-local");
        await host.AnswerOnlyRequestAsync(allow: true);
        var answer = await call;

        Assert.True(answer == (true, McpConnectTools.NotOffered), $"a connection that no longer exists is refused after the allow, even while its offer is still on record; it answered {answer}");
        Assert.True(broker.Connects.SequenceEqual(["c-offered"]) && await ActiveIdAsync(host) == "c-offered", "nothing is connected when the stored connection is gone");
    }

    [Theory]
    [InlineData("broker", "An internal error occurred.")]
    [InlineData("timeout", "The broker did not answer in time.")]
    [InlineData("refused", "The broker refused the connection on its port.")]
    public async Task A_connect_that_fails_answers_the_fixed_sentence_of_the_route_and_leaves_the_active_connection_as_it_was(string failure, string sentence)
    {
        var broker = new Broker();
        await using var host = await StartAsync(broker);
        broker.ConnectFailure = failure switch
        {
            "timeout" => new TimeoutException(Sentinel),
            "refused" => new IOException(Sentinel, new SocketException((int)SocketError.ConnectionRefused)),
            _ => new Azure.Messaging.ServiceBus.ServiceBusException(Sentinel, Azure.Messaging.ServiceBus.ServiceBusFailureReason.ServiceCommunicationProblem),
        };

        var call = host.CallAsync("connect_to", new { connection = "c-local", reason = Reason });
        await host.AnswerOnlyRequestAsync(allow: true);
        var answer = await call;

        Assert.True(answer == (true, sentence), $"a connect that fails ({failure}) answers the route's fixed sentence, never the exception text; it answered {answer}");
        Assert.True(await ActiveIdAsync(host) == "c-offered" && broker.Disposed.Count == 0,
            $"a failed connect leaves the connection active before as it was; active {await ActiveIdAsync(host)}, disposed [{string.Join(", ", broker.Disposed)}]");
        Assert.Equal(("Connect to local-name", "This app", "Failed, allowed by you", "error"), Line(Assert.Single((await host.ActivityAsync()).EnumerateArray())));
    }

    [Fact]
    public async Task Connect_to_is_listed_as_neither_read_only_destructive_nor_idempotent()
    {
        await using var host = await StartAsync(new Broker());

        var annotations = (await host.ListedToolAsync("connect_to")).GetProperty("annotations");

        Assert.Equal((false, false, false),
            (annotations.GetProperty("readOnlyHint").GetBoolean(), annotations.GetProperty("destructiveHint").GetBoolean(), annotations.GetProperty("idempotentHint").GetBoolean()));
    }
}
