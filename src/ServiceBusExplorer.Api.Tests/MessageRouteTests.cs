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
/// The transfer dead-letter routes, the cancel of scheduled messages and the answer to a disabled entity, as the web
/// app reads them: what reaches the provider and the exact body that comes back.
/// </summary>
public class MessageRouteTests
{
    private const string Sentinel = "BROKER-DETAIL-SENTINEL";
    private const string Subscription = "/api/topics/events/subscriptions/audit";
    private const string Batch = """{"sequenceNumbers":[1,2]}""";
    private const string Search = """{"query":"order","count":5}""";

    private static object? ProviderAnswers(MethodInfo m, object?[] _) => m.Name switch
    {
        nameof(IMessagingProvider.PeekMessagesAsync) => Task.FromResult<IEnumerable<IMessage>>(
            new List<MessageInfo> { new() { SequenceNumber = 7, Body = "order", State = "Active", IsDeadLettered = true, DeadLetterReason = "transfer failed" } }),
        nameof(IMessagingProvider.SearchMessagesAsync) => Task.FromResult(new MessageSearchResult
        {
            Messages = new List<IMessage> { new MessageInfo { SequenceNumber = 7, Body = "order" } },
            TotalPeeked = 3,
            TotalMatches = 1
        }),
        nameof(IMessagingProvider.DeleteMessagesAsync) or nameof(IMessagingProvider.ResubmitDeadLetterMessagesAsync) => Task.FromResult(new BatchOperationResult
        {
            SuccessCount = 1,
            FailureCount = 1,
            Failures = { new BatchOperationFailure { SequenceNumber = 2, Error = "Not found within scan window" } }
        }),
        _ => null
    };

    [Theory]
    [InlineData("GET", "/api/queues/orders/deadletter?count=5", "/api/queues/orders/transferdeadletter?count=5", null, "PeekMessagesAsync", new[] { "orders" })]
    [InlineData("POST", "/api/queues/orders/deadletter/search", "/api/queues/orders/transferdeadletter/search", Search, "SearchMessagesAsync", new[] { "orders" })]
    [InlineData("POST", "/api/queues/orders/deadletter/delete-batch", "/api/queues/orders/transferdeadletter/delete-batch", Batch, "DeleteMessagesAsync", new[] { "orders" })]
    [InlineData("POST", "/api/queues/orders/deadletter/resubmit-batch", "/api/queues/orders/transferdeadletter/resubmit-batch", Batch, "ResubmitDeadLetterMessagesAsync", new[] { "orders" })]
    [InlineData("GET", Subscription + "/deadletter?count=5", Subscription + "/transferdeadletter?count=5", null, "PeekMessagesAsync", new[] { "events", "audit" })]
    [InlineData("POST", Subscription + "/deadletter/search", Subscription + "/transferdeadletter/search", Search, "SearchMessagesAsync", new[] { "events", "audit" })]
    [InlineData("POST", Subscription + "/deadletter/delete-batch", Subscription + "/transferdeadletter/delete-batch", Batch, "DeleteMessagesAsync", new[] { "events", "audit" })]
    [InlineData("POST", Subscription + "/deadletter/resubmit-batch", Subscription + "/transferdeadletter/resubmit-batch", Batch, "ResubmitDeadLetterMessagesAsync", new[] { "events", "audit" })]
    public async Task Each_transfer_dead_letter_route_answers_as_its_dead_letter_sibling_and_reads_the_transfer_dead_letter_queue(
        string method, string deadLetterPath, string transferPath, string? body, string providerMethod, string[] names)
    {
        var deadLetter = await SendAsync(method, deadLetterPath, body, ProviderAnswers);
        var transfer = await SendAsync(method, transferPath, body, ProviderAnswers);

        Assert.Equal((HttpStatusCode.OK, deadLetter.Body), (transfer.Status, transfer.Body));
        var call = Assert.Single(transfer.Calls);
        Assert.Equal(providerMethod, call.Method);
        Assert.Equal(names, call.Args.OfType<string>().ToArray());
        Assert.Equal(MessageSubQueue.TransferDeadLetter, call.Args.OfType<MessageSubQueue>().Single());
        Assert.Equal(MessageSubQueue.DeadLetter, Assert.Single(deadLetter.Calls).Args.OfType<MessageSubQueue>().Single());
        if (body == Batch) Assert.Equal(new long[] { 1, 2 }, call.Args.OfType<long[]>().Single());
    }

