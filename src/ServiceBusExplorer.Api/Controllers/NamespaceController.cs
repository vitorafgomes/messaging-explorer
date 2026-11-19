using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>
/// The connected namespace: its properties, read-only; the definitions of every entity, as an export to one document,
/// and an import of such a document that creates only what does not exist, after a dry run. Every failure is <c>{ "message": ... }</c> with
/// text this application authored.
/// </summary>
[ApiController]
[Route("api/namespace")]
public class NamespaceController : ControllerBase
{
    /// <summary>The largest import body read, in bytes: 10 MiB.</summary>
    public const int MaxImportBytes = 10 * 1024 * 1024;

    private readonly ILogger<NamespaceController> _logger;
    private readonly JsonSerializerOptions _json;

    public NamespaceController(ILogger<NamespaceController> logger, IOptions<JsonOptions> json)
    {
        _logger = logger;
        _json = json.Value.JsonSerializerOptions;
    }

    /// <summary>
    /// The provider's document, its <see cref="EntityDefinitionsDocument.Source"/> set to the connection target the
    /// app shows: a namespace or a host, never the connection string or a credential.
    /// </summary>
    [HttpPost("export")]
    public async Task<ActionResult<EntityDefinitionsDocument>> Export()
    {
        if (Refusal(out var provider) is { } refused) return refused;

        try
        {
            var document = await provider.ExportDefinitionsAsync(HttpContext.RequestAborted);
            document.Source = provider.CurrentTarget;
            return Ok(document);
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Export of the entity definitions failed");
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    /// <summary>
    /// The connected namespace's name, tier, messaging units, alias, times and the tier's largest message. Read-only. A
    /// provider without namespace properties answers 400 and is never called; a failed read, a missing Manage right
    /// included, answers the constant 500, never a value that was not read.
    /// </summary>
    [HttpGet("properties")]
    public async Task<ActionResult<NamespaceInfo>> Properties()
    {
        var provider = ConnectionsController.GetCurrentProvider();
        if (provider is null)
            return BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
        if (!provider.Capabilities.SupportsNamespaceProperties)
            return BadRequest(new { message = "This provider has no namespace properties." });

        try
        {
            return Ok(await provider.GetNamespacePropertiesAsync(HttpContext.RequestAborted));
        }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested)
        {
            return new EmptyResult();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Read of the namespace properties failed");
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    /// <summary>
    /// Reads the body as a definitions document, at most <see cref="MaxImportBytes"/>. <paramref name="dryRun"/> is true
    /// unless it is exactly <c>false</c>, so a request that leaves it out creates nothing.
    /// </summary>
    [HttpPost("import")]
    public async Task<ActionResult<DefinitionsImportResult>> Import([FromQuery] string? dryRun = null)
    {
        if (dryRun is not (null or "true" or "false"))
            return BadRequest(new { message = "dryRun must be true or false." });
        if (Refusal(out var provider) is { } refused) return refused;

        var body = await ReadBodyAsync(HttpContext.RequestAborted);
        if (body is null)
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { message = $"The document must be at most {MaxImportBytes / (1024 * 1024)} MB." });

        EntityDefinitionsDocument? document;
        try
        {
            document = JsonSerializer.Deserialize<EntityDefinitionsDocument>(body, _json);
        }
        catch (JsonException ex)
        {
            return BadRequest(new { message = $"The document is not valid JSON, or a value has the wrong type, at {ex.Path ?? "$"}." });
        }

        if (document is null)
            return BadRequest(new { message = "The document is empty." });

        try
        {
            return Ok(await provider.ImportDefinitionsAsync(document, dryRun != "false", HttpContext.RequestAborted));
        }
        catch (InvalidEntityConfigurationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Import of the entity definitions failed");
            return EntityAdministrationResults.Unhandled(ex);
        }
    }

    /// <summary>400 when no provider is connected or it has no definitions; null when <paramref name="provider"/> may be called.</summary>
    private BadRequestObjectResult? Refusal(out IMessagingProvider provider)
    {
        provider = ConnectionsController.GetCurrentProvider()!;
        if (provider is null)
            return BadRequest(new { message = "No messaging provider connected. Please connect to a provider first." });
        return provider.Capabilities.SupportsDefinitions
            ? null
            : BadRequest(new { message = "This provider does not support entity definitions." });
    }

    /// <summary>The request body, or null when it is longer than <see cref="MaxImportBytes"/>; never more than one byte past the limit is read.</summary>
    private async Task<byte[]?> ReadBodyAsync(CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await Request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > MaxImportBytes) return null;
        }

        return buffer.ToArray();
    }
}
