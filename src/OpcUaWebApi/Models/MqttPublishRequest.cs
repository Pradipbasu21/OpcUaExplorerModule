namespace OpcUaWebApi.Models;
public sealed class MqttPublishRequest
{
    public string Topic { get; set; } = "";
    public string Payload { get; set; } = "";
    public int Qos { get; set; } = 1;
    public bool Retain { get; set; }
}
