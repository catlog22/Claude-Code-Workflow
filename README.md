# 🚀 Claude Code Workflow (CCW)

[![Run in Smithery](https://smithery.ai/badge/skills/catlog22)](https://smithery.ai/skills?ns=catlog22&utm_source=github&utm_medium=badge)


<div align="center">

[![Version](https://img.shields.io/badge/version-v6.3.18-blue.svg)](https://github.com/catlog22/Claude-Code-Workflow/releases)
[![npm](https://img.shields.io/npm/v/claude-code-workflow.svg)](https://www.npmjs.com/package/claude-code-workflow)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)]()
[![Visual Tests](https://github.com/catlog22/Claude-Code-Workflow/actions/workflows/visual-tests.yml/badge.svg)](https://github.com/catlog22/Claude-Code-Workflow/actions/workflows/visual-tests.yml)

**Languages:** [English](README.md) | [中文](README_CN.md)

</div>

---

**Claude Code Workflow (CCW)** is a JSON-driven multi-agent development framework with intelligent CLI orchestration (Gemini/Qwen/Codex), context-first architecture, and automated workflow execution. It transforms AI development from simple prompt chaining into a powerful orchestration system.

> **🎉 Version 6.3.18: Native CodexLens & Dashboard Revolution**
>
> **Breaking Changes**:
> - ⚠️ CLI command refactored: `ccw cli exec` → `ccw cli -p`
> - ⚠️ Code Index MCP replaced with native CodexLens
> - ⚠️ Knowledge Graph replaced with Session Clustering
>
> **Core Features**:
> - 🔍 **Native CodexLens**: Full-Text Search + Semantic Search + HNSW vector index
> - 🖥️ **New Dashboard Views**: CLAUDE.md Manager, Skills Manager, Graph Explorer, Core Memory
> - 📘 **TypeScript Migration**: Full backend modernization
> - 🧠 **Session Clustering**: Intelligent memory management with cluster visualization
>
> See [CHANGELOG.md](CHANGELOG.md) for complete details and migration guide.

> 📚 **New to CCW?** Check out the [**Getting Started Guide**](GETTING_STARTED.md) for a beginner-friendly 5-minute tutorial!

---

## ✨ Core Concepts

CCW is built on a set of core principles that distinguish it from traditional AI development approaches:

- **Context-First Architecture**: Eliminates uncertainty during execution through pre-defined context gathering, ensuring agents have the right information *before* implementation.
- **JSON-First State Management**: Task state is fully stored in `.task/IMPL-*.json` files as the single source of truth, enabling programmatic orchestration without state drift.
- **Autonomous Multi-Stage Orchestration**: Commands chain-invoke specialized sub-commands and agents to automate complex workflows with zero user intervention.
- **Multi-Model Strategy**: Leverages the unique strengths of different AI models (e.g., Gemini for analysis, Codex for implementation) for superior results.
- **Layered Memory System**: A 4-tier documentation system that provides context at the appropriate abstraction level, preventing information overload.
- **Specialized Role-Based Agents**: A suite of agents (`@code-developer`, `@test-fix-agent`, etc.) that emulate a real software team for diverse tasks.

---

## ⚙️ Installation

### **📋 Requirements**

| Platform | Node.js | Additional |
|----------|---------|------------|
| Windows | 20.x or 22.x LTS (recommended) | Node 23+ requires [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |
| macOS | 18.x+ | Xcode Command Line Tools |
| Linux | 18.x+ | build-essential |

> **Note**: The `better-sqlite3` dependency requires native compilation. Using Node.js LTS versions avoids build issues.

### **📦 npm Install (Recommended)**

Install globally via npm:
```bash
npm install -g claude-code-workflow
```

Then install workflow files to your system:
```bash
# Interactive installation
ccw install

# Global installation (to ~/.claude)
ccw install -m Global

# Project-specific installation
ccw install -m Path -p /path/to/project
```

### **✅ Verify Installation**
After installation, open **Claude Code** and verify that workflow commands are available by running:
```bash
/workflow:session:list
```
If slash commands (e.g., `/workflow:*`) are recognized, the installation was successful.

---

## 🖥️ CCW CLI Tool

The `ccw` command provides a powerful CLI for managing your Claude Code Workflow installation:

### **Commands**

| Command | Description |
|---------|-------------|
| `ccw install` | Install workflow files to Global (~/.claude) or specific Path |
| `ccw upgrade` | Upgrade existing installations to current package version |
| `ccw uninstall` | Remove workflow files from an installation |
| `ccw view` | Open the workflow dashboard in browser |
| `ccw serve` | Start dashboard server without opening browser |
| `ccw list` | List all managed installations |
| `ccw cli -p "..."` | Execute CLI tools (Gemini/Qwen/Codex) with prompt |
| `ccw core-memory` | Manage session clustering and memory |

### **Usage Examples**

```bash
# Install globally
ccw install -m Global

# Install to specific project
ccw install -m Path -p ./my-project

# Open dashboard
ccw view

# Start dashboard server on custom port
ccw serve --port 8080

# Upgrade all installations
ccw upgrade -a

# List installations
ccw list
```

### **Dashboard Features**

The CCW Dashboard (`ccw view`) provides:
- 📊 **Session Overview**: View all workflow sessions with status and progress
- 📋 **Task Management**: Track task execution and completion
- 🔍 **CodexLens Manager**: Native code indexing with FTS + Semantic + Hybrid search
- 🧠 **Core Memory**: Session clustering visualization with cluster management
- 📄 **CLAUDE.md Manager**: File tree viewer for configuration management
- 🎯 **Skills Manager**: View and manage Claude Code skills
- 🕸️ **Graph Explorer**: Interactive code relationship visualization (Cytoscape.js)
- ⚙️ **MCP Manager**: Configure and monitor MCP servers
- 🪝 **Hook Manager**: Manage Claude Code hooks
- ❓ **Help View**: Internationalized help documentation
- 💻 **CLI Manager**: CLI execution history with session resume

> 📖 See [**Dashboard Guide**](DASHBOARD_GUIDE.md) and [**Dashboard Operations**](DASHBOARD_OPERATIONS_EN.md) for detailed documentation.

---

## 🔒 Security

The dashboard server is **localhost-bound by default** and **API endpoints require authentication**. See `ccw/docs/SECURITY.md` for the full security model, token usage, and safe deployment guidance.

---

## 🛠️ Command Reference

CCW provides a rich set of commands for managing workflows, tasks, and interactions with AI tools. For a complete list and detailed descriptions of all available commands, please refer to the [**COMMAND_REFERENCE.md**](COMMAND_REFERENCE.md) file.

For detailed technical specifications of each command, see [**COMMAND_SPEC.md**](COMMAND_SPEC.md).

---

### 💡 **Need Help? Use the Interactive Command Guide**

CCW includes a built-in **Command Guide Skill** to help you discover and use commands effectively:

- **`CCW-help`** - Get interactive help and command recommendations
- **`CCW-issue`** - Report bugs or request features using guided templates

The Command Guide provides:
- 🔍 **Smart Command Search** - Find commands by keyword, category, or use case
- 🤖 **Next-Step Recommendations** - Get suggestions for what to do after any command
- 📖 **Detailed Documentation** - View arguments, examples, and best practices
- 🎓 **Beginner Onboarding** - Learn the 14 core commands through guided learning paths
- 📝 **Issue Reporting** - Generate standardized bug reports and feature requests

**Usage Examples**:
```
User: "CCW-help"
→ Interactive menu with command search, recommendations, and documentation

User: "What should I do after /workflow:plan?"
→ Recommends /workflow:execute, /workflow:action-plan-verify with workflow patterns

User: "CCW-issue"
→ Guided template generation for bugs, features, or question inquiries
```

---

## 🚀 Quick Start

The best way to get started is by following the 5-minute tutorial in the [**Getting Started Guide**](GETTING_STARTED.md).

Here's a quick example of a common development workflow:

### **Option 1: Lite-Plan Workflow** (⚡ Recommended for Quick Tasks)

Lightweight interactive workflow with in-memory planning and immediate execution:

```bash
# Basic usage with auto-detection
/workflow:lite-plan "Add JWT authentication to user login"

# Force code exploration
/workflow:lite-plan -e "Refactor logging module for better performance"

# Basic usage
/workflow:lite-plan "Add unit tests for authentication service"
```

**Interactive Flow**:
1. **Phase 1**: Automatic task analysis and smart code exploration (if needed)
2. **Phase 2**: Answer clarification questions (if any)
3. **Phase 3**: Review generated plan and task breakdown
4. **Phase 4**: Three-dimensional confirmation:
   - ✅ Confirm/Modify/Cancel task
   - 🔧 Choose execution: Agent / Provide Plan Only / CLI (Gemini/Qwen/Codex)
   - 🔍 Optional code review: No / Claude / Gemini / Qwen / Codex
5. **Phase 5**: Watch live execution and task tracking

### **Option 2: Lite-Fix Workflow** (🐛 Recommended for Bug Fixes)

Intelligent bug diagnosis and fix workflow with adaptive severity assessment:

```bash
# Standard bug fix (auto-adapts based on severity)
/workflow:lite-fix "User avatar upload fails with 413 error"

# Production hotfix mode
/workflow:lite-fix --hotfix "Payment gateway 5xx errors"
```

**Workflow Features**:
- **Phase 1**: Intelligent root cause diagnosis with adaptive search
- **Phase 2**: Automatic impact assessment and risk scoring
- **Phase 3**: Fix strategy generation based on complexity
- **Phase 4**: Risk-aware verification planning
- **Phase 5**: User confirmation with execution selection
- **Phase 6**: Execution dispatch with complete artifact tracking

**Session Artifacts** (saved to `.workflow/.lite-fix/{bug-slug}-{timestamp}/`):
- `diagnosis.json` - Root cause analysis and reproduction steps
- `impact.json` - Risk score, severity, and workflow adaptations
- `fix-plan.json` - Fix strategy and implementation tasks
- `task.json` - Enhanced Task JSON with complete context
- `followup.json` - Auto-generated follow-up tasks (hotfix mode only)

### **Option 3: Full Workflow** (📋 Comprehensive Planning)

Traditional multi-stage workflow for complex projects:

1.  **Create Plan** (auto-starts session):
    ```bash
    /workflow:plan "Implement JWT-based user login and registration"
    ```
2.  **Execute Plan**:
    ```bash
    /workflow:execute
    ```
3.  **View Status** (optional):
    ```bash
    /workflow:status
    ```

---

## 📚 Documentation

CCW provides comprehensive documentation to help you get started quickly and master advanced features:

### 📖 **Getting Started**
- [**Getting Started Guide**](GETTING_STARTED.md) - 5-minute quick start tutorial
- [**Installation Guide**](INSTALL.md) - Detailed installation instructions ([中文](INSTALL_CN.md))
- [**Workflow Decision Guide**](WORKFLOW_DECISION_GUIDE.md) - 🌳 Interactive flowchart to choose the right command
- [**Examples**](EXAMPLES.md) - Real-world use cases and practical examples
- [**FAQ**](FAQ.md) - Common questions and troubleshooting

### 🖥️ **Dashboard**
- [**Dashboard Guide**](DASHBOARD_GUIDE.md) - Dashboard user guide and interface overview
- [**Dashboard Operations**](DASHBOARD_OPERATIONS_EN.md) - Detailed operation instructions

### 🏗️ **Architecture & Design**
- [**Architecture Overview**](ARCHITECTURE.md) - System design and core components
- [**Project Introduction**](PROJECT_INTRODUCTION.md) - Detailed project overview
- [**Workflow Diagrams**](WORKFLOW_DIAGRAMS.md) - Visual workflow representations

### 📋 **Command Reference**
- [**Command Reference**](COMMAND_REFERENCE.md) - Complete list of all commands
- [**Command Spec**](COMMAND_SPEC.md) - Detailed technical specifications
- [**Command Flow Standard**](COMMAND_FLOW_STANDARD.md) - Command design patterns

### 🤝 **Contributing**
- [**Contributing Guide**](CONTRIBUTING.md) - How to contribute to CCW
- [**Changelog**](CHANGELOG.md) - Version history and release notes

---

## 🤝 Contributing & Support

- **Repository**: [GitHub - Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow)
- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/catlog22/Claude-Code-Workflow/issues).
- **Discussions**: Join the [Community Forum](https://github.com/catlog22/Claude-Code-Workflow/discussions).
- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
