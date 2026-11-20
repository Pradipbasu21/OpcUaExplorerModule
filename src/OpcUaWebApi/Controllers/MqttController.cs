using Microsoft.AspNetCore.Mvc;
using OpcUaWebApi.Models;
using OpcUaWebApi.Services;

namespace OpcUaWebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class MqttController : ControllerBase
{
    private readonly IMqttConnectivityService _mqtt;
    public MqttController(IMqttConnectivityService mqtt) => _mqtt = mqtt;

    [HttpPost("connect")]
    public async Task<IActionResult> Connect([FromBody] MqttConnectRequest request, CancellationToken ct)
    {
        try { await _mqtt.ConnectAsync(request, ct); return Ok(new { success = true, message = "Connected to MQTT broker.", connected = _mqtt.IsConnected }); }
        catch (Exception ex) { return BadRequest(new { success = false, message = ex.Message }); }
    }

    [HttpPost("disconnect")]
    public async Task<IActionResult> Disconnect(CancellationToken ct)
    {
        try { await _mqtt.DisconnectAsync(ct); return Ok(new { success = true, message = "Disconnected from MQTT broker." }); }
        catch (Exception ex) { return BadRequest(new { success = false, message = ex.Message }); }
    }

    [HttpGet("status")]
    public IActionResult Status() => Ok(new { connected = _mqtt.IsConnected, status = _mqtt.Status });

    [HttpPost("publish")]
    public async Task<IActionResult> Publish([FromBody] MqttPublishRequest request, CancellationToken ct)
    {
        try { await _mqtt.PublishAsync(request, ct); return Ok(new { success = true, message = "MQTT message published." }); }
        catch (Exception ex) { return BadRequest(new { success = false, message = ex.Message }); }
    }

    [HttpPost("subscribe")]
    public async Task<IActionResult> Subscribe([FromBody] MqttSubscribeRequest request, CancellationToken ct)
    {
        try { await _mqtt.SubscribeAsync(request, ct); return Ok(new { success = true, message = $"Subscribed to {request.Topic}." }); }
        catch (Exception ex) { return BadRequest(new { success = false, message = ex.Message }); }
    }

    [HttpDelete("subscribe")]
    public async Task<IActionResult> Unsubscribe([FromQuery] string topic, CancellationToken ct)
    {
        try { await _mqtt.UnsubscribeAsync(topic, ct); return Ok(new { success = true, message = $"Unsubscribed from {topic}." }); }
        catch (Exception ex) { return BadRequest(new { success = false, message = ex.Message }); }
    }

    [HttpGet("messages")]
    public IActionResult Messages([FromQuery] int take = 50) => Ok(new { success = true, messages = _mqtt.GetRecentMessages(take) });
}
