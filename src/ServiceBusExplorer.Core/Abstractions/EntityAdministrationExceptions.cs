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
/// disabled or send-disabled, a receive from one that is disabled or receive-disabled. Thrown only when no message
/// was removed from its source. A resubmit or move whose first cycle was sent in several batches may have sent part of
/// that cycle before the broker refused the next batch; those messages stay in the source, so a retry can duplicate
/// them. The message is fixed; the broker's own error is the inner exception and is for the log only.
/// </summary>
public sealed class EntityDisabledException(Exception? innerException = null)
    : Exception("The entity is disabled for this operation.", innerException);

/// <summary>
/// The broker did not return the messages of a read that changes nothing: a peek of a queue, of a subscription or of
/// one of their sub-queues. <see cref="Exception.Message"/> is text this application authored and is safe to show: a
/// fixed sentence and, in brackets, the name the provider gives the cause. The broker's own error is the inner
/// exception and is for the log only.
/// </summary>
public sealed class MessageReadFailedException(string cause, Exception? innerException = null)
    : Exception($"The broker did not return the messages of this entity ({cause}).", innerException);

/// <summary>
/// Tells apart why a broker refused an operation as not authorised, from what the broker names in its error. The
/// answer is one of a few fixed phrases this application authored, safe to show; the broker's text is never returned.
/// </summary>
public static class BrokerRefusal
{
    private static readonly (string Right, string Role)[] Rights =
    [
        ("Listen", "Azure Service Bus Data Receiver"),
        ("Send", "Azure Service Bus Data Sender"),
        ("Manage", "Azure Service Bus Data Owner"),
    ];

    private static readonly string[] NetworkWords = ["Ip has been prevented", "public network access"];

    /// <summary>What the refusal names, or null when it names neither a right nor the network.</summary>
    public static string? Detail(Exception refusal)
    {
        var text = refusal.Message;
        if (text.Contains("claim", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var (right, role) in Rights)
            {
                if (text.Contains($"'{right}", StringComparison.OrdinalIgnoreCase))
                {
                    return $"the broker says the {right} right is missing; the role {role}, or a key with that right, gives it";
                }
            }

            return "the broker says a right this operation needs is missing";
        }

        return NetworkWords.Any(word => text.Contains(word, StringComparison.OrdinalIgnoreCase))
            ? "the network rules of the namespace refuse this computer"
            : null;
    }
}

/// <summary>
/// The broker refused the user name or the password of a connection. The sentence is fixed; what the broker's client
/// said stays in the inner exception and is never shown.
/// </summary>
public sealed class BrokerCredentialsRefusedException(Exception innerException)
    : Exception("The broker refused the user name or the password.", innerException);

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

/// <summary>Why the Azure directory did not sign in or did not list what was asked.</summary>
public enum AzureDirectoryFailure
{
    /// <summary>No account is signed in to the directory.</summary>
    NotSignedIn,

    /// <summary>The authentication asked is not one the directory signs in with.</summary>
    UnsupportedAuthentication,

    /// <summary>The sign-in with Microsoft did not complete.</summary>
    SignIn,

    /// <summary>The Azure CLI gave no token.</summary>
    CliSession,

    /// <summary>The subscription ID is not a GUID.</summary>
    InvalidSubscription,

    /// <summary>Azure answered 401 or 403.</summary>
    Forbidden,

    /// <summary>Azure did not answer in time.</summary>
    Timeout,

    /// <summary>Azure could not be reached.</summary>
    Network,

    /// <summary>Azure answered a body that is not the list asked for.</summary>
    BadAnswer,

    /// <summary>Azure answered another status.</summary>
    Failed,

    /// <summary>Azure holds more than the bounds of a read.</summary>
    TooMany,

    /// <summary>The tenant asked is neither an ID nor a domain.</summary>
    InvalidTenant
}

/// <summary>
/// The Azure directory did not sign in or did not list subscriptions or namespaces. <see cref="Exception.Message"/> is a
/// sentence this application authored and is safe to show; it never carries a token or the text Azure answered.
/// </summary>
public sealed class AzureDirectoryException(AzureDirectoryFailure reason, string message) : Exception(message)
{
    /// <summary>Why nothing was signed in or listed.</summary>
    public AzureDirectoryFailure Reason { get; } = reason;
}
