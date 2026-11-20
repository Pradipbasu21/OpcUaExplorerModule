const $ = (id) => document.getElementById(id);

let isConnected = false;
let selectedNode = null;
let selectedElement = null;
let loadedRoot = null;
let selectedParent = null;
let selectedRow = null;

// Multi-selected tags map: nodeId -> tagInfo
const selectedTagsMap = new Map();
// Map to hold per‑tag timer IDs when using individual scan rates
const tagTimers = new Map();
function clearAllTagTimers() {
  for (const id of tagTimers.values()) {
    clearTimeout(id);
  }
  tagTimers.clear();
}

// MQTT connection and publishing state
let mqttIsConnected = false;
let mqttPublishInProgress = false;
const DEFAULT_MQTT_TOPIC = "mpac/subtleweigh/formatter-kepserver/line1";


// Items currently displayed in the Child nodes table
let currentChildTableItems = [];

// Live Monitor State: Scan Time vs OnChange
let activeReadMode = "scanTime"; // "scanTime" | "onChange"
let isMonitoring = false;
let monitorTimeoutId = null;
let readIterationCount = 0;
let changeDetectionCount = 0;
const lastKnownValues = new Map(); // nodeId -> string value

// Custom scan rates cache: nodeId -> { scanRate: number, scanTime: string }
const customScanRates = new Map();

// Modal state for editing scan rate
let editingTagsList = [];

const STORAGE_KEY = "opcua_explorer_saved_config";

function apiBase() {
  return $("apiUrl").value.trim().replace(/\/+$/, "");
}

function setMessage(message, type = "") {
  $("message").textContent = message;
  $("message").className = `message ${type}`;
}

function setConnected(value) {
  isConnected = value;
  $("connectionStatus").textContent = value ? "Connected" : "Disconnected";
  $("connectionStatus").className = `status ${value ? "connected" : "disconnected"}`;
  $("connectBtn").disabled = value;
  $("disconnectBtn").disabled = !value;
  $("browseBtn").disabled = !value;
  $("refreshBtn").disabled = !value;
  $("treeSearch").disabled = !value;
  $("expandBtn").disabled = !value;
  $("collapseBtn").disabled = !value;
  if (!value) {
    stopMonitoring();
  }
  updateSelectionUI();
}


function setMqttConnected(value) {
  mqttIsConnected = value;
  const status = $("mqttConnectionStatus");
  status.textContent = value ? "MQTT Connected" : "MQTT Disconnected";
  status.className = `status ${value ? "connected" : "disconnected"}`;
  $("mqttConnectBtn").disabled = value;
  $("mqttDisconnectBtn").disabled = !value;
  $("mqttPublishNowBtn").disabled = !value || selectedTagsMap.size === 0;
}

function setMqttMessage(message, type = "") {
  $("mqttMessage").textContent = message;
  $("mqttMessage").className = `message ${type}`;
}

function getMqttConnectRequest() {
  const requestBody = {
    host: $("mqttHost").value.trim(),
    port: Number($("mqttPort").value || 1883),
    username: $("mqttUsername").value.trim() || null,
    password: $("mqttPassword").value || null,
    useTls: $("mqttUseTls").checked,
    autoReconnect: $("mqttAutoReconnect").checked,
    keepAliveSeconds: 30
  };

  // Intentionally omit clientId: the API's MqttConnectRequest default
  // generates a stable ID from Environment.MachineName on the Ubuntu host.
  return requestBody;
}

async function connectMqtt() {
  const host = $("mqttHost").value.trim();
  const port = Number($("mqttPort").value);
  if (!host) return setMqttMessage("Enter an MQTT broker host.", "error");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return setMqttMessage("Enter a valid MQTT port (1-65535).", "error");
  }

  try {
    $("mqttConnectBtn").disabled = true;
    setMqttMessage("Connecting to MQTT broker...");
    const result = await request("/api/Mqtt/connect", {
      method: "POST",
      body: JSON.stringify(getMqttConnectRequest())
    });
    if (result.success === false || result.Success === false) {
      throw new Error(result.message || result.Message || "MQTT connection failed.");
    }
    setMqttConnected(result.connected ?? result.Connected ?? true);
    const actualClientId = result.clientId || result.ClientId;
    setMqttMessage(
      `Connected to ${host}:${port}${actualClientId ? ` (Client ID: ${actualClientId})` : ""}.`,
      "success"
    );
  } catch (error) {
    setMqttConnected(false);
    $("mqttConnectBtn").disabled = false;
    setMqttMessage(`MQTT connection failed: ${error.message}`, "error");
  }
}

async function disconnectMqtt() {
  try {
    await request("/api/Mqtt/disconnect", { method: "POST" });
    setMqttConnected(false);
    setMqttMessage("Disconnected from MQTT broker.", "success");
  } catch (error) {
    setMqttMessage(`MQTT disconnect failed: ${error.message}`, "error");
  }
}

