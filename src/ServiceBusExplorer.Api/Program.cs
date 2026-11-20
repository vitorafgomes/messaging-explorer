using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.HostFiltering;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Api.Monitoring;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Providers.Azure;
using ServiceBusExplorer.Core.Services;

var builder = WebApplication.CreateBuilder(args);

// ─────────────────────────────────────────────────────────────
// Bootstrap logger: the host logger is only available after
// builder.Build(), so use a dedicated factory for startup work.
// ─────────────────────────────────────────────────────────────
using var bootstrapLoggerFactory = LoggerFactory.Create(logging => logging.AddConsole());
var bootstrapLogger = bootstrapLoggerFactory.CreateLogger("Startup");

// ─────────────────────────────────────────────────────────────
// Port configuration (config.json at repo root)
// ─────────────────────────────────────────────────────────────
const int DefaultApiPort = 5917;
const int DefaultFrontendPort = 4297;

var (apiPort, frontendPort, portConfigSource) = ResolvePortConfig(bootstrapLogger);
bootstrapLogger.LogInformation(
    "Port configuration resolved: apiPort={ApiPort}, frontendPort={FrontendPort}, source={Source}",
    apiPort, frontendPort, portConfigSource);

// ─────────────────────────────────────────────────────────────
// API_SECRET is mandatory — fail fast if missing or too short
// ─────────────────────────────────────────────────────────────
var apiSecret = Environment.GetEnvironmentVariable("API_SECRET");
if (string.IsNullOrEmpty(apiSecret) || apiSecret.Length < 32)
{
    bootstrapLogger.LogCritical(
        "API_SECRET environment variable is required and must be at least 32 characters long.");
    Environment.Exit(1);
}

// Cache secret bytes once to avoid per-request allocation
var apiSecretBytes = Encoding.UTF8.GetBytes(apiSecret);

// ─────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // Convert to camelCase for HTTP responses (frontend)
        // Files stay in PascalCase (C# standard)
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        // Accept and emit enum values as strings (e.g. "AzureServiceBus", "ConnectionString")
        // so the Angular client doesn't need to know the underlying numeric values.
        // Without this, model binding for enum properties on incoming JSON returns 400.
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

// CORS: restrict to the configured Angular dev server origin.
// Packaged Electron loads via file:// which sends Origin: null.
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        policy.WithOrigins(
                  $"http://localhost:{frontendPort}",
                  $"http://127.0.0.1:{frontendPort}",
                  "null")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Host filtering: only accept requests whose Host header is localhost/127.0.0.1.
builder.Services.Configure<HostFilteringOptions>(o =>
{
    o.AllowedHosts = new[] { "localhost", "127.0.0.1" };
});

// Bind Kestrel to loopback on the configured port when ASPNETCORE_URLS is not set.
if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    builder.WebHost.ConfigureKestrel(k => k.ListenLocalhost(apiPort));
}

// Data path for the workspace file.
var dataPath = Environment.GetEnvironmentVariable("SERVICEBUS_DATA_PATH");
if (string.IsNullOrEmpty(dataPath))
{
    dataPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ServiceBusExplorer"
    );
}
Directory.CreateDirectory(dataPath);
bootstrapLogger.LogInformation("Using data path {DataPath}", dataPath);

builder.Services.AddSingleton<IConnectionManager>(sp =>
    new FileWorkspaceManager(
        dataPath,
        sp.GetService<ILogger<FileWorkspaceManager>>()));
builder.Services.AddSingleton<IConnectionGroupManager>(sp =>
    (FileWorkspaceManager)sp.GetRequiredService<IConnectionManager>());

builder.Services.AddSingleton<IProviderFactory>(sp =>
{
    var logger = sp.GetService<ILogger<ProviderFactory>>();
    var loggerFactory = sp.GetService<ILoggerFactory>();
    return new ProviderFactory(logger, loggerFactory);
});

