using System.Collections.Concurrent;
using Azure;
using Azure.Core;
using Azure.Identity;
using Azure.Monitor.Query;
using Azure.Monitor.Query.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Core.Providers.Azure;

/// <summary>Why the Azure Monitor metrics of a connection's namespace could not be read.</summary>
public enum NamespaceMetricsFailure
{
    /// <summary>The connection is not an Azure Service Bus connection.</summary>
    NotAzure,

    /// <summary>The connection signs in with a connection string, which cannot read Azure Monitor.</summary>
    ConnectionString,

    /// <summary>The connection carries no Azure resource ID in the namespace format.</summary>
    NoResourceId,

    /// <summary>The Entra ID sign-in did not complete.</summary>
    SignIn,

    /// <summary>Azure Monitor answered 401 or 403: the identity lacks the Monitoring Reader role.</summary>
    Forbidden,

    /// <summary>Azure Monitor failed, answered an error or did not answer in time.</summary>
    Failed
}

/// <summary>
/// Thrown by <see cref="AzureNamespaceMetricsReader.ReadAsync"/> when no metrics were read. Its message is a fixed text
/// per <see cref="Reason"/>, never the text of Azure Monitor or of the credential.
/// </summary>
public sealed class NamespaceMetricsException(NamespaceMetricsFailure reason) : Exception(TextOf(reason))
{
    /// <summary>Why no metrics were read.</summary>
    public NamespaceMetricsFailure Reason { get; } = reason;

    /// <summary>The fixed text for <paramref name="reason"/>.</summary>
    public static string TextOf(NamespaceMetricsFailure reason) => reason switch
    {
        NamespaceMetricsFailure.NotAzure => "Metrics are read from Azure Monitor, for an Azure Service Bus connection only.",
        NamespaceMetricsFailure.ConnectionString => "Metrics need a sign-in with Entra ID and the Azure resource ID of the namespace: a connection string cannot read Azure Monitor.",
        NamespaceMetricsFailure.NoResourceId => "Metrics need the Azure resource ID of the namespace on this connection.",
        NamespaceMetricsFailure.SignIn => "The sign-in with Entra ID did not complete, so Azure Monitor was not read.",
        NamespaceMetricsFailure.Forbidden => "Azure Monitor refused the read: the signed-in identity needs the Monitoring Reader role on the namespace.",
        _ => "The call to Azure Monitor failed or did not answer in time."
    };
}

/// <summary>
/// Reads the Azure Monitor metrics of a connection's namespace, from its <see cref="ServiceBusConnection.AzureResourceId"/>
/// with the connection's own Entra ID credential. One query per read: six metrics, one bounded time range, a fixed
/// grain, and a timeout of its own on top of the caller's token. A read that fails throws
/// <see cref="NamespaceMetricsException"/>; it never answers empty or made-up series.
/// </summary>
public class AzureNamespaceMetricsReader
{
    /// <summary>The namespace metrics read, in the order the screen shows them.</summary>
    public static readonly string[] MetricNames =
        ["IncomingMessages", "OutgoingMessages", "ActiveMessages", "DeadletteredMessages", "ServerErrors", "ThrottledRequests"];

    /// <summary>Gauges are read as the average of each grain; the other metrics are counts, read as the total.</summary>
    private static readonly HashSet<string> Gauges = ["ActiveMessages", "DeadletteredMessages"];

    private readonly Func<TokenCredential, MetricsQueryClient> _clientFor;
    private readonly TimeSpan _timeout;
    private readonly ILogger _logger;

    // ponytail: one credential per connection, kept for the process, keyed by a hash of the fields that build it;
    // an edited connection gets a new entry and the old one stays until restart.
    private readonly ConcurrentDictionary<(string Id, int Fingerprint), TokenCredential> _credentials = new();

    /// <summary>Reads through Azure Monitor's public endpoint with a 60 second timeout per read.</summary>
    public AzureNamespaceMetricsReader(ILogger<AzureNamespaceMetricsReader>? logger = null)
        : this(credential => new MetricsQueryClient(credential), TimeSpan.FromSeconds(60), logger)
    {
    }

