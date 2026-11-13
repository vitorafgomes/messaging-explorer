using System.Text;
using Azure.Messaging.ServiceBus;
using Moq;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// Sessions against a mocked <see cref="ServiceBusClient"/>: the list is a passive peek that accepts no session, and
/// opening one session (its state, its messages, a state write) accepts only that session and releases it on every
/// path, with a state that is never decoded lossily and never overwritten when it changed.
/// </summary>
public class AzureServiceBusProviderSessionTests
{
    private static readonly DateTimeOffset LockedUntil = new(2026, 11, 12, 23, 10, 0, TimeSpan.Zero);

    private static ServiceBusReceivedMessage Msg(long sequenceNumber, string? sessionId) =>
        ServiceBusModelFactory.ServiceBusReceivedMessage(
            body: BinaryData.FromString($"body-{sequenceNumber}"),
            sessionId: sessionId,
            sequenceNumber: sequenceNumber);

    private static IReadOnlyList<ServiceBusReceivedMessage> Batch(params ServiceBusReceivedMessage[] messages) => messages;

    private static ServiceBusException Broker(ServiceBusFailureReason reason) => new("broker detail TrackingId:abc", reason);

    /// <summary>A plain receiver that answers each peek with the next batch and records what each peek asked for.</summary>
    private static Mock<ServiceBusReceiver> Peeking(List<(int Max, long? From)> asked, params IReadOnlyList<ServiceBusReceivedMessage>[] batches)
    {
        var receiver = new Mock<ServiceBusReceiver>();
        var next = 0;
        receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .Callback((int max, long? from, CancellationToken _) => asked.Add((max, from)))
            .ReturnsAsync(() => next < batches.Length ? batches[next++] : Batch());
        return receiver;
    }

    /// <summary>A client whose accept hands out one mocked session receiver holding the given state.</summary>
    private sealed class FakeSessionBroker
    {
        public Mock<ServiceBusClient> Client { get; } = new();
        public Mock<ServiceBusSessionReceiver> Session { get; } = new();

        public FakeSessionBroker(byte[]? state = null)
        {
            Session.SetupGet(s => s.SessionId).Returns("order-1");
            Session.SetupGet(s => s.SessionLockedUntil).Returns(LockedUntil);
            Session.Setup(s => s.GetSessionStateAsync(It.IsAny<CancellationToken>())).ReturnsAsync(state == null ? null! : new BinaryData(state));
            Session.Setup(s => s.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>())).ReturnsAsync(Batch());
            Client.Setup(c => c.AcceptSessionAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Session.Object);
            Client.Setup(c => c.AcceptSessionAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Session.Object);
        }

        public AzureServiceBusProvider Provider() => new(Client.Object);

        public void Released() => Session.Verify(s => s.DisposeAsync(), Times.Once);