builder.Services.AddSingleton<IServiceBusService>(sp =>
{
    var logger = sp.GetRequiredService<ILogger<ServiceBusService>>();
    return new ServiceBusService(logger);
});

var recentLogs = new ServiceBusExplorer.Api.Logs.RecentLogStore();
builder.Services.AddSingleton(recentLogs);
builder.Logging.AddProvider(recentLogs);
builder.Services.AddSingleton<MonitoringStore>();

// The MCP server: off until the user turns it on, behind a token of its own, asking the user before a send.
builder.Services.AddSingleton(sp => new McpSettingsStore(
    dataPath,
    $"http://127.0.0.1:{apiPort}{McpGate.Path}",
    sp.GetService<ILogger<McpSettingsStore>>()));
builder.Services.AddSingleton<McpActivityLog>();
builder.Services.AddSingleton(McpRequestOptions.Default);
builder.Services.AddSingleton<McpRequests>();
builder.Services.AddSingleton<McpToolCalls>();
builder.Services.AddMcpServer()
    .WithHttpTransport(o => o.Stateless = true)
    .WithTools<McpReadTools>()
    .WithTools<McpSendTools>();
builder.Services.AddHostedService<MonitoringBackgroundService>();

// ─────────────────────────────────────────────────────────────
// Metrics service (Azure Monitor)
// Bind the AzureMonitor section and register the proper service.
// If the section is empty or missing required fields, register a
// null-object implementation that throws "not properly configured"
// so MetricsController returns 503 with a generic message.
// ─────────────────────────────────────────────────────────────
builder.Services.Configure<AzureMonitorOptions>(
    builder.Configuration.GetSection(AzureMonitorOptions.SectionName));

var azureMonitorOptions = new AzureMonitorOptions();
builder.Configuration.GetSection(AzureMonitorOptions.SectionName).Bind(azureMonitorOptions);

