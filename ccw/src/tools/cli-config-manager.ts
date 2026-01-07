/**
 * CLI Configuration Manager
 * Handles loading, saving, and managing CLI tool configurations
 * Stores config in centralized storage (~/.ccw/projects/{id}/config/)
 */
import * as fs from 'fs';
import * as path from 'path';
import { StoragePaths, ensureStorageDir } from '../config/storage-paths.js';

// ========== Types ==========

export interface CliToolConfig {
  enabled: boolean;
  primaryModel: string;      // For CLI endpoint calls (ccw cli -p)
  secondaryModel: string;    // For internal calls (llm_enhancer, generate_module_docs)
}

export interface CliConfig {
  version: number;
  tools: Record<string, CliToolConfig>;
}

export type CliToolName = 'gemini' | 'qwen' | 'codex' | 'claude';

// ========== Constants ==========

export const PREDEFINED_MODELS: Record<CliToolName, string[]> = {
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  qwen: ['coder-model', 'vision-model', 'qwen2.5-coder-32b'],
  codex: ['gpt-5.2', 'gpt-4.1', 'o4-mini', 'o3'],
  claude: ['sonnet', 'opus', 'haiku', 'claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101']
};

export const DEFAULT_CONFIG: CliConfig = {
  version: 1,
  tools: {
    gemini: {
      enabled: true,
      primaryModel: 'gemini-2.5-pro',
      secondaryModel: 'gemini-2.5-flash'
    },
    qwen: {
      enabled: true,
      primaryModel: 'coder-model',
      secondaryModel: 'coder-model'
    },
    codex: {
      enabled: true,
      primaryModel: 'gpt-5.2',
      secondaryModel: 'gpt-5.2'
    },
    claude: {
      enabled: true,
      primaryModel: 'sonnet',
      secondaryModel: 'haiku'
    }
  }
};

// ========== Helper Functions ==========

function getConfigPath(baseDir: string): string {
  return StoragePaths.project(baseDir).cliConfig;
}

function ensureConfigDirForProject(baseDir: string): void {
  const configDir = StoragePaths.project(baseDir).config;
  ensureStorageDir(configDir);
}

function isValidToolName(tool: string): tool is CliToolName {
  return ['gemini', 'qwen', 'codex', 'claude'].includes(tool);
}

function validateConfig(config: unknown): config is CliConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;

  if (typeof c.version !== 'number') return false;
  if (!c.tools || typeof c.tools !== 'object') return false;

  const tools = c.tools as Record<string, unknown>;
  for (const toolName of ['gemini', 'qwen', 'codex', 'claude']) {
    const tool = tools[toolName];
    if (!tool || typeof tool !== 'object') return false;

    const t = tool as Record<string, unknown>;
    if (typeof t.enabled !== 'boolean') return false;
    if (typeof t.primaryModel !== 'string') return false;
    if (typeof t.secondaryModel !== 'string') return false;
  }

  return true;
}

function mergeWithDefaults(config: Partial<CliConfig>): CliConfig {
  const result: CliConfig = {
    version: config.version ?? DEFAULT_CONFIG.version,
    tools: { ...DEFAULT_CONFIG.tools }
  };

  if (config.tools) {
    for (const toolName of Object.keys(config.tools)) {
      if (isValidToolName(toolName) && config.tools[toolName]) {
        result.tools[toolName] = {
          ...DEFAULT_CONFIG.tools[toolName],
          ...config.tools[toolName]
        };
      }
    }
  }

  return result;
}

// ========== Main Functions ==========

/**
 * Load CLI configuration from .workflow/cli-config.json
 * Returns default config if file doesn't exist or is invalid
 */
export function loadCliConfig(baseDir: string): CliConfig {
  const configPath = getConfigPath(baseDir);

  try {
    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (validateConfig(parsed)) {
      return mergeWithDefaults(parsed);
    }

    // Invalid config, return defaults
    console.warn('[cli-config] Invalid config file, using defaults');
    return { ...DEFAULT_CONFIG };
  } catch (err) {
    console.error('[cli-config] Error loading config:', err);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save CLI configuration to .workflow/cli-config.json
 */
export function saveCliConfig(baseDir: string, config: CliConfig): void {
  ensureConfigDirForProject(baseDir);
  const configPath = getConfigPath(baseDir);

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[cli-config] Error saving config:', err);
    throw new Error(`Failed to save CLI config: ${err}`);
  }
}

/**
 * Get configuration for a specific tool
 */
export function getToolConfig(baseDir: string, tool: string): CliToolConfig {
  if (!isValidToolName(tool)) {
    throw new Error(`Invalid tool name: ${tool}`);
  }

  const config = loadCliConfig(baseDir);
  return config.tools[tool] || DEFAULT_CONFIG.tools[tool];
}

/**
 * Update configuration for a specific tool
 * Returns the updated tool config
 */
export function updateToolConfig(
  baseDir: string,
  tool: string,
  updates: Partial<CliToolConfig>
): CliToolConfig {
  if (!isValidToolName(tool)) {
    throw new Error(`Invalid tool name: ${tool}`);
  }

  const config = loadCliConfig(baseDir);
  const currentToolConfig = config.tools[tool] || DEFAULT_CONFIG.tools[tool];

  // Apply updates
  const updatedToolConfig: CliToolConfig = {
    enabled: updates.enabled !== undefined ? updates.enabled : currentToolConfig.enabled,
    primaryModel: updates.primaryModel || currentToolConfig.primaryModel,
    secondaryModel: updates.secondaryModel || currentToolConfig.secondaryModel
  };

  // Save updated config
  config.tools[tool] = updatedToolConfig;
  saveCliConfig(baseDir, config);

  return updatedToolConfig;
}

/**
 * Enable a CLI tool
 */
export function enableTool(baseDir: string, tool: string): CliToolConfig {
  return updateToolConfig(baseDir, tool, { enabled: true });
}

/**
 * Disable a CLI tool
 */
export function disableTool(baseDir: string, tool: string): CliToolConfig {
  return updateToolConfig(baseDir, tool, { enabled: false });
}

/**
 * Check if a tool is enabled
 */
export function isToolEnabled(baseDir: string, tool: string): boolean {
  try {
    const config = getToolConfig(baseDir, tool);
    return config.enabled;
  } catch {
    return true; // Default to enabled if error
  }
}

/**
 * Get primary model for a tool
 */
export function getPrimaryModel(baseDir: string, tool: string): string {
  try {
    const config = getToolConfig(baseDir, tool);
    return config.primaryModel;
  } catch {
    return isValidToolName(tool) ? DEFAULT_CONFIG.tools[tool].primaryModel : 'gemini-2.5-pro';
  }
}

/**
 * Get secondary model for a tool (used for internal calls)
 */
export function getSecondaryModel(baseDir: string, tool: string): string {
  try {
    const config = getToolConfig(baseDir, tool);
    return config.secondaryModel;
  } catch {
    return isValidToolName(tool) ? DEFAULT_CONFIG.tools[tool].secondaryModel : 'gemini-2.5-flash';
  }
}

/**
 * Get all predefined models for a tool
 */
export function getPredefinedModels(tool: string): string[] {
  if (!isValidToolName(tool)) {
    return [];
  }
  return [...PREDEFINED_MODELS[tool]];
}

/**
 * Get full config response for API (includes predefined models)
 */
export function getFullConfigResponse(baseDir: string): {
  config: CliConfig;
  predefinedModels: Record<string, string[]>;
} {
  return {
    config: loadCliConfig(baseDir),
    predefinedModels: { ...PREDEFINED_MODELS }
  };
}