function toUnixMilliseconds(value) {
  if (value === null || value === undefined || value === "") return Date.now();
  if (typeof value === "number") {
    // If the server already returns Unix milliseconds, preserve them.
    return value < 100000000000 ? Math.round(value * 1000) : Math.round(value);
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function makeMqttTagPayload(tag) {
  const status = String(tag.statusCode ?? "Good");
  return {
    id: tag.name || tag.displayName || tag.nodeId,
    v: tag.value === undefined ? null : tag.value,
    q: status.toLowerCase().startsWith("good"),
    t: toUnixMilliseconds(tag.sourceTimestamp),
    // Include the current scan rate (ms) if available for downstream consumers
    scanRate: tag.scanRate ?? null,
    scanTime: tag.scanTime ?? null
  };
}

async function publishMqttPayloads(tags, options = {}) {
  if (!mqttIsConnected) {
    if (!options.silent) setMqttMessage("Connect to MQTT before publishing.", "error");
    return false;
  }
  if (!tags || tags.length === 0) return false;

  const topic = $("mqttTopic").value.trim() || DEFAULT_MQTT_TOPIC;
  let published = 0;
  try {
    // Publish one message per tag, preserving the requested JSON object shape.
    for (const tag of tags) {
      const payload = makeMqttTagPayload(tag);
      await request("/api/Mqtt/publish", {
        method: "POST",
        body: JSON.stringify({
          topic,
          payload: JSON.stringify(payload),
          qos: 0,
          retain: false
        })
      });
      published++;
    }
    if (!options.silent) {
      setMqttMessage(`Published ${published} tag message(s) to ${topic}.`, "success");
    }
    return true;
  } catch (error) {
    if (!options.silent) setMqttMessage(`MQTT publish failed after ${published} message(s): ${error.message}`, "error");
    else console.error("Automatic MQTT publish failed:", error);
    return false;
  }
}

async function publishSelectedTagsNow() {
  const tags = Array.from(selectedTagsMap.values());
  if (!tags.length) return setMqttMessage("Select at least one OPC UA tag first.", "error");
  if (tags.some(tag => tag.value === "Not read" || tag.value === undefined)) {
    setMqttMessage("Read the selected OPC UA tags first, then publish.", "error");
    return;
  }
  await publishMqttPayloads(tags);
}

async function autoPublishTags(tags) {
  if (!mqttIsConnected || !$("mqttAutoPublishCb").checked || mqttPublishInProgress || !tags.length) return;
  mqttPublishInProgress = true;
  try {
    await publishMqttPayloads(tags, { silent: true });
  } finally {
    mqttPublishInProgress = false;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.title || `HTTP ${response.status}`);
  return payload;
}

function getProp(obj, ...names) {
  for (const name of names) {
    if (obj && obj[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return null;
}

// Check if a child node under Channel1 (or any Channel) is an unnecessary system/diagnostic node
function isUnnecessaryChild(parentName, childName) {
  if (!$("hideChannelChildrenCb")?.checked) return false;
  if (!parentName || !childName) return false;
  if (parentName.toLowerCase().includes("channel")) {
    if (childName.startsWith("_") ||
        childName.toLowerCase() === "_system" ||
        childName.toLowerCase() === "_statistics" ||
        childName.toLowerCase() === "_hints" ||
        childName.toLowerCase() === "_datalogger" ||
        childName.toLowerCase() === "_iomonitor" ||
        childName.toLowerCase() === "_advancedtags") {
      return true;
    }
  }
  return false;
}

async function connectServer() {
  const endpointUrl = $("endpointUrl").value.trim();
  if (!endpointUrl) return setMessage("Enter an OPC UA endpoint URL.", "error");
  try {
    setMessage("Connecting to OPC UA server...");
    const result = await request("/api/OpcUa/connect", {
      method: "POST",
      body: JSON.stringify({ endpointUrl, username: $("username").value, password: $("password").value })
    });
    if (result.success === false || result.Success === false) throw new Error(result.message || result.Message || "Connection failed");
    setConnected(true);
    setMessage(result.message || result.Message || "Connected. Loading address space...", "success");
    await loadHierarchy();
  } catch (error) {
    setConnected(false);
    setMessage(`Connection failed: ${error.message}`, "error");
  }
}

async function disconnectServer() {
  try {
    stopMonitoring();
    await request("/api/OpcUa/disconnect", { method: "POST" });
    setConnected(false);
    selectedTagsMap.clear();
    lastKnownValues.clear();
    $("tree").replaceChildren();
    $("tree").classList.add("empty");
    $("tree").textContent = "Disconnected.";
    $("nodeCount").textContent = "0 nodes";
    $("childrenTableBody").innerHTML = '<tr><td colspan="9" class="table-empty">Connect to a server to browse child nodes.</td></tr>';
    $("childrenTitle").textContent = "Child nodes";
    $("parentPath").textContent = "Select or check a tree node in the address space to browse all its tags.";
    $("childrenCount").textContent = "0 items";
    clearSelection();
    updateSelectionUI();
    setMessage("Disconnected from OPC UA server.", "success");
  } catch (error) {
    setMessage(`Disconnect failed: ${error.message}`, "error");
  }
}

async function loadHierarchy() {
  if (!isConnected) return setMessage("Connect to an OPC UA server first.", "error");
  try {
    stopMonitoring();
    setMessage("Loading node hierarchy...");
    const hideSystem = $("hideChannelChildrenCb")?.checked !== false;
    const params = new URLSearchParams({
      nodeId: "i=84", maxDepth: "10", maxNodes: "5000", includeValues: "false",
      hideSystemNodes: hideSystem ? "true" : "false",
      showValue: "false", showDataType: "true", showStatusCode: "false", showSourceTimestamp: "false"
    });
    const result = await request(`/api/OpcUa/browse/hierarchy?${params}`);
    if (result.success === false || result.Success === false) throw new Error(result.message || result.Message || "Browse failed");
    loadedRoot = result.data || result.Data;
    if (!loadedRoot) throw new Error("The API response did not contain a hierarchy.");
    
    selectedTagsMap.clear();
    lastKnownValues.clear();
    renderTree();
    const count = result.totalNodes ?? result.TotalNodes ?? countNodes(loadedRoot);
    $("nodeCount").textContent = `${count} nodes`;
    
    // Check if we have saved config to re-apply
    const saved = getSavedConfiguration();
    if (saved && saved.tags && saved.tags.length > 0) {
      applyLoadedConfiguration(saved, false);
      setMessage(`Browse completed (${count} nodes). Restored ${saved.tags.length} saved tags.`, "success");
    } else {
      selectParent(loadedRoot, null);
      updateSelectionUI();
      setMessage(`Browse completed. ${count} nodes loaded.`, "success");
    }
  } catch (error) {
    setMessage(`Browse failed: ${error.message}`, "error");
  }
}

function countNodes(node) {
  const children = getProp(node, "children", "Children") || [];
  return 1 + children.reduce((sum, child) => sum + countNodes(child), 0);
}

// Recursively find all Variable (tag) descendants in a node subtree
function getAllVariableDescendants(node) {
  if (!node) return [];
  const parentName = getProp(node, "displayName", "DisplayName") || "";
  const children = getProp(node, "children", "Children") || [];
  const nodeClass = getProp(node, "nodeClass", "NodeClass");
  let list = [];
  if (nodeClass === "Variable" && children.length === 0) {
    list.push(node);
  }
  for (const child of children) {
    const childName = getProp(child, "displayName", "DisplayName") || "";
    if (isUnnecessaryChild(parentName, childName)) continue;
    list = list.concat(getAllVariableDescendants(child));
  }
  return list;
}

// Builds tag info object, respecting any edited custom scan rate
function createTagInfo(node) {
  const nodeId = getProp(node, "nodeId", "NodeId") || "";
  const displayName = getProp(node, "displayName", "DisplayName") || "(unnamed)";
  const address = getProp(node, "address", "Address", "tagAddress", "TagAddress") || nodeId;
  const dataType = getProp(node, "dataType", "DataType", "builtInDataType", "BuiltInDataType", "dataTypeName", "DataTypeName") || "—";
  
  let scanRate = getProp(node, "scanRate", "ScanRate", "samplingInterval", "SamplingInterval", "minimumSamplingInterval", "MinimumSamplingInterval");
  let scanTime = getProp(node, "scanTime", "ScanTime");

  // Check if user edited scan rate
  if (customScanRates.has(nodeId)) {
    const custom = customScanRates.get(nodeId);
    scanRate = custom.scanRate;
    scanTime = custom.scanTime;
  } else if (!scanTime) {
    scanTime = scanRate != null && Number(scanRate) >= 0 ? `${scanRate} ms` : "1000 ms";
  }

  let onChangeMode = getProp(node, "onChangeMode", "OnChangeMode", "scanMode", "ScanMode");
  if (!onChangeMode) {
    onChangeMode = "On Change";
  }

  const scaling = getProp(node, "scaling", "Scaling", "engineeringUnits", "EngineeringUnits") || "—";
  const description = getProp(node, "description", "Description") || "—";

  return {
    nodeId,
    name: getQualifiedTagName(node),
    displayName,
    address,
    dataType,
    scanRate: scanRate != null ? Number(scanRate) : 1000,
    scanTime,
    onChangeMode,
    scaling,
    description,
    value: getProp(node, "value", "Value") ?? "Not read",
    statusCode: getProp(node, "statusCode", "StatusCode") ?? "—",
    sourceTimestamp: getProp(node, "sourceTimestamp", "SourceTimestamp") ?? null,
    lastChanged: null,
    changeState: "Steady",
    node
  };
}

// Multi-selection handler for parent nodes
function toggleParentSelection(node, isChecked) {
  const vars = getAllVariableDescendants(node);
  for (const v of vars) {
    const id = getProp(v, "nodeId", "NodeId");
    if (!id) continue;
    if (isChecked) {
      if (!selectedTagsMap.has(id)) {
        selectedTagsMap.set(id, createTagInfo(v));
      }
    } else {
      selectedTagsMap.delete(id);
      lastKnownValues.delete(id);
    }
  }
  updateSelectionUI();
}

// Multi-selection handler for individual tag
function toggleSingleTag(node, isChecked) {
  const id = getProp(node, "nodeId", "NodeId");
  if (!id) return;
  if (isChecked) {
    if (!selectedTagsMap.has(id)) {
      selectedTagsMap.set(id, createTagInfo(node));
    }
  } else {
    selectedTagsMap.delete(id);
    lastKnownValues.delete(id);
  }
  updateSelectionUI();
}

function clearAllSelections() {
  stopMonitoring();
  selectedTagsMap.clear();
  lastKnownValues.clear();
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = selectedTagsMap.size;
  $("selectedTagsBadge").textContent = `${count} tag${count === 1 ? "" : "s"} selected`;
  $("clearSelectedBtn").disabled = count === 0;
  $("exportCsvBtn").disabled = count === 0;
  $("readOnceBtn").disabled = !isConnected || count === 0;
  if ($("mqttPublishNowBtn")) $("mqttPublishNowBtn").disabled = !mqttIsConnected || count === 0;

  if (!isMonitoring) {
    $("startMonitorBtn").disabled = !isConnected || count === 0;
  }

  // Update tree selection bar
  const treeBar = $("treeSelectionBar");
  if (count > 0) {
    treeBar.hidden = false;
    $("treeSelectedCount").textContent = `${count} tag${count === 1 ? "" : "s"} selected`;
  } else {
    treeBar.hidden = true;
  }

  // Sync tree checkboxes
  updateTreeCheckboxes();

  // Re-sync current children table checkboxes
  syncChildrenTableCheckboxes();

  // Re-render selected tags table
  renderSelectedTagsTable();
}

function updateTreeCheckboxes() {
  document.querySelectorAll("#tree .leaf-cb").forEach(cb => {
    cb.checked = selectedTagsMap.has(cb.dataset.nodeId);
  });

  document.querySelectorAll("#tree .parent-cb").forEach(cb => {
    const parentNode = cb.__nodeRef;
    if (!parentNode) return;
    const vars = getAllVariableDescendants(parentNode);
    if (vars.length === 0) {
      cb.checked = false;
      cb.indeterminate = false;
      return;
    }
    let selectedCount = 0;
    for (const v of vars) {
      const id = getProp(v, "nodeId", "NodeId");
      if (id && selectedTagsMap.has(id)) selectedCount++;
    }
    cb.checked = selectedCount === vars.length && vars.length > 0;
    cb.indeterminate = selectedCount > 0 && selectedCount < vars.length;
  });
}

function renderTree() {
  const tree = $("tree");
  tree.replaceChildren();
  tree.classList.remove("empty");
  tree.appendChild(renderNode(loadedRoot, true, 0));
  applyTreeFilter();
}

function renderNode(node, isRoot = false, depth = 0) {
  const wrapper = document.createElement("div");
  const children = getProp(node, "children", "Children") || [];
  const rawName = getProp(node, "displayName", "DisplayName") || "(unnamed)";
  const nodeId = getProp(node, "nodeId", "NodeId") || "";
  const nodeClass = getProp(node, "nodeClass", "NodeClass") || "Unknown";
  const standardNames = { "i=84": "Root", "i=85": "Objects", "i=86": "Types", "i=87": "Views" };
  const name = standardNames[nodeId] || rawName;
  const isVariable = nodeClass === "Variable" && children.length === 0;

  if (!isVariable) {
    const details = document.createElement("details");
    details.open = isRoot || depth === 1;
    const summary = document.createElement("summary");
    summary.title = nodeId;

    // Checkbox for parent folder: checking it selects AND browses all tags under this node!
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "tree-cb parent-cb";
    cb.dataset.nodeId = nodeId;
    cb.__nodeRef = node;
    cb.title = `Check to select and browse all tags under ${name}`;
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleParentSelection(node, cb.checked);
      if (cb.checked) {
        // Browse and display ALL tags under this checked node in 'Child nodes'
        browseAllTagsUnderNode(node, summary);
      }
    });

    const icon = document.createElement("span");
    icon.className = "folder-icon";
    icon.textContent = "▰";

    const label = document.createElement("span");
    label.className = "node-text";
    label.textContent = ` ${name}`;

    summary.append(cb, icon, label);
    summary.addEventListener("click", () => selectParent(node, summary));
    details.appendChild(summary);

    children
      .filter(child => {
        const childName = getProp(child, "displayName", "DisplayName") || "";
        return !isUnnecessaryChild(name, childName);
      })
      .forEach(child => details.appendChild(renderNode(child, false, depth + 1)));

    wrapper.appendChild(details);
  } else {
    const row = document.createElement("div");
    row.className = "tree-leaf-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "tree-cb leaf-cb";
    cb.dataset.nodeId = nodeId;
    cb.__nodeRef = node;
    cb.checked = selectedTagsMap.has(nodeId);
    cb.title = `Select tag ${name}`;
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleSingleTag(node, cb.checked);
      if (cb.checked) {
        browseAllTagsUnderNode(node, row);
      }
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "node";
    button.dataset.name = `${name} ${nodeId}`.toLowerCase();
    const icon = document.createElement("span");
    icon.className = "variable-icon";
    icon.textContent = "●";
    button.append(icon, document.createTextNode(` ${name}`));
    button.title = nodeId;
    button.addEventListener("click", () => selectNode(node, button));

    row.append(cb, button);
    wrapper.appendChild(row);
  }
  return wrapper;
}

function findPathToNode(current, targetId, path = []) {
  if (!current) return null;
  const currentId = getProp(current, "nodeId", "NodeId") || "";
  const currentName = getProp(current, "displayName", "DisplayName") || "";
  const nextPath = [...path, { nodeId: currentId, name: currentName }];
  if (currentId === targetId) return nextPath;
  const children = getProp(current, "children", "Children") || [];
  for (const child of children) {
    const found = findPathToNode(child, targetId, nextPath);
    if (found) return found;
  }
  return null;
}

function getQualifiedTagName(node) {
  const nodeId = getProp(node, "nodeId", "NodeId") || "";
  const path = findPathToNode(loadedRoot, nodeId) || [];
  const names = path.map(part => part.name)
    .filter(name => name && !["Root", "Objects", "Types", "Views"].includes(name));
  return names.length ? names.join(".") :
    (getProp(node, "displayName", "DisplayName") || "(unnamed)");
}

// When a tree node is checked: browses all tags under this node into the 'Child nodes' table
function browseAllTagsUnderNode(node, element) {
  if (selectedElement && selectedElement.classList) selectedElement.classList.remove("selected");
  selectedElement = element;
  if (selectedElement && selectedElement.classList) selectedElement.classList.add("selected");
  selectedParent = node;
  selectedNode = node;

  const name = getProp(node, "displayName", "DisplayName") || "Root";
  const nodeId = getProp(node, "nodeId", "NodeId") || "";
  const nodeClass = getProp(node, "nodeClass", "NodeClass") || "Folder";

  let tags = [];
  if (nodeClass === "Variable") {
    tags = [node];
  } else {
    tags = getAllVariableDescendants(node);
  }

  currentChildTableItems = tags;
  $("childrenTitle").textContent = `All Tags under ${name}`;
  $("parentPath").textContent = `${nodeId} (${tags.length} tag${tags.length === 1 ? "" : "s"} browsed)`;
  $("childrenCount").textContent = `${tags.length} tags`;

  renderChildrenTable(tags, true);

  $("selectedClass").textContent = nodeClass;
  $("emptyDetails").hidden = false;
  $("nodeDetails").hidden = true;
  $("readBtn").disabled = true;

  setMessage(`Browsing ${tags.length} tags under ${name}. Edit scan rates or save configuration as needed.`, "success");
}

// Selecting a folder normally displays its children
function selectParent(node, element) {
  if (selectedElement && selectedElement.classList) selectedElement.classList.remove("selected");
  selectedElement = element;
  if (selectedElement) selectedElement.classList.add("selected");
  selectedParent = node;
  selectedNode = node;

  const name = getProp(node, "displayName", "DisplayName") || "Root";
  const nodeId = getProp(node, "nodeId", "NodeId") || "";
  const children = getProp(node, "children", "Children") || [];
  
  currentChildTableItems = children;
  $("childrenTitle").textContent = `Child nodes of ${name}`;
  $("parentPath").textContent = nodeId;
  renderChildrenTable(children, false);

  $("selectedClass").textContent = getProp(node, "nodeClass", "NodeClass") || "Folder";
  $("emptyDetails").hidden = false;
  $("nodeDetails").hidden = true;
  $("readBtn").disabled = true;
}

function renderChildrenTable(items, isAllTagsMode = false) {
  const tbody = $("childrenTableBody");
  tbody.replaceChildren();

  const parentName = getProp(selectedParent, "displayName", "DisplayName") || "";
  const filteredItems = items.filter(child => {
    const childName = getProp(child, "displayName", "DisplayName") || "";
    return !isUnnecessaryChild(parentName, childName);
  });

  currentChildTableItems = filteredItems;
  $("childrenCount").textContent = `${filteredItems.length} items`;

  if (!filteredItems.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.className = "table-empty";
    td.textContent = "No child tags found under this node.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    $("selectAllChildren").checked = false;
    $("selectAllChildren").indeterminate = false;
    $("selectAllChildren").disabled = true;
    return;
  }

  $("selectAllChildren").disabled = false;

  filteredItems.forEach(child => {
    const tr = document.createElement("tr");
    const name = getProp(child, "displayName", "DisplayName") || "(unnamed)";
    const nodeId = getProp(child, "nodeId", "NodeId") || "";
    const nodeClass = getProp(child, "nodeClass", "NodeClass") || "Unknown";
    const isVariable = nodeClass === "Variable";

    // 1. Checkbox column
    const tdCb = document.createElement("td");
    tdCb.className = "cb-cell";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "row-cb";
    cb.dataset.nodeId = nodeId;

    if (isVariable) {
      cb.checked = selectedTagsMap.has(nodeId);
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        toggleSingleTag(child, cb.checked);
      });
    } else {
      const vars = getAllVariableDescendants(child);
      let selectedCount = 0;
      for (const v of vars) {
        const id = getProp(v, "nodeId", "NodeId");
        if (id && selectedTagsMap.has(id)) selectedCount++;
      }
      cb.checked = selectedCount === vars.length && vars.length > 0;
      cb.indeterminate = selectedCount > 0 && selectedCount < vars.length;
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        toggleParentSelection(child, cb.checked);
      });
    }
    tdCb.appendChild(cb);
    tr.appendChild(tdCb);

    // 2. Tag name column
    const tagCell = document.createElement("td");
    const tagWrap = document.createElement("div");
    tagWrap.className = "tag-cell";
    const tagIcon = document.createElement("span");
    tagIcon.className = isVariable ? "tag-icon" : "folder-icon";
    tagIcon.textContent = isVariable ? "◈" : "▰";
    const tagName = document.createElement("span");
    tagName.textContent = isVariable ? getQualifiedTagName(child) : name;
    tagName.title = tagName.textContent;
    tagWrap.append(tagIcon, tagName);
    tagCell.appendChild(tagWrap);
    tr.appendChild(tagCell);

    // 3. Metadata columns
    const address = getProp(child, "address", "Address", "tagAddress", "TagAddress") || nodeId;
    const dataType = getProp(child, "dataType", "DataType", "builtInDataType", "BuiltInDataType", "dataTypeName", "DataTypeName");
    
    // Scan rate and scan time (checking custom override)
    let scanRate = getProp(child, "scanRate", "ScanRate", "samplingInterval", "SamplingInterval", "minimumSamplingInterval", "MinimumSamplingInterval");
    let scanTime = getProp(child, "scanTime", "ScanTime");
    if (customScanRates.has(nodeId)) {
      const custom = customScanRates.get(nodeId);
      scanRate = custom.scanRate;
      scanTime = custom.scanTime;
    } else if (!scanTime) {
      scanTime = scanRate != null && Number(scanRate) >= 0 ? `${scanRate} ms` : "1000 ms";
    }

    let onChangeMode = getProp(child, "onChangeMode", "OnChangeMode", "scanMode", "ScanMode") || "On Change";
    const scaling = getProp(child, "scaling", "Scaling", "engineeringUnits", "EngineeringUnits") || "—";
    const description = getProp(child, "description", "Description") || "—";

    // Address
    const tdAddr = document.createElement("td");
    tdAddr.className = "address-cell";
    tdAddr.textContent = address || "—";
    tr.appendChild(tdAddr);

    // Data Type
    const tdType = document.createElement("td");
    tdType.textContent = dataType ?? "—";
    tr.appendChild(tdType);

    // Scan Rate / Time (Editable with ✏️)
    const tdScan = document.createElement("td");
    if (isVariable) {
      const scanWrap = document.createElement("div");
      scanWrap.className = "scan-rate-cell";

      const scanBadge = document.createElement("span");
      scanBadge.className = "badge scan-badge";
      scanBadge.textContent = scanTime;
      scanBadge.title = "Click to edit scan rate";
      scanBadge.style.cursor = "pointer";
      scanBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditScanRateModal([child]);
      });

      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "btn-edit-rate";
      btnEdit.textContent = "✏️";
      btnEdit.title = "Change scan rate";
      btnEdit.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditScanRateModal([child]);
      });

      scanWrap.append(scanBadge, btnEdit);
      tdScan.appendChild(scanWrap);
    } else {
      tdScan.textContent = "—";
    }
    tr.appendChild(tdScan);

    // On-Change Mode
    const tdMode = document.createElement("td");
    if (isVariable) {
      const modeBadge = document.createElement("span");
      modeBadge.className = "badge mode-badge";
      modeBadge.textContent = onChangeMode;
      tdMode.appendChild(modeBadge);
    } else {
      tdMode.textContent = "—";
    }
    tr.appendChild(tdMode);

    // Scaling
    const tdScale = document.createElement("td");
    tdScale.textContent = scaling;
    tr.appendChild(tdScale);

    // Description
    const tdDesc = document.createElement("td");
    tdDesc.textContent = description;
    tr.appendChild(tdDesc);

    // Action column (Edit Scan Rate)
    const tdAction = document.createElement("td");
    if (isVariable) {
      const btnAction = document.createElement("button");
      btnAction.type = "button";
      btnAction.className = "text-button";
      btnAction.textContent = "✏️ Edit Rate";
      btnAction.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditScanRateModal([child]);
      });
      tdAction.appendChild(btnAction);
    } else {
      tdAction.textContent = "—";
    }
    tr.appendChild(tdAction);

    tr.title = `${nodeClass}: ${nodeId}`;
    tr.addEventListener("click", () => {
      if (selectedRow) selectedRow.classList.remove("selected-row");
      selectedRow = tr;
      tr.classList.add("selected-row");
      if (!isVariable) {
        const treeSummary = findTreeSummary(nodeId);
        selectParent(child, treeSummary || tr);
      } else {
        selectNode(child, tr);
      }
    });
    tbody.appendChild(tr);
  });

  syncChildrenTableCheckboxes();
}

