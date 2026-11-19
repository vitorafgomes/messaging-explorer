using Azure.Core;
using Azure.Identity;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>
/// Hands token requests to a credential one at a time. A credential that signs in through the browser is asked by
/// several clients at the same moment, and each request that finds no account yet would open its own browser window;
/// in turn, the first signs in and the rest find the account. A sign-in nobody completes is given up after
/// <paramref name="limit"/>, five minutes when null, as a failed sign-in, so it cannot hold the others for good.
/// </summary>
internal sealed class OneSignInAtATime(TokenCredential inner, TimeSpan? limit = null) : TokenCredential
{
    private readonly SemaphoreSlim _turn = new(1, 1);
    private readonly TimeSpan _limit = limit ?? TimeSpan.FromMinutes(5);

    /// <inheritdoc />
    public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken)
    {
        _turn.Wait(cancellationToken);
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        bounded.CancelAfter(_limit);
        try
        {
            return inner.GetToken(requestContext, bounded.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AuthenticationFailedException("The sign-in was not completed in time.");
        }
        finally
        {
            _turn.Release();
        }
    }

    /// <inheritdoc />
    public override async ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken)
    {
        await _turn.WaitAsync(cancellationToken);
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        bounded.CancelAfter(_limit);
        try
        {
            return await inner.GetTokenAsync(requestContext, bounded.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AuthenticationFailedException("The sign-in was not completed in time.");
        }
        finally
        {
            _turn.Release();
        }
    }
}
