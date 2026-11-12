using System.Net;
using System.Text.Json;

namespace ServiceBusExplorer.Api.Tests;

public class ClearAllTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public ClearAllTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Clear_all_recovers_an_unreadable_workspace()
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);
        File.WriteAllText(Path.Combine(_factory.DataPath, "workspace.json"), "{ \"Connections\": [ CORRUPT-SENTINEL");
        using var unreadable = await client.GetAsync("/api/connections");
        Assert.Equal(HttpStatusCode.InternalServerError, unreadable.StatusCode);

        using var cleared = await client.DeleteAsync("/api/connections/clear-all");

        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        using var body = JsonDocument.Parse(await cleared.Content.ReadAsStringAsync());
        Assert.Equal(0, body.RootElement.GetProperty("connectionsDeleted").GetInt32());
        Assert.Equal(0, body.RootElement.GetProperty("groupsDeleted").GetInt32());
        using var after = await client.GetAsync("/api/connections");
        Assert.Equal(HttpStatusCode.OK, after.StatusCode);
        using var list = JsonDocument.Parse(await after.Content.ReadAsStringAsync());
        Assert.Equal(0, list.RootElement.GetArrayLength());
    }
}
