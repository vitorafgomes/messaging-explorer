using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>
/// The fixed answers of the create and update routes of queues, topics and subscriptions, and of the message routes
/// when a provider lacks a sub-queue or scheduled messages or the broker finds the entity disabled. Every body is
/// <c>{ "message": ... }</c> with text this application authored; a broker's own text only reaches the log.
/// The limits of a configuration are the provider's: it refuses one with <see cref="InvalidEntityConfigurationException"/>.
/// </summary>
internal static class EntityAdministrationResults
{
    public const string UpdateNotSupported = "This provider does not support updating entities.";
    public const string InternalError = "An internal error occurred.";

    public static BadRequestObjectResult NameRequired() => new(new { message = "name is required." });

    public static ConflictObjectResult EntityDisabled() => new(new { message = "The entity is disabled for this operation." });

    public static BadRequestObjectResult DeleteAllOfTransferDeadLetter() => new(new { message = "all must be false for the transfer dead-letter queue." });

    public static BadRequestObjectResult ScheduledMessagesNotSupported() => new(new { message = "This provider does not support scheduled messages." });

    /// <summary>
    /// 400 when the route reads the transfer dead-letter queue and the provider declares it does not have one;
    /// null when the provider may be called.
    /// </summary>
    public static BadRequestObjectResult? SubQueueNotSupported(IMessagingProvider provider, MessageSubQueue subQueue) =>
        subQueue == MessageSubQueue.TransferDeadLetter && !provider.Capabilities.SupportsTransferDeadLetter
            ? new(new { message = "This provider does not support the transfer dead-letter queue." })
            : null;

    public static NotFoundObjectResult NotFound(string kind) => new(new { message = $"The {kind} was not found." });

    public static BadRequestObjectResult NotSupported() => new(new { message = UpdateNotSupported });

    public static BadRequestObjectResult RulesNotSupported() => new(new { message = "This provider does not support subscription rules." });

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
