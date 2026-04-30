namespace ServiceBusExplorer.Core.Abstractions;

/// <summary>
/// Base interface for messaging entities (queues, topics, exchanges).
/// Defines common properties shared across all messaging providers.
/// </summary>
public interface IMessagingEntity
{
    /// <summary>
    /// The name of the messaging entity.
    /// </summary>
    string Name { get; }

    /// <summary>
    /// The current size of the entity in bytes.
    /// </summary>
    long SizeInBytes { get; }

    /// <summary>
    /// When this entity was created.
    /// </summary>
    DateTimeOffset CreatedAt { get; }

    /// <summary>
    /// When this entity was last updated.
    /// </summary>
    DateTimeOffset UpdatedAt { get; }

    /// <summary>
    /// When this entity was last accessed.
    /// </summary>
    DateTimeOffset AccessedAt { get; }

    /// <summary>
    /// The current status of the entity (e.g., Active, Disabled, SendDisabled).
    /// </summary>
    string Status { get; }

    /// <summary>
    /// Indicates whether the entity is partitioned for improved throughput.
    /// </summary>
    bool EnablePartitioning { get; }
}
