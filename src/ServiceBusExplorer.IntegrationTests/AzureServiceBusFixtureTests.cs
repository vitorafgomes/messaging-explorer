using System.Net;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Pins that the only broker a test reaches is the emulator container this run started.
/// </summary>
[Collection(AzureServiceBusCollection.Name)]
public sealed class AzureServiceBusFixtureTests(AzureServiceBusFixture fixture)
{
    [Fact]
    public async Task Both_provider_endpoints_are_the_loopback_container_this_run_started()
    {
        var messaging = AzureServiceBusFixture.EndpointOf(fixture.CreateMessagingConfig().ConnectionString);
        var management = AzureServiceBusFixture.EndpointOf(fixture.CreateManagementConfig().ConnectionString);
        var addresses = (await Dns.GetHostAddressesAsync(messaging.Host))
            .Concat(await Dns.GetHostAddressesAsync(management.Host))
            .ToList();

        Assert.NotEmpty(addresses);
        Assert.All(addresses, address => Assert.True(IPAddress.IsLoopback(address), $"{address} is not a loopback address"));
        Assert.NotEqual(AzureServiceBusFixture.AmqpContainerPort, messaging.Port);
        Assert.NotEqual(AzureServiceBusFixture.ManagementContainerPort, management.Port);
        Assert.NotEqual(messaging.Port, management.Port);
    }
}
