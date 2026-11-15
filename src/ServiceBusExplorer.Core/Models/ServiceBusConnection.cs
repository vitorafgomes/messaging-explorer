using System.Text.RegularExpressions;
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
    /// RabbitMQ: use TLS (amqps) for the AMQP connection.
    /// </summary>
    public bool UseSsl { get; set; }

    /// <summary>
    /// RabbitMQ: use TLS (https) for the Management API.
    /// </summary>
    public bool UseManagementSsl { get; set; }

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

    /// <summary>
    /// Azure: AMQP over WebSockets on port 443 instead of AMQP on port 5671. False keeps the AMQP transport.
    /// </summary>
    public bool UseWebSockets { get; set; }

    /// <summary>
    /// Azure: the address of an HTTP proxy, as http://host:port. Only with <see cref="UseWebSockets"/>; never carries a
    /// user name or password: the proxy is reached with the default credentials of this computer.
    /// </summary>
    public string? ProxyAddress { get; set; }

    /// <summary>
    /// The fixed text a save or an import answers when <see cref="HasAllowedProxy"/> is false. It never carries the address.
    /// </summary>
    public const string ProxyRefusal =
        "A proxy address must be http or https, without a user name or password, on an Azure Service Bus connection that uses WebSockets.";

    /// <summary>
    /// Whether <see cref="ProxyAddress"/> may be stored: on Azure Service Bus what <see cref="AzureConnectionConfig.IsProxyAllowed"/>
    /// allows; on any other provider, which has no proxy, none at all.
    /// </summary>
    public bool HasAllowedProxy() => ProviderType == ProviderType.AzureServiceBus
        ? AzureConnectionConfig.IsProxyAllowed(ProxyAddress, UseWebSockets)
        : string.IsNullOrEmpty(ProxyAddress);

    /// <summary>
    /// Azure: the Azure resource ID of the namespace, as
    /// /subscriptions/{subscription id}/resourceGroups/{resource group}/providers/Microsoft.ServiceBus/namespaces/{namespace}.
    /// Optional and not a secret; Azure Monitor metrics are read for it.
    /// </summary>
    public string? AzureResourceId { get; set; }

    /// <summary>
    /// The fixed text a save or an import answers when <see cref="HasAllowedResourceId"/> is false. It never carries the value.
    /// </summary>
    public const string ResourceIdRefusal =
        "An Azure resource ID must read /subscriptions/{subscription id}/resourceGroups/{resource group}/providers/Microsoft.ServiceBus/namespaces/{namespace}, on an Azure Service Bus connection.";

    private static readonly Regex ResourceIdFormat = new(
        "^/subscriptions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/resourceGroups/[-\\w.()]{1,90}/providers/Microsoft\\.ServiceBus/namespaces/[a-z0-9-]{1,50}\\z",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

    /// <summary>
    /// Whether <see cref="AzureResourceId"/> may be stored: empty on any provider; otherwise only on Azure Service Bus and
    /// only in the format of a namespace's resource ID.
    /// </summary>
    public bool HasAllowedResourceId() => string.IsNullOrEmpty(AzureResourceId)
        || (ProviderType == ProviderType.AzureServiceBus && IsResourceIdFormat(AzureResourceId));

    /// <summary>Whether <paramref name="resourceId"/> has the format of a Service Bus namespace's Azure resource ID.</summary>
    public static bool IsResourceIdFormat(string? resourceId) => resourceId is not null && ResourceIdFormat.IsMatch(resourceId);
}
