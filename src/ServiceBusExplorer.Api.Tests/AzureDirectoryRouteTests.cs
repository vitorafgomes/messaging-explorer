using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Azure.Core;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// <c>api/azure-directory</c>: sign in, list the subscriptions, list the namespaces of one, sign out. The directory is
/// the real one, with a fake credential that issues a sentinel token and a fake handler in place of Resource Manager;
/// nothing leaves the machine. The token never appears in a response body or a log entry.
/// </summary>
public class AzureDirectoryRouteTests
{
    private const string SubscriptionId = "00000000-0000-0000-0000-00000000000a";
    private const string Signature = "SENTINEL-SIGNATURE-c0ffee";
    private static readonly string Token = Jwt(new { preferred_username = "ana@contoso.example", tid = "00000000-0000-0000-0000-0000000000c1" });

    private static string Jwt(object claims)
    {
        static string Encode(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return string.Join('.', Encode("{\"alg\":\"none\"}"), Encode(JsonSerializer.Serialize(claims)), Signature);
    }

    private sealed class FakeCredential(Func<string> issue) : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new(issue(), DateTimeOffset.UtcNow.AddHours(1));

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            ValueTask.FromResult(GetToken(requestContext, cancellationToken));
    }

    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public List<string> Authorizations { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (!request.RequestUri!.AbsolutePath.EndsWith("/tenants", StringComparison.Ordinal)) Authorizations.Add(request.Headers.Authorization?.ToString() ?? "");
            return Task.FromResult(answer(request));
        }
    }

    private sealed class CaptureProvider : ILoggerProvider
    {
        public ConcurrentQueue<string> Entries { get; } = new();

        public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, Entries);

        public void Dispose()
        {
        }

        private sealed class CaptureLogger(string category, ConcurrentQueue<string> entries) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var text = new StringBuilder(category).Append(": ").Append(formatter(state, exception));
                if (state is IEnumerable<KeyValuePair<string, object?>> pairs)
                {
                    foreach (var pair in pairs) text.Append('\n').Append(pair.Key).Append('=').Append(pair.Value);
                }
                for (var e = exception; e != null; e = e.InnerException) text.Append('\n').Append(e);
                entries.Enqueue(text.ToString());
            }
        }
    }

    private static HttpResponseMessage Json(object body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Arm(HttpRequestMessage request) => request.RequestUri!.AbsolutePath.EndsWith("/namespaces", StringComparison.Ordinal)
        ? Json(new
        {
            value = new[]
            {
                new
                {
                    id = $"/subscriptions/{SubscriptionId}/resourceGroups/rg-messaging/providers/Microsoft.ServiceBus/namespaces/contoso-prod",
                    name = "contoso-prod",
                    sku = new { name = "Premium" },
                    properties = new { serviceBusEndpoint = "https://contoso-prod.servicebus.windows.net:443/" }
                }
            }
        })
        : Json(new { value = new[] { new { subscriptionId = SubscriptionId, displayName = "Contoso Production" } } });

    private sealed record Call(HttpStatusCode Status, JsonElement Body, string Raw);

    private sealed class Harness : IDisposable
    {
        private readonly ApiFactory _base = new();
        private readonly WebApplicationFactory<Program> _factory;

        public Harness(Func<HttpRequestMessage, HttpResponseMessage> arm, Func<string>? issue = null, bool withKey = true)
        {
            Handler = new FakeHandler(arm);
            TokenCredential CredentialFor(AzureAuthType auth, string? tenant)
            {
                CredentialsAsked.Add((auth, tenant));
                return new FakeCredential(issue ?? (() => Token));
            }

            _factory = _base.WithWebHostBuilder(b =>
            {
                b.ConfigureTestServices(s => s.AddSingleton(sp =>
                    new AzureNamespaceDirectory(Handler, CredentialFor, logger: sp.GetRequiredService<ILogger<AzureNamespaceDirectory>>())));
                b.ConfigureLogging(l =>
                {
                    l.AddProvider(Logs);
                    l.AddFilter<CaptureProvider>(null, LogLevel.Trace);
                });
            });
            Client = _factory.CreateClient();
            if (withKey) Client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        }

        public FakeHandler Handler { get; }
        public HttpClient Client { get; }
        public CaptureProvider Logs { get; } = new();
        public List<(AzureAuthType, string?)> CredentialsAsked { get; } = [];
        public List<Call> Calls { get; } = [];

        public async Task<Call> SendAsync(HttpMethod method, string path, object? body = null)
        {
            using var request = new HttpRequestMessage(method, path) { Content = body == null ? null : JsonContent.Create(body) };
            using var response = await Client.SendAsync(request);
            var raw = await response.Content.ReadAsStringAsync();
            var call = new Call(response.StatusCode, raw.Length == 0 ? default : JsonDocument.Parse(raw).RootElement.Clone(), raw);
            Calls.Add(call);
            return call;
        }

        public Task<Call> SignInAsync(string authType = "InteractiveBrowser", string? tenantId = null) =>
            SendAsync(HttpMethod.Post, "/api/azure-directory/sign-in", new { authType, tenantId });

        public void Dispose()
        {
            Client.Dispose();
            _factory.Dispose();
            _base.Dispose();
        }
    }

    [Theory]
    [InlineData("POST", "/api/azure-directory/sign-in")]
    [InlineData("GET", "/api/azure-directory/subscriptions")]
    [InlineData("GET", "/api/azure-directory/subscriptions/" + SubscriptionId + "/namespaces")]
    [InlineData("POST", "/api/azure-directory/sign-out")]
    public async Task Every_directory_route_without_the_api_key_answers_401_and_reaches_no_credential(string method, string path)
    {
        using var harness = new Harness(Arm, withKey: false);

        var call = await harness.SendAsync(new HttpMethod(method), path, method == "POST" ? new { authType = "AzureCli" } : null);

        Assert.Equal(HttpStatusCode.Unauthorized, call.Status);
        Assert.True(harness.CredentialsAsked.Count == 0 && harness.Handler.Authorizations.Count == 0,
            "A request without the key never signs in and never reaches Resource Manager");
    }

    [Fact]
    public async Task Sign_in_answers_the_account_and_tenant_of_the_token_and_never_the_token()
    {
        using var harness = new Harness(Arm);

        var call = await harness.SignInAsync("InteractiveBrowser", "00000000-0000-0000-0000-0000000000c1");

        Assert.Equal(HttpStatusCode.OK, call.Status);
        Assert.Equal(("ana@contoso.example", "00000000-0000-0000-0000-0000000000c1"),
            (call.Body.GetProperty("account").GetString(), call.Body.GetProperty("tenantId").GetString()));
        Assert.Equal([(AzureAuthType.InteractiveBrowser, "00000000-0000-0000-0000-0000000000c1")], harness.CredentialsAsked);
        Assert.DoesNotContain(Signature, call.Raw, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("ServicePrincipal")]
    [InlineData("DefaultCredential")]
    [InlineData("ConnectionString")]
    public async Task Sign_in_with_another_authentication_answers_400_with_a_sentence_and_builds_no_credential(string authType)
    {
        using var harness = new Harness(Arm);

        var call = await harness.SignInAsync(authType);

        Assert.Equal(HttpStatusCode.BadRequest, call.Status);
        Assert.Equal("The namespaces are listed after a sign-in with Microsoft or with the Azure CLI session only.", call.Body.GetProperty("message").GetString());
        Assert.Empty(harness.CredentialsAsked);
    }

    [Fact]
    public async Task A_sign_in_that_fails_answers_400_with_a_sentence_and_the_lists_stay_refused()
    {
        using var harness = new Harness(Arm, issue: () => throw new InvalidOperationException("az failed " + Token));

        var signIn = await harness.SignInAsync("AzureCli");
        var subscriptions = await harness.SendAsync(HttpMethod.Get, "/api/azure-directory/subscriptions");

        Assert.Equal(HttpStatusCode.BadRequest, signIn.Status);
        Assert.Equal(("cli-session", "No Azure CLI session answered. Run az login in a terminal, then Check again."),
            (signIn.Body.GetProperty("code").GetString(), signIn.Body.GetProperty("message").GetString()));
        Assert.Equal(HttpStatusCode.Conflict, subscriptions.Status);
    }

    [Theory]
    [InlineData("/api/azure-directory/subscriptions")]
    [InlineData("/api/azure-directory/subscriptions/" + SubscriptionId + "/namespaces")]
    public async Task A_list_without_a_sign_in_answers_409_with_a_sentence_and_reaches_no_Resource_Manager(string path)
    {
        using var harness = new Harness(Arm);

        var call = await harness.SendAsync(HttpMethod.Get, path);

        Assert.Equal(HttpStatusCode.Conflict, call.Status);
        Assert.Equal(("not-signed-in", "Sign in first: no Azure account is signed in."),
            (call.Body.GetProperty("code").GetString(), call.Body.GetProperty("message").GetString()));
        Assert.Empty(harness.Handler.Authorizations);
    }

    [Fact]
    public async Task After_a_sign_in_the_subscriptions_and_the_namespaces_are_listed_and_sign_out_drops_the_session()
    {
        using var harness = new Harness(Arm);
        await harness.SignInAsync();

        var subscriptions = await harness.SendAsync(HttpMethod.Get, "/api/azure-directory/subscriptions");
        var namespaces = await harness.SendAsync(HttpMethod.Get, $"/api/azure-directory/subscriptions/{SubscriptionId}/namespaces");
        var signOut = await harness.SendAsync(HttpMethod.Post, "/api/azure-directory/sign-out");
        var afterSignOut = await harness.SendAsync(HttpMethod.Get, "/api/azure-directory/subscriptions");

        Assert.Equal(HttpStatusCode.OK, subscriptions.Status);
        var subscription = Assert.Single(subscriptions.Body.EnumerateArray());
        Assert.Equal((SubscriptionId, "Contoso Production"), (subscription.GetProperty("id").GetString(), subscription.GetProperty("displayName").GetString()));
        Assert.Equal(HttpStatusCode.OK, namespaces.Status);
        var found = Assert.Single(namespaces.Body.EnumerateArray());
        Assert.Equal(
            ("contoso-prod", "contoso-prod.servicebus.windows.net", "rg-messaging", "Premium",
                $"/subscriptions/{SubscriptionId}/resourceGroups/rg-messaging/providers/Microsoft.ServiceBus/namespaces/contoso-prod"),
            (found.GetProperty("name").GetString(), found.GetProperty("fullyQualifiedNamespace").GetString(), found.GetProperty("resourceGroup").GetString(),
                found.GetProperty("tier").GetString(), found.GetProperty("resourceId").GetString()));
        Assert.Equal(HttpStatusCode.NoContent, signOut.Status);
        Assert.Equal(HttpStatusCode.Conflict, afterSignOut.Status);
        Assert.Equal(["Bearer " + Token, "Bearer " + Token], harness.Handler.Authorizations);
    }

    [Fact]
    public async Task A_subscription_id_that_is_not_a_GUID_answers_400_and_reaches_no_Resource_Manager()
    {
        using var harness = new Harness(Arm);
        await harness.SignInAsync();

        var call = await harness.SendAsync(HttpMethod.Get, "/api/azure-directory/subscriptions/not-a-guid/namespaces");

        Assert.Equal(HttpStatusCode.BadRequest, call.Status);
        Assert.Equal("The subscription ID is not a GUID.", call.Body.GetProperty("message").GetString());
        Assert.Empty(harness.Handler.Authorizations);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "forbidden", "Your account may not read this subscription (403).")]
    [InlineData(HttpStatusCode.InternalServerError, "failed", "Azure answered 500.")]
    public async Task A_list_Resource_Manager_refuses_answers_502_with_the_neutral_sentence(HttpStatusCode status, string code, string message)
    {
        using var harness = new Harness(_ => Json(new { error = new { message = "denied for " + Token } }, status));
        await harness.SignInAsync();

        var call = await harness.SendAsync(HttpMethod.Get, $"/api/azure-directory/subscriptions/{SubscriptionId}/namespaces");

        Assert.Equal(HttpStatusCode.BadGateway, call.Status);
        Assert.Equal((code, message), (call.Body.GetProperty("code").GetString(), call.Body.GetProperty("message").GetString()));
    }

    [Fact]
    public async Task The_token_reaches_no_response_body_and_no_log_entry_on_any_route_whether_it_succeeds_or_fails()
    {
        var needles = new[] { Token, Signature, Token.Split('.')[1] };
        var failing = false;
        var tokenFails = false;
        using var harness = new Harness(
            request => failing ? Json(new { error = new { message = "refused " + Token } }, HttpStatusCode.Forbidden) : Arm(request),
            () => tokenFails ? throw new InvalidOperationException("token refused: " + Token) : Token);

        await harness.SignInAsync();
        await harness.SendAsync(HttpMethod.Get, "/api/azure-directory/subscriptions");
        await harness.SendAsync(HttpMethod.Get, $"/api/azure-directory/subscriptions/{SubscriptionId}/namespaces");
        failing = true;
        await harness.SendAsync(HttpMethod.Get, "/api/azure-directory/subscriptions");
        await harness.SendAsync(HttpMethod.Get, $"/api/azure-directory/subscriptions/{SubscriptionId}/namespaces");
        tokenFails = true;
        await harness.SendAsync(HttpMethod.Get, "/api/azure-directory/subscriptions");
        await harness.SignInAsync("InteractiveBrowser");
        await harness.SignInAsync("AzureCli");
        await harness.SendAsync(HttpMethod.Post, "/api/azure-directory/sign-out");

        Assert.Equal(
            [HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.BadGateway, HttpStatusCode.BadGateway, HttpStatusCode.BadGateway,
                HttpStatusCode.BadRequest, HttpStatusCode.BadRequest, HttpStatusCode.NoContent],
            harness.Calls.Select(c => c.Status));
        foreach (var needle in needles)
        {
            var body = harness.Calls.FirstOrDefault(c => c.Raw.Contains(needle, StringComparison.Ordinal));
            Assert.True(body == null, $"The token reached a response body: {body?.Raw}");
            var entry = harness.Logs.Entries.FirstOrDefault(e => e.Contains(needle, StringComparison.Ordinal));
            Assert.True(entry == null, $"The token reached a log entry: {entry}");
        }
        Assert.Contains(harness.Logs.Entries, e => e.Contains("answered 403", StringComparison.Ordinal));
    }
}
