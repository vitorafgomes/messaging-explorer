using System.Text;
using System.Text.Json;
using Azure.Core;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>An Azure subscription the signed-in account can read.</summary>
public sealed record AzureSubscription(string Id, string DisplayName);

/// <summary>A Service Bus namespace of a subscription, as Azure Resource Manager lists it.</summary>
public sealed record AzureNamespace(string Name, string FullyQualifiedNamespace, string ResourceGroup, string Tier, string ResourceId);

/// <summary>The account and tenant of the token a sign-in returned, and the tenant's default domain, empty when Azure did not give it.</summary>
public sealed record AzureDirectoryAccount(string Account, string TenantId, string TenantDomain = "");

/// <summary>
/// Reads Azure Resource Manager for the "sign in, then pick" flow of the add-connection dialog: the subscriptions of the
/// signed-in account and the Service Bus namespaces of one subscription. Holds one session, the credential of the last
/// sign-in, in memory only; the token never leaves this class. Every read is bounded: 10 pages, 1000 items and a
/// timeout of its own on top of the caller's token. A read or a sign-in that fails throws
/// <see cref="AzureDirectoryException"/>, whose message is a fixed sentence.
/// </summary>
public class AzureNamespaceDirectory
{
    /// <summary>The only scope a token of the directory is asked for.</summary>
    public const string Scope = "https://management.azure.com/.default";

    private const string ManagementHost = "management.azure.com";
    private const int MaxPages = 10;
    private const int MaxItems = 1000;

    private readonly HttpClient _http;
    private readonly Func<AzureAuthType, string?, TokenCredential> _credentialFor;
    private readonly TimeSpan _timeout;
    private readonly ILogger _logger;
    private readonly TimeSpan _signInTimeout;
    private readonly Lock _sessionLock = new();
    private Session? _session;
    private int _generation;

    private sealed record Session(TokenCredential Credential, AzureDirectoryAccount Account);

    /// <summary>
    /// Reads through <paramref name="handler"/>, or the network when null, with credentials from
    /// <paramref name="credentialFor"/>, or <see cref="AzureCredentialFactory.ForDirectory"/> when null, and a 30 second
    /// timeout per read unless <paramref name="timeout"/> is given.
    /// </summary>
    public AzureNamespaceDirectory(HttpMessageHandler? handler = null, Func<AzureAuthType, string?, TokenCredential>? credentialFor = null,
        TimeSpan? timeout = null, ILogger<AzureNamespaceDirectory>? logger = null, TimeSpan? signInTimeout = null)
    {
        _signInTimeout = signInTimeout ?? TimeSpan.FromMinutes(5);
        _http = new HttpClient(handler ?? NetworkHandler())
        {
            Timeout = Timeout.InfiniteTimeSpan
        };
        _credentialFor = credentialFor ?? AzureCredentialFactory.ForDirectory;
        _timeout = timeout ?? TimeSpan.FromSeconds(30);
        _logger = (ILogger?)logger ?? NullLogger.Instance;
    }

    /// <summary>The handler that reaches the network: it follows no redirect, so a request goes to Resource Manager only.</summary>
    internal static SocketsHttpHandler NetworkHandler() => new() { PooledConnectionLifetime = TimeSpan.FromMinutes(5), AllowAutoRedirect = false };

    private Session? Current { get { lock (_sessionLock) { return _session; } } }

    /// <summary>The account signed in, or null when none is.</summary>
    public AzureDirectoryAccount? Account => Current?.Account;

    /// <summary>
    /// Signs in with Microsoft, which opens the browser, or asks the Azure CLI, for a token of the Resource Manager
    /// scope; keeps the credential as the session, replacing the one before, and answers the account and tenant read
    /// from the token's claims. A failed sign-in keeps no session.
    /// </summary>
    /// <exception cref="AzureDirectoryException">Another authentication was asked, or no token was given.</exception>
    /// <exception cref="OperationCanceledException"><paramref name="cancellationToken"/> was cancelled.</exception>
    public async Task<AzureDirectoryAccount> SignInAsync(AzureAuthType authType, string? tenantId, CancellationToken cancellationToken)
    {
        if (authType is not (AzureAuthType.InteractiveBrowser or AzureAuthType.AzureCli))
        {
            throw new AzureDirectoryException(AzureDirectoryFailure.UnsupportedAuthentication,
                "The namespaces are listed after a sign-in with Microsoft or with the Azure CLI session only.");
        }

        tenantId = string.IsNullOrWhiteSpace(tenantId) ? null : tenantId.Trim();
        if (tenantId != null && !Guid.TryParse(tenantId, out _) && !IsDomain(tenantId))
        {
            throw new AzureDirectoryException(AzureDirectoryFailure.InvalidTenant, "The tenant is an ID or a domain, such as contoso.onmicrosoft.com.");
        }

        int mine;
        lock (_sessionLock)
        {
            _session = null;
            mine = ++_generation;
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_signInTimeout);
        try
        {
            var credential = _credentialFor(authType, tenantId);
            var token = await credential.GetTokenAsync(new TokenRequestContext([Scope], tenantId: tenantId), timeout.Token);
            var account = ReadAccount(token.Token, tenantId);
            account = account with { TenantDomain = await TenantDomainAsync(credential, account.TenantId, timeout.Token) };
            lock (_sessionLock)
            {
                if (mine != _generation)
                {
                    throw new AzureDirectoryException(AzureDirectoryFailure.SignIn, "The sign-in was left before it completed. Nothing was read from Azure.");
                }

                _session = new Session(credential, account);
            }

            if (authType == AzureAuthType.InteractiveBrowser)
            {
                AzureCredentialFactory.ShareSignIn(account.TenantId, credential);
            }

            return account;
        }
        catch (AzureDirectoryException)
        {
            throw;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            _logger.LogWarning("Sign-in to the Azure directory with {AuthType} was not completed within {Timeout}", authType, _signInTimeout);
            throw new AzureDirectoryException(AzureDirectoryFailure.Timeout, "The sign-in was not completed in time. Start it again.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Sign-in to the Azure directory with {AuthType} failed ({ExceptionType})", authType, ex.GetType().Name);
            throw authType == AzureAuthType.AzureCli
                ? new AzureDirectoryException(AzureDirectoryFailure.CliSession, "No Azure CLI session answered. Run az login in a terminal, then Check again.")
                : new AzureDirectoryException(AzureDirectoryFailure.SignIn, "The sign-in did not complete. Nothing was read from Azure.");
        }
    }

