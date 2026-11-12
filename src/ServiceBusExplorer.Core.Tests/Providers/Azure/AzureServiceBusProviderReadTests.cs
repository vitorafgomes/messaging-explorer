using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Moq;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The single-queue read and the received-message mapping, against a mocked
/// <see cref="ServiceBusAdministrationClient"/> and SDK model factory objects.
/// </summary>
public class AzureServiceBusProviderReadTests
{
    private const string QueueName = "orders";

    private static QueueProperties ConfiguredQueue() =>
        ServiceBusModelFactory.QueueProperties(
            name: QueueName,
            lockDuration: TimeSpan.FromSeconds(45),
            maxSizeInMegabytes: 2048,
            requiresDuplicateDetection: true,
            requiresSession: true,
            defaultMessageTimeToLive: TimeSpan.FromMinutes(30),
            autoDeleteOnIdle: TimeSpan.FromDays(7),
            deadLetteringOnMessageExpiration: true,
            duplicateDetectionHistoryTimeWindow: TimeSpan.FromMinutes(10),
            maxDeliveryCount: 3,
            enableBatchedOperations: true,
            status: EntityStatus.SendDisabled,
            forwardTo: "orders-archive",
            forwardDeadLetteredMessagesTo: "orders-poison",
            userMetadata: "owned by billing",
            enablePartitioning: true,
            maxMessageSizeInKilobytes: 1024);

    private static QueueRuntimeProperties QueueRuntime() =>
        ServiceBusModelFactory.QueueRuntimeProperties(
            name: QueueName,
            activeMessageCount: 11,
            scheduledMessageCount: 12,
            deadLetterMessageCount: 13,
            transferDeadLetterMessageCount: 14,
            transferMessageCount: 15,
            totalMessageCount: 65,
            sizeInBytes: 4096,
            createdAt: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
            updatedAt: new DateTimeOffset(2026, 1, 2, 0, 0, 0, TimeSpan.Zero),
            accessedAt: new DateTimeOffset(2026, 1, 3, 0, 0, 0, TimeSpan.Zero));

    private static Mock<ServiceBusAdministrationClient> AdminReturning(
        Func<Task<Response<QueueProperties>>> properties,
        Func<Task<Response<QueueRuntimeProperties>>> runtime)
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetQueueAsync(QueueName, It.IsAny<CancellationToken>())).Returns(properties);
        admin.Setup(a => a.GetQueueRuntimePropertiesAsync(QueueName, It.IsAny<CancellationToken>())).Returns(runtime);
        return admin;
    }

    private static Task<Response<T>> Ok<T>(T value) => Task.FromResult(Response.FromValue(value, Mock.Of<Response>()));

    private static Task<Response<T>> Fails<T>(ServiceBusFailureReason reason) =>
        Task.FromException<Response<T>>(new ServiceBusException("broker said no", reason));

    [Fact]
    public async Task Queue_details_carry_every_configured_and_runtime_value_of_the_queue()
    {
        var admin = AdminReturning(() => Ok(ConfiguredQueue()), () => Ok(QueueRuntime()));

        var queue = await AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, QueueName);

        Assert.NotNull(queue);
        Assert.Equal(QueueName, queue.Name);
        Assert.Equal("SendDisabled", queue.Status);
        Assert.Equal(TimeSpan.FromSeconds(45), queue.LockDuration);
        Assert.Equal(3, queue.MaxDeliveryCount);
        Assert.Equal(TimeSpan.FromMinutes(30), queue.DefaultMessageTimeToLive);
        Assert.Equal(2048, queue.MaxSizeInMegabytes);
        Assert.True(queue.RequiresSession);
        Assert.True(queue.DeadLetteringOnMessageExpiration);
        Assert.True(queue.EnablePartitioning);
        Assert.Equal((11L, 12L, 13L, 15L, 4096L), (queue.ActiveMessageCount, queue.ScheduledMessageCount, queue.DeadLetterMessageCount, queue.TransferMessageCount, queue.SizeInBytes));
    }

    [Fact]
    public async Task Queue_details_carry_forward_to_auto_delete_duplicate_detection_user_metadata_batched_operations_max_message_size_and_the_transfer_dead_letter_count()
    {
        var admin = AdminReturning(() => Ok(ConfiguredQueue()), () => Ok(QueueRuntime()));

        var queue = await AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, QueueName);

        Assert.NotNull(queue);
        Assert.Equal("orders-archive", queue.ForwardTo);
        Assert.Equal("orders-poison", queue.ForwardDeadLetteredMessagesTo);
        Assert.Equal(TimeSpan.FromDays(7), queue.AutoDeleteOnIdle);
        Assert.True(queue.RequiresDuplicateDetection);
        Assert.Equal(TimeSpan.FromMinutes(10), queue.DuplicateDetectionHistoryTimeWindow);
        Assert.Equal("owned by billing", queue.UserMetadata);
        Assert.True(queue.EnableBatchedOperations);
        Assert.Equal(1024L, queue.MaxMessageSizeInKilobytes);
        Assert.Equal(14L, queue.TransferDeadLetterMessageCount);
    }

    [Fact]
    public async Task A_failing_queue_properties_call_reaches_the_caller_instead_of_a_null_or_half_filled_queue()
    {
        var admin = AdminReturning(() => Fails<QueueProperties>(ServiceBusFailureReason.ServiceBusy), () => Ok(QueueRuntime()));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() => AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, QueueName));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task A_queue_that_either_call_reports_not_found_is_null(bool propertiesNotFound, bool runtimeNotFound)
    {
        var admin = AdminReturning(
            () => propertiesNotFound ? Fails<QueueProperties>(ServiceBusFailureReason.MessagingEntityNotFound) : Ok(ConfiguredQueue()),
            () => runtimeNotFound ? Fails<QueueRuntimeProperties>(ServiceBusFailureReason.MessagingEntityNotFound) : Ok(QueueRuntime()));

        var queue = await AzureServiceBusProvider.GetQueueCoreAsync(admin.Object, QueueName);

        Assert.Null(queue);
    }

    [Theory]
    [InlineData(ServiceBusMessageState.Active, "Active")]
    [InlineData(ServiceBusMessageState.Deferred, "Deferred")]
    [InlineData(ServiceBusMessageState.Scheduled, "Scheduled")]
    public void A_message_says_its_state_and_its_body_size_in_bytes(ServiceBusMessageState state, string expectedState)
    {
        var received = ServiceBusModelFactory.ServiceBusReceivedMessage(
            body: BinaryData.FromString("price €12"),
            sequenceNumber: 7,
            serviceBusMessageState: state);

        var message = AzureServiceBusProvider.MapToMessageInfo(received, isDeadLettered: false);

        Assert.Equal(expectedState, message.State);
        Assert.Equal(11L, message.SizeInBytes);
    }
}
