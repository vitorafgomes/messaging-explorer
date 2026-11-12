using System.Net;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;
using Testcontainers.ServiceBus;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Starts one Azure Service Bus emulator, with the SQL Server container it needs, for the whole
/// collection and is the only source of its connection strings. The emulator serves messaging over
/// AMQP and the management API over HTTP on two different ports, so it hands out two connection
/// strings and two providers: one for messages, one for entities. It also offers a second client and
/// an administration client, used only to arrange and observe broker state.
/// </summary>
public sealed class AzureServiceBusFixture : IAsyncLifetime
{
    /// <summary>The pinned emulator image; the tag the floating <c>latest</c> pointed at on 2026-11-12.</summary>
    public const string Image = "mcr.microsoft.com/azure-messaging/servicebus-emulator:2.0.1";

    /// <summary>The port the emulator serves AMQP on inside the container.</summary>
    public const int AmqpContainerPort = 5672;

    /// <summary>The port the emulator serves the management API on inside the container.</summary>
    public const int ManagementContainerPort = 5300;

    /// <summary>
    /// How long the SQL Server and emulator containers may take to become ready. Their readiness
    /// checks have no deadline of their own; on a host short of memory SQL Server never becomes ready
    /// and the run would hang instead of failing.
    /// </summary>
    public static readonly TimeSpan StartTimeout = TimeSpan.FromMinutes(5);

    private readonly ServiceBusContainer _container = new ServiceBusBuilder(Image)
        .WithAcceptLicenseAgreement(true)
        .Build();

    /// <summary>The connection string of the AMQP endpoint: send, peek, receive and the bulk operations.</summary>
    public string MessagingConnectionString => _container.GetConnectionString();

    /// <summary>The connection string of the HTTP endpoint: listing, reading, creating and deleting entities.</summary>
    public string ManagementConnectionString => _container.GetHttpConnectionString();

    /// <summary>A second messaging client, used only to arrange and observe messages.</summary>
    public ServiceBusClient Client { get; private set; } = null!;

    /// <summary>An administration client, used only to arrange and observe entities.</summary>
    public ServiceBusAdministrationClient Admin { get; private set; } = null!;

    /// <summary>The provider's configuration for the AMQP endpoint.</summary>
    public AzureConnectionConfig CreateMessagingConfig() => new() { Name = "integration-messaging", ConnectionString = MessagingConnectionString };

    /// <summary>The provider's configuration for the HTTP endpoint.</summary>
    public AzureConnectionConfig CreateManagementConfig() => new() { Name = "integration-management", ConnectionString = ManagementConnectionString };

    /// <summary>A provider connected to the AMQP endpoint through the factory, the way the API connects.</summary>
    public Task<IMessagingProvider> ConnectMessagingAsync() => ConnectAsync(MessagingConnectionString);

    /// <summary>A provider connected to the HTTP endpoint through the factory, the way the API connects.</summary>
    public Task<IMessagingProvider> ConnectManagementAsync() => ConnectAsync(ManagementConnectionString);

    private static Task<IMessagingProvider> ConnectAsync(string connectionString) =>
        new ProviderFactory().CreateConnectedProviderAsync(new ServiceBusConnection
        {
            Name = "integration",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = connectionString
        });

    /// <summary>An entity name no other test uses.</summary>
    public static string UniqueName(string tag) => $"it-{tag}-{Guid.NewGuid():N}";

    /// <summary>The endpoint of a connection string, parsed by the SDK.</summary>
    public static Uri EndpointOf(string connectionString) => ServiceBusConnectionStringProperties.Parse(connectionString).Endpoint;

    /// <summary>Sends messages with the given bodies, in order, through the arranging client.</summary>
    public async Task SendAsync(string entity, params string[] bodies)
    {
        await using var sender = Client.CreateSender(entity);
        foreach (var body in bodies)
        {
            await sender.SendMessageAsync(new ServiceBusMessage(body));
        }
    }

    /// <summary>Sends messages to a queue and dead-letters all of them, in order, through the arranging client.</summary>
    public async Task SendToDeadLetterAsync(string queue, params string[] bodies)
    {
        await SendAsync(queue, bodies);
        await using var receiver = Client.CreateReceiver(queue);
        var remaining = bodies.Length;
        while (remaining > 0)
        {
            var batch = await receiver.ReceiveMessagesAsync(remaining, TimeSpan.FromSeconds(5));
            Assert.NotEmpty(batch);
            foreach (var message in batch)
            {
                await receiver.DeadLetterMessageAsync(message, "arranged", "dead-lettered by the test");
            }

            remaining -= batch.Count;
        }
    }

    /// <summary>
    /// Receives and deletes every message of an entity path (a queue, a subscription or a dead-letter
    /// queue) and returns the bodies in order. The emulator reports every runtime count as zero, so a
    /// count is read this way. A peek decides whether the entity is empty; a receive wait alone does
    /// not, because the first receive on an idle client can time out while messages are there.
    /// </summary>
    public async Task<List<string>> DrainAsync(string entityPath)
    {
        await using var receiver = Client.CreateReceiver(entityPath, new ServiceBusReceiverOptions { ReceiveMode = ServiceBusReceiveMode.ReceiveAndDelete });
        var bodies = new List<string>();
        if (await receiver.PeekMessageAsync() is null)
        {
            return bodies;
        }

        var wait = TimeSpan.FromSeconds(5);
        while (true)
        {
            var batch = await receiver.ReceiveMessagesAsync(100, wait);
            wait = TimeSpan.FromSeconds(1);
            if (batch.Count == 0)
            {
                return bodies;
            }

            bodies.AddRange(batch.Select(m => m.Body.ToString()));
        }
    }

    /// <summary>The dead-letter path of a queue.</summary>
    public static string DeadLetterOf(string queue) => $"{queue}/$deadletterqueue";

    /// <summary>Deletes a queue if it exists.</summary>
    public async Task DeleteQueueAsync(string queue)
    {
        if ((await Admin.QueueExistsAsync(queue)).Value)
        {
            await Admin.DeleteQueueAsync(queue);
        }
    }

    /// <summary>Deletes a topic and its subscriptions if it exists.</summary>
    public async Task DeleteTopicAsync(string topic)
    {
        if ((await Admin.TopicExistsAsync(topic)).Value)
        {
            await Admin.DeleteTopicAsync(topic);
        }
    }

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        using var startDeadline = new CancellationTokenSource(StartTimeout);
        await _container.StartAsync(startDeadline.Token);

        foreach (var endpoint in new[] { EndpointOf(MessagingConnectionString), EndpointOf(ManagementConnectionString) })
        {
            var addresses = await Dns.GetHostAddressesAsync(endpoint.Host);
            if (addresses.Length == 0 || !addresses.All(IPAddress.IsLoopback))
            {
                throw new InvalidOperationException(
                    $"The emulator container is reachable at '{endpoint.Host}', which is not a loopback address; no test runs against it.");
            }
        }

        Client = new ServiceBusClient(MessagingConnectionString);
        Admin = new ServiceBusAdministrationClient(ManagementConnectionString);
    }

    /// <inheritdoc />
    public async Task DisposeAsync()
    {
        if (Client is not null)
        {
            await Client.DisposeAsync();
        }

        await _container.DisposeAsync();
    }
}

/// <summary>The one collection every Azure Service Bus test belongs to, so the run starts one emulator.</summary>
[CollectionDefinition(Name)]
public sealed class AzureServiceBusCollection : ICollectionFixture<AzureServiceBusFixture>
{
    /// <summary>The collection name.</summary>
    public const string Name = "AzureServiceBus";
}
