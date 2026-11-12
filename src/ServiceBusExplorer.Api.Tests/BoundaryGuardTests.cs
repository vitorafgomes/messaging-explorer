using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The Host filter and the API_SECRET fail-fast fire on the inputs they exist for.
/// </summary>
public class BoundaryGuardTests
{
    [Theory]
    [InlineData("http://evil.example", HttpStatusCode.BadRequest)]
    [InlineData("http://127.0.0.1", HttpStatusCode.OK)]
    public async Task A_foreign_Host_is_refused(string baseAddress, HttpStatusCode expected)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(baseAddress) });
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync("/api/connections");

        Assert.Equal(expected, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("0123456789abcdef0123456789abcde")]
    public void The_API_does_not_start_without_a_32_character_API_SECRET(string? secret)
    {
        var psi = new ProcessStartInfo(
            Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet",
            $"\"{Path.Combine(AppContext.BaseDirectory, "ServiceBusExplorer.Api.dll")}\"")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.Environment.Remove("API_SECRET");
        if (secret != null)
            psi.Environment["API_SECRET"] = secret;
        psi.Environment["ASPNETCORE_URLS"] = "http://127.0.0.1:0";
        psi.Environment["SERVICEBUS_DATA_PATH"] = Path.Combine(Path.GetTempPath(), "sbx-secret-" + Guid.NewGuid().ToString("N"));

        using var process = Process.Start(psi)!;
        try
        {
            var exited = process.WaitForExit(TimeSpan.FromSeconds(15));

            Assert.True(exited, "The API was still running 15 s after start; the API_SECRET fail-fast did not fire.");
            Assert.Equal(1, process.ExitCode);
        }
        finally
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
    }
}
