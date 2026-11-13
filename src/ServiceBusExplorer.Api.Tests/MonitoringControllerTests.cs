using System.Net;
using System.Text.Json;

namespace ServiceBusExplorer.Api.Tests;

public class MonitoringControllerTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public MonitoringControllerTests(ApiFactory factory) => _factory = factory;

    [Theory]
    [InlineData(-5)]
    [InlineData(0)]
    public async Task A_history_count_below_one_answers_the_history_instead_of_failing_the_request(int count)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        var response = await client.GetAsync($"/api/monitoring/history?count={count}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Array, body.RootElement.ValueKind);
    }
}
