using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// The definitions of every queue, topic, subscription and rule of a namespace, as one versioned document. It holds
/// names and settings only: no message, no connection string, no key and no credential. Read from a file it is
/// untrusted input, so every member may be missing and every list may hold a null.
/// </summary>
public sealed class EntityDefinitionsDocument
{
    /// <summary>The only document version this application writes and reads.</summary>
    public const int CurrentVersion = 1;

    public int? Version { get; set; }
    public DateTimeOffset? ExportedAt { get; set; }
    public EntityDefinitions? Entities { get; set; }
}

/// <summary>The queues and the topics of a definitions document; each topic carries its subscriptions.</summary>
public sealed class EntityDefinitions
{
    public List<QueueDefinition?>? Queues { get; set; }
    public List<TopicDefinition?>? Topics { get; set; }
}

/// <summary>A queue: its name and the settings it is created with.</summary>
public sealed class QueueDefinition
{
    public string? Name { get; set; }
    public QueueCreateOptions? Options { get; set; }
}

/// <summary>A topic: its name, the settings it is created with, and its subscriptions.</summary>
public sealed class TopicDefinition
{
    public string? Name { get; set; }
    public TopicCreateOptions? Options { get; set; }
    public List<SubscriptionDefinition?>? Subscriptions { get; set; }
}

/// <summary>A subscription: its name, the settings it is created with, and every rule it holds, the default rule included.</summary>
public sealed class SubscriptionDefinition
{
    public string? Name { get; set; }
    public SubscriptionCreateOptions? Options { get; set; }
    public List<SubscriptionRuleInfo?>? Rules { get; set; }
}

/// <summary>The kind of an entity in a definitions import.</summary>
public enum DefinitionEntityKind
{
    Queue,
    Topic,
    Subscription
}

/// <summary>
/// What an import did, or in a dry run would do, with one entity of the document. A dry run answers
/// <see cref="Create"/>, <see cref="Exists"/> or <see cref="Differs"/>; an import answers <see cref="Created"/>,
/// <see cref="Exists"/> or <see cref="Differs"/> (both left as they are) or <see cref="Failed"/>.
/// </summary>
public enum DefinitionImportOutcome
{
    Create,
    Created,
    Exists,
    Differs,
    Failed
}

/// <summary>One entity of a definitions import: what it is, what happened to it and why.</summary>
public sealed class DefinitionImportItem
{
    public DefinitionEntityKind Kind { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>The topic of a subscription; null for a queue or a topic.</summary>
    public string? Topic { get; set; }

    public DefinitionImportOutcome Outcome { get; set; }

    /// <summary>For <see cref="DefinitionImportOutcome.Differs"/>, the settings that differ, as the document names them.</summary>
    public List<string>? DifferingFields { get; set; }

    /// <summary>For <see cref="DefinitionImportOutcome.Failed"/>, a fixed text this application wrote; never the broker's.</summary>
    public string? Reason { get; set; }
}

/// <summary>The answer of a definitions import: one item per queue, topic and subscription of the document, in its order.</summary>
public sealed class DefinitionsImportResult
{
    public bool DryRun { get; set; }
    public List<DefinitionImportItem> Items { get; set; } = new();
}
