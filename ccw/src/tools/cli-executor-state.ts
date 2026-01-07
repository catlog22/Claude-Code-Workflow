/**
 * CLI Executor State
 * Conversation history + execution record storage (SQLite-backed)
 */

import type { HistoryIndexEntry } from './cli-history-store.js';
import { StoragePaths, ensureStorageDir } from '../config/storage-paths.js';

// Lazy-loaded SQLite store module
let sqliteStoreModule: typeof import('./cli-history-store.js') | null = null;

/**
 * Get or initialize SQLite store (async)
 */
export async function getSqliteStore(baseDir: string) {
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

// Execution category types
export type ExecutionCategory = 'user' | 'internal' | 'insight';

// Single turn in a conversation
export interface ConversationTurn {
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
export interface ConversationRecord {
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
export interface ExecutionRecord {
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

export interface ExecutionOutput {
  success: boolean;
  execution: ExecutionRecord;
  conversation: ConversationRecord;  // Full conversation record
  stdout: string;
  stderr: string;
}

/**
 * Ensure history directory exists (uses centralized storage)
 */
export function ensureHistoryDir(baseDir: string): string {
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
export function saveConversation(baseDir: string, conversation: ConversationRecord): void {
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
export function loadConversation(baseDir: string, conversationId: string): ConversationRecord | null {
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
export function convertToConversation(record: ExecutionRecord): ConversationRecord {
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
          console.error(`[CLI History] Failed to query parent project ${baseDir}:`, error);
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

    const store = getSqliteStoreSync(baseDir);
    return store.getHistory({ limit, tool, status });
  } catch {
    // SQLite not initialized yet, return empty
    return { total: 0, count: 0, executions: [] };
  }
}

/**
 * Get conversation detail by ID
 */
export function getConversationDetail(baseDir: string, conversationId: string): ConversationRecord | null {
  // Pass baseDir directly - loadConversation will resolve the correct storage path
  return loadConversation(baseDir, conversationId);
}

/**
 * Get conversation detail with native session mapping info
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
