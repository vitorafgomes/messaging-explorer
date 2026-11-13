using System.Reflection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Api.Monitoring;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The poll behind the monitoring screen: its period and the floor under it, a tick skipped while the previous poll
/// runs, the bound on subscription reads running at once, the counts each snapshot carries, and what a failing
/// broker call leaves in the store.
/// </summary>
public class MonitoringBackgroundServiceTests
{
    /// <summary>
    /// A connected provider whose list calls are answered by the test, with the topic name of each subscriptions call.
    /// </summary>
    public class FakeBroker : DispatchProxy
    {
        public Func<string, object?[], object?> Answer { get; set; } = (_, _) => null;
        public IProviderCapabilities Capabilities { get; set; } = AzureProviderCapabilities.Instance;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => targetMethod!.Name switch
        {
            "get_IsConnected" => true,
            "get_Capabilities" => Capabilities,
            var name => Answer(name, args ?? [])
        };

        public static (IMessagingProvider Provider, FakeBroker Fake) Create(Func<string, object?[], object?> answer)
        {
            var provider = Create<IMessagingProvider, FakeBroker>();
            var fake = (FakeBroker)(object)provider;
            fake.Answer = answer;
            return (provider, fake);
        }
    }

    private static IConfiguration Config(string? seconds) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [MonitoringBackgroundService.IntervalKey] = seconds }).Build();

    private static MonitoringBackgroundService Service(MonitoringStore store, Func<IMessagingProvider?> current, string? seconds = null) =>
        new(store, NullLogger.Instance, Config(seconds), current);

    private static Task<IEnumerable<IQueueEntity>> Queues(params QueueInfo[] queues) => Task.FromResult<IEnumerable<IQueueEntity>>(queues);

    private static Task<IEnumerable<ITopicEntity>> Topics(params string[] names) =>
        Task.FromResult<IEnumerable<ITopicEntity>>(names.Select(n => new TopicInfo { Name = n }).ToList());

    private static Task<IEnumerable<SubscriptionInfo>> Subscriptions(params SubscriptionInfo[] subscriptions) =>
        Task.FromResult<IEnumerable<SubscriptionInfo>>(subscriptions);

    [Theory]
    [InlineData("5")]
    [InlineData("29")]
    [InlineData("0")]
    [InlineData("-60")]
    [InlineData("every minute")]
    [InlineData(null)]
    public void The_interval_floor_prevents_hammering_a_production_namespace_a_configured_period_below_30_seconds_polls_every_30(string? configured)
    {
        var service = Service(new MonitoringStore(), () => null, configured);

        Assert.Equal(TimeSpan.FromSeconds(30), service.Interval);
    }

    [Theory]
    [InlineData("30", 30)]
    [InlineData("300", 300)]
    [InlineData("7200", 3600)]
    public void A_configured_period_at_or_above_the_floor_is_the_period_up_to_one_hour(string configured, int expectedSeconds)
    {
        var service = Service(new MonitoringStore(), () => null, configured);

        Assert.Equal(TimeSpan.FromSeconds(expectedSeconds), service.Interval);
    }

    [Fact]
    public async Task A_tick_while_the_previous_poll_has_not_finished_is_skipped_and_the_next_tick_after_it_finished_polls()
    {
        var gate = new TaskCompletionSource();
        var queueReads = 0;
        var (provider, _) = FakeBroker.Create((name, _) => name switch
        {
            nameof(IMessagingProvider.GetQueuesAsync) => Interlocked.Increment(ref queueReads) == 1
                ? gate.Task.ContinueWith(_ => (IEnumerable<IQueueEntity>)new List<IQueueEntity> { new QueueInfo { Name = "orders" } })
                : Queues(new QueueInfo { Name = "orders" }),
            nameof(IMessagingProvider.GetTopicsAsync) => Topics(),
            _ => null
        });
        var store = new MonitoringStore();
        var service = Service(store, () => provider);

        var first = service.StartCycle(CancellationToken.None);
        var second = service.StartCycle(CancellationToken.None);
        var readsWhileRunning = queueReads;
        gate.SetResult();
        await service.Cycle;
        var third = service.StartCycle(CancellationToken.None);
        await service.Cycle;

        Assert.Equal((true, false, true), (first, second, third));
        Assert.Equal(1, readsWhileRunning);
        Assert.Equal(2, queueReads);
        Assert.Equal(2, store.GetHistory(120).Length);
    }

    [Fact]
    public async Task Bounded_parallelism_no_more_than_four_topics_have_their_subscriptions_read_at_once_and_every_topic_is_read()
    {
        var topics = Enumerable.Range(1, 10).Select(i => $"topic-{i:00}").ToArray();
        var gate = new TaskCompletionSource();
        using var entered = new SemaphoreSlim(0);
        var maxLock = new object();
        var inFlight = 0;
        var maxInFlight = 0;

        async Task<IEnumerable<SubscriptionInfo>> ReadSubscriptions(string topic)
        {
            var now = Interlocked.Increment(ref inFlight);
            lock (maxLock) maxInFlight = Math.Max(maxInFlight, now);
            entered.Release();
            try
            {
                await gate.Task;
                return new List<SubscriptionInfo> { new() { Name = $"{topic}-sub" } };
            }
            finally
            {
                Interlocked.Decrement(ref inFlight);
            }
        }

        var (provider, _) = FakeBroker.Create((name, args) => name switch
        {
            nameof(IMessagingProvider.GetQueuesAsync) => Queues(),
            nameof(IMessagingProvider.GetTopicsAsync) => Topics(topics),
            nameof(IMessagingProvider.GetSubscriptionsAsync) => ReadSubscriptions((string)args[0]!),
            _ => null
        });
        var store = new MonitoringStore();
        var service = Service(store, () => provider);

        service.StartCycle(CancellationToken.None);
        for (var i = 0; i < MonitoringBackgroundService.MaxConcurrentSubscriptionReads; i++)
            Assert.True(await entered.WaitAsync(TimeSpan.FromSeconds(5)), $"only {i} subscription reads started");
        gate.SetResult();
        await service.Cycle;

        Assert.Equal(4, maxInFlight);
        var snapshot = store.GetLatest();
        Assert.NotNull(snapshot);
        Assert.Equal(topics, snapshot.Subscriptions.Select(s => s.TopicName));
        Assert.Equal(topics.Select(t => $"{t}-sub"), snapshot.Subscriptions.Select(s => s.Name));
    }

    [Fact]
    public async Task The_snapshot_carries_the_missing_counts_transfer_dead_letter_for_queues_and_subscriptions_and_no_scheduled_count_for_a_subscription()
    {
        var (provider, _) = FakeBroker.Create((name, _) => name switch
        {
            nameof(IMessagingProvider.GetQueuesAsync) => Queues(new QueueInfo
            {
                Name = "orders", ActiveMessageCount = 11, DeadLetterMessageCount = 13, TransferMessageCount = 15,
                ScheduledMessageCount = 12, TransferDeadLetterMessageCount = 14
            }),
            nameof(IMessagingProvider.GetTopicsAsync) => Topics("events"),
            nameof(IMessagingProvider.GetSubscriptionsAsync) => Subscriptions(new SubscriptionInfo
            {
                Name = "audit", ActiveMessageCount = 1, DeadLetterMessageCount = 2, TransferMessageCount = 3,
                ScheduledMessageCount = 99, TransferDeadLetterMessageCount = 4
            }),
            _ => null
        });
        var store = new MonitoringStore();
        var service = Service(store, () => provider);

        service.StartCycle(CancellationToken.None);
        await service.Cycle;

        var snapshot = store.GetLatest();
        Assert.NotNull(snapshot);
        var queue = Assert.Single(snapshot.Queues);
        Assert.Equal(("orders", 11L, 13L, 15L, (long?)12, (long?)14),
            (queue.Name, queue.ActiveMessageCount, queue.DeadLetterMessageCount, queue.TransferMessageCount, queue.ScheduledMessageCount, queue.TransferDeadLetterMessageCount));
        var subscription = Assert.Single(snapshot.Subscriptions);
        Assert.Equal(("events", "audit", 1L, 2L, 3L, (long?)null, (long?)4),
            (subscription.TopicName, subscription.Name, subscription.ActiveMessageCount, subscription.DeadLetterMessageCount, subscription.TransferMessageCount, subscription.ScheduledMessageCount, subscription.TransferDeadLetterMessageCount));
    }

    [Fact]
    public async Task A_count_the_provider_declares_it_does_not_have_is_null_in_the_snapshot_never_a_zero()
    {
        var (provider, fake) = FakeBroker.Create((name, _) => name switch
        {
            nameof(IMessagingProvider.GetQueuesAsync) => Queues(new QueueInfo { Name = "orders", ActiveMessageCount = 3 }),
            nameof(IMessagingProvider.GetTopicsAsync) => Topics("events"),
            nameof(IMessagingProvider.GetSubscriptionsAsync) => Subscriptions(new SubscriptionInfo { Name = "audit", ActiveMessageCount = 1 }),
            _ => null
        });
        fake.Capabilities = RabbitMQProviderCapabilities.Instance;
        var store = new MonitoringStore();
        var service = Service(store, () => provider);

        service.StartCycle(CancellationToken.None);
        await service.Cycle;

        var snapshot = store.GetLatest();
        Assert.NotNull(snapshot);
        var queue = Assert.Single(snapshot.Queues);
        Assert.Equal((3L, (long?)null, (long?)null), (queue.ActiveMessageCount, queue.ScheduledMessageCount, queue.TransferDeadLetterMessageCount));
        var subscription = Assert.Single(snapshot.Subscriptions);
        Assert.Equal((1L, (long?)null, (long?)null), (subscription.ActiveMessageCount, subscription.ScheduledMessageCount, subscription.TransferDeadLetterMessageCount));
    }

    public static TheoryData<string, Exception> FailingCalls => new()
    {
        { nameof(IMessagingProvider.GetQueuesAsync), new InvalidOperationException("broker said no") },
        { nameof(IMessagingProvider.GetTopicsAsync), new TimeoutException("the broker did not answer") },
        { nameof(IMessagingProvider.GetSubscriptionsAsync), new TaskCanceledException("the request timed out") }
    };

    [Theory]
    [MemberData(nameof(FailingCalls))]
    public async Task A_poll_whose_enumeration_throws_or_times_out_adds_no_snapshot_records_the_failure_and_the_next_poll_still_runs(string failingCall, Exception failure)
    {
        var failNow = true;
        var (provider, _) = FakeBroker.Create((name, args) =>
        {
            if (failNow && name == failingCall)
                return name switch
                {
                    nameof(IMessagingProvider.GetQueuesAsync) => Task.FromException<IEnumerable<IQueueEntity>>(failure),
                    nameof(IMessagingProvider.GetTopicsAsync) => Task.FromException<IEnumerable<ITopicEntity>>(failure),
                    _ => (string)args[0]! == "events-3"
                        ? Task.FromException<IEnumerable<SubscriptionInfo>>(failure)
                        : Subscriptions(new SubscriptionInfo { Name = "audit" })
                };
            return name switch
            {
                nameof(IMessagingProvider.GetQueuesAsync) => Queues(new QueueInfo { Name = "orders" }),
                nameof(IMessagingProvider.GetTopicsAsync) => Topics("events-1", "events-2", "events-3"),
                nameof(IMessagingProvider.GetSubscriptionsAsync) => Subscriptions(new SubscriptionInfo { Name = "audit" }),
                _ => null
            };
        });
        var store = new MonitoringStore();
        var service = Service(store, () => provider);

        service.StartCycle(CancellationToken.None);
        await service.Cycle;
        var afterFailure = (store.GetLatest(), store.LastFailureAt.HasValue);

        failNow = false;
        Assert.True(service.StartCycle(CancellationToken.None));
        await service.Cycle;

        Assert.Equal(((MonitoringSnapshot?)null, true), afterFailure);
        var snapshot = store.GetLatest();
        Assert.NotNull(snapshot);
        Assert.Equal(3, snapshot.Subscriptions.Count);
        Assert.Null(store.LastFailureAt);
    }

    [Fact]
    public async Task A_poll_that_finishes_after_the_connection_changed_adds_nothing_of_the_previous_broker()
    {
        var gate = new TaskCompletionSource();
        var (previous, _) = FakeBroker.Create((name, _) => name switch
        {
            nameof(IMessagingProvider.GetQueuesAsync) => gate.Task.ContinueWith(_ => (IEnumerable<IQueueEntity>)new List<IQueueEntity> { new QueueInfo { Name = "old-orders" } }),
            nameof(IMessagingProvider.GetTopicsAsync) => Topics(),
            _ => null
        });
        IMessagingProvider? current = previous;
        var store = new MonitoringStore();
        var service = Service(store, () => current);

        service.StartCycle(CancellationToken.None);
        current = null;
        gate.SetResult();
        await service.Cycle;

        Assert.Null(store.GetLatest());
        Assert.Null(store.LastFailureAt);
    }

    [Fact]
    public async Task A_connection_change_during_a_poll_cancels_the_reads_of_the_previous_broker_and_polls_the_new_one_at_once()
    {
        var gate = new TaskCompletionSource();
        using var entered = new SemaphoreSlim(0);
        var previousReads = 0;
        async Task<IEnumerable<SubscriptionInfo>> HeldRead()
        {
            Interlocked.Increment(ref previousReads);
            entered.Release();
            await gate.Task;
            return new List<SubscriptionInfo>();
        }

        var previousTopics = Enumerable.Range(1, 10).Select(i => $"old-{i:00}").ToArray();
        var (previous, _) = FakeBroker.Create((name, _) => name switch
        {
            nameof(IMessagingProvider.GetQueuesAsync) => Queues(new QueueInfo { Name = "old-orders" }),
            nameof(IMessagingProvider.GetTopicsAsync) => Topics(previousTopics),
            nameof(IMessagingProvider.GetSubscriptionsAsync) => HeldRead(),
            _ => null
        });
        var (next, _) = FakeBroker.Create((name, _) => name switch
        {
            nameof(IMessagingProvider.GetQueuesAsync) => Queues(new QueueInfo { Name = "new-orders" }),
            nameof(IMessagingProvider.GetTopicsAsync) => Topics(),
            _ => null
        });
        IMessagingProvider? current = previous;
        var store = new MonitoringStore();
        var service = Service(store, () => current);

        service.StartCycle(CancellationToken.None);
        var previousCycle = service.Cycle;
        for (var i = 0; i < MonitoringBackgroundService.MaxConcurrentSubscriptionReads; i++)
            Assert.True(await entered.WaitAsync(TimeSpan.FromSeconds(5)), $"only {i} subscription reads started");
        current = next;
        Assert.True(service.StartCycle(CancellationToken.None), "the tick after the connection changed was skipped");
        await service.Cycle.WaitAsync(TimeSpan.FromSeconds(5));
        var newQueues = store.GetLatest()?.Queues.Select(q => q.Name).ToList();
        gate.SetResult();
        await previousCycle;

        Assert.Equal(["new-orders"], newQueues);
        Assert.Equal(4, previousReads);
        Assert.Equal(["new-orders"], store.GetLatest()!.Queues.Select(q => q.Name));
        Assert.Null(store.LastFailureAt);
    }

    /// <summary>
    /// A clock the test moves by hand. It keeps the one timer the poll creates, with the due time and period it was
    /// given, and fires its callback once per period that <see cref="Advance"/> passes.
    /// </summary>
    private sealed class ManualTimeProvider : TimeProvider
    {
        private readonly object _gate = new();
        private DateTimeOffset _now = new(2026, 11, 13, 9, 0, 0, TimeSpan.Zero);
        private ManualTimer? _timer;

        public (TimeSpan DueTime, TimeSpan Period)? Created { get; private set; }

        public override DateTimeOffset GetUtcNow() { lock (_gate) return _now; }

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            lock (_gate)
            {
                Created = (dueTime, period);
                return _timer = new ManualTimer(this, callback, state, dueTime, period);
            }
        }

        public void Advance(TimeSpan by)
        {
            ManualTimer? timer;
            var fires = 0;
            lock (_gate)
            {
                _now += by;
                timer = _timer;
                if (timer is null) return;
                while (timer.Next is { } next && next <= _now)
                {
                    fires++;
                    timer.Next = timer.Period > TimeSpan.Zero && timer.Period != Timeout.InfiniteTimeSpan ? next + timer.Period : null;
                }
            }
            for (var i = 0; i < fires; i++) timer.Fire();
        }

        private sealed class ManualTimer(ManualTimeProvider clock, TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period) : ITimer
        {
            public DateTimeOffset? Next = dueTime == Timeout.InfiniteTimeSpan ? null : clock.GetUtcNow() + dueTime;
            public TimeSpan Period = period;

            public void Fire() => callback(state);

            public bool Change(TimeSpan dueTime, TimeSpan period)
            {
                lock (clock._gate)
                {
                    clock.Created = (dueTime, period);
                    Next = dueTime == Timeout.InfiniteTimeSpan ? null : clock._now + dueTime;
                    Period = period;
                }
                return true;
            }

            public void Dispose() => Next = null;
            public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        }
    }

    [Fact]
    public async Task The_interval_floor_prevents_hammering_a_production_namespace_ninety_seconds_of_a_running_service_poll_once_at_start_and_once_per_30_seconds_never_more()
    {
        var topics = Enumerable.Range(1, 1000).Select(i => $"topic-{i:0000}").ToArray();
        var subscriptions = Enumerable.Range(1, 10).Select(i => new SubscriptionInfo { Name = $"sub-{i:00}" }).ToList();
        int queueReads = 0, topicReads = 0, subscriptionReads = 0;
        var (provider, _) = FakeBroker.Create((name, _) =>
        {
            switch (name)
            {
                case nameof(IMessagingProvider.GetQueuesAsync): Interlocked.Increment(ref queueReads); return Queues(new QueueInfo { Name = "orders" });
                case nameof(IMessagingProvider.GetTopicsAsync): Interlocked.Increment(ref topicReads); return Topics(topics);
                case nameof(IMessagingProvider.GetSubscriptionsAsync): Interlocked.Increment(ref subscriptionReads); return Task.FromResult<IEnumerable<SubscriptionInfo>>(subscriptions);
                default: return null;
            }
        });
        var clock = new ManualTimeProvider();
        var store = new MonitoringStore();
        var service = new MonitoringBackgroundService(store, NullLogger.Instance, Config("5"), () => provider, clock);

        async Task PolledAsync(int cycles)
        {
            var deadline = DateTime.UtcNow.AddSeconds(10);
            while (store.GetHistory(120).Length < cycles || !service.Cycle.IsCompleted)
            {
                Assert.True(DateTime.UtcNow < deadline, $"poll {cycles} did not finish");
                await Task.Yield();
            }
        }

        await service.StartAsync(CancellationToken.None);
        try
        {
            await PolledAsync(1);
            for (var tick = 1; tick <= 3; tick++)
            {
                clock.Advance(TimeSpan.FromSeconds(30));
                await PolledAsync(1 + tick);
            }
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.Equal((TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30)), clock.Created);
        Assert.Equal((4, 4, 4000), (queueReads, topicReads, subscriptionReads));
        Assert.Equal(4, store.GetHistory(120).Length);
        Assert.Equal(10_000, store.GetLatest()!.Subscriptions.Count);
    }
}
