using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using static ServiceBusExplorer.Api.Tests.EntityAdministrationTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The session routes of a queue and of a subscription as the web app reads them: what reaches the provider, the exact
/// body that comes back, and the fixed answer to every refusal.
/// </summary>
public class SessionRouteTests
{
    private const string Sentinel = "BROKER-DETAIL-SENTINEL";
    private const string Queue = "/api/queues/orders/sessions";
    private const string Subscription = "/api/topics/events/subscriptions/audit/sessions";
    private const string StateWrite = """{"state":"{\"step\":4}","expectedState":"{\"step\":3}"}""";

    private static readonly SessionDetail Detail = new()
    {
        SessionId = "order-1001",
        State = "{\"step\":3}",
        StateIsBinary = false,
        LockedUntil = new DateTimeOffset(2026, 11, 12, 23, 10, 0, TimeSpan.Zero)
    };

    private const string DetailBody = """{"sessionId":"order-1001","state":"{\"step\":3}","stateIsBinary":false,"lockedUntil":"2026-11-12T23:10:00+00:00"}""";

    private static object? ProviderAnswers(MethodInfo m, object?[] _) => m.Name switch
    {
        nameof(IMessagingProvider.GetSessionsAsync) => Task.FromResult(new SessionList
        {
            Sessions = [new SessionInfo { SessionId = "order-1001", MessageCount = 12, FirstSequenceNumber = 4411 }],
            ScannedMessages = 1000,
            Truncated = true
        }),
        nameof(IMessagingProvider.GetSessionAsync) or nameof(IMessagingProvider.SetSessionStateAsync) => Task.FromResult(Detail),
        nameof(IMessagingProvider.PeekSessionMessagesAsync) => Task.FromResult<IEnumerable<IMessage>>(
            new List<MessageInfo> { new() { SequenceNumber = 4411, SessionId = "order-1001", Body = "b" } }),
        _ => null
    };

    public static TheoryData<string, string, string?, string> EveryRoute => new()
    {
        { "GET", Queue, null, nameof(IMessagingProvider.GetSessionsAsync) },
        { "GET", Queue + "/order-1001", null, nameof(IMessagingProvider.GetSessionAsync) },
        { "GET", Queue + "/order-1001/messages", null, nameof(IMessagingProvider.PeekSessionMessagesAsync) },
        { "PUT", Queue + "/order-1001/state", StateWrite, nameof(IMessagingProvider.SetSessionStateAsync) },
        { "GET", Subscription, null, nameof(IMessagingProvider.GetSessionsAsync) },
        { "GET", Subscription + "/order-1001", null, nameof(IMessagingProvider.GetSessionAsync) },
        { "GET", Subscription + "/order-1001/messages", null, nameof(IMessagingProvider.PeekSessionMessagesAsync) },
        { "PUT", Subscription + "/order-1001/state", StateWrite, nameof(IMessagingProvider.SetSessionStateAsync) }
    };

    public static TheoryData<string, string, string?> EveryPath => new()
    {
        { "GET", Queue, null },
        { "GET", Queue + "/order-1001", null },
        { "GET", Queue + "/order-1001/messages", null },
        { "PUT", Queue + "/order-1001/state", StateWrite },
        { "GET", Subscription, null },
        { "GET", Subscription + "/order-1001", null },
        { "GET", Subscription + "/order-1001/messages", null },
        { "PUT", Subscription + "/order-1001/state", StateWrite }
    };

    private static (string Entity, string? Subscription) Names(string path) =>
        path.StartsWith(Queue) ? ("orders", null) : ("events", "audit");

