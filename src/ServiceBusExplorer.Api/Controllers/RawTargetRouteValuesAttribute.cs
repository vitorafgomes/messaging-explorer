using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>
/// Gives every whole-segment route value to the action decoded exactly once from the raw request
/// target, so an entity name sent as <c>a%2Fmessages</c> arrives as <c>a/messages</c> and one sent as
/// <c>a%252Fb</c> arrives as <c>a%2Fb</c>. Kestrel leaves <c>%2F</c> encoded in a route value but
/// decodes <c>%25</c>, so the route value alone cannot tell those two names apart.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed partial class RawTargetRouteValuesAttribute : Attribute, IResourceFilter
{
    /// <inheritdoc />
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        if (context.HttpContext.GetEndpoint() is RouteEndpoint endpoint)
        {
            Apply(context.HttpContext.Features.Get<IHttpRequestFeature>()?.RawTarget, endpoint.RoutePattern, context.RouteData.Values);
        }
    }

    /// <inheritdoc />
    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }

    /// <summary>
    /// Replaces each route value whose pattern segment is a single parameter with the matching raw
    /// segment, decoded once. A value is replaced only when the raw target is an origin-form path
    /// with as many segments as the pattern and the raw segment decodes the way the server decoded
    /// it into the current value; anything else is left as routing produced it.
    /// </summary>
    public static void Apply(string? rawTarget, RoutePattern pattern, RouteValueDictionary values)
    {
        if (string.IsNullOrEmpty(rawTarget) || rawTarget[0] != '/')
        {
            return;
        }

        var query = rawTarget.IndexOf('?');
        var segments = (query < 0 ? rawTarget : rawTarget[..query])[1..].Split('/');
        if (segments.Length != pattern.PathSegments.Count)
        {
            return;
        }

        for (var i = 0; i < segments.Length; i++)
        {
            if (pattern.PathSegments[i].Parts is [RoutePatternParameterPart parameter]
                && values.TryGetValue(parameter.Name, out var current)
                && current is string routed
                && routed == DecodeKeepingEncodedSlash(segments[i]))
            {
                values[parameter.Name] = Uri.UnescapeDataString(segments[i]);
            }
        }
    }

    private static string DecodeKeepingEncodedSlash(string segment) =>
        Uri.UnescapeDataString(EncodedSlash().Replace(segment, m => "%25" + m.Value[1..]));

    [GeneratedRegex("%2[fF]")]
    private static partial Regex EncodedSlash();
}
