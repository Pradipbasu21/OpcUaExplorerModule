using OpcUaWebApi.Models;

namespace OpcUaWebApi.Services;

public interface IOpcUaService
{
    Task<OpcUaHierarchyNode> BrowseHierarchyAsync(
        string nodeId,
        int maxDepth,
        int maxNodes,
        bool includeValues,
        bool hideSystemNodes = true);

    Task<bool> ConnectAsync(ConnectRequest request);

    Task DisconnectAsync();

    bool IsConnected { get; }

    Task<List<OpcUaNodeDto>> BrowseAsync(string nodeId);

    Task<object?> ReadAsync(string nodeId);

    Task<List<object>> ReadBatchAsync(IEnumerable<string> nodeIds);

    Task<List<MonitoredNodeChangeDto>> MonitorChangesAsync(
        IEnumerable<string> nodeIds,
        IDictionary<string, string?>? previousValues);

    Task WriteAsync(WriteRequest request);
}