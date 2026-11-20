using OpcUaWebApi.Models;
namespace OpcUaWebApi.Services;
public interface IMqttConnectivityService
{
    bool IsConnected { get; }
    string Status { get; }
    Task ConnectAsync(MqttConnectRequest request, CancellationToken cancellationToken = default);
    Task DisconnectAsync(CancellationToken cancellationToken = default);
    Task PublishAsync(MqttPublishRequest request, CancellationToken cancellationToken = default);
    Task SubscribeAsync(MqttSubscribeRequest request, CancellationToken cancellationToken = default);
    Task UnsubscribeAsync(string topic, CancellationToken cancellationToken = default);
    IReadOnlyCollection<MqttReceivedMessageDto> GetRecentMessages(int take = 50);
}
