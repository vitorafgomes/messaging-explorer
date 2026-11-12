using System.Globalization;
using Azure;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Moq;
using ServiceBusExplorer.Core.Abstractions;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;

namespace ServiceBusExplorer.Core.Tests.Providers.Azure;

/// <summary>
/// The rules of a subscription: how a stored rule is shown, and adding, replacing and deleting one against a mocked
/// <see cref="ServiceBusAdministrationClient"/>; also the subscription created with a filter in one call.
/// </summary>
public class AzureServiceBusProviderRuleTests
{
    private const string BrokerText = "BROKER-DETAIL-SENTINEL";
    private const string RuleRefusal = "The broker refused this rule. Check the expression.";

    private static Task<Response<T>> Ok<T>(T value) => Task.FromResult(Response.FromValue(value, Mock.Of<Response>()));

    private static ServiceBusException Broker(ServiceBusFailureReason reason) => new(BrokerText, reason);

    private static T Throw<T>(Exception error) => throw error;

    private static AsyncPageable<RuleProperties> Pages(params RuleProperties[] rules) =>
        AsyncPageable<RuleProperties>.FromPages([Page<RuleProperties>.FromValues(rules, null, Mock.Of<Response>())]);

    private static IEnumerable<Page<RuleProperties>> FailingPages(Exception error)
    {
        yield return Throw<Page<RuleProperties>>(error);
    }

    private static RuleProperties Stored(string name, RuleFilter filter, RuleAction? action = null) =>
        ServiceBusModelFactory.RuleProperties(name, filter, action);

    private static SubscriptionRuleInfo SqlRule(string name = "orders", string expression = "total > 0") =>
        new() { Name = name, FilterType = RuleFilterType.Sql, SqlExpression = expression };

    private static SubscriptionRuleInfo CorrelationRule(params RuleApplicationProperty[] properties) =>
        new() { Name = "orders", FilterType = RuleFilterType.Correlation, Correlation = new CorrelationFilterInfo { Subject = "order.created", ApplicationProperties = properties.ToList() } };

    private static RuleApplicationProperty Property(string? name, RulePropertyType? type, string? value) => new() { Name = name, Type = type, Value = value };

