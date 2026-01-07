/**
 * CLI Executor Tool - Unified execution for external CLI tools
 * Supports Gemini, Qwen, and Codex with streaming output
 */

import { z } from 'zod';
import type { ToolSchema, ToolResult } from '../types/tool.js';
import type { HistoryIndexEntry } from './cli-history-store.js';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { validatePath } from '../utils/path-resolver.js';
import { escapeWindowsArg } from '../utils/shell-escape.js';

// Track current running child process for cleanup on interruption
let currentChildProcess: ChildProcess | null = null;
let killTimeout: NodeJS.Timeout | null = null;
let killTimeoutProcess: ChildProcess | null = null;

/**
 * Kill the current running CLI child process
 * Called when parent process receives SIGINT/SIGTERM
 */
export function killCurrentCliProcess(): boolean {
  const child = currentChildProcess;
  if (!child || child.killed) return false;

  debugLog('KILL', 'Killing current child process', { pid: child.pid });

  try {
    child.kill('SIGTERM');
  } catch {
    // Ignore kill errors (process may already be gone)
  }

  if (killTimeout) {
    clearTimeout(killTimeout);
    killTimeout = null;
    killTimeoutProcess = null;
  }

  // Force kill after 2 seconds if still running.
  killTimeoutProcess = child;
  killTimeout = setTimeout(() => {
    const target = killTimeoutProcess;
    if (!target || target !== currentChildProcess) return;
    if (target.killed) return;

    try {
      target.kill('SIGKILL');
    } catch {
      // Ignore kill errors (process may already be gone)
    }
  }, 2000);

  return true;
}

// Debug logging utility - check env at runtime for --debug flag support
function isDebugEnabled(): boolean {
  return process.env.DEBUG === 'true' || process.env.DEBUG === '1' || process.env.CCW_DEBUG === 'true';
}

function debugLog(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [CLI-DEBUG] [${category}]`;
  if (data) {
    console.error(`${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.error(`${prefix} ${message}`);
  }
}

function errorLog(category: string, message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
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

// LiteLLM integration
import { executeLiteLLMEndpoint } from './litellm-executor.js';
import { findEndpointById } from '../config/litellm-api-config-manager.js';

// Native resume support
import {
  trackNewSession,
  getNativeResumeArgs,
  supportsNativeResume,
  calculateProjectHash
} from './native-session-discovery.js';
import {
  determineResumeStrategy,
  buildContextPrefix,
  getResumeModeDescription,
  type ResumeDecision
} from './resume-strategy.js';
import {
  isToolEnabled as isToolEnabledFromConfig,
  enableTool as enableToolFromConfig,
  disableTool as disableToolFromConfig,
  getPrimaryModel
} from './cli-config-manager.js';
import { StoragePaths, ensureStorageDir } from '../config/storage-paths.js';

// Lazy-loaded SQLite store module
let sqliteStoreModule: typeof import('./cli-history-store.js') | null = null;

/**
 * Get or initialize SQLite store (async)
 */
async function getSqliteStore(baseDir: string) {
  if (!sqliteStoreModule) {
    sqliteStoreModule = await import('./cli-history-store.js');
  }
  return sqliteStoreModule.getHistoryStore(baseDir);
}

/**
 * Get SQLite store (sync - uses cached module)
 */
function getSqliteStoreSync(baseDir: string) {
  if (!sqliteStoreModule) {
    throw new Error('SQLite store not initialized. Call an async function first.');
  }
  return sqliteStoreModule.getHistoryStore(baseDir);
}

// Define Zod schema for validation
const ParamsSchema = z.object({
  tool: z.enum(['gemini', 'qwen', 'codex']),
  prompt: z.string().min(1, 'Prompt is required'),
  mode: z.enum(['analysis', 'write', 'auto']).default('analysis'),
  format: z.enum(['plain', 'yaml', 'json']).default('plain'), // Multi-turn prompt concatenation format
  model: z.string().optional(),
  cd: z.string().optional(),
  includeDirs: z.string().optional(),
  timeout: z.number().default(0), // 0 = no internal timeout, controlled by external caller (e.g., bash timeout)
  resume: z.union([z.boolean(), z.string()]).optional(), // true = last, string = single ID or comma-separated IDs
  id: z.string().optional(), // Custom execution ID (e.g., IMPL-001-step1)
  noNative: z.boolean().optional(), // Force prompt concatenation instead of native resume
  category: z.enum(['user', 'internal', 'insight']).default('user'), // Execution category for tracking
  parentExecutionId: z.string().optional(), // Parent execution ID for fork/retry scenarios
  stream: z.boolean().default(false), // false = cache full output (default), true = stream output via callback
});

// Execution category types
export type ExecutionCategory = 'user' | 'internal' | 'insight';

type Params = z.infer<typeof ParamsSchema>;

// Prompt concatenation format types
type PromptFormat = 'plain' | 'yaml' | 'json';

interface ToolAvailability {
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

/**
 * Check if cache entry is still valid
 */
function isCacheValid(cached: CachedToolAvailability): boolean {
  return Date.now() - cached.timestamp < CACHE_TTL_MS;
}

/**
 * Clear expired cache entries
 */
function clearExpiredCache(): void {
  const now = Date.now();
  const entriesToDelete: string[] = [];

  toolAvailabilityCache.forEach((cached, tool) => {
    if (now - cached.timestamp >= CACHE_TTL_MS) {
      entriesToDelete.push(tool);
    }
  });

  entriesToDelete.forEach(tool => toolAvailabilityCache.delete(tool));
}

/**
 * Clear all cache entries (useful for testing or forced refresh)
 */
export function clearToolCache(): void {
  toolAvailabilityCache.clear();
}

// Single turn in a conversation
interface ConversationTurn {
  turn: number;
  timestamp: string;
  prompt: string;
  duration_ms: number;
  status: 'success' | 'error' | 'timeout';
  exit_code: number | null;
  output: {
    stdout: string;
    stderr: string;
    truncated: boolean;
  };
}

// Multi-turn conversation record
interface ConversationRecord {
  id: string;
  created_at: string;
  updated_at: string;
  tool: string;
  model: string;
  mode: string;
  category: ExecutionCategory; // user | internal | insight
  total_duration_ms: number;
  turn_count: number;
  latest_status: 'success' | 'error' | 'timeout';
  turns: ConversationTurn[];
  parent_execution_id?: string; // For fork/retry scenarios
}

// Legacy single execution record (for backward compatibility)
interface ExecutionRecord {
  id: string;
  timestamp: string;
  tool: string;
  model: string;
  mode: string;
  prompt: string;
  status: 'success' | 'error' | 'timeout';
  exit_code: number | null;
  duration_ms: number;
  output: {
    stdout: string;
    stderr: string;
    truncated: boolean;
  };
}

interface HistoryIndex {
  version: number;
  total_executions: number;
  executions: {
    id: string;
    timestamp: string;      // created_at for conversations
    updated_at?: string;    // last update time
    tool: string;
    status: string;
    duration_ms: number;
    turn_count?: number;    // number of turns in conversation
    prompt_preview: string;
  }[];
}

interface ExecutionOutput {
  success: boolean;
  execution: ExecutionRecord;
  conversation: ConversationRecord;  // Full conversation record
  stdout: string;
  stderr: string;
}

/**
 * Check if a CLI tool is available (with caching)
 */
async function checkToolAvailability(tool: string): Promise<ToolAvailability> {
  debugLog('TOOL_CHECK', `Checking availability for tool: ${tool}`);

  // Check cache first
  const cached = toolAvailabilityCache.get(tool);
  if (cached && isCacheValid(cached)) {
    debugLog('TOOL_CHECK', `Cache hit for ${tool}`, { available: cached.result.available, path: cached.result.path });
    return cached.result;
  }

  // Clear expired entries periodically
  clearExpiredCache();

  // Perform actual check
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'where' : 'which';

    debugLog('TOOL_CHECK', `Running ${command} ${tool}`, { platform: process.platform });

    // Direct spawn - where/which are system commands that don't need shell wrapper
    const child = spawn(command, [tool], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      const result: ToolAvailability = code === 0 && stdout.trim()
        ? { available: true, path: stdout.trim().split('\n')[0] }
        : { available: false, path: null };

      if (result.available) {
        debugLog('TOOL_CHECK', `Tool ${tool} found`, { path: result.path });
        // Only cache positive results to avoid caching transient failures
        toolAvailabilityCache.set(tool, {
          result,
          timestamp: Date.now()
        });
      } else {
        debugLog('TOOL_CHECK', `Tool ${tool} not found`, { exitCode: code, stderr: stderr.trim() || '(empty)' });
      }

      resolve(result);
    });

    child.on('error', (error) => {
      errorLog('TOOL_CHECK', `Failed to check tool availability: ${tool}`, error, { command, tool });
      // Don't cache errors - they may be transient
      resolve({ available: false, path: null });
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      debugLog('TOOL_CHECK', `Timeout checking tool ${tool} (5s)`);
      // Don't cache timeouts - they may be transient
      resolve({ available: false, path: null });
    }, 5000);
  });
}

