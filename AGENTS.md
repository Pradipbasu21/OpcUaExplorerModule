# Agent Guidelines: OPC UA Explorer & Web API

This document establishes development principles, architectural constraints, and operational guidelines for AI agents and developers working in this repository.

---

## 1. Project Overview & Layout

This repository provides a modular OPC UA browsing and interaction solution:

```
.
├── .agents/
│   └── skills/
│       └── opcua-dev/              # Runbooks, helper scripts, and API specs for agents
│           ├── SKILL.md
│           ├── scripts/
│           └── references/
├── AGENTS.md                       # This document: agent rules & instructions
├── src/
│   ├── OpcUaExplorer.Web/          # Vanilla HTML5/CSS3/JavaScript frontend UI
│   │   ├── css/
│   │   ├── js/
│   │   └── index.html
│   └── OpcUaWebApi/                # ASP.NET Core 8 Web API
│       ├── Controllers/            # REST API endpoints (OpcUaController)
│       ├── Models/                 # DTOs and view models
│       ├── Services/               # OPC UA client logic (IOpcUaService, OpcUaService)
│       └── Program.cs              # DI container and middleware pipeline
├── docs/                           # Architecture, API guides, and troubleshooting
│   ├── architecture.md
│   ├── api-guide.md
│   ├── web-explorer-guide.md
│   └── troubleshooting.md
├── OpcUA.sln                       # Root solution file
└── README.md                       # Repository overview and quickstart
```

---

## 2. Tech Stack & Dependencies

- **Backend**:
  - Target Framework: `.NET 8.0` (`net8.0`)
  - SDK / Libraries:
    - `OPCFoundation.NetStandard.Opc.Ua.Client` (Version `1.5.378.156`+)
    - `Swashbuckle.AspNetCore` (Version `6.6.2`)
  - Pattern: Controller-based REST API with Singleton OPC UA Service session management.
- **Frontend**:
  - Modern ES6+ JavaScript, CSS3, Semantic HTML5.
  - No external build step or heavy framework required.

---

## 3. Coding Guidelines & Standards

### C# and ASP.NET Core
1. **Async Best Practices**:
   - Modern OPC UA SDK methods should prefer asynchronous calls (`ISessionFactory.CreateAsync`, `BrowseAsync`, `ReadValueAsync`, `WriteAsync`) to avoid blocking thread pool threads.
2. **Controller Design**:
   - Keep controllers thin. All OPC UA session, browse, read, and write operations belong in `IOpcUaService` / `OpcUaService`.
   - Return appropriate HTTP status codes: `200 OK` for success, `400 Bad Request` for invalid input/NodeId, `500 Internal Server Error` with meaningful message for OPC UA failures.
3. **Nullable Reference Types**:
   - `<Nullable>enable</Nullable>` is enabled in `OpcUaWebApi.csproj`. Ensure proper null checks and warnings resolution.
4. **Error Handling**:
   - Catch `ServiceResultException` from OPC UA SDK explicitly and extract `StatusCode` for clean client feedback.

### Web Frontend (`OpcUaExplorer.Web`)
1. **Separation of Concerns**:
   - HTML handles structure (`index.html`).
   - CSS handles styling and layout (`css/`).
   - JavaScript handles state, API interactions, and DOM updates (`js/`).
2. **CORS & Resilience**:
   - The frontend allows configuring the API base URL dynamically.
   - Gracefully display connection failures and clear error banners.

---

## 4. Safety & Operational Constraints

1. **OPC UA Write Safeguards**:
   - Industrial OPC UA servers control physical machinery or critical telemetry. Never automate write operations without explicit parameter confirmation.
2. **Credentials & Certificates**:
   - Do not commit client/server certificates, private keys, or credentials to version control.
   - Ignore `.pfx`, `.der`, and certificate store directories in `.gitignore`.
3. **Build Commands**:
   - To build without triggering sandbox lock issues:
     ```bash
     dotnet build src/OpcUaWebApi/OpcUaWebApi.csproj --no-restore
     ```