    private static Mock<ServiceBusAdministrationClient> CreatingAdmin(List<CreateRuleOptions> sent, Exception? fails = null)
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.CreateRuleAsync("events", "audit", It.IsAny<CreateRuleOptions>(), It.IsAny<CancellationToken>()))
            .Returns((string _, string _, CreateRuleOptions o, CancellationToken _) =>
            {
                sent.Add(o);
                return fails is null ? Ok(Stored(o.Name, o.Filter, o.Action)) : Task.FromException<Response<RuleProperties>>(fails);
            });
        return admin;
    }

    private static Mock<ServiceBusAdministrationClient> ReplacingAdmin(Func<Task<Response<RuleProperties>>> read, List<RuleProperties> written, Exception? writeFails = null)
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetRuleAsync("events", "audit", "orders", It.IsAny<CancellationToken>())).Returns(read);
        admin.Setup(a => a.UpdateRuleAsync("events", "audit", It.IsAny<RuleProperties>(), It.IsAny<CancellationToken>()))
            .Returns((string _, string _, RuleProperties r, CancellationToken _) =>
            {
                written.Add(r);
                return writeFails is null ? Ok(Stored(r.Name, r.Filter, r.Action)) : Task.FromException<Response<RuleProperties>>(writeFails);
            });
        return admin;
    }

    private static T InCulture<T>(string culture, Func<T> action)
    {
        var previous = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
        try
        {
            return action();
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
        }
    }

    [Fact]
    public void A_sql_rule_is_shown_as_Sql_with_its_expression_and_its_action()
    {
        var shown = AzureServiceBusProvider.MapToSubscriptionRuleInfo(Stored("physical-goods", new SqlRuleFilter("category = 'physical'"), new SqlRuleAction("SET priority = 'normal'")));

        Assert.Equivalent(new SubscriptionRuleInfo
        {
            Name = "physical-goods",
            FilterType = RuleFilterType.Sql,
            SqlExpression = "category = 'physical'",
            SqlAction = "SET priority = 'normal'"
        }, shown, strict: true);
    }

    [Fact]
    public void A_correlation_rule_is_shown_with_every_field_and_each_property_typed_as_invariant_text()
    {
        var filter = new CorrelationRuleFilter
        {
            CorrelationId = "c-1", MessageId = "m-1", To = "billing", ReplyTo = "replies", Subject = "order.created",
            SessionId = "s-1", ReplyToSessionId = "rs-1", ContentType = "application/json"
        };
        filter.ApplicationProperties["tenant"] = "contoso-uk";
        filter.ApplicationProperties["priority"] = 3L;
        filter.ApplicationProperties["ratio"] = 2.5;
        filter.ApplicationProperties["urgent"] = true;
        filter.ApplicationProperties["retries"] = 4;

        var shown = InCulture("de-DE", () => AzureServiceBusProvider.MapToSubscriptionRuleInfo(Stored("by-tenant", filter)));

        Assert.Equivalent(new SubscriptionRuleInfo
        {
            Name = "by-tenant",
            FilterType = RuleFilterType.Correlation,
            Correlation = new CorrelationFilterInfo
            {
                CorrelationId = "c-1", MessageId = "m-1", To = "billing", ReplyTo = "replies", Subject = "order.created",
                SessionId = "s-1", ReplyToSessionId = "rs-1", ContentType = "application/json",
                ApplicationProperties =
                [
                    Property("tenant", RulePropertyType.String, "contoso-uk"),
                    Property("priority", RulePropertyType.Int64, "3"),
                    Property("ratio", RulePropertyType.Double, "2.5"),
                    Property("urgent", RulePropertyType.Boolean, "true"),
                    Property("retries", RulePropertyType.Other, "4")
                ]
            }
        }, shown, strict: true);
    }

    public static TheoryData<RuleFilter, RuleFilterType> TrueAndFalse => new()
    {
        { new TrueRuleFilter(), RuleFilterType.True },
        { new FalseRuleFilter(), RuleFilterType.False }
    };

    [Theory]
    [MemberData(nameof(TrueAndFalse))]
    public void A_true_or_false_rule_is_shown_as_True_or_False_and_never_as_a_sql_filter(RuleFilter filter, RuleFilterType expected)
    {
        var shown = AzureServiceBusProvider.MapToSubscriptionRuleInfo(Stored("$Default", filter));

        Assert.Equal((expected, (string?)null, (CorrelationFilterInfo?)null), (shown.FilterType, shown.SqlExpression, shown.Correlation));
    }

    [Fact]
    public async Task Listing_the_rules_shows_each_one_with_its_filter_type()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetRulesAsync("events", "audit", It.IsAny<CancellationToken>()))
            .Returns(Pages(Stored("$Default", new TrueRuleFilter()), Stored("orders", new SqlRuleFilter("total > 0"))));

        var rules = await AzureServiceBusProvider.GetRulesCoreAsync(admin.Object, "events", "audit", CancellationToken.None);

        Assert.Equal(
            new (string?, RuleFilterType?, string?)[] { ("$Default", RuleFilterType.True, null), ("orders", RuleFilterType.Sql, "total > 0") },
            rules.Select(r => (r.Name, r.FilterType, r.SqlExpression)));
    }

    [Fact]
    public async Task A_subscription_whose_last_rule_was_deleted_lists_no_rule()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetRulesAsync("events", "audit", It.IsAny<CancellationToken>())).Returns(Pages());
        admin.Setup(a => a.SubscriptionExistsAsync("events", "audit", It.IsAny<CancellationToken>())).Returns(Ok(true));

        var rules = await AzureServiceBusProvider.GetRulesCoreAsync(admin.Object, "events", "audit", CancellationToken.None);

        Assert.Empty(rules);
    }

    [Fact]
    public async Task The_rules_of_a_subscription_the_broker_lists_as_missing_report_not_found()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetRulesAsync("events", "missing", It.IsAny<CancellationToken>()))
            .Returns(AsyncPageable<RuleProperties>.FromPages(FailingPages(Broker(ServiceBusFailureReason.MessagingEntityNotFound))));

        var error = await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            AzureServiceBusProvider.GetRulesCoreAsync(admin.Object, "events", "missing", CancellationToken.None));

        Assert.DoesNotContain(BrokerText, error.Message);
    }

    [Fact]
    public async Task The_rules_of_a_subscription_listed_empty_under_a_missing_topic_report_not_found()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetRulesAsync("missing", "audit", It.IsAny<CancellationToken>())).Returns(Pages());
        admin.Setup(a => a.SubscriptionExistsAsync("missing", "audit", It.IsAny<CancellationToken>())).Returns(Ok(false));

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            AzureServiceBusProvider.GetRulesCoreAsync(admin.Object, "missing", "audit", CancellationToken.None));
    }

    [Fact]
    public async Task A_listing_that_fails_because_the_broker_is_busy_reaches_the_caller_unchanged()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetRulesAsync("events", "audit", It.IsAny<CancellationToken>()))
            .Returns(AsyncPageable<RuleProperties>.FromPages(FailingPages(Broker(ServiceBusFailureReason.ServiceBusy))));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.GetRulesCoreAsync(admin.Object, "events", "audit", CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task An_existence_check_after_an_empty_listing_that_fails_because_the_broker_is_busy_reaches_the_caller_unchanged()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.GetRulesAsync("events", "audit", It.IsAny<CancellationToken>())).Returns(Pages());
        admin.Setup(a => a.SubscriptionExistsAsync("events", "audit", It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<bool>>(Broker(ServiceBusFailureReason.ServiceBusy)));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.GetRulesCoreAsync(admin.Object, "events", "audit", CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task Adding_a_sql_rule_with_an_action_sends_them_in_one_create_and_returns_the_rule_as_stored()
    {
        var sent = new List<CreateRuleOptions>();
        var admin = CreatingAdmin(sent);

        var stored = await AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit",
            new SubscriptionRuleInfo { Name = "physical-goods", FilterType = RuleFilterType.Sql, SqlExpression = "category = 'physical'", SqlAction = "SET priority = 'normal'" },
            CancellationToken.None);

        var options = Assert.Single(sent);
        Assert.Equal(("physical-goods", "category = 'physical'", "SET priority = 'normal'"),
            (options.Name, Assert.IsType<SqlRuleFilter>(options.Filter).SqlExpression, Assert.IsType<SqlRuleAction>(options.Action).SqlExpression));
        Assert.Equal(("physical-goods", RuleFilterType.Sql, "category = 'physical'", "SET priority = 'normal'"),
            (stored.Name, stored.FilterType, stored.SqlExpression, stored.SqlAction));
    }

    [Fact]
    public async Task Adding_a_correlation_rule_sends_every_field_and_each_property_as_its_declared_type_read_in_the_invariant_culture()
    {
        var sent = new List<CreateRuleOptions>();
        var admin = CreatingAdmin(sent);
        var rule = new SubscriptionRuleInfo
        {
            Name = "by-tenant",
            FilterType = RuleFilterType.Correlation,
            Correlation = new CorrelationFilterInfo
            {
                CorrelationId = "c-1", MessageId = "m-1", To = "billing", ReplyTo = "replies", Subject = "order.created",
                SessionId = "s-1", ReplyToSessionId = "rs-1", ContentType = "application/json",
                ApplicationProperties =
                [
                    Property("tenant", RulePropertyType.String, "contoso-uk"),
                    Property("priority", RulePropertyType.Int64, "-3"),
                    Property("ratio", RulePropertyType.Double, "2.5"),
                    Property("urgent", RulePropertyType.Boolean, "true")
                ]
            }
        };

        await InCulture("de-DE", () => AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit", rule, CancellationToken.None));

        var filter = Assert.IsType<CorrelationRuleFilter>(Assert.Single(sent).Filter);
        Assert.Equal(
            ("c-1", "m-1", "billing", "replies", "order.created", "s-1", "rs-1", "application/json"),
            (filter.CorrelationId, filter.MessageId, filter.To, filter.ReplyTo, filter.Subject, filter.SessionId, filter.ReplyToSessionId, filter.ContentType));
        Assert.Equal(
            new Dictionary<string, object> { ["tenant"] = "contoso-uk", ["priority"] = -3L, ["ratio"] = 2.5, ["urgent"] = true },
            filter.ApplicationProperties);
        Assert.Null(Assert.Single(sent).Action);
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("True", true)]
    [InlineData("FALSE", false)]
    public async Task A_boolean_property_is_accepted_in_any_case_and_sent_as_a_real_boolean(string written, bool sentValue)
    {
        var sent = new List<CreateRuleOptions>();
        var admin = CreatingAdmin(sent);

        await AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit",
            CorrelationRule(Property("urgent", RulePropertyType.Boolean, written)), CancellationToken.None);

        Assert.Equal(sentValue, Assert.IsType<bool>(Assert.IsType<CorrelationRuleFilter>(Assert.Single(sent).Filter).ApplicationProperties["urgent"]));
    }

    public static TheoryData<RuleFilterType, Type> NoExpressionFilters => new()
    {
        { RuleFilterType.True, typeof(TrueRuleFilter) },
        { RuleFilterType.False, typeof(FalseRuleFilter) }
    };

    [Theory]
    [MemberData(nameof(NoExpressionFilters))]
    public async Task A_true_or_false_rule_is_added_with_that_filter_and_its_action(RuleFilterType type, Type expected)
    {
        var sent = new List<CreateRuleOptions>();
        var admin = CreatingAdmin(sent);

        await AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit",
            new SubscriptionRuleInfo { Name = "stamp", FilterType = type, SqlAction = "SET stamped = TRUE" }, CancellationToken.None);

        var options = Assert.Single(sent);
        Assert.Equal((expected, "SET stamped = TRUE"), (options.Filter.GetType(), Assert.IsType<SqlRuleAction>(options.Action).SqlExpression));
    }

    [Fact]
    public async Task An_empty_action_is_no_action()
    {
        var sent = new List<CreateRuleOptions>();
        var admin = CreatingAdmin(sent);

        await AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit",
            new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.Sql, SqlExpression = "total > 0", SqlAction = "" }, CancellationToken.None);

        Assert.Null(Assert.Single(sent).Action);
    }

    [Fact]
    public async Task A_rule_at_every_limit_is_added()
    {
        var sent = new List<CreateRuleOptions>();
        var admin = CreatingAdmin(sent);
        var rule = new SubscriptionRuleInfo
        {
            Name = new string('r', 50),
            FilterType = RuleFilterType.Correlation,
            Correlation = new CorrelationFilterInfo
            {
                Subject = new string('s', 128),
                ApplicationProperties = [Property(new string('p', 128), RulePropertyType.Double, "-1.5E3")]
            },
            SqlAction = "SET x = '" + new string('a', 1014) + "'"
        };

        await AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit", rule, CancellationToken.None);
        await AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit", SqlRule("$Default", new string('x', 1024)), CancellationToken.None);

        Assert.Equal([new string('r', 50), "$Default"], sent.Select(o => o.Name));
        Assert.Equal(-1500.0, Assert.IsType<CorrelationRuleFilter>(sent[0].Filter).ApplicationProperties[new string('p', 128)]);
        Assert.Equal(1024, Assert.IsType<SqlRuleAction>(sent[0].Action).SqlExpression.Length);
    }

    public static TheoryData<string, SubscriptionRuleInfo, string> RulesOutsideTheContract => new()
    {
        { "no name", SqlRule(name: null!), "name must be 1 to 50 characters of letters, digits, '.', '-' or '_', or $Default." },
        { "a 51-character name", SqlRule(name: new string('r', 51)), "name must be 1 to 50 characters of letters, digits, '.', '-' or '_', or $Default." },
        { "a name with a slash", SqlRule(name: "a/b"), "name must be 1 to 50 characters of letters, digits, '.', '-' or '_', or $Default." },
        { "the reserved name in lower case", SqlRule(name: "$default"), "name must be 1 to 50 characters of letters, digits, '.', '-' or '_', or $Default." },
        { "no filter type", new SubscriptionRuleInfo { Name = "orders", SqlExpression = "a = 1" }, "filterType must be one of Sql, Correlation, True, False." },
        { "the read-only RoutingKey filter type", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.RoutingKey, SqlExpression = "orders.*" }, "filterType must be one of Sql, Correlation, True, False." },
        { "a sql filter without an expression", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.Sql }, "sqlExpression is required for filterType Sql and must be 1 to 1024 characters." },
        { "a sql filter with a blank expression", SqlRule(expression: "   "), "sqlExpression is required for filterType Sql and must be 1 to 1024 characters." },
        { "a 1025-character expression", SqlRule(expression: new string('x', 1025)), "sqlExpression is required for filterType Sql and must be 1 to 1024 characters." },
        { "a true filter with an expression", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.True, SqlExpression = "1=1" }, "sqlExpression must be null unless filterType is Sql." },
        { "a sql filter with a correlation", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.Sql, SqlExpression = "a = 1", Correlation = new CorrelationFilterInfo { Subject = "x" } }, "correlation must be null unless filterType is Correlation." },
        { "a correlation filter without a correlation", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.Correlation }, "correlation is required for filterType Correlation." },
        { "a correlation with only blank fields and no property", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.Correlation, Correlation = new CorrelationFilterInfo { Subject = "  ", CorrelationId = "" } }, "correlation must set at least one field or one application property." },
        { "a 129-character subject", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.Correlation, Correlation = new CorrelationFilterInfo { Subject = new string('s', 129) } }, "correlation.subject must be at most 128 characters." },
        { "a 1025-character action", new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.True, SqlAction = new string('a', 1025) }, "sqlAction must be at most 1024 characters." },
        { "a property without a name", CorrelationRule(Property("", RulePropertyType.String, "x")), "correlation.applicationProperties[0].name must be 1 to 128 characters." },
        { "a property with a 129-character name", CorrelationRule(Property(new string('p', 129), RulePropertyType.String, "x")), "correlation.applicationProperties[0].name must be 1 to 128 characters." },
        { "two properties with one name", CorrelationRule(Property("tenant", RulePropertyType.String, "a"), Property("tenant", RulePropertyType.String, "b")), "correlation.applicationProperties[1].name must be unique in the list." },
        { "a property without a type", CorrelationRule(Property("tenant", null, "x")), "correlation.applicationProperties[0].type must be one of String, Int64, Double, Boolean." },
        { "a property of type Other", CorrelationRule(Property("when", RulePropertyType.Other, "2026-11-12")), "correlation.applicationProperties[0].type Other is read-only and cannot be written." },
        { "an Int64 that is not whole", CorrelationRule(Property("priority", RulePropertyType.Int64, "3.5")), "correlation.applicationProperties[0].value of 'priority' must be a whole number (Int64)." },
        { "a Double with a decimal comma", CorrelationRule(Property("ratio", RulePropertyType.Double, "1,5")), "correlation.applicationProperties[0].value of 'ratio' must be a finite number with '.' as the decimal point (Double)." },
        { "a Double that is not a number", CorrelationRule(Property("ratio", RulePropertyType.Double, "NaN")), "correlation.applicationProperties[0].value of 'ratio' must be a finite number with '.' as the decimal point (Double)." },
        { "a Boolean spelled yes", CorrelationRule(Property("urgent", RulePropertyType.Boolean, "yes")), "correlation.applicationProperties[0].value of 'urgent' must be true or false (Boolean)." },
        { "a String without a value", CorrelationRule(Property("tenant", RulePropertyType.String, null)), "correlation.applicationProperties[0].value of 'tenant' must be a string (String)." }
    };

    [Theory]
    [MemberData(nameof(RulesOutsideTheContract))]
    public async Task A_rule_outside_the_contract_is_refused_naming_the_field_and_nothing_reaches_the_broker(string description, SubscriptionRuleInfo rule, string message)
    {
        var admin = new Mock<ServiceBusAdministrationClient>();

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit", rule, CancellationToken.None));

        Assert.Equal($"{description}: {message}", $"{description}: {error.Message}");
        Assert.Empty(admin.Invocations);
    }

    [Fact]
    public async Task A_replace_or_a_delete_of_a_rule_name_outside_the_contract_is_refused_and_nothing_reaches_the_broker()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();

        var replace = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            AzureServiceBusProvider.UpdateRuleCoreAsync(admin.Object, "events", "audit", "a/b", SqlRule(), CancellationToken.None));
        var delete = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            AzureServiceBusProvider.DeleteRuleCoreAsync(admin.Object, "events", "audit", new string('r', 51), CancellationToken.None));

        Assert.All(new[] { replace, delete }, e => Assert.Equal("name must be 1 to 50 characters of letters, digits, '.', '-' or '_', or $Default.", e.Message));
        Assert.Empty(admin.Invocations);
    }

    [Fact]
    public async Task Adding_a_rule_whose_name_exists_reports_already_exists_without_the_broker_text()
    {
        var admin = CreatingAdmin([], Broker(ServiceBusFailureReason.MessagingEntityAlreadyExists));

        var error = await Assert.ThrowsAsync<EntityAlreadyExistsException>(() =>
            AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit", SqlRule(), CancellationToken.None));

        Assert.DoesNotContain(BrokerText, error.Message);
    }

    [Fact]
    public async Task Adding_a_rule_to_a_missing_subscription_reports_not_found()
    {
        var admin = CreatingAdmin([], Broker(ServiceBusFailureReason.MessagingEntityNotFound));

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit", SqlRule(), CancellationToken.None));
    }

    [Fact]
    public async Task A_rule_the_broker_refuses_reports_the_fixed_rule_refusal_with_the_broker_text_only_inside()
    {
        var admin = CreatingAdmin([], new ArgumentException(BrokerText));

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit", SqlRule(expression: "this is (( not sql"), CancellationToken.None));

        Assert.Equal(RuleRefusal, error.Message);
        Assert.Equal(BrokerText, error.InnerException?.Message);
    }

    [Fact]
    public async Task An_add_that_fails_because_the_broker_is_busy_reaches_the_caller_unchanged()
    {
        var admin = CreatingAdmin([], Broker(ServiceBusFailureReason.ServiceBusy));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.CreateRuleCoreAsync(admin.Object, "events", "audit", SqlRule(), CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task Replacing_a_rule_keeps_its_name_changes_its_filter_and_action_and_returns_it_as_stored()
    {
        var written = new List<RuleProperties>();
        var admin = ReplacingAdmin(() => Ok(Stored("orders", new SqlRuleFilter("total > 0"), new SqlRuleAction("SET checked = TRUE"))), written);
        var replacement = new SubscriptionRuleInfo
        {
            Name = "renamed",
            FilterType = RuleFilterType.Correlation,
            Correlation = new CorrelationFilterInfo { Subject = "order.created" },
            SqlAction = "SET routed = TRUE"
        };

        var stored = await AzureServiceBusProvider.UpdateRuleCoreAsync(admin.Object, "events", "audit", "orders", replacement, CancellationToken.None);

        var sent = Assert.Single(written);
        Assert.Equal(("orders", "order.created", "SET routed = TRUE"),
            (sent.Name, Assert.IsType<CorrelationRuleFilter>(sent.Filter).Subject, Assert.IsType<SqlRuleAction>(sent.Action).SqlExpression));
        Assert.Equal(("orders", RuleFilterType.Correlation, "order.created", "SET routed = TRUE"),
            (stored.Name, stored.FilterType, stored.Correlation?.Subject, stored.SqlAction));
    }

    [Fact]
    public async Task Replacing_a_rule_without_an_action_removes_its_action()
    {
        var written = new List<RuleProperties>();
        var admin = ReplacingAdmin(() => Ok(Stored("orders", new SqlRuleFilter("total > 0"), new SqlRuleAction("SET checked = TRUE"))), written);

        await AzureServiceBusProvider.UpdateRuleCoreAsync(admin.Object, "events", "audit", "orders", SqlRule(expression: "total > 10"), CancellationToken.None);

        var sent = Assert.Single(written);
        Assert.Equal(("total > 10", (RuleAction?)null), (Assert.IsType<SqlRuleFilter>(sent.Filter).SqlExpression, sent.Action));
    }

    [Fact]
    public async Task Replacing_a_rule_reads_it_once_and_writes_it_once()
    {
        var written = new List<RuleProperties>();
        var admin = ReplacingAdmin(() => Ok(Stored("orders", new SqlRuleFilter("total > 0"))), written);

        await AzureServiceBusProvider.UpdateRuleCoreAsync(admin.Object, "events", "audit", "orders", SqlRule(), CancellationToken.None);

        Assert.Single(written);
        admin.Verify(a => a.GetRuleAsync("events", "audit", "orders", It.IsAny<CancellationToken>()), Times.Once);
        admin.Verify(a => a.UpdateRuleAsync("events", "audit", It.IsAny<RuleProperties>(), It.IsAny<CancellationToken>()), Times.Once);
        admin.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Replacing_a_missing_rule_reports_not_found_and_writes_nothing()
    {
        var written = new List<RuleProperties>();
        var admin = ReplacingAdmin(() => Task.FromException<Response<RuleProperties>>(Broker(ServiceBusFailureReason.MessagingEntityNotFound)), written);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            AzureServiceBusProvider.UpdateRuleCoreAsync(admin.Object, "events", "audit", "orders", SqlRule(), CancellationToken.None));

        Assert.Empty(written);
    }

    [Fact]
    public async Task A_read_before_a_replace_that_fails_because_the_broker_is_busy_reaches_the_caller_unchanged_and_writes_nothing()
    {
        var written = new List<RuleProperties>();
        var admin = ReplacingAdmin(() => Task.FromException<Response<RuleProperties>>(Broker(ServiceBusFailureReason.ServiceBusy)), written);

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.UpdateRuleCoreAsync(admin.Object, "events", "audit", "orders", SqlRule(), CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
        Assert.Empty(written);
    }

    [Fact]
    public async Task A_replacement_the_broker_refuses_reports_the_fixed_rule_refusal()
    {
        var admin = ReplacingAdmin(() => Ok(Stored("orders", new SqlRuleFilter("total > 0"))), [], new ArgumentException(BrokerText));

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            AzureServiceBusProvider.UpdateRuleCoreAsync(admin.Object, "events", "audit", "orders", SqlRule(expression: "this is (( not sql"), CancellationToken.None));

        Assert.Equal(RuleRefusal, error.Message);
        Assert.Equal(BrokerText, error.InnerException?.Message);
    }

    [Fact]
    public async Task A_replacement_write_that_fails_because_the_broker_is_busy_reaches_the_caller_unchanged()
    {
        var admin = ReplacingAdmin(() => Ok(Stored("orders", new SqlRuleFilter("total > 0"))), [], Broker(ServiceBusFailureReason.ServiceBusy));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.UpdateRuleCoreAsync(admin.Object, "events", "audit", "orders", SqlRule(), CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task Deleting_a_rule_deletes_that_rule_of_that_subscription()
    {
        var deleted = new List<(string, string, string)>();
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.DeleteRuleAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback((string t, string s, string r, CancellationToken _) => deleted.Add((t, s, r)))
            .ReturnsAsync(Mock.Of<Response>());

        await AzureServiceBusProvider.DeleteRuleCoreAsync(admin.Object, "events", "audit", "$Default", CancellationToken.None);

        Assert.Equal([("events", "audit", "$Default")], deleted);
    }

    [Fact]
    public async Task Deleting_a_missing_rule_reports_not_found()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.DeleteRuleAsync("events", "audit", "orders", It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response>(Broker(ServiceBusFailureReason.MessagingEntityNotFound)));

        var error = await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            AzureServiceBusProvider.DeleteRuleCoreAsync(admin.Object, "events", "audit", "orders", CancellationToken.None));

        Assert.DoesNotContain(BrokerText, error.Message);
    }

    [Fact]
    public async Task A_delete_that_fails_because_the_broker_is_busy_reaches_the_caller_unchanged()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.DeleteRuleAsync("events", "audit", "orders", It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response>(Broker(ServiceBusFailureReason.ServiceBusy)));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.DeleteRuleCoreAsync(admin.Object, "events", "audit", "orders", CancellationToken.None));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }

    [Fact]
    public async Task A_subscription_created_with_a_filter_is_created_with_its_one_sql_rule_in_a_single_call()
    {
        (CreateSubscriptionOptions Subscription, CreateRuleOptions Rule)? sent = null;
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.CreateSubscriptionAsync(It.IsAny<CreateSubscriptionOptions>(), It.IsAny<CreateRuleOptions>(), It.IsAny<CancellationToken>()))
            .Callback((CreateSubscriptionOptions s, CreateRuleOptions r, CancellationToken _) => sent = (s, r))
            .Returns(Ok<SubscriptionProperties>(null!));

        await AzureServiceBusProvider.CreateSubscriptionCoreAsync(admin.Object, "events", "physical",
            new SubscriptionCreateOptions { FilterExpression = "category = 'physical'", MaxDeliveryCount = 3 });

        Assert.NotNull(sent);
        Assert.Equal(("events", "physical", 3, "CustomFilter", "category = 'physical'"),
            (sent.Value.Subscription.TopicName, sent.Value.Subscription.SubscriptionName, sent.Value.Subscription.MaxDeliveryCount,
             sent.Value.Rule.Name, Assert.IsType<SqlRuleFilter>(sent.Value.Rule.Filter).SqlExpression));
        admin.Verify(a => a.CreateSubscriptionAsync(It.IsAny<CreateSubscriptionOptions>(), It.IsAny<CreateRuleOptions>(), It.IsAny<CancellationToken>()), Times.Once);
        admin.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task A_subscription_whose_filter_the_broker_refuses_reports_the_refusal()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.CreateSubscriptionAsync(It.IsAny<CreateSubscriptionOptions>(), It.IsAny<CreateRuleOptions>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<SubscriptionProperties>>(new ArgumentException(BrokerText)));

        var error = await Assert.ThrowsAsync<InvalidEntityConfigurationException>(() =>
            AzureServiceBusProvider.CreateSubscriptionCoreAsync(admin.Object, "events", "physical", new SubscriptionCreateOptions { FilterExpression = "this is (( not sql" }));

        Assert.Equal("The broker refused this configuration.", error.Message);
        Assert.Equal(BrokerText, error.InnerException?.Message);
    }

    [Fact]
    public async Task A_subscription_create_with_a_filter_that_fails_because_the_broker_is_busy_reaches_the_caller_unchanged()
    {
        var admin = new Mock<ServiceBusAdministrationClient>();
        admin.Setup(a => a.CreateSubscriptionAsync(It.IsAny<CreateSubscriptionOptions>(), It.IsAny<CreateRuleOptions>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromException<Response<SubscriptionProperties>>(Broker(ServiceBusFailureReason.ServiceBusy)));

        var error = await Assert.ThrowsAsync<ServiceBusException>(() =>
            AzureServiceBusProvider.CreateSubscriptionCoreAsync(admin.Object, "events", "physical", new SubscriptionCreateOptions { FilterExpression = "a = 1" }));

        Assert.Equal(ServiceBusFailureReason.ServiceBusy, error.Reason);
    }
}
