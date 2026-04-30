using ServiceBusExplorer.Core.Providers;

namespace ServiceBusExplorer.Core.Abstractions;

/// <summary>
/// Interface for provider-specific connection configuration.
/// Each messaging provider implements this interface with its own connection requirements.
/// </summary>
public interface IConnectionConfig
{
    /// <summary>
    /// Unique identifier for the connection.
    /// </summary>
    string Id { get; set; }

    /// <summary>
    /// User-friendly name for the connection.
    /// </summary>
    string Name { get; set; }

    /// <summary>
    /// The type of messaging provider this connection is for.
    /// </summary>
    ProviderType ProviderType { get; }

    /// <summary>
    /// When this connection configuration was created.
    /// </summary>
    DateTime CreatedAt { get; set; }

    /// <summary>
    /// When this connection was last used, if ever.
    /// </summary>
    DateTime? LastUsedAt { get; set; }

    /// <summary>
    /// Optional client identifier for tracking purposes.
    /// </summary>
    string? ClientId { get; set; }

    /// <summary>
    /// Optional environment identifier (e.g., dev, staging, prod).
    /// </summary>
    string? EnvironmentId { get; set; }

    /// <summary>
    /// Validates the connection configuration.
    /// </summary>
    /// <returns>True if the configuration is valid; otherwise, false.</returns>
    bool IsValid();

    /// <summary>
    /// Gets a display-friendly description of the connection target.
    /// For Azure Service Bus, this might be the namespace.
    /// For RabbitMQ, this might be the host:port.
    /// </summary>
    string GetDisplayTarget();
}
