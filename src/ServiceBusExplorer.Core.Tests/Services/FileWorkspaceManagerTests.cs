using System.Text.Json;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Providers;
using ServiceBusExplorer.Core.Services;
using Xunit;

namespace ServiceBusExplorer.Core.Tests.Services;

public sealed class FileWorkspaceManagerTests : IDisposable
{
    private const string Mask = "***";
    private readonly string _dir;
    private readonly string _workspaceFile;

    public FileWorkspaceManagerTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "sbx-fwm-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
        _workspaceFile = Path.Combine(_dir, "workspace.json");
    }

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private FileWorkspaceManager NewManager() => new(_dir);

    private static ServiceBusConnection StoredRabbitConnection(string id) => new()
    {
        Id = id,
        Name = "rabbit",
        ProviderType = ProviderType.AzureServiceBus,
        HostName = "old-host",
        Port = 5672,
        UserName = "old-user",
        Password = "old-password",
        VirtualHost = "/",
        ManagementPort = 15672
    };

    private static ServiceBusConnection EditedRabbitConnection(string id) => new()
    {
        Id = id,
        Name = "rabbit",
        ProviderType = ProviderType.RabbitMQ,
        HostName = "new-host",
        Port = 5673,
        UserName = "new-user",
        Password = "new-password",
        VirtualHost = "/new-vhost",
        ManagementPort = 15673
    };

    private static void AssertRabbitFieldsEqual(ServiceBusConnection expected, ServiceBusConnection? actual)
    {
        Assert.NotNull(actual);
        Assert.Equal(expected.ProviderType, actual.ProviderType);
        Assert.Equal(expected.HostName, actual.HostName);
        Assert.Equal(expected.Port, actual.Port);
        Assert.Equal(expected.UserName, actual.UserName);
        Assert.Equal(expected.Password, actual.Password);
        Assert.Equal(expected.VirtualHost, actual.VirtualHost);
        Assert.Equal(expected.ManagementPort, actual.ManagementPort);
    }

    [Fact]
    public async Task Updating_a_connection_persists_its_RabbitMQ_fields()
    {
        var manager = NewManager();
        var id = Guid.NewGuid().ToString();
        await manager.SaveConnectionAsync(StoredRabbitConnection(id));
        var edited = EditedRabbitConnection(id);

        await manager.SaveConnectionAsync(edited);

        AssertRabbitFieldsEqual(edited, await NewManager().GetConnectionWithSecretAsync(id));
    }

    [Fact]
    public async Task Importing_an_existing_id_persists_its_RabbitMQ_fields()
    {
        var manager = NewManager();
        var id = Guid.NewGuid().ToString();
        await manager.SaveConnectionAsync(StoredRabbitConnection(id));
        var edited = EditedRabbitConnection(id);

        await manager.ImportConfigurationAsync(JsonSerializer.Serialize(new[] { edited }));

        AssertRabbitFieldsEqual(edited, await NewManager().GetConnectionWithSecretAsync(id));
    }

    [Fact]
    public async Task A_masked_password_on_update_keeps_the_stored_password()
    {
        var manager = NewManager();
        var id = Guid.NewGuid().ToString();
        await manager.SaveConnectionAsync(StoredRabbitConnection(id));
        var edited = EditedRabbitConnection(id);
        edited.Password = Mask;

        await manager.SaveConnectionAsync(edited);

        var stored = await NewManager().GetConnectionWithSecretAsync(id);
        Assert.NotNull(stored);
        Assert.Equal("old-password", stored.Password);
        Assert.Equal("new-host", stored.HostName);
    }

    [Fact]
    public async Task The_save_response_never_returns_a_raw_secret_on_update()
    {
        var manager = NewManager();
        var id = Guid.NewGuid().ToString();
        await manager.SaveConnectionAsync(new ServiceBusConnection
        {
            Id = id, Name = "sp", ConnectionString = "old-cs", Password = "old-pw", ClientSecret = "old-secret"
        });

        var saved = await manager.SaveConnectionAsync(new ServiceBusConnection
        {
            Id = id, Name = "sp", ConnectionString = "new-cs", Password = "new-pw", ClientSecret = "new-secret"
        });

        Assert.Equal(id, saved.Id);
        Assert.Equal(Mask, saved.ConnectionString);
        Assert.Equal(Mask, saved.Password);
        Assert.Equal(Mask, saved.ClientSecret);
        var stored = await manager.GetConnectionWithSecretAsync(id);
        Assert.NotNull(stored);
        Assert.Equal("new-cs", stored.ConnectionString);
        Assert.Equal("new-pw", stored.Password);
        Assert.Equal("new-secret", stored.ClientSecret);
    }

    [Fact]
    public async Task The_save_response_never_returns_a_raw_secret_on_create()
    {
        var manager = NewManager();

        var saved = await manager.SaveConnectionAsync(new ServiceBusConnection
        {
            Id = string.Empty, Name = "new", ConnectionString = "raw-cs", Password = "raw-pw", ClientSecret = "raw-secret"
        });

        Assert.False(string.IsNullOrEmpty(saved.Id));
        Assert.Equal(Mask, saved.ConnectionString);
        Assert.Equal(Mask, saved.Password);
        Assert.Equal(Mask, saved.ClientSecret);
        var stored = await manager.GetConnectionWithSecretAsync(saved.Id);
        Assert.NotNull(stored);
        Assert.Equal("raw-cs", stored.ConnectionString);
        Assert.Equal("raw-pw", stored.Password);
        Assert.Equal("raw-secret", stored.ClientSecret);
    }

    [Fact]
    public async Task Importing_a_masked_export_for_an_unknown_id_never_stores_the_mask_as_the_secret()
    {
        var manager = NewManager();
        var id = Guid.NewGuid().ToString();
        var masked = new ServiceBusConnection
        {
            Id = id, Name = "imported", HostName = "imported-host",
            ConnectionString = Mask, Password = Mask, ClientSecret = Mask
        };

        await manager.ImportConfigurationAsync(JsonSerializer.Serialize(new[] { masked }));

        var stored = await NewManager().GetConnectionWithSecretAsync(id);
        Assert.NotNull(stored);
        Assert.Equal("imported", stored.Name);
        Assert.Equal("imported-host", stored.HostName);
        Assert.Equal(string.Empty, stored.ConnectionString);
        Assert.True(string.IsNullOrEmpty(stored.Password), $"Password was '{stored.Password}'");
        Assert.True(string.IsNullOrEmpty(stored.ClientSecret), $"ClientSecret was '{stored.ClientSecret}'");
    }

    private static ServiceBusConnection ProxiedAzureConnection(string id) => new()
    {
        Id = id,
        Name = "proxied",
        ProviderType = ProviderType.AzureServiceBus,
        ConnectionString = "Endpoint=sb://contoso-test.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=stored-key",
        UseWebSockets = true,
        ProxyAddress = "http://proxy.example:8080"
    };

    [Fact]
    public async Task A_connection_string_connection_is_read_with_its_namespace_host_and_never_its_key()
    {
        var id = Guid.NewGuid().ToString();
        await NewManager().SaveConnectionAsync(new ServiceBusConnection
        {
            Id = id,
            Name = "orders",
            ProviderType = ProviderType.AzureServiceBus,
            AuthType = ServiceBusExplorer.Core.Providers.Azure.AzureAuthType.ConnectionString,
            ConnectionString = "Endpoint=sb://sample-ns.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=c2VjcmV0LWtleQ=="
        });

        var listed = Assert.Single(await NewManager().GetConnectionsAsync());
        var read = await NewManager().GetConnectionAsync(id);

        Assert.Equal("sample-ns.servicebus.windows.net", listed.Namespace);
        Assert.Equal("sample-ns.servicebus.windows.net", read?.Namespace);
        Assert.Equal(Mask, listed.ConnectionString);
        Assert.DoesNotContain("c2VjcmV0LWtleQ", JsonSerializer.Serialize(listed));
        Assert.DoesNotContain("RootManageSharedAccessKey", JsonSerializer.Serialize(listed));
    }

    [Theory]
    [InlineData("Endpoint=sb://sample-ns.servicebus.windows.net/;SharedAccessKeyName=k;SharedAccessKey=s", "sample-ns.servicebus.windows.net")]
    [InlineData("SharedAccessKeyName=k;SharedAccessKey=s;Endpoint=sb://localhost:5673;UseDevelopmentEmulator=true", "localhost")]
    [InlineData("Endpoint=sb://user:secret-pass@sample-ns.servicebus.windows.net/;SharedAccessKey=s", "sample-ns.servicebus.windows.net")]
    [InlineData("SharedAccessKey=s", null)]
    [InlineData("Endpoint=not a uri;SharedAccessKey=s", null)]
    [InlineData("", null)]
    public void The_endpoint_host_is_the_host_alone_never_a_key_or_user_info(string connectionString, string? host)
    {
        Assert.Equal(host, ServiceBusExplorer.Core.Providers.Azure.AzureConnectionConfig.EndpointHost(connectionString));
    }

    [Fact]
    public async Task The_transport_and_the_proxy_are_stored_read_masked_and_carried_by_the_default_export_and_its_import()
    {
        var id = Guid.NewGuid().ToString();
        await NewManager().SaveConnectionAsync(ProxiedAzureConnection(id));

        var read = await NewManager().GetConnectionAsync(id);
        Assert.NotNull(read);
        Assert.True(read.UseWebSockets, "The masked read carries the transport, so an edit shows it");
        Assert.Equal("http://proxy.example:8080", read.ProxyAddress);
        Assert.Equal(Mask, read.ConnectionString);

        var export = await NewManager().ExportConfigurationAsync();
        File.Delete(_workspaceFile);
        await NewManager().ImportConfigurationAsync(export);

        var imported = await NewManager().GetConnectionWithSecretAsync(id);
        Assert.NotNull(imported);
        Assert.True(imported.UseWebSockets, "The default export and its import keep the transport");
        Assert.Equal("http://proxy.example:8080", imported.ProxyAddress);
    }

    [Fact]
    public async Task An_edit_of_the_transport_and_the_proxy_is_stored_and_keeps_the_masked_secret()
    {
        var id = Guid.NewGuid().ToString();
        var stored = ProxiedAzureConnection(id);
        stored.UseWebSockets = false;
        stored.ProxyAddress = null;
        await NewManager().SaveConnectionAsync(stored);
        var edited = ProxiedAzureConnection(id);
        edited.ConnectionString = Mask;

        await NewManager().SaveConnectionAsync(edited);

        var after = await NewManager().GetConnectionWithSecretAsync(id);
        Assert.NotNull(after);
        Assert.True(after.UseWebSockets, "An edit stores the transport");
        Assert.Equal("http://proxy.example:8080", after.ProxyAddress);
        Assert.Contains("stored-key", after.ConnectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// The connections a save or an import must refuse for their proxy: user info or no WebSockets on Azure Service Bus,
    /// and any proxy at all on RabbitMQ, which has none.
    /// </summary>
    public static TheoryData<ProviderType, string, bool> RefusedProxies() => new()
    {
        { ProviderType.AzureServiceBus, "http://user:proxy-sentinel-pass@proxy.example:8080", true },
        { ProviderType.AzureServiceBus, "http://proxy.example:8080", false },
        { ProviderType.RabbitMQ, "http://user:proxy-sentinel-pass@proxy.example:8080", false },
        { ProviderType.RabbitMQ, "http://proxy.example:8080", true },
    };

    private static ServiceBusConnection WithProxy(string id, ProviderType providerType, string proxyAddress, bool useWebSockets)
    {
        var connection = ProxiedAzureConnection(id);
        connection.ProviderType = providerType;
        connection.HostName = "rabbit.example";
        connection.ProxyAddress = proxyAddress;
        connection.UseWebSockets = useWebSockets;
        return connection;
    }

    private const string ResourceId =
        "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-test/providers/Microsoft.ServiceBus/namespaces/contoso-test";

    [Fact]
    public async Task The_azure_resource_id_is_not_a_secret_it_is_stored_read_unmasked_exported_imported_and_kept_on_an_edit()
    {
        var id = Guid.NewGuid().ToString();
        var connection = ProxiedAzureConnection(id);
        connection.AzureResourceId = ResourceId;
        await NewManager().SaveConnectionAsync(connection);

        var read = await NewManager().GetConnectionAsync(id);
        Assert.Equal((ResourceId, Mask), (read?.AzureResourceId, read?.ConnectionString));

        var export = await NewManager().ExportConfigurationAsync();
        Assert.Contains(ResourceId, export, StringComparison.Ordinal);
        File.Delete(_workspaceFile);
        await NewManager().ImportConfigurationAsync(export);
        Assert.Equal(ResourceId, (await NewManager().GetConnectionAsync(id))?.AzureResourceId);

        var edit = (await NewManager().GetConnectionAsync(id))!;
        edit.AzureResourceId = null;
        await NewManager().SaveConnectionAsync(edit);
        Assert.Null((await NewManager().GetConnectionWithSecretAsync(id))?.AzureResourceId);
    }

    public static TheoryData<ProviderType, string> RefusedResourceIds() => new()
    {
        { ProviderType.AzureServiceBus, "contoso-test" },
        { ProviderType.AzureServiceBus, ResourceId + "/queues/orders" },
        { ProviderType.AzureServiceBus, ResourceId + "\n" },
        { ProviderType.AzureServiceBus, ResourceId.Replace("00000000-0000-0000-0000-000000000001", "not-a-guid") },
        { ProviderType.AzureServiceBus, ResourceId.Replace("Microsoft.ServiceBus", "Microsoft.EventHub") },
        { ProviderType.RabbitMQ, ResourceId },
    };

    [Theory]
    [MemberData(nameof(RefusedResourceIds))]
    public async Task A_save_or_an_import_with_a_resource_id_out_of_format_or_on_rabbitmq_is_refused_with_the_fixed_text(ProviderType providerType, string resourceId)
    {
        var id = Guid.NewGuid().ToString();
        var connection = ProxiedAzureConnection(id);
        connection.ProviderType = providerType;
        connection.UseWebSockets = false;
        connection.ProxyAddress = null;
        connection.AzureResourceId = resourceId;

        var saved = await Assert.ThrowsAsync<ArgumentException>(() => NewManager().SaveConnectionAsync(connection));
        var imported = await Assert.ThrowsAsync<ArgumentException>(() => NewManager().ImportConfigurationAsync(JsonSerializer.Serialize(new[] { connection })));

        Assert.Equal((ServiceBusConnection.ResourceIdRefusal, ServiceBusConnection.ResourceIdRefusal), (saved.Message, imported.Message));
        Assert.Null(await NewManager().GetConnectionWithSecretAsync(id));
    }

    [Theory]
    [MemberData(nameof(RefusedProxies))]
    public async Task A_save_with_a_proxy_the_provider_cannot_use_is_refused_with_the_fixed_text_and_stores_nothing(ProviderType providerType, string proxyAddress, bool useWebSockets)
    {
        var id = Guid.NewGuid().ToString();

        var refused = await Assert.ThrowsAsync<ArgumentException>(() =>
            NewManager().SaveConnectionAsync(WithProxy(id, providerType, proxyAddress, useWebSockets)));

        Assert.Equal(ServiceBusConnection.ProxyRefusal, refused.Message);
        Assert.False(File.Exists(_workspaceFile) && File.ReadAllText(_workspaceFile).Contains("proxy.example", StringComparison.Ordinal),
            "A refused proxy address never reaches workspace.json, whatever the provider");
        Assert.Null(await NewManager().GetConnectionWithSecretAsync(id));
    }

    [Theory]
    [MemberData(nameof(RefusedProxies))]
    public async Task An_import_with_a_proxy_the_provider_cannot_use_is_refused_with_the_fixed_text_and_stores_nothing(ProviderType providerType, string proxyAddress, bool useWebSockets)
    {
        var id = Guid.NewGuid().ToString();
        var connection = WithProxy(id, providerType, proxyAddress, useWebSockets);

        var refused = await Assert.ThrowsAsync<ArgumentException>(() =>
            NewManager().ImportConfigurationAsync(JsonSerializer.Serialize(new[] { connection })));

        Assert.Equal(ServiceBusConnection.ProxyRefusal, refused.Message);
        Assert.False(File.Exists(_workspaceFile) && File.ReadAllText(_workspaceFile).Contains("proxy.example", StringComparison.Ordinal),
            "A refused proxy address never reaches workspace.json on import, whatever the provider");
        Assert.Null(await NewManager().GetConnectionWithSecretAsync(id));
    }

    [Fact]
    public async Task An_unreadable_workspace_is_an_error_never_an_empty_workspace()
    {
        const string content = "{ \"Connections\": [ CORRUPT-SENTINEL";
        File.WriteAllText(_workspaceFile, content);
        var manager = NewManager();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => manager.GetConnectionsAsync());

        Assert.NotNull(ex.InnerException);
        Assert.DoesNotContain("CORRUPT-SENTINEL", ex.Message);
    }

    [Fact]
    public async Task A_failed_save_over_an_unreadable_workspace_leaves_the_file_unchanged()
    {
        const string content = "{ \"Connections\": [ CORRUPT-SENTINEL";
        File.WriteAllText(_workspaceFile, content);
        var manager = NewManager();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => manager.SaveConnectionAsync(new ServiceBusConnection { Name = "would-overwrite" }));

        Assert.Equal(content, File.ReadAllText(_workspaceFile));
    }

    [Fact]
    public async Task A_missing_workspace_reads_as_empty()
    {
        var manager = NewManager();

        var connections = await manager.GetConnectionsAsync();

        Assert.Empty(connections);
        Assert.False(File.Exists(_workspaceFile));
    }

    [Fact]
    public async Task A_save_leaves_no_temp_file_and_a_parseable_workspace()
    {
        var manager = NewManager();
        var id = Guid.NewGuid().ToString();

        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = id, Name = "atomic" });

        Assert.Equal(new[] { _workspaceFile }, Directory.GetFileSystemEntries(_dir));
        var reread = await NewManager().GetConnectionAsync(id);
        Assert.NotNull(reread);
        Assert.Equal("atomic", reread.Name);
    }

    [Fact]
    public async Task A_save_whose_write_fails_keeps_the_original_workspace()
    {
        var manager = NewManager();
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = Guid.NewGuid().ToString(), Name = "original" });
        var before = File.ReadAllBytes(_workspaceFile);
        Directory.CreateDirectory(_workspaceFile + ".tmp");

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => manager.SaveConnectionAsync(new ServiceBusConnection { Name = "never-written" }));

        Assert.Equal(before, File.ReadAllBytes(_workspaceFile));
    }

    private void AssertWorkspaceFileIsEmpty()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(_workspaceFile));
        Assert.Equal(0, doc.RootElement.GetProperty("Connections").GetArrayLength());
        Assert.Equal(0, doc.RootElement.GetProperty("Groups").GetArrayLength());
    }

    [Fact]
    public async Task Clear_all_on_an_unreadable_workspace_reports_zero_and_leaves_an_empty_workspace()
    {
        File.WriteAllText(_workspaceFile, "{ \"Connections\": [ CORRUPT-SENTINEL");
        var manager = NewManager();

        var deleted = await manager.ClearAllAsync();

        Assert.Equal((0, 0), deleted);
        var reread = NewManager();
        Assert.Empty(await reread.GetConnectionsAsync());
        Assert.Empty(await reread.GetGroupsAsync());
    }

    [Fact]
    public async Task Deleting_a_client_deletes_its_environments_and_keeps_its_connections_with_no_client_and_no_environment()
    {
        var manager = NewManager();
        var client = await manager.SaveGroupAsync(new ConnectionGroup { Name = "Contoso", Type = "client" });
        var other = await manager.SaveGroupAsync(new ConnectionGroup { Name = "Fabrikam", Type = "client" });
        var production = await manager.SaveGroupAsync(new ConnectionGroup { Name = "Production", Type = "environment", ParentId = client.Id });
        var kept = await manager.SaveGroupAsync(new ConnectionGroup { Name = "Production", Type = "environment", ParentId = other.Id });
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = "a", Name = "in-environment", ConnectionString = "Endpoint=sb://a/;SharedAccessKeyName=k;SharedAccessKey=secret-a", ClientId = client.Id, EnvironmentId = production.Id });
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = "b", Name = "in-client", ClientId = client.Id });
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = "c", Name = "elsewhere", ClientId = other.Id, EnvironmentId = kept.Id });

        await manager.DeleteGroupAsync(client.Id);

        var reread = NewManager();
        Assert.Equal([other.Id, kept.Id], (await reread.GetGroupsAsync()).Select(g => g.Id));
        var connections = (await reread.GetConnectionsAsync()).ToDictionary(c => c.Id);
        Assert.Equal(3, connections.Count);
        Assert.Equal((null, null), (connections["a"].ClientId, connections["a"].EnvironmentId));
        Assert.Equal((null, null), (connections["b"].ClientId, connections["b"].EnvironmentId));
        Assert.Equal((other.Id, kept.Id), (connections["c"].ClientId, connections["c"].EnvironmentId));
        Assert.Equal("Endpoint=sb://a/;SharedAccessKeyName=k;SharedAccessKey=secret-a", (await reread.GetConnectionWithSecretAsync("a"))!.ConnectionString);
    }

    [Fact]
    public async Task Deleting_an_environment_keeps_its_connections_in_their_client_with_no_environment()
    {
        var manager = NewManager();
        var client = await manager.SaveGroupAsync(new ConnectionGroup { Name = "Contoso", Type = "client" });
        var production = await manager.SaveGroupAsync(new ConnectionGroup { Name = "Production", Type = "environment", ParentId = client.Id });
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = "a", Name = "in-environment", ClientId = client.Id, EnvironmentId = production.Id });

        await manager.DeleteGroupAsync(production.Id);

        var connection = (await NewManager().GetConnectionsAsync()).Single();
        Assert.Equal((client.Id, null), (connection.ClientId, connection.EnvironmentId));
    }

    [Fact]
    public async Task Clear_all_reports_how_many_connections_and_groups_it_deleted()
    {
        var manager = NewManager();
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = Guid.NewGuid().ToString(), Name = "first" });
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = Guid.NewGuid().ToString(), Name = "second" });
        await manager.SaveGroupAsync(new ConnectionGroup { Name = "group", Type = "client" });

        var deleted = await manager.ClearAllAsync();

        Assert.Equal((2, 1), deleted);
        var reread = NewManager();
        Assert.Empty(await reread.GetConnectionsAsync());
        Assert.Empty(await reread.GetGroupsAsync());
    }

    [Fact]
    public async Task Clear_all_leaves_no_temp_file_and_a_parseable_empty_workspace()
    {
        var manager = NewManager();
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = Guid.NewGuid().ToString(), Name = "cleared" });

        await manager.ClearAllAsync();

        Assert.Equal(new[] { _workspaceFile }, Directory.GetFileSystemEntries(_dir));
        AssertWorkspaceFileIsEmpty();
    }

    [Fact]
    public async Task Clear_all_on_a_missing_workspace_writes_an_empty_workspace_file()
    {
        var manager = NewManager();

        var deleted = await manager.ClearAllAsync();

        Assert.Equal((0, 0), deleted);
        Assert.Equal(new[] { _workspaceFile }, Directory.GetFileSystemEntries(_dir));
        AssertWorkspaceFileIsEmpty();
    }

    [Fact]
    public async Task A_clear_whose_write_fails_keeps_the_original_workspace()
    {
        var manager = NewManager();
        await manager.SaveConnectionAsync(new ServiceBusConnection { Id = Guid.NewGuid().ToString(), Name = "original" });
        var before = File.ReadAllBytes(_workspaceFile);
        Directory.CreateDirectory(_workspaceFile + ".tmp");

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => manager.ClearAllAsync());

        Assert.Equal(before, File.ReadAllBytes(_workspaceFile));
    }

    [Theory]
    [InlineData("connections.json")]
    [InlineData("connection-groups.json")]
    public void A_legacy_file_that_cannot_be_parsed_is_kept_and_nothing_is_consolidated(string unreadableFile)
    {
        var connectionsFile = Path.Combine(_dir, "connections.json");
        var groupsFile = Path.Combine(_dir, "connection-groups.json");
        File.WriteAllText(connectionsFile, JsonSerializer.Serialize(new[] { new ServiceBusConnection { Id = "c1", Name = "orders" } }));
        File.WriteAllText(groupsFile, JsonSerializer.Serialize(new[] { new ConnectionGroup { Id = "g1", Name = "production" } }));
        File.WriteAllText(Path.Combine(_dir, unreadableFile), "[{\"Id\": \"x1\", \"Name\": ");
        var connectionsBefore = File.ReadAllBytes(connectionsFile);
        var groupsBefore = File.ReadAllBytes(groupsFile);

        NewManager();

        Assert.True(File.Exists(connectionsFile), "the legacy connections file was deleted although consolidation could not read every file");
        Assert.True(File.Exists(groupsFile), "the legacy groups file was deleted although consolidation could not read every file");
        Assert.Equal(connectionsBefore, File.ReadAllBytes(connectionsFile));
        Assert.Equal(groupsBefore, File.ReadAllBytes(groupsFile));
        Assert.False(File.Exists(_workspaceFile), "a workspace was written although a legacy file could not be read");
    }

    [Fact]
    public async Task Readable_legacy_files_are_consolidated_into_the_workspace_and_removed()
    {
        var connectionsFile = Path.Combine(_dir, "connections.json");
        var groupsFile = Path.Combine(_dir, "connection-groups.json");
        File.WriteAllText(connectionsFile, JsonSerializer.Serialize(new[] { new ServiceBusConnection { Id = "c1", Name = "orders" } }));
        File.WriteAllText(groupsFile, JsonSerializer.Serialize(new[] { new ConnectionGroup { Id = "g1", Name = "production" } }));

        var manager = NewManager();

        Assert.False(File.Exists(connectionsFile));
        Assert.False(File.Exists(groupsFile));
        Assert.Equal("orders", Assert.Single(await manager.GetConnectionsAsync()).Name);
        Assert.Equal("production", Assert.Single(await manager.GetGroupsAsync()).Name);
    }

    [Fact]
    public async Task The_production_mark_of_an_environment_is_stored_and_an_update_can_clear_it()
    {
        var env = new ConnectionGroup { Id = "env-1", Name = "Production", Type = "environment", ParentId = "client-1", IsProduction = true };
        await NewManager().SaveGroupAsync(env);

        var stored = await NewManager().GetGroupAsync("env-1");
        Assert.True(stored?.IsProduction, "an environment saved as production must read back as production");

        await NewManager().SaveGroupAsync(new ConnectionGroup { Id = "env-1", Name = "Production", Type = "environment", ParentId = "client-1", IsProduction = false });
        Assert.False((await NewManager().GetGroupAsync("env-1"))?.IsProduction, "an update without the mark must store the environment as not production");
    }

    [Fact]
    public async Task A_workspace_written_before_the_production_mark_reads_every_group_as_not_production()
    {
        File.WriteAllText(_workspaceFile,
            "{\"Connections\":[],\"Groups\":[{\"Id\":\"env-1\",\"Name\":\"Production\",\"Type\":\"environment\",\"ParentId\":\"c\"}]}");

        var group = Assert.Single(await NewManager().GetGroupsAsync());

        Assert.Equal("Production", group.Name);
        Assert.False(group.IsProduction, "an old workspace file without IsProduction must read false");
    }

    [Fact]
    public async Task The_TLS_flags_are_stored_read_masked_and_updated()
    {
        var manager = NewManager();
        var connection = EditedRabbitConnection("tls-1");
        connection.UseSsl = true;
        connection.UseManagementSsl = true;
        await manager.SaveConnectionAsync(connection);

        var masked = await manager.GetConnectionAsync("tls-1");
        Assert.True(masked?.UseSsl, "the masked read must keep UseSsl");
        Assert.True(masked?.UseManagementSsl, "the masked read must keep UseManagementSsl");
        Assert.Equal(Mask, masked?.Password);

        var edited = EditedRabbitConnection("tls-1");
        edited.Password = Mask;
        edited.UseSsl = false;
        edited.UseManagementSsl = true;
        await manager.SaveConnectionAsync(edited);

        var stored = await NewManager().GetConnectionWithSecretAsync("tls-1");
        Assert.False(stored?.UseSsl, "an update must store the UseSsl it was sent");
        Assert.True(stored?.UseManagementSsl, "an update must store the UseManagementSsl it was sent");
        Assert.Equal("new-password", stored?.Password);
    }

    [Fact]
    public void The_RabbitMQ_config_uses_the_TLS_flags_of_the_stored_connection()
    {
        var connection = EditedRabbitConnection("tls-2");
        connection.UseSsl = true;
        connection.UseManagementSsl = true;

        var config = ServiceBusExplorer.Core.Providers.RabbitMQ.RabbitMQConnectionConfig.FromServiceBusConnection(connection);

        Assert.True(config.UseSsl, "the AMQP TLS flag must reach the provider config");
        Assert.Equal("https://new-host:15673/api", config.GetManagementApiUrl());
        var back = config.ToServiceBusConnection();
        Assert.True(back.UseSsl, "UseSsl must survive the conversion back to the stored connection");
        Assert.True(back.UseManagementSsl, "UseManagementSsl must survive the conversion back to the stored connection");
    }

    [Fact]
    public async Task The_time_a_connection_was_used_survives_an_edit_save_that_does_not_send_it()
    {
        var manager = NewManager();
        await manager.SaveConnectionAsync(StoredRabbitConnection("used-1"));
        var before = DateTime.UtcNow;

        await manager.MarkUsedAsync("used-1");
        var stamped = (await manager.GetConnectionAsync("used-1"))?.LastUsedAt;
        Assert.NotNull(stamped);
        Assert.InRange(stamped.Value, before, DateTime.UtcNow);

        var edit = EditedRabbitConnection("used-1");
        edit.LastUsedAt = new DateTime(2001, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        await manager.SaveConnectionAsync(edit);

        var after = await NewManager().GetConnectionAsync("used-1");
        Assert.Equal("new-host", after?.HostName);
        Assert.Equal(stamped, after?.LastUsedAt);
    }

    [Fact]
    public async Task Marking_an_unknown_connection_used_writes_nothing()
    {
        var manager = NewManager();
        await manager.SaveConnectionAsync(StoredRabbitConnection("known"));
        var before = File.ReadAllBytes(_workspaceFile);

        await manager.MarkUsedAsync("unknown");

        Assert.Equal(before, File.ReadAllBytes(_workspaceFile));
    }

    [Fact]
    public async Task A_mark_used_whose_write_fails_keeps_the_original_workspace()
    {
        var manager = NewManager();
        await manager.SaveConnectionAsync(StoredRabbitConnection("used-2"));
        var before = File.ReadAllBytes(_workspaceFile);
        Directory.CreateDirectory(_workspaceFile + ".tmp");

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => manager.MarkUsedAsync("used-2"));

        Assert.Equal(before, File.ReadAllBytes(_workspaceFile));
    }
}
