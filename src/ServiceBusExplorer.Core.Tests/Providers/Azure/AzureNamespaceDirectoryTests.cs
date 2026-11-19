using System.Net;
using System.Text;
using System.Text.Json;
using Azure.Core;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The Azure Resource Manager reader behind "sign in, then pick": the subscriptions of the signed-in account and the
/// Service Bus namespaces of one subscription, read with a fake credential and a fake handler; nothing leaves the machine.
/// </summary>
[Collection("the shared sign-in")]
public class AzureNamespaceDirectoryTests
{
    private const string SubscriptionId = "00000000-0000-0000-0000-00000000000a";
    private const string Signature = "SENTINEL-SIGNATURE-7f3e";

    /// <summary>A token in the shape Entra ID issues: a header, the claims and a signature, base64url-encoded.</summary>
    internal static string Jwt(object claims) =>
        string.Join('.', Base64Url("{\"alg\":\"none\"}"), Base64Url(JsonSerializer.Serialize(claims)), Signature);

    private static string Base64Url(string text) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(text)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static readonly string Token = Jwt(new { preferred_username = "ana@contoso.example", tid = "00000000-0000-0000-0000-0000000000c1" });

    internal sealed class FakeCredential(Func<TokenRequestContext, CancellationToken, string> issue) : TokenCredential
    {
        public List<TokenRequestContext> Requests { get; } = [];

        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            GetTokenAsync(requestContext, cancellationToken).AsTask().GetAwaiter().GetResult();

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            Requests.Add(requestContext);
            return ValueTask.FromResult(new AccessToken(issue(requestContext, cancellationToken), DateTimeOffset.UtcNow.AddHours(1)));
        }
    }

    internal sealed class FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> answer) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return answer(request, cancellationToken);
        }
    }

    internal static HttpResponseMessage Json(object body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    private static FakeHandler Answer(Func<HttpRequestMessage, HttpResponseMessage> answer) =>
        new((request, _) => Task.FromResult(answer(request)));

    private static AzureNamespaceDirectory Directory(FakeHandler handler, TimeSpan? timeout = null) =>
        new(handler, timeout: timeout);

    private static FakeCredential Credential() => new((_, _) => Token);

    private static object Namespace(string name, string group, string tier, string? endpoint) => new
    {
        id = $"/subscriptions/{SubscriptionId}/resourceGroups/{group}/providers/Microsoft.ServiceBus/namespaces/{name}",
        name,
        sku = new { name = tier },
        properties = endpoint == null ? (object)new { } : new { serviceBusEndpoint = endpoint }
    };

    [Fact]
    public async Task The_subscriptions_are_read_from_Resource_Manager_with_a_token_for_its_scope_and_answer_id_and_display_name()
    {
        var handler = Answer(_ => Json(new { value = new[] { new { subscriptionId = SubscriptionId, displayName = "Contoso Production" } } }));
        var credential = Credential();

        var subscriptions = await Directory(handler).ListSubscriptionsAsync(credential, CancellationToken.None);

        Assert.Equal([new AzureSubscription(SubscriptionId, "Contoso Production")], subscriptions);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://management.azure.com/subscriptions?api-version=2022-12-01", request.RequestUri!.ToString());
        Assert.Equal(("Bearer", Token), (request.Headers.Authorization!.Scheme, request.Headers.Authorization.Parameter));
        Assert.True(credential.Requests.All(r => r.Scopes.SequenceEqual(["https://management.azure.com/.default"])),
            "The token is asked for the Resource Manager scope only");
    }

    [Fact]
    public async Task The_namespaces_of_a_subscription_answer_name_host_resource_group_tier_and_resource_id()
    {
        var handler = Answer(_ => Json(new
        {
            value = new[]
            {
                Namespace("contoso-prod", "rg-messaging", "Premium", "https://contoso-prod.servicebus.windows.net:443/"),
                Namespace("contoso-billing", "rg-billing", "Standard", null)
            }
        }));

        var namespaces = await Directory(handler).ListNamespacesAsync(Credential(), SubscriptionId, CancellationToken.None);

        Assert.Equal(
            [
                new AzureNamespace("contoso-prod", "contoso-prod.servicebus.windows.net", "rg-messaging", "Premium",
                    $"/subscriptions/{SubscriptionId}/resourceGroups/rg-messaging/providers/Microsoft.ServiceBus/namespaces/contoso-prod"),
                new AzureNamespace("contoso-billing", "contoso-billing.servicebus.windows.net", "rg-billing", "Standard",
                    $"/subscriptions/{SubscriptionId}/resourceGroups/rg-billing/providers/Microsoft.ServiceBus/namespaces/contoso-billing")
            ],
            namespaces);
        Assert.Equal(
            $"https://management.azure.com/subscriptions/{SubscriptionId}/providers/Microsoft.ServiceBus/namespaces?api-version=2021-11-01",
            Assert.Single(handler.Requests).RequestUri!.ToString());
    }

    [Theory]
    [InlineData("not-a-guid")]
    [InlineData("../tenants")]
    [InlineData("")]
    public async Task A_subscription_id_that_is_not_a_GUID_is_refused_before_any_request(string subscriptionId)
    {
        var handler = Answer(_ => Json(new { value = Array.Empty<object>() }));

        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() =>
            Directory(handler).ListNamespacesAsync(Credential(), subscriptionId, CancellationToken.None));

        Assert.Equal(AzureDirectoryFailure.InvalidSubscription, failure.Reason);
        Assert.True(handler.Requests.Count == 0, "A subscription ID that is not a GUID never reaches Resource Manager");
    }

    [Fact]
    public async Task A_next_link_on_Resource_Manager_is_followed_and_the_pages_are_joined()
    {
        var next = "https://management.azure.com/subscriptions?api-version=2022-12-01&%24skiptoken=page2";
        var handler = Answer(request => request.RequestUri!.AbsoluteUri == next
            ? Json(new { value = new[] { new { subscriptionId = "00000000-0000-0000-0000-00000000000b", displayName = "Two" } } })
            : Json(new { value = new[] { new { subscriptionId = SubscriptionId, displayName = "One" } }, nextLink = next }));

        var subscriptions = await Directory(handler).ListSubscriptionsAsync(Credential(), CancellationToken.None);

        Assert.Equal(["One", "Two"], subscriptions.Select(s => s.DisplayName));
        Assert.Equal(2, handler.Requests.Count);
    }

    [Theory]
    [InlineData("https://attacker.contoso.example/subscriptions?page=2")]
    [InlineData("http://management.azure.com/subscriptions?page=2")]
    [InlineData("https://management.azure.com.contoso.example/subscriptions?page=2")]
    public async Task A_next_link_to_another_host_or_without_https_is_not_followed_so_the_token_never_leaves_for_it(string nextLink)
    {
        var handler = Answer(_ => Json(new { value = new[] { new { subscriptionId = SubscriptionId, displayName = "One" } }, nextLink }));

        var subscriptions = await Directory(handler).ListSubscriptionsAsync(Credential(), CancellationToken.None);

        Assert.Single(subscriptions);
        Assert.True(handler.Requests.Count == 1, $"The next link {nextLink} must not be requested: it would carry the token to a host that is not Resource Manager");
    }

    [Fact]
    public async Task A_list_longer_than_ten_pages_is_a_failure_that_says_so_never_a_shorter_list_shown_as_whole()
    {
        var page = 0;
        var handler = Answer(_ => Json(new
        {
            value = new[] { new { subscriptionId = $"00000000-0000-0000-0000-{++page:D12}", displayName = $"S{page}" } },
            nextLink = $"https://management.azure.com/subscriptions?api-version=2022-12-01&page={page + 1}"
        }));

        var error = await Assert.ThrowsAsync<AzureDirectoryException>(() => Directory(handler).ListSubscriptionsAsync(Credential(), CancellationToken.None));

        Assert.Equal((AzureDirectoryFailure.TooMany, "Azure holds more than this app lists (10 pages, 1000 items). Type the namespace instead."), (error.Reason, error.Message));
        Assert.Equal(10, handler.Requests.Count);
    }

    [Fact]
    public async Task A_list_longer_than_one_thousand_items_is_a_failure_that_says_so()
    {
        var handler = Answer(_ => Json(new
        {
            value = Enumerable.Range(0, 600).Select(i => new { subscriptionId = $"00000000-0000-0000-0000-{i:D12}", displayName = $"S{i}" }),
            nextLink = "https://management.azure.com/subscriptions?api-version=2022-12-01&page=next"
        }));

        var error = await Assert.ThrowsAsync<AzureDirectoryException>(() => Directory(handler).ListSubscriptionsAsync(Credential(), CancellationToken.None));

        Assert.Equal(AzureDirectoryFailure.TooMany, error.Reason);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task A_redirect_from_Resource_Manager_is_a_failure_and_its_location_is_never_requested()
    {
        var handler = Answer(_ =>
        {
            var redirect = new HttpResponseMessage(HttpStatusCode.Found);
            redirect.Headers.Location = new Uri("https://elsewhere.example/steal");
            return redirect;
        });

        var error = await Assert.ThrowsAsync<AzureDirectoryException>(() => Directory(handler).ListSubscriptionsAsync(Credential(), CancellationToken.None));

        Assert.Equal((AzureDirectoryFailure.Failed, "Azure answered 302."), (error.Reason, error.Message));
        Assert.Equal(["management.azure.com"], handler.Requests.Select(r => r.RequestUri!.Host));
        Assert.False(AzureNamespaceDirectory.NetworkHandler().AllowAutoRedirect, "The handler that reaches the network must not follow a redirect by itself.");
    }

    [Fact]
    public async Task Sign_in_answers_the_default_domain_of_the_tenant_and_an_empty_one_when_Azure_does_not_list_it()
    {
        var listed = Answer(_ => Json(new { value = new[] { new { tenantId = "00000000-0000-0000-0000-0000000000c1", defaultDomain = "contoso.onmicrosoft.com" } } }));
        var refused = Answer(_ => Json(new { }, HttpStatusCode.Forbidden));

        var named = await new AzureNamespaceDirectory(listed, (_, _) => Credential()).SignInAsync(AzureAuthType.AzureCli, null, CancellationToken.None);
        var unnamed = await new AzureNamespaceDirectory(refused, (_, _) => Credential()).SignInAsync(AzureAuthType.AzureCli, null, CancellationToken.None);

        Assert.Equal("contoso.onmicrosoft.com", named.TenantDomain);
        Assert.Equal("/tenants", listed.Requests.Single().RequestUri!.AbsolutePath);
        Assert.Equal(("ana@contoso.example", ""), (unnamed.Account, unnamed.TenantDomain));
    }

    private sealed class WaitingCredential : TokenCredential
    {
        public TaskCompletionSource<string> Answer { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) => throw new NotSupportedException();

        public override async ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new(await Answer.Task.WaitAsync(cancellationToken), DateTimeOffset.UtcNow.AddHours(1));
    }

    [Fact]
    public async Task A_sign_in_that_completes_after_a_sign_out_keeps_no_session()
    {
        var waiting = new WaitingCredential();
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { value = Array.Empty<object>() })), (_, _) => waiting);
        var signIn = directory.SignInAsync(AzureAuthType.InteractiveBrowser, null, CancellationToken.None);

        directory.SignOut();
        waiting.Answer.SetResult(Token);

        var error = await Assert.ThrowsAsync<AzureDirectoryException>(() => signIn);
        Assert.Equal((AzureDirectoryFailure.SignIn, "The sign-in was left before it completed. Nothing was read from Azure."), (error.Reason, error.Message));
        Assert.Null(directory.Account);
    }

    [Fact]
    public async Task A_sign_in_nobody_completes_gives_up_after_its_own_timeout_and_keeps_no_session()
    {
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { })), (_, _) => new WaitingCredential(), signInTimeout: TimeSpan.FromMilliseconds(50));

        var error = await Assert.ThrowsAsync<AzureDirectoryException>(() => directory.SignInAsync(AzureAuthType.InteractiveBrowser, null, CancellationToken.None));

        Assert.Equal((AzureDirectoryFailure.Timeout, "The sign-in was not completed in time. Start it again."), (error.Reason, error.Message));
        Assert.Null(directory.Account);
    }

    [Theory]
    [InlineData("not a tenant")]
    [InlineData("contoso.example/../evil")]
    [InlineData("https://login.example")]
    public async Task A_tenant_that_is_neither_an_id_nor_a_domain_is_refused_before_a_credential_is_built(string tenant)
    {
        var built = false;
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { })), (_, _) => { built = true; return Credential(); });

        var error = await Assert.ThrowsAsync<AzureDirectoryException>(() => directory.SignInAsync(AzureAuthType.InteractiveBrowser, tenant, CancellationToken.None));

        Assert.Equal((AzureDirectoryFailure.InvalidTenant, "The tenant is an ID or a domain, such as contoso.onmicrosoft.com."), (error.Reason, error.Message));
        Assert.False(built);
    }

    [Theory]
    [InlineData("00000000-0000-0000-0000-0000000000c1")]
    [InlineData(" contoso.onmicrosoft.com ")]
    public async Task A_tenant_given_as_an_id_or_a_domain_signs_in(string tenant)
    {
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { })), (_, _) => Credential());

        Assert.Equal("ana@contoso.example", (await directory.SignInAsync(AzureAuthType.InteractiveBrowser, tenant, CancellationToken.None)).Account);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, AzureDirectoryFailure.Forbidden, "Your account may not read this subscription (403).")]
    [InlineData(HttpStatusCode.Unauthorized, AzureDirectoryFailure.Forbidden, "Your account may not read this subscription (401).")]
    [InlineData(HttpStatusCode.InternalServerError, AzureDirectoryFailure.Failed, "Azure answered 500.")]
    public async Task A_status_that_is_not_success_becomes_the_neutral_failure_without_the_token(HttpStatusCode status, AzureDirectoryFailure reason, string message)
    {
        var handler = Answer(_ => Json(new { error = new { code = "AuthorizationFailed", message = Token } }, status));

        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() =>
            Directory(handler).ListNamespacesAsync(Credential(), SubscriptionId, CancellationToken.None));

        Assert.Equal((reason, message), (failure.Reason, failure.Message));
        Assert.DoesNotContain(Signature, failure.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_body_that_is_not_JSON_becomes_the_bad_answer_failure()
    {
        var handler = Answer(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>gateway</html>") });

        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() =>
            Directory(handler).ListSubscriptionsAsync(Credential(), CancellationToken.None));

        Assert.Equal((AzureDirectoryFailure.BadAnswer, "Azure answered with something that is not a list this app can read."), (failure.Reason, failure.Message));
    }

    [Fact]
    public async Task A_JSON_body_without_a_value_list_becomes_the_bad_answer_failure()
    {
        var handler = Answer(_ => Json(new { value = "nope" }));

        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() =>
            Directory(handler).ListSubscriptionsAsync(Credential(), CancellationToken.None));

        Assert.Equal(AzureDirectoryFailure.BadAnswer, failure.Reason);
    }

    [Fact]
    public async Task Resource_Manager_that_does_not_answer_in_time_becomes_the_timeout_failure()
    {
        var handler = new FakeHandler(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return Json(new { });
        });

        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() =>
            Directory(handler, TimeSpan.FromMilliseconds(50)).ListSubscriptionsAsync(Credential(), CancellationToken.None));

        Assert.Equal((AzureDirectoryFailure.Timeout, "Azure did not answer within 30 seconds."), (failure.Reason, failure.Message));
    }

    [Fact]
    public async Task Resource_Manager_that_cannot_be_reached_becomes_the_network_failure()
    {
        var handler = new FakeHandler((_, _) => throw new HttpRequestException("Connection refused " + Token));

        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() =>
            Directory(handler).ListSubscriptionsAsync(Credential(), CancellationToken.None));

        Assert.Equal(AzureDirectoryFailure.Network, failure.Reason);
        Assert.DoesNotContain(Signature, failure.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_callers_cancellation_stops_the_read_and_is_not_reported_as_a_timeout()
    {
        using var cancel = new CancellationTokenSource();
        var handler = new FakeHandler(async (_, ct) =>
        {
            cancel.Cancel();
            await Task.Delay(Timeout.Infinite, ct);
            return Json(new { });
        });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Directory(handler).ListSubscriptionsAsync(Credential(), cancel.Token));
    }

    [Fact]
    public async Task Sign_in_asks_a_token_for_Resource_Manager_and_answers_the_account_and_tenant_of_its_claims()
    {
        var credential = Credential();
        (AzureAuthType, string?)? asked = null;
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { value = Array.Empty<object>() })),
            (auth, tenant) => { asked = (auth, tenant); return credential; });

        var account = await directory.SignInAsync(AzureAuthType.InteractiveBrowser, "00000000-0000-0000-0000-0000000000c1", CancellationToken.None);

        Assert.Equal(new AzureDirectoryAccount("ana@contoso.example", "00000000-0000-0000-0000-0000000000c1"), account);
        Assert.Equal((AzureAuthType.InteractiveBrowser, "00000000-0000-0000-0000-0000000000c1"), asked);
        Assert.Equal(2, credential.Requests.Count);
        Assert.All(credential.Requests, asked => Assert.Equal(["https://management.azure.com/.default"], asked.Scopes));
        Assert.Equal(account, directory.Account);
    }

    [Theory]
    [InlineData("upn")]
    [InlineData("unique_name")]
    public async Task Sign_in_reads_the_account_from_upn_or_unique_name_when_preferred_username_is_absent(string claim)
    {
        var token = Jwt(new Dictionary<string, string> { [claim] = "ana@contoso.example", ["tid"] = "t-1" });
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { })), (_, _) => new FakeCredential((_, _) => token));

        var account = await directory.SignInAsync(AzureAuthType.AzureCli, null, CancellationToken.None);

        Assert.Equal(new AzureDirectoryAccount("ana@contoso.example", "t-1"), account);
    }

    [Theory]
    [InlineData(AzureAuthType.ServicePrincipal)]
    [InlineData(AzureAuthType.DefaultCredential)]
    [InlineData(AzureAuthType.ConnectionString)]
    public async Task Sign_in_with_any_other_authentication_is_refused_before_a_credential_is_built(AzureAuthType authType)
    {
        var built = false;
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { })), (_, _) => { built = true; return Credential(); });

        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() => directory.SignInAsync(authType, null, CancellationToken.None));

        Assert.Equal(AzureDirectoryFailure.UnsupportedAuthentication, failure.Reason);
        Assert.False(built, "No credential is built for an authentication the directory does not offer");
    }

    [Theory]
    [InlineData(AzureAuthType.InteractiveBrowser, AzureDirectoryFailure.SignIn, "The sign-in did not complete. Nothing was read from Azure.")]
    [InlineData(AzureAuthType.AzureCli, AzureDirectoryFailure.CliSession, "No Azure CLI session answered. Run az login in a terminal, then Check again.")]
    public async Task A_sign_in_that_throws_becomes_the_neutral_failure_and_keeps_no_session(AzureAuthType authType, AzureDirectoryFailure reason, string message)
    {
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { })),
            (_, _) => new FakeCredential((_, _) => throw new InvalidOperationException("credential failed with " + Token)));

        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() => directory.SignInAsync(authType, null, CancellationToken.None));

        Assert.Equal((reason, message), (failure.Reason, failure.Message));
        Assert.DoesNotContain(Signature, failure.ToString(), StringComparison.Ordinal);
        Assert.Null(directory.Account);
    }

    [Fact]
    public async Task The_session_lists_with_the_credential_of_the_last_sign_in_and_sign_out_drops_it()
    {
        var first = new FakeCredential((_, _) => Jwt(new { preferred_username = "first@contoso.example", tid = "t" }));
        var second = new FakeCredential((_, _) => Jwt(new { preferred_username = "second@contoso.example", tid = "t" }));
        var credentials = new Queue<FakeCredential>([first, second]);
        var handler = Answer(_ => Json(new { value = Array.Empty<object>() }));
        var directory = new AzureNamespaceDirectory(handler, (_, _) => credentials.Dequeue());

        await directory.SignInAsync(AzureAuthType.InteractiveBrowser, null, CancellationToken.None);
        await directory.SignInAsync(AzureAuthType.AzureCli, null, CancellationToken.None);
        await directory.ListSubscriptionsAsync(CancellationToken.None);
        await directory.ListNamespacesAsync(SubscriptionId, CancellationToken.None);

        Assert.True(first.Requests.Count == 2 && second.Requests.Count == 4, $"A new sign-in replaces the session; each sign-in asks its credential twice (the token, then the tenant's domain) and the two lists ask the second: {first.Requests.Count} and {second.Requests.Count}");

        directory.SignOut();

        Assert.Null(directory.Account);
        var failure = await Assert.ThrowsAsync<AzureDirectoryException>(() => directory.ListSubscriptionsAsync(CancellationToken.None));
        Assert.Equal(AzureDirectoryFailure.NotSignedIn, failure.Reason);
        await Assert.ThrowsAsync<AzureDirectoryException>(() => directory.ListNamespacesAsync(SubscriptionId, CancellationToken.None));
        Assert.True(handler.Requests.Count == 4, $"After sign-out nothing reaches Resource Manager: two tenant reads and two lists were made before it, {handler.Requests.Count} in all");
    }

    [Fact]
    public void Signing_out_of_the_directory_forgets_the_shared_sign_in_so_another_account_can_be_chosen()
    {
        var before = AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, "55555555-5555-5555-5555-555555555555");

        new AzureNamespaceDirectory(Answer(_ => Json(new { value = Array.Empty<object>() }))).SignOut();

        Assert.NotSame(before, AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, "55555555-5555-5555-5555-555555555555"));
    }

    [Fact]
    public async Task A_sign_in_with_Microsoft_that_completes_is_shared_under_the_tenant_of_the_account_so_the_connections_saved_with_it_do_not_sign_in_again()
    {
        const string tenant = "77777777-7777-7777-7777-777777777777";
        var signedIn = new OneSignInAtATime(new FakeCredential((_, _) => Jwt(new { preferred_username = "ana@contoso.example", tid = tenant })));
        var directory = new AzureNamespaceDirectory(Answer(_ => Json(new { value = Array.Empty<object>() })), (_, _) => signedIn);

        await directory.SignInAsync(AzureAuthType.InteractiveBrowser, null, CancellationToken.None);

        Assert.Same(signedIn, AzureCredentialFactory.ForDirectory(AzureAuthType.InteractiveBrowser, tenant));
    }
}