// Native resume configuration
interface NativeResumeConfig {
  enabled: boolean;
  sessionId?: string;   // Native UUID
  isLatest?: boolean;   // Use latest/--last flag
}

/**
 * Build command arguments based on tool and options
 */
function buildCommand(params: {
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
    nativeResume: nativeResume ? { enabled: nativeResume.enabled, isLatest: nativeResume.isLatest, sessionId: nativeResume.sessionId } : '(none)',
    promptLength: prompt.length
  });

  let command = tool;
  let args: string[] = [];
  // Default to stdin for all tools to avoid escaping issues on Windows
  let useStdin = true;

  switch (tool) {
    case 'gemini':
      // Native resume: gemini -r <uuid> or -r latest
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
      // Native resume: qwen --continue (latest) or --resume <uuid>
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
      // Codex supports stdin when using `-` as prompt argument
      // Using stdin avoids Windows command line escaping issues with multi-line/special char prompts
      useStdin = true;
      // Native resume: codex resume <uuid> [prompt] or --last
      if (nativeResume?.enabled) {
        args.push('resume');
        if (nativeResume.isLatest) {
          args.push('--last');
        } else if (nativeResume.sessionId) {
          args.push(nativeResume.sessionId);
        }
        // Codex resume still supports additional flags
        // Note: -C is NOT used because spawn's cwd already sets the working directory
        // Using both would cause path to be applied twice (e.g., codex-lens/codex-lens)
        // Permission configuration based on mode:
        // - analysis: --full-auto (read-only sandbox, no prompts) - safer for read operations
        // - write/auto: --dangerously-bypass-approvals-and-sandbox (full access for modifications)
        if (mode === 'write' || mode === 'auto') {
          args.push('--dangerously-bypass-approvals-and-sandbox');
        } else {
          args.push('--full-auto');
        }
        if (model) {
          args.push('-m', model);
        }
        if (include) {
          const dirs = include.split(',').map(d => d.trim()).filter(d => d);
          for (const addDir of dirs) {
            args.push('--add-dir', addDir);
          }
        }
        // Use `-` to indicate reading prompt from stdin
        args.push('-');
      } else {
        // Standard exec mode
        args.push('exec');
        // Note: -C is NOT used because spawn's cwd already sets the working directory
        // Using both would cause path to be applied twice (e.g., codex-lens/codex-lens)
        // Permission configuration based on mode:
        // - analysis: --full-auto (read-only sandbox, no prompts) - safer for read operations
        // - write/auto: --dangerously-bypass-approvals-and-sandbox (full access for modifications)
        if (mode === 'write' || mode === 'auto') {
          args.push('--dangerously-bypass-approvals-and-sandbox');
        } else {
          args.push('--full-auto');
        }
        if (model) {
          args.push('-m', model);
        }
        if (include) {
          const dirs = include.split(',').map(d => d.trim()).filter(d => d);
          for (const addDir of dirs) {
            args.push('--add-dir', addDir);
          }
        }
        // Use `-` to indicate reading prompt from stdin (avoids Windows escaping issues)
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
        const dirs = include.split(',').map(d => d.trim()).filter(d => d);
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
    fullCommand: `${command} ${args.join(' ')}${useStdin ? ' (stdin)' : ''}`
  });

  return { command, args, useStdin };
}

/**
 * Ensure history directory exists (uses centralized storage)
 */
function ensureHistoryDir(baseDir: string): string {
  const paths = StoragePaths.project(baseDir);
  ensureStorageDir(paths.cliHistory);
  return paths.cliHistory;
}

/**
 * Save conversation to SQLite
 * @param baseDir - Project base directory (NOT historyDir)
 */
async function saveConversationAsync(baseDir: string, conversation: ConversationRecord): Promise<void> {
  const store = await getSqliteStore(baseDir);
  store.saveConversation(conversation);
}

/**
 * Sync wrapper for saveConversation (uses cached SQLite module)
 * @param baseDir - Project base directory (NOT historyDir)
 */
function saveConversation(baseDir: string, conversation: ConversationRecord): void {
  try {
    const store = getSqliteStoreSync(baseDir);
    store.saveConversation(conversation);
  } catch {
    // If sync not available, queue for async save
    saveConversationAsync(baseDir, conversation).catch(err => {
      console.error('[CLI Executor] Failed to save conversation:', err.message);
    });
  }
}

/**
 * Load existing conversation by ID from SQLite
 * @param baseDir - Project base directory (NOT historyDir)
 */
async function loadConversationAsync(baseDir: string, conversationId: string): Promise<ConversationRecord | null> {
  const store = await getSqliteStore(baseDir);
  return store.getConversation(conversationId);
}

/**
 * Sync wrapper for loadConversation (uses cached SQLite module)
 * @param baseDir - Project base directory (NOT historyDir)
 */
function loadConversation(baseDir: string, conversationId: string): ConversationRecord | null {
  try {
    const store = getSqliteStoreSync(baseDir);
    return store.getConversation(conversationId);
  } catch {
    // SQLite not initialized yet, return null
    return null;
  }
}

/**
 * Convert legacy ExecutionRecord to ConversationRecord
 */
function convertToConversation(record: ExecutionRecord): ConversationRecord {
  return {
    id: record.id,
    created_at: record.timestamp,
    updated_at: record.timestamp,
    tool: record.tool,
    model: record.model,
    mode: record.mode,
    category: 'user', // Legacy records default to user category
    total_duration_ms: record.duration_ms,
    turn_count: 1,
    latest_status: record.status,
    turns: [{
      turn: 1,
      timestamp: record.timestamp,
      prompt: record.prompt,
      duration_ms: record.duration_ms,
      status: record.status,
      exit_code: record.exit_code,
      output: record.output
    }]
  };
}

/**
 * Merge multiple conversations into a unified context
 * Returns merged turns sorted by timestamp with source tracking
 */
interface MergedTurn extends ConversationTurn {
  source_id: string;  // Original conversation ID
}

interface MergeResult {
  mergedTurns: MergedTurn[];
  sourceConversations: ConversationRecord[];
  totalDuration: number;
}

type NonEmptyArray<T> = [T, ...T[]];

function assertNonEmptyArray<T>(items: T[], message: string): asserts items is NonEmptyArray<T> {
  if (items.length === 0) {
    throw new Error(message);
  }
}

function mergeConversations(conversations: ConversationRecord[]): MergeResult {
  const mergedTurns: MergedTurn[] = [];

  // Collect all turns with source tracking
  for (const conv of conversations) {
    for (const turn of conv.turns) {
      mergedTurns.push({
        ...turn,
        source_id: conv.id
      });
    }
  }

  // Sort by timestamp
  mergedTurns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Re-number turns
  mergedTurns.forEach((turn, idx) => {
    turn.turn = idx + 1;
  });

  // Calculate total duration
  const totalDuration = mergedTurns.reduce((sum, t) => sum + t.duration_ms, 0);

  return {
    mergedTurns,
    sourceConversations: conversations,
    totalDuration
  };
}

