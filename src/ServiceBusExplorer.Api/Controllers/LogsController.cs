using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Api.Logs;

namespace ServiceBusExplorer.Api.Controllers;

/// <summary>The lines the backend logged since it started, for the Logs screen of Developer mode.</summary>
[ApiController]
[Route("api/logs")]
public class LogsController(RecentLogStore store) : ControllerBase
{
    /// <summary>The lines after the id <paramref name="after"/>, oldest first; every line when it is omitted.</summary>
    [HttpGet]
    public ActionResult<IReadOnlyList<RecentLogLine>> Get([FromQuery] long after = 0) => Ok(store.After(after));

    /// <summary>Forgets every line kept.</summary>
    [HttpDelete]
    public IActionResult Clear()
    {
        store.Clear();
        return NoContent();
    }
}
