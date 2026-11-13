using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client.Exceptions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.IntegrationTests;

/// <summary>
/// Records every log entry a <see cref="ProviderFactory"/> and its providers write: the formatted message, every
/// state value, and the text and data of the exception and each inner exception.
/// </summary>
internal sealed class CapturingLoggerFactory : ILoggerFactory
{
    public sealed record Entry(string Category, LogLevel Level, string? ExceptionType, string Text);

    public ConcurrentQueue<Entry> Entries { get; } = new();

    public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, Entries);

    public void AddProvider(ILoggerProvider provider)
    {
    }

    public void Dispose()
    {
    }

    /// <summary>A factory whose own logger and whose providers' loggers all write into this capture.</summary>
    public ProviderFactory CreateProviderFactory() => new(new Logger<ProviderFactory>(this), this);

    /// <summary>The secret as written, URL-encoded and JSON-escaped.</summary>
    public static string[] FormsOf(params string[] secrets) =>
        secrets.SelectMany(secret => new[] { secret, Uri.EscapeDataString(secret), JsonSerializer.Serialize(secret)[1..^1] })
            .Distinct()
            .ToArray();

    public void AssertNoSecret(string[] needles, string console = "")
    {
        foreach (var needle in needles)
        {
            var leaked = Entries.FirstOrDefault(e => e.Text.Contains(needle, StringComparison.Ordinal));
            Assert.True(leaked == null, $"A secret reached the log at {leaked?.Category} ({leaked?.Level}): {leaked?.Text}");
            Assert.DoesNotContain(needle, console, StringComparison.Ordinal);
        }
    }

    private sealed class CaptureLogger(string category, ConcurrentQueue<Entry> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var text = new StringBuilder(formatter(state, exception));
            if (state is IEnumerable<KeyValuePair<string, object?>> pairs)
            {
                foreach (var pair in pairs)
                {
                    text.Append('\n').Append(pair.Key).Append('=').Append(pair.Value);
                }
            }
            for (var e = exception; e != null; e = e.InnerException)
            {
                text.Append('\n').Append(e.ToString());
                foreach (System.Collections.DictionaryEntry item in e.Data)
                {
                    text.Append('\n').Append(item.Key).Append('=').Append(item.Value);
                }
            }
            entries.Enqueue(new Entry(category, logLevel, exception?.GetType().FullName, text.ToString()));
        }
    }
}

/// <summary>
/// A wrong password answered by a real broker never reaches a log or the console, on a connection test and on a
/// connect, as the password itself, URL-encoded, JSON-escaped or as the Basic header the management client sends.
/// </summary>
[Collection(RabbitMqCollection.Name)]
public sealed class RabbitMQConnectionFailureLogTests(RabbitMqFixture fixture)
{
    private const string WrongPassword = "SENTINEL+PASS/52d8=";

    private ServiceBusConnection WrongPasswordConnection() => new()
    {
        Id = Guid.NewGuid().ToString(),
        Name = "wrong-password",
        ProviderType = ProviderType.RabbitMQ,
        HostName = fixture.Host,
        Port = fixture.AmqpPort,
        ManagementPort = fixture.ManagementPort,
        UserName = fixture.Username,
        Password = WrongPassword,
    };

    private string[] Needles => CapturingLoggerFactory.FormsOf(
        WrongPassword,
        Convert.ToBase64String(Encoding.ASCII.GetBytes($"{fixture.Username}:{WrongPassword}")));

    private static async Task<string> CaptureConsoleAsync(Func<Task> act)
    {
        var console = new StringWriter();
        var originalOut = Console.Out;
        Console.SetOut(TextWriter.Synchronized(console));
        try
        {
            await act();
        }
        finally
        {
            Console.SetOut(originalOut);
        }
        return console.ToString();
    }

    [Fact]
    public async Task A_connection_test_the_broker_refuses_for_a_wrong_password_never_writes_the_password()
    {
        var capture = new CapturingLoggerFactory();
        var result = true;

        var console = await CaptureConsoleAsync(async () =>
            result = await capture.CreateProviderFactory().TestConnectionAsync(WrongPasswordConnection()));

        Assert.False(result);
        Assert.Contains("[RabbitMQ] Management API returned Unauthorized", console, StringComparison.Ordinal);
        capture.AssertNoSecret(Needles, console);
    }

    [Fact]
    public async Task A_connect_the_broker_refuses_for_a_wrong_password_never_logs_the_password()
    {
        var capture = new CapturingLoggerFactory();

        var console = await CaptureConsoleAsync(() =>
            Assert.ThrowsAsync<BrokerUnreachableException>(() => capture.CreateProviderFactory().CreateConnectedProviderAsync(WrongPasswordConnection())));

        var failure = capture.Entries.FirstOrDefault(e => e.Category == typeof(ProviderFactory).FullName && e.Level == LogLevel.Error);
        Assert.True(failure != null, "The refused connect was not logged by the factory.");
        Assert.Equal(typeof(BrokerUnreachableException).FullName, failure.ExceptionType);
        Assert.Contains("ACCESS_REFUSED", failure.Text, StringComparison.Ordinal);
        capture.AssertNoSecret(Needles, console);
    }
}

/// <summary>
/// A wrong shared access key never reaches a log on a connection test against the emulator. The emulator accepts
/// any key, so the test pins that it answers success and that the success path logs no key either.
/// </summary>
[Collection(AzureServiceBusCollection.Name)]
public sealed class AzureConnectionFailureLogTests(AzureServiceBusFixture fixture)
{
    private const string WrongKey = "SENTINEL+KEY/0f3c=";

    [Fact]
    public async Task A_connection_test_with_a_wrong_key_is_accepted_by_the_emulator_and_never_logs_the_key()
    {
        var capture = new CapturingLoggerFactory();
        var connectionString = Regex.Replace(fixture.ManagementConnectionString, "SharedAccessKey=[^;]*", "SharedAccessKey=" + WrongKey);
        Assert.Contains(WrongKey, connectionString, StringComparison.Ordinal);

        var result = await capture.CreateProviderFactory().TestConnectionAsync(new ServiceBusConnection
        {
            Name = "wrong-key",
            ProviderType = ProviderType.AzureServiceBus,
            ConnectionString = connectionString,
        });

        Assert.True(result, "The emulator refused a wrong key; extend this test to the failure it now answers.");
        Assert.Contains(capture.Entries, e => e.Category == typeof(AzureServiceBusProvider).FullName && e.Text.Contains("connection test succeeded", StringComparison.Ordinal));
        capture.AssertNoSecret(CapturingLoggerFactory.FormsOf(WrongKey));
    }
}
