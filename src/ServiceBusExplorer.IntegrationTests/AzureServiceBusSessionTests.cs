using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Sessions of a session-enabled queue and subscription against the emulator: the listing reads them passively, and
/// opening one session locks only that session and only for the call.
/// </summary>
[Collection(AzureServiceBusCollection.Name)]
public sealed class AzureServiceBusSessionTests(AzureServiceBusFixture fixture) : IAsyncLifetime
{
    private readonly List<string> _queues = [];
    private readonly List<string> _topics = [];
    private IMessagingProvider _messaging = null!;

    public async Task InitializeAsync()
    {
        _messaging = await fixture.ConnectMessagingAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var queue in _queues) await fixture.DeleteQueueAsync(queue);
        foreach (var topic in _topics) await fixture.DeleteTopicAsync(topic);
        await _messaging.DisposeAsync();
    }

    private async Task<string> CreateSessionQueueAsync(string tag)
    {
        var name = AzureServiceBusFixture.UniqueName(tag);
        _queues.Add(name);
        await fixture.Admin.CreateQueueAsync(new CreateQueueOptions(name) { RequiresSession = true });
        return name;
    }

    private async Task<(string Topic, string Subscription)> CreateSessionSubscriptionAsync(string tag)
    {
        var topic = AzureServiceBusFixture.UniqueName(tag);
        _topics.Add(topic);
        await fixture.Admin.CreateTopicAsync(topic);
        await fixture.Admin.CreateSubscriptionAsync(new CreateSubscriptionOptions(topic, "audit") { RequiresSession = true });
        return (topic, "audit");
    }

    /// <summary>Waits until a subscription holds <paramref name="count"/> messages, at most ten seconds: a topic forwards late.</summary>
    private async Task WaitUntilForwardedAsync(string topic, string subscription, int count)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (true)
        {
            await using var peeker = fixture.Client.CreateReceiver($"{topic}/subscriptions/{subscription}");
            var seen = 0;
            for (var batch = await peeker.PeekMessagesAsync(250); batch.Count > 0; batch = await peeker.PeekMessagesAsync(250))
            {
                seen += batch.Count;
            }

            if (seen >= count || DateTime.UtcNow > deadline)
            {
                return;
            }

            await Task.Delay(100);
        }
    }

    private async Task SendToSessionsAsync(string entity, params (string SessionId, string Body)[] messages)
    {
        await using var sender = fixture.Client.CreateSender(entity);
        foreach (var (sessionId, body) in messages)
        {
            await sender.SendMessageAsync(new ServiceBusMessage(body) { SessionId = sessionId });
        }
    }

    [Fact]
    public async Task A_plain_receiver_peeks_every_session_of_a_session_enabled_queue_and_subscription_and_locks_none()
    {
        var queue = await CreateSessionQueueAsync("passive-peek");
        var (topic, subscription) = await CreateSessionSubscriptionAsync("passive-peek");
        var sent = new[] { ("order-1", "a"), ("order-2", "b"), ("order-1", "c"), ("order-3", "d") };
        await SendToSessionsAsync(queue, sent);
        await SendToSessionsAsync(topic, sent);
        await WaitUntilForwardedAsync(topic, subscription, sent.Length);

        foreach (var path in new[] { queue, $"{topic}/subscriptions/{subscription}" })
        {
            await using var peeker = fixture.Client.CreateReceiver(path);
            var peeked = await peeker.PeekMessagesAsync(10);

            Assert.Equal(sent, peeked.Select(m => (m.SessionId, m.Body.ToString())).ToArray());
            foreach (var sessionId in new[] { "order-1", "order-2", "order-3" })
            {
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await using var session = path == queue
                    ? await fixture.Client.AcceptSessionAsync(queue, sessionId, cancellationToken: deadline.Token)
                    : await fixture.Client.AcceptSessionAsync(topic, subscription, sessionId, cancellationToken: deadline.Token);
                Assert.Equal(sessionId, session.SessionId);
            }
        }
    }

    private async Task<ServiceBusSessionReceiver> AcceptWithinFiveSecondsAsync(string queue, string sessionId)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        return await fixture.Client.AcceptSessionAsync(queue, sessionId, cancellationToken: deadline.Token);
    }

    [Fact]
    public async Task Listing_lists_a_session_a_consumer_holds_leaves_that_consumer_its_lock_and_leaves_every_other_session_acceptable_at_once()
    {
        var queue = await CreateSessionQueueAsync("list-regression");
        await SendToSessionsAsync(queue, ("order-1", "a"), ("order-2", "b"), ("order-1", "c"), ("order-3", "d"));
        await using var consumer = await AcceptWithinFiveSecondsAsync(queue, "order-1");

        var list = await _messaging.GetSessionsAsync(queue, null, 1000);

        Assert.Equal([("order-1", 2), ("order-2", 1), ("order-3", 1)], list.Sessions.Select(s => (s.SessionId, s.MessageCount)));
        Assert.Equal((4, false), (list.ScannedMessages, list.Truncated));
        var received = Assert.Single(await consumer.ReceiveMessagesAsync(1, TimeSpan.FromSeconds(5)));
        await consumer.CompleteMessageAsync(received);
        Assert.Equal("a", received.Body.ToString());
        foreach (var sessionId in new[] { "order-2", "order-3" })
        {
            await using var other = await AcceptWithinFiveSecondsAsync(queue, sessionId);
            Assert.Equal(sessionId, other.SessionId);
        }
    }

    [Fact]
    public async Task The_list_of_a_subscription_follows_the_scan_past_one_peek_batch_and_says_when_it_stopped_at_maxMessages()
    {
        var (topic, subscription) = await CreateSessionSubscriptionAsync("list-scan");
        await using (var sender = fixture.Client.CreateSender(topic))
        {
            foreach (var sessionId in new[] { "s-0", "s-1", "s-2" })
            {
                await sender.SendMessagesAsync(Enumerable.Range(0, 100).Select(i => new ServiceBusMessage($"{sessionId}-{i}") { SessionId = sessionId }));
            }
        }

        await WaitUntilForwardedAsync(topic, subscription, 300);

        var whole = await _messaging.GetSessionsAsync(topic, subscription, 1000);
        var first = await _messaging.GetSessionsAsync(topic, subscription, 150);

        Assert.Equal([("s-0", 100), ("s-1", 100), ("s-2", 100)], whole.Sessions.Select(s => (s.SessionId, s.MessageCount)));
        Assert.Equal((300, false), (whole.ScannedMessages, whole.Truncated));
        Assert.Equal([("s-0", 100), ("s-1", 50)], first.Sessions.Select(s => (s.SessionId, s.MessageCount)));
        Assert.Equal((150, true), (first.ScannedMessages, first.Truncated));
    }

    [Fact]
    public async Task The_detail_of_a_session_reads_its_text_or_binary_state_and_releases_the_session()
    {
        var queue = await CreateSessionQueueAsync("detail");
        await using (var arrange = await AcceptWithinFiveSecondsAsync(queue, "text"))
            await arrange.SetSessionStateAsync(BinaryData.FromString("{\"step\":3}"));
        await using (var arrange = await AcceptWithinFiveSecondsAsync(queue, "binary"))
            await arrange.SetSessionStateAsync(new BinaryData(new byte[] { 0xFF, 0xFE }));

        var text = await _messaging.GetSessionAsync(queue, null, "text");
        var binary = await _messaging.GetSessionAsync(queue, null, "binary");
        var unknown = await _messaging.GetSessionAsync(queue, null, "never-used");

        Assert.Equal(("text", "{\"step\":3}", false), (text.SessionId, text.State, text.StateIsBinary));
        Assert.Equal(("//4=", true), (binary.State, binary.StateIsBinary));
        Assert.Null(unknown.State);
        await using var again = await AcceptWithinFiveSecondsAsync(queue, "text");
        Assert.Equal("text", again.SessionId);
    }

    [Fact]
    public async Task The_detail_asked_for_messages_answers_the_state_and_that_session_s_messages_and_releases_the_session()
    {
        var queue = await CreateSessionQueueAsync("detail-messages");
        await SendToSessionsAsync(queue, ("order-1", "a"), ("order-2", "b"), ("order-1", "c"));
        await using (var arrange = await AcceptWithinFiveSecondsAsync(queue, "order-1"))
            await arrange.SetSessionStateAsync(BinaryData.FromString("{\"step\":3}"));

        var detail = await _messaging.GetSessionAsync(queue, null, "order-1", 10);

        Assert.Equal("{\"step\":3}", detail.State);
        Assert.Equal([("order-1", "a"), ("order-1", "c")], detail.Messages!.Select(m => (m.SessionId, m.Body)));
        Assert.Equal(3, (await _messaging.GetSessionsAsync(queue, null, 1000)).ScannedMessages);
        await using var again = await AcceptWithinFiveSecondsAsync(queue, "order-1");
        Assert.Equal("order-1", again.SessionId);
    }

    [Fact]
    public async Task The_messages_of_one_session_are_peeked_without_removing_them_and_the_session_is_released()
    {
        var queue = await CreateSessionQueueAsync("session-messages");
        await SendToSessionsAsync(queue, ("order-1", "a"), ("order-2", "b"), ("order-1", "c"));

        var messages = (await _messaging.PeekSessionMessagesAsync(queue, null, "order-1", 10)).ToList();

        Assert.Equal([("order-1", "a"), ("order-1", "c")], messages.Select(m => (m.SessionId, m.Body)));
        Assert.Equal(3, (await _messaging.GetSessionsAsync(queue, null, 1000)).ScannedMessages);
        await using var again = await AcceptWithinFiveSecondsAsync(queue, "order-1");
        Assert.Equal("order-1", again.SessionId);
    }

    [Fact]
    public async Task A_state_write_on_a_subscription_replaces_the_state_it_was_shown_and_refuses_one_that_changed()
    {
        var (topic, subscription) = await CreateSessionSubscriptionAsync("state-write");
        await using (var arrange = await fixture.Client.AcceptSessionAsync(topic, subscription, "order-1"))
            await arrange.SetSessionStateAsync(BinaryData.FromString("{\"step\":5}"));

        var refused = await Assert.ThrowsAsync<SessionStateChangedException>(() =>
            _messaging.SetSessionStateAsync(topic, subscription, "order-1", "{\"step\":4}", "{\"step\":3}"));
        var kept = await _messaging.GetSessionAsync(topic, subscription, "order-1");
        var written = await _messaging.SetSessionStateAsync(topic, subscription, "order-1", "{\"step\":6}", "{\"step\":5}");
        var stored = await _messaging.GetSessionAsync(topic, subscription, "order-1");

        Assert.Equal("The session state changed since it was read. Reload it and try again.", refused.Message);
        Assert.Equal("{\"step\":5}", kept.State);
        Assert.Equal(("{\"step\":6}", "{\"step\":6}"), (written.State, stored.State));
    }

    [Fact]
    public async Task A_session_another_receiver_holds_is_in_use_for_the_detail_the_messages_and_the_state_write()
    {
        var queue = await CreateSessionQueueAsync("in-use");
        await SendToSessionsAsync(queue, ("order-1", "a"));
        await using var consumer = await AcceptWithinFiveSecondsAsync(queue, "order-1");

        await Assert.ThrowsAsync<SessionInUseException>(() => _messaging.GetSessionAsync(queue, null, "order-1"));
        await Assert.ThrowsAsync<SessionInUseException>(() => _messaging.PeekSessionMessagesAsync(queue, null, "order-1", 10));
        await Assert.ThrowsAsync<SessionInUseException>(() => _messaging.SetSessionStateAsync(queue, null, "order-1", "x", null));
        Assert.Null(await consumer.GetSessionStateAsync());
    }

    [Fact]
    public async Task An_entity_without_sessions_is_refused_and_a_missing_entity_is_not_found()
    {
        var plain = AzureServiceBusFixture.UniqueName("no-sessions");
        _queues.Add(plain);
        await fixture.Admin.CreateQueueAsync(plain);
        await fixture.SendAsync(plain, "m1");
        var missing = AzureServiceBusFixture.UniqueName("missing");

        await Assert.ThrowsAsync<SessionsNotEnabledException>(() => _messaging.GetSessionsAsync(plain, null, 1000));
        await Assert.ThrowsAsync<SessionsNotEnabledException>(() => _messaging.GetSessionAsync(plain, null, "order-1"));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => _messaging.GetSessionsAsync(missing, null, 1000));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => _messaging.GetSessionAsync(missing, null, "order-1"));
    }
}
