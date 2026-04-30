using ServiceBusExplorer.Core.Providers.RabbitMQ;
using Xunit;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// Unit tests for RabbitMQ session operations.
/// RabbitMQ does not support message sessions, so these tests verify
/// that the provider returns empty results or throws <see cref="NotSupportedException"/>.
/// </summary>
public class RabbitMQSessionTests
{
    [Fact]
    public async Task GetSessionsAsync_ReturnsEmpty()
    {
        // Arrange
        var provider = new RabbitMQProvider();

        // Act
        var sessions = await provider.GetSessionsAsync("test-queue");

        // Assert
        Assert.Empty(sessions);
    }

    [Fact]
    public async Task GetSessionsAsync_WithSubscription_ReturnsEmpty()
    {
        // Arrange
        var provider = new RabbitMQProvider();

        // Act
        var sessions = await provider.GetSessionsAsync("test-topic", "test-sub");

        // Assert
        Assert.Empty(sessions);
    }

    [Fact]
    public async Task SetSessionStateAsync_ThrowsNotSupportedException()
    {
        // Arrange
        var provider = new RabbitMQProvider();

        // Act & Assert
        await Assert.ThrowsAsync<NotSupportedException>(
            () => provider.SetSessionStateAsync("entity", "session-1", "state"));
    }
}
