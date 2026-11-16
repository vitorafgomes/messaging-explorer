using ServiceBusExplorer.Core.Providers.Azure;
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

    [Theory]
    [InlineData("Endpoint=sb://localhost:5673;SharedAccessKeyName=K;SharedAccessKey=S;UseDevelopmentEmulator=true;", false)]
    [InlineData("Endpoint=sb://localhost;SharedAccessKeyName=K;SharedAccessKey=S; usedevelopmentemulator = TRUE", false)]
    [InlineData("Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=S", true)]
    [InlineData("Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=S;UseDevelopmentEmulator=false", true)]
    [InlineData("", true)]
    [InlineData(null, true)]
    public void A_connection_to_the_emulator_declares_no_message_counts_and_no_transfer_dead_letter_queue_and_a_namespace_declares_both(string? connectionString, bool expected)
    {
        var capabilities = AzureProviderCapabilities.For(new AzureConnectionConfig { ConnectionString = connectionString! });

        Assert.Equal((expected, expected), (capabilities.SupportsMessageCounts, capabilities.SupportsTransferDeadLetter));
        Assert.True(capabilities.SupportsDeadLetterQueue);
    }

    [Fact]
    public void With_no_connection_Azure_Service_Bus_declares_what_a_namespace_does_and_RabbitMQ_declares_message_counts()
    {
        var azure = AzureProviderCapabilities.For(null);

        Assert.Same(AzureProviderCapabilities.Instance, azure);
        Assert.True(azure.SupportsMessageCounts);
        Assert.True(azure.SupportsTransferDeadLetter);
        Assert.True(RabbitMQProviderCapabilities.Instance.SupportsMessageCounts);
    }

    [Fact]
    public void RabbitMQ_declares_that_it_cannot_search_messages_and_Azure_Service_Bus_that_it_can()
    {
        Assert.False(RabbitMQProviderCapabilities.Instance.SupportsMessageSearch);
        Assert.True(new AzureProviderCapabilities().SupportsMessageSearch);
    }

    [Fact]
    public void RabbitMQ_and_Azure_Service_Bus_both_declare_bulk_message_operations_and_only_RabbitMQ_names_a_message_by_position()
    {
        Assert.True(RabbitMQProviderCapabilities.Instance.SupportsBulkMessageOperations);
        Assert.False(RabbitMQProviderCapabilities.Instance.SupportsSequenceNumbers);
        Assert.True(new AzureProviderCapabilities().SupportsSequenceNumbers);
        Assert.True(new AzureProviderCapabilities().SupportsBulkMessageOperations);
    }
}
