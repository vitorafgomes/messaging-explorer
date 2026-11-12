using System.Net;
using System.Reflection;
using System.Text;
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
/// Creating, editing and enabling or disabling a queue, topic or subscription through the API: what reaches
/// the provider, what is refused before it, and the answer the web app reads.
/// </summary>
public class EntityAdministrationTests
{
    private const string Sentinel = "BROKER-DETAIL-SENTINEL";
    private const string ConstantBody = "{\"message\":\"An internal error occurred.\"}";
    /// <summary>
    /// A provider that records each call with its arguments and answers through a per-test delegate.
    /// </summary>
    public class RecordingProvider : DispatchProxy
    {
        public List<(string Method, object?[] Args)> Calls { get; } = new();
        public Func<MethodInfo, object?[], object?>? Answer { get; set; }
        public ProviderType Type { get; set; } = ProviderType.AzureServiceBus;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            var m = targetMethod!;
            switch (m.Name)
            {
                case "get_ProviderType": return Type;
                case "get_CurrentTarget": return "fake-target";
                case "get_IsConnected": return false;
                case "DisconnectAsync": return Task.CompletedTask;
                case "DisposeAsync": return ValueTask.CompletedTask;
            }

            Calls.Add((m.Name, args!));
            var answer = Answer?.Invoke(m, args!);
            if (answer is not null) return answer;
            if (m.ReturnType == typeof(Task)) return Task.CompletedTask;
            var result = m.ReturnType.GetGenericArguments()[0];
            return typeof(Task).GetMethod(nameof(Task.FromResult))!.MakeGenericMethod(result).Invoke(null, new object?[] { null });
        }
    }

    private sealed record Answered(HttpStatusCode Status, string Body, Uri? Location, List<(string Method, object?[] Args)> Calls);

    private static async Task<Answered> SendAsync(string method, string path, string? json, Func<MethodInfo, object?[], object?>? answer = null, ProviderType providerType = ProviderType.AzureServiceBus)
    {
        var provider = DispatchProxy.Create<IMessagingProvider, RecordingProvider>();
        var recorder = (RecordingProvider)(object)provider;
        recorder.Answer = answer;
        recorder.Type = providerType;
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
            recorder.Calls.Clear();
            using var request = new HttpRequestMessage(new HttpMethod(method), path);
            if (json is not null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
            using var response = await client.SendAsync(request);
            return new Answered(response.StatusCode, await response.Content.ReadAsStringAsync(), response.Headers.Location, recorder.Calls.ToList());
        }
        finally
        {
            using var _ = await client.PostAsync("/api/connections/disconnect", null);
        }
    }

    [Fact]
    public async Task A_queue_body_with_only_a_name_creates_the_queue_with_the_broker_defaults_and_answers_201()
    {
        var answered = await SendAsync("POST", "/api/queues", """{"name":"orders"}""");

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        Assert.EndsWith("/api/Queues/orders", answered.Location?.ToString());
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.CreateQueueAsync), 1, "orders"), (call.Method, call.Args.Length, call.Args[0]));
    }

    [Fact]
    public async Task A_topic_body_with_only_a_name_creates_the_topic_with_the_broker_defaults_and_answers_201()
    {
        var answered = await SendAsync("POST", "/api/topics", """{"name":"events"}""");

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        Assert.EndsWith("/api/Topics/events", answered.Location?.ToString());
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.CreateTopicAsync), 1, "events"), (call.Method, call.Args.Length, call.Args[0]));
    }

    [Fact]
    public async Task A_subscription_body_with_only_a_name_creates_the_subscription_with_the_broker_defaults_and_answers_201()
    {
        var answered = await SendAsync("POST", "/api/topics/events/subscriptions", """{"name":"audit"}""");

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        Assert.EndsWith("/api/Topics/events/subscriptions/audit", answered.Location?.ToString());
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.CreateSubscriptionAsync), 2, "events", "audit"), (call.Method, call.Args.Length, call.Args[0], call.Args[1]));
    }

    private static Func<MethodInfo, object?[], object?> Fails(string method, Exception error) =>
        (m, _) => m.Name != method ? null
            : m.ReturnType == typeof(Task) ? Task.FromException(error)
            : typeof(Task).GetMethods().Single(f => f.Name == nameof(Task.FromException) && f.IsGenericMethod)
                .MakeGenericMethod(m.ReturnType.GetGenericArguments()[0]).Invoke(null, new object?[] { error });

    private static Func<MethodInfo, object?[], object?> Answers<T>(string method, T value) =>
        (m, _) => m.Name == method ? Task.FromResult(value) : null;

    private static T Options<T>(object?[] args) => Assert.IsType<T>(args.OfType<T>().Single());

    private static JsonElement Json(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    private static string Message(Answered answered) => Json(answered.Body).GetProperty("message").GetString()!;

    [Fact]
    public async Task A_queue_body_with_null_options_creates_the_queue_with_the_broker_defaults()
    {
        var answered = await SendAsync("POST", "/api/queues", """{"name":"orders","options":null}""");

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.CreateQueueAsync), 1), (call.Method, call.Args.Length));
    }

    [Fact]
    public async Task A_queue_is_created_with_every_option_of_its_body()
    {
        const string body = """
            {"name":"orders","options":{"defaultMessageTimeToLive":"00:30:00","lockDuration":"00:00:45","maxDeliveryCount":3,
            "requiresSession":true,"enablePartitioning":true,"deadLetteringOnMessageExpiration":true,"requiresDuplicateDetection":true,
            "duplicateDetectionHistoryTimeWindow":"00:10:00","maxSizeInMegabytes":2048,"autoDeleteOnIdle":"7.00:00:00",
            "enableBatchedOperations":false,"forwardTo":"orders-archive","forwardDeadLetteredMessagesTo":"orders-poison",
            "userMetadata":"owned by billing"}}
            """;

        var answered = await SendAsync("POST", "/api/queues", body);

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal("orders", call.Args[0]);
        var options = Options<QueueCreateOptions>(call.Args);
        Assert.Equal(
            (TimeSpan.FromMinutes(30), TimeSpan.FromSeconds(45), 3, true, true, true, true),
            (options.DefaultMessageTimeToLive, options.LockDuration, options.MaxDeliveryCount, options.RequiresSession, options.EnablePartitioning, options.DeadLetteringOnMessageExpiration, options.RequiresDuplicateDetection));
        Assert.Equal(
            (TimeSpan.FromMinutes(10), 2048L, TimeSpan.FromDays(7), false),
            (options.DuplicateDetectionHistoryTimeWindow, options.MaxSizeInMegabytes, options.AutoDeleteOnIdle, options.EnableBatchedOperations));
        Assert.Equal(("orders-archive", "orders-poison", "owned by billing"), (options.ForwardTo, options.ForwardDeadLetteredMessagesTo, options.UserMetadata));
        Assert.Null(options.AdditionalOptions);
    }

    [Fact]
    public async Task A_topic_is_created_with_every_option_of_its_body()
    {
        const string body = """
            {"name":"events","options":{"defaultMessageTimeToLive":"00:30:00","enablePartitioning":true,"requiresDuplicateDetection":true,
            "duplicateDetectionHistoryTimeWindow":"00:10:00","maxSizeInMegabytes":2048,"autoDeleteOnIdle":"7.00:00:00",
            "enableBatchedOperations":false,"supportOrdering":true,"userMetadata":"owned by billing"}}
            """;

        var answered = await SendAsync("POST", "/api/topics", body);

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        var options = Options<TopicCreateOptions>(Assert.Single(answered.Calls).Args);
        Assert.Equal(
            (TimeSpan.FromMinutes(30), true, true, TimeSpan.FromMinutes(10), 2048L),
            (options.DefaultMessageTimeToLive, options.EnablePartitioning, options.RequiresDuplicateDetection, options.DuplicateDetectionHistoryTimeWindow, options.MaxSizeInMegabytes));
        Assert.Equal(
            (TimeSpan.FromDays(7), false, true, "owned by billing"),
            (options.AutoDeleteOnIdle, options.EnableBatchedOperations, options.SupportOrdering, options.UserMetadata));
    }

    [Fact]
    public async Task A_subscription_is_created_with_every_option_of_its_body_and_no_filter()
    {
        const string body = """
            {"name":"audit","options":{"defaultMessageTimeToLive":"00:30:00","lockDuration":"00:00:45","maxDeliveryCount":3,
            "requiresSession":true,"deadLetteringOnMessageExpiration":true,"deadLetteringOnFilterEvaluationExceptions":false,
            "autoDeleteOnIdle":"7.00:00:00","enableBatchedOperations":false,"forwardTo":"audit-archive",
            "forwardDeadLetteredMessagesTo":"audit-poison","userMetadata":"owned by compliance","filterExpression":"1=0"}}
            """;

        var answered = await SendAsync("POST", "/api/topics/events/subscriptions", body);

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(("events", "audit"), (call.Args[0], call.Args[1]));
        var options = Options<SubscriptionCreateOptions>(call.Args);
        Assert.Equal(
            (TimeSpan.FromMinutes(30), TimeSpan.FromSeconds(45), 3, true, true, false),
            (options.DefaultMessageTimeToLive, options.LockDuration, options.MaxDeliveryCount, options.RequiresSession, options.DeadLetteringOnMessageExpiration, options.DeadLetteringOnFilterEvaluationExceptions));
        Assert.Equal(
            (TimeSpan.FromDays(7), false, "audit-archive", "audit-poison", "owned by compliance"),
            (options.AutoDeleteOnIdle, options.EnableBatchedOperations, options.ForwardTo, options.ForwardDeadLetteredMessagesTo, options.UserMetadata));
        Assert.Null(options.FilterExpression);
    }

    [Theory]
    [InlineData("POST", "/api/queues", """{"name":"orders","options":{"lockDuration":"00:06:00"}}""", "CreateQueueAsync")]
    [InlineData("POST", "/api/topics", """{"name":"events","options":{"lockDuration":"00:06:00"}}""", "CreateTopicAsync")]
    [InlineData("POST", "/api/topics/events/subscriptions", """{"name":"audit","options":{"lockDuration":"00:06:00"}}""", "CreateSubscriptionAsync")]
    [InlineData("PATCH", "/api/queues/orders", """{"lockDuration":"00:06:00"}""", "UpdateQueueAsync")]
    [InlineData("PATCH", "/api/topics/events", """{"status":"ReceiveDisabled"}""", "UpdateTopicAsync")]
    [InlineData("PATCH", "/api/topics/events/subscriptions/audit", """{"lockDuration":"00:06:00"}""", "UpdateSubscriptionAsync")]
    public async Task A_configuration_the_provider_refuses_answers_400_with_the_field_and_the_range_it_named(string method, string path, string body, string providerMethod)
    {
        var violations = new[] { "lockDuration must be between 00:00:05 and 00:05:00.", "maxDeliveryCount must be between 1 and 2000." };

        var answered = await SendAsync(method, path, body, Fails(providerMethod, new InvalidEntityConfigurationException(violations)));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"lockDuration must be between 00:00:05 and 00:05:00. maxDeliveryCount must be between 1 and 2000."}""", answered.Body);
    }

    [Theory]
    [InlineData("/api/queues", """{}""")]
    [InlineData("/api/topics", """{"name":""}""")]
    [InlineData("/api/topics/events/subscriptions", """{"name":"   "}""")]
    public async Task A_body_without_a_name_is_refused_before_the_provider_is_called(string path, string body)
    {
        var answered = await SendAsync("POST", path, body);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("name is required.", Message(answered));
        Assert.Empty(answered.Calls);
    }

    [Fact]
    public async Task Editing_a_queue_sends_only_the_fields_in_the_body_and_answers_the_queue_as_read_after_the_edit()
    {
        var reread = new QueueInfo { Name = "orders", Status = "SendDisabled", LockDuration = TimeSpan.FromMinutes(2), MaxDeliveryCount = 10 };
        const string body = """{"lockDuration":"00:02:00","maxDeliveryCount":10,"forwardTo":"","status":"SendDisabled"}""";

        var answered = await SendAsync("PATCH", "/api/queues/orders", body,
            (m, _) => m.Name == nameof(IMessagingProvider.GetQueueAsync) ? Task.FromResult<IQueueEntity?>(reread) : null);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal(new[] { "UpdateQueueAsync", "GetQueueAsync" }, answered.Calls.Select(c => c.Method));
        var sent = Options<QueueUpdateOptions>(answered.Calls[0].Args);
        Assert.Equal((TimeSpan.FromMinutes(2), 10, "", "SendDisabled"), (sent.LockDuration, sent.MaxDeliveryCount, sent.ForwardTo, sent.Status));
        Assert.Equal(
            ((TimeSpan?)null, (bool?)null, (TimeSpan?)null, (long?)null, (TimeSpan?)null, (bool?)null, (string?)null, (string?)null),
            (sent.DefaultMessageTimeToLive, sent.DeadLetteringOnMessageExpiration, sent.DuplicateDetectionHistoryTimeWindow, sent.MaxSizeInMegabytes, sent.AutoDeleteOnIdle, sent.EnableBatchedOperations, sent.ForwardDeadLetteredMessagesTo, sent.UserMetadata));
        var queue = Json(answered.Body);
        Assert.Equal(("orders", "SendDisabled", "00:02:00", 10), (queue.GetProperty("name").GetString(), queue.GetProperty("status").GetString(), queue.GetProperty("lockDuration").GetString(), queue.GetProperty("maxDeliveryCount").GetInt32()));
    }

    [Fact]
    public async Task Editing_a_topic_answers_the_topic_as_read_after_the_edit()
    {
        var reread = new TopicInfo { Name = "events", Status = "Disabled", SupportOrdering = true };

        var answered = await SendAsync("PATCH", "/api/topics/events", """{"supportOrdering":true,"status":"Disabled"}""",
            (m, _) => m.Name == nameof(IMessagingProvider.GetTopicAsync) ? Task.FromResult<ITopicEntity?>(reread) : null);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal(new[] { "UpdateTopicAsync", "GetTopicAsync" }, answered.Calls.Select(c => c.Method));
        var sent = Options<TopicUpdateOptions>(answered.Calls[0].Args);
        Assert.Equal((true, "Disabled", (long?)null), (sent.SupportOrdering, sent.Status, sent.MaxSizeInMegabytes));
        var topic = Json(answered.Body);
        Assert.Equal(("events", "Disabled", true), (topic.GetProperty("name").GetString(), topic.GetProperty("status").GetString(), topic.GetProperty("supportOrdering").GetBoolean()));
    }

    [Fact]
    public async Task Editing_a_subscription_answers_the_subscription_as_read_after_the_edit()
    {
        var reread = new SubscriptionInfo { TopicName = "events", Name = "audit", Status = "ReceiveDisabled", MaxDeliveryCount = 5 };

        var answered = await SendAsync("PATCH", "/api/topics/events/subscriptions/audit", """{"maxDeliveryCount":5,"status":"ReceiveDisabled"}""",
            (m, _) => m.Name == nameof(IMessagingProvider.GetSubscriptionAsync) ? Task.FromResult<SubscriptionInfo?>(reread) : null);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal(new[] { "UpdateSubscriptionAsync", "GetSubscriptionAsync" }, answered.Calls.Select(c => c.Method));
        Assert.Equal(("events", "audit"), (answered.Calls[0].Args[0], answered.Calls[0].Args[1]));
        var sent = Options<SubscriptionUpdateOptions>(answered.Calls[0].Args);
        Assert.Equal((5, "ReceiveDisabled", (TimeSpan?)null), (sent.MaxDeliveryCount, sent.Status, sent.LockDuration));
        var subscription = Json(answered.Body);
        Assert.Equal(("audit", "ReceiveDisabled", 5), (subscription.GetProperty("name").GetString(), subscription.GetProperty("status").GetString(), subscription.GetProperty("maxDeliveryCount").GetInt32()));
    }

    [Theory]
    [InlineData("POST", "/api/queues", """{"name":"orders"}""", "CreateQueueAsync", "A queue with this name already exists.")]
    [InlineData("POST", "/api/topics", """{"name":"events","options":{"supportOrdering":true}}""", "CreateTopicAsync", "A topic with this name already exists.")]
    [InlineData("POST", "/api/topics/events/subscriptions", """{"name":"audit"}""", "CreateSubscriptionAsync", "A subscription with this name already exists.")]
    public async Task Creating_an_entity_that_already_exists_answers_409(string method, string path, string body, string providerMethod, string message)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new EntityAlreadyExistsException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.Conflict, answered.Status);
        Assert.Equal(message, Message(answered));
        Assert.DoesNotContain(Sentinel, answered.Body);
    }

    [Theory]
    [InlineData("POST", "/api/topics/missing/subscriptions", """{"name":"audit"}""", "CreateSubscriptionAsync", "The topic was not found.")]
    [InlineData("PATCH", "/api/queues/missing", """{"maxDeliveryCount":5}""", "UpdateQueueAsync", "The queue was not found.")]
    [InlineData("PATCH", "/api/topics/missing", """{"supportOrdering":true}""", "UpdateTopicAsync", "The topic was not found.")]
    [InlineData("PATCH", "/api/topics/events/subscriptions/missing", """{"maxDeliveryCount":5}""", "UpdateSubscriptionAsync", "The subscription was not found.")]
    public async Task A_missing_entity_answers_404_with_a_message(string method, string path, string body, string providerMethod, string message)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new EntityNotFoundException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.NotFound, answered.Status);
        Assert.Equal(message, Message(answered));
        Assert.DoesNotContain(Sentinel, answered.Body);
    }

    [Fact]
    public async Task An_entity_gone_before_the_read_after_the_edit_answers_404()
    {
        var answered = await SendAsync("PATCH", "/api/queues/orders", """{"maxDeliveryCount":5}""");

        Assert.Equal(HttpStatusCode.NotFound, answered.Status);
        Assert.Equal("The queue was not found.", Message(answered));
    }

    [Theory]
    [InlineData("POST", "/api/queues", """{"name":"orders","options":{"maxSizeInMegabytes":3000}}""", "CreateQueueAsync")]
    [InlineData("PATCH", "/api/queues/orders", """{"maxSizeInMegabytes":3000}""", "UpdateQueueAsync")]
    [InlineData("PATCH", "/api/topics/events", """{"maxSizeInMegabytes":3000}""", "UpdateTopicAsync")]
    [InlineData("PATCH", "/api/topics/events/subscriptions/audit", """{"lockDuration":"00:01:00"}""", "UpdateSubscriptionAsync")]
    public async Task A_configuration_the_broker_refuses_answers_400_with_the_fixed_message_and_no_broker_text(string method, string path, string body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new InvalidEntityConfigurationException(new ArgumentException(Sentinel))));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"The broker refused this configuration."}""", answered.Body);
    }

    [Theory]
    [InlineData("POST", "/api/queues", """{"name":"orders"}""", "CreateQueueAsync")]
    [InlineData("POST", "/api/topics/events/subscriptions", """{"name":"audit","options":{"lockDuration":"00:01:00"}}""", "CreateSubscriptionAsync")]
    [InlineData("PATCH", "/api/queues/orders", """{"maxDeliveryCount":5}""", "UpdateQueueAsync")]
    [InlineData("PATCH", "/api/topics/events", """{"supportOrdering":true}""", "UpdateTopicAsync")]
    [InlineData("PATCH", "/api/topics/events/subscriptions/audit", """{"maxDeliveryCount":5}""", "UpdateSubscriptionAsync")]
    public async Task Any_other_failure_answers_500_with_the_constant_body(string method, string path, string body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new InvalidOperationException(Sentinel)));

        Assert.Equal(HttpStatusCode.InternalServerError, answered.Status);
        Assert.Equal(ConstantBody, answered.Body);
    }

    [Theory]
    [InlineData("/api/queues/orders", """{"maxDeliveryCount":5}""", "UpdateQueueAsync")]
    [InlineData("/api/topics/events", """{"supportOrdering":true}""", "UpdateTopicAsync")]
    [InlineData("/api/topics/events/subscriptions/audit", """{"maxDeliveryCount":5}""", "UpdateSubscriptionAsync")]
    public async Task A_provider_that_cannot_update_answers_400_does_not_support(string path, string body, string providerMethod)
    {
        var answered = await SendAsync("PATCH", path, body, Fails(providerMethod, new NotSupportedException(Sentinel)));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This provider does not support updating entities."}""", answered.Body);
    }

    [Theory]
    [InlineData("/api/queues/orders")]
    [InlineData("/api/topics/events")]
    [InlineData("/api/topics/events/subscriptions/audit")]
    public async Task An_edit_without_the_api_key_is_refused_with_401(string path)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Patch, path) { Content = new StringContent("""{"status":"Disabled"}""", Encoding.UTF8, "application/json") };

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("AzureServiceBus", true)]
    [InlineData("RabbitMQ", false)]
    [InlineData("0", true)]
    [InlineData("1", false)]
    public async Task The_capabilities_say_whether_the_provider_can_update_entities(string providerType, bool expected)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync($"/api/connections/providers/{providerType}/capabilities");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(expected, Json(await response.Content.ReadAsStringAsync()).GetProperty("supportsEntityUpdate").GetBoolean());
    }

    [Theory]
    [InlineData("/api/queues", """{"name":"my queue"}""", "CreateQueueAsync", "my queue")]
    [InlineData("/api/queues", """{"name":"orders#1"}""", "CreateQueueAsync", "orders#1")]
    [InlineData("/api/topics", """{"name":"orders#1"}""", "CreateTopicAsync", "orders#1")]
    [InlineData("/api/topics/events/subscriptions", """{"name":"billing.orders.created.v2.handled-by-the-invoice-service"}""", "CreateSubscriptionAsync", "billing.orders.created.v2.handled-by-the-invoice-service")]
    public async Task A_rabbitmq_name_main_accepted_reaches_the_provider_unchanged_and_answers_201(string path, string body, string providerMethod, string name)
    {
        var answered = await SendAsync("POST", path, body, providerType: ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal(providerMethod, call.Method);
        Assert.Equal(name, call.Args.OfType<string>().Last());
    }

    [Fact]
    public async Task A_rabbitmq_queue_with_options_outside_the_azure_limits_reaches_the_provider_unchanged()
    {
        var answered = await SendAsync("POST", "/api/queues", """{"name":"my queue","options":{"lockDuration":"00:06:00","maxDeliveryCount":5000}}""", providerType: ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        var options = Options<QueueCreateOptions>(Assert.Single(answered.Calls).Args);
        Assert.Equal((TimeSpan.FromMinutes(6), 5000), (options.LockDuration, options.MaxDeliveryCount));
    }

    private const string Rules = "/api/topics/events/subscriptions/audit/rules";

    private static SubscriptionRuleInfo SqlRule() => new()
    {
        Name = "physical-goods",
        FilterType = RuleFilterType.Sql,
        SqlExpression = "category = 'physical' AND total > 0",
        SqlAction = "SET priority = 'normal'"
    };

    private static SubscriptionRuleInfo CorrelationRule() => new()
    {
        Name = "by-tenant",
        FilterType = RuleFilterType.Correlation,
        Correlation = new CorrelationFilterInfo
        {
            Subject = "order.created",
            ApplicationProperties =
            [
                new() { Name = "tenant", Type = RulePropertyType.String, Value = "contoso-uk" },
                new() { Name = "priority", Type = RulePropertyType.Int64, Value = "3" },
                new() { Name = "ratio", Type = RulePropertyType.Double, Value = "2.5" },
                new() { Name = "urgent", Type = RulePropertyType.Boolean, Value = "true" }
            ]
        }
    };

    private const string SqlRuleJson =
        """{"name":"physical-goods","filterType":"Sql","sqlExpression":"category = 'physical' AND total > 0","correlation":null,"sqlAction":"SET priority = 'normal'"}""";

    private const string CorrelationRuleJson =
        """{"name":"by-tenant","filterType":"Correlation","sqlExpression":null,"correlation":{"correlationId":null,"messageId":null,"to":null,"replyTo":null,"subject":"order.created","sessionId":null,"replyToSessionId":null,"contentType":null,"applicationProperties":[{"name":"tenant","type":"String","value":"contoso-uk"},{"name":"priority","type":"Int64","value":"3"},{"name":"ratio","type":"Double","value":"2.5"},{"name":"urgent","type":"Boolean","value":"true"}]},"sqlAction":null}""";

    [Fact]
    public async Task The_rules_of_a_subscription_are_answered_with_their_filter_type_in_the_contract_shape()
    {
        var answered = await SendAsync("GET", Rules, null,
            Answers<IReadOnlyList<SubscriptionRuleInfo>>(nameof(IMessagingProvider.GetRulesAsync), [SqlRule(), CorrelationRule()]));

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal($"[{SqlRuleJson},{CorrelationRuleJson}]", answered.Body);
        Assert.Equal(("events", "audit"), (answered.Calls[0].Args[0], answered.Calls[0].Args[1]));
    }

    [Fact]
    public async Task A_subscription_is_answered_with_its_rules_in_the_same_shape()
    {
        var subscription = new SubscriptionInfo { TopicName = "events", Name = "audit", Rules = [SqlRule(), CorrelationRule()] };

        var answered = await SendAsync("GET", "/api/topics/events/subscriptions/audit", null,
            Answers<SubscriptionInfo?>(nameof(IMessagingProvider.GetSubscriptionAsync), subscription));

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal($"[{SqlRuleJson},{CorrelationRuleJson}]", Json(answered.Body).GetProperty("rules").GetRawText());
    }

    [Fact]
    public async Task A_rabbitmq_subscription_is_answered_with_its_routing_key_as_a_read_only_RoutingKey_rule()
    {
        var subscription = new SubscriptionInfo { TopicName = "orders", Name = "billing", Rules = [new() { Name = "RoutingKey", FilterType = RuleFilterType.RoutingKey, SqlExpression = "orders.*" }] };

        var answered = await SendAsync("GET", "/api/topics/orders/subscriptions/billing", null,
            Answers<SubscriptionInfo?>(nameof(IMessagingProvider.GetSubscriptionAsync), subscription), ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("""[{"name":"RoutingKey","filterType":"RoutingKey","sqlExpression":"orders.*","correlation":null,"sqlAction":null}]""",
            Json(answered.Body).GetProperty("rules").GetRawText());
    }

    [Fact]
    public async Task Adding_a_rule_hands_the_provider_the_rule_of_the_body_and_answers_201_with_the_rule_as_stored()
    {
        const string body = """
            {"name":"by-tenant","filterType":"Correlation","correlation":{"subject":"order.created","applicationProperties":[
            {"name":"tenant","type":"String","value":"contoso-uk"},{"name":"priority","type":"Int64","value":"3"},
            {"name":"ratio","type":"Double","value":"2.5"},{"name":"urgent","type":"Boolean","value":"true"}]},"sqlAction":null}
            """;

        var answered = await SendAsync("POST", Rules, body, Answers(nameof(IMessagingProvider.CreateRuleAsync), CorrelationRule()));

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        Assert.EndsWith("/api/Topics/events/subscriptions/audit/rules", answered.Location?.ToString());
        Assert.Equal(CorrelationRuleJson, answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.CreateRuleAsync), "events", "audit"), (call.Method, call.Args[0], call.Args[1]));
        Assert.Equivalent(CorrelationRule(), Options<SubscriptionRuleInfo>(call.Args), strict: true);
    }

    [Fact]
    public async Task Replacing_a_rule_hands_the_provider_the_rule_name_of_the_path_and_answers_200_with_the_rule_as_stored()
    {
        const string body = """{"filterType":"Sql","sqlExpression":"category = 'physical' AND total > 0","sqlAction":"SET priority = 'normal'"}""";

        var answered = await SendAsync("PUT", $"{Rules}/physical-goods", body, Answers(nameof(IMessagingProvider.UpdateRuleAsync), SqlRule()));

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal(SqlRuleJson, answered.Body);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.UpdateRuleAsync), "events", "audit", "physical-goods"), (call.Method, call.Args[0], call.Args[1], call.Args[2]));
        var sent = Options<SubscriptionRuleInfo>(call.Args);
        Assert.Equal(((string?)null, RuleFilterType.Sql, "category = 'physical' AND total > 0", "SET priority = 'normal'"), (sent.Name, sent.FilterType, sent.SqlExpression, sent.SqlAction));
    }

    [Fact]
    public async Task A_replacement_whose_body_has_the_rule_name_of_the_path_is_accepted()
    {
        var answered = await SendAsync("PUT", $"{Rules}/physical-goods", """{"name":"physical-goods","filterType":"True"}""",
            Answers(nameof(IMessagingProvider.UpdateRuleAsync), SqlRule()));

        Assert.Equal(HttpStatusCode.OK, answered.Status);
        Assert.Equal("physical-goods", Assert.Single(answered.Calls).Args[2]);
    }

    [Fact]
    public async Task A_replacement_whose_body_names_another_rule_is_refused_naming_the_field_before_the_provider_is_called()
    {
        var answered = await SendAsync("PUT", $"{Rules}/physical-goods", """{"name":"digital-goods","filterType":"True"}""");

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"name must be absent or equal to the rule name in the path; a rule cannot be renamed."}""", answered.Body);
        Assert.Empty(answered.Calls);
    }

    [Fact]
    public async Task Deleting_a_rule_deletes_that_rule_and_answers_204()
    {
        var answered = await SendAsync("DELETE", $"{Rules}/physical-goods", null);

        Assert.Equal(HttpStatusCode.NoContent, answered.Status);
        var call = Assert.Single(answered.Calls);
        Assert.Equal((nameof(IMessagingProvider.DeleteRuleAsync), "events", "audit", "physical-goods"), (call.Method, call.Args[0], call.Args[1], call.Args[2]));
    }

    [Fact]
    public async Task A_filter_type_or_a_property_type_outside_the_set_reaches_the_provider_as_missing_instead_of_failing_binding()
    {
        const string body = """
            {"name":"orders","filterType":"Bogus","correlation":{"applicationProperties":[{"name":"total","type":"Decimal","value":"1"},{"name":"count","type":"1","value":"1"}]}}
            """;

        var answered = await SendAsync("POST", Rules, body, Answers(nameof(IMessagingProvider.CreateRuleAsync), SqlRule()));

        Assert.Equal(HttpStatusCode.Created, answered.Status);
        var sent = Options<SubscriptionRuleInfo>(Assert.Single(answered.Calls).Args);
        Assert.Null(sent.FilterType);
        Assert.Equal(new RulePropertyType?[] { null, null }, sent.Correlation!.ApplicationProperties!.Select(p => p.Type));
    }

    [Theory]
    [InlineData("POST", Rules, """{"name":"orders","filterType":"True"}""", "CreateRuleAsync")]
    [InlineData("PUT", Rules + "/orders", """{"filterType":"True"}""", "UpdateRuleAsync")]
    public async Task A_rule_outside_the_contract_answers_400_with_the_field_the_provider_named(string method, string path, string body, string providerMethod)
    {
        var violations = new[] { "sqlExpression is required for filterType Sql and must be 1 to 1024 characters." };

        var answered = await SendAsync(method, path, body, Fails(providerMethod, new InvalidEntityConfigurationException(violations)));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"sqlExpression is required for filterType Sql and must be 1 to 1024 characters."}""", answered.Body);
    }

    [Theory]
    [InlineData("POST", Rules, """{"name":"orders","filterType":"Sql","sqlExpression":"this is (( not sql"}""", "CreateRuleAsync")]
    [InlineData("PUT", Rules + "/orders", """{"filterType":"Sql","sqlExpression":"this is (( not sql"}""", "UpdateRuleAsync")]
    public async Task A_rule_the_broker_refuses_answers_400_with_the_fixed_text_and_nothing_of_the_broker(string method, string path, string body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, InvalidEntityConfigurationException.RuleRefused(new ArgumentException(Sentinel))));

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"The broker refused this rule. Check the expression."}""", answered.Body);
    }

    [Fact]
    public async Task Adding_a_rule_whose_name_exists_answers_409()
    {
        var answered = await SendAsync("POST", Rules, """{"name":"orders","filterType":"True"}""",
            Fails(nameof(IMessagingProvider.CreateRuleAsync), new EntityAlreadyExistsException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.Conflict, answered.Status);
        Assert.Equal("""{"message":"A rule with this name already exists."}""", answered.Body);
    }

    [Theory]
    [InlineData("GET", Rules, null, "GetRulesAsync", "The subscription was not found.")]
    [InlineData("POST", Rules, """{"name":"orders","filterType":"True"}""", "CreateRuleAsync", "The subscription was not found.")]
    [InlineData("PUT", Rules + "/orders", """{"filterType":"True"}""", "UpdateRuleAsync", "The rule was not found.")]
    [InlineData("DELETE", Rules + "/orders", null, "DeleteRuleAsync", "The rule was not found.")]
    public async Task A_missing_subscription_or_rule_answers_404(string method, string path, string? body, string providerMethod, string message)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new EntityNotFoundException(new Exception(Sentinel))));

        Assert.Equal(HttpStatusCode.NotFound, answered.Status);
        Assert.Equal($$"""{"message":"{{message}}"}""", answered.Body);
    }

    [Theory]
    [InlineData("GET", Rules, null, "GetRulesAsync")]
    [InlineData("POST", Rules, """{"name":"orders","filterType":"True"}""", "CreateRuleAsync")]
    [InlineData("PUT", Rules + "/orders", """{"filterType":"True"}""", "UpdateRuleAsync")]
    [InlineData("DELETE", Rules + "/orders", null, "DeleteRuleAsync")]
    public async Task Any_other_rule_failure_such_as_a_busy_broker_answers_500_with_the_constant_body(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new TimeoutException(Sentinel)));

        Assert.Equal(HttpStatusCode.InternalServerError, answered.Status);
        Assert.Equal(ConstantBody, answered.Body);
    }

    [Theory]
    [InlineData("GET", Rules, null, "GetRulesAsync")]
    [InlineData("POST", Rules, """{"name":"orders","filterType":"True"}""", "CreateRuleAsync")]
    [InlineData("PUT", Rules + "/orders", """{"filterType":"True"}""", "UpdateRuleAsync")]
    [InlineData("DELETE", Rules + "/orders", null, "DeleteRuleAsync")]
    public async Task A_provider_without_rules_answers_400_does_not_support_subscription_rules(string method, string path, string? body, string providerMethod)
    {
        var answered = await SendAsync(method, path, body, Fails(providerMethod, new NotSupportedException(Sentinel)), ProviderType.RabbitMQ);

        Assert.Equal(HttpStatusCode.BadRequest, answered.Status);
        Assert.Equal("""{"message":"This provider does not support subscription rules."}""", answered.Body);
    }

    [Theory]
    [InlineData("GET", Rules)]
    [InlineData("POST", Rules)]
    [InlineData("PUT", Rules + "/orders")]
    [InlineData("DELETE", Rules + "/orders")]
    public async Task A_rule_request_without_the_api_key_is_refused_with_401(string method, string path)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method is "POST" or "PUT") request.Content = new StringContent("""{"name":"orders","filterType":"True"}""", Encoding.UTF8, "application/json");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("AzureServiceBus", true)]
    [InlineData("RabbitMQ", false)]
    public async Task The_capabilities_say_whether_the_provider_has_subscription_rules(string providerType, bool expected)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiFactory.TestApiSecret);

        using var response = await client.GetAsync($"/api/connections/providers/{providerType}/capabilities");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(expected, Json(await response.Content.ReadAsStringAsync()).GetProperty("supportsSubscriptionRules").GetBoolean());
    }
}
