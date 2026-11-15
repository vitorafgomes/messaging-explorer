using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

public class AzureConnectionConfigTests
{
    [Theory]
    [InlineData("Endpoint=sb://contoso-test.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=KeySentinel", "contoso-test")]
    [InlineData("Endpoint=sb://localhost;SharedAccessKeyName=K;SharedAccessKey=KeySentinel;EntityPath=a.b", "localhost")]
    [InlineData("Endpoint=sb://localhost:5672;SharedAccessKeyName=K;SharedAccessKey=Key.Sentinel;UseDevelopmentEmulator=true;", "localhost")]
    [InlineData("Endpoint=sb://emulator/;SharedAccessKeyName=K;SharedAccessKey=Key.Sentinel", "emulator")]
    public void The_display_target_of_a_connection_string_is_its_host_alone_and_never_reaches_the_key(string connectionString, string expected)
    {
        var config = new AzureConnectionConfig { Name = "c", AuthType = AzureAuthType.ConnectionString, ConnectionString = connectionString };

        var target = config.GetDisplayTarget();

        Assert.Equal(expected, target);
        Assert.DoesNotContain("Sentinel", target);
        Assert.DoesNotContain("SharedAccessKey", target);
    }

    private static AzureConnectionConfig WithProxy(string? proxyAddress, bool useWebSockets) => new()
    {
        Name = "c",
        ConnectionString = "Endpoint=sb://contoso-test.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=KeySentinel",
        UseWebSockets = useWebSockets,
        ProxyAddress = proxyAddress,
    };

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("http://proxy.example:8080")]
    [InlineData("https://proxy.example")]
    public void A_connection_over_WebSockets_with_no_proxy_or_a_plain_http_proxy_address_is_valid(string? proxyAddress)
    {
        Assert.True(WithProxy(proxyAddress, useWebSockets: true).IsValid(),
            $"WebSockets with the proxy '{proxyAddress}' is a valid connection");
    }

    [Theory]
    [InlineData("http://user:pass@proxy.example:8080")]
    [InlineData("http://user@proxy.example:8080")]
    [InlineData("https://:pass@proxy.example")]
    public void A_proxy_address_with_a_user_name_or_password_is_refused(string proxyAddress)
    {
        Assert.False(AzureConnectionConfig.IsProxyAllowed(proxyAddress, useWebSockets: true),
            "A proxy address that carries user info is refused: no proxy credential is ever stored");
        Assert.False(WithProxy(proxyAddress, useWebSockets: true).IsValid(),
            "A connection whose proxy address carries user info is not valid, so it is never tested, connected or saved");
    }

    [Theory]
    [InlineData("proxy.example:8080")]
    [InlineData("socks5://proxy.example:1080")]
    [InlineData("not an address")]
    public void A_proxy_address_that_is_not_an_absolute_http_or_https_address_is_refused(string proxyAddress)
    {
        Assert.False(WithProxy(proxyAddress, useWebSockets: true).IsValid(),
            $"'{proxyAddress}' is not an http or https proxy address");
    }

    [Fact]
    public void A_proxy_without_WebSockets_is_refused_because_AMQP_over_TCP_does_not_go_through_an_HTTP_proxy()
    {
        Assert.False(WithProxy("http://proxy.example:8080", useWebSockets: false).IsValid(),
            "A proxy on the AMQP transport is refused, never silently ignored");
        Assert.True(WithProxy(null, useWebSockets: false).IsValid(), "AMQP with no proxy stays valid");
    }

    [Fact]
    public void The_transport_and_the_proxy_survive_the_round_trip_through_the_stored_connection()
    {
        var config = WithProxy("http://proxy.example:8080", useWebSockets: true);

        var back = AzureConnectionConfig.FromServiceBusConnection(config.ToServiceBusConnection());

        Assert.True(back.UseWebSockets, "UseWebSockets is carried to and from the stored connection");
        Assert.Equal("http://proxy.example:8080", back.ProxyAddress);
    }
}
