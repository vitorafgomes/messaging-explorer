using System.Net;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Pins that the only broker a test reaches is the container this run started.
/// </summary>
[Collection(RabbitMqCollection.Name)]
public sealed class RabbitMqFixtureTests(RabbitMqFixture fixture)
{
    [Fact]
    public async Task The_provider_connects_only_to_the_loopback_container_this_run_started()
    {
        var config = fixture.CreateConfig();
        var addresses = await Dns.GetHostAddressesAsync(config.HostName);

        await using var provider = await fixture.ConnectAsync();

        Assert.NotEmpty(addresses);
        Assert.All(addresses, address => Assert.True(IPAddress.IsLoopback(address), $"{address} is not a loopback address"));
        Assert.Equal($"{fixture.Host}:{fixture.AmqpPort}/", provider.CurrentTarget);
        Assert.NotEqual(5672, config.Port);
        Assert.NotEqual(15672, config.ManagementPort);
    }
}
