using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.ErrorBodyTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// The fields the provider fills reach the JSON the web app reads, under the names it reads them by.
/// </summary>
public class EntityJsonContractTests
{
    private static readonly QueueInfo Queue = new()
    {
        Name = "orders",
        Status = "Active",
        LockDuration = TimeSpan.FromSeconds(45),
        ForwardTo = "orders-archive",
        ForwardDeadLetteredMessagesTo = "orders-poison",
        AutoDeleteOnIdle = TimeSpan.FromDays(7),
        EnableBatchedOperations = true,
        UserMetadata = "owned by billing",
        RequiresDuplicateDetection = true,
        DuplicateDetectionHistoryTimeWindow = TimeSpan.FromMinutes(10),
        MaxMessageSizeInKilobytes = 1024,
        TransferDeadLetterMessageCount = 14
    };

    private static readonly MessageInfo Message = new()
    {
        MessageId = "m-1",
        Body = "price €12",
        SequenceNumber = 7,
        State = "Scheduled",
        SizeInBytes = 11
    };

    private static async Task<JsonElement> WithConnectedProviderAsync(Func<HttpClient, Task<HttpResponseMessage>> call)
    {
        var provider = StubProxy.For<IMessagingProvider>(m => m.Name switch
        {
            "get_ProviderType" => ProviderType.AzureServiceBus,
            "get_CurrentTarget" => "fake-target",
            "get_IsConnected" => true,
            "DisconnectAsync" => Task.CompletedTask,
            "DisposeAsync" => ValueTask.CompletedTask,
            nameof(IMessagingProvider.GetQueueAsync) => Task.FromResult<IQueueEntity?>(Queue),
            nameof(IMessagingProvider.PeekMessagesAsync) => Task.FromResult<IEnumerable<IMessage>>(new List<IMessage> { Message }),
            nameof(IMessagingProvider.SearchMessagesAsync) => Task.FromResult(new MessageSearchResult { Messages = new List<IMessage> { Message }, TotalPeeked = 1, TotalMatches = 1 }),
            _ => throw new NotSupportedException(m.Name)
        });
        var providerFactory = StubProxy.For<IProviderFactory>(m => m.Name == nameof(IProviderFactory.CreateConnectedProviderAsync)
            ? Task.FromResult(provider)
            : throw new NotSupportedException());
        using var baseFactory = new ApiFactory();
        using var factory = baseFactory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton(providerFactory)));
        await factory.Services.GetRequiredService<IConnectionManager>()
            .SaveConnectionAsync(new ServiceBusConnection { Id = "c1", Name = "fake", ConnectionString = "Endpoint=sb://fake/" });
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        try
        {
            using var connected = await client.PostAsync("/api/connections/c1/connect", null);
            Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
            using var response = await call(client);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return doc.RootElement.Clone();
        }
        finally
        {
            using var _ = await client.PostAsync("/api/connections/disconnect", null);
        }
    }

    private static JsonElement Field(JsonElement owner, string name)
    {
        Assert.True(owner.TryGetProperty(name, out var value), $"The JSON has no '{name}' field: {owner}");
        return value;
    }

    [Fact]
    public async Task One_queue_answers_forward_to_auto_delete_duplicate_detection_user_metadata_batched_operations_max_message_size_and_transfer_dead_letter_count()
    {
        var queue = await WithConnectedProviderAsync(c => c.GetAsync("/api/queues/orders"));

        Assert.Equal("orders-archive", Field(queue, "forwardTo").GetString());
        Assert.Equal("orders-poison", Field(queue, "forwardDeadLetteredMessagesTo").GetString());
        Assert.Equal("7.00:00:00", Field(queue, "autoDeleteOnIdle").GetString());
        Assert.True(Field(queue, "enableBatchedOperations").GetBoolean());
        Assert.Equal("owned by billing", Field(queue, "userMetadata").GetString());
        Assert.True(Field(queue, "requiresDuplicateDetection").GetBoolean());
        Assert.Equal("00:10:00", Field(queue, "duplicateDetectionHistoryTimeWindow").GetString());
        Assert.Equal(1024, Field(queue, "maxMessageSizeInKilobytes").GetInt64());
        Assert.Equal(14, Field(queue, "transferDeadLetterMessageCount").GetInt64());
        Assert.Equal("Active", Field(queue, "status").GetString());
        Assert.Equal("00:00:45", Field(queue, "lockDuration").GetString());
    }

    [Fact]
    public async Task A_peeked_message_carries_its_state_and_size_in_bytes()
    {
        var messages = await WithConnectedProviderAsync(c => c.GetAsync("/api/queues/orders/messages?count=1"));

        var message = Assert.Single(messages.EnumerateArray());
        Assert.Equal("Scheduled", Field(message, "state").GetString());
        Assert.Equal(11, Field(message, "sizeInBytes").GetInt64());
    }

    [Fact]
    public async Task A_searched_message_carries_its_state_and_size_in_bytes()
    {
        var result = await WithConnectedProviderAsync(c => c.PostAsJsonAsync("/api/queues/orders/messages/search", new MessageSearchRequest { Count = 1 }));

        var message = Assert.Single(Field(result, "messages").EnumerateArray());
        Assert.Equal("Scheduled", Field(message, "state").GetString());
        Assert.Equal(11, Field(message, "sizeInBytes").GetInt64());
    }
}
