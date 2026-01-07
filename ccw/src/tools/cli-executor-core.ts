/**
 * CLI Executor Tool - Unified execution for external CLI tools
 * Supports Gemini, Qwen, and Codex with streaming output
 */

import { z } from 'zod';
import type { ToolSchema, ToolResult } from '../types/tool.js';
import { spawn, ChildProcess } from 'child_process';
import { validatePath } from '../utils/path-resolver.js';
import { escapeWindowsArg } from '../utils/shell-escape.js';
import { buildCommand, checkToolAvailability, clearToolCache, debugLog, errorLog, type NativeResumeConfig, type ToolAvailability } from './cli-executor-utils.js';
import type { ConversationRecord, ConversationTurn, ExecutionOutput, ExecutionRecord } from './cli-executor-state.js';
import {
  buildMergedPrompt,
  buildMultiTurnPrompt,
  mergeConversations,
  type MergeResult
} from './cli-prompt-builder.js';
import {
  convertToConversation,
  ensureHistoryDir,
  getExecutionDetail,
  getExecutionHistory,
  getSqliteStore,
  loadConversation,
  saveConversation
} from './cli-executor-state.js';

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

type Params = z.infer<typeof ParamsSchema>;

type NonEmptyArray<T> = [T, ...T[]];

function assertNonEmptyArray<T>(items: T[], message: string): asserts items is NonEmptyArray<T> {
  if (items.length === 0) {
    throw new Error(message);
  }
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

export {
  batchDeleteExecutionsAsync,
  deleteExecution,
  deleteExecutionAsync,
  getConversationDetail,
  getConversationDetailWithNativeInfo,
  getExecutionDetail,
  getExecutionHistory,
  getExecutionHistoryAsync
} from './cli-executor-state.js';

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
      clearToolCache();

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
      clearToolCache();

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
 * Latest execution + native session history functions are re-exported from state.
 */
export {
  getEnrichedConversation,
  getFormattedNativeConversation,
  getHistoryWithNativeInfo,
  getLatestExecution,
  getNativeConversationPairs,
  getNativeSessionContent
} from './cli-executor-state.js';

// Export types
export type { ExecutionCategory, ConversationRecord, ConversationTurn, ExecutionRecord } from './cli-executor-state.js';
export type { PromptFormat, ConcatOptions } from './cli-prompt-builder.js';

// Export utility functions and tool definition for backward compatibility
export { executeCliTool, checkToolAvailability, clearToolCache };

// Export prompt concatenation utilities
export { PromptConcatenator, createPromptConcatenator, buildPrompt, buildMultiTurnPrompt } from './cli-prompt-builder.js';

// Note: Async storage functions (getExecutionHistoryAsync, deleteExecutionAsync,
// batchDeleteExecutionsAsync) are exported at declaration site - SQLite storage only

// Export tool definition (for legacy imports) - This allows direct calls to execute with onOutput
export const cliExecutorTool = {
  schema,
  execute: executeCliTool // Use executeCliTool directly which supports onOutput callback
};
