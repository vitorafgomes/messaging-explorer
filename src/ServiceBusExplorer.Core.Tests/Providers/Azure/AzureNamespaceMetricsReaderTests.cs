using Azure;
using Azure.Core;
using Azure.Identity;
using Azure.Monitor.Query;
using Azure.Monitor.Query.Models;
using Moq;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The namespace metrics read: the one query it builds from the connection's resource ID, the connections it refuses
/// before any call, and what each failure of Azure Monitor or of the sign-in becomes. Never made-up data.
/// </summary>
public class AzureNamespaceMetricsReaderTests
{
    private const string ResourceId =
        "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-test/providers/Microsoft.ServiceBus/namespaces/contoso-test";

    private static ServiceBusConnection Connection(AzureAuthType? auth = AzureAuthType.AzureCli, string? resourceId = ResourceId) => new()
    {
        Id = "c1",
        Name = "azure",
        ProviderType = ProviderType.AzureServiceBus,
        AuthType = auth,
        FullyQualifiedNamespace = "contoso-test.servicebus.windows.net",
        AzureResourceId = resourceId
    };

    private static readonly DateTimeOffset T0 = new(2026, 11, 14, 10, 0, 0, TimeSpan.Zero);

    private static MetricsQueryResult Result() => MonitorQueryModelFactory.MetricsQueryResult(
        cost: 0,
        timespan: "PT1H",
        granularity: TimeSpan.FromMinutes(1),
        @namespace: "Microsoft.ServiceBus/namespaces",
        resourceRegion: "westeurope",
        metrics:
        [
            Metric("IncomingMessages", MonitorQueryModelFactory.MetricValue(T0, average: 1, total: 30), MonitorQueryModelFactory.MetricValue(T0.AddMinutes(1), average: null, total: null)),
            Metric("ActiveMessages", MonitorQueryModelFactory.MetricValue(T0, average: 7, total: 420))
        ]);

    private static MetricResult Metric(string name, params MetricValue[] values) =>
        MonitorQueryModelFactory.MetricResult(
            id: ResourceId + "/providers/Microsoft.Insights/metrics/" + name,
            resourceType: "Microsoft.Insights/metrics",
            name: name,
            unit: MetricUnit.Count,
            timeSeries: [MonitorQueryModelFactory.MetricTimeSeriesElement(new Dictionary<string, string>(), values)]);

    private static (AzureNamespaceMetricsReader Reader, Mock<MetricsQueryClient> Client, List<TokenCredential> Credentials) Reader(TimeSpan? timeout = null)
    {
        var client = new Mock<MetricsQueryClient>();
        var credentials = new List<TokenCredential>();
        var reader = new AzureNamespaceMetricsReader(c => { credentials.Add(c); return client.Object; }, timeout ?? TimeSpan.FromSeconds(30));
        return (reader, client, credentials);
    }

    private static void Answers(Mock<MetricsQueryClient> client, Func<CancellationToken, Task<Response<MetricsQueryResult>>> answer) =>
        client.Setup(c => c.QueryResourceAsync(It.IsAny<string>(), It.IsAny<IEnumerable<string>>(), It.IsAny<MetricsQueryOptions>(), It.IsAny<CancellationToken>()))
            .Returns((string _, IEnumerable<string> _, MetricsQueryOptions _, CancellationToken token) => answer(token));

    [Fact]
    public async Task The_query_is_built_from_the_resource_id_of_the_connection_with_six_metrics_over_one_bounded_hour()
    {
        var (reader, client, credentials) = Reader();
        string? resource = null;
        string[]? metrics = null;
        MetricsQueryOptions? options = null;
        client.Setup(c => c.QueryResourceAsync(It.IsAny<string>(), It.IsAny<IEnumerable<string>>(), It.IsAny<MetricsQueryOptions>(), It.IsAny<CancellationToken>()))
            .Callback((string r, IEnumerable<string> m, MetricsQueryOptions o, CancellationToken _) => (resource, metrics, options) = (r, m.ToArray(), o))
            .ReturnsAsync(Response.FromValue(Result(), Mock.Of<Response>()));

        var data = await reader.ReadAsync(Connection(), MetricsTimeRange.OneHour, CancellationToken.None);

        Assert.Equal(ResourceId, resource);
        Assert.Equal(["IncomingMessages", "OutgoingMessages", "ActiveMessages", "DeadletteredMessages", "ServerErrors", "ThrottledRequests"], metrics!);
        Assert.Equal(TimeSpan.FromHours(1), options!.TimeRange!.Value.Duration);
        Assert.Equal(TimeSpan.FromMinutes(1), options.Granularity);
        Assert.Equal([MetricAggregationType.Total, MetricAggregationType.Average], options.Aggregations);
        Assert.IsType<AzureCliCredential>(Assert.Single(credentials));
        Assert.True(
            data.Series.Select(s => (s.Name, string.Join(",", s.Data.Select(p => $"{p.Timestamp:HH:mm}={p.Value}"))))
                .SequenceEqual([("IncomingMessages", "10:00=30"), ("ActiveMessages", "10:00=7")]),
            "A count is read as its total and a gauge as its average, and a grain with no value is left out, never read as zero");
    }

    [Fact]
    public async Task A_second_read_of_the_same_connection_reuses_its_credential_so_a_browser_sign_in_is_not_asked_again()
    {
        var (reader, client, credentials) = Reader();
        Answers(client, _ => Task.FromResult(Response.FromValue(Result(), Mock.Of<Response>())));

        await reader.ReadAsync(Connection(AzureAuthType.InteractiveBrowser), MetricsTimeRange.OneHour, CancellationToken.None);
        await reader.ReadAsync(Connection(AzureAuthType.InteractiveBrowser), MetricsTimeRange.TwentyFourHours, CancellationToken.None);

        Assert.Equal(2, credentials.Count);
        Assert.Same(credentials[0], credentials[1]);
    }

