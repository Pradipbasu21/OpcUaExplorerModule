# OPC UA Web API Guide

The `OpcUaWebApi` provides a RESTful interface to control OPC UA connections, browse address spaces, and read or write node variables.

---

## Base Address
```
http://localhost:5000/api/OpcUa
```

---

## Endpoints

### 1. Connect
Establishes a session to the specified OPC UA server.

- **URL**: `/api/OpcUa/connect`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "serverUrl": "opc.tcp://localhost:53530/OPCUA/SimulationServer",
    "useSecurity": false
  }
  ```
- **Responses**:
  - `200 OK`: Connected successfully.
  - `400 Bad Request`: Invalid server URL.
  - `500 Internal Server Error`: Failed to connect (e.g. timeout or server unreachable).

---

### 2. Disconnect
Terminates the active OPC UA session.

- **URL**: `/api/OpcUa/disconnect`
- **Method**: `POST`
- **Responses**:
  - `200 OK`: Disconnected successfully.

---

### 3. Browse Hierarchy
Recursively browses the OPC UA address space starting from Root (`i=84`) up to `maxDepth`.

- **URL**: `/api/OpcUa/browse/hierarchy`
- **Method**: `GET`
- **Query Parameters**:
  - `maxDepth` (integer, default: 10): Max hierarchy depth.
  - `hideSystemNodes` (boolean, default: true): Hides internal diagnostic children under Channel1/Channels (e.g. `_System`, `_Statistics`, `_Hints`).
  - `includeValues` (boolean, default: true): Whether to read initial values.
- **Responses**:
  - `200 OK`: Array of hierarchical node objects.
  - `400 Bad Request`: Not connected to an OPC UA server.

---

### 4. Read Node
Reads the current value, data type, status code, and timestamp of a node.

- **URL**: `/api/OpcUa/read`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "nodeId": "ns=2;s=Demo.Dynamic.Scalar.Float"
  }
  ```
- **Responses**:
  - `200 OK`: Node read details.
  - `400 Bad Request`: NodeId missing or session not connected.
  - `500 Internal Server Error`: Read error (e.g., `BadNodeIdUnknown`).

---

### 5. Read Batch (Multiple Nodes)
Reads multiple node values in a single round-trip.

- **URL**: `/api/OpcUa/read/batch`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "nodeIds": [
      "ns=2;s=Demo.Dynamic.Scalar.Float",
      "ns=2;s=Demo.Static.Scalar.Int32"
    ]
  }
  ```
- **Responses**:
  - `200 OK`: Array of node read values with Status, DataType, and Timestamp.

---

### 6. Monitor Changes (OnChange Mode)
Compares current tag values with previous values and reports only changed tags.

- **URL**: `/api/OpcUa/monitor/changes`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "nodeIds": [
      "ns=2;s=Demo.Dynamic.Scalar.Float"
    ],
    "previousValues": {
      "ns=2;s=Demo.Dynamic.Scalar.Float": "24.5"
    }
  }
  ```
- **Responses**:
  - `200 OK`: Contains `hasChanges`, `changesCount`, and list of tags with `hasChanged: true/false`.

---

### 7. Write Node
Writes a new value to a writable Variable node.

- **URL**: `/api/OpcUa/write`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "nodeId": "ns=2;s=Demo.Static.Scalar.Int32",
    "value": 100
  }
  ```
- **Responses**:
  - `200 OK`: Successfully written.
  - `400 Bad Request`: Not connected or invalid parameters.
