using ServiceBusExplorer.Core.Models;

namespace ServiceBusExplorer.Core.Services;

public interface IConnectionGroupManager
{
    Task<IEnumerable<ConnectionGroup>> GetGroupsAsync();
    Task<ConnectionGroup?> GetGroupAsync(string id);
    Task<ConnectionGroup> SaveGroupAsync(ConnectionGroup group);
    Task DeleteGroupAsync(string id);
}
