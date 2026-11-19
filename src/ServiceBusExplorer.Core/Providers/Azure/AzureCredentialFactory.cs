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
            AzureAuthType.InteractiveBrowser => ForDirectory(AzureAuthType.InteractiveBrowser, config.TenantId),

            AzureAuthType.ConnectionString =>
                throw new InvalidOperationException("Connection string auth does not use TokenCredential"),

            _ => throw new ArgumentOutOfRangeException(
                nameof(config),
                config.AuthType,
                "Unknown AzureAuthType")
        };
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, TokenCredential> SignedIn = new();

    private static string Key(string? tenantId) => tenantId?.Trim().ToLowerInvariant() ?? "";

    /// <summary>
    /// Makes a sign-in with Microsoft that completed the shared one of the tenant it signed into as well, so a
    /// connection saved with that tenant's id finds it. A credential this factory did not make is left out.
    /// </summary>
    internal static void ShareSignIn(string tenantId, TokenCredential credential)
    {
        if (credential is OneSignInAtATime)
        {
            SignedIn[Key(tenantId)] = credential;
        }
    }

    /// <summary>Forgets every sign-in with Microsoft, so the next one opens the browser and another account can sign in.</summary>
    public static void ForgetSignIns() => SignedIn.Clear();

    /// <summary>
    /// Creates the credential the Azure directory signs in with, from the authentication and an optional tenant only:
    /// sign in with Microsoft or the Azure CLI session. Sign in with Microsoft is one credential per tenant for the
    /// whole run, shared by the directory and by every connection, so the browser opens once and not once per use.
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException">Any other <see cref="AzureAuthType"/>.</exception>
    public static TokenCredential ForDirectory(AzureAuthType authType, string? tenantId) => authType switch
    {
        AzureAuthType.InteractiveBrowser => SignedIn.GetOrAdd(Key(tenantId), tenant =>
            new OneSignInAtATime(new InteractiveBrowserCredential(new InteractiveBrowserCredentialOptions
            {
                TenantId = tenant.Length == 0 ? null : tenant,
                AuthorityHost = AzureAuthorityHosts.AzurePublicCloud,
                RedirectUri = new Uri(InteractiveBrowserRedirectUri)
            }))),
        AzureAuthType.AzureCli => new AzureCliCredential(new AzureCliCredentialOptions { TenantId = tenantId }),
        _ => throw new ArgumentOutOfRangeException(nameof(authType), authType, "The directory signs in with Microsoft or the Azure CLI only.")
    };
}
