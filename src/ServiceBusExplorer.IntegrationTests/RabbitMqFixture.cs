using System.Net;
using System.Net.Http.Headers;
using System.Text;
using DotNet.Testcontainers.Builders;
using RabbitMQ.Client;
using ServiceBusExplorer.Core.Providers.RabbitMQ;
using Testcontainers.RabbitMq;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Starts one RabbitMQ broker with the management plugin for the whole collection and is the only
/// source of its address and credentials. It also offers a second AMQP client and an HTTP client on
/// the management API, used only to arrange and observe broker state.
/// </summary>
public sealed class RabbitMqFixture : IAsyncLifetime
{
    /// <summary>The pinned image; the management plugin serves the HTTP API the provider calls.</summary>
    public const string Image = "rabbitmq:4.3.7-management";

    private const int AmqpContainerPort = 5672;
    private const int ManagementContainerPort = 15672;

    private readonly RabbitMqContainer _container;
    private IConnection? _observer;

    /// <summary>Creates the fixture with a user name and a random password that exist only in this run.</summary>
    public RabbitMqFixture()
    {
        Username = "it-admin";
        Password = Guid.NewGuid().ToString("N");
        _container = new RabbitMqBuilder(Image)
            .WithUsername(Username)
            .WithPassword(Password)
            .WithPortBinding(ManagementContainerPort, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(request => request
                .ForPort(ManagementContainerPort)
                .ForPath("/api/overview")
                .WithBasicAuthentication(Username, Password)))
            .Build();
    }

    /// <summary>The host the container is reachable on.</summary>
    public string Host => _container.Hostname;

    /// <summary>The host port mapped to the container's AMQP port.</summary>
    public int AmqpPort => _container.GetMappedPublicPort(AmqpContainerPort);

    /// <summary>The host port mapped to the container's management port.</summary>
    public int ManagementPort => _container.GetMappedPublicPort(ManagementContainerPort);

    /// <summary>The administrator user of the container.</summary>
    public string Username { get; }

    /// <summary>The administrator password of the container.</summary>
    public string Password { get; }

    /// <summary>An HTTP client on the management API, authenticated as the administrator.</summary>
    public HttpClient Management { get; private set; } = null!;

    /// <summary>Builds the provider's connection configuration from the container.</summary>
    public RabbitMQConnectionConfig CreateConfig() => new()
    {
        Name = "integration",
        HostName = Host,
        Port = AmqpPort,
        ManagementPort = ManagementPort,
        UserName = Username,
        Password = Password
    };

    /// <summary>Returns a provider connected to the container.</summary>
    public async Task<RabbitMQProvider> ConnectAsync()
    {
        var provider = new RabbitMQProvider();
        await provider.ConnectAsync(CreateConfig());
        return provider;
    }

    /// <summary>A queue or exchange name no other test uses.</summary>
    public static string UniqueName(string tag) => $"it-{tag}-{Guid.NewGuid():N}";

    /// <summary>Publishes a message through the observer client.</summary>
    public void Publish(string exchange, string routingKey, string body, Action<IBasicProperties>? configure = null)
    {
        using var channel = _observer!.CreateModel();
        var properties = channel.CreateBasicProperties();
        configure?.Invoke(properties);
        channel.ConfirmSelect();
        channel.BasicPublish(exchange, routingKey, properties, Encoding.UTF8.GetBytes(body));
        channel.WaitForConfirmsOrDie(TimeSpan.FromSeconds(10));
    }

    /// <summary>
    /// Publishes a message with a content type to a queue through the default exchange. A message with
    /// no property at all is published with <see cref="Publish"/> instead.
    /// </summary>
    public void PublishToQueue(string queue, string body) => Publish("", queue, body, p => p.ContentType = "text/plain");

    /// <summary>The number of ready messages in a queue, read over AMQP.</summary>
    public uint MessageCount(string queue)
    {
        using var channel = _observer!.CreateModel();
        return channel.QueueDeclarePassive(queue).MessageCount;
    }

    /// <summary>Consumes the head message of a queue as a second client and returns its body.</summary>
    public string? ConsumeHead(string queue)
    {
        using var channel = _observer!.CreateModel();
        var result = channel.BasicGet(queue, autoAck: true);
        return result is null ? null : Encoding.UTF8.GetString(result.Body.Span);
    }

    /// <summary>Consumes every message of a queue and returns the bodies in order.</summary>
    public List<string> Drain(string queue)
    {
        using var channel = _observer!.CreateModel();
        var bodies = new List<string>();
        while (channel.BasicGet(queue, autoAck: true) is { } result)
        {
            bodies.Add(Encoding.UTF8.GetString(result.Body.Span));
        }

        return bodies;
    }

    /// <summary>Waits until a queue holds the expected number of ready messages, or fails.</summary>
    public async Task WaitForMessageCountAsync(string queue, uint expected)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (MessageCount(queue) != expected)
        {
            if (DateTime.UtcNow > deadline)
            {
                Assert.Fail($"Queue '{queue}' holds {MessageCount(queue)} messages, expected {expected}.");
            }

            await Task.Delay(50);
        }
    }

    /// <summary>Whether a queue exists, read over the management API so no channel is closed.</summary>
    public async Task<bool> QueueExistsAsync(string queue)
    {
        using var response = await Management.GetAsync($"queues/%2F/{Uri.EscapeDataString(queue)}");
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return false;
        }

        response.EnsureSuccessStatusCode();
        return true;
    }

    /// <summary>Deletes a queue if it exists, through the management API.</summary>
    public Task DeleteQueueAsync(string queue) => DeleteIfExistsAsync($"queues/%2F/{Uri.EscapeDataString(queue)}");

    /// <summary>Deletes an exchange if it exists, through the management API.</summary>
    public Task DeleteExchangeAsync(string exchange) => DeleteIfExistsAsync($"exchanges/%2F/{Uri.EscapeDataString(exchange)}");

    /// <summary>Deletes a user if it exists, through the management API.</summary>
    public Task DeleteUserAsync(string user) => DeleteIfExistsAsync($"users/{Uri.EscapeDataString(user)}");

    private async Task DeleteIfExistsAsync(string path)
    {
        using var response = await Management.DeleteAsync(path);
        if (response.StatusCode != HttpStatusCode.NotFound)
        {
            response.EnsureSuccessStatusCode();
        }
    }

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        var addresses = await Dns.GetHostAddressesAsync(Host);
        if (addresses.Length == 0 || !addresses.All(IPAddress.IsLoopback))
        {
            throw new InvalidOperationException(
                $"The broker container is reachable at '{Host}', which is not a loopback address; no test runs against it.");
        }

        Management =new HttpClient { BaseAddress = new Uri($"http://{Host}:{ManagementPort}/api/") };
        Management.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{Username}:{Password}")));

        _observer = new ConnectionFactory
        {
            HostName = Host,
            Port = AmqpPort,
            UserName = Username,
            Password = Password
        }.CreateConnection();
    }

    /// <inheritdoc />
    public async Task DisposeAsync()
    {
        _observer?.Dispose();
        Management?.Dispose();
        await _container.DisposeAsync();
    }
}

/// <summary>The one collection every RabbitMQ test belongs to, so the run starts one broker.</summary>
[CollectionDefinition(Name)]
public sealed class RabbitMqCollection : ICollectionFixture<RabbitMqFixture>
{
    /// <summary>The collection name.</summary>
    public const string Name = "RabbitMQ";
}
