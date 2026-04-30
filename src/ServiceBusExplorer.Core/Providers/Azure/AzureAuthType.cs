namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// Authentication mechanism used to connect to Azure Service Bus.
/// </summary>
public enum AzureAuthType
{
    /// <summary>
    /// Classic SAS connection string auth. Default for backward compatibility.
    /// </summary>
    ConnectionString = 0,

    /// <summary>
    /// Interactive browser login via Azure AD. Phase 2.
    /// </summary>
    InteractiveBrowser = 1,

    /// <summary>
    /// Service principal with client id + secret + tenant.
    /// </summary>
    ServicePrincipal = 2,

    /// <summary>
    /// Delegates to the local Azure CLI session (az login).
    /// </summary>
    AzureCli = 3,

    /// <summary>
    /// DefaultAzureCredential chain (env, CLI, VS, etc.) with Managed Identity excluded.
    /// </summary>
    DefaultCredential = 4
}
