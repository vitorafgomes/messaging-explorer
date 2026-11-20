using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ServiceBusExplorer.Api.Mcp;

/// <summary>
/// What the user chose for the MCP server, as <c>mcp-settings.json</c> in the data folder holds it: whether it is on,
/// the SHA-256 of the token and when it was made, whether an assistant may read the logs, and the level each offered
/// connection is offered at. The plain token is never stored.
/// </summary>
public sealed class McpSettings
{
    /// <summary>True when <c>/mcp</c> answers; false, the default, makes it answer 404.</summary>
    public bool Enabled { get; set; }

    /// <summary>The SHA-256 of the token, as hex; null until the user creates one.</summary>
    public string? TokenHash { get; set; }

    /// <summary>When the token was created, in UTC; null until the user creates one.</summary>
    public DateTimeOffset? TokenCreatedAt { get; set; }

    /// <summary>True when the read_logs tool may answer the lines of the backend's log.</summary>
    public bool LogsAllowed { get; set; }

    /// <summary>The offered connections, by stored connection id, with the level each is offered at.</summary>
    public Dictionary<string, string> Connections { get; set; } = new();

    /// <summary>A copy that shares nothing with this one.</summary>
    public McpSettings Copy() => new()
    {
        Enabled = Enabled,
        TokenHash = TokenHash,
        TokenCreatedAt = TokenCreatedAt,
        LogsAllowed = LogsAllowed,
        Connections = new Dictionary<string, string>(Connections),
    };
}

/// <summary>
/// The persisted MCP settings. Every change is written to a temporary file that is then moved over
/// <c>mcp-settings.json</c>, and takes effect in memory only once the write succeeded. A file that cannot be read
/// starts the server off, with no token and nothing offered.
/// </summary>
public sealed class McpSettingsStore
{
    /// <summary>The one level this version offers a connection at.</summary>
    public const string ReadLevel = "read";

    /// <summary>The name of the file in the data folder.</summary>
    public const string FileName = "mcp-settings.json";

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly string _filePath;
    private readonly Lock _lock = new();
    private McpSettings _settings;
    private byte[]? _tokenHash;

    /// <summary>Reads the settings from <paramref name="dataPath"/>; <paramref name="endpointUrl"/> is the address the state answers.</summary>
    public McpSettingsStore(string dataPath, string endpointUrl, ILogger<McpSettingsStore>? logger = null)
    {
        _filePath = Path.Combine(dataPath, FileName);
        EndpointUrl = endpointUrl;
        _settings = Load(_filePath, logger);
        _tokenHash = HashBytes(_settings.TokenHash);
    }

    /// <summary>The address of the MCP endpoint, as a client is configured with it.</summary>
    public string EndpointUrl { get; }

    /// <summary>A copy of the current settings.</summary>
    public McpSettings Current
    {
        get { lock (_lock) { return _settings.Copy(); } }
    }

    /// <summary>The level <paramref name="connectionId"/> is offered at, or null when it is not offered.</summary>
    public string? LevelOf(string? connectionId)
    {
        if (connectionId is null) return null;
        lock (_lock) { return _settings.Connections.GetValueOrDefault(connectionId); }
    }

    /// <summary>
    /// True when <paramref name="presented"/> is the token: its SHA-256 is compared with the stored hash in fixed time.
    /// False when no token was created.
    /// </summary>
    public bool TokenMatches(string presented)
    {
        byte[]? stored;
        lock (_lock) { stored = _tokenHash; }
        if (stored is null) return false;
        return CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(presented)), stored);
    }

    /// <summary>Turns the server on or off.</summary>
    public void SetEnabled(bool enabled) => Change(s => s.Enabled = enabled);

    /// <summary>Allows or refuses the read_logs tool.</summary>
    public void SetLogsAllowed(bool allowed) => Change(s => s.LogsAllowed = allowed);

    /// <summary>Offers <paramref name="connectionId"/> at <paramref name="level"/>.</summary>
    public void Offer(string connectionId, string level) => Change(s => s.Connections[connectionId] = level);

    /// <summary>Stops offering each of <paramref name="connectionIds"/>; an id that is not offered changes nothing.</summary>
    public void Withdraw(IEnumerable<string> connectionIds)
    {
        var ids = connectionIds.ToList();
        lock (_lock)
        {
            if (!ids.Any(_settings.Connections.ContainsKey)) return;
        }
        Change(s => ids.ForEach(id => s.Connections.Remove(id)));
    }

    /// <summary>
    /// Creates a token of 32 random bytes, base64url, and keeps only its SHA-256; the one before it stops working.
    /// The token is returned this once and never again.
    /// </summary>
    public string CreateToken()
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        Change(s =>
        {
            s.TokenHash = hash;
            s.TokenCreatedAt = DateTimeOffset.UtcNow;
        });
        return token;
    }

    private void Change(Action<McpSettings> change)
    {
        lock (_lock)
        {
            var next = _settings.Copy();
            change(next);
            var tempPath = _filePath + ".tmp";
            File.WriteAllText(tempPath, JsonSerializer.Serialize(next, JsonOptions));
            File.Move(tempPath, _filePath, overwrite: true);
            _settings = next;
            _tokenHash = HashBytes(next.TokenHash);
        }
    }

    private static byte[]? HashBytes(string? hex)
    {
        if (string.IsNullOrEmpty(hex)) return null;
        try
        {
            var bytes = Convert.FromHexString(hex);
            return bytes.Length == SHA256.HashSizeInBytes ? bytes : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static McpSettings Load(string filePath, ILogger? logger)
    {
        if (!File.Exists(filePath)) return new McpSettings();
        try
        {
            var settings = JsonSerializer.Deserialize<McpSettings>(File.ReadAllText(filePath), JsonOptions) ?? new McpSettings();
            settings.Connections ??= new Dictionary<string, string>();
            return settings;
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException or NotSupportedException)
        {
            logger?.LogWarning(ex, "The MCP settings could not be read ({ExceptionType}); the MCP server starts off with nothing offered", ex.GetType().Name);
            return new McpSettings();
        }
    }
}
