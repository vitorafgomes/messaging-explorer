using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.ErrorBodyTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// <c>GET /api/metrics/connections/{id}</c>: the namespace metrics of a stored connection, its refusals with fixed texts,
/// its failures with fixed texts and the constant 500; and the Azure resource ID of a connection, which is not a secret.
/// </summary>
public class NamespaceMetricsRouteTests
{
    private const string ResourceId =
        "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-test/providers/Microsoft.ServiceBus/namespaces/contoso-test";

    private const string Sensitive = "SENSITIVE_LEAKED_INTERNAL_DETAIL";

    private sealed class FakeReader(Func<ServiceBusConnection, MetricsTimeRange, MetricsData> read) : AzureNamespaceMetricsReader
    {
        public override Task<MetricsData> ReadAsync(ServiceBusConnection connection, MetricsTimeRange timeRange, CancellationToken cancellationToken) =>
            Task.FromResult(read(connection, timeRange));
    }

    private static ServiceBusConnection Azure(string id, AzureAuthType auth, string? resourceId) => new()
    {
        Id = id,
        Name = "azure",
        ProviderType = ProviderType.AzureServiceBus,
        ConnectionString = auth == AzureAuthType.ConnectionString ? "Endpoint=sb://contoso-test.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=stored-key" : "",
        AuthType = auth,
        FullyQualifiedNamespace = "contoso-test.servicebus.windows.net",
        TenantId = "00000000-0000-0000-0000-000000000002",
        ServicePrincipalClientId = "00000000-0000-0000-0000-000000000003",
        ClientSecret = auth == AzureAuthType.ServicePrincipal ? "stored-client-secret" : null,
        AzureResourceId = resourceId
    };

