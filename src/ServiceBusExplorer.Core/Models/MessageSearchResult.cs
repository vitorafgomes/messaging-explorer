using ServiceBusExplorer.Core.Abstractions;

namespace ServiceBusExplorer.Core.Models;

public class MessageSearchResult
{
    public IEnumerable<IMessage> Messages { get; set; } = [];
    public int TotalPeeked { get; set; }
    public int TotalMatches { get; set; }
    public bool HasMore { get; set; }
}
