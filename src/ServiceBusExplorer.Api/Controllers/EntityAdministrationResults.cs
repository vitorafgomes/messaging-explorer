using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;

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

    /// <summary>
    /// 502 with the exception's own message, which this application authored, when the broker did not return the
    /// messages of a peek; the broker's error is logged and never answered.
    /// </summary>
    public static ObjectResult ReadFailed(MessageReadFailedException ex, ILogger logger, string entityPath, MessageSubQueue subQueue)
    {
        logger.LogWarning(ex, "The broker did not return the {SubQueue} messages of {EntityPath}", subQueue, entityPath);
        return new ObjectResult(new { message = ex.Message }) { StatusCode = StatusCodes.Status502BadGateway };
    }

    public static BadRequestObjectResult DeleteAllOfTransferDeadLetter() => new(new { message = "all must be false for the transfer dead-letter queue." });

    public static BadRequestObjectResult ScheduledMessagesNotSupported() => new(new { message = "This provider does not support scheduled messages." });

    public static BadRequestObjectResult DeferralNotSupported() => new(new { message = "This provider does not support deferred messages." });

    public static BadRequestObjectResult ManualDeadLetterNotSupported() => new(new { message = "This provider does not support dead-lettering a message by sequence number." });

    /// <summary>
    /// 400 before the provider is called when a body names an encoding other than text or base64, when a base64 body
    /// does not decode, or when the provider declares no binary body, so a base64 body is never sent as its text;
    /// null when every body may be sent.
    /// </summary>
    public static BadRequestObjectResult? BodyNotAccepted(IMessagingProvider provider, IEnumerable<SendMessageRequest> messages)
    {
        foreach (var message in messages)
        {
            if (message.BodyEncoding is null or MessageBodyEncoding.Text)
                continue;
            if (message.BodyEncoding != MessageBodyEncoding.Base64)
                return new(new { message = "bodyEncoding must be text or base64." });
            if (!provider.Capabilities.SupportsBinaryBody)
                return new(new { message = "This provider does not support a binary body." });
            if (!Convert.TryFromBase64String(message.Body, new byte[message.Body.Length], out _))
                return new(new { message = "A base64 body must be valid base64." });
        }

        return null;
    }

    /// <summary>
    /// 400 when the route reads the transfer dead-letter queue and the provider declares it does not have one;
    /// null when the provider may be called.
    /// </summary>
    public static BadRequestObjectResult? SubQueueNotSupported(IMessagingProvider provider, MessageSubQueue subQueue) =>
        subQueue == MessageSubQueue.TransferDeadLetter && !provider.Capabilities.SupportsTransferDeadLetter
            ? new(new { message = "This provider does not support the transfer dead-letter queue." })
            : null;

    /// <summary>400 when the provider declares it cannot search messages; null when it may be called.</summary>
    public static BadRequestObjectResult? SearchNotSupported(IMessagingProvider provider) =>
        provider.Capabilities.SupportsMessageSearch ? null : new(new { message = "This provider does not support searching messages." });

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

    /// <summary>
    /// 400 when <paramref name="value"/> is given and is not a whole number of 0 or more, or when it is given and the
    /// provider cannot peek from a position, naming the queue or the dead-letter queue as <paramref name="subQueue"/> is;
    /// null otherwise, with <paramref name="fromSequenceNumber"/> null when the value was absent.
    /// </summary>
    public static BadRequestObjectResult? PeekPosition(IMessagingProvider provider, MessageSubQueue subQueue, string? value, out long? fromSequenceNumber)
    {
        fromSequenceNumber = null;
        if (value is null) return null;
        if (!long.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var position))
            return new(new { message = "fromSequenceNumber must be a whole number of 0 or more." });
        if (!provider.Capabilities.SupportsPeekFromSequenceNumber)
            return new(new { message = subQueue == MessageSubQueue.Active
                ? "This provider cannot read the queue from a position."
                : "This provider cannot read the dead-letter queue from a position." });
        fromSequenceNumber = position;
        return null;
    }

    /// <summary>
    /// 400 when <paramref name="value"/> is given and is neither <c>true</c> nor <c>false</c>; null otherwise, with
    /// <paramref name="includeBody"/> true unless the value was <c>false</c>.
    /// </summary>
    public static BadRequestObjectResult? IncludeBody(string? value, out bool includeBody)
    {
        includeBody = value != "false";
        return value is null or "true" or "false" ? null : new(new { message = "includeBody must be true or false." });
    }
}
