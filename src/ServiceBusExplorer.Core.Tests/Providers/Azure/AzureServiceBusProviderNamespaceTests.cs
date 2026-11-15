using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Moq;
using ServiceBusExplorer.Core.Providers.Azure;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The namespace properties read: one administration call with the caller's token, the tier, messaging units, alias and
/// times as the broker gave them, the tier's largest message, a failure that reaches the caller instead of a made-up
/// value, and RabbitMQ refusing the read.
/// </summary>
public class AzureServiceBusProviderNamespaceTests
{
    private static readonly DateTimeOffset Created = new(2024, 3, 1, 9, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Modified = new(2026, 11, 2, 17, 5, 0, TimeSpan.Zero);

    private static Mock<ServiceBusAdministrationClient> Admin(CancellationToken token, MessagingSku sku, int units, string alias)
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetNamespacePropertiesAsync(token)).Returns(Task.FromResult(Response.FromValue(
            ServiceBusModelFactory.NamespaceProperties("contoso-test", Created, Modified, sku, units, alias), Mock.Of<Response>())));
        return admin;
    }

    [Fact]
    public async Task A_Standard_namespace_reads_its_name_tier_times_and_alias_with_the_callers_token_and_a_256_KB_limit()
    {
        using var cts = new CancellationTokenSource();
        var admin = Admin(cts.Token, MessagingSku.Standard, 0, "contoso-alias");

        var properties = await AzureServiceBusProvider.GetNamespacePropertiesCoreAsync(admin.Object, cts.Token);

        Assert.Equal(("contoso-test", "Standard", (int?)null, "contoso-alias", Created, Modified),
            (properties.Name, properties.Tier, properties.MessagingUnits, properties.Alias, properties.CreatedTime, properties.ModifiedTime));
        Assert.True(properties.MaxMessageSizeInBytes == 256 * 1024,
            $"A Standard namespace accepts at most 256 KB; it read {properties.MaxMessageSizeInBytes} bytes");
    }

    [Fact]
    public async Task A_Basic_namespace_has_the_256_KB_limit()
    {
        var admin = Admin(CancellationToken.None, MessagingSku.Basic, 0, "");

        var properties = await AzureServiceBusProvider.GetNamespacePropertiesCoreAsync(admin.Object, CancellationToken.None);

        Assert.Equal(("Basic", 256L * 1024), (properties.Tier, properties.MaxMessageSizeInBytes));
    }

    [Fact]
    public async Task A_Premium_namespace_carries_its_messaging_units_and_the_100_MB_an_entity_can_be_set_to()
    {
        var admin = Admin(CancellationToken.None, MessagingSku.Premium, 4, "");

        var properties = await AzureServiceBusProvider.GetNamespacePropertiesCoreAsync(admin.Object, CancellationToken.None);

        Assert.Equal(("Premium", (int?)4), (properties.Tier, properties.MessagingUnits));
        Assert.True(properties.MaxMessageSizeInBytes == 100L * 1024 * 1024,
            $"A Premium namespace is not held to 256 KB: an entity can be set up to 100 MB; it read {properties.MaxMessageSizeInBytes} bytes");
    }

    [Fact]
    public async Task A_namespace_without_a_geo_disaster_recovery_alias_has_a_null_alias_not_an_empty_one()
    {
        var admin = Admin(CancellationToken.None, MessagingSku.Standard, 0, "");

        var properties = await AzureServiceBusProvider.GetNamespacePropertiesCoreAsync(admin.Object, CancellationToken.None);

        Assert.Null(properties.Alias);
    }

    [Fact]
    public async Task A_failing_read_reaches_the_caller_as_the_broker_exception_instead_of_a_made_up_namespace()
    {
        var admin = new Mock<ServiceBusAdministrationClient>(MockBehavior.Strict);
        admin.Setup(a => a.GetNamespacePropertiesAsync(It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<NamespaceProperties>>(new UnauthorizedAccessException("Manage claim required")));

        var error = await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => AzureServiceBusProvider.GetNamespacePropertiesCoreAsync(admin.Object, CancellationToken.None));

        Assert.Equal("Manage claim required", error.Message);
    }

    [Fact]
    public async Task RabbitMQ_declares_no_namespace_properties_and_refuses_the_read()
    {
        var provider = new RabbitMQProvider();

        Assert.False(provider.Capabilities.SupportsNamespaceProperties, "RabbitMQ declares that it has no namespace properties");
        var error = await Assert.ThrowsAsync<NotSupportedException>(() => provider.GetNamespacePropertiesAsync(CancellationToken.None));
        Assert.Equal("RabbitMQ has no namespace properties.", error.Message);
    }
}
