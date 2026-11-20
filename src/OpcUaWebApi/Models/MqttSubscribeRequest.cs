namespace OpcUaWebApi.Models;
public sealed class MqttSubscribeRequest
{
    public string Topic { get; set; } = "";
    public int Qos { get; set; } = 1;
}
