namespace OpcUaWebApi.Models;

public class ConnectRequest
{
    public string EndpointUrl { get; set; } = "";
    public string? Username { get; set; }
    public string? Password { get; set; }
}