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

    /// <summary>
    /// Saves a connection. On update only the editable fields are copied: the stored
    /// <see cref="ServiceBusConnection.LastUsedAt"/> and <see cref="ServiceBusConnection.CreatedAt"/> are kept. A proxy
    /// address <see cref="ServiceBusConnection.HasAllowedProxy"/> refuses throws <see cref="ArgumentException"/> with
    /// <see cref="ServiceBusConnection.ProxyRefusal"/>, and nothing is stored.
    /// </summary>
    Task<ServiceBusConnection> SaveConnectionAsync(ServiceBusConnection connection);

    /// <summary>
    /// Sets <see cref="ServiceBusConnection.LastUsedAt"/> of a stored connection to now. An unknown id is ignored.
    /// </summary>
    Task MarkUsedAsync(string id);

    Task DeleteConnectionAsync(string id);

    /// <summary>
    /// Exports the full set of connections as JSON. When includeSecrets is false,
    /// sensitive fields are masked.
    /// </summary>
    Task<string> ExportConfigurationAsync(bool includeSecrets = false);

    Task ImportConfigurationAsync(string jsonData);

    /// <summary>
    /// Replaces the stored workspace with an empty one and returns how many connections and groups it held.
    /// An unreadable workspace file is cleared too and reports zero for both.
    /// </summary>
    Task<(int Connections, int Groups)> ClearAllAsync();
}