    [Theory]
    [InlineData(Queue, 1000)]
    [InlineData(Queue + "?maxMessages=0", 1)]
    [InlineData(Queue + "?maxMessages=9999", 5000)]
    [InlineData(Subscription + "?maxMessages=250", 250)]
    public async Task The_list_of_a_queue_or_a_subscription_hands_the_provider_the_clamped_scan_size_and_answers_the_contract_shape(string path, int maxMessages)
    {
        var answered = await SendAsync("GET", path, null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"sessions":[{"sessionId":"order-1001","messageCount":12,"firstSequenceNumber":4411}],"scannedMessages":1000,"truncated":true}""", answered.Body);
        var call = Assert.Single(answered.Calls);
        var (entity, subscription) = Names(path);
        Assert.Equal((nameof(IMessagingProvider.GetSessionsAsync), entity, subscription, maxMessages), (call.Method, call.Args[0], call.Args[1], call.Args[2]));
        Assert.True(((CancellationToken)call.Args[3]!).CanBeCanceled);
    }

    [Theory]
    [InlineData(Queue + "/order-1001")]
    [InlineData(Subscription + "/order-1001")]
    public async Task The_detail_of_one_session_of_a_queue_or_a_subscription_answers_its_state_and_lock(string path)
    {
        var answered = await SendAsync("GET", path, null, ProviderAnswers);

        Assert.Equal((HttpStatusCode.OK, DetailBody), (answered.Status, answered.Body));
        var call = Assert.Single(answered.Calls);
        var (entity, subscription) = Names(path);
        Assert.Equal((nameof(IMessagingProvider.GetSessionAsync), entity, subscription, "order-1001"), (call.Method, call.Args[0], call.Args[1], call.Args[2]));
        Assert.True(((CancellationToken)call.Args[3]!).CanBeCanceled);
    }

    [Theory]
    [InlineData(Queue + "/order-1001/messages", 10)]
    [InlineData(Queue + "/order-1001/messages?count=0", 1)]
    [InlineData(Subscription + "/order-1001/messages?count=5000", 1000)]
    public async Task The_messages_of_one_session_of_a_queue_or_a_subscription_are_peeked_with_the_peek_route_count_limits(string path, int count)
    {
        var answered = await SendAsync("GET", path, null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        using var json = JsonDocument.Parse(answered.Body);
        var message = Assert.Single(json.RootElement.EnumerateArray());
        Assert.Equal((4411L, "order-1001"), (message.GetProperty("sequenceNumber").GetInt64(), message.GetProperty("sessionId").GetString()));
        var call = Assert.Single(answered.Calls);
        var (entity, subscription) = Names(path);
        Assert.Equal((nameof(IMessagingProvider.PeekSessionMessagesAsync), entity, subscription, "order-1001", count),
            (call.Method, call.Args[0], call.Args[1], call.Args[2], call.Args[3]));
        Assert.True(((CancellationToken)call.Args[4]!).CanBeCanceled);
    }

    [Theory]
    [InlineData(Queue + "/order-1001/state", StateWrite, "{\"step\":4}", "{\"step\":3}")]
    [InlineData(Subscription + "/order-1001/state", """{"state":null,"expectedState":null}""", null, null)]
    public async Task A_state_write_hands_the_provider_the_new_state_and_the_state_the_caller_was_shown(string path, string body, string? state, string? expected)
    {
        var answered = await SendAsync("PUT", path, body, ProviderAnswers);

        Assert.Equal((HttpStatusCode.OK, DetailBody), (answered.Status, answered.Body));
        var call = Assert.Single(answered.Calls);
        var (entity, subscription) = Names(path);
        Assert.Equal((nameof(IMessagingProvider.SetSessionStateAsync), entity, subscription, "order-1001", state, expected),
            (call.Method, call.Args[0], call.Args[1], call.Args[2], call.Args[3], call.Args[4]));
        Assert.True(((CancellationToken)call.Args[5]!).CanBeCanceled);
    }

    [Theory]
    [InlineData(Queue + "/order-1001/state", """{"expectedState":null}""")]
    [InlineData(Subscription + "/order-1001/state", """{"expectedState":"{\"step\":3}"}""")]
    [InlineData(Queue + "/order-1001/state", """{"state":4,"expectedState":null}""")]
    [InlineData(Queue + "/order-1001/state", null)]
    public async Task A_state_write_without_state_answers_400_and_writes_nothing(string path, string? body)
    {
        var answered = await SendAsync("PUT", path, body, ProviderAnswers);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"state is required: the new state, or null to clear it."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData(Queue + "/order-1001/state", """{"state":"x"}""")]
    [InlineData(Subscription + "/order-1001/state", """{"state":"x"}""")]
    [InlineData(Queue + "/order-1001/state", """{"state":"x","expectedState":3}""")]
    public async Task A_state_write_without_expectedState_answers_400_and_writes_nothing(string path, string? body)
    {
        var answered = await SendAsync("PUT", path, body, ProviderAnswers);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"expectedState is required: the state that was read, or null when the session had none."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [MemberData(nameof(EveryRoute))]
    public async Task A_session_locked_by_another_receiver_or_a_wait_that_elapsed_answers_409_with_the_fixed_text_and_code_SessionInUse(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new SessionInUseException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.Conflict, answered.Status);
        Assert.Equal("""{"message":"The session is in use by another receiver. Try again in a moment.","code":"SessionInUse"}""", answered.Body);
    }

    [Theory]
    [MemberData(nameof(EveryRoute))]
    public async Task A_disabled_entity_answers_409_with_the_text_of_every_other_message_route(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new EntityDisabledException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.Conflict, answered.Status);
        Assert.Equal("""{"message":"The entity is disabled for this operation."}""", answered.Body);
    }

    [Theory]
    [MemberData(nameof(EveryRoute))]
    public async Task A_missing_entity_answers_404_naming_a_queue_or_a_subscription(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new EntityNotFoundException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.NotFound, answered.Status);
        var kind = Names(path).Subscription == null ? "queue" : "subscription";
        Assert.Equal($$"""{"message":"The {{kind}} was not found."}""", answered.Body);
    }

    [Theory]
    [MemberData(nameof(EveryRoute))]
    public async Task An_entity_that_does_not_use_sessions_answers_400_with_the_fixed_text(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new SessionsNotEnabledException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This entity does not use sessions."}""", answered.Body);
    }

    [Theory]
    [MemberData(nameof(EveryRoute))]
    public async Task A_session_id_the_provider_refuses_answers_400_with_its_text_naming_the_field_and_the_limit(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body,
            Fails(providerMethod, new InvalidEntityConfigurationException(["sessionId must hold 1 to 128 characters, not only white space."])));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"sessionId must hold 1 to 128 characters, not only white space."}""", answered.Body);
    }

    [Theory]
    [MemberData(nameof(EveryRoute))]
    public async Task Any_other_failure_answers_the_constant_500_and_nothing_of_the_broker(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new TimeoutException(Sentinel)));

        Assert.Equal(HttpStatusCode.InternalServerError, answered.Status);
        Assert.Equal("""{"message":"An internal error occurred."}""", answered.Body);
    }

    [Theory]
    [MemberData(nameof(EveryPath))]
    public async Task A_provider_without_sessions_answers_400_and_is_never_called(string method, string path, string? body)
    {
        var answered = await SendAsync(method, path, body, ProviderAnswers, ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This provider does not support sessions."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData(Queue + "/order-1001/state")]
    [InlineData(Subscription + "/order-1001/state")]
    public async Task A_state_that_changed_since_it_was_read_answers_409_with_code_SessionStateChanged_and_says_to_reload(string path)
    {
        var answered = await SendAsync("PUT", path, StateWrite, Fails(nameof(IMessagingProvider.SetSessionStateAsync), new SessionStateChangedException()));

        Assert.Equal(HttpStatusCode.Conflict, answered.Status);
        Assert.Equal("""{"message":"The session state changed since it was read. Reload it and try again.","code":"SessionStateChanged"}""", answered.Body);
    }

    [Theory]
    [InlineData(Queue + "/order-1001/state")]
    [InlineData(Subscription + "/order-1001/state")]
    public async Task A_binary_state_answers_400_and_says_it_cannot_be_edited_here(string path)
    {
        var answered = await SendAsync("PUT", path, StateWrite, Fails(nameof(IMessagingProvider.SetSessionStateAsync), new BinarySessionStateException()));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This session holds a binary state and cannot be edited here."}""", answered.Body);
    }

    [Theory]
    [InlineData("GET", "/api/sessions/orders")]
    [InlineData("GET", "/api/sessions/events/subscriptions/audit")]
    [InlineData("PUT", "/api/sessions/orders/state/order-1001")]
    [InlineData("PUT", "/api/sessions/events/subscriptions/audit/order-1001/state")]
    public async Task The_old_session_routes_are_gone_and_reach_no_provider(string method, string path)
    {
        var answered = await SendAsync(method, path, StateWrite, ProviderAnswers);

        Assert.Equal(HttpStatusCode.NotFound, answered.Status);
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [MemberData(nameof(EveryPath))]
    public async Task A_session_route_without_the_api_key_is_refused_with_401(string method, string path, string? body)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (body is not null) request.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
