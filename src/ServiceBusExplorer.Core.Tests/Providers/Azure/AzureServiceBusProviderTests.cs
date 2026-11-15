using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using Azure.Messaging.ServiceBus;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

public class AzureServiceBusProviderTests
{
    private const string FakeFqn = "fake.servicebus.windows.net";

    // ServiceBusClient / AdministrationClient are lazy — constructing them
    // does not reach out to Azure, so these tests never authenticate.

    [Fact]
    public async Task ConnectAsync_ServicePrincipal_sets_IsConnected_and_CurrentTarget()
    {
        var provider = new AzureServiceBusProvider();
        var config = new AzureConnectionConfig
        {
            Name = "sp",
            AuthType = AzureAuthType.ServicePrincipal,
            FullyQualifiedNamespace = FakeFqn,
            TenantId = "11111111-1111-1111-1111-111111111111",
            ServicePrincipalClientId = "22222222-2222-2222-2222-222222222222",
            ClientSecret = "secret"
        };

        await provider.ConnectAsync(config);

        Assert.True(provider.IsConnected);
        Assert.Equal("fake", provider.CurrentTarget);

        await provider.DisposeAsync();
    }

    [Fact]
    public async Task ConnectAsync_AzureCli_sets_IsConnected_and_CurrentTarget()
    {
        var provider = new AzureServiceBusProvider();
        var config = new AzureConnectionConfig
        {
            Name = "cli",
            AuthType = AzureAuthType.AzureCli,
            FullyQualifiedNamespace = FakeFqn
        };

        await provider.ConnectAsync(config);

        Assert.True(provider.IsConnected);
        Assert.Equal("fake", provider.CurrentTarget);

        await provider.DisposeAsync();
    }

    [Fact]
    public async Task ConnectAsync_DefaultCredential_sets_IsConnected_and_CurrentTarget()
    {
        var provider = new AzureServiceBusProvider();
        var config = new AzureConnectionConfig
        {
            Name = "default",
            AuthType = AzureAuthType.DefaultCredential,
            FullyQualifiedNamespace = FakeFqn
        };

        await provider.ConnectAsync(config);

        Assert.True(provider.IsConnected);
        Assert.Equal("fake", provider.CurrentTarget);

        await provider.DisposeAsync();
    }

    [Fact]
    public async Task ConnectAsync_ConnectionString_path_still_works()
    {
        var provider = new AzureServiceBusProvider();
        var config = new AzureConnectionConfig
        {
            Name = "cs",
            AuthType = AzureAuthType.ConnectionString,
            ConnectionString = "Endpoint=sb://legacy.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        };

        await provider.ConnectAsync(config);

        Assert.True(provider.IsConnected);
        Assert.Equal("legacy", provider.CurrentTarget);

        await provider.DisposeAsync();
    }

    private const string ConnectionString =
        "Endpoint=sb://proxied.invalid/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    [Fact]
    public void The_client_options_of_a_connection_with_no_transport_set_are_AMQP_without_a_proxy()
    {
        var options = AzureServiceBusProvider.BuildClientOptions(new AzureConnectionConfig { Name = "amqp", ConnectionString = ConnectionString });

        Assert.Equal(ServiceBusTransportType.AmqpTcp, options.TransportType);
        Assert.Null(options.WebProxy);
        Assert.Same(new global::Azure.Messaging.ServiceBus.Administration.ServiceBusAdministrationClientOptions().Transport,
            AzureServiceBusProvider.BuildAdministrationClientOptions(new AzureConnectionConfig { Name = "amqp" }).Transport);
    }

    [Fact]
    public void The_client_options_of_a_WebSockets_connection_are_AMQP_over_WebSockets()
    {
        var options = AzureServiceBusProvider.BuildClientOptions(new AzureConnectionConfig { Name = "ws", UseWebSockets = true });

        Assert.Equal(ServiceBusTransportType.AmqpWebSockets, options.TransportType);
        Assert.Null(options.WebProxy);
    }

    [Fact]
    public void The_client_options_of_a_proxied_connection_carry_the_proxy_with_the_default_credentials_of_this_computer()
    {
        var options = AzureServiceBusProvider.BuildClientOptions(
            new AzureConnectionConfig { Name = "proxied", UseWebSockets = true, ProxyAddress = "http://proxy.example:8080" });

        Assert.Equal(ServiceBusTransportType.AmqpWebSockets, options.TransportType);
        var proxy = Assert.IsType<WebProxy>(options.WebProxy);
        Assert.Equal(new Uri("http://proxy.example:8080"), proxy.Address);
        Assert.True(proxy.UseDefaultCredentials, "The proxy is reached with the default system credentials; no proxy credential is stored");
        Assert.NotSame(new global::Azure.Messaging.ServiceBus.Administration.ServiceBusAdministrationClientOptions().Transport,
            AzureServiceBusProvider.BuildAdministrationClientOptions(new AzureConnectionConfig { Name = "proxied", UseWebSockets = true, ProxyAddress = "http://proxy.example:8080" }).Transport);
    }

    [Fact]
    public async Task A_connection_test_whose_proxy_is_given_a_user_name_is_refused_before_any_call()
    {
        var provider = new AzureServiceBusProvider();
        var config = new AzureConnectionConfig
        {
            Name = "userinfo",
            ConnectionString = ConnectionString,
            UseWebSockets = true,
            ProxyAddress = "http://user:pass@127.0.0.1:1",
        };

        Assert.False(await provider.TestConnectionAsync(config), "A proxy address with user info fails the test");
        await Assert.ThrowsAsync<InvalidOperationException>(() => provider.ConnectAsync(config));
        Assert.False(provider.IsConnected, "A proxy address with user info is never connected");
    }

    /// <summary>
    /// The proxy is a listener on loopback that reads the request line and closes the socket, so the administration
    /// call goes through the proxy and fails there; the namespace, under the reserved .invalid name, is never resolved.
    /// </summary>
    [Fact]
    public async Task A_connection_test_through_a_proxy_that_fails_goes_through_the_proxy_and_answers_false()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var requestLines = new ConcurrentQueue<string>();
        using var stop = new CancellationTokenSource();
        var proxy = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                using var socket = await listener.AcceptSocketAsync(stop.Token);
                try
                {
                    using var reader = new StreamReader(new NetworkStream(socket));
                    requestLines.Enqueue(await reader.ReadLineAsync(stop.Token) ?? string.Empty);
                }
                catch (Exception e) when (e is IOException or SocketException)
                {
                    requestLines.Enqueue($"reset: {e.GetType().Name}");
                }
            }
        });

        var result = await new AzureServiceBusProvider().TestConnectionAsync(new AzureConnectionConfig
        {
            Name = "proxied",
            ConnectionString = ConnectionString,
            UseWebSockets = true,
            ProxyAddress = $"http://127.0.0.1:{port}",
        });
        await stop.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => proxy);

        Assert.False(result, "A test whose proxy drops the connection answers false, like any other failed test");
        Assert.True(requestLines.Contains("CONNECT proxied.invalid:443 HTTP/1.1"),
            $"The administration call goes through the proxy; the proxy saw: [{string.Join(", ", requestLines)}]");
    }
}
