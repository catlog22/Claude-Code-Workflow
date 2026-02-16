# Claude Code Workflow (CCW) - Installation Guide

**English** | [中文](INSTALL_CN.md)

Installation guide for Claude Code Agent workflow coordination and distributed memory system.

> **Version 6.3.18: Native CodexLens & Dashboard Revolution** - Built-in code indexing engine (FTS + semantic search + HNSW vector index), new Dashboard views, TypeScript backend, session clustering intelligent memory management.

## ⚡ Quick Installation (Recommended)

### NPM Global Install

```bash
npm install -g claude-code-workflow
```

### Complete Installation

After installing the npm package, you need to run the installation command to set up workflows, scripts, and templates:

```bash
# Option A (default): install full CCW system files
ccw install -m Global

# Option B (alternative): install only Codex resources (.codex)
ccw install --codex-only -m Global
```

The `ccw install` command will:
- Install workflow definitions to `~/.ccw/workflows/`
- Install utility scripts to `~/.claude/scripts/`
- Install prompt templates to `~/.claude/templates/`
- Install skill definitions to `~/.codex/skills/`
- Configure shell integration (optional)

When `--codex-only` is provided, installation is limited to `.codex` content only.
`--codex-only` is an alternative mode, not a supplemental step after full install.
Running `ccw install` again with the same mode/path replaces the managed manifest scope for that target.

### Verify Installation

```bash
# Check ccw command
ccw --version

# Start Dashboard
ccw dashboard

# Start View interface (alternative UI)
ccw view
```

## 📂 Install from Source

If you want to install from source or contribute to development:

```bash
# Clone repository
git clone https://github.com/catlog22/Claude-Code-Workflow.git
cd Claude-Code-Workflow

# Install dependencies
npm install

# Global link (development mode)
npm link
```

## Platform Requirements

- **Node.js**: 16.0.0 or higher
- **OS**: Windows, Linux, macOS

Check Node.js version:
```bash
node --version  # Should be >= 16.0.0
```

## ⚙️ Configuration

### Tool Control System

CCW uses a **configuration-based tool control system** that makes external CLI tools **optional** rather than required. This allows you to:

- ✅ **Start with Claude-only mode** - Work immediately without installing additional tools
- ✅ **Progressive enhancement** - Add external tools selectively as needed
- ✅ **Graceful degradation** - Automatic fallback when tools are unavailable
- ✅ **Flexible configuration** - Control tool availability per project

**Configuration File**: `~/.ccw/workflows/tool-control.yaml`

```yaml
tools:
  gemini:
    enabled: false  # Optional: AI analysis & documentation
  qwen:
    enabled: true   # Optional: AI architecture & code generation
  codex:
    enabled: true   # Optional: AI development & implementation
```

**Behavior**:
- **When disabled**: CCW automatically falls back to other enabled tools or Claude's native capabilities
- **When enabled**: Uses specialized tools for their specific strengths
- **Default**: All tools disabled - Claude-only mode works out of the box

### Optional CLI Tools *(Enhanced Capabilities)*

While CCW works with Claude alone, installing these tools provides enhanced analysis and extended context:

#### System Utilities

| Tool | Purpose | Installation |
|------|---------|--------------|
| **ripgrep (rg)** | Fast code search | **macOS**: `brew install ripgrep`<br>**Linux**: `apt install ripgrep`<br>**Windows**: `winget install ripgrep` |
| **jq** | JSON processing | **macOS**: `brew install jq`<br>**Linux**: `apt install jq`<br>**Windows**: `winget install jq` |

#### External AI Tools

Configure these tools in `~/.ccw/workflows/tool-control.yaml` after installation:

| Tool | Purpose | Installation |
|------|---------|--------------|
| **Gemini CLI** | AI analysis & documentation | Follow [official docs](https://ai.google.dev) - Free quota, extended context |
| **Codex CLI** | AI development & implementation | Follow [official docs](https://github.com/openai/codex) - Autonomous development |
| **Qwen Code** | AI architecture & code generation | Follow [official docs](https://github.com/QwenLM/qwen-code) - Large context window |

### Recommended: MCP Tools *(Enhanced Analysis)*

MCP (Model Context Protocol) tools provide advanced codebase analysis. **Recommended installation** - While CCW has fallback mechanisms, not installing MCP tools may lead to unexpected behavior or degraded performance in some workflows.

| MCP Server | Purpose | Installation Guide |
|------------|---------|-------------------|
| **Exa MCP** | External API patterns & best practices | [Install Guide](https://smithery.ai/server/exa) |
| **Chrome DevTools MCP** | ⚠️ **Required for UI workflows** - URL mode design extraction | [Install Guide](https://github.com/ChromeDevTools/chrome-devtools-mcp) |

> **Note**: Code Index MCP has been replaced by CCW's built-in **CodexLens** (`mcp__ccw-tools__codex_lens`). No additional installation required for code indexing.

## ✅ Verify Installation

After installation, open **Claude Code** and check if the workflow commands are available by running:

```bash
/workflow:session:list
```

This command should be recognized in Claude Code's interface. If you see the workflow slash commands (e.g., `/workflow:*`, `/cli:*`), the installation was successful.

## Troubleshooting

### Permission Errors (npm global install)

**Linux/macOS**:
```bash
# Option 1: Use nvm to manage Node.js (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Option 2: Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

**Windows**: Run Command Prompt or PowerShell as Administrator

### Workflow Commands Not Working

- Verify installation: `ls ~/.claude` (should show agents/, commands/, workflows/)
- Restart Claude Code after installation
- Check `/workflow:session:list` command is recognized

### ccw Command Not Found

```bash
# Check global install location
npm list -g --depth=0

# Ensure npm bin directory is in PATH
npm bin -g
```

## Support

- **Issues**: [GitHub Issues](https://github.com/catlog22/Claude-Code-Workflow/issues)
- **Getting Started**: [Quick Start Guide](GETTING_STARTED.md)
- **Documentation**: [Main README](README.md)