/**
 * Build prompt from merged conversations
 */
function buildMergedPrompt(
  mergeResult: MergeResult,
  newPrompt: string,
  format: PromptFormat = 'plain'
): string {
  const concatenator = createPromptConcatenator({ format });

  // Set metadata for merged conversations
  concatenator.setMetadata(
    'merged_sources',
    mergeResult.sourceConversations.map(c => c.id).join(', ')
  );

  // Add all merged turns with source tracking
  for (const turn of mergeResult.mergedTurns) {
    concatenator.addFromConversationTurn(turn, turn.source_id);
  }

  return concatenator.build(newPrompt);
}

/**
 * Execute CLI tool with streaming output
 */
async function executeCliTool(
  params: Record<string, unknown>,
  onOutput?: ((data: { type: string; data: string }) => void) | null
): Promise<ExecutionOutput> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${parsed.error.message}`);
  }

  const { tool, prompt, mode, format, model, cd, includeDirs, timeout, resume, id: customId, noNative, category, parentExecutionId } = parsed.data;

  // Validate and determine working directory early (needed for conversation lookup)
  let workingDir: string;
  if (cd) {
    const validation = validatePath(cd, { mustExist: true });
    if (!validation.valid) {
      throw new Error(`Invalid working directory (--cd): ${validation.error}. Path: ${cd}`);
    }
    workingDir = validation.path!;
  } else {
    workingDir = process.cwd();
  }
  ensureHistoryDir(workingDir); // Ensure history directory exists

  // NEW: Check if model is a custom LiteLLM endpoint ID
  if (model) {
    const endpoint = findEndpointById(workingDir, model);
    if (endpoint) {
      // Route to LiteLLM executor
      if (onOutput) {
        onOutput({ type: 'stderr', data: `[Routing to LiteLLM endpoint: ${model}]\n` });
      }

      const result = await executeLiteLLMEndpoint({
        prompt,
        endpointId: model,
        baseDir: workingDir,
        cwd: cd,
        includeDirs: includeDirs ? includeDirs.split(',').map(d => d.trim()) : undefined,
        enableCache: true,
        onOutput: onOutput || undefined,
      });

      // Convert LiteLLM result to ExecutionOutput format
      const startTime = Date.now();
      const endTime = Date.now();
      const duration = endTime - startTime;

      const execution: ExecutionRecord = {
        id: customId || `${Date.now()}-litellm`,
        timestamp: new Date(startTime).toISOString(),
        tool: 'litellm',
        model: result.model,
        mode,
        prompt,
        status: result.success ? 'success' : 'error',
        exit_code: result.success ? 0 : 1,
        duration_ms: duration,
        output: {
          stdout: result.output,
          stderr: result.error || '',
          truncated: false,
        },
      };

      const conversation = convertToConversation(execution);

      // Try to save to history
      try {
        saveConversation(workingDir, conversation);
      } catch (err) {
        console.error('[CLI Executor] Failed to save LiteLLM history:', (err as Error).message);
      }

      return {
        success: result.success,
        execution,
        conversation,
        stdout: result.output,
        stderr: result.error || '',
      };
    }
  }

  // Get SQLite store for native session lookup
  const store = await getSqliteStore(workingDir);

  // Determine conversation ID and load existing conversation
  // Logic:
  // - If --resume <id1,id2,...> (multiple IDs): merge conversations
  //   - With --id: create new merged conversation
  //   - Without --id: append to ALL source conversations
  // - If --resume <id> AND --id <newId>: fork - read context from resume ID, create new conversation with newId
  // - If --id provided (no resume): use that ID (create new or append)
  // - If --resume <id> without --id: use resume ID (append to existing)
  // - No params: create new with auto-generated ID
  let conversationId: string;
  let existingConversation: ConversationRecord | null = null;
  let contextConversation: ConversationRecord | null = null; // For fork scenario
  let mergeResult: MergeResult | null = null; // For merge scenario
  let sourceConversations: ConversationRecord[] = []; // All source conversations for merge

  // Parse resume IDs (can be comma-separated for merge)
  const resumeIds: string[] = resume
    ? (typeof resume === 'string' ? resume.split(',').map(id => id.trim()).filter(Boolean) : [])
    : [];
  const isMerge = resumeIds.length > 1;
  const resumeId = resumeIds.length === 1 ? resumeIds[0] : null;

  if (isMerge) {
    // Merge scenario: multiple resume IDs
    sourceConversations = resumeIds
      .map(id => loadConversation(workingDir, id))
      .filter((c): c is ConversationRecord => c !== null);

    // Guard against empty merge sources before accessing sourceConversations[0].
    assertNonEmptyArray(
      sourceConversations,
      `No valid conversations found for merge: ${resumeIds.join(', ')}`
    );

    mergeResult = mergeConversations(sourceConversations);
    debugLog('MERGE', 'Merged conversations', {
      sourceConversationCount: sourceConversations.length,
      resumeIds
    });

    if (customId) {
      // Create new merged conversation with custom ID
      conversationId = customId;
      existingConversation = loadConversation(workingDir, customId);
    } else {
      // Will append to ALL source conversations (handled in save logic)
      // Use first source conversation ID as primary
      conversationId = sourceConversations[0].id;
      existingConversation = sourceConversations[0];
    }
  } else if (customId && resumeId) {
    // Fork: read context from resume ID, but create new conversation with custom ID
    conversationId = customId;
    contextConversation = loadConversation(workingDir, resumeId);
    existingConversation = loadConversation(workingDir, customId);
  } else if (customId) {
    // Use custom ID - may be new or existing
    conversationId = customId;
    existingConversation = loadConversation(workingDir, customId);
  } else if (resumeId) {
    // Resume single ID without new ID - append to existing conversation
    conversationId = resumeId;
    existingConversation = loadConversation(workingDir, resumeId);
  } else if (resume) {
    // resume=true: get last conversation for this tool
    const history = getExecutionHistory(workingDir, { limit: 1, tool });
    if (history.executions.length > 0) {
      conversationId = history.executions[0].id;
      existingConversation = loadConversation(workingDir, conversationId);
    } else {
      // No previous conversation, create new
      conversationId = `${Date.now()}-${tool}`;
    }
  } else {
    // New conversation with auto-generated ID
    conversationId = `${Date.now()}-${tool}`;
  }

  // Determine resume strategy (native vs prompt-concat vs hybrid)
  let resumeDecision: ResumeDecision | null = null;
  let nativeResumeConfig: NativeResumeConfig | undefined;

  // resume=true (latest) - use native latest if supported
  if (resume === true && !noNative && supportsNativeResume(tool)) {
    resumeDecision = {
      strategy: 'native',
      isLatest: true,
      primaryConversationId: conversationId
    };
  }
  // Use strategy engine for complex scenarios
  else if (resumeIds.length > 0 && !noNative) {
    resumeDecision = determineResumeStrategy({
      tool,
      resumeIds,
      customId,
      forcePromptConcat: noNative,
      getNativeSessionId: (ccwId) => store.getNativeSessionId(ccwId),
      getConversation: (ccwId) => loadConversation(workingDir, ccwId),
      getConversationTool: (ccwId) => {
        const conv = loadConversation(workingDir, ccwId);
        return conv?.tool || null;
      }
    });
  }

  // Configure native resume if strategy decided to use it
  if (resumeDecision && (resumeDecision.strategy === 'native' || resumeDecision.strategy === 'hybrid')) {
    nativeResumeConfig = {
      enabled: true,
      sessionId: resumeDecision.nativeSessionId,
      isLatest: resumeDecision.isLatest
    };
  }

  // Build final prompt with conversation context
  // For native: minimal prompt (native tool handles context)
  // For hybrid: context prefix from other conversations + new prompt
  // For prompt-concat: full multi-turn prompt
  let finalPrompt = prompt;

  if (resumeDecision?.strategy === 'native') {
    // Native mode: just use the new prompt, tool handles context
    finalPrompt = prompt;
  } else if (resumeDecision?.strategy === 'hybrid' && resumeDecision.contextTurns?.length) {
    // Hybrid mode: add context prefix from other conversations
    const contextPrefix = buildContextPrefix(resumeDecision.contextTurns, format);
    finalPrompt = contextPrefix + prompt;
  } else if (mergeResult && mergeResult.mergedTurns.length > 0) {
    // Full merge: use merged prompt
    finalPrompt = buildMergedPrompt(mergeResult, prompt, format);
  } else {
    // Standard prompt-concat
    const conversationForContext = contextConversation || existingConversation;
    if (conversationForContext && conversationForContext.turns.length > 0) {
      finalPrompt = buildMultiTurnPrompt(conversationForContext, prompt, format);
    }
  }

  // Check tool availability
  const toolStatus = await checkToolAvailability(tool);
  if (!toolStatus.available) {
    throw new Error(`CLI tool not available: ${tool}. Please ensure it is installed and in PATH.`);
  }

  // Log resume mode for debugging
  if (resumeDecision) {
    const modeDesc = getResumeModeDescription(resumeDecision);
    if (onOutput) {
      onOutput({ type: 'stderr', data: `[Resume mode: ${modeDesc}]\n` });
    }
  }

  // Use configured primary model if no explicit model provided
  const effectiveModel = model || getPrimaryModel(workingDir, tool);

  // Build command
  const { command, args, useStdin } = buildCommand({
    tool,
    prompt: finalPrompt,
    mode,
    model: effectiveModel,
    dir: cd,
    include: includeDirs,
    nativeResume: nativeResumeConfig
  });

  const startTime = Date.now();

  debugLog('EXEC', `Starting CLI execution`, {
    tool,
    mode,
    workingDir,
    conversationId,
    promptLength: finalPrompt.length,
    hasResume: !!resume,
    hasCustomId: !!customId
  });

  return new Promise((resolve, reject) => {
    // Windows requires shell: true for npm global commands (.cmd files)
    // Unix-like systems can use shell: false for direct execution
    const isWindows = process.platform === 'win32';

    // When using cmd.exe via `shell: true`, escape args to prevent metacharacter injection.
    const commandToSpawn = isWindows ? escapeWindowsArg(command) : command;
    const argsToSpawn = isWindows ? args.map(escapeWindowsArg) : args;

    debugLog('SPAWN', `Spawning process`, {
      command,
      args,
      cwd: workingDir,
      shell: isWindows,
      useStdin,
      platform: process.platform,
      fullCommand: `${command} ${args.join(' ')}`,
      ...(isWindows ? { escapedCommand: commandToSpawn, escapedArgs: argsToSpawn, escapedFullCommand: `${commandToSpawn} ${argsToSpawn.join(' ')}` } : {})
    });

    const child = spawn(commandToSpawn, argsToSpawn, {
      cwd: workingDir,
      shell: isWindows,  // Enable shell on Windows for .cmd files
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe']
    });

    // Track current child process for cleanup on interruption
    currentChildProcess = child;

    debugLog('SPAWN', `Process spawned`, { pid: child.pid });

    // Write prompt to stdin if using stdin mode (for gemini/qwen)
    if (useStdin && child.stdin) {
      debugLog('STDIN', `Writing prompt to stdin (${finalPrompt.length} bytes)`);
      child.stdin.write(finalPrompt);
      child.stdin.end();
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Handle stdout
    child.stdout!.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (onOutput) {
        onOutput({ type: 'stdout', data: text });
      }
    });

    // Handle stderr
    child.stderr!.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (onOutput) {
        onOutput({ type: 'stderr', data: text });
      }
    });

    // Handle completion
    child.on('close', async (code) => {
      if (killTimeout && killTimeoutProcess === child) {
        clearTimeout(killTimeout);
        killTimeout = null;
        killTimeoutProcess = null;
      }

      // Clear current child process reference
      currentChildProcess = null;

      const endTime = Date.now();
      const duration = endTime - startTime;

      debugLog('CLOSE', `Process closed`, {
        exitCode: code,
        duration: `${duration}ms`,
        timedOut,
        stdoutLength: stdout.length,
        stderrLength: stderr.length
      });

      // Determine status - prioritize output content over exit code
      let status: 'success' | 'error' | 'timeout' = 'success';
      if (timedOut) {
        status = 'timeout';
        debugLog('STATUS', `Execution timed out after ${duration}ms`);
      } else if (code !== 0) {
        // Non-zero exit code doesn't always mean failure
        // Check if there's valid output (AI response) - treat as success
        const hasValidOutput = stdout.trim().length > 0;
        const hasFatalError = stderr.includes('FATAL') ||
                              stderr.includes('Authentication failed') ||
                              stderr.includes('API key') ||
                              stderr.includes('rate limit exceeded');

        debugLog('STATUS', `Non-zero exit code analysis`, {
          exitCode: code,
          hasValidOutput,
          hasFatalError,
          stderrPreview: stderr.substring(0, 500)
        });

        if (hasValidOutput && !hasFatalError) {
          // Has output and no fatal errors - treat as success despite exit code
          status = 'success';
          debugLog('STATUS', `Treating as success (has valid output, no fatal errors)`);
        } else {
          status = 'error';
          errorLog('EXEC', `CLI execution failed`, undefined, {
            exitCode: code,
            tool,
            command,
            args,
            workingDir,
            stderrFull: stderr,
            stdoutPreview: stdout.substring(0, 200)
          });
        }
      } else {
        debugLog('STATUS', `Execution successful (exit code 0)`);
      }

      // Create new turn - cache full output when not streaming (default)
      const shouldCache = !parsed.data.stream;
      const newTurnOutput = {
        stdout: stdout.substring(0, 10240), // Truncate preview to 10KB
        stderr: stderr.substring(0, 2048),  // Truncate preview to 2KB
        truncated: stdout.length > 10240 || stderr.length > 2048,
        cached: shouldCache,
        stdout_full: shouldCache ? stdout : undefined,
        stderr_full: shouldCache ? stderr : undefined
      };

      // Determine base turn number for merge scenarios
      const baseTurnNumber = isMerge && mergeResult
        ? mergeResult.mergedTurns.length + 1
        : (existingConversation ? existingConversation.turns.length + 1 : 1);

      const newTurn: ConversationTurn = {
        turn: baseTurnNumber,
        timestamp: new Date(startTime).toISOString(),
        prompt,
        duration_ms: duration,
        status,
        exit_code: code,
        output: newTurnOutput
      };

      // Create or update conversation record
      let conversation: ConversationRecord;

      if (isMerge && mergeResult && !customId) {
        // Merge without --id: append to ALL source conversations
        // Save new turn to each source conversation
        const savedConversations: ConversationRecord[] = [];
        for (const srcConv of sourceConversations) {
          const turnForSrc: ConversationTurn = {
            ...newTurn,
            turn: srcConv.turns.length + 1 // Use each conversation's turn count
          };
          const updatedConv: ConversationRecord = {
            ...srcConv,
            updated_at: new Date().toISOString(),
            total_duration_ms: srcConv.total_duration_ms + duration,
            turn_count: srcConv.turns.length + 1,
            latest_status: status,
            turns: [...srcConv.turns, turnForSrc]
          };
          savedConversations.push(updatedConv);
        }
        // Use first conversation as primary
        conversation = savedConversations[0];
        // Save all source conversations
        try {
          for (const conv of savedConversations) {
            saveConversation(workingDir, conv);
          }
        } catch (err) {
          console.error('[CLI Executor] Failed to save merged histories:', (err as Error).message);
        }
      } else if (isMerge && mergeResult && customId) {
        // Merge with --id: create new conversation with merged turns + new turn
        // Convert merged turns to regular turns (without source_id)
        const mergedTurns: ConversationTurn[] = mergeResult.mergedTurns.map((mt, idx) => ({
          turn: idx + 1,
          timestamp: mt.timestamp,
          prompt: mt.prompt,
          duration_ms: mt.duration_ms,
          status: mt.status,
          exit_code: mt.exit_code,
          output: mt.output
        }));

        conversation = existingConversation
          ? {
              ...existingConversation,
              updated_at: new Date().toISOString(),
              total_duration_ms: existingConversation.total_duration_ms + duration,
              turn_count: existingConversation.turns.length + 1,
              latest_status: status,
              turns: [...existingConversation.turns, newTurn]
            }
          : {
              id: conversationId,
              created_at: new Date(startTime).toISOString(),
              updated_at: new Date().toISOString(),
              tool,
              model: model || 'default',
              mode,
              category,
              total_duration_ms: mergeResult.totalDuration + duration,
              turn_count: mergedTurns.length + 1,
              latest_status: status,
              turns: [...mergedTurns, newTurn]
            };
        // Save merged conversation
        try {
          saveConversation(workingDir, conversation);
        } catch (err) {
          console.error('[CLI Executor] Failed to save merged conversation:', (err as Error).message);
        }
      } else {
        // Normal scenario: single conversation
        conversation = existingConversation
          ? {
              ...existingConversation,
              updated_at: new Date().toISOString(),
              total_duration_ms: existingConversation.total_duration_ms + duration,
              turn_count: existingConversation.turns.length + 1,
              latest_status: status,
              turns: [...existingConversation.turns, newTurn]
            }
          : {
              id: conversationId,
              created_at: new Date(startTime).toISOString(),
              updated_at: new Date().toISOString(),
              tool,
              model: model || 'default',
              mode,
              category,
              total_duration_ms: duration,
              turn_count: 1,
              latest_status: status,
              turns: [newTurn],
              parent_execution_id: parentExecutionId
            };
        // Try to save conversation to history
        try {
          saveConversation(workingDir, conversation);
        } catch (err) {
          // Non-fatal: continue even if history save fails
          console.error('[CLI Executor] Failed to save history:', (err as Error).message);
        }
      }

      // Track native session after execution (awaited to prevent process hang)
      // Pass prompt for precise matching in parallel execution scenarios
      try {
        const nativeSession = await trackNewSession(tool, new Date(startTime), workingDir, prompt);
        if (nativeSession) {
          // Save native session mapping
          try {
            store.saveNativeSessionMapping({
              ccw_id: conversationId,
              tool,
              native_session_id: nativeSession.sessionId,
              native_session_path: nativeSession.filePath,
              project_hash: nativeSession.projectHash,
              created_at: new Date().toISOString()
            });
          } catch (err) {
            console.error('[CLI Executor] Failed to save native session mapping:', (err as Error).message);
          }
        }
      } catch (err) {
        console.error('[CLI Executor] Failed to track native session:', (err as Error).message);
      }

      // Create legacy execution record for backward compatibility
      const execution: ExecutionRecord = {
        id: conversationId,
        timestamp: new Date(startTime).toISOString(),
        tool,
        model: model || 'default',
        mode,
        prompt,
        status,
        exit_code: code,
        duration_ms: duration,
        output: newTurnOutput
      };

      resolve({
        success: status === 'success',
        execution,
        conversation,
        stdout,
        stderr
      });
    });

    // Handle errors
    child.on('error', (error) => {
      errorLog('SPAWN', `Failed to spawn process`, error, {
        tool,
        command,
        args,
        workingDir,
        fullCommand: `${command} ${args.join(' ')}`,
        platform: process.platform,
        path: process.env.PATH?.split(process.platform === 'win32' ? ';' : ':').slice(0, 10).join('\n  ') + '...'
      });
      reject(new Error(`Failed to spawn ${tool}: ${error.message}\n  Command: ${command} ${args.join(' ')}\n  Working Dir: ${workingDir}`));
    });

    // Timeout handling (timeout=0 disables internal timeout, controlled by external caller)
    let timeoutId: NodeJS.Timeout | null = null;
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);
    }

    child.on('close', () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  });
}

// Tool schema for MCP
export const schema: ToolSchema = {
  name: 'cli_executor',
  description: `Execute external CLI tools (gemini/qwen/codex) with unified interface.
