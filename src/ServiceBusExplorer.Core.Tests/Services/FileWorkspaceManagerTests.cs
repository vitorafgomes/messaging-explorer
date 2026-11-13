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
}
