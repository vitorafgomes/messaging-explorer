namespace ServiceBusExplorer.Core.Services;

/// <summary>
/// Configuration options bound from the "AzureMonitor" section of appsettings.
/// Drives the registration of <see cref="IMetricsService"/> in the API host.
/// </summary>
public sealed class AzureMonitorOptions
{
    public const string SectionName = "AzureMonitor";

    /// <summary>
    /// Azure subscription ID containing the Service Bus namespace.
    /// </summary>
    public string? SubscriptionId { get; set; }

    /// <summary>
    /// Azure resource group containing the Service Bus namespace.
    /// </summary>
    public string? ResourceGroup { get; set; }

    /// <summary>
    /// Service Bus namespace name.
    /// </summary>
    public string? Namespace { get; set; }

    /// <summary>
    /// Returns true when all required fields are present.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(SubscriptionId)
        && !string.IsNullOrWhiteSpace(ResourceGroup)
        && !string.IsNullOrWhiteSpace(Namespace);
}