Modes:
- analysis: Read-only operations (default)
- write: File modifications allowed
- auto: Full autonomous operations (codex only)`,
  inputSchema: {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        enum: ['gemini', 'qwen', 'codex'],
        description: 'CLI tool to execute'
      },
      prompt: {
        type: 'string',
        description: 'Prompt to send to the CLI tool'
      },
      mode: {
        type: 'string',
        enum: ['analysis', 'write', 'auto'],
        description: 'Execution mode (default: analysis)',
        default: 'analysis'
      },
      model: {
        type: 'string',
        description: 'Model override (tool-specific)'
      },
      cd: {
        type: 'string',
        description: 'Working directory for execution (-C for codex)'
      },
      includeDirs: {
        type: 'string',
        description: 'Additional directories (comma-separated). Maps to --include-directories for gemini/qwen, --add-dir for codex'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 0 = disabled, controlled by external caller)',
        default: 0
      }
    },
    required: ['tool', 'prompt']
  }
};

// Handler function
export async function handler(params: Record<string, unknown>): Promise<ToolResult<ExecutionOutput>> {
  try {
    const result = await executeCliTool(params);
    return {
      success: result.success,
      result
    };
  } catch (error) {
    return {
      success: false,
      error: `CLI execution failed: ${(error as Error).message}`
    };
  }
}

/**
 * Find all project directories with CLI history in centralized storage
 * Returns list of project base directories (NOT history directories)
 */
function findProjectsWithHistory(): string[] {
  const projectDirs: string[] = [];
  const projectsRoot = join(StoragePaths.global.root(), 'projects');

  if (!existsSync(projectsRoot)) {
    return projectDirs;
  }

  try {
    const entries = readdirSync(projectsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const paths = StoragePaths.projectById(entry.name);
        if (existsSync(paths.historyDb)) {
          // Return project ID as identifier (actual project path is hashed)
          projectDirs.push(entry.name);
        }
      }
    }
  } catch {
    // Ignore permission errors
  }

  return projectDirs;
}

/**
 * Get execution history from SQLite (centralized storage)
 */
export async function getExecutionHistoryAsync(baseDir: string, options: {
  limit?: number;
  tool?: string | null;
  status?: string | null;
  category?: ExecutionCategory | null;
  search?: string | null;
  recursive?: boolean;
} = {}): Promise<{
  total: number;
  count: number;
  executions: (HistoryIndex['executions'][0] & { sourceDir?: string })[];
}> {
  const { limit = 50, tool = null, status = null, category = null, search = null, recursive = false } = options;

  // Recursive mode: aggregate data from parent and all child projects
  if (recursive) {
    const { scanChildProjectsAsync } = await import('../config/storage-paths.js');
    const childProjects = await scanChildProjectsAsync(baseDir);

    let allExecutions: (HistoryIndex['executions'][0] & { sourceDir?: string })[] = [];
    let totalCount = 0;

    // Query parent project - apply limit at source to reduce memory footprint
    try {
      const parentStore = await getSqliteStore(baseDir);
      const parentResult = parentStore.getHistory({ limit, tool, status, category, search });
      totalCount += parentResult.total;

      for (const exec of parentResult.executions) {
        allExecutions.push({ ...exec, sourceDir: baseDir });
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(`[CLI History] Failed to query parent project ${baseDir}:`, error);
      }
    }

    // Query all child projects - apply limit to each child
    for (const child of childProjects) {
      try {
        const childStore = await getSqliteStore(child.projectPath);
        const childResult = childStore.getHistory({ limit, tool, status, category, search });
        totalCount += childResult.total;

        for (const exec of childResult.executions) {
          allExecutions.push({
            ...exec,
            sourceDir: child.relativePath // Show relative path for clarity
          });
        }
      } catch (error) {
        if (process.env.DEBUG) {
          console.error(`[CLI History] Failed to query child project ${child.projectPath}:`, error);
        }
      }
    }

    // Sort by timestamp (newest first) and apply limit
    allExecutions.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    const limitedExecutions = allExecutions.slice(0, limit);

    return {
      total: totalCount,
      count: limitedExecutions.length,
      executions: limitedExecutions
    };
  }

  // Non-recursive mode: only query current project
  const store = await getSqliteStore(baseDir);
  return store.getHistory({ limit, tool, status, category, search });
}

/**
 * Get execution history (sync version - uses cached SQLite module)
 */
export function getExecutionHistory(baseDir: string, options: {
  limit?: number;
  tool?: string | null;
  status?: string | null;
  recursive?: boolean;
} = {}): {
  total: number;
  count: number;
  executions: (HistoryIndex['executions'][0] & { sourceDir?: string })[];
} {
  const { limit = 50, tool = null, status = null, recursive = false } = options;

  try {
    if (recursive) {
      const { scanChildProjects } = require('../config/storage-paths.js');
      const childProjects = scanChildProjects(baseDir);

      let allExecutions: (HistoryIndex['executions'][0] & { sourceDir?: string })[] = [];
      let totalCount = 0;

      // Query parent project - apply limit at source
      try {
        const parentStore = getSqliteStoreSync(baseDir);
        const parentResult = parentStore.getHistory({ limit, tool, status });
        totalCount += parentResult.total;

        for (const exec of parentResult.executions) {
          allExecutions.push({ ...exec, sourceDir: baseDir });
        }
      } catch (error) {
        if (process.env.DEBUG) {
          console.error(`[CLI History Sync] Failed to query parent project ${baseDir}:`, error);
        }
      }

      // Query all child projects - apply limit to each child
      for (const child of childProjects) {
        try {
          const childStore = getSqliteStoreSync(child.projectPath);
          const childResult = childStore.getHistory({ limit, tool, status });
          totalCount += childResult.total;

          for (const exec of childResult.executions) {
            allExecutions.push({
              ...exec,
              sourceDir: child.relativePath
            });
          }
        } catch (error) {
          if (process.env.DEBUG) {
            console.error(`[CLI History Sync] Failed to query child project ${child.projectPath}:`, error);
          }
        }
      }

      // Sort by timestamp (newest first) and apply limit
      allExecutions.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

      return {
        total: totalCount,
        count: Math.min(allExecutions.length, limit),
        executions: allExecutions.slice(0, limit)
      };
    }

    const store = getSqliteStoreSync(baseDir);
    return store.getHistory({ limit, tool, status });
  } catch {
    // SQLite not initialized, return empty
    return { total: 0, count: 0, executions: [] };
  }
}

/**
 * Get conversation detail by ID (returns ConversationRecord)
 */
export function getConversationDetail(baseDir: string, conversationId: string): ConversationRecord | null {
  // Pass baseDir directly - loadConversation will resolve the correct storage path
  return loadConversation(baseDir, conversationId);
}

/**
 * Get conversation detail with native session info
 */
export function getConversationDetailWithNativeInfo(baseDir: string, conversationId: string) {
  try {
    const store = getSqliteStoreSync(baseDir);
    return store.getConversationWithNativeInfo(conversationId);
  } catch {
    // SQLite not initialized, return null
    return null;
  }
}

/**
 * Get execution detail by ID (legacy, returns ExecutionRecord for backward compatibility)
 */
export function getExecutionDetail(baseDir: string, executionId: string): ExecutionRecord | null {
  const conversation = getConversationDetail(baseDir, executionId);
  if (!conversation) return null;

  // Convert to legacy ExecutionRecord format (using latest turn)
  const latestTurn = conversation.turns[conversation.turns.length - 1];
  return {
    id: conversation.id,
    timestamp: conversation.created_at,
    tool: conversation.tool,
    model: conversation.model,
    mode: conversation.mode,
    prompt: latestTurn.prompt,
    status: conversation.latest_status,
    exit_code: latestTurn.exit_code,
    duration_ms: conversation.total_duration_ms,
    output: latestTurn.output
  };
}

/**
 * Delete execution by ID (async version)
 */
export async function deleteExecutionAsync(baseDir: string, executionId: string): Promise<{ success: boolean; error?: string }> {
  const store = await getSqliteStore(baseDir);
  return store.deleteConversation(executionId);
}

/**
 * Delete execution by ID (sync version - uses cached SQLite module)
 */
export function deleteExecution(baseDir: string, executionId: string): { success: boolean; error?: string } {
  try {
    const store = getSqliteStoreSync(baseDir);
    return store.deleteConversation(executionId);
  } catch {
    return { success: false, error: 'SQLite store not initialized' };
  }
}

/**
 * Batch delete executions (async)
 */
export async function batchDeleteExecutionsAsync(baseDir: string, ids: string[]): Promise<{
  success: boolean;
  deleted: number;
  total: number;
  errors?: string[];
}> {
  const store = await getSqliteStore(baseDir);
  const result = store.batchDelete(ids);
  return { ...result, total: ids.length };
}

/**
 * Get status of all CLI tools
 */
export async function getCliToolsStatus(): Promise<Record<string, ToolAvailability>> {
  const tools = ['gemini', 'qwen', 'codex', 'claude'];
  const results: Record<string, ToolAvailability> = {};

  await Promise.all(tools.map(async (tool) => {
    results[tool] = await checkToolAvailability(tool);
  }));

  return results;
}

// CLI tool package mapping
const CLI_TOOL_PACKAGES: Record<string, string> = {
  gemini: '@google/gemini-cli',
  qwen: '@qwen-code/qwen-code',
  codex: '@openai/codex',
  claude: '@anthropic-ai/claude-code'
};

// Disabled tools storage (in-memory fallback, main storage is in cli-config.json)
const disabledTools = new Set<string>();

// Default working directory for config operations
let configBaseDir = process.cwd();

/**
 * Set the base directory for config operations
 */
export function setConfigBaseDir(dir: string): void {
  configBaseDir = dir;
}

/**
 * Install a CLI tool via npm
 */
export async function installCliTool(tool: string): Promise<{ success: boolean; error?: string }> {
  const packageName = CLI_TOOL_PACKAGES[tool];
  if (!packageName) {
    return { success: false, error: `Unknown tool: ${tool}` };
  }

  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', packageName], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      // Clear cache to force re-check
      toolAvailabilityCache.delete(tool);

      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr || `npm install failed with code ${code}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      child.kill();
      resolve({ success: false, error: 'Installation timed out' });
    }, 120000);
  });
}

