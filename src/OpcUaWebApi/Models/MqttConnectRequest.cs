namespace OpcUaWebApi.Models;

public sealed class MqttConnectRequest
{
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 1883;
    public string ClientId { get; set; } = $"OpcUaWebApi-{Environment.MachineName}-01";
    public string? Username { get; set; }
    public string? Password { get; set; }
    public bool UseTls { get; set; } = false;
    public bool AutoReconnect { get; set; } = true;
    public int KeepAliveSeconds { get; set; } = 30;
}
