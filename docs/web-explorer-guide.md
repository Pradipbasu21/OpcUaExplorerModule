# OPC UA Web Explorer Guide

`OpcUaExplorer.Web` is a responsive, web-based explorer designed to interact with any OPC UA server through the `OpcUaWebApi`.

---

## 1. Features
- **Endpoint Configuration**: Input custom OPC UA server endpoints (e.g. `opc.tcp://localhost:4840`).
- **Hierarchy Tree View with Checkboxes**: Collapsible tree navigation with multi-select checkboxes. Checking any parent folder recursively browses and displays all its child tags in the **Child nodes** view.
- **Channel1 System Node Filter**: Option to automatically hide internal diagnostic children under Channel1 (e.g. `_System`, `_Statistics`, `_Hints`), decluttering the browser to focus on real devices and tags.
- **Child Nodes Tag Browser**: Displays Tag Name, Address, Data Type, **Editable Scan Rate / Time**, **On-Change Mode**, Scaling, and Description.
- **Scan Rate Editing**: Change scan rates individually via row pencil icon (`✏️`) or in bulk using the **"Edit Scan Rate"** modal with presets (`100ms`, `250ms`, `500ms`, `1000ms`, `2000ms`, `5000ms`).
- **Configuration Persistence & Auto-Load**:
  - **Save Configuration (`💾 Save Config`)**: Saves all browsed tags, custom scan rates, and server endpoints to browser storage (`localStorage`) and allows exporting as an `opcua_tags_config.json` file.
  - **Auto-Load on Browser Reopen**: When the browser reopens, tags, customized scan rates, and server settings are automatically restored with a status banner.
  - **Load / Import Configuration (`📂 Load Config`)**: Reload from storage or import any saved `.json` configuration file.
- **Multi-Selected Tags Panel with Dual Read Modes**:
  - **⏱️ Scan Time Mode**: Periodically reads multi-selected tags based on the configured scan interval (or individual tag scan times) with live throughput and scan count stats.
  - **⚡ OnChange Mode**: Monitors selected tags and updates data only when values actually change, dynamically pulsing and highlighting changed rows.
- **Batch Actions**: One-click **Batch Read**, **Start/Stop Live Monitoring**, selection clearing, and CSV export.
- **Live Value Inspector**: Detailed single-node inspection pane with cached or live values.

---

## 2. Hosting Options

### Option A: Standalone Live Server (Development)
1. Serve the frontend:
   ```bash
   python3 -m http.server 5500 --directory src/OpcUaExplorer.Web
   ```
2. Open `http://localhost:5500` in your web browser.
3. Configure the **Web API Base URL** field to `http://localhost:5000`.

### Option B: Integrated Hosting (Production)
Copy the static assets to the API project's `wwwroot/` folder:
```bash
mkdir -p src/OpcUaWebApi/wwwroot
cp -r src/OpcUaExplorer.Web/* src/OpcUaWebApi/wwwroot/
```
In `src/OpcUaWebApi/Program.cs`:
```csharp
app.UseDefaultFiles();
app.UseStaticFiles();
```
Both the API and UI will be served from `http://localhost:5000`.

---

## 3. CORS Configuration
When using Option A across different origins (e.g., frontend on `:5500` and API on `:5000`), enable CORS in `Program.cs`:
```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("http://127.0.0.1:5500", "http://localhost:5500")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});
...
app.UseCors("AllowFrontend");
```
