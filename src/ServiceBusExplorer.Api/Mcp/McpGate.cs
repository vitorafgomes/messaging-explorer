namespace ServiceBusExplorer.Api.Mcp;

/// <summary>
/// What a request to <c>/mcp</c> passes before the MCP server sees it, in this order: the server is on (404
/// otherwise), the <c>Origin</c>, when there is one, is this computer (403 otherwise), and
/// <c>Authorization: Bearer</c> carries the MCP token (401 otherwise, with one body whatever was wrong). The per-launch
/// <c>X-Api-Key</c> plays no part here.
/// </summary>
public static class McpGate
{
    /// <summary>The path the MCP server is mapped at.</summary>
    public const string Path = "/mcp";

    /// <summary>True when <paramref name="context"/> asks for <see cref="Path"/> or below it, in any letter case.</summary>
    public static bool Covers(HttpContext context) =>
        context.Request.Path.StartsWithSegments(Path, StringComparison.OrdinalIgnoreCase);

    /// <summary>True when the request may reach the MCP server; otherwise the refusal has been written.</summary>
    public static async Task<bool> AdmitAsync(HttpContext context, McpSettingsStore settings)
    {
        if (!settings.Current.Enabled)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return false;
        }

        var origins = context.Request.Headers.Origin;
        if (origins.Count > 1 || (origins.Count == 1 && !IsThisComputer(origins[0])))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = "This origin may not call the MCP server." });
            return false;
        }

        if (BearerToken(context) is not { } token || !settings.TokenMatches(token))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { message = "Unauthorized" });
            return false;
        }

        return true;
    }

    private static string? BearerToken(HttpContext context)
    {
        var headers = context.Request.Headers.Authorization;
        if (headers.Count != 1 || headers[0] is not { } value) return null;
        const string scheme = "Bearer ";
        if (!value.StartsWith(scheme, StringComparison.OrdinalIgnoreCase)) return null;
        var token = value[scheme.Length..].Trim();
        return token.Length == 0 ? null : token;
    }

    private static bool IsThisComputer(string? origin) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttp
        && uri.UserInfo.Length == 0
        && uri.PathAndQuery == "/"
        && uri.Host is "localhost" or "127.0.0.1" or "[::1]";
}
