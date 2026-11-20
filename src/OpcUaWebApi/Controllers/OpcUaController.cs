
using Microsoft.AspNetCore.Mvc;
using OpcUaWebApi.Models;
using OpcUaWebApi.Services;

namespace OpcUaWebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OpcUaController : ControllerBase
{
    private readonly IOpcUaService _opcUa;

    public OpcUaController(IOpcUaService opcUa)
    {
        _opcUa = opcUa;
    }

    [HttpPost("connect")]
    public async Task<IActionResult> Connect(
        [FromBody] ConnectRequest request)
    {
        try
        {
            bool connected = await _opcUa.ConnectAsync(request);

            return Ok(new
            {
                Success = connected,
                Message = connected
                    ? "Connected to OPC UA server."
                    : "Connection failed."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new
            {
                Success = false,
                Message = ex.Message
            });
        }
    }

    [HttpPost("disconnect")]
    public async Task<IActionResult> Disconnect()
    {
        try
        {
            await _opcUa.DisconnectAsync();

            return Ok(new
            {
                Success = true,
                Message = "Disconnected."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { Message = ex.Message });
        }
    }

    [HttpGet("status")]
    public IActionResult Status()
    {
        return Ok(new
        {
            Connected = _opcUa.IsConnected,
            Status = _opcUa.IsConnected
                ? "Connected"
                : "Disconnected"
        });
    }

    [HttpGet("browse")]
    public async Task<IActionResult> Browse(
        [FromQuery] string nodeId = "i=85")
    {
        try
        {
            var nodes = await _opcUa.BrowseAsync(nodeId);

            return Ok(nodes);
        }
        catch (Exception ex)
        {
            return BadRequest(new { Message = ex.Message });
        }
    }

    [HttpPost("read")]
    public async Task<IActionResult> Read(
        [FromBody] ReadRequest request)
    {
        try
        {
            var result = await _opcUa.ReadAsync(request.NodeId);

            return Ok(new
            {
                Success = true,
                Data = result
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { Message = ex.Message });
        }
    }

    [HttpPost("read/batch")]
    public async Task<IActionResult> ReadBatch(
        [FromBody] BatchReadRequest request)
    {
        try
        {
            if (request.NodeIds == null || request.NodeIds.Count == 0)
            {
                return BadRequest(new { Message = "No nodeIds provided in request." });
            }

            var results = await _opcUa.ReadBatchAsync(request.NodeIds);

            return Ok(new
            {
                Success = true,
                Count = results.Count,
                Data = results
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { Message = ex.Message });
        }
    }

    [HttpPost("monitor/changes")]
    public async Task<IActionResult> MonitorChanges(
        [FromBody] MonitorChangesRequest request)
    {
        try
        {
            if (request.NodeIds == null || request.NodeIds.Count == 0)
            {
                return BadRequest(new { Message = "No nodeIds provided." });
            }

            var results = await _opcUa.MonitorChangesAsync(request.NodeIds, request.PreviousValues);
            int changesCount = results.Count(r => r.HasChanged);

            return Ok(new
            {
                Success = true,
                HasChanges = changesCount > 0,
                ChangesCount = changesCount,
                Data = results
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { Message = ex.Message });
        }
    }

    [HttpPost("write")]
    public async Task<IActionResult> Write(
        [FromBody] WriteRequest request)
    {
        try
        {
            await _opcUa.WriteAsync(request);

            return Ok(new
            {
                Success = true,
                Message = "Value written successfully."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { Message = ex.Message });
        }
    }


    [HttpGet("browse/hierarchy")]
    public async Task<IActionResult> BrowseHierarchy(
        [FromQuery] string nodeId = "i=85",
        [FromQuery] int maxDepth = 10,
        [FromQuery] int maxNodes = 5000,
        [FromQuery] bool includeValues = true,
        [FromQuery] bool hideSystemNodes = true,
        [FromQuery] bool showValue = true,
        [FromQuery] bool showDataType = true,
        [FromQuery] bool showStatusCode = true,
        [FromQuery] bool showSourceTimestamp = true)
    {
        try
        {
            if (maxDepth < 0 || maxDepth > 50)
                return BadRequest(new
                {
                    Message = "maxDepth must be between 0 and 50."
                });

            if (maxNodes < 1 || maxNodes > 50000)
                return BadRequest(new
                {
                    Message = "maxNodes must be between 1 and 50000."
                });

            var result = await _opcUa.BrowseHierarchyAsync(
                nodeId,
                maxDepth,
                maxNodes,
                includeValues,
                hideSystemNodes);

            ApplyHierarchyFilters(
                result,
                showValue,
                showDataType,
                showStatusCode,
                showSourceTimestamp);

            return Ok(new
            {
                Success = true,
                TotalNodes = CountNodes(result),
                Data = result
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new
            {
                Success = false,
                Message = ex.Message
            });
        }
    }

    private static void ApplyHierarchyFilters(
        OpcUaHierarchyNode node,
        bool showValue,
        bool showDataType,
        bool showStatusCode,
        bool showSourceTimestamp)
    {
        if (!showValue)
            node.Value = null;

        if (!showDataType)
            node.DataType = null;

        if (!showStatusCode)
            node.StatusCode = null;

        if (!showSourceTimestamp)
            node.SourceTimestamp = null;

        foreach (var child in node.Children)
        {
            ApplyHierarchyFilters(
                child,
                showValue,
                showDataType,
                showStatusCode,
                showSourceTimestamp);
        }
    }

    private static int CountNodes(OpcUaHierarchyNode node)
    {
        return 1 + node.Children.Sum(CountNodes);
    }

}
