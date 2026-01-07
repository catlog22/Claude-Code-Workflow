/**
 * MCP Routes Module
 * Handles all MCP-related API endpoints
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import * as McpTemplatesDb from './mcp-templates-db.js';
import type { RouteContext } from './types.js';

// Claude config file path
const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');

// Codex config file path (TOML format)
const CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml');

// Workspace root path for scanning .mcp.json files
let WORKSPACE_ROOT = process.cwd();

// ========================================
// TOML Parser for Codex Config
// ========================================

/**
 * Simple TOML parser for Codex config.toml
 * Supports basic types: strings, numbers, booleans, arrays, inline tables
 */
function parseToml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Handle section headers [section] or [section.subsection]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].split('.');
      // Ensure nested sections exist
      let obj = result;
      for (const part of currentSection) {
        if (!obj[part]) obj[part] = {};
        obj = obj[part];
      }
      continue;
    }

    // Handle key = value pairs
    const keyValueMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (keyValueMatch) {
      const key = keyValueMatch[1];
      const rawValue = keyValueMatch[2].trim();
      const value = parseTomlValue(rawValue);

      // Navigate to current section
      let obj = result;
      for (const part of currentSection) {
        if (!obj[part]) obj[part] = {};
        obj = obj[part];
      }
      obj[key] = value;
    }
  }

  return result;
}

/**
 * Parse a TOML value
 */
function parseTomlValue(value: string): any {
  // String (double-quoted)
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // String (single-quoted - literal)
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
  }

  // Array
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    // Simple array parsing (handles basic cases)
    const items: any[] = [];
    let depth = 0;
    let current = '';
    let inString = false;
    let stringChar = '';

    for (const char of inner) {
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
        current += char;
      } else if (inString && char === stringChar) {
        inString = false;
        current += char;
      } else if (!inString && (char === '[' || char === '{')) {
        depth++;
        current += char;
      } else if (!inString && (char === ']' || char === '}')) {
        depth--;
        current += char;
      } else if (!inString && char === ',' && depth === 0) {
        items.push(parseTomlValue(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      items.push(parseTomlValue(current.trim()));
    }
    return items;
  }

  // Inline table { key = value, ... }
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return {};
    const table: Record<string, any> = {};
    // Simple inline table parsing
    const pairs = inner.split(',');
    for (const pair of pairs) {
      const match = pair.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
      if (match) {
        table[match[1]] = parseTomlValue(match[2].trim());
      }
    }
    return table;
  }

  // Return as string if nothing else matches
  return value;
}

/**
 * Serialize object to TOML format for Codex config
 *
 * Handles mixed objects containing both simple values and sub-objects.
 * For example: { command: "cmd", args: [...], env: { KEY: "value" } }
 * becomes:
 *   [section]
 *   command = "cmd"
 *   args = [...]
 *   [section.env]
 *   KEY = "value"
 */
function serializeToml(obj: Record<string, any>, prefix: string = ''): string {
  let result = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Handle nested sections (like mcp_servers.server_name)
      const sectionKey = prefix ? `${prefix}.${key}` : key;

      // Separate simple values from sub-objects
      const simpleEntries: [string, any][] = [];
      const objectEntries: [string, any][] = [];

      for (const [subKey, subValue] of Object.entries(value)) {
        if (subValue === null || subValue === undefined) continue;
        if (typeof subValue === 'object' && !Array.isArray(subValue)) {
          objectEntries.push([subKey, subValue]);
        } else {
          simpleEntries.push([subKey, subValue]);
        }
      }

      // Write section header if there are simple values
      if (simpleEntries.length > 0) {
        result += `\n[${sectionKey}]\n`;
        for (const [subKey, subValue] of simpleEntries) {
          result += `${subKey} = ${serializeTomlValue(subValue)}\n`;
        }
      }

      // Recursively handle sub-objects
      if (objectEntries.length > 0) {
        for (const [subKey, subValue] of objectEntries) {
          const subSectionKey = `${sectionKey}.${subKey}`;

          // Check if sub-object has nested objects
          const hasNestedObjects = Object.values(subValue).some(
            v => typeof v === 'object' && v !== null && !Array.isArray(v)
          );

          if (hasNestedObjects) {
            // Recursively process nested objects
            result += serializeToml({ [subKey]: subValue }, sectionKey);
          } else {
            // Write sub-section with simple values
            result += `\n[${subSectionKey}]\n`;
            for (const [nestedKey, nestedValue] of Object.entries(subValue)) {
              if (nestedValue !== null && nestedValue !== undefined) {
                result += `${nestedKey} = ${serializeTomlValue(nestedValue)}\n`;
              }
            }
          }
        }
      }

      // If no simple values but has object entries, still need to process
      if (simpleEntries.length === 0 && objectEntries.length === 0) {
        // Empty section - write header only
        result += `\n[${sectionKey}]\n`;
      }
    } else if (!prefix) {
      // Top-level simple values
      result += `${key} = ${serializeTomlValue(value)}\n`;
    }
  }

  return result;
}

