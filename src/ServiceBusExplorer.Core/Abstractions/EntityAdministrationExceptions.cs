namespace ServiceBusExplorer.Core.Abstractions;

/// <summary>
/// The broker refused to create an entity because one with that name exists. The message is fixed; the
/// broker's own error, if any, is the inner exception and is for the log only.
/// </summary>
public sealed class EntityAlreadyExistsException(Exception? innerException = null)
    : Exception("The entity already exists.", innerException);

/// <summary>
/// The entity to change, or the topic to create a subscription under, does not exist. The message is fixed;
/// the broker's own error, if any, is the inner exception and is for the log only.
/// </summary>
public sealed class EntityNotFoundException(Exception? innerException = null)
    : Exception("The entity was not found.", innerException);

/// <summary>
/// The broker refused a message operation because the entity is disabled for it: a send to an entity that is
/// disabled or send-disabled, a receive from one that is disabled or receive-disabled. Thrown only when nothing of
/// the operation was done. The message is fixed; the broker's own error is the inner exception and is for the log only.
/// </summary>
public sealed class EntityDisabledException(Exception? innerException = null)
    : Exception("The entity is disabled for this operation.", innerException);

/// <summary>
/// An entity configuration, or the sequence numbers of a message operation, was refused, by the provider's own
/// rules before anything reached the broker or by the broker itself. <see cref="Exception.Message"/> is always text this application authored and is safe to show:
/// the violations, each naming the field and its allowed range, or the fixed "The broker refused this
/// configuration.". The broker's own error, if any, is only the inner exception and is for the log.
/// </summary>
public sealed class InvalidEntityConfigurationException : Exception
{
    /// <summary>The broker refused the configuration; its error is kept as the inner exception.</summary>
    public InvalidEntityConfigurationException(Exception? innerException = null)
        : base("The broker refused this configuration.", innerException)
    {
    }

    /// <summary>The provider refused the configuration before calling the broker, with the given violations.</summary>
    public InvalidEntityConfigurationException(IReadOnlyList<string> violations)
        : base(string.Join(" ", violations))
    {
    }

    private InvalidEntityConfigurationException(string fixedMessage, Exception innerException)
        : base(fixedMessage, innerException)
    {
    }

    /// <summary>
    /// The broker refused a subscription rule, for example an expression that does not parse; the message is the
    /// fixed "The broker refused this rule. Check the expression." and the broker's error is the inner exception.
    /// </summary>
    public static InvalidEntityConfigurationException RuleRefused(Exception innerException) =>
        new("The broker refused this rule. Check the expression.", innerException);
}
