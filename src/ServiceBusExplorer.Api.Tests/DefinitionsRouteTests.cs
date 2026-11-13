using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ServiceBusExplorer.Api.Controllers;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using static ServiceBusExplorer.Api.Tests.EntityAdministrationTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// <c>POST api/namespace/export</c> and <c>POST api/namespace/import</c> as the web app calls them: what reaches the
/// provider, what is refused before it, and the exact body that comes back.
/// </summary>
public class DefinitionsRouteTests
{
    private const string Sentinel = "BROKER-DETAIL-SENTINEL";
    private const string ConstantBody = "{\"message\":\"An internal error occurred.\"}";

    private const string Document = """
        {
          "version": 1,
          "exportedAt": "2026-11-13T10:00:00+00:00",
          "producedBy": "a field this version does not know",
          "entities": {
            "queues": [
              { "name": "orders", "options": { "lockDuration": "00:00:45", "maxDeliveryCount": 5, "status": "Disabled", "durable": false, "additionalOptions": { "x-max-length": 1 } } }
            ],
            "topics": [
              {
                "name": "billing",
                "options": { "supportOrdering": true },
                "subscriptions": [
                  { "name": "audit", "options": { "filterExpression": "1=1", "routingKey": "#" }, "rules": [ { "name": "high-value", "filterType": "Sql", "sqlExpression": "total > 100" } ] }
                ]
              }
            ]
          }
        }
        """;

    private static readonly EntityDefinitionsDocument Exported = new()
    {
        Version = 1,
        ExportedAt = DateTimeOffset.Parse("2026-11-13T10:00:00+00:00"),
        Entities = new EntityDefinitions
        {
            Queues = [new QueueDefinition { Name = "orders", Options = new QueueCreateOptions { LockDuration = TimeSpan.FromSeconds(45), ForwardTo = "", Status = "Active" } }],
            Topics =
            [
                new TopicDefinition
                {
                    Name = "billing",
                    Options = new TopicCreateOptions { SupportOrdering = true, Status = "Active" },
                    Subscriptions = [new SubscriptionDefinition { Name = "audit", Options = new SubscriptionCreateOptions { MaxDeliveryCount = 10 }, Rules = [new SubscriptionRuleInfo { Name = "$Default", FilterType = RuleFilterType.True }] }]
                }
            ]
        }
    };

    private static readonly DefinitionsImportResult DryRunResult = new()
    {
        DryRun = true,
        Items =
        [
            new DefinitionImportItem { Kind = DefinitionEntityKind.Queue, Name = "orders", Outcome = DefinitionImportOutcome.Differs, DifferingFields = ["maxDeliveryCount"] },
            new DefinitionImportItem { Kind = DefinitionEntityKind.Subscription, Name = "audit", Topic = "billing", Outcome = DefinitionImportOutcome.Create }
        ]
    };

    private static object? ProviderAnswers(MethodInfo m, object?[] _) => m.Name switch
    {
        nameof(IMessagingProvider.ExportDefinitionsAsync) => Task.FromResult(Exported),
        nameof(IMessagingProvider.ImportDefinitionsAsync) => Task.FromResult(DryRunResult),
        _ => null
    };

