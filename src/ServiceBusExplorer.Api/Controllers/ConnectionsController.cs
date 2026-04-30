using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ConnectionsController : ControllerBase
{
    private readonly IConnectionManager _connectionManager;
    private readonly IServiceBusService _serviceBusService;
    private readonly IConnectionGroupManager _groupManager;
    private readonly IProviderFactory _providerFactory;
    private readonly ILogger<ConnectionsController> _logger;

    /// <summary>
    /// Holds the currently connected messaging provider instance.
    /// This is static to persist across controller instances since controllers are transient.
    /// Thread-safe access via lock.
    /// </summary>
    private static IMessagingProvider? _currentProvider;
    private static readonly object _providerLock = new();

    // Static logger used by the SetCurrentProviderAsync helper, which is static
    // and cannot access instance fields. Assigned from the instance logger on
    // first ctor invocation so disposal errors have somewhere to go.
    private static ILogger? _staticLogger;

    public ConnectionsController(
        IConnectionManager connectionManager,
        IServiceBusService serviceBusService,
        IConnectionGroupManager groupManager,
        IProviderFactory providerFactory,
        ILogger<ConnectionsController> logger)
    {
        _connectionManager = connectionManager;
        _serviceBusService = serviceBusService;
        _groupManager = groupManager;
        _providerFactory = providerFactory;
        _logger = logger;
        _staticLogger ??= logger;
    }

    /// <summary>
    /// Gets the current messaging provider instance (thread-safe).
    /// </summary>
    private static IMessagingProvider? CurrentProvider
    {
        get { lock (_providerLock) { return _currentProvider; } }
    }

    /// <summary>
    /// Sets the current messaging provider instance (thread-safe).
    /// Disposes the previous provider if one exists.
    /// </summary>
    private static async Task SetCurrentProviderAsync(IMessagingProvider? provider)
    {
        IMessagingProvider? oldProvider;
        lock (_providerLock)
        {
            oldProvider = _currentProvider;
            _currentProvider = provider;
        }

        // Dispose old provider outside the lock to avoid deadlocks
        if (oldProvider != null)
        {
            try
            {
                await oldProvider.DisconnectAsync();
                await oldProvider.DisposeAsync();
            }
            catch (Exception ex)
            {
                _staticLogger?.LogWarning(ex, "Error disposing previous messaging provider ({ExceptionType})", ex.GetType().Name);
            }
        }
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ServiceBusConnection>>> GetConnections()
    {
        try
        {
            _logger.LogDebug("Fetching connections");
            var connections = await _connectionManager.GetConnectionsAsync();
            _logger.LogInformation("Retrieved {ConnectionCount} connections", connections.Count());
            return Ok(connections);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch connections");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<ServiceBusConnection>> GetConnection(string id)
    {
        var connection = await _connectionManager.GetConnectionAsync(id);
        if (connection == null)
            return NotFound();

        return Ok(connection);
    }

    [HttpPost]
    public async Task<ActionResult<ServiceBusConnection>> SaveConnection([FromBody] ServiceBusConnection connection)
    {
        try
        {
            // If updating an existing connection, merge masked/sensitive fields from the original
            var isMetadataOnlyUpdate = false;
            if (!string.IsNullOrEmpty(connection.Id))
            {
                // Need raw secrets here to preserve existing connection string / password
                // when the client submits the masked placeholder.
                var existing = await _connectionManager.GetConnectionWithSecretAsync(connection.Id);
                if (existing != null)
                {
                    // Restore masked connection string
                    if (connection.ConnectionString == "***")
                    {
                        connection.ConnectionString = existing.ConnectionString;
                    }
                    // Restore masked password
                    if (connection.Password == "***")
                    {
                        connection.Password = existing.Password;
                    }

                    // Check if only metadata changed (clientId, environmentId, name)
                    var sameConnectionString = connection.ConnectionString == existing.ConnectionString;
                    var sameHost = connection.HostName == existing.HostName;
                    var samePort = connection.Port == existing.Port;
                    var sameUser = connection.UserName == existing.UserName;
                    var samePassword = connection.Password == existing.Password;
                    var sameProvider = connection.ProviderType == existing.ProviderType;

                    isMetadataOnlyUpdate = sameProvider && sameConnectionString
                        && sameHost && samePort && sameUser && samePassword;

                    if (isMetadataOnlyUpdate)
                    {
                        _logger.LogInformation(
                            "Metadata-only update for connection {ConnectionId}, skipping connection test",
                            connection.Id);
                    }
                }
            }

            if (!isMetadataOnlyUpdate)
            {
                _logger.LogInformation(
                    "Testing connection for {ConnectionName} ({ProviderType})",
                    connection.Name, connection.ProviderType);

                // Test connection before saving using the provider factory
                var isValid = await _providerFactory.TestConnectionAsync(connection);
                if (!isValid)
                {
                    var errorMessage = connection.ProviderType == ProviderType.AzureServiceBus
                        ? "Invalid connection string or unable to connect to Service Bus"
                        : $"Unable to connect to {connection.ProviderType} server";
                    return BadRequest(new { message = errorMessage });
                }

                _logger.LogDebug("Connection test successful, persisting connection");
            }

            var saved = await _connectionManager.SaveConnectionAsync(connection);
            _logger.LogInformation("Connection saved with id {ConnectionId}", saved.Id);
            return Ok(saved);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save connection");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("test")]
    public async Task<ActionResult> TestConnection([FromBody] ServiceBusConnection connection)
    {
        try
        {
            _logger.LogInformation(
                "Testing connection {ConnectionName} ({ProviderType})",
                connection.Name, connection.ProviderType);

            var isValid = await _providerFactory.TestConnectionAsync(connection);

            if (!isValid)
            {
                string errorMessage;

                if (connection.ProviderType == ProviderType.RabbitMQ)
                {
                    var managementPort = connection.ManagementPort ?? 15672;
                    errorMessage = $"Failed to connect to RabbitMQ at {connection.HostName}:{managementPort}. Check: (1) RabbitMQ is running (2) Management plugin enabled (3) Credentials are correct (4) Port accessible";
                }
                else // Azure Service Bus
                {
                    errorMessage = "Failed to connect to Azure Service Bus. Check: (1) Connection string is correct (2) Namespace exists (3) Credentials have required permissions (4) Network allows access";
                }

                return Ok(new
                {
                    success = false,
                    error = errorMessage,
                    providerType = connection.ProviderType.ToString()
                });
            }

            return Ok(new { success = isValid, providerType = connection.ProviderType.ToString() });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Connection test threw for {ConnectionName}", connection.Name);
            return Ok(new { success = false, error = "Connection test failed due to an internal error.", providerType = connection.ProviderType.ToString() });
        }
    }

    [HttpPost("{id}/connect")]
    public async Task<ActionResult> Connect(string id)
    {
        try
        {
            // Connecting requires raw secrets (connection string / password).
            var connection = await _connectionManager.GetConnectionWithSecretAsync(id);
            if (connection == null)
                return NotFound();

            _logger.LogInformation("Connecting to {Name} ({ProviderType})", connection.Name, connection.ProviderType);

            // Create and connect provider using the factory
            var provider = await _providerFactory.CreateConnectedProviderAsync(connection);

            // Store the provider for use by other controllers
            await SetCurrentProviderAsync(provider);

            // Update last used timestamp
            connection.LastUsedAt = DateTime.UtcNow;
            await _connectionManager.SaveConnectionAsync(connection);

            _logger.LogInformation("Connected successfully to {Target}", provider.CurrentTarget);

            return Ok(new
            {
                connected = true,
                target = provider.CurrentTarget,
                providerType = provider.ProviderType.ToString(),
                // Keep @namespace for backward compatibility with Azure Service Bus
                @namespace = provider.CurrentTarget
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to {ConnectionId}", id);
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("disconnect")]
    public async Task<ActionResult> Disconnect()
    {
        try
        {
            _logger.LogInformation("Disconnecting from messaging provider");

            var provider = CurrentProvider;
            if (provider != null)
            {
                var target = provider.CurrentTarget;
                var providerType = provider.ProviderType;

                // Clear and dispose the provider
                await SetCurrentProviderAsync(null);

                _logger.LogInformation("Disconnected from {Target} ({ProviderType})", target, providerType);

                return Ok(new
                {
                    connected = false,
                    target = target,
                    providerType = providerType.ToString()
                });
            }

            // Also disconnect legacy service for backward compatibility
            if (_serviceBusService.IsConnected)
            {
                await _serviceBusService.DisconnectAsync();
            }

            _logger.LogDebug("No active provider connection to disconnect");
            return Ok(new { connected = false });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to disconnect messaging provider");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpGet("status")]
    public ActionResult GetStatus()
    {
        var provider = CurrentProvider;

        if (provider != null && provider.IsConnected)
        {
            return Ok(new
            {
                connected = true,
                target = provider.CurrentTarget,
                providerType = provider.ProviderType.ToString(),
                // Keep @namespace for backward compatibility
                @namespace = provider.CurrentTarget
            });
        }

        // Fall back to legacy service for backward compatibility
        return Ok(new
        {
            connected = _serviceBusService.IsConnected,
            @namespace = _serviceBusService.CurrentNamespace,
            providerType = _serviceBusService.IsConnected ? ProviderType.AzureServiceBus.ToString() : (string?)null
        });
    }

    /// <summary>
    /// Gets the list of supported provider types.
    /// </summary>
    [HttpGet("providers")]
    public ActionResult GetProviders()
    {
        var providers = _providerFactory.GetSupportedProviders().Select(p => new
        {
            type = p.Type.ToString(),
            displayName = p.DisplayName,
            version = p.Version,
            capabilities = p.Capabilities != null ? new
            {
                supportsTopics = p.Capabilities.SupportsTopics,
                supportsSubscriptions = p.Capabilities.SupportsSubscriptions,
                supportsScheduledMessages = p.Capabilities.SupportsScheduledMessages,
                supportsSessions = p.Capabilities.SupportsSessions,
                supportsDeadLetterQueue = p.Capabilities.SupportsDeadLetterQueue,
                supportsSequenceNumbers = p.Capabilities.SupportsSequenceNumbers,
                supportsMessageFiltering = p.Capabilities.SupportsMessageFiltering,
                supportsMessageBatching = p.Capabilities.SupportsMessageBatching,
                supportsTransactions = p.Capabilities.SupportsTransactions,
                supportedExchangeTypes = p.Capabilities.SupportedExchangeTypes
            } : null
        });

        return Ok(providers);
    }

    /// <summary>
    /// Gets capabilities for a specific provider type.
    /// </summary>
    [HttpGet("providers/{providerType}/capabilities")]
    public ActionResult GetProviderCapabilities(string providerType)
    {
        if (!Enum.TryParse<ProviderType>(providerType, ignoreCase: true, out var type))
        {
            return BadRequest(new { message = $"Unknown provider type: {providerType}" });
        }

        try
        {
            var capabilities = _providerFactory.GetProviderCapabilities(type);

            return Ok(new
            {
                providerType = type.ToString(),
                displayName = capabilities.ProviderDisplayName,
                version = capabilities.ProviderVersion,
                supportsTopics = capabilities.SupportsTopics,
                supportsSubscriptions = capabilities.SupportsSubscriptions,
                supportsScheduledMessages = capabilities.SupportsScheduledMessages,
                supportsSessions = capabilities.SupportsSessions,
                supportsDeadLetterQueue = capabilities.SupportsDeadLetterQueue,
                supportsSequenceNumbers = capabilities.SupportsSequenceNumbers,
                supportsMessageFiltering = capabilities.SupportsMessageFiltering,
                supportsMessageBatching = capabilities.SupportsMessageBatching,
                supportsTransactions = capabilities.SupportsTransactions,
                supportsDeferral = capabilities.SupportsDeferral,
                supportsDuplicateDetection = capabilities.SupportsDuplicateDetection,
                supportsAutoForwarding = capabilities.SupportsAutoForwarding,
                maxMessageSizeInBytes = capabilities.MaxMessageSizeInBytes,
                maxTimeToLive = capabilities.MaxTimeToLive.ToString(),
                supportedExchangeTypes = capabilities.SupportedExchangeTypes
            });
        }
        catch (ArgumentOutOfRangeException)
        {
            return BadRequest(new { message = $"Unsupported provider type: {providerType}" });
        }
    }

    /// <summary>
    /// Gets the current provider instance (for use by other controllers).
    /// </summary>
    public static IMessagingProvider? GetCurrentProvider() => CurrentProvider;

    [HttpDelete("{id}")]
    public async Task<ActionResult> DeleteConnection(string id)
    {
        await _connectionManager.DeleteConnectionAsync(id);
        return NoContent();
    }

    [HttpPost("export")]
    public async Task<ActionResult> ExportConfiguration([FromQuery] bool includeSecrets = false)
    {
        if (includeSecrets)
        {
            _logger.LogWarning("Full-secrets export requested from {RemoteIp}", HttpContext.Connection.RemoteIpAddress);
            Response.Headers.ContentDisposition = "attachment; filename=\"servicebus-export-with-secrets.json\"";
        }

        var json = await _connectionManager.ExportConfigurationAsync(includeSecrets);
        return Content(json, "application/json");
    }

    [HttpPost("import")]
    public async Task<ActionResult> ImportConfiguration([FromBody] ImportConfigurationRequest request)
    {
        try
        {
            _logger.LogInformation(
                "Import configuration request received, payloadLength={PayloadLength}",
                request?.ConfigurationJson?.Length ?? 0);

            if (string.IsNullOrWhiteSpace(request?.ConfigurationJson))
            {
                _logger.LogWarning("Import configuration rejected: payload is null or empty");
                return BadRequest(new { message = "Configuration data is required" });
            }

            await _connectionManager.ImportConfigurationAsync(request.ConfigurationJson);

            _logger.LogInformation("Import configuration completed successfully");
            return Ok(new { message = "Configuration imported successfully" });
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Import configuration rejected due to invalid payload");
            return BadRequest(new { message = ex.Message });
        }
        catch (System.Text.Json.JsonException ex)
        {
            _logger.LogWarning(ex, "Import configuration rejected due to invalid JSON");
            // Message intentionally generic so parser hints aren't surfaced.
            return BadRequest(new { message = "Invalid JSON format." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Import configuration failed");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("export-full")]
    public async Task<ActionResult> ExportFullConfiguration([FromQuery] bool includeSecrets = false)
    {
        try
        {
            _logger.LogInformation("Exporting connections and groups (includeSecrets={IncludeSecrets})", includeSecrets);

            if (includeSecrets)
            {
                _logger.LogWarning("Full-secrets export requested from {RemoteIp}", HttpContext.Connection.RemoteIpAddress);
                Response.Headers.ContentDisposition = "attachment; filename=\"servicebus-export-with-secrets.json\"";
            }

            var connectionsJson = await _connectionManager.ExportConfigurationAsync(includeSecrets);
            var groups = await _groupManager.GetGroupsAsync();

            var fullConfig = new
            {
                connections = System.Text.Json.JsonSerializer.Deserialize<List<ServiceBusConnection>>(connectionsJson),
                groups = groups
            };

            // Keep PascalCase for file compatibility
            var jsonOptions = new System.Text.Json.JsonSerializerOptions
            {
                WriteIndented = true
            };
            var json = System.Text.Json.JsonSerializer.Serialize(fullConfig, jsonOptions);

            _logger.LogInformation("Exported {ConnectionCount} connections and {GroupCount} groups",
                fullConfig.connections?.Count ?? 0, groups.Count());

            return Content(json, "application/json");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error exporting full configuration");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPost("import-full")]
    public async Task<ActionResult> ImportFullConfiguration([FromBody] ImportFullConfigurationRequest request)
    {
        try
        {
            _logger.LogInformation("Import-full configuration request received");

            if (string.IsNullOrWhiteSpace(request?.ConfigurationJson))
            {
                return BadRequest(new { message = "Configuration data is required" });
            }

            // Configure JSON options to accept both PascalCase and camelCase
            var jsonOptions = new System.Text.Json.JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            };

            var fullConfig = System.Text.Json.JsonSerializer.Deserialize<FullConfiguration>(request.ConfigurationJson, jsonOptions);

            if (fullConfig == null)
            {
                return BadRequest(new { message = "Invalid configuration format" });
            }

            _logger.LogInformation(
                "Importing {ConnectionCount} connections and {GroupCount} groups",
                fullConfig.Connections?.Count ?? 0, fullConfig.Groups?.Count ?? 0);

            // Import groups first (connections reference them)
            if (fullConfig.Groups != null && fullConfig.Groups.Count > 0)
            {
                foreach (var group in fullConfig.Groups)
                {
                    _logger.LogDebug(
                        "Saving imported group {GroupId} (Type={GroupType}, ParentId={ParentId})",
                        group.Id, group.Type, group.ParentId);
                    await _groupManager.SaveGroupAsync(group);
                }
                _logger.LogInformation("Imported {GroupCount} groups", fullConfig.Groups.Count);
            }

            // Import connections
            if (fullConfig.Connections != null && fullConfig.Connections.Count > 0)
            {
                var connectionsJson = System.Text.Json.JsonSerializer.Serialize(fullConfig.Connections);
                await _connectionManager.ImportConfigurationAsync(connectionsJson);
                _logger.LogInformation("Imported {ConnectionCount} connections", fullConfig.Connections.Count);
            }

            return Ok(new { message = $"Configuration imported successfully: {fullConfig.Connections?.Count ?? 0} connections, {fullConfig.Groups?.Count ?? 0} groups" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Import-full configuration failed");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpDelete("clear-all")]
    public async Task<ActionResult> ClearAllData()
    {
        try
        {
            _logger.LogInformation("Clear-all request received");

            // Get counts before clearing
            var connections = await _connectionManager.GetConnectionsAsync();
            var groups = await _groupManager.GetGroupsAsync();

            var connectionCount = connections.Count();
            var groupCount = groups.Count();

            _logger.LogInformation(
                "Clearing {ConnectionCount} connections and {GroupCount} groups",
                connectionCount, groupCount);

            // Disconnect current provider if connected
            var provider = CurrentProvider;
            if (provider != null)
            {
                _logger.LogInformation("Disconnecting active {ProviderType} provider before clear", provider.ProviderType);
                await SetCurrentProviderAsync(null);
            }

            // Also disconnect legacy service for backward compatibility
            if (_serviceBusService.IsConnected)
            {
                _logger.LogDebug("Disconnecting legacy Service Bus service");
                await _serviceBusService.DisconnectAsync();
            }

            // Get data path from environment variable or use default (same logic as Program.cs)
            var dataPath = Environment.GetEnvironmentVariable("SERVICEBUS_DATA_PATH");
            if (string.IsNullOrEmpty(dataPath))
            {
                dataPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "ServiceBusExplorer"
                );
            }

            var workspaceFile = Path.Combine(dataPath, "workspace.json");

            // Clear the unified workspace file
            _logger.LogInformation("Resetting workspace file");
            await System.IO.File.WriteAllTextAsync(workspaceFile, "{\"Connections\":[],\"Groups\":[]}");

            _logger.LogInformation("All data cleared successfully");
            return Ok(new {
                message = $"All data cleared successfully: {connectionCount} connections, {groupCount} groups deleted",
                connectionsDeleted = connectionCount,
                groupsDeleted = groupCount
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Clear-all failed");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }
}

public class ImportConfigurationRequest
{
    public string ConfigurationJson { get; set; } = string.Empty;
}

public class ImportFullConfigurationRequest
{
    public string ConfigurationJson { get; set; } = string.Empty;
}

public class FullConfiguration
{
    public List<ServiceBusConnection>? Connections { get; set; }
    public List<ConnectionGroup>? Groups { get; set; }
}
