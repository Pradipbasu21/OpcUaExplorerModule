namespace OpcUaWebApi.Models;

public class MonitoredNodeChangeDto
{
    public string NodeId { get; set; } = "";

    public object? Value { get; set; }

    public string? PreviousValue { get; set; }

    public bool HasChanged { get; set; }

    public string? DataType { get; set; }

    public string? StatusCode { get; set; }

    public DateTime? SourceTimestamp { get; set; }

    public DateTime? ServerTimestamp { get; set; }
}
