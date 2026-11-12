using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.Azure;
using ServiceBusExplorer.Core.Providers.RabbitMQ;
using ServiceBusExplorer.Core.Providers.RabbitMQ.Models;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// RabbitMQ says it has no subscription rules, in its capabilities and by refusing every rule operation, never by
/// answering as if it had done one; a binding's routing key stays readable as a read-only rule.
/// </summary>
public class RabbitMQSubscriptionRuleTests
{
    [Fact]
    public void RabbitMQ_declares_that_it_has_no_subscription_rules_and_Azure_that_it_has()
    {
        Assert.Equal((false, true), (new RabbitMQProvider().Capabilities.SupportsSubscriptionRules, new AzureServiceBusProvider().Capabilities.SupportsSubscriptionRules));
    }

    [Fact]
    public void A_binding_read_as_a_subscription_shows_its_routing_key_as_a_read_only_RoutingKey_rule()
    {
        var binding = new RabbitMQBindingInfo { Source = "orders", Destination = "billing", RoutingKey = "orders.*" };
        var expected = new SubscriptionRuleInfo { Name = "RoutingKey", FilterType = RuleFilterType.RoutingKey, SqlExpression = "orders.*" };

        var fromProvider = RabbitMQProvider.MapBindingToSubscriptionInfo("orders", binding);
        var fromExchange = new RabbitMQExchangeInfo { Name = "orders", Bindings = [binding] }.Subscriptions.Single();

        Assert.Equivalent(expected, Assert.Single(fromProvider.Rules), strict: true);
        Assert.Equivalent(expected, Assert.Single(fromExchange.Rules), strict: true);
    }

    [Fact]
    public async Task RabbitMQ_refuses_to_list_add_replace_or_delete_a_rule()
    {
        var provider = new RabbitMQProvider();
        var rule = new SubscriptionRuleInfo { Name = "orders", FilterType = RuleFilterType.True };

        var errors = new[]
        {
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.GetRulesAsync("events", "audit")),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.CreateRuleAsync("events", "audit", rule)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.UpdateRuleAsync("events", "audit", "orders", rule)),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.DeleteRuleAsync("events", "audit", "orders"))
        };

        Assert.All(errors, e => Assert.Equal("RabbitMQ does not support subscription rules.", e.Message));
    }
}