function syncChildrenTableCheckboxes() {
  const checkboxes = document.querySelectorAll("#childrenTableBody .row-cb");
  if (!checkboxes.length) return;
  let allChecked = true;
  let anyChecked = false;

  checkboxes.forEach(cb => {
    const id = cb.dataset.nodeId;
    const isChecked = selectedTagsMap.has(id);
    cb.checked = isChecked;
    if (isChecked) anyChecked = true;
    else allChecked = false;
  });

  const masterCb = $("selectAllChildren");
  masterCb.checked = allChecked && checkboxes.length > 0;
  masterCb.indeterminate = anyChecked && !allChecked;
}

function renderSelectedTagsTable(changedIds = new Set()) {
  const tbody = $("selectedTableBody");
  tbody.replaceChildren();

  const tags = Array.from(selectedTagsMap.values());
  if (tags.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.className = "table-empty";
    td.textContent = "No tags selected. Check any parent folder in the tree or individual rows to select tags.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    $("selectAllSelected").checked = false;
    $("selectAllSelected").disabled = true;
    return;
  }

  $("selectAllSelected").disabled = false;
  $("selectAllSelected").checked = true;

  tags.forEach(tag => {
    const tr = document.createElement("tr");
    const isChanged = changedIds.has(tag.nodeId);
    if (isChanged) {
      tr.classList.add("row-changed-pulse");
    }

    // Checkbox
    const tdCb = document.createElement("td");
    tdCb.className = "cb-cell";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "row-cb";
    cb.checked = true;
    cb.title = "Deselect tag";
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      selectedTagsMap.delete(tag.nodeId);
      lastKnownValues.delete(tag.nodeId);
      updateSelectionUI();
    });
    tdCb.appendChild(cb);
    tr.appendChild(tdCb);

    // Tag Name
    const tdName = document.createElement("td");
    tdName.textContent = tag.name;
    tdName.title = tag.nodeId;
    tr.appendChild(tdName);

    // Address
    const tdAddr = document.createElement("td");
    tdAddr.className = "address-cell";
    tdAddr.textContent = tag.address || tag.nodeId;
    tr.appendChild(tdAddr);

    // Data Type
    const tdType = document.createElement("td");
    tdType.textContent = tag.dataType;
    tr.appendChild(tdType);

    // Scan Time (with edit button)
    const tdScan = document.createElement("td");
    const scanWrap = document.createElement("div");
    scanWrap.className = "scan-rate-cell";

    const scanBadge = document.createElement("span");
    scanBadge.className = "badge scan-badge";
    scanBadge.textContent = tag.scanTime;
    scanBadge.title = "Click to edit scan rate";
    scanBadge.style.cursor = "pointer";
    scanBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditScanRateModal([tag]);
    });

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "btn-edit-rate";
    btnEdit.textContent = "✏️";
    btnEdit.title = "Change scan rate";
    btnEdit.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditScanRateModal([tag]);
    });

    scanWrap.append(scanBadge, btnEdit);
    tdScan.appendChild(scanWrap);
    tr.appendChild(tdScan);

    // On-Change Mode
    const tdMode = document.createElement("td");
    const modeBadge = document.createElement("span");
    modeBadge.className = "badge mode-badge";
    modeBadge.textContent = tag.onChangeMode;
    tdMode.appendChild(modeBadge);
    tr.appendChild(tdMode);

    // Current Value
    const tdVal = document.createElement("td");
    tdVal.textContent = formatValue(tag.value);
    tdVal.style.fontWeight = tag.value !== "Not read" ? "700" : "normal";
    tr.appendChild(tdVal);

    // Change Status
    const tdChangeState = document.createElement("td");
    if (isChanged || tag.changeState === "Changed") {
      const b = document.createElement("span");
      b.className = "badge change-badge";
      b.textContent = "⚡ Changed";
      tdChangeState.appendChild(b);
    } else {
      const b = document.createElement("span");
      b.className = "badge steady-badge";
      b.textContent = "Steady";
      tdChangeState.appendChild(b);
    }
    tr.appendChild(tdChangeState);

    // Status
    const tdStatus = document.createElement("td");
    tdStatus.textContent = tag.statusCode;
    tr.appendChild(tdStatus);

    // Timestamp
    const tdTime = document.createElement("td");
    tdTime.textContent = formatDate(tag.sourceTimestamp);
    tr.appendChild(tdTime);

    // Action (Remove)
    const tdAction = document.createElement("td");
    const btnRemove = document.createElement("button");
    btnRemove.className = "btn-remove";
    btnRemove.textContent = "✕";
    btnRemove.title = "Remove from selection";
    btnRemove.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedTagsMap.delete(tag.nodeId);
      lastKnownValues.delete(tag.nodeId);
      updateSelectionUI();
    });
    tdAction.appendChild(btnRemove);
    tr.appendChild(tdAction);

    tr.addEventListener("click", () => {
      if (tag.node) selectNode(tag.node, tr);
    });

    tbody.appendChild(tr);
  });
}