    private static JsonElement Json(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    private static string Message(Answered answered) => Json(answered.Body).GetProperty("message").GetString()!;

    [Fact]
    public async Task Export_answers_the_providers_document_and_hands_it_the_request_token()
    {
        var answered = await SendAsync("POST", "/api/namespace/export", null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(nameof(IMessagingProvider.ExportDefinitionsAsync), call.Method);
        Assert.True(call.Args.OfType<CancellationToken>().Single().CanBeCanceled);
        var body = Json(answered.Body);
        Assert.Equal(1, body.GetProperty("version").GetInt32());
        var queue = body.GetProperty("entities").GetProperty("queues")[0];
        Assert.Equal(("orders", "00:00:45", "Active"), (queue.GetProperty("name").GetString(), queue.GetProperty("options").GetProperty("lockDuration").GetString(), queue.GetProperty("options").GetProperty("status").GetString()));
        var rule = body.GetProperty("entities").GetProperty("topics")[0].GetProperty("subscriptions")[0].GetProperty("rules")[0];
        Assert.Equal(("$Default", "True"), (rule.GetProperty("name").GetString(), rule.GetProperty("filterType").GetString()));
    }

    [Theory]
    [InlineData("durable")]
    [InlineData("autoDelete")]
    [InlineData("additionalOptions")]
    [InlineData("exchangeType")]
    [InlineData("filterExpression")]
    [InlineData("routingKey")]
    public async Task The_exported_document_carries_no_untyped_or_RabbitMQ_only_option(string field)
    {
        var answered = await SendAsync("POST", "/api/namespace/export", null, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.DoesNotContain($"\"{field}\"", answered.Body);
    }

    [Fact]
    public async Task Import_without_dryRun_is_a_dry_run_and_hands_the_provider_the_document_as_read_and_the_request_token()
    {
        var answered = await SendAsync("POST", "/api/namespace/import", Document, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(nameof(IMessagingProvider.ImportDefinitionsAsync), call.Method);
        Assert.True(call.Args.OfType<bool>().Single());
        Assert.True(call.Args.OfType<CancellationToken>().Single().CanBeCanceled);
        var document = call.Args.OfType<EntityDefinitionsDocument>().Single();
        var queue = document.Entities!.Queues![0]!;
        Assert.Equal((1, "orders", TimeSpan.FromSeconds(45), 5, "Disabled"), (document.Version, queue.Name, queue.Options!.LockDuration, queue.Options.MaxDeliveryCount, queue.Options.Status));
        var subscription = document.Entities.Topics![0]!.Subscriptions![0]!;
        Assert.Equal(("audit", RuleFilterType.Sql, "total > 100"), (subscription.Name, subscription.Rules![0]!.FilterType, subscription.Rules[0]!.SqlExpression));
        Assert.Equal("""{"dryRun":true,"items":[{"kind":"Queue","name":"orders","topic":null,"outcome":"Differs","differingFields":["maxDeliveryCount"],"reason":null},{"kind":"Subscription","name":"audit","topic":"billing","outcome":"Create","differingFields":null,"reason":null}]}""", answered.Body);
    }

    [Fact]
    public async Task Import_never_binds_an_untyped_or_RabbitMQ_only_option_from_the_document()
    {
        var answered = await SendAsync("POST", "/api/namespace/import", Document, ProviderAnswers);

        var document = Assert.Single(answered.Calls).Args.OfType<EntityDefinitionsDocument>().Single();
        var queue = document.Entities!.Queues![0]!.Options!;
        var subscription = document.Entities.Topics![0]!.Subscriptions![0]!.Options!;
        Assert.Equal((null, true, null, null), (queue.AdditionalOptions, queue.Durable, subscription.FilterExpression, subscription.RoutingKey));
    }

    [Theory]
    [InlineData("?dryRun=true", true)]
    [InlineData("?dryRun=false", false)]
    public async Task Import_creates_only_when_dryRun_is_exactly_false(string query, bool dryRun)
    {
        var answered = await SendAsync("POST", "/api/namespace/import" + query, Document, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal(dryRun, Assert.Single(answered.Calls).Args.OfType<bool>().Single());
    }

    [Fact]
    public async Task A_dryRun_that_is_not_true_or_false_answers_400_and_the_provider_is_never_called()
    {
        var answered = await SendAsync("POST", "/api/namespace/import?dryRun=no", Document, ProviderAnswers);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("dryRun must be true or false.", Message(answered));
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_document_over_10_MB_answers_413_and_the_provider_is_never_called(bool withLength)
    {
        var oversized = "{\"version\":1,\"entities\":{},\"padding\":\"" + new string('x', NamespaceController.MaxImportBytes) + "\"}";
        HttpContent Content()
        {
            var bytes = Encoding.UTF8.GetBytes(oversized);
            return withLength ? new ByteArrayContent(bytes) : new StreamContent(new UnknownLengthStream(bytes));
        }

        var answered = await SendAsync("POST", "/api/namespace/import", null, ProviderAnswers, content: Content);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, answered.Status);
        Assert.Equal("The document must be at most 10 MB.", Message(answered));
        Assert.Empty(answered.Calls);
    }

    [Fact]
    public async Task A_document_just_under_10_MB_is_read()
    {
        var prefix = "{\"version\":1,\"entities\":{},\"padding\":\"";
        var body = prefix + new string('x', NamespaceController.MaxImportBytes - prefix.Length - 2) + "\"}";

        var answered = await SendAsync("POST", "/api/namespace/import", body, ProviderAnswers);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Single(answered.Calls);
    }

    /// <summary>A body sent without a Content-Length, so the server reads it to its end to learn its size.</summary>
    private sealed class UnknownLengthStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override bool CanSeek => false;
    }

    [Theory]
    [InlineData("{\"version\":1,", "The document is not valid JSON, or a value has the wrong type, at $.")]
    [InlineData("""{"version":1,"entities":{"queues":[{"name":"orders","options":{"lockDuration":45}}]}}""", "The document is not valid JSON, or a value has the wrong type, at $.entities.queues[0].options.lockDuration.")]
    [InlineData("""{"version":"one"}""", "The document is not valid JSON, or a value has the wrong type, at $.version.")]
    [InlineData("null", "The document is empty.")]
    public async Task A_body_that_is_not_a_document_answers_400_naming_where_and_the_provider_is_never_called(string body, string message)
    {
        var answered = await SendAsync("POST", "/api/namespace/import", body, ProviderAnswers);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal(message, Message(answered));
        Assert.Empty(answered.Calls);
    }

    [Fact]
    public async Task A_document_the_provider_refuses_answers_400_with_its_violations()
    {
        const string violations = "entities.queues[0]: lockDuration must be between 00:00:05 and 00:05:00.";
        var answered = await SendAsync("POST", "/api/namespace/import", Document,
            Fails(nameof(IMessagingProvider.ImportDefinitionsAsync), new InvalidEntityConfigurationException([violations])));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal(violations, Message(answered));
    }

    [Theory]
    [InlineData("/api/namespace/export", nameof(IMessagingProvider.ExportDefinitionsAsync))]
    [InlineData("/api/namespace/import?dryRun=false", nameof(IMessagingProvider.ImportDefinitionsAsync))]
    public async Task Any_other_failure_answers_the_constant_500_without_the_broker_text(string path, string providerMethod)
    {
        var answered = await SendAsync("POST", path, Document, Fails(providerMethod, new InvalidOperationException(Sentinel)));

        Assert.Equal((HttpStatusCode.InternalServerError, ConstantBody), (answered.Status, answered.Body));
    }

    [Theory]
    [InlineData("/api/namespace/export")]
    [InlineData("/api/namespace/import?dryRun=false")]
    public async Task A_provider_without_definitions_answers_400_and_is_never_called(string path)
    {
        var answered = await SendAsync("POST", path, Document, ProviderAnswers, ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("This provider does not support entity definitions.", Message(answered));
        Assert.Empty(answered.Calls);
    }

    [Theory]
    [InlineData("/api/namespace/export")]
    [InlineData("/api/namespace/import")]
    public async Task Without_a_connection_both_routes_answer_400(string path)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.PostAsync(path, new StringContent(Document, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("No messaging provider connected. Please connect to a provider first.", Json(await response.Content.ReadAsStringAsync()).GetProperty("message").GetString());
    }

    [Theory]
    [InlineData("/api/namespace/export")]
    [InlineData("/api/namespace/import")]
    public async Task Both_routes_without_the_api_key_are_refused_with_401(string path)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(path, new StringContent(Document, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("AzureServiceBus", true)]
    [InlineData("RabbitMQ", false)]
    public async Task The_capabilities_answer_says_whether_the_provider_has_definitions(string providerType, bool supported)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync($"/api/connections/providers/{providerType}/capabilities");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(supported, Json(await response.Content.ReadAsStringAsync()).GetProperty("supportsDefinitions").GetBoolean());
    }
}
