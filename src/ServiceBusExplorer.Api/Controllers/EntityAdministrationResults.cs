using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>
/// The answers of the create and update routes of queues, topics and subscriptions. Every body is
/// <c>{ "message": ... }</c> with text this application authored; a broker's own text only reaches the log.
/// The limits of a configuration are the provider's: it refuses one with <see cref="InvalidEntityConfigurationException"/>.
/// </summary>
internal static class EntityAdministrationResults
{
    public const string UpdateNotSupported = "This provider does not support updating entities.";
    public const string InternalError = "An internal error occurred.";

    public static BadRequestObjectResult NameRequired() => new(new { message = "name is required." });

    public static NotFoundObjectResult NotFound(string kind) => new(new { message = $"The {kind} was not found." });

    public static BadRequestObjectResult NotSupported() => new(new { message = UpdateNotSupported });

    /// <summary>
    /// 409 when the entity exists, 404 when <paramref name="missingKind"/> does not, 400 with the exception's own
    /// message when the configuration was refused, 500 with the constant body for anything else.
    /// </summary>
    public static ObjectResult Failure(Exception ex, ILogger logger, string kind, string entityPath, string missingKind)
    {
        switch (ex)
        {
            case EntityAlreadyExistsException:
                return new ConflictObjectResult(new { message = $"A {kind} with this name already exists." });
            case EntityNotFoundException:
                return NotFound(missingKind);
            case InvalidEntityConfigurationException:
                logger.LogWarning(ex, "The configuration of {EntityKind} {EntityPath} was refused", kind, entityPath);
                return new BadRequestObjectResult(new { message = ex.Message });
            default:
                logger.LogError(ex, "Administration of {EntityKind} {EntityPath} failed", kind, entityPath);
                return new ObjectResult(new { message = InternalError }) { StatusCode = StatusCodes.Status500InternalServerError };
        }
    }
}