// ==============================================================================
// Feature: Edit Scan Rate (Modal Dialog & Bulk Edit)
// ==============================================================================

function openEditScanRateModal(tagsToEdit) {
  if (!tagsToEdit || tagsToEdit.length === 0) return;
  editingTagsList = tagsToEdit;

  const modal = $("editScanRateModal");
  const firstTag = tagsToEdit[0];
  const initialRate = firstTag.scanRate || 1000;

  if (tagsToEdit.length === 1) {
    const tagName = firstTag.name || getProp(firstTag, "displayName", "DisplayName") || "Tag";
    $("modalTitle").textContent = `Edit Scan Rate: ${tagName}`;
    $("modalTagDesc").textContent = `Configure sampling interval / scan rate for "${tagName}".`;
  } else {
    $("modalTitle").textContent = `Bulk Edit Scan Rate (${tagsToEdit.length} tags)`;
    $("modalTagDesc").textContent = `Update scan rate simultaneously for all ${tagsToEdit.length} selected tags.`;
  }

  $("modalScanRateInput").value = initialRate;

  if (typeof modal.showModal === "function") {
    modal.showModal();
  } else {
    modal.setAttribute("open", "");
  }
}

function closeEditScanRateModal() {
  const modal = $("editScanRateModal");
  if (typeof modal.close === "function") {
    modal.close();
  } else {
    modal.removeAttribute("open");
  }
  editingTagsList = [];
}

