using System.Collections.Concurrent;
using MQTTnet;
using MQTTnet.Protocol;
using OpcUaWebApi.Models;

namespace OpcUaWebApi.Services;

public sealed class MqttConnectivityService : IMqttConnectivityService, IAsyncDisposable
{
    private readonly ILogger<MqttConnectivityService> _logger;
    private readonly MqttClientFactory _factory = new();
    private readonly SemaphoreSlim _lifecycleLock = new(1, 1);
    private readonly ConcurrentQueue<MqttReceivedMessageDto> _received = new();
    private readonly ConcurrentDictionary<string, int> _subscriptions = new(StringComparer.Ordinal);
    private IMqttClient? _client;
    private MqttClientOptions? _lastOptions;
    private CancellationTokenSource? _reconnectCts;
    private Task? _reconnectTask;
    private volatile bool _manualDisconnect;
    private volatile bool _autoReconnect;
    private int _reconnectLoopRunning;
    private string _status = "Disconnected";

    public MqttConnectivityService(ILogger<MqttConnectivityService> logger) => _logger = logger;
    public bool IsConnected => _client?.IsConnected == true;
    public string Status => IsConnected ? "Connected" : _status;


    public async Task ConnectAsync(
        MqttConnectRequest request,
        CancellationToken cancellationToken = default)
    {
        Validate(request);

        await _lifecycleLock.WaitAsync(cancellationToken);

        try
        {
            if (_client?.IsConnected == true)
                return;

            _manualDisconnect = false;
            _autoReconnect = request.AutoReconnect;

            _reconnectCts?.Cancel();
            _reconnectCts?.Dispose();
            _reconnectCts = new CancellationTokenSource();

            if (_client == null)
            {
                _client = _factory.CreateMqttClient();
                _client.ApplicationMessageReceivedAsync += OnMessageReceivedAsync;
                _client.DisconnectedAsync += OnDisconnectedAsync;
                _client.ConnectedAsync += OnConnectedAsync;
            }

            // Generate Client ID from Ubuntu hostname if not provided
            string clientId = string.IsNullOrWhiteSpace(request.ClientId)
                ? $"OpcUaWebApi-{Environment.MachineName}-01"
                : request.ClientId.Trim();

            var builder = new MqttClientOptionsBuilder()
                .WithClientId(clientId)
                .WithTcpServer(request.Host, request.Port)
                .WithKeepAlivePeriod(
                    TimeSpan.FromSeconds(request.KeepAliveSeconds))
                .WithCleanSession();

            if (!string.IsNullOrWhiteSpace(request.Username))
            {
                builder.WithCredentials(
                    request.Username,
                    request.Password ?? string.Empty);
            }

            if (request.UseTls)
                builder.WithTlsOptions(tls => tls.UseTls());

            _lastOptions = builder.Build();

            _status = "Connecting";

            var result = await _client.ConnectAsync(
                _lastOptions,
                cancellationToken);

            if (!_client.IsConnected)
            {
                throw new InvalidOperationException(
                    $"MQTT connection rejected: {result.ResultCode}");
            }

            _status = "Connected";

            _logger.LogInformation(
                "MQTT connected to {Host}:{Port} with ClientId {ClientId}; result {Result}",
                request.Host,
                request.Port,
                clientId,
                result.ResultCode);
        }
        catch (Exception ex)
        {
            _status = $"Connection failed: {ex.Message}";
            _logger.LogError(ex, "MQTT connection failed.");
            throw;
        }
        finally
        {
            _lifecycleLock.Release();
        }
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        _manualDisconnect = true;
        _autoReconnect = false;
        _reconnectCts?.Cancel();
        await _lifecycleLock.WaitAsync(cancellationToken);
        try
        {
            if (_client?.IsConnected == true)
                await _client.DisconnectAsync(_factory.CreateClientDisconnectOptionsBuilder().Build(), cancellationToken);
            _status = "Disconnected";
            _subscriptions.Clear();
        }
        finally { _lifecycleLock.Release(); }
    }

