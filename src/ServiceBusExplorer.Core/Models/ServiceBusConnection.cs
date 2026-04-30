using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// Represents a messaging service connection configuration.
/// This model is provider-agnostic and supports multiple messaging providers.
/// </summary>
public class ServiceBusConnection
{
    /// <summary>
    /// Unique identifier for this connection.
    /// </summary>
    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <summary>
    /// Display name for this connection.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The type of messaging provider for this connection.
    /// Defaults to AzureServiceBus for backward compatibility with existing saved connections.
    /// </summary>
    public ProviderType ProviderType { get; set; } = ProviderType.AzureServiceBus;

    /// <summary>
    /// Azure Service Bus connection string.
    /// Used when ProviderType is AzureServiceBus.
    /// </summary>
    public string ConnectionString { get; set; } = string.Empty;

    /// <summary>
    /// Azure Service Bus namespace name.
    /// Used when ProviderType is AzureServiceBus.
    /// </summary>
    public string? Namespace { get; set; }

    /// <summary>
    /// RabbitMQ host name.
    /// Used when ProviderType is RabbitMQ.
    /// </summary>
    public string? HostName { get; set; }

    /// <summary>
    /// RabbitMQ port number (default: 5672).
    /// Used when ProviderType is RabbitMQ.
    /// </summary>
    public int? Port { get; set; }

    /// <summary>
    /// RabbitMQ username.
    /// Used when ProviderType is RabbitMQ.
    /// </summary>
    public string? UserName { get; set; }

    /// <summary>
    /// RabbitMQ password.
    /// Used when ProviderType is RabbitMQ.
    /// </summary>
    public string? Password { get; set; }

    /// <summary>
    /// RabbitMQ virtual host (default: "/").
    /// Used when ProviderType is RabbitMQ.
    /// </summary>
    public string? VirtualHost { get; set; }

    /// <summary>
    /// RabbitMQ Management API port (default: 15672).
    /// Used for administrative operations like listing queues.
    /// </summary>
    public int? ManagementPort { get; set; }

    /// <summary>
    /// Timestamp when this connection was created.
    /// </summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Timestamp when this connection was last used.
    /// </summary>
    public DateTime? LastUsedAt { get; set; }

    /// <summary>
    /// Indicates whether a connection is currently active.
    /// </summary>
    public bool IsConnected { get; set; }

    /// <summary>
    /// Client identifier for tracking purposes.
    /// </summary>
    public string? ClientId { get; set; }

    /// <summary>
    /// Environment identifier for organizing connections.
    /// </summary>
    public string? EnvironmentId { get; set; }

    // ──────────────────────────────────────────────────────────────
    // Azure AD / TokenCredential auth fields (Phase 1).
    // All nullable so legacy workspace.json files without these keys
    // deserialize cleanly; AuthType defaulting to ConnectionString is
    // applied by AzureConnectionConfig.FromServiceBusConnection.
    // ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Selected Azure authentication mechanism. Null for legacy records (treated as ConnectionString).
    /// </summary>
    public AzureAuthType? AuthType { get; set; }

    /// <summary>
    /// Fully qualified Service Bus namespace (e.g. "my-ns.servicebus.windows.net").
    /// Required for non-ConnectionString auth flows.
    /// </summary>
    public string? FullyQualifiedNamespace { get; set; }

    /// <summary>
    /// Azure AD tenant id. Required for ServicePrincipal auth.
    /// </summary>
    public string? TenantId { get; set; }

    /// <summary>
    /// Azure AD application (service principal) client id.
    /// Distinct from <see cref="ClientId"/>, which is the AMQP client identifier.
    /// </summary>
    public string? ServicePrincipalClientId { get; set; }

    /// <summary>
    /// Azure AD application client secret. Required for ServicePrincipal auth.
    /// </summary>
    public string? ClientSecret { get; set; }
}