    /// <summary>Drops the session and every shared sign-in with Microsoft; the next list needs a new sign-in.</summary>
    public void SignOut()
    {
        lock (_sessionLock)
        {
            _session = null;
            _generation++;
        }

        AzureCredentialFactory.ForgetSignIns();
    }

    /// <summary>The subscriptions of the signed-in account.</summary>
    /// <exception cref="AzureDirectoryException">No account is signed in, or the read failed.</exception>
    public Task<IReadOnlyList<AzureSubscription>> ListSubscriptionsAsync(CancellationToken cancellationToken) =>
        ListSubscriptionsAsync(SignedIn(), cancellationToken);

    /// <summary>The Service Bus namespaces of one subscription of the signed-in account.</summary>
    /// <exception cref="AzureDirectoryException">No account is signed in, the ID is not a GUID, or the read failed.</exception>
    public Task<IReadOnlyList<AzureNamespace>> ListNamespacesAsync(string subscriptionId, CancellationToken cancellationToken) =>
        ListNamespacesAsync(SignedIn(), subscriptionId, cancellationToken);

    /// <summary>The subscriptions <paramref name="credential"/> can read.</summary>
    /// <exception cref="AzureDirectoryException">The read failed.</exception>
    public async Task<IReadOnlyList<AzureSubscription>> ListSubscriptionsAsync(TokenCredential credential, CancellationToken cancellationToken) =>
        await ReadAllAsync(credential, $"https://{ManagementHost}/subscriptions?api-version=2022-12-01", item =>
            Text(item, "subscriptionId") is { } id ? new AzureSubscription(id, Text(item, "displayName") ?? id) : null, cancellationToken);

    /// <summary>The Service Bus namespaces of the subscription <paramref name="subscriptionId"/>, which must be a GUID.</summary>
    /// <exception cref="AzureDirectoryException">The ID is not a GUID, refused before any request, or the read failed.</exception>
    public async Task<IReadOnlyList<AzureNamespace>> ListNamespacesAsync(TokenCredential credential, string subscriptionId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParseExact(subscriptionId, "D", out var id))
        {
            throw new AzureDirectoryException(AzureDirectoryFailure.InvalidSubscription, "The subscription ID is not a GUID.");
        }

