using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

public class RabbitMQProviderCapabilitiesTests
{
    [Fact]
    public void A_caller_cannot_change_the_exchange_types_of_the_shared_capabilities_through_a_cast()
    {
        var exposed = RabbitMQProviderCapabilities.Instance.SupportedExchangeTypes;
        var asList = Assert.IsAssignableFrom<IList<string>>(exposed);

        Assert.Throws<NotSupportedException>(() => asList[0] = "x-custom");

        Assert.Equal(["direct", "fanout", "topic", "headers"], RabbitMQProviderCapabilities.Instance.SupportedExchangeTypes);
    }
}
