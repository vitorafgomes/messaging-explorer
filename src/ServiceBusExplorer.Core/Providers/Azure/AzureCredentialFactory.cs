using Azure.Core;
using Azure.Identity;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// Builds <see cref="TokenCredential"/> instances for Azure Service Bus connections
/// based on the selected <see cref="AzureAuthType"/>.
/// </summary>
public static class AzureCredentialFactory
{
    /// <summary>
    /// Redirect URI used by the interactive browser flow. The Azure SDK starts a
    /// short-lived HTTP listener on this loopback address to capture the OAuth code.
    /// </summary>
    public const string InteractiveBrowserRedirectUri = "http://localhost:8400";

    /// <summary>
    /// Creates the appropriate TokenCredential for the given config.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Thrown when <see cref="AzureAuthType.ConnectionString"/> is passed — connection-string
    /// auth does not use a TokenCredential and must be handled separately.
    /// </exception>
    public static TokenCredential Create(AzureConnectionConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);

        return config.AuthType switch
        {
            AzureAuthType.ServicePrincipal => new ClientSecretCredential(
                config.TenantId,
                config.ServicePrincipalClientId,
                config.ClientSecret),

            AzureAuthType.AzureCli => new AzureCliCredential(),

            // Audit finding H6: ManagedIdentity probes can hang on dev machines without IMDS;
            // exclude it explicitly in the DefaultCredential chain.
            AzureAuthType.DefaultCredential => new DefaultAzureCredential(
                new DefaultAzureCredentialOptions
                {
                    ExcludeManagedIdentityCredential = true
                }),

            // Interactive browser credential: opens the system default browser on the
            // user's desktop on first GetTokenAsync() call. The SDK runs a temporary
            // HTTP listener on InteractiveBrowserRedirectUri to capture the OAuth redirect.
            // TenantId is optional; null falls back to the "common" authority.
            AzureAuthType.InteractiveBrowser => new InteractiveBrowserCredential(
                new InteractiveBrowserCredentialOptions
                {
                    TenantId = config.TenantId,
                    AuthorityHost = AzureAuthorityHosts.AzurePublicCloud,
                    RedirectUri = new Uri(InteractiveBrowserRedirectUri)
                }),

            AzureAuthType.ConnectionString =>
                throw new InvalidOperationException("Connection string auth does not use TokenCredential"),

            _ => throw new ArgumentOutOfRangeException(
                nameof(config),
                config.AuthType,
                "Unknown AzureAuthType")
        };
    }
}
