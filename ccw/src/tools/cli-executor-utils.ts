import { spawn } from 'child_process';

// Debug logging utility - check env at runtime for --debug flag support
export function isDebugEnabled(): boolean {
  return process.env.DEBUG === 'true' || process.env.DEBUG === '1' || process.env.CCW_DEBUG === 'true';
}

export function debugLog(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [CLI-DEBUG] [${category}]`;
  if (data) {
    console.error(`${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.error(`${prefix} ${message}`);
  }
}

export function errorLog(
  category: string,
  message: string,
  error?: Error | unknown,
  context?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [CLI-ERROR] [${category}]`;
  console.error(`${prefix} ${message}`);
  if (error instanceof Error) {
    console.error(`${prefix} Error: ${error.message}`);
    if (isDebugEnabled() && error.stack) {
      console.error(`${prefix} Stack: ${error.stack}`);
    }
  } else if (error) {
    console.error(`${prefix} Error: ${String(error)}`);
  }
  if (context) {
    console.error(`${prefix} Context:`, JSON.stringify(context, null, 2));
  }
}

export interface ToolAvailability {
  available: boolean;
  path: string | null;
}

// Tool availability cache with TTL
interface CachedToolAvailability {
  result: ToolAvailability;
  timestamp: number;
}

// Cache storage: Map<toolName, CachedToolAvailability>
const toolAvailabilityCache = new Map<string, CachedToolAvailability>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isCacheValid(cached: CachedToolAvailability): boolean {
  return Date.now() - cached.timestamp < CACHE_TTL_MS;
}

function clearExpiredCache(): void {
  const now = Date.now();
  const entriesToDelete: string[] = [];

  toolAvailabilityCache.forEach((cached, tool) => {
    if (now - cached.timestamp >= CACHE_TTL_MS) {
      entriesToDelete.push(tool);
    }
  });

  entriesToDelete.forEach((tool) => toolAvailabilityCache.delete(tool));
}

export function clearToolCache(): void {
  toolAvailabilityCache.clear();
}

/**
 * Check if a CLI tool is available (with caching)
 */
export async function checkToolAvailability(tool: string): Promise<ToolAvailability> {
  debugLog('TOOL_CHECK', `Checking availability for tool: ${tool}`);

  const cached = toolAvailabilityCache.get(tool);
  if (cached && isCacheValid(cached)) {
    debugLog('TOOL_CHECK', `Cache hit for ${tool}`, { available: cached.result.available, path: cached.result.path });
    return cached.result;
  }

  clearExpiredCache();

  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'where' : 'which';

    debugLog('TOOL_CHECK', `Running ${command} ${tool}`, { platform: process.platform });

    const child = spawn(command, [tool], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const result: ToolAvailability = code === 0 && stdout.trim()
        ? { available: true, path: stdout.trim().split('\n')[0] }
        : { available: false, path: null };

      if (result.available) {
        debugLog('TOOL_CHECK', `Tool ${tool} found`, { path: result.path });
        toolAvailabilityCache.set(tool, {
          result,
          timestamp: Date.now(),
        });
      } else {
        debugLog('TOOL_CHECK', `Tool ${tool} not found`, { exitCode: code, stderr: stderr.trim() || '(empty)' });
      }

      resolve(result);
    });

    child.on('error', (error) => {
      errorLog('TOOL_CHECK', `Failed to check tool availability: ${tool}`, error, { command, tool });
      resolve({ available: false, path: null });
    });

    setTimeout(() => {
      child.kill();
      debugLog('TOOL_CHECK', `Timeout checking tool ${tool} (5s)`);
      resolve({ available: false, path: null });
    }, 5000);
  });
}

// Native resume configuration
export interface NativeResumeConfig {
  enabled: boolean;
  sessionId?: string; // Native UUID
  isLatest?: boolean; // Use latest/--last flag
}

/**
 * Build command arguments based on tool and options
 */
export function buildCommand(params: {
  tool: string;
  prompt: string;
  mode: string;
  model?: string;
  dir?: string;
  include?: string;
  nativeResume?: NativeResumeConfig;
}): { command: string; args: string[]; useStdin: boolean } {
  const { tool, prompt, mode = 'analysis', model, dir, include, nativeResume } = params;

  debugLog('BUILD_CMD', `Building command for tool: ${tool}`, {
    mode,
    model: model || '(default)',
    dir: dir || '(cwd)',
    include: include || '(none)',
    nativeResume: nativeResume
      ? { enabled: nativeResume.enabled, isLatest: nativeResume.isLatest, sessionId: nativeResume.sessionId }
      : '(none)',
    promptLength: prompt.length,
  });

  let command = tool;
  let args: string[] = [];
  // Default to stdin for all tools to avoid escaping issues on Windows
  let useStdin = true;

  switch (tool) {
    case 'gemini':
      if (nativeResume?.enabled) {
        if (nativeResume.isLatest) {
          args.push('-r', 'latest');
        } else if (nativeResume.sessionId) {
          args.push('-r', nativeResume.sessionId);
        }
      }
      if (model) {
        args.push('-m', model);
      }
      if (mode === 'write') {
        args.push('--approval-mode', 'yolo');
      }
      if (include) {
        args.push('--include-directories', include);
      }
      break;

    case 'qwen':
      if (nativeResume?.enabled) {
        if (nativeResume.isLatest) {
          args.push('--continue');
        } else if (nativeResume.sessionId) {
          args.push('--resume', nativeResume.sessionId);
        }
      }
      if (model) {
        args.push('-m', model);
      }
      if (mode === 'write') {
        args.push('--approval-mode', 'yolo');
      }
      if (include) {
        args.push('--include-directories', include);
      }
      break;

    case 'codex':
      useStdin = true;
      if (nativeResume?.enabled) {
        args.push('resume');
        if (nativeResume.isLatest) {
          args.push('--last');
        } else if (nativeResume.sessionId) {
          args.push(nativeResume.sessionId);
        }
        if (mode === 'write' || mode === 'auto') {
          args.push('--dangerously-bypass-approvals-and-sandbox');
        } else {
          args.push('--full-auto');
        }
        if (model) {
          args.push('-m', model);
        }
        if (include) {
          const dirs = include.split(',').map((d) => d.trim()).filter((d) => d);
          for (const addDir of dirs) {
            args.push('--add-dir', addDir);
          }
        }
        args.push('-');
      } else {
        args.push('exec');
        if (mode === 'write' || mode === 'auto') {
          args.push('--dangerously-bypass-approvals-and-sandbox');
        } else {
          args.push('--full-auto');
        }
        if (model) {
          args.push('-m', model);
        }
        if (include) {
          const dirs = include.split(',').map((d) => d.trim()).filter((d) => d);
          for (const addDir of dirs) {
            args.push('--add-dir', addDir);
          }
        }
        args.push('-');
      }
      break;

    case 'claude':
      // Claude Code: claude -p "prompt" for non-interactive mode
      args.push('-p'); // Print mode (non-interactive)
      // Native resume: claude --resume <session-id> or --continue
      if (nativeResume?.enabled) {
        if (nativeResume.isLatest) {
          args.push('--continue');
        } else if (nativeResume.sessionId) {
          args.push('--resume', nativeResume.sessionId);
        }
      }
      if (model) {
        args.push('--model', model);
      }
      // Permission modes: write/auto → bypassPermissions, analysis → default
      if (mode === 'write' || mode === 'auto') {
        args.push('--permission-mode', 'bypassPermissions');
      } else {
        args.push('--permission-mode', 'default');
      }
      // Output format for better parsing
      args.push('--output-format', 'text');
      // Add directories
      if (include) {
        const dirs = include.split(',').map((d) => d.trim()).filter((d) => d);
        for (const addDir of dirs) {
          args.push('--add-dir', addDir);
        }
      }
      break;

    default:
      errorLog('BUILD_CMD', `Unknown CLI tool: ${tool}`);
      throw new Error(`Unknown CLI tool: ${tool}`);
  }

  debugLog('BUILD_CMD', `Command built successfully`, {
    command,
    args,
    useStdin,
    fullCommand: `${command} ${args.join(' ')}${useStdin ? ' (stdin)' : ''}`,
  });

  return { command, args, useStdin };
}