    [Fact]
    public async Task A_connection_whose_client_secret_was_changed_gets_a_new_credential_never_the_old_one()
    {
        var (reader, client, credentials) = Reader();
        Answers(client, _ => Task.FromResult(Response.FromValue(Result(), Mock.Of<Response>())));
        var before = Connection(AzureAuthType.ServicePrincipal);
        before.TenantId = "tenant";
        before.ServicePrincipalClientId = "client";
        before.ClientSecret = "old-secret";
        var after = Connection(AzureAuthType.ServicePrincipal);
        after.TenantId = "tenant";
        after.ServicePrincipalClientId = "client";
        after.ClientSecret = "rotated-secret";

        await reader.ReadAsync(before, MetricsTimeRange.OneHour, CancellationToken.None);
        await reader.ReadAsync(after, MetricsTimeRange.OneHour, CancellationToken.None);

        Assert.True(credentials.Count == 2 && !ReferenceEquals(credentials[0], credentials[1]),
            "After a client secret rotation the metrics read signs in with a new credential, never the cached one built from the old secret.");
    }

    public static TheoryData<ServiceBusConnection, NamespaceMetricsFailure> Refused => new()
    {
        { Connection(auth: null), NamespaceMetricsFailure.ConnectionString },
        { Connection(AzureAuthType.ConnectionString), NamespaceMetricsFailure.ConnectionString },
        { Connection(AzureAuthType.ConnectionString, resourceId: null), NamespaceMetricsFailure.ConnectionString },
        { Connection(resourceId: null), NamespaceMetricsFailure.NoResourceId },
        { Connection(resourceId: ResourceId + "/queues/orders"), NamespaceMetricsFailure.NoResourceId },
        { new ServiceBusConnection { Id = "r", ProviderType = ProviderType.RabbitMQ, AuthType = AzureAuthType.AzureCli, AzureResourceId = ResourceId }, NamespaceMetricsFailure.NotAzure },
    };

    [Theory]
    [MemberData(nameof(Refused))]
    public async Task A_connection_that_cannot_read_Azure_Monitor_is_refused_with_its_fixed_text_before_any_call(ServiceBusConnection connection, NamespaceMetricsFailure reason)
    {
        var (reader, client, credentials) = Reader();

        var refused = await Assert.ThrowsAsync<NamespaceMetricsException>(() => reader.ReadAsync(connection, MetricsTimeRange.OneHour, CancellationToken.None));

        Assert.Equal((reason, NamespaceMetricsException.TextOf(reason)), (refused.Reason, refused.Message));
        Assert.Empty(credentials);
        client.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(403, NamespaceMetricsFailure.Forbidden)]
    [InlineData(401, NamespaceMetricsFailure.Forbidden)]
    [InlineData(404, NamespaceMetricsFailure.Failed)]
    [InlineData(500, NamespaceMetricsFailure.Failed)]
    [InlineData(503, NamespaceMetricsFailure.Failed)]
    public async Task An_Azure_Monitor_error_is_a_failure_with_a_fixed_text_and_never_empty_or_made_up_data(int status, NamespaceMetricsFailure reason)
    {
        var (reader, client, _) = Reader();
        Answers(client, _ => Task.FromException<Response<MetricsQueryResult>>(new RequestFailedException(status, "monitor said no: SECRET-DETAIL")));

        var failed = await Assert.ThrowsAsync<NamespaceMetricsException>(() => reader.ReadAsync(Connection(), MetricsTimeRange.OneHour, CancellationToken.None));

        Assert.Equal(reason, failed.Reason);
        Assert.DoesNotContain("SECRET-DETAIL", failed.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_sign_in_that_does_not_complete_is_the_sign_in_failure()
    {
        var (reader, client, _) = Reader();
        Answers(client, _ => Task.FromException<Response<MetricsQueryResult>>(new CredentialUnavailableException("az login needed: SECRET-DETAIL")));

        var failed = await Assert.ThrowsAsync<NamespaceMetricsException>(() => reader.ReadAsync(Connection(), MetricsTimeRange.OneHour, CancellationToken.None));

        Assert.Equal((NamespaceMetricsFailure.SignIn, NamespaceMetricsException.TextOf(NamespaceMetricsFailure.SignIn)), (failed.Reason, failed.Message));
    }

    [Fact]
    public async Task Azure_Monitor_that_does_not_answer_in_time_is_the_failed_read()
    {
        var (reader, client, _) = Reader(TimeSpan.FromMilliseconds(50));
        Answers(client, async token => { await Task.Delay(Timeout.Infinite, token); throw new InvalidOperationException("unreachable"); });

        var failed = await Assert.ThrowsAsync<NamespaceMetricsException>(() => reader.ReadAsync(Connection(), MetricsTimeRange.OneHour, CancellationToken.None));

        Assert.Equal(NamespaceMetricsFailure.Failed, failed.Reason);
    }

    [Fact]
    public async Task The_callers_cancellation_stops_the_read_and_is_not_reported_as_a_failure()
    {
        var (reader, client, _) = Reader();
        Answers(client, async token => { await Task.Delay(Timeout.Infinite, token); throw new InvalidOperationException("unreachable"); });
        using var caller = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

        var stopped = await Record.ExceptionAsync(() => reader.ReadAsync(Connection(), MetricsTimeRange.OneHour, caller.Token));

        Assert.IsAssignableFrom<OperationCanceledException>(stopped);
    }
}
