using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Services;

public interface IConnectionManager
{
    Task<IEnumerable<ServiceBusConnection>> GetConnectionsAsync();

    /// <summary>
    /// Returns a connection with sensitive fields masked (ConnectionString, Password).
    /// </summary>
    Task<ServiceBusConnection?> GetConnectionAsync(string id);

    /// <summary>
    /// Returns a connection with raw secret values. Server-side callers that must
    /// actually open a connection or send messages should use this overload.
    /// </summary>
    Task<ServiceBusConnection?> GetConnectionWithSecretAsync(string id);

    Task<ServiceBusConnection> SaveConnectionAsync(ServiceBusConnection connection);
    Task DeleteConnectionAsync(string id);

    /// <summary>
    /// Exports the full set of connections as JSON. When includeSecrets is false,
    /// sensitive fields are masked.
    /// </summary>
    Task<string> ExportConfigurationAsync(bool includeSecrets = false);

    Task ImportConfigurationAsync(string jsonData);
}
