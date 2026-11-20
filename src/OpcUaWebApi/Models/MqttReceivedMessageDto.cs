namespace OpcUaWebApi.Models;
public sealed class MqttReceivedMessageDto
{
    public string Topic { get; set; } = "";
    public string Payload { get; set; } = "";
    public int Qos { get; set; }
    public bool Retain { get; set; }
    public DateTime ReceivedAtUtc { get; set; } = DateTime.UtcNow;
}
