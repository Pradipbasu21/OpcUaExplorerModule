
using Opc.Ua;
using Opc.Ua.Client;
using Opc.Ua.Configuration;
using OpcUaWebApi.Models;
using OpcUaSession = Opc.Ua.Client.ISession;
using ApiWriteRequest = OpcUaWebApi.Models.WriteRequest;

namespace OpcUaWebApi.Services;

public sealed class OpcUaService : IOpcUaService, IDisposable
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<OpcUaService> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);

    private OpcUaSession? _session;

    public OpcUaService(
        IConfiguration configuration,
        ILogger<OpcUaService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public bool IsConnected => _session?.Connected == true;

    public async Task<bool> ConnectAsync(ConnectRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.EndpointUrl))
            throw new ArgumentException("Endpoint URL is required.");

        await _lock.WaitAsync();

        try
        {
            if (_session?.Connected == true)
                return true;

            if (_session != null)
            {
                _session.Dispose();
                _session = null;
            }

            var config = await BuildConfigurationAsync();

            bool useSecurity =
                _configuration.GetValue<bool>("OpcUa:UseSecurity");

            var endpoint = CoreClientUtils.SelectEndpoint(
                config,
                request.EndpointUrl,
                useSecurity);

            var configuredEndpoint = new ConfiguredEndpoint(
                null,
                endpoint,
                EndpointConfiguration.Create(config));

            IUserIdentity identity;

            if (!string.IsNullOrWhiteSpace(request.Username))
            {
                identity = new UserIdentity(
                    new UserNameIdentityToken
                    {
                        UserName = request.Username,
                        DecryptedPassword = System.Text.Encoding.UTF8.GetBytes(
                            request.Password ?? string.Empty)
                    });
            }
            else
            {
                identity = new UserIdentity(
                    new AnonymousIdentityToken());
            }

            uint timeout = _configuration.GetValue<uint>(
                "OpcUa:SessionTimeout", 60000);

            _session = await Session.Create(
                config,
                configuredEndpoint,
                false,
                "OpcUaWebApiSession",
                timeout,
                identity,
                null);

            _logger.LogInformation(
                "Connected to OPC UA server: {Endpoint}",
                request.EndpointUrl);

            return _session.Connected;
        }
        catch
        {
            _session?.Dispose();
            _session = null;
            throw;
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task<ApplicationConfiguration>
        BuildConfigurationAsync()
    {
        string pki = Path.Combine(
            AppContext.BaseDirectory, "pki");

        var config = new ApplicationConfiguration
        {
            ApplicationName = "OpcUaWebApi",
            ApplicationUri = "urn:localhost:OpcUaWebApi",
            ApplicationType = ApplicationType.Client,

            SecurityConfiguration = new SecurityConfiguration
            {
                ApplicationCertificate = new CertificateIdentifier
                {
                    StoreType = "Directory",
                    StorePath = Path.Combine(pki, "own"),
                    SubjectName = "CN=OpcUaWebApi"
                },

                TrustedPeerCertificates = new CertificateTrustList
                {
                    StoreType = "Directory",
                    StorePath = Path.Combine(pki, "trusted")
                },

                TrustedIssuerCertificates = new CertificateTrustList
                {
                    StoreType = "Directory",
                    StorePath = Path.Combine(pki, "issuer")
                },

                RejectedCertificateStore = new CertificateTrustList
                {
                    StoreType = "Directory",
                    StorePath = Path.Combine(pki, "rejected")
                },

                AutoAcceptUntrustedCertificates = false
            },

            TransportConfigurations =
                new TransportConfigurationCollection(),

            TransportQuotas = new TransportQuotas
            {
                OperationTimeout = 15000
            },

            ClientConfiguration = new ClientConfiguration
            {
                DefaultSessionTimeout = 60000
            }
        };

        await config.Validate(ApplicationType.Client);

        return config;
    }


    // public async Task<OpcUaHierarchyNode> BrowseHierarchyAsync(
    //     string nodeId,
    //     int maxDepth,
    //     int maxNodes,
    //     bool includeValues)
    // {
    //     await _lock.WaitAsync();

    //     try
    //     {
    //         var session = GetSession();

    //         var rootId = NodeId.Parse(nodeId);

    //         int totalNodes = 1;

    //         var visitedPath = new HashSet<string>
    //     {
    //         rootId.ToString()
    //     };

    //         var root = new OpcUaHierarchyNode
    //         {
    //             NodeId = rootId.ToString(),
    //             DisplayName = nodeId,
    //             NodeClass = "Root"
    //         };

    //         BrowseChildren(
    //             session,
    //             rootId,
    //             root,
    //             0,
    //             maxDepth,
    //             maxNodes,
    //             includeValues,
    //             ref totalNodes,
    //             visitedPath);

    //         return root;
    //     }
    //     finally
    //     {
    //         _lock.Release();
    //     }
    // }

    public async Task<OpcUaHierarchyNode> BrowseHierarchyAsync(
        string nodeId,
        int maxDepth,
        int maxNodes,
        bool includeValues,
        bool hideSystemNodes = true)
    {
        await _lock.WaitAsync();

        try
        {
            var session = GetSession();

            _logger.LogInformation(
                "OPC UA Browse started. NodeId: {NodeId}, Connected: {Connected}",
                nodeId, session.Connected);

            var rootId = NodeId.Parse(nodeId);

            int totalNodes = 1;

            var visitedPath = new HashSet<string>
        {
            rootId.ToString()
        };

            var root = new OpcUaHierarchyNode
            {
                NodeId = rootId.ToString(),
                DisplayName = rootId == ObjectIds.RootFolder ? "Root" : nodeId,
                NodeClass = "Root",
                BrowsePath = ""
            };

            BrowseChildren(
                session,
                rootId,
                root,
                0,
                maxDepth,
                maxNodes,
                includeValues,
                hideSystemNodes,
                ref totalNodes,
                visitedPath);

            _logger.LogInformation(
                "OPC UA Browse completed. TotalNodes: {TotalNodes}",
                totalNodes);

            return root;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "OPC UA Browse failed. Session may have been closed.");

            throw;
        }
        finally
        {
            _lock.Release();
        }
    }
    private void BrowseChildren(
        OpcUaSession session,
        NodeId parentId,
        OpcUaHierarchyNode parent,
        int currentDepth,
        int maxDepth,
        int maxNodes,
        bool includeValues,
        bool hideSystemNodes,
        ref int totalNodes,
        HashSet<string> visitedPath)
    {
        if (currentDepth >= maxDepth || totalNodes >= maxNodes)
            return;

        session.Browse(
            null,
            null,
            parentId,
            0,
            BrowseDirection.Forward,
            ReferenceTypeIds.HierarchicalReferences,
            true,
            0,
            out _,
            out ReferenceDescriptionCollection references);

        foreach (var reference in references)
        {
            if (totalNodes >= maxNodes)
                break;

            string childName = reference.DisplayName?.Text ?? "";

            // Hide unnecessary children of Channel1 (or any Channel), e.g. _System, _Statistics, _Hints
            if (hideSystemNodes && IsUnnecessaryChild(parent.DisplayName, childName))
            {
                continue;
            }

            NodeId? childId = ExpandedNodeId.ToNodeId(
                reference.NodeId,
                session.NamespaceUris);

            if (childId == null)
                continue;

            string childKey = childId.ToString();

            // Prevent circular references in the current path.
            if (visitedPath.Contains(childKey))
                continue;

            var child = new OpcUaHierarchyNode
            {
                NodeId = childKey,
                DisplayName = childName,
                NodeClass = reference.NodeClass.ToString()
            };

            totalNodes++;

            // Build a fully-qualified tag path. The standard Root and Objects
            // containers are omitted, e.g. Channel3.Device3._System._Description.
            child.BrowsePath = BuildBrowsePath(parent.BrowsePath, child.DisplayName);

            if (reference.NodeClass == NodeClass.Variable)
            {
                // Read OPC UA metadata independently of the current value.
                // Missing optional attributes are left null and omitted from JSON.
                try
                {
                    PopulateVariableMetadata(session, childId, child);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex,
                        "Could not read metadata for OPC UA node {NodeId}", childKey);
                }

                if (includeValues)
                {
                    try
                    {
                        DataValue dataValue = session.ReadValue(childId);

                        child.Value = dataValue.Value;
                        child.StatusCode = dataValue.StatusCode.ToString();

                        child.SourceTimestamp =
                            dataValue.SourceTimestamp == DateTime.MinValue
                            ? null
                            : dataValue.SourceTimestamp;

                        // Prefer the declared OPC UA DataType attribute.
                        // Runtime CLR type is only a fallback.
                        child.DataType ??= dataValue.Value?.GetType().Name;
                    }
                    catch (Exception ex)
                    {
                        child.StatusCode = "ReadError: " + ex.Message;
                        _logger.LogDebug(ex,
                            "Could not read value for OPC UA node {NodeId}", childKey);
                    }
                }
            }

            parent.Children.Add(child);

            // Recursively browse child nodes.
            visitedPath.Add(childKey);

            BrowseChildren(
                session,
                childId,
                child,
                currentDepth + 1,
                maxDepth,
                maxNodes,
                includeValues,
                hideSystemNodes,
                ref totalNodes,
                visitedPath);

            visitedPath.Remove(childKey);
        }
    }

    private static string BuildBrowsePath(string parentPath, string displayName)
    {
        // Keep the path useful for simulator tag names: Root.Objects are containers,
        // not part of the fully-qualified tag name.
        if (string.Equals(displayName, "Objects", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrEmpty(parentPath))
        {
            return "";
        }

        return string.IsNullOrWhiteSpace(parentPath)
            ? displayName
            : $"{parentPath}.{displayName}";
    }

    private static bool IsUnnecessaryChild(string? parentName, string? childName)
    {
        if (string.IsNullOrWhiteSpace(childName))
            return false;

        // Hide unnecessary diagnostic children of Channel1 or any Channel
        if (!string.IsNullOrWhiteSpace(parentName) &&
            parentName.Contains("Channel", StringComparison.OrdinalIgnoreCase))
        {
            if (childName.StartsWith("_") ||
                childName.Equals("_System", StringComparison.OrdinalIgnoreCase) ||
                childName.Equals("_Statistics", StringComparison.OrdinalIgnoreCase) ||
                childName.Equals("_Hints", StringComparison.OrdinalIgnoreCase) ||
                childName.Equals("_DataLogger", StringComparison.OrdinalIgnoreCase) ||
                childName.Equals("_IOMonitor", StringComparison.OrdinalIgnoreCase) ||
                childName.Equals("_AdvancedTags", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private void PopulateVariableMetadata(
        OpcUaSession session,
        NodeId nodeId,
        OpcUaHierarchyNode node)
    {
        // Read standard OPC UA Variable attributes in one service call.
        var attributes = new ReadValueIdCollection
        {
            new ReadValueId
            {
                NodeId = nodeId,
                AttributeId = Attributes.DataType
            },
            new ReadValueId
            {
                NodeId = nodeId,
                AttributeId = Attributes.Description
            },
            new ReadValueId
            {
                NodeId = nodeId,
                AttributeId = Attributes.MinimumSamplingInterval
            }
        };

        session.Read(
            null,
            0,
            TimestampsToReturn.Neither,
            attributes,
            out DataValueCollection values,
            out DiagnosticInfoCollection diagnostics);

        if (values.Count > 0 && !StatusCode.IsBad(values[0].StatusCode)
            && values[0].Value is NodeId dataTypeId)
        {
            node.DataType = GetDataTypeName(session, dataTypeId);
        }

        if (values.Count > 1 && !StatusCode.IsBad(values[1].StatusCode)
            && values[1].Value is LocalizedText description
            && !string.IsNullOrWhiteSpace(description.Text))
        {
            node.Description = description.Text;
        }

        if (values.Count > 2 && !StatusCode.IsBad(values[2].StatusCode)
            && values[2].Value != null)
        {
            if (double.TryParse(
                Convert.ToString(values[2].Value,
                    System.Globalization.CultureInfo.InvariantCulture),
                System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture,
                out double minimumSamplingInterval)
                && minimumSamplingInterval >= 0
                && !double.IsNaN(minimumSamplingInterval)
                && !double.IsInfinity(minimumSamplingInterval))
            {
                node.ScanRate = minimumSamplingInterval;
            }
        }

        // Simulator/vendor metadata is not part of the standard OPC UA Variable
        // attributes. Read conventional HasProperty children when the server exposes
        // properties named Address, ScanRate or Scaling.
        ReadVendorProperties(session, nodeId, node);

        // Address defaults to the OPC UA NodeId. A vendor Address property, when
        // available, overrides this with values such as RANDOM(...) or RAMP(...).
        node.Address ??= node.NodeId;

        // Ensure ScanTime and OnChangeMode are populated
        if (string.IsNullOrWhiteSpace(node.ScanTime))
        {
            if (node.ScanRate.HasValue && node.ScanRate.Value >= 0)
            {
                node.ScanTime = node.ScanRate.Value == 0 ? "0 ms (Immediate)" : $"{node.ScanRate.Value} ms";
            }
            else
            {
                node.ScanTime = "1000 ms";
            }
        }

        if (string.IsNullOrWhiteSpace(node.OnChangeMode))
        {
            node.OnChangeMode = "On Change";
        }
    }

    private string GetDataTypeName(OpcUaSession session, NodeId dataTypeId)
    {
        if (dataTypeId.NamespaceIndex == 0
            && uint.TryParse(dataTypeId.Identifier?.ToString(), out uint id))
        {
            return id switch
            {
                1 => "Boolean",
                2 => "SByte",
                3 => "Byte",
                4 => "Int16",
                5 => "UInt16",
                6 => "Int32",
                7 => "UInt32",
                8 => "Int64",
                9 => "UInt64",
                10 => "Float",
                11 => "Double",
                12 => "String",
                13 => "DateTime",
                14 => "Guid",
                15 => "ByteString",
                16 => "XmlElement",
                17 => "NodeId",
                18 => "ExpandedNodeId",
                19 => "StatusCode",
                20 => "QualifiedName",
                21 => "LocalizedText",
                22 => "ExtensionObject",
                23 => "DataValue",
                24 => "Variant",
                25 => "DiagnosticInfo",
                _ => dataTypeId.ToString()
            };
        }

        // For vendor-specific/custom data types, resolve the DataType node's
        // BrowseName so the UI can display a readable name instead of only ns=...;i=...
        try
        {
            var browseNameRequest = new ReadValueIdCollection
            {
                new ReadValueId
                {
                    NodeId = dataTypeId,
                    AttributeId = Attributes.BrowseName
                }
            };

            session.Read(
                null,
                0,
                TimestampsToReturn.Neither,
                browseNameRequest,
                out DataValueCollection browseNameValues,
                out DiagnosticInfoCollection browseNameDiagnostics);

            if (browseNameValues.Count > 0
                && !StatusCode.IsBad(browseNameValues[0].StatusCode)
                && browseNameValues[0].Value is QualifiedName browseName
                && !string.IsNullOrWhiteSpace(browseName.Name))
            {
                return browseName.Name;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex,
                "Could not resolve OPC UA DataType name for {DataTypeId}",
                dataTypeId);
        }

        return dataTypeId.ToString();
    }

    private void ReadVendorProperties(
        OpcUaSession session,
        NodeId variableNodeId,
        OpcUaHierarchyNode node)
    {
        session.Browse(
            null,
            null,
            variableNodeId,
            0,
            BrowseDirection.Forward,
            ReferenceTypeIds.HasProperty,
            true,
            (uint)NodeClass.Variable,
            out _,
            out ReferenceDescriptionCollection properties);

        foreach (var property in properties)
        {
            var propertyNodeId = ExpandedNodeId.ToNodeId(
                property.NodeId,
                session.NamespaceUris);

            if (propertyNodeId == null)
                continue;

            string propertyName = property.BrowseName.Name ?? "";
            if (propertyName.Length == 0)
                continue;

            // Read only metadata properties that are relevant to the tag table.
            if (!propertyName.Equals("Address", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("ScanRate", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("Scan Rate", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("ScanTime", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("Scan Time", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("SamplingInterval", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("ScanMode", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("Scan Mode", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("OnChangeMode", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("On Change Mode", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("DataChangeTrigger", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("Scaling", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("Scale", StringComparison.OrdinalIgnoreCase)
                && !propertyName.Equals("Description", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            try
            {
                DataValue propertyValue = session.ReadValue(propertyNodeId);
                if (StatusCode.IsBad(propertyValue.StatusCode)
                    || propertyValue.Value == null)
                {
                    continue;
                }

                string value = Convert.ToString(
                    propertyValue.Value,
                    System.Globalization.CultureInfo.InvariantCulture) ?? "";

                if (propertyName.Equals("Address", StringComparison.OrdinalIgnoreCase))
                {
                    node.Address = value;
                }
                else if (propertyName.Equals("ScanRate", StringComparison.OrdinalIgnoreCase)
                    || propertyName.Equals("Scan Rate", StringComparison.OrdinalIgnoreCase)
                    || propertyName.Equals("SamplingInterval", StringComparison.OrdinalIgnoreCase))
                {
                    if (double.TryParse(value,
                        System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out double scanRate))
                    {
                        node.ScanRate = scanRate;
                        node.ScanTime = $"{scanRate} ms";
                    }
                }
                else if (propertyName.Equals("ScanTime", StringComparison.OrdinalIgnoreCase)
                    || propertyName.Equals("Scan Time", StringComparison.OrdinalIgnoreCase))
                {
                    node.ScanTime = value.EndsWith("ms", StringComparison.OrdinalIgnoreCase) ? value : $"{value} ms";
                }
                else if (propertyName.Equals("ScanMode", StringComparison.OrdinalIgnoreCase)
                    || propertyName.Equals("Scan Mode", StringComparison.OrdinalIgnoreCase)
                    || propertyName.Equals("OnChangeMode", StringComparison.OrdinalIgnoreCase)
                    || propertyName.Equals("On Change Mode", StringComparison.OrdinalIgnoreCase)
                    || propertyName.Equals("DataChangeTrigger", StringComparison.OrdinalIgnoreCase))
                {
                    node.OnChangeMode = value;
                }
                else if (propertyName.Equals("Scaling", StringComparison.OrdinalIgnoreCase)
                    || propertyName.Equals("Scale", StringComparison.OrdinalIgnoreCase))
                {
                    node.Scaling = value;
                }
                else if (propertyName.Equals("Description", StringComparison.OrdinalIgnoreCase)
                    && string.IsNullOrWhiteSpace(node.Description))
                {
                    node.Description = value;
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex,
                    "Could not read OPC UA property {PropertyName} on {NodeId}",
                    propertyName, variableNodeId);
            }
        }
    }

    private OpcUaSession GetSession()
    {
        if (_session == null || !_session.Connected)
            throw new InvalidOperationException(
                "OPC UA server is not connected.");

        return _session;
    }

    public async Task<List<OpcUaNodeDto>> BrowseAsync(string nodeId)
    {
        await _lock.WaitAsync();

        try
        {
            var session = GetSession();

            NodeId id = NodeId.Parse(nodeId);

            session.Browse(
                null,
                null,
                id,
                0,
                BrowseDirection.Forward,
                ReferenceTypeIds.HierarchicalReferences,
                true,
                (uint)(NodeClass.Object | NodeClass.Variable),
                out _,
                out ReferenceDescriptionCollection references);

            var result = new List<OpcUaNodeDto>();

            foreach (var item in references)
            {
                var childNodeId = ExpandedNodeId.ToNodeId(
                    item.NodeId,
                    session.NamespaceUris);

                result.Add(new OpcUaNodeDto
                {
                    NodeId = childNodeId?.ToString() ?? item.NodeId.ToString(),
                    DisplayName = item.DisplayName.Text,
                    NodeClass = item.NodeClass.ToString()
                });
            }

            return result;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<object?> ReadAsync(string nodeId)
    {
        await _lock.WaitAsync();

        try
        {
            var session = GetSession();

            DataValue value = session.ReadValue(
                NodeId.Parse(nodeId));

            if (StatusCode.IsBad(value.StatusCode))
                throw new Exception(
                    $"OPC UA read failed: {value.StatusCode}");

            return new
            {
                NodeId = nodeId,
                Value = value.Value,
                DataType = value.Value?.GetType().Name,
                StatusCode = value.StatusCode.ToString(),
                SourceTimestamp = value.SourceTimestamp,
                ServerTimestamp = value.ServerTimestamp
            };
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<List<object>> ReadBatchAsync(IEnumerable<string> nodeIds)
    {
        await _lock.WaitAsync();

        try
        {
            var session = GetSession();
            var results = new List<object>();

            var validIds = nodeIds
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (validIds.Count == 0)
                return results;

            var readValueIds = new ReadValueIdCollection();
            foreach (var id in validIds)
            {
                readValueIds.Add(new ReadValueId
                {
                    NodeId = NodeId.Parse(id),
                    AttributeId = Attributes.Value
                });
            }

            session.Read(
                null,
                0,
                TimestampsToReturn.Both,
                readValueIds,
                out DataValueCollection values,
                out DiagnosticInfoCollection diagnostics);

            for (int i = 0; i < validIds.Count; i++)
            {
                string id = validIds[i];
                var val = i < values.Count ? values[i] : null;

                results.Add(new
                {
                    NodeId = id,
                    Value = val?.Value,
                    DataType = val?.Value?.GetType().Name,
                    StatusCode = val != null ? val.StatusCode.ToString() : "Bad",
                    SourceTimestamp = val?.SourceTimestamp,
                    ServerTimestamp = val?.ServerTimestamp
                });
            }

            return results;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<List<MonitoredNodeChangeDto>> MonitorChangesAsync(
        IEnumerable<string> nodeIds,
        IDictionary<string, string?>? previousValues)
    {
        await _lock.WaitAsync();

        try
        {
            var session = GetSession();
            var results = new List<MonitoredNodeChangeDto>();

            var validIds = nodeIds
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (validIds.Count == 0)
                return results;

            var readValueIds = new ReadValueIdCollection();
            foreach (var id in validIds)
            {
                readValueIds.Add(new ReadValueId
                {
                    NodeId = NodeId.Parse(id),
                    AttributeId = Attributes.Value
                });
            }

            session.Read(
                null,
                0,
                TimestampsToReturn.Both,
                readValueIds,
                out DataValueCollection values,
                out DiagnosticInfoCollection diagnostics);

            for (int i = 0; i < validIds.Count; i++)
            {
                string id = validIds[i];
                var val = i < values.Count ? values[i] : null;

                string currentStr = val?.Value != null
                    ? (val.Value is string s ? s : System.Text.Json.JsonSerializer.Serialize(val.Value))
                    : "null";

                string? prevStr = null;
                bool hasPrev = previousValues != null && previousValues.TryGetValue(id, out prevStr);

                bool hasChanged = !hasPrev || !string.Equals(currentStr, prevStr, StringComparison.Ordinal);

                results.Add(new MonitoredNodeChangeDto
                {
                    NodeId = id,
                    Value = val?.Value,
                    PreviousValue = prevStr,
                    HasChanged = hasChanged,
                    DataType = val?.Value?.GetType().Name,
                    StatusCode = val != null ? val.StatusCode.ToString() : "Bad",
                    SourceTimestamp = val?.SourceTimestamp,
                    ServerTimestamp = val?.ServerTimestamp
                });
            }

            return results;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task WriteAsync(ApiWriteRequest request)
    {
        await _lock.WaitAsync();

        try
        {
            var session = GetSession();

            object? value = ConvertValue(
                request.Value,
                request.DataType);

            var writeValue = new WriteValue
            {
                NodeId = NodeId.Parse(request.NodeId),
                AttributeId = Attributes.Value,
                Value = new DataValue(new Variant(value))
            };

            var values = new WriteValueCollection
            {
                writeValue
            };

            session.Write(
                null,
                values,
                out StatusCodeCollection results,
                out DiagnosticInfoCollection diagnostics);

            if (results.Count == 0 ||
                StatusCode.IsBad(results[0]))
            {
                throw new Exception(
                    $"OPC UA write failed: " +
                    $"{(results.Count > 0 ? results[0] : "No result")}");
            }
        }
        finally
        {
            _lock.Release();
        }
    }

    private static object? ConvertValue(
        object? value,
        string dataType)
    {
        if (value is System.Text.Json.JsonElement json)
        {
            value = json.ValueKind switch
            {
                System.Text.Json.JsonValueKind.String =>
                    json.GetString(),

                System.Text.Json.JsonValueKind.True => true,
                System.Text.Json.JsonValueKind.False => false,
                System.Text.Json.JsonValueKind.Number =>
                    json.GetDouble(),

                System.Text.Json.JsonValueKind.Null => null,
                _ => json.ToString()
            };
        }

        return dataType.ToLowerInvariant() switch
        {
            "string" => Convert.ToString(value),
            "boolean" or "bool" => Convert.ToBoolean(value),
            "int16" => Convert.ToInt16(value),
            "int32" or "int" => Convert.ToInt32(value),
            "int64" or "long" => Convert.ToInt64(value),
            "uint16" => Convert.ToUInt16(value),
            "uint32" => Convert.ToUInt32(value),
            "uint64" => Convert.ToUInt64(value),
            "float" or "single" => Convert.ToSingle(value),
            "double" => Convert.ToDouble(value),
            _ => throw new ArgumentException(
                $"Unsupported data type: {dataType}")
        };
    }

    public async Task DisconnectAsync()
    {
        await _lock.WaitAsync();

        try
        {
            _session?.Close();
            _session?.Dispose();
            _session = null;
        }
        finally
        {
            _lock.Release();
        }
    }

    public void Dispose()
    {
        _session?.Dispose();
        _lock.Dispose();
    }
}