    private static async Task<(HttpStatusCode Status, JsonElement Body, string Raw)> GetAsync(
        string path, ServiceBusConnection? stored = null, AzureNamespaceMetricsReader? reader = null, bool withKey = true)
    {
        using var baseFactory = new ApiFactory();
        using var factory = reader == null ? baseFactory : baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(reader)));
        if (stored != null) await factory.Services.GetRequiredService<IConnectionManager>().SaveConnectionAsync(stored);
        using var client = factory.CreateClient();
        if (withKey) client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync(path);
        var raw = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, raw.Length == 0 ? default : JsonDocument.Parse(raw).RootElement.Clone(), raw);
    }

    [Fact]
    public async Task A_signed_in_connection_with_a_resource_id_answers_the_series_read_with_its_own_secret_over_the_range_asked()
    {
        ServiceBusConnection? seen = null;
        MetricsTimeRange? range = null;
        var reader = new FakeReader((c, r) =>
        {
            (seen, range) = (c, r);
            return new MetricsData { Series = [new MetricsSeries { Name = "IncomingMessages", Data = [new MetricsDataPoint { Timestamp = DateTimeOffset.UnixEpoch, Value = 30 }] }] };
        });

        var (status, body, _) = await GetAsync("/api/metrics/connections/sp-1?timeRange=TwentyFourHours", Azure("sp-1", AzureAuthType.ServicePrincipal, ResourceId), reader);

        Assert.Equal(HttpStatusCode.OK, status);
        var series = Assert.Single(body.GetProperty("series").EnumerateArray());
        Assert.Equal(("IncomingMessages", 30d), (series.GetProperty("name").GetString(), series.GetProperty("data")[0].GetProperty("value").GetDouble()));
        Assert.True(seen?.ClientSecret == "stored-client-secret" && seen.AzureResourceId == ResourceId && range == MetricsTimeRange.TwentyFourHours,
            "The reader gets the stored connection with its secret, its resource ID and the range asked");
    }

    [Fact]
    public async Task A_connection_string_connection_is_refused_with_the_fixed_text_that_metrics_need_a_sign_in_with_Entra_ID()
    {
        var (status, body, _) = await GetAsync("/api/metrics/connections/cs-1", Azure("cs-1", AzureAuthType.ConnectionString, ResourceId));

        Assert.Equal(HttpStatusCode.Conflict, status);
        Assert.True(
            (body.GetProperty("code").GetString(), body.GetProperty("message").GetString()) == ("connection-string", NamespaceMetricsException.TextOf(NamespaceMetricsFailure.ConnectionString)),
            $"A connection string cannot read Azure Monitor: the route says metrics need a sign-in with Entra ID, never a made-up series; got {status} {body}");
    }

    [Fact]
    public async Task A_signed_in_connection_without_a_resource_id_is_refused_with_the_fixed_text()
    {
        var (status, body, _) = await GetAsync("/api/metrics/connections/cli-1", Azure("cli-1", AzureAuthType.AzureCli, null));

        Assert.Equal(HttpStatusCode.Conflict, status);
        Assert.Equal(("no-resource-id", NamespaceMetricsException.TextOf(NamespaceMetricsFailure.NoResourceId)),
            (body.GetProperty("code").GetString(), body.GetProperty("message").GetString()));
    }

    [Theory]
    [InlineData(NamespaceMetricsFailure.Forbidden, "forbidden")]
    [InlineData(NamespaceMetricsFailure.SignIn, "sign-in")]
    [InlineData(NamespaceMetricsFailure.Failed, "failed")]
    public async Task A_failed_read_answers_502_with_its_code_and_fixed_text(NamespaceMetricsFailure reason, string code)
    {
        var reader = new FakeReader((_, _) => throw new NamespaceMetricsException(reason));

        var (status, body, _) = await GetAsync("/api/metrics/connections/cli-1", Azure("cli-1", AzureAuthType.AzureCli, ResourceId), reader);

        Assert.Equal(HttpStatusCode.BadGateway, status);
        Assert.Equal((code, NamespaceMetricsException.TextOf(reason)), (body.GetProperty("code").GetString(), body.GetProperty("message").GetString()));
    }

    [Fact]
    public async Task An_unexpected_failure_answers_the_constant_500_without_the_exception_text()
    {
        var reader = new FakeReader((_, _) => throw new InvalidOperationException(Sensitive));

        var (status, body, raw) = await GetAsync("/api/metrics/connections/cli-1", Azure("cli-1", AzureAuthType.AzureCli, ResourceId), reader);

        Assert.Equal(HttpStatusCode.InternalServerError, status);
        Assert.Equal(MetricsController.NamespaceMetricsInternalError, body.GetProperty("message").GetString());
        Assert.DoesNotContain(Sensitive, raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_route_refuses_a_request_without_the_api_key()
    {
        var (status, _, _) = await GetAsync("/api/metrics/connections/cli-1", Azure("cli-1", AzureAuthType.AzureCli, ResourceId), withKey: false);

        Assert.Equal(HttpStatusCode.Unauthorized, status);
    }

    [Theory]
    [InlineData("/api/metrics/connections/unknown", HttpStatusCode.NotFound)]
    [InlineData("/api/metrics/connections/cli-1?timeRange=99", HttpStatusCode.BadRequest)]
    public async Task An_unknown_connection_or_time_range_is_refused_before_any_read(string path, HttpStatusCode expected)
    {
        var reader = new FakeReader((_, _) => throw new InvalidOperationException("no read expected"));

        var (status, _, _) = await GetAsync(path, Azure("cli-1", AzureAuthType.AzureCli, ResourceId), reader);

        Assert.Equal(expected, status);
    }

    [Fact]
    public async Task A_resource_id_edit_alone_is_metadata_it_is_stored_untested_and_read_back_unmasked()
    {
        var tests = 0;
        var providerFactory = StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.TestConnectionAsync)
            ? Task.FromResult(++tests > 0)
            : throw new NotSupportedException(m.Name));
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(providerFactory)));
        var manager = factory.Services.GetRequiredService<IConnectionManager>();
        await manager.SaveConnectionAsync(Azure("sp-2", AzureAuthType.ServicePrincipal, null));
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        var edit = (await manager.GetConnectionAsync("sp-2"))!;
        edit.AzureResourceId = ResourceId;

        using var saved = await client.PostAsJsonAsync("/api/connections", edit);
        using var read = await client.GetAsync("/api/connections/sp-2");
        using var doc = JsonDocument.Parse(await read.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.True(tests == 0, $"The resource ID is not how the broker is reached: an edit of it alone is not tested, tests run: {tests}");
        Assert.Equal((ResourceId, "***"), (doc.RootElement.GetProperty("azureResourceId").GetString(), doc.RootElement.GetProperty("clientSecret").GetString()));
        Assert.Equal("stored-client-secret", (await manager.GetConnectionWithSecretAsync("sp-2"))?.ClientSecret);
    }

    [Fact]
    public async Task A_save_with_a_resource_id_out_of_format_is_refused_with_the_fixed_text()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.PostAsJsonAsync("/api/connections", Azure("bad-1", AzureAuthType.AzureCli, ResourceId + "/queues/orders"));
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(ServiceBusConnection.ResourceIdRefusal, doc.RootElement.GetProperty("message").GetString());
    }
}
