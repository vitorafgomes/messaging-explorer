using ServiceBusExplorer.Core.Models;
using Xunit;

namespace ServiceBusExplorer.Core.Tests.Models;

/// <summary>
/// Unit tests for <see cref="SessionInfo"/>.
/// Tests cover default values, property assignment, and nullable state handling.
/// </summary>
public class SessionInfoTests
{
    [Fact]
    public void SessionInfo_DefaultValues_AreCorrect()
    {
        // Arrange & Act
        var session = new SessionInfo();

        // Assert
        Assert.Equal(string.Empty, session.SessionId);
        Assert.Null(session.State);
        Assert.Null(session.LockedUntil);
    }

    [Fact]
    public void SessionInfo_SetProperties_RetainsValues()
    {
        // Arrange
        var lockedUntil = DateTimeOffset.UtcNow.AddMinutes(5);

        // Act
        var session = new SessionInfo
        {
            SessionId = "session-123",
            State = "{\"key\": \"value\"}",
            LockedUntil = lockedUntil
        };

        // Assert
        Assert.Equal("session-123", session.SessionId);
        Assert.Equal("{\"key\": \"value\"}", session.State);
        Assert.Equal(lockedUntil, session.LockedUntil);
    }

    [Fact]
    public void SessionInfo_NullState_IsValid()
    {
        // Arrange & Act
        var session = new SessionInfo { SessionId = "test", State = null };

        // Assert
        Assert.Null(session.State);
    }
}
