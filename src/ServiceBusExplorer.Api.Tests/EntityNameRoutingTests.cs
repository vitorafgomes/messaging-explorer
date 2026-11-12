using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// An entity, subscription or session name sent percent-encoded in one path segment reaches the
/// provider unchanged, on the provider method the route names, through Kestrel as in production.
/// </summary>
public class EntityNameRoutingTests
{
    /// <summary>
    /// A provider or metrics service that records each entity call as "Method(entity, sub=..., dl=..., session=...)".
    /// </summary>
    public class Recorder : DispatchProxy
    {
        public List<string> Calls { get; } = new();

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            var m = method!;
            switch (m.Name)
            {
                case "get_ProviderType": return ProviderType.AzureServiceBus;
                case "get_CurrentTarget": return "fake-target";
                case "get_IsConnected": return false;
                case "DisconnectAsync": return Task.CompletedTask;
                case "DisposeAsync": return ValueTask.CompletedTask;
            }

            var named = m.GetParameters().Zip(args!, (p, a) => (p.Name!, a)).ToDictionary(x => x.Item1, x => x.a);
            var parts = new List<string> { (string)args![0]! };
            if (named.TryGetValue("subscriptionName", out var sub) && sub is not null) parts.Add($"sub={sub}");
            if (named.TryGetValue("isDeadLetter", out var dl)) parts.Add($"dl={dl}");
            if (named.TryGetValue("sessionId", out var session)) parts.Add($"session={session}");
            Calls.Add($"{m.Name}({string.Join(", ", parts)})");

