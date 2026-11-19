using Azure.Identity;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

[Collection("the shared sign-in")]
public class AzureCredentialFactoryTests
{
    [Fact]
    public void Create_ServicePrincipal_returns_ClientSecretCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "sp",
            AuthType = AzureAuthType.ServicePrincipal,
            FullyQualifiedNamespace = "fake.servicebus.windows.net",
            TenantId = "11111111-1111-1111-1111-111111111111",
            ServicePrincipalClientId = "22222222-2222-2222-2222-222222222222",
            ClientSecret = "secret"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<ClientSecretCredential>(credential);
    }

    [Fact]
    public void Create_AzureCli_returns_AzureCliCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "cli",
            AuthType = AzureAuthType.AzureCli,
            FullyQualifiedNamespace = "fake.servicebus.windows.net"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<AzureCliCredential>(credential);
    }

    [Fact]
    public void Create_DefaultCredential_returns_DefaultAzureCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "default",
            AuthType = AzureAuthType.DefaultCredential,
            FullyQualifiedNamespace = "fake.servicebus.windows.net"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<DefaultAzureCredential>(credential);
    }

    [Fact]
    public void Create_InteractiveBrowser_returns_InteractiveBrowserCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "ib",
            AuthType = AzureAuthType.InteractiveBrowser,
            FullyQualifiedNamespace = "fake.servicebus.windows.net"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<OneSignInAtATime>(credential);
    }

    [Fact]
    public void Create_InteractiveBrowser_with_TenantId_returns_InteractiveBrowserCredential()
    {
        var config = new AzureConnectionConfig
        {
            Name = "ib-tenant",
            AuthType = AzureAuthType.InteractiveBrowser,
            FullyQualifiedNamespace = "fake.servicebus.windows.net",
            TenantId = "11111111-1111-1111-1111-111111111111"
        };

        var credential = AzureCredentialFactory.Create(config);

        Assert.IsType<OneSignInAtATime>(credential);
    }

    [Fact]
    public void IsValid_InteractiveBrowser_with_FQNS_returns_true()
    {
        var config = new AzureConnectionConfig
        {
            Name = "ib",
            AuthType = AzureAuthType.InteractiveBrowser,
            FullyQualifiedNamespace = "fake.servicebus.windows.net"
        };

        Assert.True(config.IsValid());
    }

    [Fact]
    public void IsValid_InteractiveBrowser_without_FQNS_returns_false()
    {
        var config = new AzureConnectionConfig
        {
            Name = "ib",
            AuthType = AzureAuthType.InteractiveBrowser,
            FullyQualifiedNamespace = string.Empty
        };

        Assert.False(config.IsValid());
    }

    [Fact]
    public void Create_ConnectionString_throws_InvalidOperationException()
    {
        var config = new AzureConnectionConfig
        {
            Name = "cs",
            AuthType = AzureAuthType.ConnectionString,
            ConnectionString = "Endpoint=sb://x.servicebus.windows.net/;SharedAccessKeyName=k;SharedAccessKey=v"
        };

        Assert.Throws<InvalidOperationException>(() => AzureCredentialFactory.Create(config));
    }

    [Theory]
    [InlineData(AzureAuthType.InteractiveBrowser, typeof(OneSignInAtATime))]
    [InlineData(AzureAuthType.AzureCli, typeof(AzureCliCredential))]
    public void ForDirectory_builds_the_credential_of_sign_in_with_Microsoft_or_the_Azure_CLI_from_the_auth_type_and_tenant_only(AzureAuthType authType, Type expected)
    {
        var credential = AzureCredentialFactory.ForDirectory(authType, "11111111-1111-1111-1111-111111111111");

        Assert.IsType(expected, credential);
    }

    [Theory]
    [InlineData(AzureAuthType.ServicePrincipal)]
    [InlineData(AzureAuthType.DefaultCredential)]
    [InlineData(AzureAuthType.ConnectionString)]
    public void ForDirectory_refuses_every_other_auth_type(AzureAuthType authType)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => AzureCredentialFactory.ForDirectory(authType, null));
    }

    private static AzureConnectionConfig SignedInConnection(string? tenantId) => new()
    {
        Name = "shared", AuthType = AzureAuthType.InteractiveBrowser, FullyQualifiedNamespace = "fake.servicebus.windows.net", TenantId = tenantId
    };

    [Fact]
    public void Sign_in_with_Microsoft_is_one_credential_per_tenant_shared_by_the_directory_and_every_connection_so_the_browser_opens_once()
    {
        const string tenant = "22222222-2222-2222-2222-222222222222";
        var fromTheDirectory = AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, tenant);

        Assert.Same(fromTheDirectory, AzureCredentialFactory.Create(SignedInConnection(tenant)));
        Assert.Same(fromTheDirectory, AzureCredentialFactory.Create(SignedInConnection($"  {tenant.ToUpperInvariant()} ")));
        Assert.Same(AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, null), AzureCredentialFactory.Create(SignedInConnection("")));
        Assert.NotSame(fromTheDirectory, AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, null));
        Assert.NotSame(fromTheDirectory, AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, "33333333-3333-3333-3333-333333333333"));
    }

    [Fact]
    public void Forgetting_the_sign_ins_makes_the_next_one_a_new_credential_so_another_account_can_sign_in()
    {
        var before = AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, "44444444-4444-4444-4444-444444444444");

        AzureCredentialFactory.ForgetSignIns();

        Assert.NotSame(before, AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, "44444444-4444-4444-4444-444444444444"));
    }

    private sealed class SlowCredential : global::Azure.Core.TokenCredential
    {
        private int _running;
        public int MostAtOnce;
        public int Calls;

        public override global::Azure.Core.AccessToken GetToken(global::Azure.Core.TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            GetTokenAsync(requestContext, cancellationToken).AsTask().GetAwaiter().GetResult();

        public override async ValueTask<global::Azure.Core.AccessToken> GetTokenAsync(global::Azure.Core.TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            MostAtOnce = Math.Max(MostAtOnce, Interlocked.Increment(ref _running));
            Interlocked.Increment(ref Calls);
            await Task.Delay(20, cancellationToken);
            Interlocked.Decrement(ref _running);
            if (requestContext.Scopes[0] == "fails") throw new InvalidOperationException("refused");
            return new global::Azure.Core.AccessToken(requestContext.Scopes[0], DateTimeOffset.MaxValue);
        }
    }

    [Fact]
    public async Task Tokens_asked_at_the_same_moment_reach_the_sign_in_one_at_a_time_so_two_clients_never_open_two_browsers()
    {
        var inner = new SlowCredential();
        var shared = new OneSignInAtATime(inner);

        var tokens = await Task.WhenAll(Enumerable.Range(0, 8).Select(i =>
            shared.GetTokenAsync(new global::Azure.Core.TokenRequestContext([$"scope-{i}"]), CancellationToken.None).AsTask()));

        Assert.Equal(1, inner.MostAtOnce);
        Assert.Equal(Enumerable.Range(0, 8).Select(i => $"scope-{i}"), tokens.Select(t => t.Token));
        Assert.Equal("sync", shared.GetToken(new global::Azure.Core.TokenRequestContext(["sync"]), CancellationToken.None).Token);
    }

    [Fact]
    public async Task A_sign_in_that_fails_or_is_cancelled_frees_the_way_for_the_next_one()
    {
        var shared = new OneSignInAtATime(new SlowCredential());
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        await Assert.ThrowsAsync<InvalidOperationException>(() => shared.GetTokenAsync(new global::Azure.Core.TokenRequestContext(["fails"]), CancellationToken.None).AsTask());
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => shared.GetTokenAsync(new global::Azure.Core.TokenRequestContext(["x"]), cancelled.Token).AsTask());

        Assert.Equal("after", (await shared.GetTokenAsync(new global::Azure.Core.TokenRequestContext(["after"]), CancellationToken.None)).Token);
    }

    private sealed class NeverAnswers : global::Azure.Core.TokenCredential
    {
        public override global::Azure.Core.AccessToken GetToken(global::Azure.Core.TokenRequestContext requestContext, CancellationToken cancellationToken) => throw new NotSupportedException();

        public override async ValueTask<global::Azure.Core.AccessToken> GetTokenAsync(global::Azure.Core.TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            if (requestContext.Scopes[0] == "after") return new global::Azure.Core.AccessToken("after", DateTimeOffset.MaxValue);
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new InvalidOperationException();
        }
    }

    [Fact]
    public async Task A_sign_in_nobody_completes_is_given_up_after_its_limit_as_a_failed_sign_in_and_the_next_request_goes_through()
    {
        var shared = new OneSignInAtATime(new NeverAnswers(), TimeSpan.FromMilliseconds(50));

        var abandoned = shared.GetTokenAsync(new global::Azure.Core.TokenRequestContext(["x"]), CancellationToken.None).AsTask();
        var waiting = shared.GetTokenAsync(new global::Azure.Core.TokenRequestContext(["after"]), CancellationToken.None).AsTask();

        var failure = await Assert.ThrowsAsync<AuthenticationFailedException>(() => abandoned);
        Assert.Equal("The sign-in was not completed in time.", failure.Message);
        Assert.Equal("after", (await waiting).Token);
    }

    [Fact]
    public void A_sign_in_the_directory_completed_becomes_the_shared_one_of_the_tenant_it_signed_into_and_a_credential_that_is_not_a_shared_sign_in_does_not()
    {
        const string tenant = "66666666-6666-6666-6666-666666666666";
        var withoutTenant = AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, null);

        AzureCredentialFactory.ShareSignIn(tenant, new SlowCredential());
        Assert.NotSame(withoutTenant, AzureCredentialFactory.Create(SignedInConnection(tenant)));

        AzureCredentialFactory.ShareSignIn(tenant.ToUpperInvariant(), withoutTenant);
        Assert.Same(withoutTenant, AzureCredentialFactory.Create(SignedInConnection(tenant)));
    }
}