function saveEditedScanRate() {
  const rateVal = parseInt($("modalScanRateInput").value, 10);
  if (isNaN(rateVal) || rateVal < 10) {
    alert("Please enter a valid scan rate (minimum 10 ms).");
    return;
  }

  const newScanTime = `${rateVal} ms`;

  editingTagsList.forEach(t => {
    const id = t.nodeId || getProp(t, "nodeId", "NodeId");
    if (!id) return;

    // Cache custom rate
    customScanRates.set(id, { scanRate: rateVal, scanTime: newScanTime });

    // Update tag object
    t.scanRate = rateVal;
    t.scanTime = newScanTime;

    // Update in selectedTagsMap if present
    if (selectedTagsMap.has(id)) {
      const selTag = selectedTagsMap.get(id);
      selTag.scanRate = rateVal;
      selTag.scanTime = newScanTime;
    }
  });

  // Re-render tables to show new scan rate
  renderChildrenTable(currentChildTableItems);
  renderSelectedTagsTable();

  // If node details is open for this tag, update it too
  if (selectedNode) {
    const currId = getProp(selectedNode, "nodeId", "NodeId");
    if (customScanRates.has(currId)) {
      $("detailScanTime").textContent = newScanTime;
    }
  }

  // Auto-persist changes to saved configuration if exists
  const existingConfig = getSavedConfiguration();
  if (existingConfig && existingConfig.tags) {
    saveConfiguration(false); // quiet update
  }

  closeEditScanRateModal();
  setMessage(`Updated scan rate to ${newScanTime} for ${editingTagsList.length} tag(s).`, "success");
}

// Bulk edit button for selected tags in Child nodes table
$("bulkEditScanRateBtn").addEventListener("click", () => {
  // Find which tags are currently checked in the children table
  const checkedBoxes = Array.from(document.querySelectorAll("#childrenTableBody .row-cb:checked"));
  const checkedIds = new Set(checkedBoxes.map(cb => cb.dataset.nodeId));
  
  let tagsToEdit = [];
  if (checkedIds.size > 0) {
    tagsToEdit = currentChildTableItems.filter(item => {
      const id = getProp(item, "nodeId", "NodeId");
      return isVariableNode(item) && checkedIds.has(id);
    });
  } else {
    // If none checked, prompt to edit all variable tags in the current table
    tagsToEdit = currentChildTableItems.filter(isVariableNode);
  }

  if (tagsToEdit.length === 0) {
    return setMessage("No tags found to edit. Check tags in the table first.", "error");
  }

  openEditScanRateModal(tagsToEdit);
});

function isVariableNode(item) {
  const nodeClass = getProp(item, "nodeClass", "NodeClass");
  return nodeClass === "Variable" || !nodeClass;
}

// Setup preset buttons in modal
document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $("modalScanRateInput").value = btn.dataset.rate;
  });
});

$("modalCloseBtn").addEventListener("click", closeEditScanRateModal);
$("modalCancelBtn").addEventListener("click", closeEditScanRateModal);
$("modalSaveBtn").addEventListener("click", saveEditedScanRate);

// ==============================================================================
// Feature: Save Configuration File & Auto-Load on Reopen
// ==============================================================================

function getSavedConfiguration() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error("Failed to parse saved config from localStorage:", err);
    return null;
  }
}

function saveConfiguration(showBanner = true) {
  // Gather tags to save: combination of current browsed tags and multi-selected tags
  const tagsMap = new Map();

  // Add tags from currentChildTableItems
  currentChildTableItems.filter(isVariableNode).forEach(item => {
    const info = createTagInfo(item);
    tagsMap.set(info.nodeId, info);
  });

  // Add all multi-selected tags
  selectedTagsMap.forEach((info, id) => {
    tagsMap.set(id, info);
  });

  if (tagsMap.size === 0) {
    return setMessage("No tags available to save in configuration. Browse and check tags first.", "error");
  }

  const tagsArray = Array.from(tagsMap.values()).map(t => ({
    nodeId: t.nodeId,
    name: t.name,
    displayName: t.displayName,
    address: t.address,
    dataType: t.dataType,
    scanRate: t.scanRate,
    scanTime: t.scanTime,
    onChangeMode: t.onChangeMode,
    scaling: t.scaling,
    description: t.description
  }));

  const config = {
    version: "1.0",
    savedAt: new Date().toISOString(),
    serverUrl: $("endpointUrl").value.trim(),
    parentName: selectedParent ? (getProp(selectedParent, "displayName", "DisplayName") || "") : "",
    parentNodeId: selectedParent ? (getProp(selectedParent, "nodeId", "NodeId") || "") : "",
    tags: tagsArray
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));

    if (showBanner) {
      const banner = $("configSavedBanner");
      banner.style.display = "flex";
      $("configBannerMsg").textContent = `Configuration saved (${tagsArray.length} tags with custom scan rates).`;
      $("configBannerTimestamp").textContent = `Saved at ${new Date().toLocaleTimeString()}`;
      setMessage(`Configuration saved! When browser reopens, all ${tagsArray.length} tags and scan rates will be restored automatically.`, "success");
    }
  } catch (err) {
    setMessage(`Failed to save configuration: ${err.message}`, "error");
  }
}