            if (m.ReturnType == typeof(Task)) return Task.CompletedTask;
            var result = m.ReturnType.GetGenericArguments()[0];
            var value = result == typeof(BatchOperationResult) ? new BatchOperationResult() : null;
            return typeof(Task).GetMethod(nameof(Task.FromResult))!.MakeGenericMethod(result).Invoke(null, new[] { value });
        }
    }

    private static async Task<List<string>> SendAsync(params (string Method, string Path)[] requests)
    {
        var provider = DispatchProxy.Create<IMessagingProvider, Recorder>();
        var metrics = DispatchProxy.Create<IMetricsService, Recorder>();
        var calls = ((Recorder)(object)provider).Calls;
        var metricsCalls = ((Recorder)(object)metrics).Calls;
        var providerFactory = ErrorBodyTests.StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.CreateConnectedProviderAsync)
            ? Task.FromResult(provider)
            : throw new NotSupportedException());
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton(providerFactory);
            s.AddSingleton(metrics);
        }));
        factory.UseKestrel(0);
        factory.StartServer();
        await factory.Services.GetRequiredService<IConnectionManager>()
            .SaveConnectionAsync(new ServiceBusConnection { Id = "c1", Name = "fake", ConnectionString = "Endpoint=sb://fake/" });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        try
        {
            using var connected = await client.PostAsync("/api/connections/c1/connect", null);
            Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
            foreach (var (method, path) in requests)
            {
                using var request = new HttpRequestMessage(new HttpMethod(method), path);
                if (method is "POST" or "PUT")
                    request.Content = JsonContent.Create(new { sequenceNumbers = new long[] { 1 }, state = "s" });
                using var _ = await client.SendAsync(request);
            }
            return calls.Concat(metricsCalls).ToList();
        }
        finally
        {
            using var _ = await client.PostAsync("/api/connections/disconnect", null);
        }
    }

    [Fact]
    public async Task Deleting_the_queue_a_slash_messages_deletes_that_queue_and_never_purges_the_queue_a()
    {
        var calls = await SendAsync(("DELETE", "/api/queues/a%2Fmessages"));

        Assert.Equal(new[] { "DeleteQueueAsync(a/messages)" }, calls);
    }

    [Fact]
    public async Task Purging_the_queue_orders_hash_1_purges_that_queue_and_never_deletes_the_queue_orders()
    {
        var calls = await SendAsync(("DELETE", "/api/queues/orders%231/messages"));

        Assert.Equal(new[] { "PurgeMessagesAsync(orders#1, dl=False)" }, calls);
    }

    [Theory]
    [InlineData("a/messages", "a%2Fmessages")]
    [InlineData("a/deadletter", "a%2Fdeadletter")]
    [InlineData("orders#1", "orders%231")]
    [InlineData("what?now", "what%3Fnow")]
    [InlineData("50%off", "50%25off")]
    [InlineData("my queue", "my%20queue")]
    [InlineData("a.b-c_d", "a.b-c_d")]
    [InlineData("a%2Fb", "a%252Fb")]
    public async Task A_queue_name_reaches_the_provider_unchanged_on_every_queue_operation(string name, string segment)
    {
        var calls = await SendAsync(
            ("GET", $"/api/queues/{segment}"),
            ("DELETE", $"/api/queues/{segment}"),
            ("DELETE", $"/api/queues/{segment}/messages"),
            ("DELETE", $"/api/queues/{segment}/deadletter"),
            ("GET", $"/api/queues/{segment}/messages?count=5"),
            ("POST", $"/api/queues/{segment}/messages/delete-batch"));

        Assert.Equal(new[]
        {
            $"GetQueueAsync({name})",
            $"DeleteQueueAsync({name})",
            $"PurgeMessagesAsync({name}, dl=False)",
            $"PurgeMessagesAsync({name}, dl=True)",
            $"PeekMessagesAsync({name}, dl=False)",
            $"DeleteMessagesAsync({name}, dl=False)",
        }, calls);
    }

    [Fact]
    public async Task A_topic_and_a_subscription_name_with_a_slash_reach_the_provider_unchanged()
    {
        var calls = await SendAsync(
            ("GET", "/api/topics/t%2F1/subscriptions/s%2F2"),
            ("DELETE", "/api/topics/t%2F1/subscriptions/s%2F2"),
            ("DELETE", "/api/topics/t%2F1/subscriptions/s%2F2/messages"),
            ("POST", "/api/topics/t%2F1/subscriptions/s%2F2/deadletter/resubmit-batch"));

        Assert.Equal(new[]
        {
            "GetSubscriptionAsync(t/1, sub=s/2)",
            "DeleteSubscriptionAsync(t/1, sub=s/2)",
            "PurgeMessagesAsync(t/1, sub=s/2, dl=False)",
            "ResubmitDeadLetterMessagesAsync(t/1, sub=s/2)",
        }, calls);
    }

    [Fact]
    public async Task A_session_id_with_a_slash_and_a_space_reaches_the_provider_unchanged()
    {
        var calls = await SendAsync(
            ("PUT", "/api/sessions/q%2F1/state/id%2Fwith%20space"),
            ("PUT", "/api/sessions/t%2F1/subscriptions/s%2F2/id%2Fwith%20space/state"));

        Assert.Equal(new[]
        {
            "SetSessionStateAsync(q/1, session=id/with space)",
            "SetSessionStateAsync(t/1, sub=s/2, session=id/with space)",
        }, calls);
    }

    [Fact]
    public async Task Queue_topic_and_subscription_names_with_a_slash_reach_the_metrics_service_unchanged()
    {
        var calls = await SendAsync(
            ("GET", "/api/metrics/queues/a%2Fmessages"),
            ("GET", "/api/metrics/topics/t%2F1"),
            ("GET", "/api/metrics/topics/t%2F1/subscriptions/s%2F2"));

        Assert.Equal(new[]
        {
            "GetQueueMetricsAsync(a/messages)",
            "GetTopicMetricsAsync(t/1)",
            "GetSubscriptionMetricsAsync(t/1, sub=s/2)",
        }, calls);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("http://localhost/api/queues/a%252Fb")]
    [InlineData("/api/x/../queues/a%252Fb")]
    [InlineData("/api/queues/other%252Fb")]
    public void A_raw_target_that_does_not_line_up_with_the_route_leaves_the_routed_value_alone(string? rawTarget)
    {
        var values = new RouteValueDictionary { ["name"] = "a%2Fb" };

        RawTargetRouteValuesAttribute.Apply(rawTarget, RoutePatternFactory.Parse("api/Queues/{name}"), values);

        Assert.Equal("a%2Fb", values["name"]);
    }

    [Theory]
    [InlineData("/api/queues/a%2Fb?count=5", "a%2Fb", "a/b")]
    [InlineData("/api/queues/a%2fb", "a%2fb", "a/b")]
    [InlineData("/api/queues/a%252Fb", "a%2Fb", "a%2Fb")]
    public void A_raw_segment_that_lines_up_with_the_route_is_decoded_exactly_once(string rawTarget, string routed, string expected)
    {
        var values = new RouteValueDictionary { ["name"] = routed };

        RawTargetRouteValuesAttribute.Apply(rawTarget, RoutePatternFactory.Parse("api/Queues/{name}"), values);

        Assert.Equal(expected, values["name"]);
    }
}
