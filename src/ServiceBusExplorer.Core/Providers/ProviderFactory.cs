using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Providers;

/// <summary>
/// Factory for creating messaging providers based on provider type.
/// Manages provider instantiation and lifecycle for runtime provider switching.
/// </summary>
public class ProviderFactory : IProviderFactory
{
    private readonly ILogger<ProviderFactory> _logger;
    private readonly ILoggerFactory? _loggerFactory;

    /// <summary>
    /// Initializes a new instance of the <see cref="ProviderFactory"/> class.
    /// </summary>
    /// <param name="logger">Optional logger for factory operations.</param>
    /// <param name="loggerFactory">Optional logger factory for creating provider-specific loggers.</param>
    public ProviderFactory(
        ILogger<ProviderFactory>? logger = null,
        ILoggerFactory? loggerFactory = null)
    {
        _logger = logger ?? NullLogger<ProviderFactory>.Instance;
        _loggerFactory = loggerFactory;
    }

    /// <inheritdoc />
    public IMessagingProvider CreateProvider(ProviderType providerType)
    {
        _logger.LogDebug("Creating provider of type {ProviderType}", providerType);

        return providerType switch
        {
            ProviderType.AzureServiceBus => new AzureServiceBusProvider(
                _loggerFactory?.CreateLogger<AzureServiceBusProvider>()),
            ProviderType.RabbitMQ => new RabbitMQProvider(),
            _ => throw new ArgumentOutOfRangeException(
                nameof(providerType),
                providerType,
                $"Unsupported provider type: {providerType}")
        };
    }

    /// <inheritdoc />
    public IMessagingProvider CreateProvider(IConnectionConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);

        _logger.LogDebug(
            "Creating provider for connection {ConnectionName} of type {ProviderType}",
            config.Name,
            config.ProviderType);

        return CreateProvider(config.ProviderType);
    }

    /// <inheritdoc />
    public IMessagingProvider CreateProvider(ServiceBusConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);

        _logger.LogDebug(
            "Creating provider for ServiceBusConnection {ConnectionName} of type {ProviderType}",
            connection.Name,
            connection.ProviderType);

        return CreateProvider(connection.ProviderType);
    }

    /// <inheritdoc />
    public IConnectionConfig CreateConnectionConfig(ProviderType providerType)
    {
        _logger.LogDebug("Creating connection config for provider type {ProviderType}", providerType);

        return providerType switch
        {
            ProviderType.AzureServiceBus => new AzureConnectionConfig(),
            ProviderType.RabbitMQ => new RabbitMQConnectionConfig(),
            _ => throw new ArgumentOutOfRangeException(
                nameof(providerType),
                providerType,
                $"Unsupported provider type: {providerType}")
        };
    }

    /// <inheritdoc />
    public IConnectionConfig CreateConnectionConfig(ServiceBusConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);

        _logger.LogDebug(
            "Creating connection config from ServiceBusConnection {ConnectionName} of type {ProviderType}",
            connection.Name,
            connection.ProviderType);

        return connection.ProviderType switch
        {
            ProviderType.AzureServiceBus => AzureConnectionConfig.FromServiceBusConnection(connection),
            ProviderType.RabbitMQ => RabbitMQConnectionConfig.FromServiceBusConnection(connection),
            _ => throw new ArgumentOutOfRangeException(
                nameof(connection),
                connection.ProviderType,
                $"Unsupported provider type: {connection.ProviderType}")
        };
    }

    /// <inheritdoc />
    public async Task<IMessagingProvider> CreateConnectedProviderAsync(ServiceBusConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);

        _logger.LogInformation(
            "Creating and connecting provider for {ConnectionName} ({ProviderType})",
            connection.Name,
            connection.ProviderType);

        var provider = CreateProvider(connection);
        var config = CreateConnectionConfig(connection);

        try
        {
            await provider.ConnectAsync(config);

            _logger.LogInformation(
                "Successfully connected to {Target} using {ProviderType}",
                provider.CurrentTarget,
                connection.ProviderType);

            return provider;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Failed to connect to {ConnectionName} ({ProviderType})",
                connection.Name,
                connection.ProviderType);

            // Dispose the provider if connection failed
            await provider.DisposeAsync();
            throw;
        }
    }

    /// <inheritdoc />
    public async Task<bool> TestConnectionAsync(ServiceBusConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);

        _logger.LogDebug(
            "Testing connection for {ConnectionName} ({ProviderType})",
            connection.Name,
            connection.ProviderType);

        await using var provider = CreateProvider(connection);
        var config = CreateConnectionConfig(connection);

        try
        {
            var result = await provider.TestConnectionAsync(config);

            _logger.LogDebug(
                "Connection test for {ConnectionName} ({ProviderType}): {Result}",
                connection.Name,
                connection.ProviderType,
                result ? "Success" : "Failed");

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Connection test failed for {ConnectionName} ({ProviderType})",
                connection.Name,
                connection.ProviderType);

            return false;
        }
    }

    /// <inheritdoc />
    public IProviderCapabilities GetProviderCapabilities(ProviderType providerType)
    {
        return providerType switch
        {
            ProviderType.AzureServiceBus => AzureProviderCapabilities.Instance,
            ProviderType.RabbitMQ => RabbitMQProviderCapabilities.Instance,
            _ => throw new ArgumentOutOfRangeException(
                nameof(providerType),
                providerType,
                $"Unsupported provider type: {providerType}")
        };
    }

    /// <inheritdoc />
    public IEnumerable<ProviderType> GetSupportedProviderTypes()
    {
        return Enum.GetValues<ProviderType>();
    }

    /// <inheritdoc />
    public IEnumerable<ProviderInfo> GetSupportedProviders()
    {
        return GetSupportedProviderTypes().Select(type =>
        {
            var capabilities = GetProviderCapabilities(type);
            return new ProviderInfo
            {
                Type = type,
                DisplayName = capabilities.ProviderDisplayName,
                Version = capabilities.ProviderVersion,
                Capabilities = capabilities
            };
        });
    }
}

