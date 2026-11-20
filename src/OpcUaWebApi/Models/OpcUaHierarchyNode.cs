using System.Text.Json.Serialization;

namespace OpcUaWebApi.Models;

public class OpcUaHierarchyNode
{
    public string NodeId { get; set; } = "";

    public string DisplayName { get; set; } = "";

    public string NodeClass { get; set; } = "";

    // Fully-qualified browse path, e.g. Channel3.Device3._System._Description.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? BrowsePath { get; set; }

    // Simulator/vendor Address property when exposed; otherwise NodeId.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Address { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public object? Value { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DataType { get; set; }

    // MinimumSamplingInterval (ms), unless a vendor ScanRate property is available.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? ScanRate { get; set; }

    // Human-readable scan time string, e.g. "1000 ms" or "100 ms".
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ScanTime { get; set; }

    // On-Change mode or triggering mode, e.g. "On Change", "Cyclic".
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? OnChangeMode { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Scaling { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Description { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? StatusCode { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public DateTime? SourceTimestamp { get; set; }

    public List<OpcUaHierarchyNode> Children { get; set; } = new();
}