    internal AzureNamespaceMetricsReader(Func<TokenCredential, MetricsQueryClient> clientFor, TimeSpan timeout, ILogger? logger = null)
    {
        _clientFor = clientFor;
        _timeout = timeout;
        _logger = logger ?? NullLogger.Instance;
    }

    /// <summary>
    /// Reads the namespace metrics of <paramref name="connection"/>, which must carry its secrets, over
    /// <paramref name="timeRange"/>. Refuses before any call a connection that is not Azure, that signs in with a
    /// connection string, or that has no resource ID in the namespace format.
    /// </summary>
    /// <exception cref="NamespaceMetricsException">No metrics were read; <see cref="NamespaceMetricsException.Reason"/> says why.</exception>
    /// <exception cref="OperationCanceledException"><paramref name="cancellationToken"/> was cancelled.</exception>
    public virtual async Task<MetricsData> ReadAsync(ServiceBusConnection connection, MetricsTimeRange timeRange, CancellationToken cancellationToken)
    {
        if (connection.ProviderType != ProviderType.AzureServiceBus)
            throw new NamespaceMetricsException(NamespaceMetricsFailure.NotAzure);
        if (connection.AuthType is null or AzureAuthType.ConnectionString)
            throw new NamespaceMetricsException(NamespaceMetricsFailure.ConnectionString);
        if (!ServiceBusConnection.IsResourceIdFormat(connection.AzureResourceId))
            throw new NamespaceMetricsException(NamespaceMetricsFailure.NoResourceId);

        var (start, end, granularity) = AzureMonitorMetricsService.GetTimeRangeParameters(timeRange);
        var client = _clientFor(CredentialFor(connection));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_timeout);

        try
        {
            var options = new MetricsQueryOptions { TimeRange = new QueryTimeRange(start, end), Granularity = granularity };
            options.Aggregations.Add(MetricAggregationType.Total);
            options.Aggregations.Add(MetricAggregationType.Average);
            var response = await client.QueryResourceAsync(connection.AzureResourceId!, MetricNames, options, timeout.Token);
            return Map(response.Value, start, end);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("Azure Monitor did not answer within {Timeout} for connection {ConnectionId}", _timeout, connection.Id);
            throw new NamespaceMetricsException(NamespaceMetricsFailure.Failed);
        }
        catch (AuthenticationFailedException ex)
        {
            _logger.LogWarning("Entra ID sign-in for the metrics of connection {ConnectionId} failed ({ExceptionType})", connection.Id, ex.GetType().Name);
            throw new NamespaceMetricsException(NamespaceMetricsFailure.SignIn);
        }
        catch (RequestFailedException ex)
        {
            _logger.LogWarning("Azure Monitor answered {Status} for the metrics of connection {ConnectionId}", ex.Status, connection.Id);
            throw new NamespaceMetricsException(ex.Status is 401 or 403 ? NamespaceMetricsFailure.Forbidden : NamespaceMetricsFailure.Failed);
        }
    }

    private TokenCredential CredentialFor(ServiceBusConnection connection) =>
        _credentials.GetOrAdd(
            (connection.Id, HashCode.Combine(connection.AuthType, connection.TenantId, connection.ServicePrincipalClientId, connection.ClientSecret)),
            _ => AzureCredentialFactory.Create(AzureConnectionConfig.FromServiceBusConnection(connection)));

    /// <summary>One series per metric; a grain with no value is left out, never read as zero.</summary>
    internal static MetricsData Map(MetricsQueryResult result, DateTimeOffset start, DateTimeOffset end) => new()
    {
        StartTime = start,
        EndTime = end,
        Series = result.Metrics.Select(metric => new MetricsSeries
        {
            Name = metric.Name,
            Data = metric.TimeSeries.SelectMany(series => series.Values)
                .Select(point => (point.TimeStamp, Value: Gauges.Contains(metric.Name) ? point.Average : point.Total))
                .Where(point => point.Value is not null)
                .Select(point => new MetricsDataPoint { Timestamp = point.TimeStamp, Value = point.Value!.Value })
                .ToList()
        }).ToList()
    };
}
