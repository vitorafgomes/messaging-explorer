using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Api.Monitoring;

/// <summary>
/// Polls the counts of every queue and subscription of the connected broker on a fixed period and keeps them in
/// <see cref="MonitoringStore"/>. A tick that finds the previous poll still running is skipped.
/// </summary>
public class MonitoringBackgroundService : BackgroundService
{
    /// <summary>The configuration key of the period, in whole seconds.</summary>
    public const string IntervalKey = "Monitoring:PollIntervalSeconds";

    /// <summary>The shortest period: a shorter configured value is raised to it.</summary>
    public static readonly TimeSpan IntervalFloor = TimeSpan.FromSeconds(30);

    /// <summary>The longest period: a longer configured value is lowered to it.</summary>
    public static readonly TimeSpan IntervalCeiling = TimeSpan.FromHours(1);

    /// <summary>
    /// How many topics have their subscriptions listed at once. Each is one management request to the namespace;
    /// four keeps a poll of a namespace with many topics from running one round trip after another while never
    /// holding more than four management requests open against a production namespace.
    /// </summary>
    public const int MaxConcurrentSubscriptionReads = 4;

    private readonly MonitoringStore _store;
    private readonly ILogger _logger;
    private readonly Func<IMessagingProvider?> _currentProvider;
    private IMessagingProvider? _lastProvider;
    private Task _cycle = Task.CompletedTask;

    public MonitoringBackgroundService(MonitoringStore store, ILogger<MonitoringBackgroundService> logger, IConfiguration configuration)
        : this(store, logger, configuration, ConnectionsController.GetCurrentProvider)
    {
    }

    internal MonitoringBackgroundService(MonitoringStore store, ILogger logger, IConfiguration configuration, Func<IMessagingProvider?> currentProvider)
    {
        _store = store;
        _logger = logger;
        _currentProvider = currentProvider;
        Interval = ReadInterval(configuration);
    }

    /// <summary>The period of the poll's timer.</summary>
    public TimeSpan Interval { get; }

    /// <summary>The poll started last; completed when none is running.</summary>
    internal Task Cycle => _cycle;

    /// <summary>
    /// The configured period in whole seconds, kept between <see cref="IntervalFloor"/> and
    /// <see cref="IntervalCeiling"/>; the floor when the value is absent or not a whole number.
    /// </summary>
    public static TimeSpan ReadInterval(IConfiguration configuration)
    {
        if (!int.TryParse(configuration[IntervalKey], out var seconds))
            return IntervalFloor;

        var configured = TimeSpan.FromSeconds(seconds);
        if (configured < IntervalFloor) return IntervalFloor;
        return configured > IntervalCeiling ? IntervalCeiling : configured;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Monitoring polls every {Interval}", Interval);
        using var timer = new PeriodicTimer(Interval);
        do
        {
            StartCycle(stoppingToken);
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>
    /// Starts a poll, or skips this tick and returns false when the previous poll has not finished.
    /// </summary>
    internal bool StartCycle(CancellationToken cancellationToken)
    {
        if (!_cycle.IsCompleted)
        {
            _logger.LogWarning("Monitoring poll skipped: the previous poll is still running after {Interval}", Interval);
            return false;
        }

        _cycle = RunCycleAsync(cancellationToken);
        return true;
    }

    private async Task RunCycleAsync(CancellationToken cancellationToken)
    {
        var provider = _currentProvider();

        if (!ReferenceEquals(provider, _lastProvider))
        {
            _logger.LogInformation("Provider changed, clearing monitoring store");
            _store.Clear();
            _lastProvider = provider;
        }

        if (provider == null || !provider.IsConnected)
            return;

        try
        {
            var snapshot = await CollectAsync(provider, cancellationToken);
            if (!ReferenceEquals(provider, _currentProvider()))
                return;

            _store.Add(snapshot);
            _logger.LogDebug("Monitoring snapshot collected: {QueueCount} queues, {SubCount} subscriptions",
                snapshot.Queues.Count, snapshot.Subscriptions.Count);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error collecting monitoring snapshot");
            if (ReferenceEquals(provider, _currentProvider()))
                _store.RecordFailure(DateTimeOffset.UtcNow);
        }
    }

    private static async Task<MonitoringSnapshot> CollectAsync(IMessagingProvider provider, CancellationToken cancellationToken)
    {
        var capabilities = provider.Capabilities;
        var queues = (await provider.GetQueuesAsync()).ToList();
        var topics = (await provider.GetTopicsAsync()).Select(t => t.Name).ToList();

        var perTopic = new List<MonitoringSubscriptionDto>[topics.Count];
        var options = new ParallelOptions { MaxDegreeOfParallelism = MaxConcurrentSubscriptionReads, CancellationToken = cancellationToken };
        await Parallel.ForEachAsync(Enumerable.Range(0, topics.Count), options, async (i, _) =>
        {
            var subscriptions = await provider.GetSubscriptionsAsync(topics[i]);
            perTopic[i] = subscriptions.Select(s => MonitoringSubscriptionDto.FromSubscription(topics[i], s, capabilities)).ToList();
        });

        return new MonitoringSnapshot
        {
            Timestamp = DateTimeOffset.UtcNow,
            Queues = queues.Select(q => MonitoringEntityDto.FromQueue(q, capabilities)).ToList(),
            Subscriptions = perTopic.SelectMany(s => s).ToList()
        };
    }
}
