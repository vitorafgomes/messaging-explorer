using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// RabbitMQ has no message sessions: it says so in its capabilities and refuses every session operation, never by
/// answering an empty list as if it had looked.
/// </summary>
public class RabbitMQSessionTests
{
    [Fact]
    public void RabbitMQ_declares_no_sessions()
    {
        Assert.False(new RabbitMQProvider().Capabilities.SupportsSessions);
    }

    [Fact]
    public async Task RabbitMQ_refuses_the_session_list_detail_messages_and_state_write()
    {
        var provider = new RabbitMQProvider();

        var errors = new[]
        {
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.GetSessionsAsync("orders", null, 1000)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.GetSessionsAsync("events", "audit", 1000)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.GetSessionAsync("orders", null, "order-1")),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.PeekSessionMessagesAsync("orders", null, "order-1", 10)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.SetSessionStateAsync("orders", null, "order-1", "s", null))
        };

        Assert.All(errors, e => Assert.Equal("RabbitMQ does not support message sessions.", e.Message));
    }
}