        public byte[]? Written() =>
            Session.Invocations.Where(i => i.Method.Name == nameof(ServiceBusSessionReceiver.SetSessionStateAsync))
                .Select(i => ((BinaryData?)i.Arguments[0])?.ToArray()).Single();
    }

    private static byte[] Utf8(string text) => Encoding.UTF8.GetBytes(text);

    [Fact]
    public async Task The_list_groups_peeked_messages_by_session_in_order_of_first_appearance_with_their_count_and_first_sequence_number()
    {
        var asked = new List<(int, long?)>();
        var receiver = Peeking(asked, Batch(Msg(1, "a"), Msg(2, "b"), Msg(3, "a")), Batch(Msg(5, "c"), Msg(6, "b")));

        var list = await AzureServiceBusProvider.ListSessionsCoreAsync(receiver.Object, 1000, CancellationToken.None);

        Assert.Equal([("a", 2, 1L), ("b", 2, 2L), ("c", 1, 5L)], list.Sessions.Select(s => (s.SessionId, s.MessageCount, s.FirstSequenceNumber)));
        Assert.Equal((5, false), (list.ScannedMessages, list.Truncated));
        Assert.Equal([(250, (long?)null), (250, 4L), (250, 7L)], asked);
    }

    [Fact]
    public async Task A_scan_that_stops_at_maxMessages_with_messages_behind_counts_only_maxMessages_and_is_truncated()
    {
        var asked = new List<(int, long?)>();
        var receiver = Peeking(asked, Batch(Msg(1, "a"), Msg(2, "b"), Msg(3, "c"), Msg(4, "d")));

        var list = await AzureServiceBusProvider.ListSessionsCoreAsync(receiver.Object, 3, CancellationToken.None);

        Assert.Equal(["a", "b", "c"], list.Sessions.Select(s => s.SessionId));
        Assert.Equal((3, true), (list.ScannedMessages, list.Truncated));
        Assert.Equal([(4, (long?)null)], asked);
    }

    [Fact]
    public async Task A_scan_that_reaches_the_end_of_the_entity_exactly_at_maxMessages_is_not_truncated()
    {
        var asked = new List<(int, long?)>();
        var receiver = Peeking(asked, Batch(Msg(1, "a"), Msg(2, "a"), Msg(3, "a")));

        var list = await AzureServiceBusProvider.ListSessionsCoreAsync(receiver.Object, 3, CancellationToken.None);

        Assert.Equal((3, false), (list.ScannedMessages, list.Truncated));
        Assert.Equal([(4, (long?)null), (1, 4L)], asked);
    }

    [Fact]
    public async Task The_list_stops_at_100_sessions_and_says_more_may_exist()
    {
        var asked = new List<(int, long?)>();
        var receiver = Peeking(asked, Enumerable.Range(1, 101).Select(i => Msg(i, $"s-{i}")).ToArray());

        var list = await AzureServiceBusProvider.ListSessionsCoreAsync(receiver.Object, 5000, CancellationToken.None);

        Assert.Equal(100, list.Sessions.Count);
        Assert.Equal(("s-100", 100, true), (list.Sessions[^1].SessionId, list.ScannedMessages, list.Truncated));
    }

    [Fact]
    public async Task A_peeked_message_without_a_session_id_means_the_entity_does_not_use_sessions()
    {
        var receiver = Peeking([], Batch(Msg(1, null)));

        var error = await Assert.ThrowsAsync<SessionsNotEnabledException>(() =>
            AzureServiceBusProvider.ListSessionsCoreAsync(receiver.Object, 1000, CancellationToken.None));

        Assert.Equal("This entity does not use sessions.", error.Message);
    }

    [Fact]
    public async Task The_caller_token_reaches_the_sdk_and_stops_the_scan_before_the_next_peek()
    {
        using var request = new CancellationTokenSource();
        var receiver = new Mock<ServiceBusReceiver>();
        var tokens = new List<CancellationToken>();
        receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .Callback((int _, long? _, CancellationToken token) =>
            {
                tokens.Add(token);
                request.Cancel();
            })
            .ReturnsAsync(Batch(Msg(1, "a")));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            AzureServiceBusProvider.ListSessionsCoreAsync(receiver.Object, 1000, request.Token));

        Assert.Equal([request.Token], tokens);
    }

    [Fact]
    public async Task Listing_creates_one_plain_receiver_on_the_entity_and_accepts_no_session()
    {
        var client = new Mock<ServiceBusClient>();
        var receiver = Peeking([], Batch(Msg(1, "a"), Msg(2, "b")));
        var created = new List<(string Path, SubQueue SubQueue)>();
        client.Setup(c => c.CreateReceiver(It.IsAny<string>(), It.IsAny<ServiceBusReceiverOptions>()))
            .Callback((string path, ServiceBusReceiverOptions options) => created.Add((path, options.SubQueue)))
            .Returns(receiver.Object);

        var list = await new AzureServiceBusProvider(client.Object).GetSessionsAsync("events", "audit", 1000);

        Assert.Equal(["a", "b"], list.Sessions.Select(s => s.SessionId));
        Assert.Equal([nameof(ServiceBusClient.CreateReceiver)], client.Invocations.Select(i => i.Method.Name));
        Assert.Equal([("events/subscriptions/audit", SubQueue.None)], created);
        Assert.All(receiver.Invocations, i => Assert.Contains(i.Method.Name, new[] { nameof(ServiceBusReceiver.PeekMessagesAsync), nameof(ServiceBusReceiver.DisposeAsync) }));
    }

    [Fact]
    public async Task A_peek_that_fails_while_listing_reaches_the_caller_and_a_missing_entity_is_not_found()
    {
        var client = new Mock<ServiceBusClient>();
        var receiver = new Mock<ServiceBusReceiver>();
        client.Setup(c => c.CreateReceiver(It.IsAny<string>(), It.IsAny<ServiceBusReceiverOptions>())).Returns(receiver.Object);
        var failure = Broker(ServiceBusFailureReason.ServiceCommunicationProblem);
        receiver.SetupSequence(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(failure)
            .ThrowsAsync(Broker(ServiceBusFailureReason.MessagingEntityNotFound));
        var provider = new AzureServiceBusProvider(client.Object);

        var reached = await Assert.ThrowsAsync<ServiceBusException>(() => provider.GetSessionsAsync("orders", null, 1000));
        var missing = await Assert.ThrowsAsync<EntityNotFoundException>(() => provider.GetSessionsAsync("orders", null, 1000));

        Assert.Same(failure, reached);
        Assert.Equal("The entity was not found.", missing.Message);
    }

    [Fact]
    public async Task A_session_locked_by_another_receiver_is_in_use_and_the_broker_text_stays_out_of_the_message()
    {
        var client = new Mock<ServiceBusClient>();
        client.Setup(c => c.AcceptSessionAsync("orders", "order-1", It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Broker(ServiceBusFailureReason.SessionCannotBeLocked));

        var error = await Assert.ThrowsAsync<SessionInUseException>(() =>
            AzureServiceBusProvider.AcceptSessionCoreAsync(client.Object, "orders", null, "order-1", TimeSpan.FromSeconds(5), CancellationToken.None));

        Assert.Equal("The session is in use by another receiver. Try again in a moment.", error.Message);
        Assert.IsType<ServiceBusException>(error.InnerException);
    }

    [Fact]
    public async Task An_accept_that_waits_past_the_limit_is_in_use()
    {
        var client = new Mock<ServiceBusClient>();
        client.Setup(c => c.AcceptSessionAsync("events", "audit", "order-1", It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, string _, string _, ServiceBusSessionReceiverOptions _, CancellationToken token) =>
            {
                await Task.Delay(Timeout.Infinite, token);
                return null!;
            });

        await Assert.ThrowsAsync<SessionInUseException>(() =>
            AzureServiceBusProvider.AcceptSessionCoreAsync(client.Object, "events", "audit", "order-1", TimeSpan.FromMilliseconds(50), CancellationToken.None));
    }

    [Fact]
    public async Task A_request_cancelled_while_accepting_propagates_as_cancelled_not_as_in_use()
    {
        using var request = new CancellationTokenSource();
        var client = new Mock<ServiceBusClient>();
        client.Setup(c => c.AcceptSessionAsync("orders", "order-1", It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, string _, ServiceBusSessionReceiverOptions _, CancellationToken token) =>
            {
                request.Cancel();
                await Task.Delay(Timeout.Infinite, token);
                return null!;
            });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            AzureServiceBusProvider.AcceptSessionCoreAsync(client.Object, "orders", null, "order-1", TimeSpan.FromSeconds(5), request.Token));
    }

    public static TheoryData<Exception, Type> AcceptRefusals => new()
    {
        { new InvalidOperationException("A sessionful message receiver cannot be created on an entity that does not require sessions."), typeof(SessionsNotEnabledException) },
        { Broker(ServiceBusFailureReason.MessagingEntityNotFound), typeof(EntityNotFoundException) },
        { Broker(ServiceBusFailureReason.ServiceCommunicationProblem), typeof(ServiceBusException) }
    };

    [Theory]
    [MemberData(nameof(AcceptRefusals))]
    public async Task An_accept_the_broker_refuses_becomes_the_neutral_answer_or_reaches_the_caller_as_it_was(Exception refusal, Type expected)
    {
        var client = new Mock<ServiceBusClient>();
        client.Setup(c => c.AcceptSessionAsync("orders", "order-1", It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(refusal);

        var error = await Record.ExceptionAsync(() =>
            AzureServiceBusProvider.AcceptSessionCoreAsync(client.Object, "orders", null, "order-1", TimeSpan.FromSeconds(5), CancellationToken.None));

        Assert.IsType(expected, error);
    }

    [Theory]
    [InlineData("list")]
    [InlineData("detail")]
    [InlineData("messages")]
    [InlineData("state")]
    public async Task A_disabled_entity_is_answered_with_the_neutral_disabled_exception_on_every_session_operation(string operation)
    {
        var broker = new FakeSessionBroker();
        var disabled = Broker(ServiceBusFailureReason.MessagingEntityDisabled);
        var receiver = new Mock<ServiceBusReceiver>();
        receiver.Setup(r => r.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>())).ThrowsAsync(disabled);
        broker.Client.Setup(c => c.CreateReceiver(It.IsAny<string>(), It.IsAny<ServiceBusReceiverOptions>())).Returns(receiver.Object);
        broker.Client.Setup(c => c.AcceptSessionAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(disabled);
        var provider = broker.Provider();

        var error = await Assert.ThrowsAsync<EntityDisabledException>(() =>
            operation == "list" ? provider.GetSessionsAsync("orders", null, 1000) : Open(provider, operation, "order-1"));

        Assert.Same(disabled, error.InnerException);
    }

    [Fact]
    public async Task The_detail_reads_a_utf8_state_as_text_and_releases_the_session()
    {
        var broker = new FakeSessionBroker(Utf8("{\"step\":3} é"));

        var detail = await broker.Provider().GetSessionAsync("events", "audit", "order-1");

        Assert.Equal(("order-1", "{\"step\":3} é", false, LockedUntil), (detail.SessionId, detail.State, detail.StateIsBinary, detail.LockedUntil));
        broker.Client.Verify(c => c.AcceptSessionAsync("events", "audit", "order-1", It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()), Times.Once);
        broker.Released();
    }

    [Theory]
    [InlineData(new byte[] { 0xFF, 0xFE }, "//4=")]
    [InlineData(new byte[] { 0x61, 0x62, 0xC3 }, "YWLD")]
    public async Task A_state_that_is_not_valid_utf8_is_answered_as_base64_and_flagged_binary_never_with_a_replaced_byte(byte[] stored, string base64)
    {
        var broker = new FakeSessionBroker(stored);

        var detail = await broker.Provider().GetSessionAsync("orders", null, "order-1");

        Assert.Equal((base64, true), (detail.State, detail.StateIsBinary));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(new byte[0])]
    public async Task No_state_and_an_empty_state_both_read_as_null(byte[]? stored)
    {
        var detail = await new FakeSessionBroker(stored).Provider().GetSessionAsync("orders", null, "order-1");

        Assert.Equal((null, false), (detail.State, detail.StateIsBinary));
    }

    [Fact]
    public async Task A_state_read_that_fails_reaches_the_caller_and_the_session_is_still_released()
    {
        var broker = new FakeSessionBroker();
        var failure = Broker(ServiceBusFailureReason.ServiceCommunicationProblem);
        broker.Session.Setup(s => s.GetSessionStateAsync(It.IsAny<CancellationToken>())).ThrowsAsync(failure);

        var reached = await Assert.ThrowsAsync<ServiceBusException>(() => broker.Provider().GetSessionAsync("orders", null, "order-1"));

        Assert.Same(failure, reached);
        broker.Released();
    }

    [Fact]
    public async Task Opening_a_session_with_messages_reads_its_state_and_peeks_its_messages_under_one_accept_and_releases_it()
    {
        var broker = new FakeSessionBroker(Utf8("{\"step\":3}"));
        broker.Session.SetupSequence(s => s.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Batch(Msg(4, "order-1"), Msg(9, "order-1")))
            .ReturnsAsync(Batch());

        var (detail, messages) = await AzureServiceBusProvider.ReadSessionCoreAsync(
            broker.Client.Object, "orders", null, "order-1", 10, TimeSpan.FromSeconds(5), CancellationToken.None);

        Assert.Equal(("order-1", "{\"step\":3}", false), (detail.SessionId, detail.State, detail.StateIsBinary));
        Assert.Equal([4L, 9L], messages!.Select(m => m.SequenceNumber));
        broker.Client.Verify(c => c.AcceptSessionAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()), Times.Once);
        broker.Released();
    }

    [Fact]
    public async Task The_detail_maps_the_peeked_messages_of_the_session_when_asked_for_them()
    {
        var broker = new FakeSessionBroker();
        broker.Session.SetupSequence(s => s.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Batch(Msg(4, "order-1"), Msg(9, "order-1")))
            .ReturnsAsync(Batch());

        var detail = await broker.Provider().GetSessionAsync("orders", null, "order-1", 3);

        Assert.Equal([(4L, "order-1"), (9L, "order-1")], detail.Messages!.Select(m => (m.SequenceNumber!.Value, m.SessionId)));
        Assert.Equal(3, (int)broker.Session.Invocations.First(i => i.Method.Name == nameof(ServiceBusReceiver.PeekMessagesAsync)).Arguments[0]);
    }

    [Fact]
    public async Task The_detail_without_a_message_count_peeks_nothing_and_answers_no_messages()
    {
        var broker = new FakeSessionBroker();

        var detail = await broker.Provider().GetSessionAsync("orders", null, "order-1");

        Assert.Null(detail.Messages);
        broker.Session.Verify(s => s.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_peek_that_fails_after_the_state_was_read_reaches_the_caller_and_the_session_is_still_released()
    {
        var broker = new FakeSessionBroker(Utf8("s"));
        var failure = Broker(ServiceBusFailureReason.ServiceCommunicationProblem);
        broker.Session.Setup(s => s.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>())).ThrowsAsync(failure);

        var reached = await Assert.ThrowsAsync<ServiceBusException>(() => broker.Provider().GetSessionAsync("orders", null, "order-1", 10));

        Assert.Same(failure, reached);
        broker.Session.Verify(s => s.GetSessionStateAsync(It.IsAny<CancellationToken>()), Times.Once);
        broker.Released();
    }

    [Fact]
    public async Task The_messages_of_one_session_are_peeked_through_that_session_up_to_count_and_nothing_is_received()
    {
        var broker = new FakeSessionBroker();
        broker.Session.SetupSequence(s => s.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Batch(Msg(4, "order-1"), Msg(9, "order-1")))
            .ReturnsAsync(Batch());
        var wholeEntity = Peeking([], Batch(Msg(4, "order-1"), Msg(5, "order-2"), Msg(9, "order-1")));
        broker.Client.Setup(c => c.CreateReceiver(It.IsAny<string>(), It.IsAny<ServiceBusReceiverOptions>())).Returns(wholeEntity.Object);

        var messages = (await broker.Provider().PeekSessionMessagesAsync("orders", null, "order-1", 3)).ToList();

        Assert.Equal([(4L, "order-1"), (9L, "order-1")], messages.Select(m => (m.SequenceNumber!.Value, m.SessionId)));
        broker.Client.Verify(c => c.AcceptSessionAsync("orders", "order-1", It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()), Times.Once);
        Assert.Equal([3, 1], broker.Session.Invocations.Where(i => i.Method.Name == nameof(ServiceBusReceiver.PeekMessagesAsync)).Select(i => (int)i.Arguments[0]));
        Assert.All(broker.Session.Invocations, i => Assert.Contains(i.Method.Name, new[] { "PeekMessagesAsync", "DisposeAsync", "get_SessionId" }));
        broker.Released();
    }

    [Fact]
    public async Task A_peek_that_fails_inside_a_session_reaches_the_caller_and_the_session_is_still_released()
    {
        var broker = new FakeSessionBroker();
        var failure = Broker(ServiceBusFailureReason.ServiceCommunicationProblem);
        broker.Session.Setup(s => s.PeekMessagesAsync(It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<CancellationToken>())).ThrowsAsync(failure);

        var reached = await Assert.ThrowsAsync<ServiceBusException>(() => broker.Provider().PeekSessionMessagesAsync("orders", null, "order-1", 10));

        Assert.Same(failure, reached);
        broker.Released();
    }

    [Fact]
    public async Task A_state_write_whose_expected_state_matches_writes_the_new_state_and_answers_it_as_stored()
    {
        var broker = new FakeSessionBroker(Utf8("{\"step\":3}"));

        var detail = await broker.Provider().SetSessionStateAsync("orders", null, "order-1", "{\"step\":4}", "{\"step\":3}");

        Assert.Equal(Utf8("{\"step\":4}"), broker.Written());
        Assert.Equal(("order-1", "{\"step\":4}", false, LockedUntil), (detail.SessionId, detail.State, detail.StateIsBinary, detail.LockedUntil));
        broker.Released();
    }

    [Theory]
    [InlineData("{\"step\":5}", "{\"step\":3}")]
    [InlineData("{\"step\":5}", null)]
    [InlineData(null, "{\"step\":3}")]
    public async Task A_state_write_whose_expected_state_differs_from_the_current_one_writes_nothing_and_says_the_state_changed(string? current, string? expected)
    {
        var broker = new FakeSessionBroker(current == null ? null : Utf8(current));

        var error = await Assert.ThrowsAsync<SessionStateChangedException>(() =>
            broker.Provider().SetSessionStateAsync("orders", null, "order-1", "{\"step\":4}", expected));

        Assert.Equal("The session state changed since it was read. Reload it and try again.", error.Message);
        broker.Session.Verify(s => s.SetSessionStateAsync(It.IsAny<BinaryData>(), It.IsAny<CancellationToken>()), Times.Never);
        broker.Released();
    }

    [Fact]
    public async Task An_expected_null_matches_a_session_without_state_and_a_null_state_clears_it()
    {
        var broker = new FakeSessionBroker();

        var detail = await broker.Provider().SetSessionStateAsync("orders", null, "order-1", null, null);

        Assert.Null(broker.Written());
        Assert.Null(detail.State);
        broker.Released();
    }

    [Fact]
    public async Task An_empty_state_clears_the_state_and_an_empty_expected_state_means_the_session_had_none()
    {
        var broker = new FakeSessionBroker();

        var detail = await broker.Provider().SetSessionStateAsync("orders", null, "order-1", "", "");

        Assert.Null(broker.Written());
        Assert.Null(detail.State);
        broker.Released();
    }

    [Fact]
    public async Task A_binary_current_state_is_refused_and_never_overwritten()
    {
        var broker = new FakeSessionBroker([0xFF, 0xFE]);

        var error = await Assert.ThrowsAsync<BinarySessionStateException>(() =>
            broker.Provider().SetSessionStateAsync("orders", null, "order-1", "text", "//4="));

        Assert.Equal("This session holds a binary state and cannot be edited here.", error.Message);
        broker.Session.Verify(s => s.SetSessionStateAsync(It.IsAny<BinaryData>(), It.IsAny<CancellationToken>()), Times.Never);
        broker.Released();
    }

    [Fact]
    public async Task A_state_over_262144_utf8_bytes_is_refused_before_any_session_is_accepted_and_the_limit_counts_bytes_not_characters()
    {
        var broker = new FakeSessionBroker();
        var provider = broker.Provider();

        await provider.SetSessionStateAsync("orders", null, "order-1", new string('é', 131072), null);
        Assert.Equal(262144, broker.Written()!.Length);
        broker.Client.Invocations.Clear();
        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            provider.SetSessionStateAsync("orders", null, "order-1", new string('é', 131073), null));

        Assert.Equal("state must be at most 262144 bytes as UTF-8.", error.Message);
        Assert.Empty(broker.Client.Invocations);
    }

    public static TheoryData<string, string> SessionOperations => new()
    {
        { "detail", "" }, { "detail", " \t" }, { "detail", new string('s', 129) },
        { "messages", "" }, { "messages", " \t" }, { "messages", new string('s', 129) },
        { "state", "" }, { "state", " \t" }, { "state", new string('s', 129) }
    };

    private static Task Open(AzureServiceBusProvider provider, string operation, string sessionId) => operation switch
    {
        "detail" => provider.GetSessionAsync("orders", null, sessionId),
        "messages" => provider.PeekSessionMessagesAsync("orders", null, sessionId, 10),
        _ => provider.SetSessionStateAsync("orders", null, sessionId, "s", null)
    };

    [Theory]
    [MemberData(nameof(SessionOperations))]
    public async Task A_session_id_that_is_empty_white_space_or_longer_than_128_characters_is_refused_before_any_broker_call(string operation, string sessionId)
    {
        var broker = new FakeSessionBroker();

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() => Open(broker.Provider(), operation, sessionId));

        Assert.Equal("sessionId must hold 1 to 128 characters, not only white space.", error.Message);
        Assert.Empty(broker.Client.Invocations);
    }

    [Theory]
    [InlineData("detail")]
    [InlineData("messages")]
    [InlineData("state")]
    public async Task A_session_id_of_128_characters_is_accepted(string operation)
    {
        var broker = new FakeSessionBroker();

        await Open(broker.Provider(), operation, new string('s', 128));

        broker.Client.Verify(c => c.AcceptSessionAsync("orders", new string('s', 128), It.IsAny<ServiceBusSessionReceiverOptions>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_state_write_that_fails_reaches_the_caller_and_the_session_is_still_released()
    {
        var broker = new FakeSessionBroker();
        var failure = Broker(ServiceBusFailureReason.ServiceCommunicationProblem);
        broker.Session.Setup(s => s.SetSessionStateAsync(It.IsAny<BinaryData>(), It.IsAny<CancellationToken>())).ThrowsAsync(failure);

        var reached = await Assert.ThrowsAsync<ServiceBusException>(() => broker.Provider().SetSessionStateAsync("orders", null, "order-1", "s", null));

        Assert.Same(failure, reached);
        broker.Released();
    }
}
