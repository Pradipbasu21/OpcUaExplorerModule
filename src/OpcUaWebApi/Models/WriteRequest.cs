namespace OpcUaWebApi.Models;

public class WriteRequest
{
    public string NodeId { get; set; } = "";
    public object? Value { get; set; }
    public string DataType { get; set; } = "String";
}