using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ServiceBusExplorer.Api.Logs;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The lines the Logs screen reads: what the backend logged since it started, kept in memory, never with the text
/// of an exception, and behind the key like every other route.
/// </summary>
public class RecentLogTests
{
    private const string Sentinel = "Endpoint=sb://secret.example/;SharedAccessKey=SENTINEL-KEY-91f2";

    private static ILogger Logger(RecentLogStore store, string category) => store.CreateLogger(category);

    [Fact]
    public void A_logged_line_keeps_its_time_level_source_and_words_and_of_an_exception_only_its_type_and_where_it_was_thrown()
    {
        var store = new RecentLogStore(() => new DateTimeOffset(2026, 11, 19, 10, 42, 7, TimeSpan.Zero));
        Exception thrown;
        try { throw new NotSupportedException(Sentinel, new InvalidOperationException(Sentinel)); }
        catch (Exception ex) { thrown = ex; }

        Logger(store, "ServiceBusExplorer.Api.Controllers.QueuesController").LogError(thrown, "Peek of {Queue} failed", "orders");

        var line = Assert.Single(store.After(0));
        Assert.Equal((1L, "Error", "Backend", "QueuesController", "Peek of orders failed", "NotSupportedException <- InvalidOperationException"),
            (line.Id, line.Level, line.Source, line.Category, line.Text, line.ErrorType));
        Assert.Equal(new DateTimeOffset(2026, 11, 19, 10, 42, 7, TimeSpan.Zero), line.Time);
        Assert.Contains(nameof(A_logged_line_keeps_its_time_level_source_and_words_and_of_an_exception_only_its_type_and_where_it_was_thrown), line.Where);
        Assert.DoesNotContain("SENTINEL", JsonSerializer.Serialize(store.After(0)));
    }

    [Fact]
    public void Information_is_kept_for_this_application_only_warnings_and_errors_for_every_category_and_debug_for_none()
    {
        var store = new RecentLogStore();

        Logger(store, "ServiceBusExplorer.Core.Providers.ProviderFactory").LogInformation("connected");
        Logger(store, "Microsoft.AspNetCore.Hosting.Diagnostics").LogInformation("request finished");
        Logger(store, "Microsoft.AspNetCore.Server.Kestrel").LogWarning("slow");
        Logger(store, "ServiceBusExplorer.Api.Program").LogDebug("noise");

        Assert.Equal(["connected", "slow"], store.After(0).Select(l => l.Text));
    }

    [Fact]
    public void Only_the_last_two_thousand_lines_are_kept_a_long_line_is_cut_and_a_reader_asks_for_what_came_after_the_last_it_saw()
    {
        var store = new RecentLogStore();
        var logger = Logger(store, "ServiceBusExplorer.Api.Test");
        for (var i = 1; i <= 2005; i++) logger.LogWarning("line {Number}", i);
        logger.LogWarning("{Long}", new string('x', 5000));

        var all = store.After(0);
        Assert.Equal(2000, all.Count);
        Assert.Equal("line 7", all[0].Text);
        Assert.Equal(1000, all[^1].Text.Length);
        Assert.Equal(["line 2005", all[^1].Text], store.After(2004).Select(l => l.Text));

        store.Clear();
        Assert.Empty(store.After(0));
    }

    [Fact]
    public async Task The_route_answers_the_lines_only_with_the_key_names_a_request_that_failed_and_clears_on_delete()
    {
        using var factory = new ApiFactory();
        using var anonymous = factory.CreateClient();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/logs")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/connections/no-such-connection?secret=" + Uri.EscapeDataString(Sentinel))).StatusCode);

        using var answered = JsonDocument.Parse(await client.GetStringAsync("/api/logs"));
        var request = answered.RootElement.EnumerateArray().Single(l => l.GetProperty("text").GetString()!.StartsWith("GET /api/connections/no-such-connection answered 404", StringComparison.Ordinal));
        Assert.Equal(("Warning", "Backend"), (request.GetProperty("level").GetString(), request.GetProperty("source").GetString()));
        Assert.DoesNotContain("SENTINEL", answered.RootElement.GetRawText());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/logs")).StatusCode);
        Assert.DoesNotContain(factory.Services.GetRequiredService<RecentLogStore>().After(0), l => l.Text.Contains("no-such-connection", StringComparison.Ordinal));
    }

    [Fact]
    public void No_log_call_of_the_application_formats_the_message_of_an_exception_into_its_words()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "ServiceBusExplorer.slnx"))) root = root.Parent;
        Assert.NotNull(root);
        var call = new System.Text.RegularExpressions.Regex(@"\.Log(Information|Warning|Error|Critical|Debug)\((?<arguments>[^;]*);");
        var found = new[] { "ServiceBusExplorer.Api", "ServiceBusExplorer.Core" }
            .SelectMany(project => Directory.EnumerateFiles(Path.Combine(root!.FullName, "src", project), "*.cs", SearchOption.AllDirectories))
            .Where(file => !file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .SelectMany(file => call.Matches(File.ReadAllText(file)).Select(match => (File: Path.GetFileName(file), Call: match.Value)))
            .Where(logged => logged.Call.Contains(".Message", StringComparison.Ordinal) || logged.Call.Contains(".StackTrace", StringComparison.Ordinal) || logged.Call.Contains("ex.ToString()", StringComparison.Ordinal))
            .Where(logged => !(logged.File == "EntityAdministrationResults.cs" && logged.Call.Contains("The broker did not return the {SubQueue} messages", StringComparison.Ordinal)))
            .Select(logged => $"{logged.File}: {logged.Call}")
            .ToList();

        Assert.Empty(found);
    }
}