    [Theory]
    [InlineData("/api/queues/orders/transferdeadletter/delete-batch")]
    [InlineData(Subscription + "/transferdeadletter/delete-batch")]
    public async Task A_transfer_dead_letter_delete_batch_accepts_the_body_with_all_false_and_deletes_only_the_selection(string path)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[1,2],"all":false}""", ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(new long[] { 1, 2 }, call.Args.OfType<long[]>().Single());
        Assert.False(call.Args.OfType<bool>().Single());
    }

    [Theory]
    [InlineData("/api/queues/orders/transferdeadletter/delete-batch")]
    [InlineData(Subscription + "/transferdeadletter/delete-batch")]
    public async Task A_transfer_dead_letter_delete_batch_with_all_true_answers_400_and_is_never_called(string path)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[],"all":true}""", ProviderAnswers);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"all must be false for the transfer dead-letter queue."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData("GET", "/api/queues/orders/messages", null)]
    [InlineData("GET", Subscription + "/messages", null)]
    [InlineData("GET", "/api/queues/orders/transferdeadletter", null)]
    [InlineData("GET", Subscription + "/transferdeadletter", null)]
    [InlineData("POST", "/api/queues/orders/messages/search", Search)]
    [InlineData("POST", Subscription + "/transferdeadletter/search", Search)]
    public async Task A_peek_or_a_search_hands_the_provider_the_request_token_so_an_aborted_request_stops_it(string method, string path, string? body)
    {
        var answered = await SendAsync(method, path, body, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.True(Assert.Single(answered.Calls).Args.OfType<CancellationToken>().Single().CanBeCanceled);
    }

    [Fact]
    public async Task A_transfer_dead_letter_batch_hands_the_provider_the_request_token()
    {
        var answered = await SendAsync("POST", "/api/queues/orders/transferdeadletter/resubmit-batch", Batch, ProviderAnswers);

        Assert.True(Assert.Single(answered.Calls).Args.OfType<CancellationToken>().Single().CanBeCanceled);
    }

    [Theory]
    [InlineData("GET", "/api/queues/orders/transferdeadletter", null)]
    [InlineData("POST", "/api/queues/orders/transferdeadletter/search", Search)]
    [InlineData("POST", "/api/queues/orders/transferdeadletter/delete-batch", Batch)]
    [InlineData("POST", "/api/queues/orders/transferdeadletter/resubmit-batch", Batch)]
    [InlineData("GET", Subscription + "/transferdeadletter", null)]
    [InlineData("POST", Subscription + "/transferdeadletter/search", Search)]
    [InlineData("POST", Subscription + "/transferdeadletter/delete-batch", Batch)]
    [InlineData("POST", Subscription + "/transferdeadletter/resubmit-batch", Batch)]
    public async Task A_provider_without_the_transfer_dead_letter_queue_answers_400_and_is_never_called(string method, string path, string? body)
    {
        var answered = await SendAsync(method, path, body, ProviderAnswers, ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This provider does not support the transfer dead-letter queue."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Fact]
    public async Task Cancelling_scheduled_messages_answers_the_result_per_sequence_number_in_the_delete_batch_shape()
    {
        var answered = await SendAsync("POST", "/api/queues/orders/messages/cancel-scheduled", """{"sequenceNumbers":[12,13]}""",
            (m, _) => m.Name == nameof(IMessagingProvider.CancelScheduledMessagesAsync)
                ? Task.FromResult(new BatchOperationResult
                {
                    SuccessCount = 1,
                    FailureCount = 1,
                    Failures = { new BatchOperationFailure { SequenceNumber = 13, Error = "This message is not scheduled any more." } }
                })
                : null);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"successCount":1,"failureCount":1,"failures":[{"sequenceNumber":13,"error":"This message is not scheduled any more."}],"success":false}""", answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.CancelScheduledMessagesAsync), "orders"), (call.Method, call.Args[0]));
        Assert.Equal(new long[] { 12, 13 }, call.Args[1]);
        Assert.True(((CancellationToken)call.Args[2]!).CanBeCanceled);
    }

    [Fact]
    public async Task A_cancel_the_provider_refuses_before_the_broker_answers_400_with_its_text_naming_the_field()
    {
        var answered = await SendAsync("POST", "/api/queues/orders/messages/cancel-scheduled", """{"sequenceNumbers":[]}""",
            Fails(nameof(IMessagingProvider.CancelScheduledMessagesAsync),
                new InvalidEntityConfigurationException(["sequenceNumbers must hold 1 to 500 sequence numbers."])));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"sequenceNumbers must hold 1 to 500 sequence numbers."}""", answered.Body);
    }

    [Fact]
    public async Task A_provider_without_scheduled_messages_answers_400_to_a_cancel_and_is_never_called()
    {
        var answered = await SendAsync("POST", "/api/queues/orders/messages/cancel-scheduled", """{"sequenceNumbers":[12]}""", null, ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This provider does not support scheduled messages."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Fact]
    public async Task A_cancel_that_fails_for_another_reason_answers_the_constant_500_and_nothing_of_the_broker()
    {
        var answered = await SendAsync("POST", "/api/queues/orders/messages/cancel-scheduled", """{"sequenceNumbers":[12]}""",
            Fails(nameof(IMessagingProvider.CancelScheduledMessagesAsync), new TimeoutException(Sentinel)));

        Assert.Equal(HttpStatusCode.InternalServerError, answered.Status);
        Assert.Equal("""{"message":"An internal error occurred."}""", answered.Body);
    }

    [Theory]
    [InlineData("POST", "/api/queues/orders/messages", """{"body":"b"}""", "SendMessageAsync")]
    [InlineData("POST", "/api/topics/events/messages", """{"body":"b"}""", "SendMessageAsync")]
    [InlineData("POST", "/api/queues/orders/messages/batch", """[{"body":"b"}]""", "SendMessagesAsync")]
    [InlineData("POST", "/api/queues/orders/messages/receive", null, "ReceiveMessagesAsync")]
    [InlineData("POST", Subscription + "/messages/receive", null, "ReceiveMessagesAsync")]
    [InlineData("GET", "/api/queues/orders/messages", null, "PeekMessagesAsync")]
    [InlineData("GET", "/api/queues/orders/deadletter", null, "PeekMessagesAsync")]
    [InlineData("GET", "/api/queues/orders/transferdeadletter", null, "PeekMessagesAsync")]
    [InlineData("GET", Subscription + "/messages", null, "PeekMessagesAsync")]
    [InlineData("POST", "/api/queues/orders/messages/search", Search, "SearchMessagesAsync")]
    [InlineData("POST", Subscription + "/transferdeadletter/search", Search, "SearchMessagesAsync")]
    [InlineData("POST", "/api/queues/orders/deadletter/7/resubmit", null, "ResubmitDeadLetterMessageAsync")]
    [InlineData("POST", Subscription + "/deadletter/7/resubmit", null, "ResubmitDeadLetterMessageAsync")]
    [InlineData("POST", "/api/queues/orders/deadletter/resubmit-batch", Batch, "ResubmitDeadLetterMessagesAsync")]
    [InlineData("POST", Subscription + "/transferdeadletter/resubmit-batch", Batch, "ResubmitDeadLetterMessagesAsync")]
    [InlineData("POST", "/api/queues/orders/messages/delete-batch", Batch, "DeleteMessagesAsync")]
    [InlineData("POST", Subscription + "/deadletter/delete-batch", Batch, "DeleteMessagesAsync")]
    [InlineData("POST", "/api/queues/orders/messages/move-batch", """{"targetQueueName":"archive","sequenceNumbers":[1]}""", "MoveMessagesAsync")]
    [InlineData("POST", Subscription + "/deadletter/move-batch", """{"targetQueueName":"archive","sequenceNumbers":[1]}""", "MoveMessagesAsync")]
    [InlineData("DELETE", "/api/queues/orders/messages", null, "PurgeMessagesAsync")]
    [InlineData("DELETE", Subscription + "/deadletter", null, "PurgeMessagesAsync")]
    [InlineData("POST", "/api/queues/orders/messages/cancel-scheduled", """{"sequenceNumbers":[12]}""", "CancelScheduledMessagesAsync")]
    public async Task A_disabled_entity_answers_409_with_the_fixed_text_on_every_message_route(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new EntityDisabledException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.Conflict, answered.Status);
        Assert.Equal("""{"message":"The entity is disabled for this operation."}""", answered.Body);
    }

    [Theory]
    [InlineData("AzureServiceBus", true, false)]
    [InlineData("RabbitMQ", false, false)]
    public async Task The_capabilities_say_whether_the_provider_has_the_transfer_dead_letter_queue_and_no_longer_promise_deferral(
        string providerType, bool transferDeadLetter, bool deferral)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync($"/api/connections/providers/{providerType}/capabilities");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal((transferDeadLetter, deferral),
            (json.RootElement.GetProperty("supportsTransferDeadLetter").GetBoolean(), json.RootElement.GetProperty("supportsDeferral").GetBoolean()));
    }

    [Theory]
    [InlineData("GET", "/api/queues/orders/transferdeadletter")]
    [InlineData("POST", "/api/queues/orders/transferdeadletter/search")]
    [InlineData("POST", "/api/queues/orders/transferdeadletter/delete-batch")]
    [InlineData("POST", "/api/queues/orders/transferdeadletter/resubmit-batch")]
    [InlineData("GET", Subscription + "/transferdeadletter")]
    [InlineData("POST", Subscription + "/transferdeadletter/search")]
    [InlineData("POST", Subscription + "/transferdeadletter/delete-batch")]
    [InlineData("POST", Subscription + "/transferdeadletter/resubmit-batch")]
    [InlineData("POST", "/api/queues/orders/messages/cancel-scheduled")]
    public async Task A_new_message_route_without_the_api_key_is_refused_with_401(string method, string path)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method == "POST") request.Content = new StringContent(Batch, Encoding.UTF8, "application/json");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    public static TheoryData<string, MessageSubQueue> DeadLetterPeekRoutes => new()
    {
        { "/api/queues/orders/deadletter", MessageSubQueue.DeadLetter },
        { "/api/queues/orders/transferdeadletter", MessageSubQueue.TransferDeadLetter },
        { Subscription + "/deadletter", MessageSubQueue.DeadLetter },
        { Subscription + "/transferdeadletter", MessageSubQueue.TransferDeadLetter }
    };

    [Theory]
    [MemberData(nameof(DeadLetterPeekRoutes))]
    public async Task A_dead_letter_peek_with_fromSequenceNumber_hands_the_provider_that_position_with_the_count_and_the_sub_queue(string path, MessageSubQueue subQueue)
    {
        var answered = await SendAsync("GET", path + "?count=5&fromSequenceNumber=42", null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.PeekMessagesAsync), 5, subQueue),
            (call.Method, call.Args.OfType<int>().Single(), call.Args.OfType<MessageSubQueue>().Single()));
        Assert.Equal(42L, Assert.Single(call.Args.OfType<long>()));
    }

    [Theory]
    [MemberData(nameof(DeadLetterPeekRoutes))]
    public async Task A_dead_letter_peek_from_position_0_reads_from_sequence_number_0(string path, MessageSubQueue subQueue)
    {
        var answered = await SendAsync("GET", path + "?fromSequenceNumber=0", null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(subQueue, call.Args.OfType<MessageSubQueue>().Single());
        Assert.Equal(0L, Assert.Single(call.Args.OfType<long>()));
    }

    [Theory]
    [InlineData("/api/queues/orders/deadletter?count=5")]
    [InlineData("/api/queues/orders/deadletter?count=5&fromSequenceNumber=")]
    [InlineData("/api/queues/orders/transferdeadletter?count=5")]
    [InlineData(Subscription + "/deadletter?count=5")]
    [InlineData(Subscription + "/transferdeadletter?count=5")]
    public async Task A_dead_letter_peek_without_fromSequenceNumber_reads_from_the_head_as_before(string path)
    {
        var answered = await SendAsync("GET", path, null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(5, call.Args.OfType<int>().Single());
        Assert.Empty(call.Args.OfType<long>());
    }

    [Theory]
    [InlineData("/api/queues/orders/deadletter", "-1")]
    [InlineData("/api/queues/orders/transferdeadletter", "-1")]
    [InlineData(Subscription + "/deadletter", "-1")]
    [InlineData(Subscription + "/transferdeadletter", "-1")]
    [InlineData("/api/queues/orders/deadletter", "abc")]
    [InlineData("/api/queues/orders/deadletter", "1.5")]
    [InlineData("/api/queues/orders/deadletter", "%2B3")]
    [InlineData("/api/queues/orders/deadletter", "%203")]
    [InlineData("/api/queues/orders/deadletter", "1e3")]
    [InlineData("/api/queues/orders/deadletter", "99999999999999999999")]
    public async Task A_dead_letter_peek_whose_fromSequenceNumber_is_not_a_whole_number_of_0_or_more_answers_400_naming_the_field_and_is_never_called(
        string path, string value)
    {
        var answered = await SendAsync("GET", $"{path}?fromSequenceNumber={value}", null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"fromSequenceNumber must be a whole number of 0 or more."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [MemberData(nameof(DeadLetterPeekRoutes))]
    public async Task A_provider_that_cannot_read_from_a_position_answers_400_with_that_text_to_a_dead_letter_peek_with_fromSequenceNumber_and_is_never_called(
        string path, MessageSubQueue _)
    {
        var answered = await SendAsync("GET", path + "?fromSequenceNumber=3", null, ProviderAnswers, ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This provider cannot read the dead-letter queue from a position."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData("/api/queues/orders/deadletter")]
    [InlineData(Subscription + "/deadletter")]
    public async Task A_provider_that_cannot_read_from_a_position_still_peeks_the_dead_letter_queue_from_the_head(string path)
    {
        var answered = await SendAsync("GET", path, null, ProviderAnswers, ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Empty(Assert.Single(answered.Calls).Args.OfType<long>());
    }

    [Theory]
    [MemberData(nameof(DeadLetterPeekRoutes))]
    public async Task A_dead_letter_peek_from_a_position_that_fails_answers_the_same_constant_500_as_a_failed_peek_from_the_head(string path, MessageSubQueue _)
    {
        var failing = Fails(nameof(IMessagingProvider.PeekMessagesAsync), new TimeoutException(Sentinel));

        var fromHead = await SendAsync("GET", path, null, failing);
        var fromPosition = await SendAsync("GET", path + "?fromSequenceNumber=3", null, failing);

        Assert.Equal((HttpStatusCode.InternalServerError, """{"message":"An internal error occurred."}"""), (fromPosition.Status, fromPosition.Body));
        Assert.Equal((fromHead.Status, fromHead.Body), (fromPosition.Status, fromPosition.Body));
        Assert.Equal(3L, Assert.Single(Assert.Single(fromPosition.Calls).Args.OfType<long>()));
    }

    [Theory]
    [InlineData("AzureServiceBus", true)]
    [InlineData("RabbitMQ", false)]
    public async Task The_capabilities_say_whether_the_provider_can_peek_from_a_sequence_number(string providerType, bool expected)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync($"/api/connections/providers/{providerType}/capabilities");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(json.RootElement.TryGetProperty("supportsPeekFromSequenceNumber", out var flag), "the capabilities answer has no supportsPeekFromSequenceNumber");
        Assert.Equal(expected, flag.GetBoolean());
    }

    [Theory]
    [MemberData(nameof(DeadLetterPeekRoutes))]
    public async Task A_dead_letter_peek_with_fromSequenceNumber_without_the_api_key_is_refused_with_401(string path, MessageSubQueue _)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(path + "?fromSequenceNumber=3");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(DeadLetterPeekRoutes))]
    public async Task A_dead_letter_peek_with_includeBody_false_asks_the_provider_for_no_bodies_and_answers_body_null(string path, MessageSubQueue subQueue)
    {
        var answered = await SendAsync("GET", path + "?count=5&includeBody=false", null, (m, args) => m.Name == nameof(IMessagingProvider.PeekMessagesAsync)
            ? Task.FromResult<IEnumerable<IMessage>>(new List<MessageInfo>
            {
                new() { SequenceNumber = 7, Body = args.OfType<bool>().Single() ? "order" : null, Subject = "created", DeadLetterReason = "rejected" }
            })
            : null);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((5, subQueue), (call.Args.OfType<int>().Single(), call.Args.OfType<MessageSubQueue>().Single()));
        Assert.False(Assert.Single(call.Args.OfType<bool>()));
        using var json = JsonDocument.Parse(answered.Body);
        var message = Assert.Single(json.RootElement.EnumerateArray().ToList());
        Assert.Equal((JsonValueKind.Null, 7L, "created", "rejected"),
            (message.GetProperty("body").ValueKind, message.GetProperty("sequenceNumber").GetInt64(), message.GetProperty("subject").GetString(), message.GetProperty("deadLetterReason").GetString()));
    }

    [Theory]
    [InlineData("/api/queues/orders/deadletter?includeBody=true")]
    [InlineData("/api/queues/orders/deadletter")]
    [InlineData("/api/queues/orders/deadletter?includeBody=")]
    [InlineData("/api/queues/orders/transferdeadletter")]
    [InlineData(Subscription + "/deadletter")]
    [InlineData(Subscription + "/transferdeadletter?includeBody=true")]
    [InlineData("/api/queues/orders/messages")]
    [InlineData(Subscription + "/messages")]
    public async Task A_peek_with_includeBody_true_or_absent_asks_the_provider_for_the_bodies_as_before(string path)
    {
        var answered = await SendAsync("GET", path, null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.True(Assert.Single(Assert.Single(answered.Calls).Args.OfType<bool>()));
        Assert.Contains("\"body\":\"order\"", answered.Body);
    }

    [Theory]
    [InlineData("/api/queues/orders/deadletter", "False")]
    [InlineData("/api/queues/orders/transferdeadletter", "0")]
    [InlineData(Subscription + "/deadletter", "yes")]
    [InlineData(Subscription + "/transferdeadletter", "1")]
    [InlineData("/api/queues/orders/deadletter", "%20false")]
    [InlineData("/api/queues/orders/deadletter", "TRUE")]
    public async Task A_dead_letter_peek_whose_includeBody_is_not_true_or_false_answers_400_naming_the_field_and_is_never_called(string path, string value)
    {
        var answered = await SendAsync("GET", $"{path}?includeBody={value}", null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"includeBody must be true or false."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }
}