/**
 * Uninstall a CLI tool via npm
 */
export async function uninstallCliTool(tool: string): Promise<{ success: boolean; error?: string }> {
  const packageName = CLI_TOOL_PACKAGES[tool];
  if (!packageName) {
    return { success: false, error: `Unknown tool: ${tool}` };
  }

  return new Promise((resolve) => {
    const child = spawn('npm', ['uninstall', '-g', packageName], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      // Clear cache to force re-check
      toolAvailabilityCache.delete(tool);

      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr || `npm uninstall failed with code ${code}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    // Timeout after 1 minute
    setTimeout(() => {
      child.kill();
      resolve({ success: false, error: 'Uninstallation timed out' });
    }, 60000);
  });
}

/**
 * Enable a CLI tool (updates config file)
 */
export function enableCliTool(tool: string): { success: boolean } {
  try {
    enableToolFromConfig(configBaseDir, tool);
    disabledTools.delete(tool); // Also update in-memory fallback
    return { success: true };
  } catch (err) {
    console.error('[cli-executor] Error enabling tool:', err);
    disabledTools.delete(tool); // Fallback to in-memory
    return { success: true };
  }
}

/**
 * Disable a CLI tool (updates config file)
 */
export function disableCliTool(tool: string): { success: boolean } {
  try {
    disableToolFromConfig(configBaseDir, tool);
    disabledTools.add(tool); // Also update in-memory fallback
    return { success: true };
  } catch (err) {
    console.error('[cli-executor] Error disabling tool:', err);
    disabledTools.add(tool); // Fallback to in-memory
    return { success: true };
  }
}

/**
 * Check if a tool is enabled (reads from config file)
 */
export function isToolEnabled(tool: string): boolean {
  try {
    return isToolEnabledFromConfig(configBaseDir, tool);
  } catch {
    // Fallback to in-memory check
    return !disabledTools.has(tool);
  }
}

/**
 * Get full status of all CLI tools including enabled state
 */
export async function getCliToolsFullStatus(): Promise<Record<string, {
  available: boolean;
  enabled: boolean;
  path: string | null;
  packageName: string;
}>> {
  const tools = Object.keys(CLI_TOOL_PACKAGES);
  const results: Record<string, {
    available: boolean;
    enabled: boolean;
    path: string | null;
    packageName: string;
  }> = {};

  await Promise.all(tools.map(async (tool) => {
    const availability = await checkToolAvailability(tool);
    results[tool] = {
      available: availability.available,
      enabled: isToolEnabled(tool),
      path: availability.path,
      packageName: CLI_TOOL_PACKAGES[tool]
    };
  }));

  return results;
}

// ========== Prompt Concatenation System ==========

/**
 * Turn data structure for concatenation
 */
interface TurnData {
  turn: number;
  timestamp?: string;
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  duration_ms?: number;
  source_id?: string; // For merged conversations
}

/**
 * Prompt concatenation options
 */
interface ConcatOptions {
  format: PromptFormat;
  includeMetadata?: boolean;
  includeTurnMarkers?: boolean;
  maxOutputLength?: number; // Truncate output for context efficiency
}

/**
 * PromptConcatenator - Dedicated class for building multi-turn prompts
 * Supports multiple output formats: plain text, YAML, JSON
 */
class PromptConcatenator {
  private turns: TurnData[] = [];
  private options: ConcatOptions;
  private metadata: Record<string, unknown> = {};

  constructor(options: Partial<ConcatOptions> = {}) {
    this.options = {
      format: options.format || 'plain',
      includeMetadata: options.includeMetadata ?? true,
      includeTurnMarkers: options.includeTurnMarkers ?? true,
      maxOutputLength: options.maxOutputLength || 8192
    };
  }

  /**
   * Set metadata for the conversation
   */
  setMetadata(key: string, value: unknown): this {
    this.metadata[key] = value;
    return this;
  }

  /**
   * Add a user turn
   */
  addUserTurn(content: string, options: Partial<Omit<TurnData, 'role' | 'content'>> = {}): this {
    this.turns.push({
      turn: this.turns.length + 1,
      role: 'user',
      content,
      ...options
    });
    return this;
  }

  /**
   * Add an assistant turn
   */
  addAssistantTurn(content: string, options: Partial<Omit<TurnData, 'role' | 'content'>> = {}): this {
    // Truncate output if needed
    const truncatedContent = content.length > this.options.maxOutputLength!
      ? content.substring(0, this.options.maxOutputLength!) + '\n... [truncated]'
      : content;

    this.turns.push({
      turn: this.turns.length + 1,
      role: 'assistant',
      content: truncatedContent,
      ...options
    });
    return this;
  }

  /**
   * Add a conversation turn from ConversationTurn
   */
  addFromConversationTurn(turn: ConversationTurn, sourceId?: string): this {
    this.addUserTurn(turn.prompt, {
      turn: turn.turn * 2 - 1,
      timestamp: turn.timestamp,
      source_id: sourceId
    });
    this.addAssistantTurn(turn.output.stdout || '[No output]', {
      turn: turn.turn * 2,
      timestamp: turn.timestamp,
      status: turn.status,
      duration_ms: turn.duration_ms,
      source_id: sourceId
    });
    return this;
  }

  /**
   * Load turns from an existing conversation
   */
  loadConversation(conversation: ConversationRecord): this {
    for (const turn of conversation.turns) {
      this.addFromConversationTurn(turn);
    }
    return this;
  }

  /**
   * Build the final prompt in plain text format
   */
  private buildPlainText(newPrompt: string): string {
    const parts: string[] = [];

    // Metadata section
    if (this.options.includeMetadata && Object.keys(this.metadata).length > 0) {
      parts.push('=== CONTEXT ===');
      for (const [key, value] of Object.entries(this.metadata)) {
        parts.push(`${key}: ${String(value)}`);
      }
      parts.push('');
    }

    // Conversation history
    if (this.turns.length > 0) {
      parts.push('=== CONVERSATION HISTORY ===');
      parts.push('');

      let currentTurn = 0;
      for (let i = 0; i < this.turns.length; i += 2) {
        currentTurn++;
        const userTurn = this.turns[i];
        const assistantTurn = this.turns[i + 1];

        if (this.options.includeTurnMarkers) {
          const sourceMarker = userTurn.source_id ? ` [${userTurn.source_id}]` : '';
          parts.push(`--- Turn ${currentTurn}${sourceMarker} ---`);
        }

        parts.push('USER:');
        parts.push(userTurn.content);
        parts.push('');

        if (assistantTurn) {
          parts.push('ASSISTANT:');
          parts.push(assistantTurn.content);
          parts.push('');
        }
      }
    }

    // New request
    parts.push('=== NEW REQUEST ===');
    parts.push('');
    parts.push(newPrompt);

    return parts.join('\n');
  }

  /**
   * Build the final prompt in YAML format
   */
  private buildYaml(newPrompt: string): string {
    const yamlLines: string[] = [];

    // Metadata
    if (this.options.includeMetadata && Object.keys(this.metadata).length > 0) {
      yamlLines.push('context:');
      for (const [key, value] of Object.entries(this.metadata)) {
        yamlLines.push(`  ${key}: ${this.yamlValue(value)}`);
      }
      yamlLines.push('');
    }

    // Conversation history
    if (this.turns.length > 0) {
      yamlLines.push('conversation:');

      let currentTurn = 0;
      for (let i = 0; i < this.turns.length; i += 2) {
        currentTurn++;
        const userTurn = this.turns[i];
        const assistantTurn = this.turns[i + 1];

        yamlLines.push(`  - turn: ${currentTurn}`);
        if (userTurn.source_id) {
          yamlLines.push(`    source: ${userTurn.source_id}`);
        }
        if (userTurn.timestamp) {
          yamlLines.push(`    timestamp: ${userTurn.timestamp}`);
        }

        // User message
        yamlLines.push('    user: |');
        const userLines = userTurn.content.split('\n');
        for (const line of userLines) {
          yamlLines.push(`      ${line}`);
        }

        // Assistant message
        if (assistantTurn) {
          if (assistantTurn.status) {
            yamlLines.push(`    status: ${assistantTurn.status}`);
          }
          if (assistantTurn.duration_ms) {
            yamlLines.push(`    duration_ms: ${assistantTurn.duration_ms}`);
          }
          yamlLines.push('    assistant: |');
          const assistantLines = assistantTurn.content.split('\n');
          for (const line of assistantLines) {
            yamlLines.push(`      ${line}`);
          }
        }
        yamlLines.push('');
      }
    }

    // New request
    yamlLines.push('new_request: |');
    const requestLines = newPrompt.split('\n');
    for (const line of requestLines) {
      yamlLines.push(`  ${line}`);
    }

    return yamlLines.join('\n');
  }

  /**
   * Build the final prompt in JSON format
   */
  private buildJson(newPrompt: string): string {
    const data: Record<string, unknown> = {};

    // Metadata
    if (this.options.includeMetadata && Object.keys(this.metadata).length > 0) {
      data.context = this.metadata;
    }

    // Conversation history
    if (this.turns.length > 0) {
      const conversation: Array<{
        turn: number;
        source?: string;
        timestamp?: string;
        user: string;
        assistant?: string;
        status?: string;
        duration_ms?: number;
      }> = [];

      for (let i = 0; i < this.turns.length; i += 2) {
        const userTurn = this.turns[i];
        const assistantTurn = this.turns[i + 1];

        const turnData: typeof conversation[0] = {
          turn: Math.ceil((i + 1) / 2),
          user: userTurn.content
        };

        if (userTurn.source_id) turnData.source = userTurn.source_id;
        if (userTurn.timestamp) turnData.timestamp = userTurn.timestamp;
        if (assistantTurn) {
          turnData.assistant = assistantTurn.content;
          if (assistantTurn.status) turnData.status = assistantTurn.status;
          if (assistantTurn.duration_ms) turnData.duration_ms = assistantTurn.duration_ms;
        }

        conversation.push(turnData);
      }

      data.conversation = conversation;
    }

    data.new_request = newPrompt;

    return JSON.stringify(data, null, 2);
  }

  /**
   * Helper to format YAML values
   */
  private yamlValue(value: unknown): string {
    if (typeof value === 'string') {
      // Quote strings that might be interpreted as other types
      if (/[:\[\]{}#&*!|>'"@`]/.test(value) || value === '') {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value === null || value === undefined) {
      return 'null';
    }
    return JSON.stringify(value);
  }

  /**
   * Build the final prompt string
   */
  build(newPrompt: string): string {
    switch (this.options.format) {
      case 'yaml':
        return this.buildYaml(newPrompt);
      case 'json':
        return this.buildJson(newPrompt);
      case 'plain':
      default:
        return this.buildPlainText(newPrompt);
    }
  }

  /**
   * Reset the concatenator for reuse
   */
  reset(): this {
    this.turns = [];
    this.metadata = {};
    return this;
  }
}

