using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Api.Monitoring;

public class MonitoringBackgroundService : BackgroundService
{
    private readonly MonitoringStore _store;
    private readonly ILogger<MonitoringBackgroundService> _logger;
    private IMessagingProvider? _lastProvider;

    public MonitoringBackgroundService(MonitoringStore store, ILogger<MonitoringBackgroundService> logger)
    {
        _store = store;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("MonitoringBackgroundService started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CollectSnapshotAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error collecting monitoring snapshot");
            }

            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }

    private async Task CollectSnapshotAsync()
    {
        var provider = ConnectionsController.GetCurrentProvider();

        // Detect provider change — clear store
        if (!ReferenceEquals(provider, _lastProvider))
        {
            _logger.LogInformation("Provider changed, clearing monitoring store");
            _store.Clear();
            _lastProvider = provider;
        }

        if (provider == null || !provider.IsConnected)
            return;

        var queues = await provider.GetQueuesAsync();
        var topics = await provider.GetTopicsAsync();

        var snapshot = new MonitoringSnapshot
        {
            Timestamp = DateTimeOffset.UtcNow,
            Queues = queues.Select(q => new MonitoringEntityDto
            {
                Name = q.Name,
                ActiveMessageCount = q.ActiveMessageCount,
                DeadLetterMessageCount = q.DeadLetterMessageCount,
                TransferMessageCount = q.TransferMessageCount,
                ScheduledMessageCount = q.ScheduledMessageCount
            }).ToList()
        };

        foreach (var topic in topics)
        {
            var subs = await provider.GetSubscriptionsAsync(topic.Name);
            foreach (var sub in subs)
            {
                snapshot.Subscriptions.Add(new MonitoringSubscriptionDto
                {
                    TopicName = topic.Name,
                    Name = sub.Name,
                    ActiveMessageCount = sub.ActiveMessageCount,
                    DeadLetterMessageCount = sub.DeadLetterMessageCount,
                    TransferMessageCount = sub.TransferMessageCount
                });
            }
        }

        _store.Add(snapshot);
        _logger.LogDebug("Monitoring snapshot collected: {QueueCount} queues, {SubCount} subscriptions",
            snapshot.Queues.Count, snapshot.Subscriptions.Count);
    }
}
