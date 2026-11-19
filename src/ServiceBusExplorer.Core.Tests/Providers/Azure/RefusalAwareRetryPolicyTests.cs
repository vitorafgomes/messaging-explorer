using System.Net.Sockets;
using System.Reflection;
using Azure.Messaging.ServiceBus;
using ServiceBusExplorer.Core.Providers.Azure;
using ServiceBusExplorer.Core.Models;
using Xunit;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The retry policy of the messaging client: the SDK's own for every error but a refusal as not authorised, which
/// the SDK retries three times over more than eleven seconds and this policy retries once.
/// </summary>
public class RefusalAwareRetryPolicyTests
{
    private static readonly ServiceBusRetryPolicy Sdk = SdkPolicy(new ServiceBusRetryOptions());

    private static ServiceBusRetryPolicy SdkPolicy(ServiceBusRetryOptions options)
    {
        var toPolicy = typeof(ServiceBusRetryOptions).Assembly.GetTypes()
            .SelectMany(type => type.GetMethods(BindingFlags.Static | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            .First(method => method.Name == "ToRetryPolicy");
        return (ServiceBusRetryPolicy)(toPolicy.IsStatic ? toPolicy.Invoke(null, [options]) : toPolicy.Invoke(options, []))!;
    }

    public static TheoryData<Exception> EveryOtherError => new()
    {
        new TimeoutException(),
        new IOException(),
        new SocketException(),
        new SocketException((int)SocketError.ConnectionReset),
        new SocketException((int)SocketError.HostNotFound),
        new SocketException((int)SocketError.HostUnreachable),
        new SocketException((int)SocketError.NoRecovery),
        new System.Net.WebSockets.WebSocketException("x"),
        new System.Net.WebSockets.WebSocketException("x", new TimeoutException()),
        new System.Net.WebSockets.WebSocketException("x", new SocketException((int)SocketError.HostNotFound)),
        new System.Net.WebSockets.WebSocketException("x", new InvalidOperationException()),
        new AggregateException(new System.Net.WebSockets.WebSocketException("x", new IOException())),
        new InvalidOperationException(),
        new NotSupportedException(),
        new ObjectDisposedException("receiver"),
        new OperationCanceledException(),
        new TaskCanceledException(),
        new OperationCanceledException("cancelled", new TimeoutException()),
        new TaskCanceledException("cancelled", new IOException()),
        new AggregateException(new TimeoutException()),
        new AggregateException(new InvalidOperationException()),
        new ServiceBusException("x", ServiceBusFailureReason.ServiceBusy),
        new ServiceBusException("x", ServiceBusFailureReason.ServiceTimeout),
        new ServiceBusException("x", ServiceBusFailureReason.ServiceCommunicationProblem),
        new ServiceBusException("x", ServiceBusFailureReason.GeneralError),
        new ServiceBusException("x", ServiceBusFailureReason.MessagingEntityNotFound),
        new ServiceBusException("x", ServiceBusFailureReason.MessagingEntityDisabled),
        new ServiceBusException("x", ServiceBusFailureReason.MessageLockLost),
        new ServiceBusException("x", ServiceBusFailureReason.SessionLockLost),
        new ServiceBusException("x", ServiceBusFailureReason.QuotaExceeded),
        new ServiceBusException("x", ServiceBusFailureReason.MessageSizeExceeded),
    };

    [Theory]
    [MemberData(nameof(EveryOtherError))]
    public void Every_error_but_a_refusal_is_retried_exactly_as_the_SDK_retries_it(Exception error)
    {
        var policy = new RefusalAwareRetryPolicy(new ServiceBusRetryOptions());

        for (var attempt = 0; attempt <= 5; attempt++)
        {
            var (ours, theirs) = (policy.CalculateRetryDelay(error, attempt), Sdk.CalculateRetryDelay(error, attempt));
            Assert.Equal(theirs is null, ours is null);
            if (theirs is not null)
            {
                Assert.InRange(ours!.Value.TotalSeconds, theirs.Value.TotalSeconds - 0.07, theirs.Value.TotalSeconds + 0.07);
            }

            Assert.Equal(Sdk.CalculateTryTimeout(attempt), policy.CalculateTryTimeout(attempt));
        }
    }

    public static TheoryData<ServiceBusRetryOptions> OtherOptions => new()
    {
        new ServiceBusRetryOptions { MaxRetries = 0 },
        new ServiceBusRetryOptions { MaxDelay = TimeSpan.FromSeconds(2), TryTimeout = TimeSpan.FromSeconds(5) },
        new ServiceBusRetryOptions { MaxRetries = 5, Delay = TimeSpan.FromSeconds(0.1) },
        new ServiceBusRetryOptions { Mode = ServiceBusRetryMode.Fixed },
        new ServiceBusRetryOptions { Mode = ServiceBusRetryMode.Fixed, Delay = TimeSpan.FromSeconds(3), MaxDelay = TimeSpan.FromSeconds(2) },
    };

    [Theory]
    [MemberData(nameof(OtherOptions))]
    public void Options_that_stop_or_cap_the_retries_do_so_exactly_as_in_the_SDK_and_a_refusal_never_outlives_them(ServiceBusRetryOptions options)
    {
        var (policy, sdk) = (new RefusalAwareRetryPolicy(options), SdkPolicy(options));

        for (var attempt = 0; attempt <= 6; attempt++)
        {
            var (ours, theirs) = (policy.CalculateRetryDelay(new TimeoutException(), attempt), sdk.CalculateRetryDelay(new TimeoutException(), attempt));
            Assert.Equal(theirs is null, ours is null);
            if (theirs is not null)
            {
                Assert.InRange(ours!.Value.TotalSeconds, theirs.Value.TotalSeconds - 0.07, theirs.Value.TotalSeconds + 0.07);
            }

            Assert.Equal(sdk.CalculateTryTimeout(attempt), policy.CalculateTryTimeout(attempt));
            if (sdk.CalculateRetryDelay(new UnauthorizedAccessException(), attempt) is null)
            {
                Assert.Null(policy.CalculateRetryDelay(new UnauthorizedAccessException(), attempt));
            }
        }
    }

    [Fact]
    public void Inside_a_transaction_nothing_is_retried_as_in_the_SDK()
    {
        var policy = new RefusalAwareRetryPolicy(new ServiceBusRetryOptions());
        using var transaction = new System.Transactions.TransactionScope();

        Assert.Null(Sdk.CalculateRetryDelay(new TimeoutException(), 1));
        Assert.Null(policy.CalculateRetryDelay(new TimeoutException(), 1));
        Assert.Null(policy.CalculateRetryDelay(new UnauthorizedAccessException(), 1));
    }

    [Fact]
    public void A_refusal_as_not_authorised_is_retried_once_after_the_base_delay_and_then_given_up()
    {
        var policy = new RefusalAwareRetryPolicy(new ServiceBusRetryOptions());
        var refused = new UnauthorizedAccessException("SENTINEL");

        Assert.Equal(TimeSpan.FromSeconds(0.8), policy.CalculateRetryDelay(refused, 1));
        Assert.Null(policy.CalculateRetryDelay(refused, 2));
        Assert.Null(policy.CalculateRetryDelay(new AggregateException(refused), 2));
        Assert.NotNull(Sdk.CalculateRetryDelay(refused, 3));
    }

    [Fact]
    public void The_messaging_client_of_a_connection_is_given_this_policy()
    {
        var options = AzureServiceBusProvider.BuildClientOptions(new AzureConnectionConfig
        {
            ConnectionString = "Endpoint=sb://plain.invalid/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        });

        Assert.IsType<RefusalAwareRetryPolicy>(options.RetryOptions.CustomRetryPolicy);
    }
}
