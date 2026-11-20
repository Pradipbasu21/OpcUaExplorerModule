# OPC UA Explorer & Web API

A modular .NET 8 OPC UA solution featuring an ASP.NET Core Web API backend and a lightweight HTML5/JavaScript frontend for browsing and inspecting OPC UA servers.

---

## 📁 Repository Structure

```
.
├── .agents/
│   └── skills/
│       └── opcua-dev/              # Agent skills, runbooks, and automation scripts
│           ├── SKILL.md
│           ├── scripts/            # run_api.sh, test_api.sh
│           └── references/         # api_spec.md
├── AGENTS.md                       # Coding standards, architecture & guidelines for AI agents
├── src/
│   ├── OpcUaExplorer.Web/          # Frontend Web Explorer (HTML, CSS, JavaScript)
│   │   ├── css/                    # Layout and styling
│   │   ├── js/                     # Hierarchy tree and API client
│   │   └── index.html              # Main web UI
│   └── OpcUaWebApi/                # ASP.NET Core 8 Web API
│       ├── Controllers/            # OpcUaController REST API
│       ├── Models/                 # DTOs & Request/Response models
│       ├── Services/               # OPC UA client integration service
│       └── Program.cs              # Application startup & DI
├── docs/                           # Comprehensive documentation
│   ├── architecture.md             # System design & architecture
│   ├── api-guide.md                # REST API guide & endpoints
│   ├── web-explorer-guide.md       # Frontend hosting & configuration
│   └── troubleshooting.md          # Diagnostics & troubleshooting
├── start.sh                        # One-click startup script (Linux / macOS)
├── start.bat                       # One-click startup script (Windows)
├── start.ps1                       # One-click startup script (PowerShell)
├── OpcUA.sln                       # Root .NET solution
└── README.md                       # Project overview & quick start
```

---

## 🚀 Quick Start (Automated One-Click Run)

### Automated Launchers
Both the ASP.NET Core Web API and the Web Explorer UI can be executed together automatically:

- **Linux / macOS**:
  ```bash
  ./start.sh
  ```
  *(To run dual-server mode with standalone frontend on port 5500: `./start.sh dual`)*

- **Windows Batch**:
  Double-click `start.bat` or run:
  ```cmd
  start.bat
  ```

- **PowerShell (Cross-Platform)**:
  ```powershell
  ./start.ps1
  ```

---

## 🛠️ Manual Execution Options

---

## 📡 API Overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/OpcUa/connect` | Connect to an OPC UA server |
| `POST` | `/api/OpcUa/disconnect` | Close the active OPC UA session |
| `GET` | `/api/OpcUa/browse/hierarchy` | Browse node hierarchy from Root |
| `POST` | `/api/OpcUa/read` | Read value and metadata of a node |
| `POST` | `/api/OpcUa/write` | Write value to a variable node |

See [`docs/api-guide.md`](./docs/api-guide.md) and [`references/api_spec.md`](./.agents/skills/opcua-dev/references/api_spec.md) for complete details.

---

## 🤖 Agent Support & Customization

This repository is pre-configured for AI developer agents with Antigravity:
- **Project Guidelines**: [`AGENTS.md`](./AGENTS.md) defines architecture conventions, safety rules, and code style.
- **Agent Skill**: [`.agents/skills/opcua-dev/`](./.agents/skills/opcua-dev/SKILL.md) provides automated workflows and operational procedures for agentic pair programming.

---

## 📚 Documentation

- [Architecture & Design](docs/architecture.md)
- [API Guide & Reference](docs/api-guide.md)
- [Web Explorer User Guide](docs/web-explorer-guide.md)
- [Troubleshooting & FAQs](docs/troubleshooting.md)
