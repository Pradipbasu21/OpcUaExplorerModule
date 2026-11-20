# OPC UA Explorer Web UI

A small HTML/CSS/JavaScript frontend for the existing .NET 8 OPC UA Web API.

## Requirements

- Your .NET 8 OPC UA Web API running and reachable.
- The API must expose:
  - `POST /api/OpcUa/connect`
  - `POST /api/OpcUa/disconnect`
  - `GET /api/OpcUa/browse/hierarchy`
  - `POST /api/OpcUa/read`
- VS Code with the **Live Server** extension (for standalone frontend preview).

## Option A — Run inside your ASP.NET Core project (recommended)

1. Copy `index.html`, `css/`, and `js/` into your API project's `wwwroot/` folder.
2. In `Program.cs`, register static files before `app.MapControllers()`:

   ```csharp
   app.UseDefaultFiles();
   app.UseStaticFiles();
   ```

3. Run the API:

   ```bash
   dotnet run --urls http://0.0.0.0:5000
   ```

4. Open `http://localhost:5000` in your browser.
5. Keep the Web API Base URL as `http://localhost:5000`.

This same-origin setup avoids browser CORS configuration.

## Option B — Run the frontend with VS Code Live Server

1. Open this folder in VS Code.
2. Install the **Live Server** extension if it is not already installed.
3. Right-click `index.html` and select **Open with Live Server**.
4. In the page, set Web API Base URL to `http://localhost:5000` (or your API URL).
5. If the browser reports a CORS error, configure CORS in the .NET API as shown below.

### CORS configuration for Live Server

If Live Server runs at `http://127.0.0.1:5500`, add this before `builder.Build()` in `Program.cs`:

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("OpcUaExplorer", policy =>
    {
        policy.WithOrigins("http://127.0.0.1:5500", "http://localhost:5500")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});
```

Then add this to the middleware pipeline, before `app.MapControllers()`:

```csharp
app.UseCors("OpcUaExplorer");
```

Only allow the exact frontend origin you use. Do not use permissive CORS for a production deployment.

## API response expectations

The hierarchy endpoint is expected to return a shape like:

```json
{
  "success": true,
  "totalNodes": 2,
  "data": {
    "nodeId": "i=85",
    "displayName": "Objects",
    "nodeClass": "Object",
    "children": []
  }
}
```

The read endpoint is expected to return:

```json
{
  "success": true,
  "data": {
    "nodeId": "ns=2;s=Machine.Temperature",
    "value": 75.5,
    "dataType": "Double",
    "statusCode": "Good",
    "sourceTimestamp": "2026-11-17T10:00:00Z"
  }
}
```

The frontend accepts camelCase and PascalCase JSON property names.

## Notes

- This is a browser frontend. It does not connect directly to OPC UA; it calls your .NET API.
- The API must connect to the OPC UA server before browsing.
- The initial tree request starts at `i=84` (Root folder), so Objects, Types, and Views appear as sibling folders, with a depth limit of 10 and a node limit of 5000. Adjust these in `js/app.js` if needed.
- Use HTTPS and authentication before exposing the API outside a trusted development network.

## Parent selection and child tag table

The address-space tree now behaves as follows:

- Selecting a folder/parent displays its immediate children in the right-side table.
- The table columns are Tag Name, Address, Data Type, Scan Rate, Scaling, and Description.
- Selecting a child folder changes the table to that folder's children.
- Selecting a Variable opens its details panel; use **Read value** to call the read API.

The frontend maps optional metadata fields from either camelCase or PascalCase JSON:

- Address: `address` / `Address`, falling back to `nodeId` / `NodeId`.
- Data Type: `dataType` / `DataType`.
- Scan Rate: `scanRate` / `ScanRate`, or `samplingInterval` / `SamplingInterval`, or `minimumSamplingInterval` / `MinimumSamplingInterval`.
- Scaling: `scaling` / `Scaling`, or `engineeringUnits` / `EngineeringUnits`.
- Description: `description` / `Description`.

**Backend metadata note:** the current starter `OpcUaHierarchyNode` model only returns NodeId, DisplayName, NodeClass and optional read-value fields. Therefore Scan Rate, Scaling and Description will show `—` until the .NET API reads and returns those attributes/properties. Standard OPC UA nodes expose DataType, Description and MinimumSamplingInterval for Variables; scaling is server/model-specific (often represented by EngineeringUnits, EURange or vendor properties). Address falls back to the OPC UA NodeId. The screenshot's `RANDOM(...)` / `RAMP(...)` address strings are simulator-specific metadata and cannot be derived from a NodeId alone.


## Tag table metadata and qualified names

- Variable Tag Name is rendered as its browse path, for example `Channel3.Device3._System._Description`.
- Address uses server-provided `Address`/`TagAddress` metadata when present; otherwise it displays the OPC UA NodeId.
- Data Type, Scan Rate, Scaling, and Description are displayed when the API supplies those fields; missing values show `—`.
- OPC UA `MinimumSamplingInterval` is a server-provided minimum, not necessarily the active subscription scan rate. The actual configured scan rate may need to come from the simulator configuration model or monitored-item subscription.

For all columns to populate, the backend must read OPC UA Variable attributes (DataType, Description, MinimumSamplingInterval) and vendor-specific properties (Address, Scaling). The frontend cannot infer simulator-specific `RANDOM(...)` or `RAMP(...)` address strings from a NodeId.
