using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Services;

namespace ServiceBusExplorer.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ConnectionGroupsController : ControllerBase
{
    private readonly IConnectionGroupManager _groupManager;
    private readonly ILogger<ConnectionGroupsController> _logger;

    public ConnectionGroupsController(
        IConnectionGroupManager groupManager,
        ILogger<ConnectionGroupsController> logger)
    {
        _groupManager = groupManager;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ConnectionGroup>>> GetGroups()
    {
        try
        {
            _logger.LogDebug("Fetching connection groups");
            var groups = await _groupManager.GetGroupsAsync();
            _logger.LogInformation("Retrieved {GroupCount} groups", groups.Count());
            return Ok(groups);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch connection groups");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<ConnectionGroup>> GetGroup(string id)
    {
        var group = await _groupManager.GetGroupAsync(id);
        if (group == null)
            return NotFound();

        return Ok(group);
    }

    [HttpPost]
    public async Task<ActionResult<ConnectionGroup>> CreateGroup([FromBody] ConnectionGroup group)
    {
        try
        {
            _logger.LogInformation("Creating group {GroupName} of type {GroupType}", group?.Name, group?.Type);

            if (string.IsNullOrWhiteSpace(group.Name))
                return BadRequest(new { message = "Group name is required" });

            if (string.IsNullOrWhiteSpace(group.Type))
                return BadRequest(new { message = "Group type is required" });

            if (group.Type != "client" && group.Type != "environment")
                return BadRequest(new { message = "Group type must be 'client' or 'environment'" });

            if (group.Type == "environment" && string.IsNullOrWhiteSpace(group.ParentId))
                return BadRequest(new { message = "Environment must have a parent client" });

            var saved = await _groupManager.SaveGroupAsync(group);
            _logger.LogInformation("Created/updated group {GroupId}", saved.Id);
            return Ok(saved);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create connection group");
            return StatusCode(500, new { message = "An internal error occurred." });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<ConnectionGroup>> UpdateGroup(string id, [FromBody] ConnectionGroup group)
    {
        var existing = await _groupManager.GetGroupAsync(id);
        if (existing == null)
            return NotFound();

        group.Id = id;
        var updated = await _groupManager.SaveGroupAsync(group);
        return Ok(updated);
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> DeleteGroup(string id)
    {
        var existing = await _groupManager.GetGroupAsync(id);
        if (existing == null)
            return NotFound();

        await _groupManager.DeleteGroupAsync(id);
        return NoContent();
    }
}
