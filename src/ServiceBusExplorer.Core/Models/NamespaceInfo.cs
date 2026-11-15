namespace ServiceBusExplorer.Core.Models;

/// <summary>
/// The properties of the connected namespace as the broker's administration API reads them, and the largest message
/// it accepts on that tier.
/// </summary>
public class NamespaceInfo
{
    /// <summary>The namespace name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>The tier: <c>Basic</c>, <c>Standard</c> or <c>Premium</c>.</summary>
    public string Tier { get; set; } = string.Empty;

    /// <summary>The messaging units of a Premium namespace; null on any other tier.</summary>
    public int? MessagingUnits { get; set; }

    /// <summary>The geo-disaster-recovery alias; null when the namespace has none.</summary>
    public string? Alias { get; set; }

    /// <summary>When the namespace was created.</summary>
    public DateTimeOffset CreatedTime { get; set; }

    /// <summary>When the namespace was last changed.</summary>
    public DateTimeOffset ModifiedTime { get; set; }

    /// <summary>
    /// The largest message the tier accepts, in bytes: 256 KB on Basic and Standard; on Premium the most a queue or a
    /// topic can be set to, 100 MB, each entity carrying its own value.
    /// </summary>
    public long MaxMessageSizeInBytes { get; set; }
}
