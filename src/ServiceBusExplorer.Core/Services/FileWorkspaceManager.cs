using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Services;

/// <summary>
/// Unified workspace manager that stores both connections and groups in a single workspace.json file.
/// Implements both IConnectionManager and IConnectionGroupManager interfaces.
/// Auto-migrates from separate connections.json / connection-groups.json files on first load.
/// </summary>
public class FileWorkspaceManager : IConnectionManager, IConnectionGroupManager
{
    private readonly ILogger<FileWorkspaceManager> _logger;
    private readonly string _filePath;
    private readonly string _legacyConnectionsFilePath;
    private readonly string _legacyGroupsFilePath;
    private readonly string _oldConnectionsFilePath;
    private readonly string _oldGroupsFilePath;
    private readonly object _lock = new();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
        // Keep PascalCase in files (C# standard)
        // API will convert to camelCase for HTTP responses
    };

    public FileWorkspaceManager(string? basePath = null, ILogger<FileWorkspaceManager>? logger = null)
    {
        _logger = logger ?? NullLogger<FileWorkspaceManager>.Instance;

        // Use provided basePath or fallback to workspace directory
        var workspacePath = basePath ?? Path.Combine(Directory.GetCurrentDirectory(), ".servicebus");

        _logger.LogInformation(
            "FileWorkspaceManager constructor invoked. BasePathProvided={BasePathProvided}, WorkspacePath={WorkspacePath}",
            basePath != null, workspacePath);

        // Legacy paths for migration from AppData (only used when basePath is not provided)
        var legacyAppDataPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "ServiceBusExplorer");

        _legacyConnectionsFilePath = Path.Combine(legacyAppDataPath, "connections.json");
        _legacyGroupsFilePath = Path.Combine(legacyAppDataPath, "connection-groups.json");

        // Old separate file paths in the current workspace (for consolidation migration)
        _oldConnectionsFilePath = Path.Combine(workspacePath, "connections.json");
        _oldGroupsFilePath = Path.Combine(workspacePath, "connection-groups.json");

        // Create workspace directory if it doesn't exist
        Directory.CreateDirectory(workspacePath);
        _filePath = Path.Combine(workspacePath, "workspace.json");

        _logger.LogDebug("Workspace file path resolved to {FilePath}", _filePath);

        // Only migrate legacy data if using default path (not explicitly provided)
        if (basePath == null)
        {
            _logger.LogInformation("Attempting legacy data migration from AppData");
            MigrateLegacyData();
        }
        else
        {
            _logger.LogDebug("Skipping legacy AppData migration (explicit basePath provided)");
        }

        // Always attempt consolidation of separate files into workspace.json
        _logger.LogDebug("Attempting consolidation of separate files");
        MigrateFromSeparateFiles();
    }

    /// <summary>
    /// Migrates data from legacy AppData location to current workspace.
    /// Only runs when basePath is null (default path).
    /// Copies old separate files from AppData to workspace directory so consolidation can pick them up.
    /// </summary>
    private void MigrateLegacyData()
    {
        // If workspace file already exists, no need to migrate legacy data
        if (File.Exists(_filePath))
        {
            _logger.LogDebug("workspace.json already exists, skipping legacy migration");
            return;
        }

        // Copy legacy connections.json from AppData if it exists and local copy doesn't
        if (!File.Exists(_oldConnectionsFilePath) && File.Exists(_legacyConnectionsFilePath))
        {
            try
            {
                _logger.LogInformation(
                    "Migrating legacy connections file from {Source} to {Destination}",
                    _legacyConnectionsFilePath, _oldConnectionsFilePath);
                File.Copy(_legacyConnectionsFilePath, _oldConnectionsFilePath, overwrite: false);
                _logger.LogInformation("Legacy connections migration completed");
            }
            catch (Exception ex)
            {
                // Log exception without embedding raw message into template parameters.
                _logger.LogWarning(ex, "Legacy connections migration failed ({ExceptionType})", ex.GetType().Name);
            }
        }

        // Copy legacy connection-groups.json from AppData if it exists and local copy doesn't
        if (!File.Exists(_oldGroupsFilePath) && File.Exists(_legacyGroupsFilePath))
        {
            try
            {
                _logger.LogInformation(
                    "Migrating legacy groups file from {Source} to {Destination}",
                    _legacyGroupsFilePath, _oldGroupsFilePath);
                File.Copy(_legacyGroupsFilePath, _oldGroupsFilePath, overwrite: false);
                _logger.LogInformation("Legacy groups migration completed");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Legacy groups migration failed ({ExceptionType})", ex.GetType().Name);
            }
        }
    }

    /// <summary>
    /// Consolidates separate connections.json and connection-groups.json into a single workspace.json.
    /// Runs on every startup. If workspace.json already exists, this is a no-op.
    /// After successful consolidation, deletes the old separate files.
    /// </summary>
    private void MigrateFromSeparateFiles()
    {
        // If workspace.json already exists, nothing to consolidate
        if (File.Exists(_filePath))
        {
            _logger.LogDebug("workspace.json already exists, skipping consolidation");
            return;
        }

        var hasOldConnections = File.Exists(_oldConnectionsFilePath);
        var hasOldGroups = File.Exists(_oldGroupsFilePath);

        if (!hasOldConnections && !hasOldGroups)
        {
            _logger.LogDebug("No separate files found to consolidate");
            return;
        }

        _logger.LogInformation(
            "Found separate files to consolidate. HasConnections={HasConnections}, HasGroups={HasGroups}",
            hasOldConnections, hasOldGroups);

        var connections = new List<ServiceBusConnection>();
        var groups = new List<ConnectionGroup>();

        // Read existing connections.json
        if (hasOldConnections)
        {
            try
            {
                var json = File.ReadAllText(_oldConnectionsFilePath);
                connections = JsonSerializer.Deserialize<List<ServiceBusConnection>>(json, JsonOptions)
                    ?? new List<ServiceBusConnection>();
                _logger.LogInformation(
                    "Read {ConnectionCount} connections from legacy file",
                    connections.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error reading legacy connections.json ({ExceptionType})", ex.GetType().Name);
            }
        }

        // Read existing connection-groups.json
        if (hasOldGroups)
        {
            try
            {
                var json = File.ReadAllText(_oldGroupsFilePath);
                groups = JsonSerializer.Deserialize<List<ConnectionGroup>>(json, JsonOptions)
                    ?? new List<ConnectionGroup>();
                _logger.LogInformation(
                    "Read {GroupCount} groups from legacy file",
                    groups.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error reading legacy connection-groups.json ({ExceptionType})", ex.GetType().Name);
            }
        }

        // Write unified workspace.json
        try
        {
            var workspace = new WorkspaceData
            {
                Connections = connections,
                Groups = groups
            };

            var json = JsonSerializer.Serialize(workspace, JsonOptions);
            File.WriteAllText(_filePath, json);
            _logger.LogInformation(
                "Created workspace.json with {ConnectionCount} connections and {GroupCount} groups",
                connections.Count, groups.Count);

            // Delete old separate files after successful consolidation
            if (hasOldConnections)
            {
                File.Delete(_oldConnectionsFilePath);
                _logger.LogDebug("Deleted old connections file");
            }

            if (hasOldGroups)
            {
                File.Delete(_oldGroupsFilePath);
                _logger.LogDebug("Deleted old groups file");
            }

            _logger.LogInformation("Consolidation migration completed");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error writing workspace.json ({ExceptionType})", ex.GetType().Name);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Internal workspace load / save (single lock for atomic access)
    // ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Loads workspace data from disk. Must be called inside lock(_lock).
    /// </summary>
    private WorkspaceData LoadWorkspace()
    {
        if (File.Exists(_filePath))
        {
            try
            {
                var json = File.ReadAllText(_filePath);
                return JsonSerializer.Deserialize<WorkspaceData>(json, JsonOptions) ?? new WorkspaceData();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load workspace data ({ExceptionType})", ex.GetType().Name);
                return new WorkspaceData();
            }
        }

        return new WorkspaceData();
    }

    /// <summary>
    /// Saves workspace data to disk synchronously. Must be called inside lock(_lock).
    /// </summary>
    private void SaveWorkspace(WorkspaceData workspace)
    {
        var json = JsonSerializer.Serialize(workspace, JsonOptions);
        File.WriteAllText(_filePath, json);
    }

    // ────────────────────────────────────────────────────────────────
    // IConnectionManager implementation
    // ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Returns a shallow clone of the given connection with sensitive fields masked.
    /// Keeps non-sensitive metadata (provider type, host, port, user, etc.) intact
    /// so the UI can render and edit safely.
    /// </summary>
    private static ServiceBusConnection MaskConnection(ServiceBusConnection c)
    {
        return new ServiceBusConnection
        {
            Id = c.Id,
            Name = c.Name,
            ProviderType = c.ProviderType,
            ConnectionString = string.IsNullOrEmpty(c.ConnectionString) ? c.ConnectionString : "***",
            Namespace = c.Namespace,
            HostName = c.HostName,
            Port = c.Port,
            UserName = c.UserName,
            Password = string.IsNullOrEmpty(c.Password) ? c.Password : "***",
            VirtualHost = c.VirtualHost,
            ManagementPort = c.ManagementPort,
            CreatedAt = c.CreatedAt,
            LastUsedAt = c.LastUsedAt,
            IsConnected = c.IsConnected,
            ClientId = c.ClientId,
            EnvironmentId = c.EnvironmentId,
            AuthType = c.AuthType,
            FullyQualifiedNamespace = c.FullyQualifiedNamespace,
            TenantId = c.TenantId,
            ServicePrincipalClientId = c.ServicePrincipalClientId,
            ClientSecret = string.IsNullOrEmpty(c.ClientSecret) ? c.ClientSecret : "***"
        };
    }

    public Task<IEnumerable<ServiceBusConnection>> GetConnectionsAsync()
    {
        _logger.LogDebug("Loading connections");
        var workspace = LoadWorkspace();

        _logger.LogDebug(
            "Masking {ConnectionCount} connection strings for API response",
            workspace.Connections.Count);

        var maskedConnections = workspace.Connections.Select(MaskConnection);
        return Task.FromResult(maskedConnections);
    }

    public Task<ServiceBusConnection?> GetConnectionAsync(string id)
    {
        var workspace = LoadWorkspace();
        var connection = workspace.Connections.FirstOrDefault(c => c.Id == id);
        return Task.FromResult(connection == null ? null : MaskConnection(connection));
    }

    public Task<ServiceBusConnection?> GetConnectionWithSecretAsync(string id)
    {
        var workspace = LoadWorkspace();
        var connection = workspace.Connections.FirstOrDefault(c => c.Id == id);
        return Task.FromResult(connection);
    }

    public Task<ServiceBusConnection> SaveConnectionAsync(ServiceBusConnection connection)
    {
        lock (_lock)
        {
            var workspace = LoadWorkspace();
            var existing = workspace.Connections.FirstOrDefault(c => c.Id == connection.Id);

            if (existing != null)
            {
                existing.Name = connection.Name;
                // Preserve stored secret when the caller echoes back the masking sentinel.
                existing.ConnectionString = connection.ConnectionString == "***"
                    ? existing.ConnectionString
                    : connection.ConnectionString;
                existing.Namespace = connection.Namespace;
                existing.ClientId = connection.ClientId;
                existing.EnvironmentId = connection.EnvironmentId;

                // Azure AD auth fields.
                existing.AuthType = connection.AuthType;
                existing.FullyQualifiedNamespace = connection.FullyQualifiedNamespace;
                existing.TenantId = connection.TenantId;
                existing.ServicePrincipalClientId = connection.ServicePrincipalClientId;
                existing.ClientSecret = connection.ClientSecret == "***"
                    ? existing.ClientSecret
                    : connection.ClientSecret;
            }
            else
            {
                if (string.IsNullOrEmpty(connection.Id))
                {
                    connection.Id = Guid.NewGuid().ToString();
                }
                connection.CreatedAt = DateTime.UtcNow;
                workspace.Connections.Add(connection);
            }

            SaveWorkspace(workspace);
            return Task.FromResult(connection);
        }
    }

    public Task DeleteConnectionAsync(string id)
    {
        lock (_lock)
        {
            var workspace = LoadWorkspace();
            workspace.Connections.RemoveAll(c => c.Id == id);
            SaveWorkspace(workspace);
            return Task.CompletedTask;
        }
    }

    public Task<string> ExportConfigurationAsync(bool includeSecrets = false)
    {
        lock (_lock)
        {
            var workspace = LoadWorkspace();
            var payload = includeSecrets
                ? (IEnumerable<ServiceBusConnection>)workspace.Connections
                : workspace.Connections.Select(MaskConnection);
            var json = JsonSerializer.Serialize(payload, JsonOptions);
            return Task.FromResult(json);
        }
    }

    public Task ImportConfigurationAsync(string jsonData)
    {
        if (string.IsNullOrWhiteSpace(jsonData))
            throw new ArgumentException("Configuration data cannot be empty");

        var importedConnections = JsonSerializer.Deserialize<List<ServiceBusConnection>>(jsonData);

        if (importedConnections == null || importedConnections.Count == 0)
            throw new ArgumentException("Invalid or empty configuration data");

        lock (_lock)
        {
            var workspace = LoadWorkspace();

            foreach (var imported in importedConnections)
            {
                var existing = workspace.Connections.FirstOrDefault(c => c.Id == imported.Id);

                if (existing != null)
                {
                    existing.Name = imported.Name;
                    existing.ConnectionString = imported.ConnectionString == "***"
                        ? existing.ConnectionString
                        : imported.ConnectionString;
                    existing.Namespace = imported.Namespace;
                    existing.ClientId = imported.ClientId;
                    existing.EnvironmentId = imported.EnvironmentId;

                    // Azure AD auth fields.
                    existing.AuthType = imported.AuthType;
                    existing.FullyQualifiedNamespace = imported.FullyQualifiedNamespace;
                    existing.TenantId = imported.TenantId;
                    existing.ServicePrincipalClientId = imported.ServicePrincipalClientId;
                    existing.ClientSecret = imported.ClientSecret == "***"
                        ? existing.ClientSecret
                        : imported.ClientSecret;
                }
                else
                {
                    if (string.IsNullOrEmpty(imported.Id))
                        imported.Id = Guid.NewGuid().ToString();
                    if (imported.CreatedAt == default)
                        imported.CreatedAt = DateTime.UtcNow;
                    workspace.Connections.Add(imported);
                }
            }

            SaveWorkspace(workspace);
        }

        return Task.CompletedTask;
    }

    // ────────────────────────────────────────────────────────────────
    // IConnectionGroupManager implementation
    // ────────────────────────────────────────────────────────────────

    public Task<IEnumerable<ConnectionGroup>> GetGroupsAsync()
    {
        var workspace = LoadWorkspace();
        return Task.FromResult<IEnumerable<ConnectionGroup>>(workspace.Groups);
    }

    public Task<ConnectionGroup?> GetGroupAsync(string id)
    {
        var workspace = LoadWorkspace();
        var group = workspace.Groups.FirstOrDefault(g => g.Id == id);
        return Task.FromResult(group);
    }

    public Task<ConnectionGroup> SaveGroupAsync(ConnectionGroup group)
    {
        lock (_lock)
        {
            var workspace = LoadWorkspace();
            var existing = workspace.Groups.FirstOrDefault(g => g.Id == group.Id);

            if (existing != null)
            {
                existing.Name = group.Name;
                existing.Type = group.Type;
                existing.ParentId = group.ParentId;
                existing.Description = group.Description;
                existing.Order = group.Order;
            }
            else
            {
                if (string.IsNullOrEmpty(group.Id))
                    group.Id = Guid.NewGuid().ToString();
                group.CreatedAt = DateTime.UtcNow;
                workspace.Groups.Add(group);
            }

            SaveWorkspace(workspace);
            return Task.FromResult(group);
        }
    }

    public Task DeleteGroupAsync(string id)
    {
        lock (_lock)
        {
            var workspace = LoadWorkspace();
            workspace.Groups.RemoveAll(g => g.Id == id);
            SaveWorkspace(workspace);
            return Task.CompletedTask;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Internal workspace data model
    // ────────────────────────────────────────────────────────────────

    private class WorkspaceData
    {
        public List<ServiceBusConnection> Connections { get; set; } = new();
        public List<ConnectionGroup> Groups { get; set; } = new();
    }
}