/// <summary>
/// Interface for the provider factory.
/// Enables dependency injection and testability.
/// </summary>
public interface IProviderFactory
{
    /// <summary>
    /// Creates a messaging provider of the specified type.
    /// The provider is created but not connected.
    /// </summary>
    /// <param name="providerType">The type of provider to create.</param>
    /// <returns>A new messaging provider instance.</returns>
    IMessagingProvider CreateProvider(ProviderType providerType);

    /// <summary>
    /// Creates a messaging provider based on the connection configuration.
    /// The provider is created but not connected.
    /// </summary>
    /// <param name="config">The connection configuration.</param>
    /// <returns>A new messaging provider instance.</returns>
    IMessagingProvider CreateProvider(IConnectionConfig config);

    /// <summary>
    /// Creates a messaging provider based on the ServiceBusConnection model.
    /// The provider is created but not connected.
    /// </summary>
    /// <param name="connection">The ServiceBusConnection model.</param>
    /// <returns>A new messaging provider instance.</returns>
    IMessagingProvider CreateProvider(ServiceBusConnection connection);

    /// <summary>
    /// Creates a connection configuration for the specified provider type.
    /// </summary>
    /// <param name="providerType">The type of provider.</param>
    /// <returns>A new connection configuration with default values.</returns>
    IConnectionConfig CreateConnectionConfig(ProviderType providerType);

    /// <summary>
    /// Creates a connection configuration from a ServiceBusConnection model.
    /// </summary>
    /// <param name="connection">The ServiceBusConnection model.</param>
    /// <returns>A connection configuration populated from the ServiceBusConnection.</returns>
    IConnectionConfig CreateConnectionConfig(ServiceBusConnection connection);

    /// <summary>
    /// Creates a provider and connects it using the specified connection.
    /// </summary>
    /// <param name="connection">The ServiceBusConnection model.</param>
    /// <returns>A connected messaging provider instance.</returns>
    /// <exception cref="Exception">Thrown if connection fails.</exception>
    Task<IMessagingProvider> CreateConnectedProviderAsync(ServiceBusConnection connection);

    /// <summary>
    /// Tests a connection without establishing a persistent connection.
    /// </summary>
    /// <param name="connection">The ServiceBusConnection model to test.</param>
    /// <returns>True if the connection is successful; otherwise, false.</returns>
    Task<bool> TestConnectionAsync(ServiceBusConnection connection);

    /// <summary>
    /// Gets the capabilities for a specific provider type.
    /// </summary>
    /// <param name="providerType">The type of provider.</param>
    /// <returns>The provider's capabilities.</returns>
    IProviderCapabilities GetProviderCapabilities(ProviderType providerType);

    /// <summary>
    /// Gets all supported provider types.
    /// </summary>
    /// <returns>A collection of supported provider types.</returns>
    IEnumerable<ProviderType> GetSupportedProviderTypes();

    /// <summary>
    /// Gets information about all supported providers.
    /// </summary>
    /// <returns>A collection of provider information.</returns>
    IEnumerable<ProviderInfo> GetSupportedProviders();
}

/// <summary>
/// Information about a messaging provider.
/// </summary>
public class ProviderInfo
{
    /// <summary>
    /// The provider type.
    /// </summary>
    public ProviderType Type { get; set; }

    /// <summary>
    /// The display name for the provider.
    /// </summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// The version of the provider implementation.
    /// </summary>
    public string? Version { get; set; }

    /// <summary>
    /// The capabilities supported by this provider.
    /// </summary>
    public IProviderCapabilities? Capabilities { get; set; }
}