        return await ReadAllAsync(credential,
            $"https://{ManagementHost}/subscriptions/{id:D}/providers/Microsoft.ServiceBus/namespaces?api-version=2021-11-01", ToNamespace, cancellationToken);
    }

    private sealed record Tenant(string Id, string Domain);

    /// <summary>The default domain of a tenant, as the account's own list of tenants names it; empty when the list was not given.</summary>
    private async Task<string> TenantDomainAsync(TokenCredential credential, string tenantId, CancellationToken cancellationToken)
    {
        try
        {
            var tenants = await ReadAllAsync(credential, $"https://{ManagementHost}/tenants?api-version=2022-12-01", item =>
                Text(item, "tenantId") is { } id ? new Tenant(id, Text(item, "defaultDomain") ?? "") : null, cancellationToken);
            return tenants.FirstOrDefault(t => t.Id.Equals(tenantId, StringComparison.OrdinalIgnoreCase))?.Domain ?? "";
        }
        catch (AzureDirectoryException)
        {
            return "";
        }
    }

    private static bool IsDomain(string text) =>
        text.Length <= 253 && text.Contains('.') && text.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-');

    private TokenCredential SignedIn() =>
        Current?.Credential ?? throw new AzureDirectoryException(AzureDirectoryFailure.NotSignedIn, "Sign in first: no Azure account is signed in.");

    private static AzureNamespace? ToNamespace(JsonElement item)
    {
        if (Text(item, "name") is not { } name || Text(item, "id") is not { } resourceId) return null;
        var endpoint = item.TryGetProperty("properties", out var properties) ? Text(properties, "serviceBusEndpoint") : null;
        var host = Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ? uri.Host : $"{name}.servicebus.windows.net";
        var segments = resourceId.Split('/');
        var group = Array.FindIndex(segments, s => s.Equals("resourceGroups", StringComparison.OrdinalIgnoreCase)) is var at and >= 0 && at + 1 < segments.Length
            ? segments[at + 1]
            : "";
        var tier = item.TryGetProperty("sku", out var sku) ? Text(sku, "name") ?? "" : "";
        return new AzureNamespace(name, host, group, tier, resourceId);
    }

    private static string? Text(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private async Task<IReadOnlyList<T>> ReadAllAsync<T>(TokenCredential credential, string firstPage, Func<JsonElement, T?> map, CancellationToken cancellationToken)
        where T : class
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_timeout);
        var items = new List<T>();
        try
        {
            var token = await credential.GetTokenAsync(new TokenRequestContext([Scope]), timeout.Token);
            Uri? page = new(firstPage);
            for (var read = 0; page != null && read < MaxPages && items.Count < MaxItems; read++)
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, page);
                request.Headers.Authorization = new("Bearer", token.Token);
                using var response = await _http.SendAsync(request, timeout.Token);
                if (!response.IsSuccessStatusCode)
                {
                    var status = (int)response.StatusCode;
                    _logger.LogWarning("Azure Resource Manager answered {Status} to a directory read", status);
                    throw status is 401 or 403
                        ? new AzureDirectoryException(AzureDirectoryFailure.Forbidden, $"Your account may not read this subscription ({status}).")
                        : new AzureDirectoryException(AzureDirectoryFailure.Failed, $"Azure answered {status}.");
                }

                using var body = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(timeout.Token), cancellationToken: timeout.Token);
                if (!body.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array)
                {
                    throw new JsonException("No value list.");
                }

                items.AddRange(value.EnumerateArray().Select(map).OfType<T>().Take(MaxItems - items.Count));
                page = NextPage(Text(body.RootElement, "nextLink"));
            }

            if (page != null)
            {
                _logger.LogWarning("A directory read stopped at its bounds with more to read");
                throw new AzureDirectoryException(AzureDirectoryFailure.TooMany, "Azure holds more than this app lists (10 pages, 1000 items). Type the namespace instead.");
            }

            return items;
        }
        catch (AzureDirectoryException)
        {
            throw;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Azure Resource Manager did not answer a directory read within {Timeout}", _timeout);
            throw new AzureDirectoryException(AzureDirectoryFailure.Timeout, "Azure did not answer within 30 seconds.");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("Azure Resource Manager could not be reached ({ExceptionType})", ex.GetType().Name);
            throw new AzureDirectoryException(AzureDirectoryFailure.Network, "Azure could not be reached. Check the network of this computer.");
        }
        catch (JsonException)
        {
            _logger.LogWarning("Azure Resource Manager answered a directory read with a body that is not a list");
            throw new AzureDirectoryException(AzureDirectoryFailure.BadAnswer, "Azure answered with something that is not a list this app can read.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning("The token for a directory read was not given ({ExceptionType})", ex.GetType().Name);
            throw new AzureDirectoryException(AzureDirectoryFailure.SignIn, "The sign-in no longer gives a token. Sign in again.");
        }
    }

    /// <summary>The next page, only when it is https on Resource Manager itself: the token goes nowhere else.</summary>
    private Uri? NextPage(string? nextLink)
    {
        if (nextLink == null) return null;
        if (Uri.TryCreate(nextLink, UriKind.Absolute, out var next) && next.Scheme == Uri.UriSchemeHttps
            && next.Host.Equals(ManagementHost, StringComparison.OrdinalIgnoreCase) && next.IsDefaultPort)
        {
            return next;
        }

        _logger.LogWarning("A next link of a directory read was not followed: it is not https on {Host}", ManagementHost);
        return null;
    }

    /// <summary>The account and tenant from the claims of a JWT; the tenant asked, or empty, when the token has none.</summary>
    private static AzureDirectoryAccount ReadAccount(string token, string? tenantId)
    {
        var parts = token.Split('.');
        if (parts.Length < 2) return new AzureDirectoryAccount("", tenantId ?? "");
        var payload = parts[1].Replace('-', '+').Replace('_', '/');
        payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
        try
        {
            using var claims = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(payload)));
            var root = claims.RootElement;
            var account = Text(root, "preferred_username") ?? Text(root, "upn") ?? Text(root, "unique_name") ?? "";
            return new AzureDirectoryAccount(account, Text(root, "tid") ?? tenantId ?? "");
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
            return new AzureDirectoryAccount("", tenantId ?? "");
        }
    }
}
