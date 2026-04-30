using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// Boots the ServiceBusExplorer.Api via WebApplicationFactory with a
/// per-test-run isolated data directory and a fixed API secret.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IDisposable
{
    public const string TestApiSecret = "0123456789abcdef0123456789abcdef";
    public string DataPath { get; }

    public ApiFactory()
    {
        DataPath = Path.Combine(Path.GetTempPath(), "sbx-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(DataPath);
        Environment.SetEnvironmentVariable("API_SECRET", TestApiSecret);
        Environment.SetEnvironmentVariable("SERVICEBUS_DATA_PATH", DataPath);
        // Avoid Kestrel binding when running via TestServer
        Environment.SetEnvironmentVariable("ASPNETCORE_URLS", "http://127.0.0.1:0");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Re-assert env vars here: other fixtures may have overwritten them.
        Environment.SetEnvironmentVariable("API_SECRET", TestApiSecret);
        Environment.SetEnvironmentVariable("SERVICEBUS_DATA_PATH", DataPath);
        Environment.SetEnvironmentVariable("ASPNETCORE_URLS", "http://127.0.0.1:0");
        builder.UseEnvironment("Development");
    }

    public async Task SeedConnectionAsync(ServiceBusConnection connection)
    {
        using var scope = Services.CreateScope();
        var manager = scope.ServiceProvider.GetRequiredService<IConnectionManager>();
        await manager.SaveConnectionAsync(connection);
    }

    // Intentionally no directory cleanup: Path.GetTempPath is safe to leak, and
    // aggressive deletion races with other fixtures still holding the handle.
}
