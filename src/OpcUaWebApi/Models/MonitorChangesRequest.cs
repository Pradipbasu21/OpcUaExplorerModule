namespace OpcUaWebApi.Models;

public class MonitorChangesRequest
{
    public List<string> NodeIds { get; set; } = new();

    public Dictionary<string, string?>? PreviousValues { get; set; }
}
