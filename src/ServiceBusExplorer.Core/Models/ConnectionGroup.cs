namespace ServiceBusExplorer.Core.Models;

public class ConnectionGroup
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty; // "client" or "environment"
    public string? ParentId { get; set; }
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int? Order { get; set; }
}