/**
 * Create a prompt concatenator with specified options
 */
function createPromptConcatenator(options?: Partial<ConcatOptions>): PromptConcatenator {
  return new PromptConcatenator(options);
}

/**
 * Quick helper to build a multi-turn prompt in any format
 */
function buildPrompt(
  conversation: ConversationRecord,
  newPrompt: string,
  format: PromptFormat = 'plain'
): string {
  return createPromptConcatenator({ format })
    .loadConversation(conversation)
    .build(newPrompt);
}

/**
 * Build multi-turn prompt with full conversation history
 * Uses the PromptConcatenator with plain text format by default
 */
function buildMultiTurnPrompt(
  conversation: ConversationRecord,
  newPrompt: string,
  format: PromptFormat = 'plain'
): string {
  return buildPrompt(conversation, newPrompt, format);
}

/**
 * Build continuation prompt with previous conversation context (legacy)
 */
function buildContinuationPrompt(previous: ExecutionRecord, additionalPrompt?: string): string {
  const parts: string[] = [];

  // Add previous conversation context
  parts.push('=== PREVIOUS CONVERSATION ===');
  parts.push('');
  parts.push('USER PROMPT:');
  parts.push(previous.prompt);
  parts.push('');
  parts.push('ASSISTANT RESPONSE:');
  parts.push(previous.output.stdout || '[No output recorded]');
  parts.push('');
  parts.push('=== CONTINUATION ===');
  parts.push('');

  if (additionalPrompt) {
    parts.push(additionalPrompt);
  } else {
    parts.push('Continue from where we left off. What should we do next?');
  }

  return parts.join('\n');
}

