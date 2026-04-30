using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// Azure Service Bus-specific connection configuration.
/// Supports both connection-string and Azure AD (TokenCredential) authentication flows.
/// </summary>
public class AzureConnectionConfig : IConnectionConfig
{
    private const string ServiceBusDnsSuffix = ".servicebus.windows.net";

    /// <inheritdoc />
    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <inheritdoc />
    public string Name { get; set; } = string.Empty;

    /// <inheritdoc />
    public ProviderType ProviderType => ProviderType.AzureServiceBus;

    /// <inheritdoc />
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <inheritdoc />
    public DateTime? LastUsedAt { get; set; }

    /// <inheritdoc />
    public string? ClientId { get; set; }

    /// <inheritdoc />
    public string? EnvironmentId { get; set; }

    /// <summary>
    /// Selected authentication mechanism. Defaults to ConnectionString for backward compatibility.
    /// </summary>
    public AzureAuthType AuthType { get; set; } = AzureAuthType.ConnectionString;

    /// <summary>
    /// The Azure Service Bus connection string. Required when <see cref="AuthType"/> is ConnectionString.
    /// </summary>
    public string ConnectionString { get; set; } = string.Empty;

    /// <summary>
    /// The Azure Service Bus namespace.
    /// Typically extracted from the connection string but may be set explicitly.
    /// </summary>
    public string? Namespace { get; set; }

    /// <summary>
    /// Fully qualified namespace (e.g. "my-ns.servicebus.windows.net").
    /// Required for all non-ConnectionString auth flows.
    /// </summary>
    public string? FullyQualifiedNamespace { get; set; }

    /// <summary>
    /// Azure AD tenant id. Required for ServicePrincipal auth.
    /// </summary>
    public string? TenantId { get; set; }

    /// <summary>
    /// Azure AD application (service principal) client id.
    /// Kept distinct from <see cref="ClientId"/> (AMQP client identifier) to avoid semantic overlap.
    /// </summary>
    public string? ServicePrincipalClientId { get; set; }

    /// <summary>
    /// Azure AD application client secret. Required for ServicePrincipal auth.
    /// </summary>
    public string? ClientSecret { get; set; }

    /// <inheritdoc />
    public bool IsValid()
    {
        if (string.IsNullOrWhiteSpace(Name))
        {
            return false;
        }

        switch (AuthType)
        {
            case AzureAuthType.ConnectionString:
                if (string.IsNullOrWhiteSpace(ConnectionString))
                {
                    return false;
                }
                if (!ConnectionString.Contains("Endpoint=", StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
                return true;

            case AzureAuthType.ServicePrincipal:
                return !string.IsNullOrWhiteSpace(FullyQualifiedNamespace)
                    && !string.IsNullOrWhiteSpace(TenantId)
                    && !string.IsNullOrWhiteSpace(ServicePrincipalClientId)
                    && !string.IsNullOrWhiteSpace(ClientSecret);

            case AzureAuthType.AzureCli:
            case AzureAuthType.DefaultCredential:
                return !string.IsNullOrWhiteSpace(FullyQualifiedNamespace);

            case AzureAuthType.InteractiveBrowser:
                // TenantId is optional (null = common authority); only FQNS is required.
                return !string.IsNullOrWhiteSpace(FullyQualifiedNamespace);

            default:
                return false;
        }
    }

    /// <inheritdoc />
    public string GetDisplayTarget()
    {
        if (AuthType != AzureAuthType.ConnectionString && !string.IsNullOrWhiteSpace(FullyQualifiedNamespace))
        {
            return StripServiceBusSuffix(FullyQualifiedNamespace);
        }

        if (!string.IsNullOrWhiteSpace(Namespace))
        {
            return Namespace;
        }

        return TryExtractNamespaceFromConnectionString() ?? "Azure Service Bus";
    }

    private static string StripServiceBusSuffix(string fqn)
    {
        if (fqn.EndsWith(ServiceBusDnsSuffix, StringComparison.OrdinalIgnoreCase))
        {
            return fqn.Substring(0, fqn.Length - ServiceBusDnsSuffix.Length);
        }
        return fqn;
    }

    /// <summary>
    /// Attempts to extract the namespace from the connection string.
    /// Azure Service Bus connection strings have the format:
    /// Endpoint=sb://{namespace}.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...
    /// </summary>
    private string? TryExtractNamespaceFromConnectionString()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString))
        {
            return null;
        }

        try
        {
            const string endpointPrefix = "Endpoint=sb://";
            var startIndex = ConnectionString.IndexOf(endpointPrefix, StringComparison.OrdinalIgnoreCase);

            if (startIndex < 0)
            {
                return null;
            }

            startIndex += endpointPrefix.Length;
            var endIndex = ConnectionString.IndexOf('.', startIndex);

            if (endIndex < 0)
            {
                return null;
            }

            return ConnectionString.Substring(startIndex, endIndex - startIndex);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Creates an AzureConnectionConfig from an existing ServiceBusConnection model.
    /// </summary>
    public static AzureConnectionConfig FromServiceBusConnection(Models.ServiceBusConnection connection)
    {
        return new AzureConnectionConfig
        {
            Id = connection.Id,
            Name = connection.Name,
            ConnectionString = connection.ConnectionString,
            Namespace = connection.Namespace,
            CreatedAt = connection.CreatedAt,
            LastUsedAt = connection.LastUsedAt,
            ClientId = connection.ClientId,
            EnvironmentId = connection.EnvironmentId,
            AuthType = connection.AuthType ?? AzureAuthType.ConnectionString,
            FullyQualifiedNamespace = connection.FullyQualifiedNamespace,
            TenantId = connection.TenantId,
            ServicePrincipalClientId = connection.ServicePrincipalClientId,
            ClientSecret = connection.ClientSecret
        };
    }

    /// <summary>
    /// Converts this configuration to a ServiceBusConnection model.
    /// </summary>
    public Models.ServiceBusConnection ToServiceBusConnection()
    {
        return new Models.ServiceBusConnection
        {
            Id = Id,
            Name = Name,
            ConnectionString = ConnectionString,
            Namespace = Namespace ?? TryExtractNamespaceFromConnectionString(),
            CreatedAt = CreatedAt,
            LastUsedAt = LastUsedAt,
            ClientId = ClientId,
            EnvironmentId = EnvironmentId,
            AuthType = AuthType,
            FullyQualifiedNamespace = FullyQualifiedNamespace,
            TenantId = TenantId,
            ServicePrincipalClientId = ServicePrincipalClientId,
            ClientSecret = ClientSecret
        };
    }
}
