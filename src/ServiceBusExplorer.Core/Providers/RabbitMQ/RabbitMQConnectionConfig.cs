using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Providers.RabbitMQ;

/// <summary>
/// RabbitMQ-specific connection configuration.
/// Contains the host, port, credentials, and virtual host information required to connect to RabbitMQ.
/// </summary>
public class RabbitMQConnectionConfig : IConnectionConfig
{
    /// <summary>
    /// Default AMQP port for RabbitMQ.
    /// </summary>
    public const int DefaultPort = 5672;

    /// <summary>
    /// Default Management API port for RabbitMQ.
    /// </summary>
    public const int DefaultManagementPort = 15672;

    /// <summary>
    /// Default virtual host for RabbitMQ.
    /// </summary>
    public const string DefaultVirtualHost = "/";

    /// <summary>
    /// Default username for RabbitMQ (guest user).
    /// </summary>
    public const string DefaultUserName = "guest";

    /// <summary>
    /// Default password for RabbitMQ (guest user).
    /// </summary>
    public const string DefaultPassword = "guest";

    /// <inheritdoc />
    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <inheritdoc />
    public string Name { get; set; } = string.Empty;

    /// <inheritdoc />
    public ProviderType ProviderType => ProviderType.RabbitMQ;

    /// <inheritdoc />
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <inheritdoc />
    public DateTime? LastUsedAt { get; set; }

    /// <inheritdoc />
    public string? ClientId { get; set; }

    /// <inheritdoc />
    public string? EnvironmentId { get; set; }

    /// <summary>
    /// The RabbitMQ server hostname or IP address.
    /// </summary>
    public string HostName { get; set; } = "localhost";

    /// <summary>
    /// The RabbitMQ AMQP port number.
    /// Default is 5672.
    /// </summary>
    public int Port { get; set; } = DefaultPort;

    /// <summary>
    /// The username for authentication.
    /// Default is "guest" for local development.
    /// </summary>
    public string UserName { get; set; } = DefaultUserName;

    /// <summary>
    /// The password for authentication.
    /// Default is "guest" for local development.
    /// </summary>
    public string Password { get; set; } = DefaultPassword;

    /// <summary>
    /// The RabbitMQ virtual host.
    /// Default is "/" (the default virtual host).
    /// </summary>
    public string VirtualHost { get; set; } = DefaultVirtualHost;

    /// <summary>
    /// The RabbitMQ Management API port number.
    /// Default is 15672. Used for administrative operations like listing queues and exchanges.
    /// </summary>
    public int ManagementPort { get; set; } = DefaultManagementPort;

    /// <summary>
    /// Whether to use SSL/TLS for the AMQP connection.
    /// Default is false for local development.
    /// </summary>
    public bool UseSsl { get; set; } = false;

    /// <summary>
    /// Whether to use SSL/TLS for the Management API connection.
    /// Default is false for local development.
    /// </summary>
    public bool UseManagementSsl { get; set; } = false;

    /// <inheritdoc />
    public bool IsValid()
    {
        // HostName is required
        if (string.IsNullOrWhiteSpace(HostName))
        {
            return false;
        }

        // Name is required for user identification
        if (string.IsNullOrWhiteSpace(Name))
        {
            return false;
        }

        // Port must be valid
        if (Port <= 0 || Port > 65535)
        {
            return false;
        }

        // Management port must be valid
        if (ManagementPort <= 0 || ManagementPort > 65535)
        {
            return false;
        }

        // UserName is required (even if empty string is technically allowed by RabbitMQ)
        if (string.IsNullOrWhiteSpace(UserName))
        {
            return false;
        }

        // Password can be empty but not null
        if (Password == null)
        {
            return false;
        }

        // VirtualHost is required
        if (string.IsNullOrWhiteSpace(VirtualHost))
        {
            return false;
        }

        return true;
    }

    /// <inheritdoc />
    public string GetDisplayTarget()
    {
        var protocol = UseSsl ? "amqps" : "amqp";
        var portDisplay = Port == DefaultPort ? "" : $":{Port}";
        var vhostDisplay = VirtualHost == DefaultVirtualHost ? "" : $" ({VirtualHost})";

        return $"{protocol}://{HostName}{portDisplay}{vhostDisplay}";
    }

    /// <summary>
    /// Gets the full URL for the RabbitMQ Management API.
    /// </summary>
    /// <returns>The Management API base URL.</returns>
    public string GetManagementApiUrl()
    {
        var protocol = UseManagementSsl ? "https" : "http";
        return $"{protocol}://{HostName}:{ManagementPort}/api";
    }

    /// <summary>
    /// Creates a RabbitMQConnectionConfig from an existing ServiceBusConnection model.
    /// This enables backward compatibility with existing saved connections.
    /// </summary>
    /// <param name="connection">The existing ServiceBusConnection to convert.</param>
    /// <returns>A new RabbitMQConnectionConfig with the same configuration.</returns>
    public static RabbitMQConnectionConfig FromServiceBusConnection(ServiceBusConnection connection)
    {
        return new RabbitMQConnectionConfig
        {
            Id = connection.Id,
            Name = connection.Name,
            HostName = connection.HostName ?? "localhost",
            Port = connection.Port ?? DefaultPort,
            UserName = connection.UserName ?? DefaultUserName,
            Password = connection.Password ?? DefaultPassword,
            VirtualHost = connection.VirtualHost ?? DefaultVirtualHost,
            ManagementPort = connection.ManagementPort ?? DefaultManagementPort,
            CreatedAt = connection.CreatedAt,
            LastUsedAt = connection.LastUsedAt,
            ClientId = connection.ClientId,
            EnvironmentId = connection.EnvironmentId
        };
    }

    /// <summary>
    /// Converts this configuration to a ServiceBusConnection model.
    /// This enables backward compatibility with existing code that uses ServiceBusConnection.
    /// </summary>
    /// <returns>A ServiceBusConnection with the same configuration.</returns>
    public ServiceBusConnection ToServiceBusConnection()
    {
        return new ServiceBusConnection
        {
            Id = Id,
            Name = Name,
            ProviderType = ProviderType.RabbitMQ,
            HostName = HostName,
            Port = Port,
            UserName = UserName,
            Password = Password,
            VirtualHost = VirtualHost,
            ManagementPort = ManagementPort,
            CreatedAt = CreatedAt,
            LastUsedAt = LastUsedAt,
            ClientId = ClientId,
            EnvironmentId = EnvironmentId
        };
    }
}
