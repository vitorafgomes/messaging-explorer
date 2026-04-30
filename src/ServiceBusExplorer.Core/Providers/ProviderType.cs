namespace ServiceBusExplorer.Core.Providers;

/// <summary>
/// Defines the supported messaging provider types.
/// </summary>
public enum ProviderType
{
    /// <summary>
    /// Azure Service Bus messaging provider.
    /// </summary>
    AzureServiceBus = 0,

    /// <summary>
    /// RabbitMQ messaging provider.
    /// </summary>
    RabbitMQ = 1
}
