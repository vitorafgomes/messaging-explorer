namespace ServiceBusExplorer.Core.Models;

public class MessageSearchRequest
{
    public string Query { get; set; } = string.Empty;
    public bool IsRegex { get; set; } = false;
    public bool CaseSensitive { get; set; } = false;
    public string? Property { get; set; }
    public int Count { get; set; } = 100;
    public int Skip { get; set; } = 0;
}
