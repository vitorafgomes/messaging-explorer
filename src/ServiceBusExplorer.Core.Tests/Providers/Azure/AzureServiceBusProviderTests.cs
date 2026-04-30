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
}
