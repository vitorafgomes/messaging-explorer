using Azure.Identity;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

public class AzureCredentialFactoryTests
{
    [Fact]
    public void Create_ServicePrincipal_returns_ClientSecretCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "sp",
            AuthType = AzureAuthType.ServicePrincipal,
            FullyQualifiedNamespace = "fake.servicebus.windows.net",
            TenantId = "11111111-1111-1111-1111-111111111111",
            ServicePrincipalClientId = "22222222-2222-2222-2222-222222222222",
            ClientSecret = "secret"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<ClientSecretCredential>(credential);
    }

    [Fact]
    public void Create_AzureCli_returns_AzureCliCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "cli",
            AuthType = AzureAuthType.AzureCli,
            FullyQualifiedNamespace = "fake.servicebus.windows.net"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<AzureCliCredential>(credential);
    }

    [Fact]
    public void Create_DefaultCredential_returns_DefaultAzureCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "default",
            AuthType = AzureAuthType.DefaultCredential,
            FullyQualifiedNamespace = "fake.servicebus.windows.net"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<DefaultAzureCredential>(credential);
    }

    [Fact]
    public void Create_InteractiveBrowser_returns_InteractiveBrowserCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "ib",
            AuthType = AzureAuthType.InteractiveBrowser,
            FullyQualifiedNamespace = "fake.servicebus.windows.net"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<InteractiveBrowserCredential>(credential);
    }

    [Fact]
    public void Create_InteractiveBrowser_with_TenantId_returns_InteractiveBrowserCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "ib-tenant",
            AuthType = AzureAuthType.InteractiveBrowser,
            FullyQualifiedNamespace = "fake.servicebus.windows.net",
            TenantId = "11111111-1111-1111-1111-111111111111"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<InteractiveBrowserCredential>(credential);
    }

    [Fact]
    public void IsValid_InteractiveBrowser_with_FQNS_returns_true()
    {
        var config = new AzureConnectionConfig
        {
            Name = "ib",
            AuthType = AzureAuthType.InteractiveBrowser,
            FullyQualifiedNamespace = "fake.servicebus.windows.net"
        };

        Assert.True(config.IsValid());
    }

    [Fact]
    public void IsValid_InteractiveBrowser_without_FQNS_returns_false()
    {
        var config = new AzureConnectionConfig
        {
            Name = "ib",
            AuthType = AzureAuthType.InteractiveBrowser,
            FullyQualifiedNamespace = string.Empty
        };

        Assert.False(config.IsValid());
    }

    [Fact]
    public void Create_ConnectionString_throws_InvalidOperationException()
    {
        var config = new AzureConnectionConfig
        {
            Name = "cs",
            AuthType = AzureAuthType.ConnectionString,
            ConnectionString = "Endpoint=sb://x.servicebus.windows.net/;SharedAccessKeyName=k;SharedAccessKey=v"
        };

        Assert.Throws<InvalidOperationException>(() => AzureCredentialFactory.Create(config));
    }
}
