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
        nameof(IMessagingProvider.DeleteMessagesAsync) or nameof(IMessagingProvider.ResubmitDeadLetterMessagesAsync) or nameof(IMessagingProvider.MoveMessagesAsync)
            or nameof(IMessagingProvider.DeleteDeferredMessagesAsync) or nameof(IMessagingProvider.ResubmitDeferredMessagesAsync) or nameof(IMessagingProvider.DeadLetterDeferredMessagesAsync) => Task.FromResult(new BatchOperationResult
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
    [InlineData("/api/queues/orders/deadletter/resubmit-batch", """{"sequenceNumbers":[1]""", "ResubmitDeadLetterMessagesAsync")]
    [InlineData(Subscription + "/transferdeadletter/resubmit-batch", """{"sequenceNumbers":[1]""", "ResubmitDeadLetterMessagesAsync")]
    [InlineData("/api/queues/orders/messages/move-batch", """{"targetQueueName":"archive","sequenceNumbers":[1]""", "MoveMessagesAsync")]
    [InlineData(Subscription + "/deadletter/move-batch", """{"targetQueueName":"archive","sequenceNumbers":[1]""", "MoveMessagesAsync")]
    public async Task A_resubmit_or_move_batch_hands_the_provider_the_new_message_id_choice_and_leaves_it_off_when_the_body_omits_it(string path, string bodyStart, string providerMethod)
    {
        var optedIn = await SendAsync("POST", path, bodyStart + ""","newMessageIdOnDuplicateDetection":true}""", ProviderAnswers);
        var omitted = await SendAsync("POST", path, bodyStart + "}", ProviderAnswers);

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (optedIn.Status, omitted.Status));
        Assert.Equal(providerMethod, Assert.Single(optedIn.Calls).Method);
        Assert.True(Assert.Single(optedIn.Calls).Args.OfType<bool>().Single(), "A request that asks for new message ids on a duplicate-detecting target must hand that choice to the provider.");
        Assert.False(Assert.Single(omitted.Calls).Args.OfType<bool>().Single(), "A request without the flag must keep the original message ids, so a duplicate-detecting target refuses it.");
    }

    [Theory]
    [InlineData("/api/queues/orders/deadletter/7/resubmit")]
    [InlineData(Subscription + "/deadletter/7/resubmit")]
    public async Task A_single_resubmit_hands_the_provider_the_new_message_id_choice_and_leaves_it_off_without_a_body(string path)
    {
        var optedIn = await SendAsync("POST", path, """{"newMessageIdOnDuplicateDetection":true}""", ProviderAnswers);
        var omitted = await SendAsync("POST", path, null, ProviderAnswers);

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (optedIn.Status, omitted.Status));
        Assert.True(Assert.Single(optedIn.Calls).Args.OfType<bool>().Single(), "A single resubmit that asks for a new message id must hand that choice to the provider.");
        Assert.False(Assert.Single(omitted.Calls).Args.OfType<bool>().Single(), "A single resubmit without a body must keep the original message id, so a duplicate-detecting target refuses it.");
    }

    [Theory]
    [InlineData("/api/queues/orders/deadletter/7/resubmit")]
    [InlineData(Subscription + "/deadletter/7/resubmit")]
    public async Task A_refused_single_resubmit_answers_400_with_the_fixed_refusal_text(string path)
    {
        const string refusal = "The target detects duplicates; a copy with the same message id would be dropped. Nothing was sent or removed.";

        var answered = await SendAsync("POST", path, null, Fails("ResubmitDeadLetterMessageAsync", new InvalidEntityConfigurationException([refusal])));

        Assert.True(answered.Status == HttpStatusCode.BadRequest && answered.Body == "{\"message\":\"" + refusal + "\"}",
            $"A single resubmit the provider refused must answer 400 with its fixed text, so the app can offer a new id; got {(int)answered.Status} {answered.Body}");
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

    [Theory]
    [InlineData("/api/queues/orders/messages/cancel-scheduled", "orders")]
    [InlineData("/api/topics/events/messages/cancel-scheduled", "events")]
    public async Task Cancelling_scheduled_messages_of_a_queue_or_a_topic_answers_the_result_per_sequence_number_in_the_delete_batch_shape(string path, string entity)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[12,13]}""",
            (m, _) => m.Name == nameof(IMessagingProvider.CancelScheduledMessagesAsync)
                ? Task.FromResult(new BatchOperationResult
                {
                    SuccessCount = 1,
                    FailureCount = 1,
                    Failures = { new BatchOperationFailure { SequenceNumber = 13, Error = "This message is not scheduled any more." } }
                })
                : null);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"successCount":1,"failureCount":1,"failures":[{"sequenceNumber":13,"error":"This message is not scheduled any more."}],"newMessageIds":{},"unselectedDeliveryCountRaised":0,"unselectedDeadLettered":[],"success":false}""", answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.CancelScheduledMessagesAsync), entity), (call.Method, call.Args[0]));
        Assert.Equal(new long[] { 12, 13 }, call.Args[1]);
        Assert.True(((CancellationToken)call.Args[2]!).CanBeCanceled);
    }

    [Theory]
    [InlineData("/api/queues/orders/messages/cancel-scheduled")]
    [InlineData("/api/topics/events/messages/cancel-scheduled")]
    public async Task A_cancel_the_provider_refuses_before_the_broker_answers_400_with_its_text_naming_the_field(string path)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[]}""",
            Fails(nameof(IMessagingProvider.CancelScheduledMessagesAsync),
                new InvalidEntityConfigurationException(["sequenceNumbers must hold 1 to 500 sequence numbers."])));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"sequenceNumbers must hold 1 to 500 sequence numbers."}""", answered.Body);
    }

    [Theory]
    [InlineData("/api/queues/orders/messages/cancel-scheduled")]
    [InlineData("/api/topics/events/messages/cancel-scheduled")]
    public async Task A_provider_without_scheduled_messages_answers_400_to_a_cancel_and_is_never_called(string path)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[12]}""", null, ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This provider does not support scheduled messages."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData("/api/queues/orders/messages/cancel-scheduled")]
    [InlineData("/api/topics/events/messages/cancel-scheduled")]
    public async Task A_cancel_that_fails_for_another_reason_answers_the_constant_500_and_nothing_of_the_broker(string path)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[12]}""",
            Fails(nameof(IMessagingProvider.CancelScheduledMessagesAsync), new TimeoutException(Sentinel)));

        Assert.Equal(HttpStatusCode.InternalServerError, answered.Status);
        Assert.Equal("""{"message":"An internal error occurred."}""", answered.Body);
    }

    [Theory]
    [InlineData("POST", "/api/queues/orders/messages", """{"body":"b"}""", "SendMessageAsync")]
    [InlineData("POST", "/api/topics/events/messages", """{"body":"b"}""", "SendMessageAsync")]
    [InlineData("POST", "/api/queues/orders/messages/batch", """[{"body":"b"}]""", "SendMessagesAsync")]
    [InlineData("POST", "/api/topics/events/messages/batch", """[{"body":"b"}]""", "SendMessagesAsync")]
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
    [InlineData("POST", "/api/topics/events/messages/cancel-scheduled", """{"sequenceNumbers":[12]}""", "CancelScheduledMessagesAsync")]
    public async Task A_disabled_entity_answers_409_with_the_fixed_text_on_every_message_route(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new EntityDisabledException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.Conflict, answered.Status);
        Assert.Equal("""{"message":"The entity is disabled for this operation."}""", answered.Body);
    }

    [Theory]
    [InlineData("/api/queues/orders/messages", "orders")]
    [InlineData("/api/topics/events/messages", "events")]
    public async Task A_scheduled_send_answers_the_sequence_number_the_broker_gave_it_so_the_message_can_be_cancelled_later(string path, string entity)
    {
        var answered = await SendAsync("POST", path, """{"body":"b","scheduledEnqueueTime":"2030-01-01T00:00:00Z"}""",
            (m, _) => m.Name == nameof(IMessagingProvider.SendMessageAsync) ? Task.FromResult<long?>(42) : null);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"success":true,"sequenceNumber":42}""", answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.SendMessageAsync), entity), (call.Method, call.Args[0]));
    }

    [Fact]
    public async Task A_send_without_a_time_answers_success_with_no_sequence_number()
    {
        var answered = await SendAsync("POST", "/api/topics/events/messages", """{"body":"b"}""");

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"success":true,"sequenceNumber":null}""", answered.Body);
    }

    private static object? SendAnswers(MethodInfo m, object?[] _) => m.Name == nameof(IMessagingProvider.SendMessagesAsync)
        ? Task.FromResult(new SendMessagesResult
        {
            SentCount = 2,
            Failures = { new SendMessageFailure { Index = 2, Error = SendMessageFailure.Unconfirmed } }
        })
        : null;

    [Theory]
    [InlineData("/api/queues/orders/messages/batch", "orders")]
    [InlineData("/api/topics/events/messages/batch", "events")]
    public async Task A_batch_send_to_a_queue_or_a_topic_reaches_the_provider_and_answers_the_count_sent_and_each_failure(string path, string entity)
    {
        var answered = await SendAsync("POST", path, """[{"body":"a"},{"body":"b"},{"body":"c"}]""", SendAnswers);

        Assert.True(answered.Status == HttpStatusCode.OK,
            $"A batch send to {path} must be routed and answered 200; got {(int)answered.Status}.");
        Assert.Equal(
            """{"success":false,"count":2,"failures":[{"index":2,"error":"The broker did not confirm this message; it may have been sent."}]}""",
            answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(nameof(IMessagingProvider.SendMessagesAsync), call.Method);
        Assert.Equal(entity, call.Args[0]);
        Assert.Equal(["a", "b", "c"], ((IEnumerable<SendMessageRequest>)call.Args[1]!).Select(r => r.Body));
        Assert.True(call.Args[2] is CancellationToken { CanBeCanceled: true },
            "The batch send must hand the provider the request's token, so an abandoned request stops between batches.");
    }

    [Theory]
    [InlineData("/api/queues/orders/messages/batch", 0)]
    [InlineData("/api/queues/orders/messages/batch", 1001)]
    [InlineData("/api/topics/events/messages/batch", 0)]
    [InlineData("/api/topics/events/messages/batch", 1001)]
    public async Task A_batch_send_outside_1_to_1000_messages_is_refused_with_400_before_the_provider_is_called(string path, int count)
    {
        var body = "[" + string.Join(",", Enumerable.Repeat("""{"body":"b"}""", count)) + "]";

        var answered = await SendAsync("POST", path, body, SendAnswers);

        Assert.True(answered.Status == HttpStatusCode.BadRequest && answered.Calls.Count == 0,
            $"A batch send of {count} messages must be refused with 400 before any broker call; got {(int)answered.Status} with {answered.Calls.Count} provider calls.");
        Assert.Equal("""{"message":"A batch send holds 1 to 1000 messages."}""", answered.Body);
    }

    [Theory]
    [InlineData("/api/queues/orders/messages/batch")]
    [InlineData("/api/topics/events/messages/batch")]
    public async Task A_batch_send_of_exactly_1000_messages_reaches_the_provider(string path)
    {
        var body = "[" + string.Join(",", Enumerable.Repeat("""{"body":"b"}""", 1000)) + "]";

        var answered = await SendAsync("POST", path, body, SendAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal(1000, ((IEnumerable<SendMessageRequest>)Assert.Single(answered.Calls).Args[1]!).Count());
    }

    [Theory]
    [InlineData("/api/queues/orders/messages/batch")]
    [InlineData("/api/topics/events/messages/batch")]
    public async Task A_batch_send_that_fails_before_anything_was_sent_answers_the_constant_500_and_nothing_of_the_broker(string path)
    {
        var answered = await SendAsync("POST", path, """[{"body":"b"}]""",
            Fails(nameof(IMessagingProvider.SendMessagesAsync), new TimeoutException(Sentinel)));

        Assert.Equal(HttpStatusCode.InternalServerError, answered.Status);
        Assert.Equal("""{"message":"An internal error occurred."}""", answered.Body);
    }

    [Fact]
    public async Task A_topic_batch_send_without_the_api_key_is_refused_with_401()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsync("/api/topics/events/messages/batch",
            new StringContent("""[{"body":"b"}]""", System.Text.Encoding.UTF8, "application/json"));

        Assert.True(response.StatusCode == HttpStatusCode.Unauthorized,
            $"The topic batch route must sit behind the key middleware like every route; got {(int)response.StatusCode}.");
    }

    [Theory]
    [InlineData("AzureServiceBus")]
    [InlineData("RabbitMQ")]
    public async Task The_capabilities_promise_no_transactions_since_no_code_of_either_provider_runs_one(string providerType)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync($"/api/connections/providers/{providerType}/capabilities");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(json.RootElement.GetProperty("supportsTransactions").GetBoolean(),
            $"{providerType} must not declare transactions: no code of the provider runs one.");
    }

    [Theory]
    [InlineData("AzureServiceBus", true, true)]
    [InlineData("RabbitMQ", false, false)]
    public async Task The_capabilities_say_whether_the_provider_has_the_transfer_dead_letter_queue_and_deferral(
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
    [InlineData("POST", "/api/topics/events/messages/cancel-scheduled")]
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

    [Theory]
    [InlineData("/api/queues/orders/messages")]
    [InlineData(Subscription + "/messages")]
    public async Task An_active_peek_with_fromSequenceNumber_hands_the_provider_that_position_so_the_active_queue_pages_past_1000(string path)
    {
        var answered = await SendAsync("GET", path + "?count=1000&fromSequenceNumber=1001", null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.True((call.Args.OfType<int>().Single(), call.Args.OfType<MessageSubQueue>().Single(), call.Args.OfType<long>().SingleOrDefault()) == (1000, MessageSubQueue.Active, 1001L),
            $"An active peek from a position must reach the provider with that position, the count and the active queue; got {string.Join(", ", call.Args)}");
    }

    [Theory]
    [InlineData("/api/queues/orders/messages")]
    [InlineData(Subscription + "/messages")]
    public async Task An_active_peek_without_fromSequenceNumber_still_reads_from_the_head(string path)
    {
        var answered = await SendAsync("GET", path + "?count=5", null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Empty(Assert.Single(answered.Calls).Args.OfType<long>());
    }

    [Theory]
    [InlineData("/api/queues/orders/messages")]
    [InlineData(Subscription + "/messages")]
    public async Task A_provider_that_cannot_read_from_a_position_answers_400_naming_the_queue_to_an_active_peek_with_fromSequenceNumber_and_is_never_called(string path)
    {
        var answered = await SendAsync("GET", path + "?fromSequenceNumber=3", null, ProviderAnswers, ProviderType.RabbitMQ);

        Assert.Equal((HttpStatusCode.BadRequest, """{"message":"This provider cannot read the queue from a position."}"""), (answered.Status, answered.Body));
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData("/api/queues/orders/messages", "-1")]
    [InlineData(Subscription + "/messages", "abc")]
    public async Task An_active_peek_whose_fromSequenceNumber_is_not_a_whole_number_of_0_or_more_answers_400_and_is_never_called(string path, string value)
    {
        var answered = await SendAsync("GET", $"{path}?fromSequenceNumber={value}", null, ProviderAnswers);

        Assert.Equal((HttpStatusCode.BadRequest, """{"message":"fromSequenceNumber must be a whole number of 0 or more."}"""), (answered.Status, answered.Body));
        Assert.Empty(answered.Calls);
    }

    public static TheoryData<string, string, string[]> DeferredRoutes => new()
    {
        { "/api/queues/orders/deferred/delete-batch", nameof(IMessagingProvider.DeleteDeferredMessagesAsync), ["orders"] },
        { "/api/queues/orders/deferred/resubmit-batch", nameof(IMessagingProvider.ResubmitDeferredMessagesAsync), ["orders"] },
        { "/api/queues/orders/deferred/deadletter-batch", nameof(IMessagingProvider.DeadLetterDeferredMessagesAsync), ["orders"] },
        { Subscription + "/deferred/delete-batch", nameof(IMessagingProvider.DeleteDeferredMessagesAsync), ["events", "audit"] },
        { Subscription + "/deferred/resubmit-batch", nameof(IMessagingProvider.ResubmitDeferredMessagesAsync), ["events", "audit"] },
        { Subscription + "/deferred/deadletter-batch", nameof(IMessagingProvider.DeadLetterDeferredMessagesAsync), ["events", "audit"] }
    };

    public static TheoryData<string> DeferredPaths => new(DeferredRoutes.Select(row => (string)row[0]));

    [Theory]
    [MemberData(nameof(DeferredRoutes))]
    public async Task A_deferred_batch_route_hands_the_provider_the_entity_the_numbers_and_the_request_token_and_answers_the_result_per_sequence_number(
        string path, string providerMethod, string[] names)
    {
        var answered = await SendAsync("POST", path, Batch, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"successCount":1,"failureCount":1,"failures":[{"sequenceNumber":2,"error":"Not found within scan window"}],"newMessageIds":{},"unselectedDeliveryCountRaised":0,"unselectedDeadLettered":[],"success":false}""", answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(providerMethod, call.Method);
        Assert.Equal(names, call.Args.OfType<string>().ToArray());
        Assert.Equal(new long[] { 1, 2 }, call.Args.OfType<long[]>().Single());
        Assert.True(call.Args.OfType<CancellationToken>().Single().CanBeCanceled, "The request token must reach the provider so an aborted request stops the batch.");
    }

    [Theory]
    [InlineData("/api/queues/orders/deferred/resubmit-batch")]
    [InlineData(Subscription + "/deferred/resubmit-batch")]
    public async Task A_deferred_resubmit_hands_the_provider_the_new_message_id_choice(string path)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[1],"newMessageIdOnDuplicateDetection":true}""", ProviderAnswers);

        Assert.True(Assert.Single(answered.Calls).Args.OfType<bool>().Single(), "A deferred resubmit that asks for new message ids must hand that choice to the provider.");
    }

    [Theory]
    [InlineData("/api/queues/orders/deferred/deadletter-batch")]
    [InlineData(Subscription + "/deferred/deadletter-batch")]
    public async Task A_deferred_dead_letter_hands_the_provider_the_reason_and_the_description(string path)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[1],"reason":"bad-data","description":"rejected by the operator"}""", ProviderAnswers);

        var strings = Assert.Single(answered.Calls).Args.OfType<string>().ToArray();
        Assert.True(strings[^2..].SequenceEqual(new[] { "bad-data", "rejected by the operator" }), $"The reason and description must reach the provider; got {string.Join(", ", strings)}");
    }

    [Theory]
    [MemberData(nameof(DeferredPaths))]
    public async Task A_deferred_batch_above_1000_or_without_a_number_answers_400_naming_the_field_and_is_never_called(string path)
    {
        var tooMany = await SendAsync("POST", path, JsonSerializer.Serialize(new { sequenceNumbers = Enumerable.Range(1, 1001) }), ProviderAnswers);
        var none = await SendAsync("POST", path, """{"sequenceNumbers":[]}""", ProviderAnswers);

        foreach (var answered in new[] { tooMany, none })
        {
            Assert.Equal((HttpStatusCode.BadRequest, """{"message":"sequenceNumbers must hold 1 to 1000 sequence numbers."}"""), (answered.Status, answered.Body));
            Assert.Empty(answered.Calls);
        }
    }

    [Theory]
    [MemberData(nameof(DeferredRoutes))]
    public async Task A_deferred_batch_of_exactly_1000_numbers_reaches_the_provider(string path, string providerMethod, string[] _)
    {
        var answered = await SendAsync("POST", path, JsonSerializer.Serialize(new { sequenceNumbers = Enumerable.Range(1, 1000) }), ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal((providerMethod, 1000), (Assert.Single(answered.Calls).Method, answered.Calls[0].Args.OfType<long[]>().Single().Length));
    }

    [Theory]
    [MemberData(nameof(DeferredPaths))]
    public async Task A_provider_without_deferral_answers_400_to_a_deferred_batch_and_is_never_called(string path)
    {
        var answered = await SendAsync("POST", path, Batch, ProviderAnswers, ProviderType.RabbitMQ);

        Assert.Equal((HttpStatusCode.BadRequest, """{"message":"This provider does not support deferred messages."}"""), (answered.Status, answered.Body));
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [MemberData(nameof(DeferredRoutes))]
    public async Task A_deferred_batch_the_provider_refuses_answers_400_with_its_text(string path, string providerMethod, string[] _)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[1,1]}""",
            Fails(providerMethod, new InvalidEntityConfigurationException(["sequenceNumbers must not repeat a sequence number."])));

        Assert.Equal((HttpStatusCode.BadRequest, """{"message":"sequenceNumbers must not repeat a sequence number."}"""), (answered.Status, answered.Body));
    }

    [Theory]
    [MemberData(nameof(DeferredRoutes))]
    public async Task A_deferred_batch_on_a_disabled_entity_answers_409_with_the_fixed_text(string path, string providerMethod, string[] _)
    {
        var answered = await SendAsync("POST", path, Batch, Fails(providerMethod, new EntityDisabledException(new Exception(Sentinel))));

        Assert.Equal((HttpStatusCode.Conflict, """{"message":"The entity is disabled for this operation."}"""), (answered.Status, answered.Body));
    }

    [Theory]
    [MemberData(nameof(DeferredRoutes))]
    public async Task A_deferred_batch_that_fails_for_another_reason_answers_the_constant_500_and_nothing_of_the_broker(string path, string providerMethod, string[] _)
    {
        var answered = await SendAsync("POST", path, Batch, Fails(providerMethod, new TimeoutException(Sentinel)));

        Assert.Equal((HttpStatusCode.InternalServerError, """{"message":"An internal error occurred."}"""), (answered.Status, answered.Body));
    }

    [Theory]
    [MemberData(nameof(DeferredPaths))]
    public async Task A_deferred_batch_without_the_api_key_is_refused_with_401(string path)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(path, new StringContent(Batch, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/queues/orders/messages")]
    [InlineData(Subscription + "/messages")]
    public async Task An_active_peek_with_fromSequenceNumber_without_the_api_key_is_refused_with_401(string path)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(path + "?fromSequenceNumber=3");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    public static TheoryData<string, string, string[]> ActiveSettleRoutes => new()
    {
        { "/api/queues/orders/messages/deadletter-batch", nameof(IMessagingProvider.DeadLetterMessagesAsync), ["orders"] },
        { "/api/queues/orders/messages/defer-batch", nameof(IMessagingProvider.DeferMessagesAsync), ["orders"] },
        { Subscription + "/messages/deadletter-batch", nameof(IMessagingProvider.DeadLetterMessagesAsync), ["events", "audit"] },
        { Subscription + "/messages/defer-batch", nameof(IMessagingProvider.DeferMessagesAsync), ["events", "audit"] }
    };

    public static TheoryData<string> ActiveSettlePaths => new(ActiveSettleRoutes.Select(row => (string)row[0]));

    private static object? ActiveSettleAnswers(MethodInfo m, object?[] _) => m.Name is nameof(IMessagingProvider.DeadLetterMessagesAsync) or nameof(IMessagingProvider.DeferMessagesAsync)
        ? Task.FromResult(new BatchOperationResult
        {
            SuccessCount = 1,
            FailureCount = 1,
            Failures = { new BatchOperationFailure { SequenceNumber = 2, Error = "Not found within scan window" } }
        })
        : null;

    [Theory]
    [MemberData(nameof(ActiveSettleRoutes))]
    public async Task An_active_dead_letter_or_defer_route_hands_the_provider_the_entity_the_numbers_and_the_request_token_and_answers_the_result_per_sequence_number(
        string path, string providerMethod, string[] names)
    {
        var answered = await SendAsync("POST", path, Batch, ActiveSettleAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""{"successCount":1,"failureCount":1,"failures":[{"sequenceNumber":2,"error":"Not found within scan window"}],"newMessageIds":{},"unselectedDeliveryCountRaised":0,"unselectedDeadLettered":[],"success":false}""", answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(providerMethod, call.Method);
        Assert.Equal(names, call.Args.OfType<string>().Take(names.Length).ToArray());
        Assert.Equal(new long[] { 1, 2 }, call.Args.OfType<long[]>().Single());
        Assert.True(call.Args.OfType<CancellationToken>().Single().CanBeCanceled, "The request token must reach the provider so an aborted request stops the scan.");
    }

    [Theory]
    [InlineData("/api/queues/orders/messages/deadletter-batch")]
    [InlineData(Subscription + "/messages/deadletter-batch")]
    public async Task An_active_dead_letter_hands_the_provider_the_reason_and_the_description(string path)
    {
        var answered = await SendAsync("POST", path, """{"sequenceNumbers":[1],"reason":"bad-data","description":"rejected by the operator"}""", ActiveSettleAnswers);

        var strings = Assert.Single(answered.Calls).Args.OfType<string>().ToArray();
        Assert.True(strings[^2..].SequenceEqual(new[] { "bad-data", "rejected by the operator" }), $"The reason and description must reach the provider; got {string.Join(", ", strings)}");
    }

    [Theory]
    [InlineData("/api/queues/orders/messages/deadletter-batch", "This provider does not support dead-lettering a message by sequence number.")]
    [InlineData(Subscription + "/messages/deadletter-batch", "This provider does not support dead-lettering a message by sequence number.")]
    [InlineData("/api/queues/orders/messages/defer-batch", "This provider does not support deferred messages.")]
    [InlineData(Subscription + "/messages/defer-batch", "This provider does not support deferred messages.")]
    public async Task A_provider_that_declares_no_dead_letter_or_deferral_answers_400_to_an_active_settle_and_is_never_called(string path, string text)
    {
        var answered = await SendAsync("POST", path, Batch, ActiveSettleAnswers, ProviderType.RabbitMQ);

        Assert.True((answered.Status, answered.Body) == (HttpStatusCode.BadRequest, "{\"message\":\"" + text + "\"}"),
            $"A provider that declares it cannot do the action must be refused with the fixed text before it is called; got {(int)answered.Status} {answered.Body}");
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [MemberData(nameof(ActiveSettlePaths))]
    public async Task An_active_settle_above_1000_or_without_a_number_answers_400_and_is_never_called(string path)
    {
        var tooMany = await SendAsync("POST", path, JsonSerializer.Serialize(new { sequenceNumbers = Enumerable.Range(1, 1001) }), ActiveSettleAnswers);
        var none = await SendAsync("POST", path, """{"sequenceNumbers":[]}""", ActiveSettleAnswers);

        foreach (var answered in new[] { tooMany, none })
        {
            Assert.Equal((HttpStatusCode.BadRequest, """{"message":"sequenceNumbers must hold 1 to 1000 sequence numbers."}"""), (answered.Status, answered.Body));
            Assert.Empty(answered.Calls);
        }
    }

    [Theory]
    [MemberData(nameof(ActiveSettleRoutes))]
    public async Task An_active_settle_on_a_disabled_entity_answers_409_and_another_failure_the_constant_500(string path, string providerMethod, string[] _)
    {
        var disabled = await SendAsync("POST", path, Batch, Fails(providerMethod, new EntityDisabledException(new Exception(Sentinel))));
        var failed = await SendAsync("POST", path, Batch, Fails(providerMethod, new TimeoutException(Sentinel)));

        Assert.Equal((HttpStatusCode.Conflict, """{"message":"The entity is disabled for this operation."}"""), (disabled.Status, disabled.Body));
        Assert.Equal((HttpStatusCode.InternalServerError, """{"message":"An internal error occurred."}"""), (failed.Status, failed.Body));
    }

    [Theory]
    [MemberData(nameof(ActiveSettlePaths))]
    public async Task An_active_settle_without_the_api_key_is_refused_with_401(string path)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(path, new StringContent(Batch, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    public static TheoryData<string, string> SendRoutes => new()
    {
        { "/api/queues/orders/messages", """{"body":"AP8=","bodyEncoding":"base64"}""" },
        { "/api/topics/events/messages", """{"body":"AP8=","bodyEncoding":"base64"}""" },
        { "/api/queues/orders/messages/batch", """[{"body":"AP8=","bodyEncoding":"base64"}]""" },
        { "/api/topics/events/messages/batch", """[{"body":"AP8=","bodyEncoding":"base64"}]""" }
    };

    private static object? SentAll(MethodInfo m, object?[] _) => m.Name == nameof(IMessagingProvider.SendMessagesAsync)
        ? Task.FromResult(new SendMessagesResult { SentCount = 1 })
        : null;

    [Theory]
    [MemberData(nameof(SendRoutes))]
    public async Task A_base64_body_reaches_the_provider_with_its_flag_on_a_provider_that_declares_binary_bodies(string path, string json)
    {
        var answered = await SendAsync("POST", path, json, SentAll);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var request = Assert.Single(answered.Calls).Args.SelectMany(a => a as IEnumerable<SendMessageRequest> ?? (a is SendMessageRequest r ? [r] : [])).Single();
        Assert.True((request.Body, request.BodyEncoding) == ("AP8=", "base64"), "A base64 body must reach the provider as sent, with its flag, so the provider sends the bytes it encodes.");
    }

    [Theory]
    [MemberData(nameof(SendRoutes))]
    public async Task A_base64_body_to_a_provider_without_binary_bodies_answers_400_and_is_never_sent(string path, string json)
    {
        var answered = await SendAsync("POST", path, json, SentAll, ProviderType.RabbitMQ);

        Assert.True((answered.Status, answered.Body) == (HttpStatusCode.BadRequest, """{"message":"This provider does not support a binary body."}"""),
            $"A provider that declares no binary body must refuse a base64 body, never send it as its text; got {(int)answered.Status} {answered.Body}");
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData("/api/queues/orders/messages", """{"body":"not base64!","bodyEncoding":"base64"}""", "A base64 body must be valid base64.")]
    [InlineData("/api/topics/events/messages/batch", """[{"body":"not base64!","bodyEncoding":"base64"}]""", "A base64 body must be valid base64.")]
    [InlineData("/api/queues/orders/messages/batch", """[{"body":"x","bodyEncoding":"hex"}]""", "bodyEncoding must be text or base64.")]
    [InlineData("/api/topics/events/messages", """{"body":"x","bodyEncoding":"hex"}""", "bodyEncoding must be text or base64.")]
    public async Task A_body_with_an_unknown_encoding_or_invalid_base64_answers_400_and_is_never_sent(string path, string json, string text)
    {
        var answered = await SendAsync("POST", path, json, SentAll);

        Assert.Equal((HttpStatusCode.BadRequest, "{\"message\":\"" + text + "\"}"), (answered.Status, answered.Body));
        Assert.Empty(answered.Calls);
    }

    [Fact]
    public async Task A_peeked_binary_body_reaches_the_web_app_with_its_base64_flag()
    {
        var answered = await SendAsync("GET", "/api/queues/orders/messages?count=1", null, (m, _) => m.Name == nameof(IMessagingProvider.PeekMessagesAsync)
            ? Task.FromResult<IEnumerable<IMessage>>(new List<MessageInfo> { new() { SequenceNumber = 7, Body = "AP8=", BodyEncoding = "base64", SizeInBytes = 2 } })
            : null);

        var message = JsonDocument.Parse(answered.Body).RootElement[0];
        Assert.True((message.GetProperty("body").GetString(), message.GetProperty("bodyEncoding").GetString()) == ("AP8=", "base64"),
            $"The peek answer must carry the base64 flag next to the body, or the app shows base64 as text; got {answered.Body}");
    }
}