builder.Services.AddMemoryCache();
builder.Services.AddSingleton<AzureNamespaceMetricsReader>();
// The Azure directory of "sign in, then pick": one session for the process, its token in memory only.
builder.Services.AddSingleton(sp => new AzureNamespaceDirectory(logger: sp.GetService<ILogger<AzureNamespaceDirectory>>()));
if (azureMonitorOptions.IsConfigured)
{
    bootstrapLogger.LogInformation(
        "AzureMonitor section found: registering AzureMonitorMetricsService for namespace {Namespace}",
        azureMonitorOptions.Namespace);

    builder.Services.AddSingleton<IMetricsService>(sp =>
    {
        var logger = sp.GetService<ILogger<AzureMonitorMetricsService>>();
        var cache = sp.GetService<IMemoryCache>();
        return new AzureMonitorMetricsService(
            azureMonitorOptions.SubscriptionId,
            azureMonitorOptions.ResourceGroup,
            azureMonitorOptions.Namespace,
            credential: null,
            cache: cache,
            logger: logger);
    });
}
else
{
    bootstrapLogger.LogWarning(
        "AzureMonitor section is empty or incomplete. Metrics endpoints will return 503.");
    builder.Services.AddSingleton<IMetricsService, UnconfiguredMetricsService>();
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Outermost, so an exception from any later middleware or controller answers a fixed sentence
// in every environment: 500, or 502 when a broker refused the operation as not authorised.
// The framework logs the exception, the client never sees its text.
app.UseExceptionHandler(errorApp => errorApp.Run(context =>
{
    var answer = ServiceBusExplorer.Api.Controllers.EntityAdministrationResults.Unhandled(
        context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error);
    context.Response.StatusCode = answer.StatusCode ?? StatusCodes.Status500InternalServerError;
    return context.Response.WriteAsJsonAsync(answer.Value);
}));

// Host filtering must run before auth so unknown hosts get rejected first.
app.UseHostFiltering();

// CORS must run before auth: preflight (OPTIONS) requests never carry the API key
// and need their CORS headers emitted regardless.
app.UseCors("AllowAngular");

// Health endpoint is exempt from authentication.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

var mcpSettings = app.Services.GetRequiredService<McpSettingsStore>();

// API Key authentication for local Electron app (required).
app.Use(async (context, next) =>
{
    // The MCP endpoint has its own gate and credential; the API key opens nothing there.
    if (McpGate.Covers(context))
    {
        if (await McpGate.AdmitAsync(context, mcpSettings)) await next();
        return;
    }

    // CORS preflight bypass — already handled by UseCors above.
    if (HttpMethods.IsOptions(context.Request.Method))
    {
        await next();
        return;
    }

    if (context.Request.Path.StartsWithSegments("/health", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    var providedKey = context.Request.Headers["X-Api-Key"].FirstOrDefault();
    var providedBytes = providedKey is null ? Array.Empty<byte>() : Encoding.UTF8.GetBytes(providedKey);

    if (providedBytes.Length != apiSecretBytes.Length ||
        !CryptographicOperations.FixedTimeEquals(providedBytes, apiSecretBytes))
    {
        context.Response.StatusCode = 401;
        await context.Response.WriteAsJsonAsync(new { message = "Unauthorized" });
        return;
    }

    await next();
});

app.Use(async (context, next) =>
{
    var started = System.Diagnostics.Stopwatch.GetTimestamp();
    await next();
    var status = context.Response.StatusCode;
    if (status >= 400 && !context.Request.Path.StartsWithSegments("/api/logs", StringComparison.OrdinalIgnoreCase))
    {
        var took = (long)System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        recentLogs.Add(status >= 500 ? LogLevel.Error : LogLevel.Warning, "Request",
            $"{context.Request.Method} {context.Request.Path} answered {status} in {took} ms");
    }
});

// Disable HTTPS redirection for Electron compatibility
// app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();
app.MapMcp(McpGate.Path);

app.Run();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
static (int apiPort, int frontendPort, string source) ResolvePortConfig(ILogger logger)
{
    // 1. Explicit env override
    var explicitPath = Environment.GetEnvironmentVariable("EXPLORER_CONFIG_PATH");
    if (!string.IsNullOrEmpty(explicitPath) && File.Exists(explicitPath))
    {
        if (TryReadConfig(explicitPath, logger, out var ap, out var fp))
            return (ap, fp, explicitPath);
    }

    // 2. Walk up from AppContext.BaseDirectory looking for config.json
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir != null)
    {
        var candidate = Path.Combine(dir.FullName, "config.json");
        if (File.Exists(candidate) && TryReadConfig(candidate, logger, out var ap, out var fp))
            return (ap, fp, candidate);
        dir = dir.Parent;
    }

    // 3. Fallback to defaults
    logger.LogWarning(
        "config.json not found, falling back to default ports {DefaultApi}/{DefaultFrontend}",
        DefaultApiPort, DefaultFrontendPort);
    return (DefaultApiPort, DefaultFrontendPort, "defaults");
}

static bool TryReadConfig(string path, ILogger logger, out int apiPort, out int frontendPort)
{
    apiPort = DefaultApiPort;
    frontendPort = DefaultFrontendPort;
    try
    {
        using var stream = File.OpenRead(path);
        using var doc = JsonDocument.Parse(stream);
        if (doc.RootElement.TryGetProperty("apiPort", out var ap) && ap.TryGetInt32(out var apValue))
            apiPort = apValue;
        if (doc.RootElement.TryGetProperty("frontendPort", out var fp) && fp.TryGetInt32(out var fpValue))
            frontendPort = fpValue;
        return true;
    }
    catch (Exception ex)
    {
        // Do not log the raw exception message; the path and exception type are sufficient.
        logger.LogWarning(ex, "Failed to parse port config at {ConfigPath} ({ExceptionType})",
            path, ex.GetType().Name);
        return false;
    }
}

// Needed for WebApplicationFactory<TEntryPoint> in integration tests.
public partial class Program { }
