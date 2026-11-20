namespace OpcUaWebApi.Models;

public class BatchReadRequest
{
    public List<string> NodeIds { get; set; } = new();
}
