using System.Collections.Concurrent;
using System.Net;
using System.Reflection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.EntityAdministrationTests;
using static ServiceBusExplorer.Api.Tests.ErrorBodyTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// A read the caller abandons is not an error: the provider sees the request token cancelled and the route writes no
/// error log for it. A session read is abandoned on List again, on another entity or after 10 seconds; a namespace
/// properties read when the panel closes.
/// </summary>
public class SessionCancelTests
{
    private sealed class Capture : ILoggerProvider
    {
        public ConcurrentQueue<(string Category, LogLevel Level, string Text)> Entries { get; } = new();

        public ILogger CreateLogger(string categoryName) => new Logger(categoryName, Entries);

        public void Dispose()
        {
        }

        private sealed class Logger(string category, ConcurrentQueue<(string, LogLevel, string)> entries) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                entries.Enqueue((category, logLevel, formatter(state, exception)));
        }
    }

    [Fact]
    public async Task A_session_read_the_caller_abandons_reaches_the_provider_cancelled_and_logs_no_error()
    {
        var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var capture = await AbandonAsync(
            (m, args) => m.Name == nameof(IMessagingProvider.GetSessionAsync)
                ? WaitUntilCancelled<SessionDetail>((CancellationToken)args[^1]!, cancelled)
                : null,
            "/api/queues/orders/sessions/order-1001?messageCount=0",
            cancelled);

        Assert.False(
            capture.Entries.Any(e => e.Level >= LogLevel.Error && e.Category.Contains("SessionsController")),
            "An abandoned session read is not an error and logs none");
    }

    [Fact]
    public async Task A_namespace_properties_read_the_caller_abandons_reaches_the_provider_cancelled_and_logs_no_error()
    {
        var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var capture = await AbandonAsync(
            (m, args) => m.Name == nameof(IMessagingProvider.GetNamespacePropertiesAsync)
                ? WaitUntilCancelled<NamespaceInfo>((CancellationToken)args[^1]!, cancelled)
                : null,
            "/api/namespace/properties",
            cancelled);

        Assert.False(
            capture.Entries.Any(e => e.Level >= LogLevel.Error && e.Category.Contains("NamespaceController")),
            "An abandoned namespace properties read is not an error and logs none: "
                + string.Join(" | ", capture.Entries.Where(e => e.Level >= LogLevel.Error).Select(e => $"{e.Category}: {e.Text}")));
    }

    /// <summary>
    /// Connects a provider that answers with <paramref name="answer"/>, sends a GET to <paramref name="path"/> and
    /// abandons it after 300 ms; returns once the provider saw the token cancelled and the route had time to log.
    /// </summary>
    private static async Task<Capture> AbandonAsync(Func<MethodInfo, object?[], object?> answer, string path, TaskCompletionSource cancelled)
    {
        var capture = new Capture();
        var provider = DispatchProxy.Create<IMessagingProvider, RecordingProvider>();
        ((RecordingProvider)(object)provider).Answer = answer;
        var providerFactory = StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.CreateConnectedProviderAsync)
            ? Task.FromResult(provider)
            : throw new NotSupportedException());
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b =>
        {
            b.ConfigureTestServices(s => s.AddSingleton(providerFactory));
            b.ConfigureLogging(l =>
            {
                l.AddProvider(capture);
                l.AddFilter<Capture>(null, LogLevel.Trace);
            });
        });
        await factory.Services.GetRequiredService<IConnectionManager>()
            .SaveConnectionAsync(new ServiceBusConnection { Id = "c1", Name = "fake", ConnectionString = "Endpoint=sb://fake/" });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        using (var connected = await client.PostAsync("/api/connections/c1/connect", null))
        {
            Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
        }

        try
        {
            using var abandon = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.GetAsync(path, abandon.Token));

            await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(10));
            await Task.Delay(300);
            return capture;
        }
        finally
        {
            using var _ = await client.PostAsync("/api/connections/disconnect", null);
        }
    }

    private static async Task<T> WaitUntilCancelled<T>(CancellationToken token, TaskCompletionSource cancelled)
    {
        try
        {
            await Task.Delay(Timeout.Infinite, token);
        }
        finally
        {
            cancelled.TrySetResult();
        }
        throw new InvalidOperationException("The request token never fired.");
    }
}