    public async Task PublishAsync(MqttPublishRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Topic)) throw new ArgumentException("MQTT topic is required.");
        var client = GetConnectedClient();
        var message = new MqttApplicationMessageBuilder()
            .WithTopic(request.Topic).WithPayload(request.Payload ?? string.Empty)
            .WithQualityOfServiceLevel(ToQos(request.Qos)).WithRetainFlag(request.Retain).Build();
        await client.PublishAsync(message, cancellationToken);
    }

    public async Task SubscribeAsync(MqttSubscribeRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Topic)) throw new ArgumentException("MQTT topic filter is required.");
        var client = GetConnectedClient();
        var filter = _factory.CreateTopicFilterBuilder().WithTopic(request.Topic)
            .WithQualityOfServiceLevel(ToQos(request.Qos)).Build();
        var options = _factory.CreateSubscribeOptionsBuilder().WithTopicFilter(filter).Build();
        await client.SubscribeAsync(options, cancellationToken);
        _subscriptions[request.Topic] = request.Qos;
    }

    public async Task UnsubscribeAsync(string topic, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(topic)) throw new ArgumentException("MQTT topic is required.");
        var client = GetConnectedClient();
        var options = _factory.CreateUnsubscribeOptionsBuilder().WithTopicFilter(topic).Build();
        await client.UnsubscribeAsync(options, cancellationToken);
        _subscriptions.TryRemove(topic, out _);
    }

    public IReadOnlyCollection<MqttReceivedMessageDto> GetRecentMessages(int take = 50) =>
        _received.ToArray().OrderByDescending(x => x.ReceivedAtUtc).Take(Math.Clamp(take, 1, 500)).ToArray();

    private IMqttClient GetConnectedClient() => _client?.IsConnected == true
        ? _client : throw new InvalidOperationException("MQTT broker is not connected.");

    private Task OnConnectedAsync(MqttClientConnectedEventArgs args)
    {
        _status = "Connected";
        _logger.LogInformation("MQTT connection established.");
        return Task.CompletedTask;
    }

    private Task OnDisconnectedAsync(MqttClientDisconnectedEventArgs args)
    {
        _status = "Disconnected";
        _logger.LogWarning(args.Exception, "MQTT connection lost.");
        if (_autoReconnect && !_manualDisconnect) StartReconnectLoop();
        return Task.CompletedTask;
    }

    private Task OnMessageReceivedAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        var message = args.ApplicationMessage;
        _received.Enqueue(new MqttReceivedMessageDto
        {
            Topic = message.Topic,
            Payload = message.ConvertPayloadToString() ?? string.Empty,
            Qos = (int)message.QualityOfServiceLevel,
            Retain = message.Retain,
            ReceivedAtUtc = DateTime.UtcNow
        });
        while (_received.Count > 500) _received.TryDequeue(out _);
        return Task.CompletedTask;
    }

    private void StartReconnectLoop()
    {
        if (Interlocked.CompareExchange(ref _reconnectLoopRunning, 1, 0) != 0) return;
        var token = _reconnectCts?.Token ?? CancellationToken.None;
        _reconnectTask = Task.Run(async () =>
        {
            try
            {
                while (!token.IsCancellationRequested && _autoReconnect && !_manualDisconnect)
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), token);
                    await _lifecycleLock.WaitAsync(token);
                    try
                    {
                        if (_client?.IsConnected == true || _lastOptions == null) continue;
                        _status = "Reconnecting";
                        await _client!.ConnectAsync(_lastOptions, token);
                        if (_client.IsConnected)
                        {
                            _status = "Connected";
                            await RestoreSubscriptionsAsync(token);
                            break;
                        }
                    }
                    catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
                    catch (Exception ex)
                    {
                        _status = $"Reconnect pending: {ex.Message}";
                        _logger.LogWarning(ex, "MQTT reconnect attempt failed.");
                    }
                    finally { _lifecycleLock.Release(); }
                }
            }
            catch (OperationCanceledException) { }
            finally { Interlocked.Exchange(ref _reconnectLoopRunning, 0); }
        });
    }

    private async Task RestoreSubscriptionsAsync(CancellationToken cancellationToken)
    {
        if (_client?.IsConnected != true || _subscriptions.IsEmpty) return;
        var builder = _factory.CreateSubscribeOptionsBuilder();
        foreach (var item in _subscriptions)
            builder.WithTopicFilter(f => f.WithTopic(item.Key).WithQualityOfServiceLevel(ToQos(item.Value)));
        await _client.SubscribeAsync(builder.Build(), cancellationToken);
    }

    private static MqttQualityOfServiceLevel ToQos(int qos) => qos switch
    {
        0 => MqttQualityOfServiceLevel.AtMostOnce,
        1 => MqttQualityOfServiceLevel.AtLeastOnce,
        2 => MqttQualityOfServiceLevel.ExactlyOnce,
        _ => throw new ArgumentOutOfRangeException(nameof(qos), "QoS must be 0, 1 or 2.")
    };

    private static void Validate(MqttConnectRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Host)) throw new ArgumentException("MQTT broker host is required.");
        if (request.Port is < 1 or > 65535) throw new ArgumentOutOfRangeException(nameof(request.Port));
        if (string.IsNullOrWhiteSpace(request.ClientId)) throw new ArgumentException("MQTT client ID is required.");
        if (request.KeepAliveSeconds is < 5 or > 3600) throw new ArgumentOutOfRangeException(nameof(request.KeepAliveSeconds));
    }

    public async ValueTask DisposeAsync()
    {
        _manualDisconnect = true;
        _autoReconnect = false;
        _reconnectCts?.Cancel();
        if (_reconnectTask != null) { try { await _reconnectTask; } catch (OperationCanceledException) { } }
        if (_client != null)
        {
            if (_client.IsConnected)
            {
                try { await _client.DisconnectAsync(_factory.CreateClientDisconnectOptionsBuilder().Build()); }
                catch (Exception ex) { _logger.LogDebug(ex, "MQTT shutdown disconnect failed."); }
            }
            _client.Dispose();
        }
        _reconnectCts?.Dispose();
        _lifecycleLock.Dispose();
    }
}
