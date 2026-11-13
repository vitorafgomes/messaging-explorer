using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers.RabbitMQ;

namespace ServiceBusExplorer.Core.Tests.Providers;

/// <summary>
/// RabbitMQ has no entity definitions here: it says so in its capabilities and refuses export and import, never by
/// answering an empty document as if it had read the broker.
/// </summary>
public class RabbitMQDefinitionsTests
{
    [Fact]
    public async Task RabbitMQ_declares_no_definitions_and_refuses_export_and_import()
    {
        var provider = new RabbitMQProvider();

        var errors = new[]
        {
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.ExportDefinitionsAsync()),
            await Assert.ThrowsAsync<NotSupportedException>(() => provider.ImportDefinitionsAsync(new EntityDefinitionsDocument { Version = 1 }, dryRun: true))
        };

        Assert.False(provider.Capabilities.SupportsDefinitions);
        Assert.All(errors, e => Assert.Equal("RabbitMQ does not support entity definitions.", e.Message));
    }
}