/**
 * Serialize a value to TOML format
 */
function serializeTomlValue(value: any): string {
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => serializeTomlValue(v)).join(', ')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const pairs = Object.entries(value)
      .filter(([_, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k} = ${serializeTomlValue(v)}`);
    return `{ ${pairs.join(', ')} }`;
  }
  return String(value);
}

// ========================================
// Codex MCP Functions
// ========================================

/**
 * Read Codex config.toml and extract MCP servers
 */
function getCodexMcpConfig(): { servers: Record<string, any>; configPath: string; exists: boolean } {
  try {
    if (!existsSync(CODEX_CONFIG_PATH)) {
      return { servers: {}, configPath: CODEX_CONFIG_PATH, exists: false };
    }

    const content = readFileSync(CODEX_CONFIG_PATH, 'utf8');
    const config = parseToml(content);

    // MCP servers are under [mcp_servers] section
    const mcpServers = config.mcp_servers || {};

    return {
      servers: mcpServers,
      configPath: CODEX_CONFIG_PATH,
      exists: true
    };
  } catch (error: unknown) {
    console.error('Error reading Codex config:', error);
    return { servers: {}, configPath: CODEX_CONFIG_PATH, exists: false };
  }
}

/**
 * Add or update MCP server in Codex config.toml
 */
function addCodexMcpServer(serverName: string, serverConfig: Record<string, any>): { success?: boolean; error?: string } {
  try {
    const codexDir = join(homedir(), '.codex');

    // Ensure .codex directory exists
    if (!existsSync(codexDir)) {
      mkdirSync(codexDir, { recursive: true });
    }

    let config: Record<string, any> = {};

    // Read existing config if it exists
    if (existsSync(CODEX_CONFIG_PATH)) {
      const content = readFileSync(CODEX_CONFIG_PATH, 'utf8');
      config = parseToml(content);
    }

    // Ensure mcp_servers section exists
    if (!config.mcp_servers) {
      config.mcp_servers = {};
    }

    // Convert serverConfig from Claude format to Codex format
    const codexServerConfig: Record<string, any> = {};

    // Handle STDIO servers (command-based)
    if (serverConfig.command) {
      codexServerConfig.command = serverConfig.command;
      if (serverConfig.args && serverConfig.args.length > 0) {
        codexServerConfig.args = serverConfig.args;
      }
      if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
        codexServerConfig.env = serverConfig.env;
      }
      if (serverConfig.cwd) {
        codexServerConfig.cwd = serverConfig.cwd;
      }
    }

    // Handle HTTP servers (url-based)
    if (serverConfig.url) {
      codexServerConfig.url = serverConfig.url;
      if (serverConfig.bearer_token_env_var) {
        codexServerConfig.bearer_token_env_var = serverConfig.bearer_token_env_var;
      }
      if (serverConfig.http_headers) {
        codexServerConfig.http_headers = serverConfig.http_headers;
      }
    }

    // Copy optional fields
    if (serverConfig.startup_timeout_sec !== undefined) {
      codexServerConfig.startup_timeout_sec = serverConfig.startup_timeout_sec;
    }
    if (serverConfig.tool_timeout_sec !== undefined) {
      codexServerConfig.tool_timeout_sec = serverConfig.tool_timeout_sec;
    }
    if (serverConfig.enabled !== undefined) {
      codexServerConfig.enabled = serverConfig.enabled;
    }
    if (serverConfig.enabled_tools) {
      codexServerConfig.enabled_tools = serverConfig.enabled_tools;
    }
    if (serverConfig.disabled_tools) {
      codexServerConfig.disabled_tools = serverConfig.disabled_tools;
    }

    // Add the server
    config.mcp_servers[serverName] = codexServerConfig;

    // Serialize and write back
    const tomlContent = serializeToml(config);
    writeFileSync(CODEX_CONFIG_PATH, tomlContent, 'utf8');

    return { success: true };
  } catch (error: unknown) {
    console.error('Error adding Codex MCP server:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Remove MCP server from Codex config.toml
 */
function removeCodexMcpServer(serverName: string): { success?: boolean; error?: string } {
  try {
    if (!existsSync(CODEX_CONFIG_PATH)) {
      return { error: 'Codex config.toml not found' };
    }

    const content = readFileSync(CODEX_CONFIG_PATH, 'utf8');
    const config = parseToml(content);

    if (!config.mcp_servers || !config.mcp_servers[serverName]) {
      return { error: `Server not found: ${serverName}` };
    }

    // Remove the server
    delete config.mcp_servers[serverName];

    // Serialize and write back
    const tomlContent = serializeToml(config);
    writeFileSync(CODEX_CONFIG_PATH, tomlContent, 'utf8');

    return { success: true };
  } catch (error: unknown) {
    console.error('Error removing Codex MCP server:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Toggle Codex MCP server enabled state
 */
function toggleCodexMcpServer(serverName: string, enabled: boolean): { success?: boolean; error?: string } {
  try {
    if (!existsSync(CODEX_CONFIG_PATH)) {
      return { error: 'Codex config.toml not found' };
    }

    const content = readFileSync(CODEX_CONFIG_PATH, 'utf8');
    const config = parseToml(content);

    if (!config.mcp_servers || !config.mcp_servers[serverName]) {
      return { error: `Server not found: ${serverName}` };
    }

    // Set enabled state
    config.mcp_servers[serverName].enabled = enabled;

    // Serialize and write back
    const tomlContent = serializeToml(config);
    writeFileSync(CODEX_CONFIG_PATH, tomlContent, 'utf8');

    return { success: true };
  } catch (error: unknown) {
    console.error('Error toggling Codex MCP server:', error);
    return { error: (error as Error).message };
  }
}

// ========================================
// Helper Functions
// ========================================

/**
 * Get enterprise managed MCP path (platform-specific)
 */
function getEnterpriseMcpPath(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-mcp.json';
  } else if (platform === 'win32') {
    return 'C:\\Program Files\\ClaudeCode\\managed-mcp.json';
  } else {
    // Linux and WSL
    return '/etc/claude-code/managed-mcp.json';
  }
}

/**
 * Safely read and parse JSON file
 */
function safeReadJson(filePath: string): any | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get MCP servers from a JSON file (expects mcpServers key at top level)
 * @param {string} filePath
 * @returns {Object} mcpServers object or empty object
 */
function getMcpServersFromFile(filePath: string): Record<string, unknown> {
  const config = safeReadJson(filePath) as { mcpServers?: Record<string, unknown> } | null;
  if (!config) return {};
  return config.mcpServers || {};
}

/**
 * Add or update MCP server in project's .mcp.json file
 * @param {string} projectPath - Project directory path
 * @param {string} serverName - MCP server name
 * @param {Object} serverConfig - MCP server configuration
 * @returns {Object} Result with success/error
 */
function addMcpServerToMcpJson(projectPath: string, serverName: string, serverConfig: unknown) {
  try {
    const normalizedPath = normalizePathForFileSystem(projectPath);
    const mcpJsonPath = join(normalizedPath, '.mcp.json');
    
    // Read existing .mcp.json or create new structure
    let mcpJson = safeReadJson(mcpJsonPath) || { mcpServers: {} };
    
    // Ensure mcpServers exists
    if (!mcpJson.mcpServers) {
      mcpJson.mcpServers = {};
    }
    
    // Add or update the server
    mcpJson.mcpServers[serverName] = serverConfig;
    
    // Write back to .mcp.json
    writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2), 'utf8');
    
    return {
      success: true,
      serverName,
      serverConfig,
      scope: 'project-mcp-json',
      path: mcpJsonPath
    };
  } catch (error: unknown) {
    console.error('Error adding MCP server to .mcp.json:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Remove MCP server from project's .mcp.json file
 * @param {string} projectPath - Project directory path
 * @param {string} serverName - MCP server name
 * @returns {Object} Result with success/error
 */
function removeMcpServerFromMcpJson(projectPath: string, serverName: string) {
  try {
    const normalizedPath = normalizePathForFileSystem(projectPath);
    const mcpJsonPath = join(normalizedPath, '.mcp.json');
    
    if (!existsSync(mcpJsonPath)) {
      return { error: '.mcp.json not found' };
    }
    
    const mcpJson = safeReadJson(mcpJsonPath);
    if (!mcpJson || !mcpJson.mcpServers || !mcpJson.mcpServers[serverName]) {
      return { error: `Server not found: ${serverName}` };
    }
    
    // Remove the server
    delete mcpJson.mcpServers[serverName];
    
    // Write back to .mcp.json
    writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2), 'utf8');
    
    return {
      success: true,
      serverName,
      removed: true,
      scope: 'project-mcp-json'
    };
  } catch (error: unknown) {
    console.error('Error removing MCP server from .mcp.json:', error);
    return { error: (error as Error).message };
  }
}

type McpServerConfig = Record<string, unknown>;
type McpServers = Record<string, McpServerConfig>;
type ProjectConfig = {
  mcpServers?: McpServers;
  mcpJsonPath?: string;
  hasMcpJson?: boolean;
  [key: string]: unknown;
};
type ProjectsConfig = Record<string, ProjectConfig>;
type ConfigSource = { type: string; path: string; count: number };

interface McpConfig {
  projects: ProjectsConfig;
  userServers: McpServers;
  enterpriseServers: McpServers;
  globalServers: McpServers;
  configSources: ConfigSource[];
  error?: string;
}

/**
 * Get MCP configuration from multiple sources (per official Claude Code docs):
 *
 * Priority (highest to lowest):
 * 1. Enterprise managed-mcp.json (cannot be overridden)
 * 2. Local scope (project-specific private in ~/.claude.json)
 * 3. Project scope (.mcp.json in project root)
 * 4. User scope (mcpServers in ~/.claude.json)
 *
 * Note: ~/.claude/settings.json is for MCP PERMISSIONS, NOT definitions!
 *
 * @returns {Object}
 */
function getMcpConfig(): McpConfig {
  try {
    const result: McpConfig = {
      projects: {},
      userServers: {},        // User-level servers from ~/.claude.json mcpServers
      enterpriseServers: {},  // Enterprise managed servers (highest priority)
      globalServers: {},      // Merged user + enterprise
      configSources: []       // Track where configs came from for debugging
    };

    // 1. Read Enterprise managed MCP servers (highest priority)
    const enterprisePath = getEnterpriseMcpPath();
    if (existsSync(enterprisePath)) {
      const enterpriseConfig = safeReadJson(enterprisePath);
      if (enterpriseConfig?.mcpServers) {
        result.enterpriseServers = enterpriseConfig.mcpServers;
        result.configSources.push({ type: 'enterprise', path: enterprisePath, count: Object.keys(enterpriseConfig.mcpServers).length });
      }
    }

    // 2. Read from ~/.claude.json
    if (existsSync(CLAUDE_CONFIG_PATH)) {
      const claudeConfig = safeReadJson(CLAUDE_CONFIG_PATH);
      if (claudeConfig) {
        // 2a. User-level mcpServers (top-level mcpServers key)
        if (claudeConfig.mcpServers) {
          result.userServers = claudeConfig.mcpServers;
          result.configSources.push({ type: 'user', path: CLAUDE_CONFIG_PATH, count: Object.keys(claudeConfig.mcpServers).length });
        }

        // 2b. Project-specific configurations (projects[path].mcpServers)
        if (claudeConfig.projects) {
          result.projects = claudeConfig.projects;
        }
      }
    }

    // 3. For each known project, check for .mcp.json (project-level config)
    // .mcp.json is now the PRIMARY source for project-level MCP servers
    const projectPaths = Object.keys(result.projects);
    for (const projectPath of projectPaths) {
      const mcpJsonPath = join(projectPath, '.mcp.json');
      if (existsSync(mcpJsonPath)) {
        const mcpJsonConfig = safeReadJson(mcpJsonPath);
        if (mcpJsonConfig?.mcpServers) {
          // Merge .mcp.json servers into project config
          // .mcp.json has HIGHER priority than ~/.claude.json projects[path].mcpServers
          const existingServers = result.projects[projectPath]?.mcpServers || {};
          result.projects[projectPath] = {
            ...result.projects[projectPath],
            mcpServers: {
              ...existingServers,             // ~/.claude.json projects[path] (lower priority, legacy)
              ...mcpJsonConfig.mcpServers     // .mcp.json (higher priority, new default)
            },
            mcpJsonPath: mcpJsonPath,  // Track source for debugging
            hasMcpJson: true
          };
          result.configSources.push({ 
            type: 'project-mcp-json', 
            path: mcpJsonPath, 
            count: Object.keys(mcpJsonConfig.mcpServers).length 
          });
        }
      }
    }

    // Build globalServers by merging user and enterprise servers
    // Enterprise servers override user servers
    result.globalServers = {
      ...result.userServers,
      ...result.enterpriseServers
    };

    return result;
  } catch (error: unknown) {
    console.error('Error reading MCP config:', error);
    return {
      projects: {},
      globalServers: {},
      userServers: {},
      enterpriseServers: {},
      configSources: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Normalize path to filesystem format (for accessing .mcp.json files)
 * Always uses forward slashes for cross-platform compatibility
 * @param {string} path
 * @returns {string}
 */
function normalizePathForFileSystem(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  
  // Handle /d/path format -> D:/path
  if (normalized.match(/^\/[a-zA-Z]\//)) {
    normalized = normalized.charAt(1).toUpperCase() + ':' + normalized.slice(2);
  }
  
  return normalized;
}

/**
 * Normalize project path to match existing format in .claude.json
 * Checks both forward slash and backslash formats to find existing entry
 * @param {string} path
 * @param {Object} claudeConfig - Optional existing config to check format
 * @returns {string}
 */
function normalizeProjectPathForConfig(path: string, claudeConfig: unknown = null): string {
  // IMPORTANT: Always normalize to forward slashes to prevent duplicate entries
  // (e.g., prevents both "D:/Claude_dms3" and "D:\\Claude_dms3")
  let normalizedForward = path.replace(/\\/g, '/');

  // Handle /d/path format -> D:/path
  if (normalizedForward.match(/^\/[a-zA-Z]\//)) {
    normalizedForward = normalizedForward.charAt(1).toUpperCase() + ':' + normalizedForward.slice(2);
  }

  // ALWAYS return forward slash format to prevent duplicates
  return normalizedForward;
}

/**
 * Toggle MCP server enabled/disabled
 * @param {string} projectPath
 * @param {string} serverName
 * @param {boolean} enable
 * @returns {Object}
 */
function toggleMcpServerEnabled(projectPath: string, serverName: string, enable: boolean) {
  try {
    if (!existsSync(CLAUDE_CONFIG_PATH)) {
      return { error: '.claude.json not found' };
    }

    const content = readFileSync(CLAUDE_CONFIG_PATH, 'utf8');
    const config = JSON.parse(content);

    const normalizedPath = normalizeProjectPathForConfig(projectPath, config);

    if (!config.projects || !config.projects[normalizedPath]) {
      return { error: `Project not found: ${normalizedPath}` };
    }

    const projectConfig = config.projects[normalizedPath];

    // Ensure disabledMcpServers array exists
    if (!projectConfig.disabledMcpServers) {
      projectConfig.disabledMcpServers = [];
    }

    if (enable) {
      // Remove from disabled list
      projectConfig.disabledMcpServers = projectConfig.disabledMcpServers.filter((s: string) => s !== serverName);
    } else {
      // Add to disabled list if not already there
      if (!projectConfig.disabledMcpServers.includes(serverName)) {
        projectConfig.disabledMcpServers.push(serverName);
      }
    }

    // Write back to file
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    return {
      success: true,
      serverName,
      enabled: enable,
      disabledMcpServers: projectConfig.disabledMcpServers
    };
  } catch (error: unknown) {
    console.error('Error toggling MCP server:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Add MCP server to project
 * Now defaults to using .mcp.json instead of .claude.json
 * @param {string} projectPath
 * @param {string} serverName
 * @param {Object} serverConfig
 * @param {boolean} useLegacyConfig - If true, use .claude.json instead of .mcp.json
 * @returns {Object}
 */
function addMcpServerToProject(projectPath: string, serverName: string, serverConfig: unknown, useLegacyConfig: boolean = false) {
  try {
    // Default: Use .mcp.json for project-level MCP servers
    if (!useLegacyConfig) {
      return addMcpServerToMcpJson(projectPath, serverName, serverConfig);
    }

    // Legacy: Use .claude.json (kept for backward compatibility)
    if (!existsSync(CLAUDE_CONFIG_PATH)) {
      return { error: '.claude.json not found' };
    }

    const content = readFileSync(CLAUDE_CONFIG_PATH, 'utf8');
    const config = JSON.parse(content);

    const normalizedPath = normalizeProjectPathForConfig(projectPath, config);

    // Create project entry if it doesn't exist
    if (!config.projects) {
      config.projects = {};
    }

    if (!config.projects[normalizedPath]) {
      config.projects[normalizedPath] = {
        allowedTools: [],
        mcpContextUris: [],
        mcpServers: {},
        enabledMcpjsonServers: [],
        disabledMcpjsonServers: [],
        hasTrustDialogAccepted: false,
        projectOnboardingSeenCount: 0,
        hasClaudeMdExternalIncludesApproved: false,
        hasClaudeMdExternalIncludesWarningShown: false
      };
    }

    const projectConfig = config.projects[normalizedPath];

    // Ensure mcpServers exists
    if (!projectConfig.mcpServers) {
      projectConfig.mcpServers = {};
    }

    // Add the server
    projectConfig.mcpServers[serverName] = serverConfig;

    // Write back to file
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    return {
      success: true,
      serverName,
      serverConfig,
      scope: 'project-legacy'
    };
  } catch (error: unknown) {
    console.error('Error adding MCP server:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Remove MCP server from project
 * Checks both .mcp.json and .claude.json
 * @param {string} projectPath
 * @param {string} serverName
 * @returns {Object}
 */
function removeMcpServerFromProject(projectPath: string, serverName: string) {
  try {
    const normalizedPathForFile = normalizePathForFileSystem(projectPath);
    const mcpJsonPath = join(normalizedPathForFile, '.mcp.json');
    
    let removedFromMcpJson = false;
    let removedFromClaudeJson = false;
    
    // Try to remove from .mcp.json first (new default)
    if (existsSync(mcpJsonPath)) {
      const mcpJson = safeReadJson(mcpJsonPath);
      if (mcpJson?.mcpServers?.[serverName]) {
        const result = removeMcpServerFromMcpJson(projectPath, serverName);
        if (result.success) {
          removedFromMcpJson = true;
        }
      }
    }

    // Also try to remove from .claude.json (legacy - may coexist)
    if (existsSync(CLAUDE_CONFIG_PATH)) {
      const content = readFileSync(CLAUDE_CONFIG_PATH, 'utf8');
      const config = JSON.parse(content);

      // Get normalized path that matches existing config format
      const normalizedPath = normalizeProjectPathForConfig(projectPath, config);

      if (config.projects && config.projects[normalizedPath]) {
        const projectConfig = config.projects[normalizedPath];

        if (projectConfig.mcpServers && projectConfig.mcpServers[serverName]) {
          // Remove the server
          delete projectConfig.mcpServers[serverName];

          // Also remove from disabled list if present
          if (projectConfig.disabledMcpServers) {
            projectConfig.disabledMcpServers = projectConfig.disabledMcpServers.filter((s: string) => s !== serverName);
          }

          // Write back to file
          writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
          removedFromClaudeJson = true;
        }
      }
    }

    // Return success if removed from either location
    if (removedFromMcpJson || removedFromClaudeJson) {
      return {
        success: true,
        serverName,
        removed: true,
        scope: removedFromMcpJson ? 'project-mcp-json' : 'project-legacy',
        removedFrom: removedFromMcpJson && removedFromClaudeJson ? 'both' : 
                     removedFromMcpJson ? '.mcp.json' : '.claude.json'
      };
    }

    return { error: `Server not found: ${serverName}` };
  } catch (error: unknown) {
    console.error('Error removing MCP server:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Add MCP server to global/user scope (top-level mcpServers in ~/.claude.json)
 * @param {string} serverName
 * @param {Object} serverConfig
 * @returns {Object}
 */
function addGlobalMcpServer(serverName: string, serverConfig: unknown) {
  try {
    if (!existsSync(CLAUDE_CONFIG_PATH)) {
      return { error: '.claude.json not found' };
    }

    const content = readFileSync(CLAUDE_CONFIG_PATH, 'utf8');
    const config = JSON.parse(content);

    // Ensure top-level mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add the server to top-level mcpServers
    config.mcpServers[serverName] = serverConfig;

    // Write back to file
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    return {
      success: true,
      serverName,
      serverConfig,
      scope: 'global'
    };
  } catch (error: unknown) {
    console.error('Error adding global MCP server:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Remove MCP server from global/user scope (top-level mcpServers)
 * @param {string} serverName
 * @returns {Object}
 */
function removeGlobalMcpServer(serverName: string) {
  try {
    if (!existsSync(CLAUDE_CONFIG_PATH)) {
      return { error: '.claude.json not found' };
    }

    const content = readFileSync(CLAUDE_CONFIG_PATH, 'utf8');
    const config = JSON.parse(content);

    if (!config.mcpServers || !config.mcpServers[serverName]) {
      return { error: `Global server not found: ${serverName}` };
    }

    // Remove the server from top-level mcpServers
    delete config.mcpServers[serverName];

    // Write back to file
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    return {
      success: true,
      serverName,
      removed: true,
      scope: 'global'
    };
  } catch (error: unknown) {
    console.error('Error removing global MCP server:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Read settings file safely
 * @param {string} filePath
 * @returns {Object}
 */
function readSettingsFile(filePath: string) {
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error: unknown) {
    console.error(`Error reading settings file ${filePath}:`, error);
    return {};
  }
}

/**
 * Write settings file safely
 * @param {string} filePath
 * @param {Object} settings
 */
function writeSettingsFile(filePath: string, settings: any) {
  const dirPath = dirname(filePath);
  // Ensure directory exists
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
}

/**
 * Get project settings path
 * @param {string} projectPath
 * @returns {string}
 */
function getProjectSettingsPath(projectPath: string): string {
  // path.join automatically handles cross-platform path separators
  return join(projectPath, '.claude', 'settings.json');
}

// ========================================
// Route Handlers
// ========================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Handle MCP routes
 * @returns true if route was handled, false otherwise
 */
export async function handleMcpRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest, broadcastToClients } = ctx;

  // API: Get MCP configuration (includes both Claude and Codex)
  if (pathname === '/api/mcp-config') {
    const mcpData = getMcpConfig();
    const codexData = getCodexMcpConfig();
    const combinedData = {
      ...mcpData,
      codex: codexData
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(combinedData));
    return true;
  }

  // ========================================
  // Codex MCP API Endpoints
  // ========================================

  // API: Get Codex MCP configuration
  if (pathname === '/api/codex-mcp-config') {
    const codexData = getCodexMcpConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(codexData));
    return true;
  }

  // API: Add Codex MCP server
  if (pathname === '/api/codex-mcp-add' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const serverName = body.serverName;
      const serverConfig = body.serverConfig;

      if (typeof serverName !== 'string' || !serverName.trim()) {
        return { error: 'serverName is required', status: 400 };
      }

      if (!isRecord(serverConfig)) {
        return { error: 'serverConfig is required', status: 400 };
      }

      return addCodexMcpServer(serverName, serverConfig as Record<string, any>);
    });
    return true;
  }

  // API: Remove Codex MCP server
  if (pathname === '/api/codex-mcp-remove' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const serverName = body.serverName;
      if (typeof serverName !== 'string' || !serverName.trim()) {
        return { error: 'serverName is required', status: 400 };
      }
      return removeCodexMcpServer(serverName);
    });
    return true;
  }

  // API: Toggle Codex MCP server enabled state
  if (pathname === '/api/codex-mcp-toggle' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const serverName = body.serverName;
      const enabled = body.enabled;

      if (typeof serverName !== 'string' || !serverName.trim() || typeof enabled !== 'boolean') {
        return { error: 'serverName and enabled are required', status: 400 };
      }
      return toggleCodexMcpServer(serverName, enabled);
    });
    return true;
  }

  // API: Toggle MCP server enabled/disabled
  if (pathname === '/api/mcp-toggle' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const projectPath = body.projectPath;
      const serverName = body.serverName;
      const enable = body.enable;

      if (typeof projectPath !== 'string' || !projectPath.trim() || typeof serverName !== 'string' || !serverName.trim() || typeof enable !== 'boolean') {
        return { error: 'projectPath, serverName, and enable are required', status: 400 };
      }
      return toggleMcpServerEnabled(projectPath, serverName, enable);
    });
    return true;
  }

  // API: Copy MCP server to project
  if (pathname === '/api/mcp-copy-server' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const projectPath = body.projectPath;
      const serverName = body.serverName;
      const serverConfig = body.serverConfig;
      const configType = body.configType;

      if (typeof projectPath !== 'string' || !projectPath.trim() || typeof serverName !== 'string' || !serverName.trim() || serverConfig === undefined || serverConfig === null) {
        return { error: 'projectPath, serverName, and serverConfig are required', status: 400 };
      }
      // configType: 'mcp' = use .mcp.json (default), 'claude' = use .claude.json
      const useLegacyConfig = configType === 'claude';
      return addMcpServerToProject(projectPath, serverName, serverConfig, useLegacyConfig);
    });
    return true;
  }

  // API: Install CCW MCP server to project
  if (pathname === '/api/mcp-install-ccw' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const projectPath = body.projectPath;
      if (typeof projectPath !== 'string' || !projectPath.trim()) {
        return { error: 'projectPath is required', status: 400 };
      }

      // Generate CCW MCP server config
      // Use cmd /c to inherit Claude Code's working directory
      const ccwMcpConfig = {
        command: "cmd",
        args: ["/c", "npx", "-y", "ccw-mcp"],
        env: {
          CCW_ENABLED_TOOLS: "all"
        }
      };

      // Use existing addMcpServerToProject to install CCW MCP
      return addMcpServerToProject(projectPath, 'ccw-tools', ccwMcpConfig);
    });
    return true;
  }

  // API: Remove MCP server from project
  if (pathname === '/api/mcp-remove-server' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const projectPath = body.projectPath;
      const serverName = body.serverName;
      if (typeof projectPath !== 'string' || !projectPath.trim() || typeof serverName !== 'string' || !serverName.trim()) {
        return { error: 'projectPath and serverName are required', status: 400 };
      }
      return removeMcpServerFromProject(projectPath, serverName);
    });
    return true;
  }

  // API: Add MCP server to global scope (top-level mcpServers in ~/.claude.json)
  if (pathname === '/api/mcp-add-global-server' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const serverName = body.serverName;
      const serverConfig = body.serverConfig;
      if (typeof serverName !== 'string' || !serverName.trim() || serverConfig === undefined || serverConfig === null) {
        return { error: 'serverName and serverConfig are required', status: 400 };
      }
      return addGlobalMcpServer(serverName, serverConfig);
    });
    return true;
  }

  // API: Remove MCP server from global scope
  if (pathname === '/api/mcp-remove-global-server' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const serverName = body.serverName;
      if (typeof serverName !== 'string' || !serverName.trim()) {
        return { error: 'serverName is required', status: 400 };
      }
      return removeGlobalMcpServer(serverName);
    });
    return true;
  }

  // ========================================
  // MCP Templates API
  // ========================================

  // API: Get all MCP templates
  if (pathname === '/api/mcp-templates' && req.method === 'GET') {
    const templates = McpTemplatesDb.getAllTemplates();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, templates }));
    return true;
  }

  // API: Save MCP template
  if (pathname === '/api/mcp-templates' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const name = body.name;
      const serverConfig = body.serverConfig;

      if (typeof name !== 'string' || !name.trim()) {
        return { error: 'name is required', status: 400 };
      }

      if (!isRecord(serverConfig) || typeof serverConfig.command !== 'string') {
        return { error: 'serverConfig with command is required', status: 400 };
      }

      const description = typeof body.description === 'string' ? body.description : undefined;
      const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined;
      const category = typeof body.category === 'string' ? body.category : undefined;

      return McpTemplatesDb.saveTemplate({
        name,
        description,
        serverConfig: serverConfig as McpTemplatesDb.McpTemplate['serverConfig'],
        tags,
        category
      });
    });
    return true;
  }

  // API: Get template by name
  if (pathname.startsWith('/api/mcp-templates/') && req.method === 'GET') {
    const templateName = decodeURIComponent(pathname.split('/api/mcp-templates/')[1]);
    const template = McpTemplatesDb.getTemplateByName(templateName);
    if (template) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, template }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Template not found' }));
    }
    return true;
  }

  // API: Delete MCP template
  if (pathname.startsWith('/api/mcp-templates/') && req.method === 'DELETE') {
    const templateName = decodeURIComponent(pathname.split('/api/mcp-templates/')[1]);
    const result = McpTemplatesDb.deleteTemplate(templateName);
    res.writeHead(result.success ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  }

  // API: Search MCP templates
  if (pathname === '/api/mcp-templates/search' && req.method === 'GET') {
    const keyword = url.searchParams.get('q') || '';
    const templates = McpTemplatesDb.searchTemplates(keyword);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, templates }));
    return true;
  }

  // API: Get all categories
  if (pathname === '/api/mcp-templates/categories' && req.method === 'GET') {
    const categories = McpTemplatesDb.getAllCategories();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, categories }));
    return true;
  }

  // API: Get templates by category
  if (pathname.startsWith('/api/mcp-templates/category/') && req.method === 'GET') {
    const category = decodeURIComponent(pathname.split('/api/mcp-templates/category/')[1]);
    const templates = McpTemplatesDb.getTemplatesByCategory(category);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, templates }));
    return true;
  }

  // API: Install template to project or global
  if (pathname === '/api/mcp-templates/install' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (!isRecord(body)) {
        return { error: 'Invalid request body', status: 400 };
      }

      const templateName = body.templateName;
      const projectPath = body.projectPath;
      const scope = body.scope;

      if (typeof templateName !== 'string' || !templateName.trim()) {
        return { error: 'templateName is required', status: 400 };
      }

      const template = McpTemplatesDb.getTemplateByName(templateName);
      if (!template) {
        return { error: 'Template not found', status: 404 };
      }

      // Install to global or project
      if (scope === 'global') {
        return addGlobalMcpServer(templateName, template.serverConfig);
      } else {
        if (typeof projectPath !== 'string' || !projectPath.trim()) {
          return { error: 'projectPath is required for project scope', status: 400 };
        }
        return addMcpServerToProject(projectPath, templateName, template.serverConfig);
      }
    });
    return true;
  }

  return false;
}