/**
 * Get previous execution for resume
 * @param baseDir - Working directory
 * @param tool - Tool to filter by
 * @param resume - true for last, or execution ID string
 */
function getPreviousExecution(baseDir: string, tool: string, resume: boolean | string): ExecutionRecord | null {
  if (typeof resume === 'string') {
    // Resume specific execution by ID
    return getExecutionDetail(baseDir, resume);
  } else if (resume === true) {
    // Resume last execution for this tool
    const history = getExecutionHistory(baseDir, { limit: 1, tool });
    if (history.executions.length === 0) {
      return null;
    }
    return getExecutionDetail(baseDir, history.executions[0].id);
  }
  return null;
}

/**
 * Get latest execution for a specific tool
 */
export function getLatestExecution(baseDir: string, tool?: string): ExecutionRecord | null {
  const history = getExecutionHistory(baseDir, { limit: 1, tool: tool || null });
  if (history.executions.length === 0) {
    return null;
  }
  return getExecutionDetail(baseDir, history.executions[0].id);
}

// ========== Native Session Content Functions ==========

/**
 * Get native session content by CCW ID
 * Parses the native session file and returns full conversation data
 */
export async function getNativeSessionContent(baseDir: string, ccwId: string) {
  const store = await getSqliteStore(baseDir);
  return store.getNativeSessionContent(ccwId);
}