function downloadConfigFile() {
  const config = getSavedConfiguration();
  if (!config) {
    saveConfiguration(false);
  }
  const currentConfig = getSavedConfiguration();
  if (!currentConfig) return setMessage("No configuration available to download.", "error");

  const blob = new Blob([JSON.stringify(currentConfig, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `opcua_tags_config_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setMessage("Downloaded configuration JSON file.", "success");
}

function applyLoadedConfiguration(config, showSuccessMsg = true) {
  if (!config || !config.tags || config.tags.length === 0) {
    return setMessage("Configuration file contains no tags.", "error");
  }

  // Restore server endpoint if available
  if (config.serverUrl && !$("endpointUrl").value) {
    $("endpointUrl").value = config.serverUrl;
  }

  // Restore custom scan rates and populate tags
  config.tags.forEach(t => {
    if (t.scanRate) {
      customScanRates.set(t.nodeId, {
        scanRate: Number(t.scanRate),
        scanTime: t.scanTime || `${t.scanRate} ms`
      });
    }

    const tagObj = {
      NodeId: t.nodeId,
      DisplayName: t.displayName || t.name,
      NodeClass: "Variable",
      Address: t.address,
      DataType: t.dataType,
      ScanRate: Number(t.scanRate) || 1000,
      ScanTime: t.scanTime || (t.scanRate ? `${t.scanRate} ms` : "1000 ms"),
      OnChangeMode: t.onChangeMode || "On Change",
      Scaling: t.scaling || "—",
      Description: t.description || "—"
    };

    selectedTagsMap.set(t.nodeId, createTagInfo(tagObj));
  });

  // Display loaded tags in Child nodes table
  const restoredTags = Array.from(selectedTagsMap.values()).map(t => t.node || t);
  currentChildTableItems = restoredTags;

  $("childrenTitle").textContent = config.parentName ? `Saved Tags under ${config.parentName}` : "Restored Configuration Tags";
  $("parentPath").textContent = `Restored from saved configuration (${config.tags.length} tags)`;
  renderChildrenTable(restoredTags, true);

  // Show loaded banner
  const banner = $("configLoadedBanner");
  banner.style.display = "flex";
  $("restoredTagsCount").textContent = config.tags.length;
  $("restoredTimestamp").textContent = config.savedAt ? `(Saved: ${new Date(config.savedAt).toLocaleString()})` : "";

  updateSelectionUI();

  if (showSuccessMsg) {
    setMessage(`Loaded ${config.tags.length} tags with custom scan rates from configuration.`, "success");
  }
}

// Load saved configuration on browser reopen / startup
function loadSavedConfigOnStartup() {
  const saved = getSavedConfiguration();
  if (saved && saved.tags && saved.tags.length > 0) {
    applyLoadedConfiguration(saved, false);
  }
}

// Button listeners for config features
$("saveConfigBtn").addEventListener("click", () => saveConfiguration(true));
$("loadConfigBtn").addEventListener("click", () => {
  const saved = getSavedConfiguration();
  if (saved) {
    applyLoadedConfiguration(saved, true);
  } else {
    // If no localStorage, prompt user to import file
    $("importConfigFile").click();
  }
});

$("downloadConfigBtn").addEventListener("click", downloadConfigFile);
$("dismissSavedBannerBtn").addEventListener("click", () => $("configSavedBanner").style.display = "none");
$("dismissLoadedBannerBtn").addEventListener("click", () => $("configLoadedBanner").style.display = "none");

$("clearSavedConfigBtn").addEventListener("click", () => {
  if (confirm("Clear saved configuration? When you reopen the browser, saved tags will not be restored.")) {
    localStorage.removeItem(STORAGE_KEY);
    customScanRates.clear();
    $("configLoadedBanner").style.display = "none";
    setMessage("Saved configuration cleared.", "success");
  }
});

$("applyAllSavedBtn").addEventListener("click", () => {
  const saved = getSavedConfiguration();
  if (saved && saved.tags) {
    saved.tags.forEach(t => {
      if (!selectedTagsMap.has(t.nodeId)) {
        selectedTagsMap.set(t.nodeId, createTagInfo(t));
      }
    });
    updateSelectionUI();
    setMessage(`All ${saved.tags.length} saved tags selected for live reading.`, "success");
  }
});

$("importConfigFile").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const config = JSON.parse(event.target.result);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      applyLoadedConfiguration(config, true);
    } catch (err) {
      setMessage(`Invalid configuration file: ${err.message}`, "error");
    }
  };
  reader.readAsText(file);
});

// ==============================================================================
// Live Monitor (Scan Time vs OnChange)
// ==============================================================================

function updateMonitorStatus(state, mainText, statsText = "") {
  const dot = $("monitorStatusDot");
  dot.className = `status-dot ${state}`;
  $("monitorStatusText").textContent = mainText;
  if (statsText) {
    $("monitorStatsText").textContent = statsText;
  }
}

function getScanInterval() {
  if ($("useTagScanRateCb")?.checked) {
    let minRate = Infinity;
    for (const tag of selectedTagsMap.values()) {
      if (tag.scanRate && Number(tag.scanRate) >= 10) {
        minRate = Math.min(minRate, Number(tag.scanRate));
      }
    }
    if (minRate !== Infinity) return minRate;
  }
  const val = parseInt($("scanIntervalInput")?.value, 10);
  return isNaN(val) || val < 100 ? 1000 : val;
}

async function performScanTimeStep() {
  if (!isMonitoring || !isConnected || selectedTagsMap.size === 0) {
    stopMonitoring();
    return;
  }

  const nodeIds = Array.from(selectedTagsMap.keys());
  try {
    const result = await request("/api/OpcUa/read/batch", {
      method: "POST",
      body: JSON.stringify({ nodeIds })
    });

    readIterationCount++;
    const items = result.data || result.Data || [];
    const changedIds = new Set();

    for (const item of items) {
      const id = getProp(item, "nodeId", "NodeId");
      if (!id || !selectedTagsMap.has(id)) continue;
      const tag = selectedTagsMap.get(id);
      const newVal = getProp(item, "value", "Value");
      const strVal = formatValue(newVal);

      if (lastKnownValues.has(id) && lastKnownValues.get(id) !== strVal) {
        changedIds.add(id);
        tag.lastChanged = new Date();
        tag.changeState = "Changed";
      } else {
        tag.changeState = "Steady";
      }

      lastKnownValues.set(id, strVal);
      tag.value = newVal;
      tag.dataType = getProp(item, "dataType", "DataType") || tag.dataType;
      tag.statusCode = getProp(item, "statusCode", "StatusCode") || "Good";
      tag.sourceTimestamp = getProp(item, "sourceTimestamp", "SourceTimestamp");
    }

    renderSelectedTagsTable(changedIds);
    updateNodeDetailsIfSelected();
    await autoPublishTags(Array.from(selectedTagsMap.values()));

    const interval = getScanInterval();
    updateMonitorStatus(
      "active",
      `● Scan Time Active: Reading ${nodeIds.length} tags every ${interval}ms (Scan #${readIterationCount})`,
      `Last: ${new Date().toLocaleTimeString()} | Total: ${readIterationCount}`
    );

    if (isMonitoring) {
      monitorTimeoutId = setTimeout(performScanTimeStep, interval);
    }
  } catch (err) {
    console.error("ScanTime error:", err);
    updateMonitorStatus("active", `Scan error: ${err.message}. Retrying...`);
    if (isMonitoring) {
      monitorTimeoutId = setTimeout(performScanTimeStep, 2000);
    }
  }
}

async function performOnChangeStep() {
  if (!isMonitoring || !isConnected || selectedTagsMap.size === 0) {
    stopMonitoring();
    return;
  }

  const nodeIds = Array.from(selectedTagsMap.keys());
  const prevObj = Object.fromEntries(lastKnownValues);

  try {
    const result = await request("/api/OpcUa/monitor/changes", {
      method: "POST",
      body: JSON.stringify({ nodeIds, previousValues: prevObj })
    });

    readIterationCount++;
    const items = result.data || result.Data || [];
    const changedIds = new Set();
    const changedNames = [];

    for (const item of items) {
      const id = getProp(item, "nodeId", "NodeId");
      if (!id || !selectedTagsMap.has(id)) continue;
      const tag = selectedTagsMap.get(id);
      const newVal = getProp(item, "value", "Value");
      const strVal = formatValue(newVal);
      const hasChanged = getProp(item, "hasChanged", "HasChanged");

      if (hasChanged && lastKnownValues.has(id)) {
        changedIds.add(id);
        changedNames.push(tag.name);
        changeDetectionCount++;
        tag.lastChanged = new Date();
        tag.changeState = "Changed";
      } else {
        tag.changeState = "Steady";
      }

      lastKnownValues.set(id, strVal);
      tag.value = newVal;
      tag.dataType = getProp(item, "dataType", "DataType") || tag.dataType;
      tag.statusCode = getProp(item, "statusCode", "StatusCode") || "Good";
      tag.sourceTimestamp = getProp(item, "sourceTimestamp", "SourceTimestamp");
    }

    renderSelectedTagsTable(changedIds);
    updateNodeDetailsIfSelected();
    if (changedIds.size > 0) {
      await autoPublishTags(Array.from(changedIds).map(id => selectedTagsMap.get(id)).filter(Boolean));
    }

    if (changedIds.size > 0) {
      updateMonitorStatus(
        "onchange",
        `⚡ OnChange: Detected ${changedIds.size} change(s)! (${changedNames.slice(0, 3).join(", ")}${changedNames.length > 3 ? "..." : ""})`,
        `Changes: ${changeDetectionCount} | Checks: ${readIterationCount}`
      );
    } else {
      updateMonitorStatus(
        "onchange",
        `⚡ OnChange Active: Monitoring ${nodeIds.length} tags for data changes... (Steady, no change)`,
        `Changes: ${changeDetectionCount} | Checks: ${readIterationCount}`
      );
    }

    if (isMonitoring) {
      monitorTimeoutId = setTimeout(performOnChangeStep, 400);
    }
  } catch (err) {
    console.error("OnChange error:", err);
    if (isMonitoring) {
      monitorTimeoutId = setTimeout(performOnChangeStep, 2000);
    }
  }
}

async function performSingleTagRead(nodeId) {
  if (!isMonitoring || !isConnected || !selectedTagsMap.has(nodeId)) return;

  try {
    const result = await request("/api/OpcUa/read/batch", {
      method: "POST",
      body: JSON.stringify({ nodeIds: [nodeId] })
    });

    readIterationCount++;
    const items = result.data || result.Data || [];
    const changedIds = new Set();

    for (const item of items) {
      const id = getProp(item, "nodeId", "NodeId");
      if (!id || !selectedTagsMap.has(id)) continue;
      const tag = selectedTagsMap.get(id);
      const newVal = getProp(item, "value", "Value");
      const strVal = formatValue(newVal);

      if (lastKnownValues.has(id) && lastKnownValues.get(id) !== strVal) {
        changedIds.add(id);
        tag.lastChanged = new Date();
        tag.changeState = "Changed";
      } else {
        tag.changeState = "Steady";
      }

      lastKnownValues.set(id, strVal);
      tag.value = newVal;
      tag.dataType = getProp(item, "dataType", "DataType") || tag.dataType;
      tag.statusCode = getProp(item, "statusCode", "StatusCode") || "Good";
      tag.sourceTimestamp = getProp(item, "sourceTimestamp", "SourceTimestamp");
    }

    renderSelectedTagsTable(changedIds);
    updateNodeDetailsIfSelected();
    if (selectedTagsMap.has(nodeId)) {
      await autoPublishTags([selectedTagsMap.get(nodeId)]);
    }

    updateMonitorStatus(
      "active",
      `● Per-tag Scan Time Active: Monitoring ${selectedTagsMap.size} tags`,
      `Last: ${new Date().toLocaleTimeString()} | Reads: ${readIterationCount}`
    );
  } catch (err) {
    console.error(`Per-tag read error (${nodeId}):`, err);
  }
}

function scheduleTagRead(nodeId, interval) {
  if (!isMonitoring || !selectedTagsMap.has(nodeId)) return;

  const timerId = setTimeout(async () => {
    await performSingleTagRead(nodeId);
    if (isMonitoring && selectedTagsMap.has(nodeId)) {
      scheduleTagRead(nodeId, interval);
    }
  }, interval);

  tagTimers.set(nodeId, timerId);
}

function startMonitoring() {
  if (selectedTagsMap.size === 0) {
    return setMessage("Please select tags first using tree or table checkboxes.", "error");
  }
  if (!isConnected) {
    return setMessage("Connect to an OPC UA server first.", "error");
  }

  isMonitoring = true;
  $("startMonitorBtn").style.display = "none";
  $("stopMonitorBtn").style.display = "";
  $("stopMonitorBtn").disabled = false;

  readIterationCount = 0;
  changeDetectionCount = 0;

  if (activeReadMode === "scanTime") {
    const useTagScans = $("useTagScanRateCb")?.checked;
    if (useTagScans) {
      clearAllTagTimers();
      selectedTagsMap.forEach((tag, nodeId) => {
        const interval = (tag.scanRate && Number(tag.scanRate) >= 10) ? Number(tag.scanRate) : getScanInterval();
        performSingleTagRead(nodeId);
        scheduleTagRead(nodeId, interval);
      });
      updateMonitorStatus("active", `● Per-tag Scan Time started for ${selectedTagsMap.size} tags`);
    } else {
      const interval = getScanInterval();
      updateMonitorStatus("active", `● Starting Scan Time reading (every ${interval}ms)...`);
      performScanTimeStep();
    }
  } else {
    updateMonitorStatus("onchange", `⚡ Starting OnChange monitoring... Initializing baseline.`);
    performOnChangeStep();
  }
}

function stopMonitoring() {
  isMonitoring = false;
  if (monitorTimeoutId) {
    clearTimeout(monitorTimeoutId);
    monitorTimeoutId = null;
  }
  clearAllTagTimers();

  $("startMonitorBtn").style.display = "";
  $("startMonitorBtn").disabled = !isConnected || selectedTagsMap.size === 0;
  $("stopMonitorBtn").style.display = "none";
  $("stopMonitorBtn").disabled = true;

  updateMonitorStatus("idle", `○ Reader stopped. Last mode: ${activeReadMode === "scanTime" ? "Scan Time" : "OnChange"}.`);
}

function switchMode(mode) {
  if (activeReadMode === mode) return;
  activeReadMode = mode;

  if (mode === "scanTime") {
    $("btnModeScanTime").classList.add("active");
    $("btnModeOnChange").classList.remove("active");
    $("scanTimeSettings").style.display = "";
    $("onChangeSettings").style.display = "none";
  } else {
    $("btnModeOnChange").classList.add("active");
    $("btnModeScanTime").classList.remove("active");
    $("scanTimeSettings").style.display = "none";
    $("onChangeSettings").style.display = "";
  }

  if (isMonitoring) {
    if (monitorTimeoutId) clearTimeout(monitorTimeoutId);
    if (activeReadMode === "scanTime") {
      performScanTimeStep();
    } else {
      performOnChangeStep();
    }
  } else {
    const modeName = mode === "scanTime" ? "Scan Time" : "OnChange";
    updateMonitorStatus("idle", `○ Mode set to '${modeName}'. Click 'Start Reading' to begin.`);
  }
}

async function readOnce() {
  const nodeIds = Array.from(selectedTagsMap.keys());
  if (nodeIds.length === 0 || !isConnected) return;

  try {
    $("readOnceBtn").disabled = true;
    setMessage(`Reading ${nodeIds.length} selected tags...`);

    const result = await request("/api/OpcUa/read/batch", {
      method: "POST",
      body: JSON.stringify({ nodeIds })
    });

    const items = result.data || result.Data || [];
    const changedIds = new Set();

    for (const item of items) {
      const id = getProp(item, "nodeId", "NodeId");
      if (!id || !selectedTagsMap.has(id)) continue;
      const tag = selectedTagsMap.get(id);
      const newVal = getProp(item, "value", "Value");
      const strVal = formatValue(newVal);

      if (lastKnownValues.has(id) && lastKnownValues.get(id) !== strVal) {
        changedIds.add(id);
      }
      lastKnownValues.set(id, strVal);
      tag.value = newVal;
      tag.dataType = getProp(item, "dataType", "DataType") || tag.dataType;
      tag.statusCode = getProp(item, "statusCode", "StatusCode") || "Good";
      tag.sourceTimestamp = getProp(item, "sourceTimestamp", "SourceTimestamp");
    }

    renderSelectedTagsTable(changedIds);
    updateNodeDetailsIfSelected();
    await autoPublishTags(Array.from(selectedTagsMap.values()));
    setMessage(`Successfully read ${nodeIds.length} selected tags.`, "success");
  } catch (error) {
    setMessage(`Read failed: ${error.message}`, "error");
  } finally {
    $("readOnceBtn").disabled = selectedTagsMap.size === 0 || !isConnected;
  }
}

function updateNodeDetailsIfSelected() {
  if (!selectedNode) return;
  const currId = getProp(selectedNode, "nodeId", "NodeId");
  if (selectedTagsMap.has(currId)) {
    const tag = selectedTagsMap.get(currId);
    $("nodeValue").textContent = formatValue(tag.value);
    $("detailDataType").textContent = tag.dataType;
    $("detailStatus").textContent = tag.statusCode;
    $("detailTimestamp").textContent = formatDate(tag.sourceTimestamp);
    $("readStatus").textContent = "Updated from live reader.";
  }
}

function exportCsv() {
  const tags = Array.from(selectedTagsMap.values());
  if (tags.length === 0) return setMessage("No tags selected to export.", "error");

  const headers = ["Tag Name", "Node ID", "Address", "Data Type", "Scan Time", "On-Change Mode", "Value", "Status", "Timestamp"];
  const rows = tags.map(tag => [
    `"${tag.name.replace(/"/g, '""')}"`,
    `"${tag.nodeId.replace(/"/g, '""')}"`,
    `"${(tag.address || "").replace(/"/g, '""')}"`,
    `"${(tag.dataType || "").replace(/"/g, '""')}"`,
    `"${(tag.scanTime || "").replace(/"/g, '""')}"`,
    `"${(tag.onChangeMode || "").replace(/"/g, '""')}"`,
    `"${formatValue(tag.value).replace(/"/g, '""')}"`,
    `"${(tag.statusCode || "").replace(/"/g, '""')}"`,
    `"${formatDate(tag.sourceTimestamp)}"`
  ]);

  const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `opcua_selected_tags_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setMessage(`Exported ${tags.length} selected tags to CSV.`, "success");
}

function findTreeSummary(nodeId) {
  const summaries = document.querySelectorAll("#tree summary");
  return Array.from(summaries).find(summary => summary.title === nodeId) || null;
}

function clearSelection() {
  selectedNode = null;
  selectedParent = null;
  selectedElement = null;
  selectedRow = null;
  $("selectedClass").textContent = "No selection";
  $("emptyDetails").hidden = false;
  $("nodeDetails").hidden = true;
  $("readBtn").disabled = true;
}

function selectNode(node, element) {
  if (selectedElement && selectedElement.classList) selectedElement.classList.remove("selected");
  if (selectedRow) selectedRow.classList.remove("selected-row");
  selectedElement = element;
  selectedRow = element?.tagName === "TR" ? element : null;
  if (selectedElement && selectedElement.classList) selectedElement.classList.add(selectedRow ? "selected-row" : "selected");
  selectedNode = node;

  const nodeClass = getProp(node, "nodeClass", "NodeClass") || "Unknown";
  $("selectedClass").textContent = nodeClass;
  $("emptyDetails").hidden = true;
  $("nodeDetails").hidden = false;
  $("readBtn").disabled = !isConnected || nodeClass !== "Variable";

  const name = getProp(node, "displayName", "DisplayName") || "—";
  const nodeId = getProp(node, "nodeId", "NodeId") || "—";
  $("detailName").textContent = name;
  $("detailNodeId").textContent = nodeId;
  $("detailNodeClass").textContent = nodeClass;
  $("detailDataType").textContent = getProp(node, "dataType", "DataType") || "—";

  let scanRate = getProp(node, "scanRate", "ScanRate", "minimumSamplingInterval", "MinimumSamplingInterval");
  let scanTime = getProp(node, "scanTime", "ScanTime");
  if (customScanRates.has(nodeId)) {
    const custom = customScanRates.get(nodeId);
    scanRate = custom.scanRate;
    scanTime = custom.scanTime;
  } else if (!scanTime) {
    scanTime = scanRate != null && Number(scanRate) >= 0 ? `${scanRate} ms` : "1000 ms";
  }
  $("detailScanTime").textContent = nodeClass === "Variable" ? scanTime : "—";

  let onChangeMode = getProp(node, "onChangeMode", "OnChangeMode", "scanMode", "ScanMode") || "On Change";
  $("detailOnChangeMode").textContent = nodeClass === "Variable" ? onChangeMode : "—";

  $("detailStatus").textContent = "—";
  $("detailTimestamp").textContent = "—";
  $("nodeValue").textContent = "Click Read value";
  $("readStatus").textContent = "Value has not been read yet.";

  if (selectedTagsMap.has(nodeId)) {
    const cached = selectedTagsMap.get(nodeId);
    if (cached.value !== "Not read") {
      $("nodeValue").textContent = formatValue(cached.value);
      $("detailStatus").textContent = cached.statusCode;
      $("detailTimestamp").textContent = formatDate(cached.sourceTimestamp);
      $("readStatus").textContent = "Cached from selected tags read.";
    }
  }
}

async function readSelectedNode() {
  if (!selectedNode || !isConnected) return;
  const nodeId = getProp(selectedNode, "nodeId", "NodeId");
  try {
    $("readBtn").disabled = true;
    setMessage(`Reading ${nodeId}...`);
    const result = await request("/api/OpcUa/read", {
      method: "POST", body: JSON.stringify({ nodeId })
    });
    if (result.success === false || result.Success === false) throw new Error(result.message || result.Message || "Read failed");
    const data = result.data ?? result.Data ?? result;
    const val = getProp(data, "value", "Value");
    $("nodeValue").textContent = formatValue(val);
    $("detailDataType").textContent = getProp(data, "dataType", "DataType") || $("detailDataType").textContent;
    $("detailStatus").textContent = getProp(data, "statusCode", "StatusCode") || "—";
    $("detailTimestamp").textContent = formatDate(getProp(data, "sourceTimestamp", "SourceTimestamp"));
    $("readStatus").textContent = "Read completed.";

    if (selectedTagsMap.has(nodeId)) {
      const tag = selectedTagsMap.get(nodeId);
      tag.value = val;
      tag.statusCode = $("detailStatus").textContent;
      tag.sourceTimestamp = getProp(data, "sourceTimestamp", "SourceTimestamp");
      renderSelectedTagsTable();
    }

    setMessage("Node value read successfully.", "success");
  } catch (error) {
    $("readStatus").textContent = error.message;
    setMessage(`Read failed: ${error.message}`, "error");
  } finally {
    $("readBtn").disabled = !selectedNode || !isConnected || getProp(selectedNode, "nodeClass", "NodeClass") !== "Variable";
  }
}

function formatValue(value) {
  if (value === null || value === undefined) return "null";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function expandAll() { document.querySelectorAll("#tree details").forEach(item => item.open = true); }
function collapseAll() { document.querySelectorAll("#tree details").forEach(item => item.open = false); }

function applyTreeFilter() {
  const term = $("treeSearch").value.trim().toLowerCase();
  document.querySelectorAll("#tree .node").forEach(node => { node.hidden = term && !node.dataset.name.includes(term); });
  if (term) document.querySelectorAll("#tree details").forEach(item => item.open = true);
}

// Master checkbox for children table
$("selectAllChildren").addEventListener("change", (e) => {
  const checked = e.target.checked;
  for (const child of currentChildTableItems) {
    const nodeClass = getProp(child, "nodeClass", "NodeClass");
    if (nodeClass === "Variable") {
      toggleSingleTag(child, checked);
    } else {
      toggleParentSelection(child, checked);
    }
  }
});

// Master checkbox for selected tags table
$("selectAllSelected").addEventListener("change", (e) => {
  if (!e.target.checked) {
    clearAllSelections();
  }
});

// Toggle to hide unnecessary children of Channel1
$("hideChannelChildrenCb").addEventListener("change", () => {
  if (loadedRoot) {
    renderTree();
    if (selectedParent) {
      renderChildrenTable(currentChildTableItems);
    }
  }
});


// MQTT broker and publishing controls
$("mqttConnectBtn").addEventListener("click", connectMqtt);
$("mqttDisconnectBtn").addEventListener("click", disconnectMqtt);
$("mqttPublishNowBtn").addEventListener("click", publishSelectedTagsNow);

// Mode buttons
$("btnModeScanTime").addEventListener("click", () => switchMode("scanTime"));
$("btnModeOnChange").addEventListener("click", () => switchMode("onChange"));

// Live monitor control buttons
$("startMonitorBtn").addEventListener("click", startMonitoring);
$("stopMonitorBtn").addEventListener("click", stopMonitoring);
$("readOnceBtn").addEventListener("click", readOnce);

$("connectBtn").addEventListener("click", connectServer);
$("disconnectBtn").addEventListener("click", disconnectServer);
$("browseBtn").addEventListener("click", loadHierarchy);
$("refreshBtn").addEventListener("click", loadHierarchy);
$("readBtn").addEventListener("click", readSelectedNode);
$("expandBtn").addEventListener("click", expandAll);
$("collapseBtn").addEventListener("click", collapseAll);
$("treeSearch").addEventListener("input", applyTreeFilter);
$("clearSelectedBtn").addEventListener("click", clearAllSelections);
$("treeClearBtn").addEventListener("click", clearAllSelections);
$("exportCsvBtn").addEventListener("click", exportCsv);

setMqttConnected(false);

// Auto-load saved configuration on startup
document.addEventListener("DOMContentLoaded", loadSavedConfigOnStartup);
loadSavedConfigOnStartup();