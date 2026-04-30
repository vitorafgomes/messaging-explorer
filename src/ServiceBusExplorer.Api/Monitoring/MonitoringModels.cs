namespace ServiceBusExplorer.Api.Monitoring;

public class MonitoringSnapshot
{
    public DateTimeOffset Timestamp { get; set; }
    public List<MonitoringEntityDto> Queues { get; set; } = [];
    public List<MonitoringSubscriptionDto> Subscriptions { get; set; } = [];
}

public class MonitoringEntityDto
{
    public string Name { get; set; } = string.Empty;
    public long ActiveMessageCount { get; set; }
    public long DeadLetterMessageCount { get; set; }
    public long TransferMessageCount { get; set; }
    public long ScheduledMessageCount { get; set; }
}

public class MonitoringSubscriptionDto : MonitoringEntityDto
{
    public string TopicName { get; set; } = string.Empty;
}
