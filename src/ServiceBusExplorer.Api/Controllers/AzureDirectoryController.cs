using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>The body of a sign-in to the Azure directory.</summary>
public sealed record AzureDirectorySignInRequest(AzureAuthType AuthType, string? TenantId);

/// <summary>
/// Sign in, then pick: signs in to Azure with Microsoft or the Azure CLI session and lists, from Azure Resource
/// Manager, the subscriptions of the account and the Service Bus namespaces of one. The token and the credential stay
/// in <see cref="AzureNamespaceDirectory"/>; a response carries the account, the tenant and the lists only. A refusal
/// or a failure answers <c>{ message, code }</c> with a sentence this application authored.
/// </summary>
[ApiController]
[Route("api/azure-directory")]
public class AzureDirectoryController(AzureNamespaceDirectory directory, ILogger<AzureDirectoryController> logger) : ControllerBase
{
    /// <summary>
    /// Signs in, which opens the browser or asks the Azure CLI, and answers <c>{ account, tenantId }</c>. Another
    /// authentication, a cancelled or a failed sign-in answers 400.
    /// </summary>
    [HttpPost("sign-in")]
    public async Task<IActionResult> SignIn([FromBody] AzureDirectorySignInRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var account = await directory.SignInAsync(request.AuthType, request.TenantId, cancellationToken);
            return Ok(new { account = account.Account, tenantId = account.TenantId, tenantDomain = account.TenantDomain });
        }
        catch (AzureDirectoryException ex)
        {
            return Failure(ex, StatusCodes.Status400BadRequest);
        }
    }

    /// <summary>The subscriptions of the signed-in account; 409 without a sign-in, 502 when Azure did not list them.</summary>
    [HttpGet("subscriptions")]
    public async Task<IActionResult> Subscriptions(CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await directory.ListSubscriptionsAsync(cancellationToken));
        }
        catch (AzureDirectoryException ex)
        {
            return ListFailure(ex);
        }
    }

    /// <summary>
    /// The Service Bus namespaces of one subscription; 400 when the ID is not a GUID, 409 without a sign-in, 502 when
    /// Azure did not list them.
    /// </summary>
    [HttpGet("subscriptions/{subscriptionId}/namespaces")]
    public async Task<IActionResult> Namespaces(string subscriptionId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await directory.ListNamespacesAsync(subscriptionId, cancellationToken));
        }
        catch (AzureDirectoryException ex)
        {
            return ListFailure(ex);
        }
    }

    /// <summary>Drops the session; the lists answer 409 until the next sign-in.</summary>
    [HttpPost("sign-out")]
    public IActionResult EndSession()
    {
        directory.SignOut();
        return NoContent();
    }

    private IActionResult ListFailure(AzureDirectoryException ex) => Failure(ex, ex.Reason switch
    {
        AzureDirectoryFailure.NotSignedIn => StatusCodes.Status409Conflict,
        AzureDirectoryFailure.InvalidSubscription => StatusCodes.Status400BadRequest,
        _ => StatusCodes.Status502BadGateway
    });

    private ObjectResult Failure(AzureDirectoryException ex, int status)
    {
        logger.LogWarning("Azure directory request answered {Status}: {Reason}", status, ex.Reason);
        return StatusCode(status, new { message = ex.Message, code = CodeOf(ex.Reason) });
    }

    private static string CodeOf(AzureDirectoryFailure reason) => reason switch
    {
        AzureDirectoryFailure.NotSignedIn => "not-signed-in",
        AzureDirectoryFailure.UnsupportedAuthentication => "unsupported-authentication",
        AzureDirectoryFailure.SignIn => "sign-in",
        AzureDirectoryFailure.CliSession => "cli-session",
        AzureDirectoryFailure.InvalidSubscription => "invalid-subscription",
        AzureDirectoryFailure.Forbidden => "forbidden",
        AzureDirectoryFailure.Timeout => "timeout",
        AzureDirectoryFailure.Network => "network",
        AzureDirectoryFailure.BadAnswer => "bad-answer",
        AzureDirectoryFailure.TooMany => "too-many",
        AzureDirectoryFailure.InvalidTenant => "invalid-tenant",
        _ => "failed"
    };
}
