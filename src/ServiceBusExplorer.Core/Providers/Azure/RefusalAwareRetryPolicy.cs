using System.Net.Sockets;
using System.Net.WebSockets;
using Azure.Messaging.ServiceBus;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// The retry policy of the messaging client. It retries what the SDK's own policy retries, with the same waits, but
/// for a refusal as not authorised: the SDK retries one three times over more than eleven seconds, and a missing right
/// does not appear by waiting. Here it is retried once, after the base delay, which covers a token that expired as the
/// link opened, and then given up.
/// </summary>
internal sealed class RefusalAwareRetryPolicy(ServiceBusRetryOptions options) : ServiceBusRetryPolicy
{
    private const double JitterFactor = 0.08;

    /// <inheritdoc />
    public override TimeSpan CalculateTryTimeout(int attemptCount) => options.TryTimeout;

    /// <inheritdoc />
    public override TimeSpan? CalculateRetryDelay(Exception lastException, int attemptCount)
    {
        if (options.MaxRetries <= 0 || attemptCount > options.MaxRetries || System.Transactions.Transaction.Current is not null)
        {
            return null;
        }

        var error = lastException switch
        {
            OperationCanceledException cancelled => cancelled.InnerException,
            AggregateException aggregate => aggregate.Flatten().InnerException,
            _ => lastException,
        };
        if (error is WebSocketException webSocket)
        {
            error = webSocket.InnerException;
        }

        if (error is UnauthorizedAccessException)
        {
            return attemptCount <= 1 ? options.Delay : null;
        }

        var retried = error switch
        {
            ServiceBusException broker => broker.IsTransient,
            SocketException socket => socket.SocketErrorCode is not (SocketError.HostUnreachable or SocketError.HostNotFound or SocketError.NoRecovery),
            TimeoutException or IOException => true,
            _ => false,
        };
        if (!retried)
        {
            return null;
        }

        var seconds = (options.Mode == ServiceBusRetryMode.Fixed ? 1 : Math.Pow(2, attemptCount)) * options.Delay.TotalSeconds
            + Random.Shared.NextDouble() * options.Delay.TotalSeconds * JitterFactor;
        return TimeSpan.FromSeconds(Math.Min(seconds, options.MaxDelay.TotalSeconds));
    }
}