/**
 * Get formatted native conversation text
 */
export async function getFormattedNativeConversation(baseDir: string, ccwId: string, options?: {
  includeThoughts?: boolean;
  includeToolCalls?: boolean;
  includeTokens?: boolean;
  maxContentLength?: number;
}) {
  const store = await getSqliteStore(baseDir);
  return store.getFormattedNativeConversation(ccwId, options);
}

/**
 * Get conversation pairs from native session
 */
export async function getNativeConversationPairs(baseDir: string, ccwId: string) {
  const store = await getSqliteStore(baseDir);
  return store.getNativeConversationPairs(ccwId);
}

/**
 * Get enriched conversation (CCW + native session merged)
 */
export async function getEnrichedConversation(baseDir: string, ccwId: string) {
  const store = await getSqliteStore(baseDir);
  return store.getEnrichedConversation(ccwId);
}

/**
 * Get history with native session info
 * Supports recursive querying of child projects
 */
export async function getHistoryWithNativeInfo(baseDir: string, options?: {
  limit?: number;
  offset?: number;
  tool?: string | null;
  status?: string | null;
  category?: ExecutionCategory | null;
  search?: string | null;
  recursive?: boolean;
}) {
  const { limit = 50, recursive = false, ...queryOptions } = options || {};

  // Non-recursive mode: query single project
  if (!recursive) {
    const store = await getSqliteStore(baseDir);
    return store.getHistoryWithNativeInfo({ limit, ...queryOptions });
  }

  // Recursive mode: aggregate data from parent and all child projects
  const { scanChildProjectsAsync } = await import('../config/storage-paths.js');
  const childProjects = await scanChildProjectsAsync(baseDir);

  // Use the same type as store.getHistoryWithNativeInfo returns
  type ExecutionWithNativeAndSource = HistoryIndexEntry & {
    hasNativeSession: boolean;
    nativeSessionId?: string;
    nativeSessionPath?: string;
  };

  const allExecutions: ExecutionWithNativeAndSource[] = [];
  let totalCount = 0;

  // Query parent project
  try {
    const parentStore = await getSqliteStore(baseDir);
    const parentResult = parentStore.getHistoryWithNativeInfo({ limit, ...queryOptions });
    totalCount += parentResult.total;

    for (const exec of parentResult.executions) {
      allExecutions.push({ ...exec, sourceDir: baseDir });
    }
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`[CLI History] Failed to query parent project ${baseDir}:`, error);
    }
  }

  // Query all child projects
  for (const child of childProjects) {
    try {
      const childStore = await getSqliteStore(child.projectPath);
      const childResult = childStore.getHistoryWithNativeInfo({ limit, ...queryOptions });
      totalCount += childResult.total;

      for (const exec of childResult.executions) {
        allExecutions.push({ ...exec, sourceDir: child.projectPath });
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(`[CLI History] Failed to query child project ${child.projectPath}:`, error);
      }
    }
  }

  // Sort by updated_at descending and apply limit
  allExecutions.sort((a, b) => {
    const timeA = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.timestamp).getTime();
    const timeB = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });
  const limitedExecutions = allExecutions.slice(0, limit);

  return {
    total: totalCount,
    count: limitedExecutions.length,
    executions: limitedExecutions
  };
}

// Export types
export type { ConversationRecord, ConversationTurn, ExecutionRecord, PromptFormat, ConcatOptions };

// Export utility functions and tool definition for backward compatibility
export { executeCliTool, checkToolAvailability };

// Export prompt concatenation utilities
export { PromptConcatenator, createPromptConcatenator, buildPrompt, buildMultiTurnPrompt };

// Note: Async storage functions (getExecutionHistoryAsync, deleteExecutionAsync,
// batchDeleteExecutionsAsync) are exported at declaration site - SQLite storage only

// Export tool definition (for legacy imports) - This allows direct calls to execute with onOutput
export const cliExecutorTool = {
  schema,
  execute: executeCliTool // Use executeCliTool directly which supports onOutput callback
};
