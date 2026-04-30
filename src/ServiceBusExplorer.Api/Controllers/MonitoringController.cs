using Microsoft.AspNetCore.Mvc;
using ServiceBusExplorer.Api.Monitoring;

namespace ServiceBusExplorer.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class MonitoringController : ControllerBase
{
    private readonly MonitoringStore _store;

    public MonitoringController(MonitoringStore store)
    {
        _store = store;
    }

    [HttpGet("snapshot")]
    public ActionResult GetSnapshot()
    {
        var snapshot = _store.GetLatest();
        if (snapshot == null)
        {
            return Ok(new MonitoringSnapshot
            {
                Timestamp = DateTimeOffset.UtcNow
            });
        }

        return Ok(snapshot);
    }

    [HttpGet("history")]
    public ActionResult GetHistory([FromQuery] int count = 20)
    {
        if (count < 1) count = 1;
        if (count > 120) count = 120;

        var history = _store.GetHistory(count);
        return Ok(history);
    }
}
