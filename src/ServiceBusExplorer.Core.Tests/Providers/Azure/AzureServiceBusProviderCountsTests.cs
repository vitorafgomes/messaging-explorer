using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Moq;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The counts read of one queue or one subscription: one runtime-properties call that carries the caller's token,
/// the counts the monitoring screen shows, null for an entity the broker does not know, and a broker failure that
/// reaches the caller.
/// </summary>
public class AzureServiceBusProviderCountsTests
{
    private static readonly DateTimeOffset At = new(2026, 11, 13, 0, 0, 0, TimeSpan.Zero);

    private static QueueRuntimeProperties QueueRuntime() =>
        ServiceBusModelFactory.QueueRuntimeProperties(
            name: "orders", activeMessageCount: 11, scheduledMessageCount: 12, deadLetterMessageCount: 13,
            transferDeadLetterMessageCount: 14, transferMessageCount: 15, totalMessageCount: 65, sizeInBytes: 4096,
            createdAt: At, updatedAt: At, accessedAt: At);

    private static SubscriptionRuntimeProperties SubscriptionRuntime() =>
        ServiceBusModelFactory.SubscriptionRuntimeProperties(
            topicName: "events", subscriptionName: "audit", totalMessageCount: 10, activeMessageCount: 1,
            deadLetterMessageCount: 2, transferMessageCount: 3, transferDeadLetterMessageCount: 4,
            createdAt: At, updatedAt: At, accessedAt: At);

    private static Task<Response<T>> Ok<T>(T value) => Task.FromResult(Response.FromValue(value, Mock.Of<Response>()));

    private static Task<Response<T>> Fails<T>(ServiceBusFailureReason reason) =>
        Task.FromException<Response<T>>(new ServiceBusException("broker said no", reason));

    [Fact]
    public async Task A_queue_counts_read_is_one_runtime_call_with_the_callers_token_and_carries_the_transfer_dead_letter_count()
    {
        using var cts = new CancellationTokenSource();
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetQueueRuntimePropertiesAsync("orders", cts.Token)).Returns(Ok(QueueRuntime()));

        var queue = await AzureServiceBusProvider.GetQueueCountsCoreAsync(admin.Object, "orders", cts.Token);

        Assert.NotNull(queue);
        Assert.Equal(("orders", 11L, 13L, 12L, 15L, 14L),
            (queue.Name, queue.ActiveMessageCount, queue.DeadLetterMessageCount, queue.ScheduledMessageCount, queue.TransferMessageCount, queue.TransferDeadLetterMessageCount));
    }

    [Fact]
    public async Task A_subscription_counts_read_is_one_runtime_call_with_the_callers_token_and_carries_the_transfer_dead_letter_count()
    {
        using var cts = new CancellationTokenSource();
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetSubscriptionRuntimePropertiesAsync("events", "audit", cts.Token)).Returns(Ok(SubscriptionRuntime()));

        var subscription = await AzureServiceBusProvider.GetSubscriptionCountsCoreAsync(admin.Object, "events", "audit", cts.Token);

        Assert.NotNull(subscription);
        Assert.Equal(("events", "audit", 1L, 2L, 3L, 4L),
            (subscription.TopicName, subscription.Name, subscription.ActiveMessageCount, subscription.DeadLetterMessageCount, subscription.TransferMessageCount, subscription.TransferDeadLetterMessageCount));
    }

    [Fact]
    public async Task A_counts_read_of_an_entity_the_broker_does_not_know_is_null()
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetQueueRuntimePropertiesAsync("gone", It.IsAny<CancellationToken>()))
            .Returns(Fails<QueueRuntimeProperties>(ServiceBusFailureReason.MessagingEntityNotFound));
        admin.Setup(a => a.GetSubscriptionRuntimePropertiesAsync("events", "gone", It.IsAny<CancellationToken>()))
            .Returns(Fails<SubscriptionRuntimeProperties>(ServiceBusFailureReason.MessagingEntityNotFound));

        Assert.Null(await AzureServiceBusProvider.GetQueueCountsCoreAsync(admin.Object, "gone", CancellationToken.None));
        Assert.Null(await AzureServiceBusProvider.GetSubscriptionCountsCoreAsync(admin.Object, "events", "gone", CancellationToken.None));
    }

    [Fact]
    public async Task A_failing_counts_read_reaches_the_caller_as_the_broker_exception_instead_of_a_null_or_zero_counts()
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetQueueRuntimePropertiesAsync("orders", It.IsAny<CancellationToken>()))
            .Returns(Fails<QueueRuntimeProperties>(ServiceBusFailureReason.ServiceBusy));
        admin.Setup(a => a.GetSubscriptionRuntimePropertiesAsync("events", "audit", It.IsAny<CancellationToken>()))
            .Returns(Fails<SubscriptionRuntimeProperties>(ServiceBusFailureReason.ServiceTimeout));

        var queueError = await Assert.ThrowsAsync<ServiceBusException>(() => AzureServiceBusProvider.GetQueueCountsCoreAsync(admin.Object, "orders", CancellationToken.None));
        var subscriptionError = await Assert.ThrowsAsync<ServiceBusException>(() => AzureServiceBusProvider.GetSubscriptionCountsCoreAsync(admin.Object, "events", "audit", CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, queueError.Reason);
        Assert.Equal(ServiceBusFailureReason.ServiceTimeout, subscriptionError.Reason);
    }
}
