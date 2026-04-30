using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// Integration tests for <see cref="Controllers.MetricsController"/> covering:
/// - H5: when AzureMonitor config is empty, endpoints return 503.
/// - H2: 500 responses must not include an "error" field exposing ex.Message.
/// </summary>
public class MetricsControllerTests
{
    /// <summary>
    /// ApiFactory variant that lets tests override AzureMonitor config and/or the
    /// registered IMetricsService.
    /// </summary>
    private sealed class MetricsApiFactory : WebApplicationFactory<Program>
    {
        public string DataPath { get; }
        private readonly Dictionary<string, string?> _configOverrides;
        private readonly IMetricsService? _overrideService;

        public MetricsApiFactory(
            Dictionary<string, string?>? configOverrides = null,
            IMetricsService? overrideService = null)
        {
            DataPath = Path.Combine(Path.GetTempPath(), "sbx-metrics-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(DataPath);
            Environment.SetEnvironmentVariable("API_SECRET", ApiFactory.TestApiSecret);
            Environment.SetEnvironmentVariable("SERVICEBUS_DATA_PATH", DataPath);
            Environment.SetEnvironmentVariable("ASPNETCORE_URLS", "http://127.0.0.1:0");
            _configOverrides = configOverrides ?? new Dictionary<string, string?>();
            _overrideService = overrideService;
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            Environment.SetEnvironmentVariable("API_SECRET", ApiFactory.TestApiSecret);
            Environment.SetEnvironmentVariable("SERVICEBUS_DATA_PATH", DataPath);
            Environment.SetEnvironmentVariable("ASPNETCORE_URLS", "http://127.0.0.1:0");
            builder.UseEnvironment("Development");

            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(_configOverrides);
            });

            if (_overrideService != null)
            {
                builder.ConfigureTestServices(services =>
                {
                    services.AddSingleton(_overrideService);
                });
            }
        }
    }

    /// <summary>
    /// IMetricsService that always throws a generic exception so we can verify H2 (no ex.Message in 500 body).
    /// </summary>
    private sealed class ThrowingMetricsService : IMetricsService
    {
        public const string SensitiveMessage = "SENSITIVE_LEAKED_INTERNAL_DETAIL";

        public Task<MetricsData> GetQueueMetricsAsync(string queueName, MetricsTimeRange timeRange, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException(SensitiveMessage);

        public Task<MetricsData> GetTopicMetricsAsync(string topicName, MetricsTimeRange timeRange, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException(SensitiveMessage);

        public Task<MetricsData> GetSubscriptionMetricsAsync(string topicName, string subscriptionName, MetricsTimeRange timeRange, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException(SensitiveMessage);
    }

    [Fact]
    public async Task GetQueueMetrics_returns_503_when_AzureMonitor_not_configured()
    {
        // Empty AzureMonitor section → UnconfiguredMetricsService is registered.
        using var factory = new MetricsApiFactory(configOverrides: new Dictionary<string, string?>
        {
            ["AzureMonitor:SubscriptionId"] = "",
            ["AzureMonitor:ResourceGroup"] = "",
            ["AzureMonitor:Namespace"] = ""
        });

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        var response = await client.GetAsync("/api/metrics/queues/test-queue");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.True(doc.RootElement.TryGetProperty("message", out _));
        Assert.True(doc.RootElement.TryGetProperty("configurationRequired", out var cfgReq));
        Assert.True(cfgReq.GetBoolean());
        // H2: 503 body must not carry an "error" property with leaked exception text.
        Assert.False(doc.RootElement.TryGetProperty("error", out _));
    }

    [Fact]
    public async Task GetQueueMetrics_returns_500_without_leaking_exception_message()
    {
        // Fully configured section so the IMetricsService registration is active,
        // but swap in a throwing fake in ConfigureTestServices.
        using var factory = new MetricsApiFactory(
            configOverrides: new Dictionary<string, string?>
            {
                ["AzureMonitor:SubscriptionId"] = "fake-sub",
                ["AzureMonitor:ResourceGroup"] = "fake-rg",
                ["AzureMonitor:Namespace"] = "fake-ns"
            },
            overrideService: new ThrowingMetricsService());

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        var response = await client.GetAsync("/api/metrics/queues/test-queue");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();

        // Body must not contain the exception message verbatim.
        Assert.DoesNotContain(ThrowingMetricsService.SensitiveMessage, body);

        using var doc = JsonDocument.Parse(body);
        Assert.True(doc.RootElement.TryGetProperty("message", out _));
        // H2: no "error" field must be emitted for 500 responses.
        Assert.False(doc.RootElement.TryGetProperty("error", out _));
    }
}
