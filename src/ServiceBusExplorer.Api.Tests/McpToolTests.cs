using System.Net;
using System.Net.Http.Json;
using System.Reflection;
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
    internal const string Sentinel = "SENTINEL-SECRET-7f3a+/=";
    internal const string BodyMarker = "BODY-MARKER-4410";
    private const string HiddenName = "hidden-connection-name";
    private const string HiddenTarget = "hidden-broker-target";

    /// <summary>A stub whose answer sees the arguments of the call.</summary>
    public class ArgsProxy : DispatchProxy
    {
        private Func<MethodInfo, object?[], object?>? _handler;

        public static T For<T>(Func<MethodInfo, object?[], object?> handler) where T : class
        {
            var proxy = Create<T, ArgsProxy>();
            ((ArgsProxy)(object)proxy)._handler = handler;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => _handler!(targetMethod!, args ?? []);
    }

    /// <summary>What the stub provider answers, what it throws on a peek or a send, and what it was asked.</summary>
    internal sealed class Broker
    {
        public bool SupportsRules { get; init; } = true;
        public bool SupportsTransferDeadLetter { get; init; } = true;
        public bool SupportsTopics { get; init; } = true;
        public bool SupportsSubscriptions { get; init; } = true;
        public bool SupportsDeadLetterQueue { get; init; } = true;
        public bool SupportsPeekFromSequenceNumber { get; init; } = true;
        public bool SupportsMessageCounts { get; init; } = true;
        public bool SupportsScheduledMessages { get; init; } = true;
        public bool SupportsSessions { get; init; } = true;
        public bool SupportsSequenceNumbers { get; init; } = true;
        public bool SupportsManualDeadLetter { get; init; } = true;
        public bool SupportsBulkMessageOperations { get; init; } = true;
        public bool SupportsEntityUpdate { get; init; } = true;

        /// <summary>The create, update and delete calls of queues, topics, subscriptions and rules, in order.</summary>
        public List<AdminCall> AdminCalls { get; } = [];

        /// <summary>What every create, update and delete of an entity throws; null answers.</summary>
        public Exception? AdminFailure { get; init; }
        public HashSet<string> Subscriptions { get; init; } = ["events/audit"];

        /// <summary>What a batch call answers for its sequence numbers; null answers each one done.</summary>
        public Func<long[], BatchOperationResult>? BatchResult { get; init; }

        /// <summary>What every move, remove, purge and cancel call throws; null answers.</summary>
        public Exception? BatchFailure { get; init; }

        /// <summary>The move, remove, purge and cancel calls the provider was asked, in order.</summary>
        public List<BatchCall> BatchCalls { get; } = [];
        public HashSet<string> Queues { get; init; } = ["orders", "orders-retry"];

        /// <summary>The queues whose lookup answers RequiresSession true.</summary>
        public HashSet<string> SessionQueues { get; init; } = [];

        /// <summary>The status every listed queue, topic and subscription answers.</summary>
        public string ListedStatus { get; init; } = "Active";

        /// <summary>The rules list_rules is answered.</summary>
        public List<SubscriptionRuleInfo> Rules { get; init; } = [new SubscriptionRuleInfo { Name = "$Default", SqlExpression = "1=1" }];
        public HashSet<string> Topics { get; init; } = ["events"];
        public Exception? SendFailure { get; init; }
        public Exception? LookupFailure { get; init; }
        public bool FailTopicLookup { get; init; }
        public Exception? SubscriptionLookupFailure { get; init; }
        public Func<List<SendMessageRequest>, SendMessagesResult>? BatchAnswer { get; init; }
        public List<SendMessageRequest> Sent { get; } = [];
        public int SendCalls { get; set; }
        public int TopicLookups { get; set; }
        public ProviderType ProviderType { get; init; } = ProviderType.AzureServiceBus;
        public string Target { get; init; } = "offered-target";
        public List<IMessage> Messages { get; init; } = [];
        public Exception? PeekFailure { get; init; }
        public int Peeks { get; set; }
        public int TopicLists { get; set; }
        public int SubscriptionLists { get; set; }

        /// <summary>What the factory throws on the next connects; null connects.</summary>
        public Exception? ConnectFailure { get; set; }

        /// <summary>The ids of the connections the factory was asked to connect, in order.</summary>
        public List<string> Connects { get; } = [];

        /// <summary>The ids of the connections whose provider was disposed, in order.</summary>
        public List<string> Disposed { get; } = [];
    }

    /// <summary>A factory that connects a new stub provider for each connect, or throws <see cref="Broker.ConnectFailure"/>.</summary>
    internal static IProviderFactory FactoryFor(Broker broker) =>
        ArgsProxy.For<IProviderFactory>((m, args) =>
        {
            if (m.Name != nameof(IProviderFactory.CreateConnectedProviderAsync)) throw new NotSupportedException(m.Name);
            var id = ((ServiceBusConnection)args[0]!).Id;
            broker.Connects.Add(id);
            return broker.ConnectFailure is { } failure ? Task.FromException<IMessagingProvider>(failure) : Task.FromResult(ProviderFor(broker, id));
        });

    private static IMessagingProvider ProviderFor(Broker broker, string connectionId)
    {
        var capabilities = StubProxy.For<IProviderCapabilities>(m => m.Name switch
        {
            "get_SupportsSubscriptionRules" => broker.SupportsRules,
            "get_SupportsTransferDeadLetter" => broker.SupportsTransferDeadLetter,
            "get_SupportsTopics" => broker.SupportsTopics,
            "get_SupportsSubscriptions" => broker.SupportsSubscriptions,
            "get_SupportsDeadLetterQueue" => broker.SupportsDeadLetterQueue,
            "get_SupportsPeekFromSequenceNumber" => broker.SupportsPeekFromSequenceNumber,
            "get_SupportsMessageCounts" => broker.SupportsMessageCounts,
            "get_SupportsScheduledMessages" => broker.SupportsScheduledMessages,
            "get_SupportsSessions" => broker.SupportsSessions,
            "get_SupportsSequenceNumbers" => broker.SupportsSequenceNumbers,
            "get_SupportsManualDeadLetter" => broker.SupportsManualDeadLetter,
            "get_SupportsBulkMessageOperations" => broker.SupportsBulkMessageOperations,
            "get_SupportsEntityUpdate" => broker.SupportsEntityUpdate,
            "get_ProviderDisplayName" => "Stub",
            "get_ProviderVersion" => "1",
            _ when m.ReturnType == typeof(bool) => true,
            _ => throw new NotSupportedException(m.Name)
        });
        return ArgsProxy.For<IMessagingProvider>((m, args) => m.Name switch
        {
            "get_ProviderType" => broker.ProviderType,
            "get_CurrentTarget" => broker.Target,
            "get_IsConnected" => true,
            "get_Capabilities" => capabilities,
            "DisconnectAsync" => Task.CompletedTask,
            "DisposeAsync" => Counted(() => broker.Disposed.Add(connectionId), ValueTask.CompletedTask),
            nameof(IMessagingProvider.GetQueuesAsync) => Task.FromResult<IEnumerable<IQueueEntity>>(
                [new QueueInfo { Name = "orders", Status = broker.ListedStatus, ActiveMessageCount = 3, DeadLetterMessageCount = 2 }]),
            nameof(IMessagingProvider.GetTopicsAsync) => Counted(() => broker.TopicLists++, Task.FromResult<IEnumerable<ITopicEntity>>(
                [new TopicInfo { Name = "events", Status = broker.ListedStatus, SubscriptionCount = 1 }])),
            nameof(IMessagingProvider.GetSubscriptionsAsync) => Counted(() => broker.SubscriptionLists++, Task.FromResult<IEnumerable<SubscriptionInfo>>(
                [new SubscriptionInfo { TopicName = "events", Name = "audit", Status = broker.ListedStatus, ActiveMessageCount = 5 }])),
            nameof(IMessagingProvider.GetRulesAsync) => Task.FromResult<IReadOnlyList<SubscriptionRuleInfo>>(broker.Rules),
            nameof(IMessagingProvider.PeekMessagesAsync) => Peek(broker),
            nameof(IMessagingProvider.GetQueueAsync) => broker.LookupFailure is { } lookupFailed && !broker.FailTopicLookup ? Task.FromException<IQueueEntity?>(lookupFailed) : Task.FromResult<IQueueEntity?>(
                broker.Queues.Contains((string)args[0]!) ? new QueueInfo { Name = (string)args[0]!, Status = "Active", ActiveMessageCount = 3, DeadLetterMessageCount = 2, RequiresSession = broker.SessionQueues.Contains((string)args[0]!) } : null),
            nameof(IMessagingProvider.GetSubscriptionAsync) => broker.SubscriptionLookupFailure is { } subscriptionLookupFailed ? Task.FromException<SubscriptionInfo?>(subscriptionLookupFailed) : Task.FromResult<SubscriptionInfo?>(broker.Subscriptions.Contains($"{args[0]}/{args[1]}")
                ? new SubscriptionInfo { TopicName = (string)args[0]!, Name = (string)args[1]!, ActiveMessageCount = 5, DeadLetterMessageCount = 4 } : null),
            nameof(IMessagingProvider.PurgeMessagesAsync) => Batch(broker, new BatchCall(m.Name, (string)args[0]!, (string?)args[2], (MessageSubQueue)args[1]!, [], null, (CancellationToken)args[3]!)),
            nameof(IMessagingProvider.DeleteMessagesAsync) => Batch(broker, new BatchCall(m.Name, (string)args[0]!, (string?)args[3], (MessageSubQueue)args[2]!, (long[])args[1]!, null, (CancellationToken)args[5]!)),
            nameof(IMessagingProvider.ResubmitDeadLetterMessagesAsync) => Batch(broker, new BatchCall(m.Name, (string)args[0]!, (string?)args[3], (MessageSubQueue)args[2]!, (long[])args[1]!, null, (CancellationToken)args[5]!, (bool)args[4]!)),
            nameof(IMessagingProvider.MoveMessagesAsync) => Batch(broker, new BatchCall(m.Name, (string)args[0]!, (string?)args[4], (MessageSubQueue)args[3]!, (long[])args[2]!, (string)args[1]!, (CancellationToken)args[6]!)),
            nameof(IMessagingProvider.CancelScheduledMessagesAsync) => Batch(broker, new BatchCall(m.Name, (string)args[0]!, null, null, (long[])args[1]!, null, (CancellationToken)args[2]!)),
            nameof(IMessagingProvider.DeadLetterMessagesAsync) => Batch(broker, new BatchCall(m.Name, (string)args[0]!, (string?)args[2], MessageSubQueue.Active, (long[])args[1]!, $"{args[3]}|{args[4]}", (CancellationToken)args[5]!)),
            nameof(IMessagingProvider.GetTopicAsync) => broker.LookupFailure is { } topicLookupFailed && !broker.Queues.Contains((string)args[0]!) && broker.FailTopicLookup ? Task.FromException<ITopicEntity?>(topicLookupFailed) : Counted(() => broker.TopicLookups++, Task.FromResult<ITopicEntity?>(
                broker.Topics.Contains((string)args[0]!) ? new TopicInfo { Name = (string)args[0]!, Status = "Active", SubscriptionCount = broker.Subscriptions.Count(s => s.StartsWith($"{args[0]}/", StringComparison.Ordinal)) } : null)),
            nameof(IMessagingProvider.SendMessageAsync) => SendOne(broker, (SendMessageRequest)args[1]!),
            nameof(IMessagingProvider.SendMessagesAsync) => SendMany(broker, ((IEnumerable<SendMessageRequest>)args[1]!).ToList()),
            _ when AdminMethods.Contains(m.Name) => Admin(broker, m.Name, args),
            _ => throw new NotSupportedException(m.Name)
        });
    }

    private static readonly string[] AdminMethods =
    [
        nameof(IMessagingProvider.CreateQueueAsync), nameof(IMessagingProvider.UpdateQueueAsync), nameof(IMessagingProvider.DeleteQueueAsync),
        nameof(IMessagingProvider.CreateTopicAsync), nameof(IMessagingProvider.UpdateTopicAsync), nameof(IMessagingProvider.DeleteTopicAsync),
        nameof(IMessagingProvider.CreateSubscriptionAsync), nameof(IMessagingProvider.UpdateSubscriptionAsync), nameof(IMessagingProvider.DeleteSubscriptionAsync),
        nameof(IMessagingProvider.CreateRuleAsync), nameof(IMessagingProvider.UpdateRuleAsync), nameof(IMessagingProvider.DeleteRuleAsync),
    ];

    /// <summary>One create, update or delete of an entity: the provider member and its arguments.</summary>
    internal sealed record AdminCall(string Method, object?[] Args);

    /// <summary>Records the call, then throws <see cref="Broker.AdminFailure"/> or answers; a rule call answers the rule it was given.</summary>
    private static object Admin(Broker broker, string method, object?[] args)
    {
        broker.AdminCalls.Add(new AdminCall(method, args));
        var rule = method switch
        {
            nameof(IMessagingProvider.CreateRuleAsync) => (SubscriptionRuleInfo?)args[2],
            nameof(IMessagingProvider.UpdateRuleAsync) => new SubscriptionRuleInfo { Name = (string)args[2]!, FilterType = ((SubscriptionRuleInfo)args[3]!).FilterType },
            _ => null,
        };
        if (rule is not null)
            return broker.AdminFailure is { } ruleFailed ? Task.FromException<SubscriptionRuleInfo>(ruleFailed) : Task.FromResult(rule);
        return broker.AdminFailure is { } failure ? Task.FromException(failure) : Task.CompletedTask;
    }

    /// <summary>One move, remove, purge or cancel call: the provider member, where, which numbers, the target, the token.</summary>
    internal sealed record BatchCall(string Method, string Entity, string? Subscription, MessageSubQueue? SubQueue, long[] Numbers, string? Target, CancellationToken Token, bool NewMessageIds = false);

    /// <summary>Records the call, then throws <see cref="Broker.BatchFailure"/> or answers; a purge answers no result.</summary>
    private static object Batch(Broker broker, BatchCall call)
    {
        broker.BatchCalls.Add(call);
        if (call.Method == nameof(IMessagingProvider.PurgeMessagesAsync))
            return broker.BatchFailure is { } purgeFailed ? Task.FromException(purgeFailed) : Task.CompletedTask;
        if (broker.BatchFailure is { } failure) return Task.FromException<BatchOperationResult>(failure);
        return Task.FromResult(broker.BatchResult?.Invoke(call.Numbers) ?? new BatchOperationResult { SuccessCount = call.Numbers.Length });
    }

    private static T Counted<T>(Action count, T answer)
    {
        count();
        return answer;
    }

    private static Task<long?> SendOne(Broker broker, SendMessageRequest message)
    {
        broker.SendCalls++;
        if (broker.SendFailure is { } failure) return Task.FromException<long?>(failure);
        broker.Sent.Add(message);
        return Task.FromResult<long?>(message.ScheduledEnqueueTime is null ? null : 77L);
    }

    private static Task<SendMessagesResult> SendMany(Broker broker, List<SendMessageRequest> messages)
    {
        broker.SendCalls++;
        if (broker.SendFailure is { } failure) return Task.FromException<SendMessagesResult>(failure);
        broker.Sent.AddRange(messages);
        return Task.FromResult(broker.BatchAnswer?.Invoke(messages) ?? new SendMessagesResult { SentCount = messages.Count });
    }

    private static Task<IEnumerable<IMessage>> Peek(Broker broker)
    {
        broker.Peeks++;
        return broker.PeekFailure is { } failure
            ? Task.FromException<IEnumerable<IMessage>>(failure)
            : Task.FromResult<IEnumerable<IMessage>>(broker.Messages);
    }

    /// <summary>The API on a test server with the stub provider; a wait given replaces the two minutes a request waits.</summary>
    internal sealed class Host : IAsyncDisposable
    {
        private readonly ApiFactory _base;

        public Host(Broker broker, TimeSpan? wait = null)
        {
            _base = new ApiFactory();
            Factory = _base.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            {
                s.AddSingleton(FactoryFor(broker));
                if (wait is { } replaced) s.AddSingleton(new McpRequestOptions(replaced));
            }));
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

        public async Task OfferAsync(string id, string level = "read", bool? neverAsk = null)
        {
            using var offered = await Keyed.PutAsJsonAsync($"/api/mcp/connections/{id}", new { level, neverAsk });
            Assert.True(offered.StatusCode == HttpStatusCode.OK, $"offering {id} at {level} answered {(int)offered.StatusCode}: {await offered.Content.ReadAsStringAsync()}");
        }

        /// <summary>The requests waiting for the user, oldest first.</summary>
        public async Task<JsonElement> RequestsAsync()
        {
            using var doc = JsonDocument.Parse(await Keyed.GetStringAsync("/api/mcp/requests"));
            return doc.RootElement.Clone();
        }

        /// <summary>Waits, at most 5 seconds, until <paramref name="count"/> requests wait for the user, and answers them.</summary>
        public async Task<JsonElement> WaitForRequestsAsync(int count = 1)
        {
            var until = DateTime.UtcNow.AddSeconds(5);
            while (true)
            {
                var waiting = await RequestsAsync();
                if (waiting.GetArrayLength() >= count || DateTime.UtcNow > until) return waiting;
                await Task.Delay(20);
            }
        }

        /// <summary>
        /// Calls a tool that must answer without asking the user. When it asks instead, the request is denied so the
        /// call ends, and the test fails with <paramref name="requirement"/>.
        /// </summary>
        public async Task<(bool IsError, string Text)> CallUnaskedAsync(string tool, object? arguments, string requirement)
        {
            var call = CallAsync(tool, arguments);
            if (await Task.WhenAny(call, Task.Delay(TimeSpan.FromSeconds(5))) != call)
            {
                var waiting = await RequestsAsync();
                foreach (var request in waiting.EnumerateArray())
                {
                    using (await Keyed.PostAsJsonAsync($"/api/mcp/requests/{request.GetProperty("id").GetString()}/answer", new { allow = false })) { }
                }
                await call;
                Assert.Fail($"{requirement}: {tool} waited for the user instead; the requests were {waiting}");
            }
            return await call;
        }

        /// <summary>Waits for the one request of a tool call and answers it.</summary>
        public async Task<JsonElement> AnswerOnlyRequestAsync(bool allow)
        {
            var waiting = await WaitForRequestsAsync();
            Assert.True(waiting.GetArrayLength() == 1, $"the tool asks the user in the app before it goes on; the requests waiting were {waiting}");
            var request = waiting[0];
            using var answered = await Keyed.PostAsJsonAsync($"/api/mcp/requests/{request.GetProperty("id").GetString()}/answer", new { allow });
            Assert.Equal(HttpStatusCode.NoContent, answered.StatusCode);
            return request.Clone();
        }

        public async Task ConnectAsync(string id)
        {
            using var connected = await Keyed.PostAsync($"/api/connections/{id}/connect", null);
            Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
        }

        /// <summary>Calls a tool; a refusal is answered as an error result that holds the sentence of the tool alone.</summary>
        public async Task<(bool IsError, string Text)> CallAsync(string tool, object? arguments = null, CancellationToken cancellationToken = default)
        {
            var body = JsonSerializer.Serialize(new
            {
                jsonrpc = "2.0",
                id = 7,
                method = "tools/call",
                @params = new { name = tool, arguments = arguments ?? new { } }
            });
            using var response = await Anonymous.SendAsync(McpRequest(body, bearer: "Bearer " + Token), cancellationToken);
            var raw = await response.Content.ReadAsStringAsync(cancellationToken);
            Assert.True(response.StatusCode == HttpStatusCode.OK, $"tools/call {tool} answered {(int)response.StatusCode}: {raw}");
            using var doc = JsonDocument.Parse(JsonRpcPayload(raw));
            var result = doc.RootElement.GetProperty("result");
            var text = string.Concat(result.GetProperty("content").EnumerateArray().Select(c => c.GetProperty("text").GetString()));
            var failed = result.TryGetProperty("isError", out var isError) && isError.GetBoolean();
            Assert.False(text.StartsWith("An error occurred invoking", StringComparison.Ordinal),
                $"a refusal is answered as an error result of the tool, not as an exception the SDK puts its prefix before; {tool} answered {text}");
            return (failed, text);
        }

        /// <summary>The tool named <paramref name="tool"/> as tools/list answers it.</summary>
        public async Task<JsonElement> ListedToolAsync(string tool)
        {
            var body = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 8, method = "tools/list", @params = new { } });
            using var response = await Anonymous.SendAsync(McpRequest(body, bearer: "Bearer " + Token));
            var raw = await response.Content.ReadAsStringAsync();
            Assert.True(response.StatusCode == HttpStatusCode.OK, $"tools/list answered {(int)response.StatusCode}: {raw}");
            using var doc = JsonDocument.Parse(JsonRpcPayload(raw));
            return doc.RootElement.GetProperty("result").GetProperty("tools").EnumerateArray().Single(t => t.GetProperty("name").GetString() == tool).Clone();
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

    internal static ServiceBusConnection Offered(string id = "c-offered") => new()
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

    internal static void AssertNoSecret(string answer, string token, string what)
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
            var messages = doc.RootElement.GetProperty("messages").EnumerateArray().ToList();
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
        var store = host.Factory.Services.GetRequiredService<RecentLogStore>();
        store.Clear();

        var (isError, text) = await host.CallAsync("peek_messages", new { entity = "orders" });

        var logged = store.After(0);
        Assert.True(logged.Any(l => l.Level == "Warning" && l.Category == nameof(McpReadTools) && l.Text.StartsWith("An MCP tool call failed", StringComparison.Ordinal)),
            $"a broker failure still leaves its Warning line in the app's log; the log held {string.Join(" | ", logged.Select(l => $"{l.Level} {l.Category}: {l.Text}"))}");
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
        var bogus = await host.CallAsync("read_logs", new { level = "bogus" });
        var undefined = await host.CallAsync("read_logs", new { level = "99" });

        Assert.True(refused.IsError && refused.Text == McpReadTools.LogsRefused, $"the logs are read only when the user allowed it; read_logs answered {refused.Text}");
        Assert.False(all.IsError, all.Text);
        using (var doc = JsonDocument.Parse(all.Text))
            Assert.Equal(["third line", "second line", "first line"], doc.RootElement.EnumerateArray().Select(l => l.GetProperty("text").GetString()));
        using (var doc = JsonDocument.Parse(warnings.Text))
            Assert.Equal(["third line"], doc.RootElement.EnumerateArray().Select(l => l.GetProperty("text").GetString()));
        const string UnknownLevel = "level must be Trace, Debug, Information, Warning, Error or Critical.";
        Assert.True(bogus == (true, UnknownLevel), $"read_logs refuses a level that is not the name of one; level bogus answered {bogus}");
        Assert.True(undefined == (true, UnknownLevel), $"read_logs refuses a number that is no level; level 99 answered {undefined}");
        var activity = (await host.ActivityAsync()).EnumerateArray().ToList();
        Assert.All(activity.Take(2), a => Assert.Equal(("Read 50 log lines", "This app", "Refused: unknown level", "error"),
            (a.GetProperty("asked").GetString(), a.GetProperty("where").GetString(), a.GetProperty("outcome").GetString(), a.GetProperty("kind").GetString())));
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

    [Theory]
    [InlineData("topics")]
    [InlineData("subscriptions")]
    [InlineData("subscription peek")]
    [InlineData("dead-letter")]
    [InlineData("position")]
    public async Task A_capability_the_provider_does_not_declare_is_refused_with_its_sentence_recorded_and_the_provider_never_called(string missing)
    {
        var broker = new Broker
        {
            SupportsTopics = missing != "topics",
            SupportsSubscriptions = missing is not ("subscriptions" or "subscription peek"),
            SupportsDeadLetterQueue = missing != "dead-letter",
            SupportsPeekFromSequenceNumber = missing != "position",
        };
        var (tool, arguments, sentence, outcome) = missing switch
        {
            "topics" => ("list_topics", (object)new { }, "This provider does not support topics.", "Refused: no topics"),
            "subscriptions" => ("list_subscriptions", new { topic = "events" }, "This provider does not support subscriptions.", "Refused: no subscriptions"),
            "subscription peek" => ("peek_messages", new { entity = "events", subscription = "audit" }, "This provider does not support subscriptions.", "Refused: no subscriptions"),
            "dead-letter" => ("peek_messages", new { entity = "orders", subQueue = "deadLetter" }, "This provider does not support the dead-letter queue.", "Refused: no dead-letter queue"),
            _ => ("peek_messages", new { entity = "orders", fromSequenceNumber = 5L }, "This provider cannot read the queue from a position.", "Refused: position"),
        };
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        var answer = await host.CallAsync(tool, arguments);

        Assert.True(answer == (true, sentence), $"a capability the provider does not declare ({missing}) is refused with its fixed sentence; {tool} answered {answer}");
        Assert.True(broker.TopicLists + broker.SubscriptionLists + broker.Peeks == 0,
            $"a capability the provider does not declare ({missing}) is refused before the provider is called; it listed topics {broker.TopicLists}, subscriptions {broker.SubscriptionLists} and peeked {broker.Peeks} times");
        var line = Assert.Single((await host.ActivityAsync()).EnumerateArray());
        Assert.Equal((outcome, "error"), (line.GetProperty("outcome").GetString(), line.GetProperty("kind").GetString()));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Counts_are_answered_only_when_the_broker_gives_them(bool countsGiven)
    {
        await using var host = new Host(new Broker { SupportsMessageCounts = countsGiven });
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        var queues = await host.CallAsync("list_queues");
        var subscriptions = await host.CallAsync("list_subscriptions", new { topic = "events" });

        Assert.False(queues.IsError || subscriptions.IsError, $"{queues.Text} {subscriptions.Text}");
        string[] countFields = ["activeMessageCount", "deadLetterMessageCount", "scheduledMessageCount", "transferMessageCount", "transferDeadLetterMessageCount"];
        foreach (var (tool, text, active) in new[] { ("list_queues", queues.Text, 3L), ("list_subscriptions", subscriptions.Text, 5L) })
        {
            using var doc = JsonDocument.Parse(text);
            var entity = Assert.Single(doc.RootElement.EnumerateArray());
            Assert.True(entity.TryGetProperty("countsAvailable", out var available) && available.GetBoolean() == countsGiven,
                $"{tool} says whether the broker gives counts; with counts given {countsGiven} it answered {text}");
            var answered = countFields.Where(f => entity.TryGetProperty(f, out _)).ToList();
            Assert.True(countsGiven ? answered.Count == countFields.Length : answered.Count == 0,
                $"counts are not answered when the provider gives none: with counts given {countsGiven}, {tool} answered the fields {string.Join(", ", answered)}");
            long? activeAnswered = entity.TryGetProperty("activeMessageCount", out var count) ? count.GetInt64() : null;
            Assert.Equal(countsGiven ? active : null, activeAnswered);
        }

        var topics = await host.CallAsync("list_topics");
        using var listed = JsonDocument.Parse(topics.Text);
        var topic = listed.RootElement.EnumerateArray().First();
        Assert.True(topic.TryGetProperty("countsAvailable", out var topicCounts) && topicCounts.GetBoolean() == countsGiven
                && topic.TryGetProperty("scheduledMessageCount", out _) == countsGiven,
            $"list_topics answers its scheduled count only when the broker gives counts; with counts given {countsGiven} it answered {topics.Text}");
    }

    [Theory]
    [InlineData(ProviderType.RabbitMQ)]
    [InlineData(ProviderType.AzureServiceBus)]
    public async Task A_peek_on_RabbitMQ_says_what_it_costs_in_the_description_and_in_the_answer(ProviderType providerType)
    {
        var broker = new Broker { ProviderType = providerType, Messages = [new MessageInfo { MessageId = "m1", SequenceNumber = 1, Body = "b" }] };
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        var listed = await host.ListedToolAsync("peek_messages");
        var (isError, text) = await host.CallAsync("peek_messages", new { entity = "orders" });

        var description = listed.GetProperty("description").GetString()!;
        Assert.True(description.Contains(McpReadTools.RabbitMQPeekNote, StringComparison.Ordinal) && description.Contains("On Azure Service Bus a peek does not lock or remove them.", StringComparison.Ordinal),
            $"the description of peek_messages says what a peek costs on RabbitMQ and that it costs nothing on Azure; it reads {description}");
        var annotations = listed.GetProperty("annotations");
        Assert.False(annotations.GetProperty("readOnlyHint").GetBoolean(), "peek_messages is not marked read-only: on RabbitMQ it puts the messages back marked as redelivered");
        Assert.False(annotations.TryGetProperty("destructiveHint", out var destructive) && !destructive.GetBoolean(),
            "peek_messages is not declared non-destructive: on a quorum queue a return of the held messages counts as a delivery");
        Assert.False(isError, text);
        using var doc = JsonDocument.Parse(text);
        Assert.Equal("m1", Assert.Single(doc.RootElement.GetProperty("messages").EnumerateArray()).GetProperty("messageId").GetString());
        var expectedNote = providerType == ProviderType.RabbitMQ ? McpReadTools.RabbitMQPeekNote : null;
        var answeredNote = doc.RootElement.TryGetProperty("note", out var note) ? note.GetString() : null;
        Assert.True(answeredNote == expectedNote,
            $"a peek on RabbitMQ answers what it cost beside the messages, and one on Azure Service Bus carries no note; on {providerType} it answered {text}");
    }

    [Fact]
    public async Task A_refusal_is_answered_as_an_error_result_and_leaves_no_Error_line_in_the_app_log()
    {
        await using var host = new Host(new Broker());
        await host.StartAsync();
        var store = host.Factory.Services.GetRequiredService<RecentLogStore>();
        store.Clear();

        var notOffered = await host.CallAsync("list_queues");
        var logs = await host.CallAsync("read_logs");

        Assert.Equal((true, McpReadTools.NotOffered), notOffered);
        Assert.Equal((true, McpReadTools.LogsRefused), logs);
        var errors = store.After(0).Where(l => l.Level is "Error" or "Critical").ToList();
        Assert.True(errors.Count == 0,
            $"a refusal is not an error of the app: the log of the app holds no Error line after two refused calls; it held {string.Join(" | ", errors.Select(l => $"{l.Category}: {l.Text} ({l.ErrorType})"))}");
    }

    [Fact]
    public async Task List_rules_answers_the_filter_type_and_a_property_type_by_their_names()
    {
        var broker = new Broker
        {
            Rules =
            [
                new SubscriptionRuleInfo { Name = "by-sql", FilterType = RuleFilterType.Sql, SqlExpression = "1=1" },
                new SubscriptionRuleInfo
                {
                    Name = "by-correlation",
                    FilterType = RuleFilterType.Correlation,
                    Correlation = new CorrelationFilterInfo { ApplicationProperties = [new RuleApplicationProperty { Name = "tenant", Type = RulePropertyType.Int64, Value = "7" }] },
                },
            ],
        };
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        var (isError, text) = await host.CallAsync("list_rules", new { topic = "events", subscription = "audit" });

        Assert.False(isError, text);
        using var doc = JsonDocument.Parse(text);
        var rules = doc.RootElement.EnumerateArray().ToList();
        Assert.True(rules.Select(r => r.GetProperty("filterType")).All(f => f.ValueKind == JsonValueKind.String)
                && rules.Select(r => r.GetProperty("filterType").GetString()).SequenceEqual(["Sql", "Correlation"]),
            $"list_rules answers filterType as the name of the kind of filter, not a number; it answered {text}");
        var property = rules[1].GetProperty("correlation").GetProperty("applicationProperties")[0].GetProperty("type");
        Assert.True(property.ValueKind == JsonValueKind.String && property.GetString() == "Int64",
            $"list_rules answers the type of a correlation property by its name, not a number; it answered {text}");
    }

    [Theory]
    [InlineData("", true)]
    [InlineData("", false)]
    [InlineData("Active", true)]
    [InlineData("Active", false)]
    public async Task The_lists_leave_status_out_when_the_provider_gives_none(string status, bool countsGiven)
    {
        await using var host = new Host(new Broker { ListedStatus = status, SupportsMessageCounts = countsGiven });
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        foreach (var (tool, arguments, name) in new (string, object?, string)[] { ("list_queues", null, "orders"), ("list_topics", null, "events"), ("list_subscriptions", new { topic = "events" }, "audit") })
        {
            var (isError, text) = await host.CallAsync(tool, arguments);
            Assert.False(isError, text);
            using var doc = JsonDocument.Parse(text);
            var entity = Assert.Single(doc.RootElement.EnumerateArray());
            string? answered = entity.TryGetProperty("status", out var given) ? given.GetString() : null;
            Assert.True(answered == (status.Length == 0 ? null : status),
                $"{tool} leaves status out when the provider gives none and answers it when it does; with status '{status}' it answered {text}");
            Assert.Equal(name, entity.GetProperty("name").GetString());
        }
    }

    public static readonly TheoryData<string, string?> ToolsThatNeedAReason = new()
    {
        { "send_message", null }, { "send_message", "" }, { "send_message", " \t " },
        { "send_messages", null }, { "send_messages", "" }, { "send_messages", " \t " },
        { "connect_to", null }, { "connect_to", "" }, { "connect_to", " \t " },
        { "dead_letter_messages", null }, { "dead_letter_messages", " \t " },
        { "resubmit_messages", null }, { "resubmit_messages", " \t " },
        { "move_messages", null }, { "move_messages", " \t " },
        { "delete_messages", null }, { "delete_messages", " \t " },
        { "purge_messages", null }, { "purge_messages", "" },
        { "cancel_scheduled_messages", null }, { "cancel_scheduled_messages", "" },
    };

    [Theory]
    [MemberData(nameof(ToolsThatNeedAReason))]
    public async Task A_tool_called_without_a_reason_or_with_a_blank_one_is_refused_by_the_tool_before_anything_else(string tool, string? reason)
    {
        var broker = new Broker();
        await using var host = new Host(broker);
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered", "all");
        await host.ConnectAsync("c-offered");
        var store = host.Factory.Services.GetRequiredService<RecentLogStore>();
        store.Clear();
        var arguments = tool switch
        {
            "send_message" => new Dictionary<string, object?> { ["entity"] = "orders", ["body"] = "a" },
            "send_messages" => new Dictionary<string, object?> { ["entity"] = "orders", ["messages"] = new[] { new { body = "a" } } },
            "connect_to" => new Dictionary<string, object?> { ["connection"] = "c-offered" },
            "purge_messages" => new Dictionary<string, object?> { ["entity"] = "orders", ["subQueue"] = "active" },
            "delete_messages" => new Dictionary<string, object?> { ["entity"] = "orders", ["subQueue"] = "active", ["sequenceNumbers"] = new long[] { 12 } },
            "move_messages" => new Dictionary<string, object?> { ["entity"] = "orders", ["sequenceNumbers"] = new long[] { 12 }, ["target"] = "orders-retry" },
            _ => new Dictionary<string, object?> { ["entity"] = "orders", ["sequenceNumbers"] = new long[] { 12 } },
        };
        if (reason is not null) arguments["reason"] = reason;

        var answer = await host.CallUnaskedAsync(tool, arguments, $"{tool} without a reason is refused before anybody is asked");
        var listed = await host.ListedToolAsync(tool);

        Assert.True(answer == (true, McpToolCalls.ReasonRequired),
            $"{tool} called with reason {(reason is null ? "missing" : $"'{reason}'")} is refused by the tool with the fixed sentence, not rejected by the SDK; it answered {answer}");
        Assert.True(broker.Sent.Count + broker.BatchCalls.Count == 0 && broker.Connects.Count == 1,
            $"{tool} without a reason calls no provider: it sent {broker.Sent.Count}, made {broker.BatchCalls.Count} batch calls and {broker.Connects.Count - 1} connects");
        Assert.Equal(0, (await host.RequestsAsync()).GetArrayLength());
        var line = Assert.Single((await host.ActivityAsync()).EnumerateArray());
        Assert.Equal(("Refused: no reason", "error"), (line.GetProperty("outcome").GetString(), line.GetProperty("kind").GetString()));
        var errors = store.After(0).Where(l => l.Level is "Error" or "Critical").ToList();
        Assert.True(errors.Count == 0, $"a call without a reason leaves no Error line in the app's log; it held {string.Join(" | ", errors.Select(l => $"{l.Category}: {l.Text}"))}");
        var schema = listed.GetProperty("inputSchema");
        var required = schema.TryGetProperty("required", out var names) ? names.EnumerateArray().Select(n => n.GetString()).ToList() : [];
        Assert.True(!required.Contains("reason") && schema.GetProperty("properties").GetProperty("reason").GetProperty("description").GetString()!.Contains("Required", StringComparison.Ordinal),
            $"{tool} takes reason as optional in its schema and its description still says it is required: {schema}");
    }

    [Fact]
    public async Task The_entity_an_assistant_names_is_recorded_cut_at_100_characters()
    {
        await using var host = new Host(new Broker());
        await host.StartAsync();
        await host.SeedAsync(Offered());
        await host.OfferAsync("c-offered");
        await host.ConnectAsync("c-offered");

        await host.CallAsync("peek_messages", new { entity = new string('e', 300), subQueue = new string('s', 300) });

        var line = Assert.Single((await host.ActivityAsync()).EnumerateArray());
        Assert.True(line.GetProperty("where").GetString() == new string('e', 100) + " on offered-name",
            $"the entity an assistant names goes into the record cut at 100 characters; the record holds {line.GetProperty("where").GetString()!.Length} characters");
    }
}
