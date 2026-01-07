/**
 * CLI Command - Unified CLI tool executor command
 * Provides interface for executing Gemini, Qwen, and Codex
 */

import chalk from 'chalk';
import http from 'http';
import {
  cliExecutorTool,
  getCliToolsStatus,
  getExecutionHistory,
  getExecutionHistoryAsync,
  getExecutionDetail,
  getConversationDetail,
  killCurrentCliProcess
} from '../tools/cli-executor.js';
import {
  getStorageStats,
  getStorageConfig,
  cleanProjectStorage,
  cleanAllStorage,
  formatBytes,
  formatTimeAgo,
  resolveProjectId,
  projectExists,
  getStorageLocationInstructions
} from '../tools/storage-manager.js';
import { getHistoryStore } from '../tools/cli-history-store.js';
import { createSpinner } from '../utils/ui.js';

// Dashboard notification settings
const DASHBOARD_PORT = process.env.CCW_PORT || 3456;

/**
 * Notify dashboard of CLI execution events (fire and forget)
 */
function notifyDashboard(data: Record<string, unknown>): void {
  const payload = JSON.stringify({
    type: 'cli_execution',
    ...data,
    timestamp: new Date().toISOString()
  });

  const req = http.request({
    hostname: 'localhost',
    port: Number(DASHBOARD_PORT),
    path: '/api/hook',
    method: 'POST',
    timeout: 2000, // 2 second timeout to prevent hanging
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  });

  // Fire and forget - don't block process exit
  req.on('socket', (socket) => {
    socket.unref(); // Allow process to exit even if socket is open
  });
  req.on('error', (err) => {
    if (process.env.DEBUG) console.error('[Dashboard] CLI notification failed:', err.message);
  });
  req.on('timeout', () => {
    req.destroy();
    if (process.env.DEBUG) console.error('[Dashboard] CLI notification timed out');
  });
  req.write(payload);
  req.end();
}

/**
 * Broadcast WebSocket event to Dashboard for real-time streaming
 * Uses specific event types that match frontend handlers
 */
function broadcastStreamEvent(eventType: string, payload: Record<string, unknown>): void {
  const data = JSON.stringify({
    type: eventType,
    ...payload,
    timestamp: new Date().toISOString()
  });

  const req = http.request({
    hostname: 'localhost',
    port: Number(DASHBOARD_PORT),
    path: '/api/hook',
    method: 'POST',
    timeout: 1000, // Short timeout for streaming
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  });

  // Fire and forget - don't block streaming
  req.on('socket', (socket) => {
    socket.unref();
  });
  req.on('error', () => {
    // Silently ignore errors for streaming events
  });
  req.on('timeout', () => {
    req.destroy();
  });
  req.write(data);
  req.end();
}

interface CliExecOptions {
  prompt?: string; // Prompt via --prompt/-p option (preferred for multi-line)
  file?: string; // Read prompt from file
  tool?: string;
  mode?: string;
  model?: string;
  cd?: string;
  includeDirs?: string;
  timeout?: string;
  stream?: boolean; // Enable streaming (default: false, caches output)
  resume?: string | boolean; // true = last, string = execution ID, comma-separated for merge
  id?: string; // Custom execution ID (e.g., IMPL-001-step1)
  noNative?: boolean; // Force prompt concatenation instead of native resume
  cache?: string | boolean; // Cache: true = auto from CONTEXT, string = comma-separated patterns/content
  injectMode?: 'none' | 'full' | 'progressive'; // Inject mode for cached content
  debug?: boolean; // Enable debug logging
}

/** Cache configuration parsed from --cache */
interface CacheConfig {
  patterns?: string[];       // @patterns to pack (items starting with @)
  content?: string;          // Additional text content (items not starting with @)
}

interface HistoryOptions {
  limit?: string;
  tool?: string;
  status?: string;
}

interface StorageOptions {
  all?: boolean;
  project?: string;
  cliHistory?: boolean;
  memory?: boolean;
  storageCache?: boolean;
  config?: boolean;
  force?: boolean;
}

interface OutputViewOptions {
  offset?: string;
  limit?: string;
  outputType?: 'stdout' | 'stderr' | 'both';
  turn?: string;
  raw?: boolean;
  final?: boolean; // Only output final result with usage hint
}

/**
 * Show storage information and management options
 */
async function storageAction(subAction: string | undefined, options: StorageOptions): Promise<void> {
  switch (subAction) {
    case 'info':
    case undefined:
      await showStorageInfo();
      break;
    case 'clean':
      await cleanStorage(options);
      break;
    case 'config':
      showStorageConfig();
      break;
    default:
      showStorageHelp();
  }
}

/**
 * Show storage information
 */
async function showStorageInfo(): Promise<void> {
  console.log(chalk.bold.cyan('\n  CCW Storage Information\n'));

  const config = getStorageConfig();
  const stats = getStorageStats();

  // Configuration
  console.log(chalk.bold.white('  Location:'));
  console.log(`    ${chalk.cyan(stats.rootPath)}`);
  if (config.isCustom) {
    console.log(chalk.gray(`    (Custom: CCW_DATA_DIR=${config.envVar})`));
  }
  console.log();

  // Summary
  console.log(chalk.bold.white('  Summary:'));
  console.log(`    Total Size:     ${chalk.yellow(formatBytes(stats.totalSize))}`);
  console.log(`    Projects:       ${chalk.yellow(stats.projectCount.toString())}`);
  console.log(`    Global DB:      ${stats.globalDb.exists ? chalk.green(formatBytes(stats.globalDb.size)) : chalk.gray('Not created')}`);
  console.log();

  // Projects breakdown
  if (stats.projects.length > 0) {
    console.log(chalk.bold.white('  Projects:'));
    console.log(chalk.gray('    ID               Size       History    Last Used'));
    console.log(chalk.gray('    ─────────────────────────────────────────────────────'));

    for (const project of stats.projects) {
      const historyInfo = project.cliHistory.recordCount !== undefined
        ? `${project.cliHistory.recordCount} records`
        : (project.cliHistory.exists ? 'Yes' : '-');

      console.log(
        `    ${chalk.dim(project.projectId)}  ` +
        `${formatBytes(project.totalSize).padStart(8)}   ` +
        `${historyInfo.padStart(10)}   ` +
        `${chalk.gray(formatTimeAgo(project.lastModified))}`
      );
    }
    console.log();
  }

  // Usage tips
  console.log(chalk.gray('  Commands:'));
  console.log(chalk.gray('    ccw cli storage clean              Clean all storage'));
  console.log(chalk.gray('    ccw cli storage clean --project <path>  Clean specific project'));
  console.log(chalk.gray('    ccw cli storage config             Show location config'));
  console.log();
}

/**
 * Clean storage
 */
async function cleanStorage(options: StorageOptions): Promise<void> {
  const { all, project, force, cliHistory, memory, storageCache, config } = options;

  // Determine what to clean
  const cleanTypes = {
    cliHistory: cliHistory || (!cliHistory && !memory && !storageCache && !config),
    memory: memory || (!cliHistory && !memory && !storageCache && !config),
    cache: storageCache || (!cliHistory && !memory && !storageCache && !config),
    config: config || false, // Config requires explicit flag
    all: !cliHistory && !memory && !storageCache && !config
  };

  if (project) {
    // Clean specific project
    const projectId = resolveProjectId(project);

    if (!projectExists(projectId)) {
      console.log(chalk.yellow(`\n  No storage found for project: ${project}`));
      console.log(chalk.gray(`  (Project ID: ${projectId})\n`));
      return;
    }

    if (!force) {
      console.log(chalk.bold.yellow('\n  Warning: This will delete storage for project:'));
      console.log(`    Path: ${project}`);
      console.log(`    ID:   ${projectId}`);
      console.log(chalk.gray('\n  Use --force to confirm deletion.\n'));
      return;
    }

    console.log(chalk.bold.cyan('\n  Cleaning project storage...\n'));
    const result = cleanProjectStorage(projectId, cleanTypes);

    if (result.success) {
      console.log(chalk.green(`  ✓ Cleaned ${formatBytes(result.freedBytes)}`));
    } else {
      console.log(chalk.red('  ✗ Cleanup completed with errors:'));
      for (const err of result.errors) {
        console.log(chalk.red(`    - ${err}`));
      }
    }
  } else {
    // Clean all storage
    const stats = getStorageStats();

    if (stats.projectCount === 0) {
      console.log(chalk.yellow('\n  No storage to clean.\n'));
      return;
    }

    if (!force) {
      console.log(chalk.bold.yellow('\n  Warning: This will delete ALL CCW storage:'));
      console.log(`    Location:  ${stats.rootPath}`);
      console.log(`    Projects:  ${stats.projectCount}`);
      console.log(`    Size:      ${formatBytes(stats.totalSize)}`);
      console.log(chalk.gray('\n  Use --force to confirm deletion.\n'));
      return;
    }

    console.log(chalk.bold.cyan('\n  Cleaning all storage...\n'));
    const result = cleanAllStorage(cleanTypes);

    if (result.success) {
      console.log(chalk.green(`  ✓ Cleaned ${result.projectsCleaned} projects, freed ${formatBytes(result.freedBytes)}`));
    } else {
      console.log(chalk.yellow(`  ⚠ Cleaned ${result.projectsCleaned} projects with some errors:`));
      for (const err of result.errors) {
        console.log(chalk.red(`    - ${err}`));
      }
    }
  }
  console.log();
}

/**
 * Show storage configuration
 */
function showStorageConfig(): void {
  console.log(getStorageLocationInstructions());
}

/**
 * Show storage help
 */
function showStorageHelp(): void {
  console.log(chalk.bold.cyan('\n  CCW Storage Management\n'));
  console.log('  Subcommands:');
  console.log(chalk.gray('    info                Show storage information (default)'));
  console.log(chalk.gray('    clean               Clean storage'));
  console.log(chalk.gray('    config              Show configuration instructions'));
  console.log();
  console.log('  Clean Options:');
  console.log(chalk.gray('    --project <path>    Clean specific project storage'));
  console.log(chalk.gray('    --force             Confirm deletion'));
  console.log(chalk.gray('    --cli-history       Clean only CLI history'));
  console.log(chalk.gray('    --memory            Clean only memory store'));
  console.log(chalk.gray('    --cache             Clean only cache'));
  console.log(chalk.gray('    --config            Clean config (requires explicit flag)'));
  console.log();
  console.log('  Examples:');
  console.log(chalk.gray('    ccw cli storage                           # Show storage info'));
  console.log(chalk.gray('    ccw cli storage clean --force             # Clean all storage'));
  console.log(chalk.gray('    ccw cli storage clean --project . --force # Clean current project'));
  console.log(chalk.gray('    ccw cli storage config                    # Show config instructions'));
  console.log();
}

/**
 * Show cached output for a conversation with pagination
 */
async function outputAction(conversationId: string | undefined, options: OutputViewOptions): Promise<void> {
  if (!conversationId) {
    console.error(chalk.red('Error: Conversation ID is required'));
    console.error(chalk.gray('Usage: ccw cli output <conversation-id> [--offset N] [--limit N]'));
    process.exit(1);
  }

  const store = getHistoryStore(process.cwd());
  const result = store.getCachedOutput(
    conversationId,
    options.turn ? parseInt(options.turn) : undefined,
    {
      offset: parseInt(options.offset || '0'),
      limit: parseInt(options.limit || '10000'),
      outputType: options.outputType || 'both'
    }
  );

  if (!result) {
    console.error(chalk.red(`Error: Execution not found: ${conversationId}`));
    process.exit(1);
  }

  if (options.raw) {
    // Raw output only (for piping)
    if (result.stdout) console.log(result.stdout.content);
    return;
  }

  if (options.final) {
    // Final result only with usage hint
    if (result.stdout) {
      console.log(result.stdout.content);
    }
    console.log();
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.dim(`Usage: ccw cli output ${conversationId} [options]`));
    console.log(chalk.dim('  --raw           Raw output (no hint)'));
    console.log(chalk.dim('  --offset <n>    Start from byte offset'));
    console.log(chalk.dim('  --limit <n>     Limit output bytes'));
    console.log(chalk.dim(`  --resume        ccw cli -p "..." --resume ${conversationId}`));
    return;
  }

  // Formatted output
  console.log(chalk.bold.cyan('Execution Output\n'));
  console.log(`  ${chalk.gray('ID:')}        ${result.conversationId}`);
  console.log(`  ${chalk.gray('Turn:')}      ${result.turnNumber}`);
  console.log(`  ${chalk.gray('Cached:')}    ${result.cached ? chalk.green('Yes') : chalk.yellow('No')}`);
  console.log(`  ${chalk.gray('Status:')}    ${result.status}`);
  console.log(`  ${chalk.gray('Time:')}      ${result.timestamp}`);
  console.log();

  if (result.stdout) {
    console.log(`  ${chalk.gray('Stdout:')} (${result.stdout.totalBytes} bytes, offset ${result.stdout.offset})`);
    console.log(chalk.gray('  ' + '-'.repeat(60)));
    console.log(result.stdout.content);
    console.log(chalk.gray('  ' + '-'.repeat(60)));
    if (result.stdout.hasMore) {
      console.log(chalk.yellow(`  ... ${result.stdout.totalBytes - result.stdout.offset - result.stdout.content.length} more bytes available`));
      console.log(chalk.gray(`  Use --offset ${result.stdout.offset + result.stdout.content.length} to continue`));
    }
    console.log();
  }

  if (result.stderr && result.stderr.content) {
    console.log(`  ${chalk.gray('Stderr:')} (${result.stderr.totalBytes} bytes, offset ${result.stderr.offset})`);
    console.log(chalk.gray('  ' + '-'.repeat(60)));
    console.log(result.stderr.content);
    console.log(chalk.gray('  ' + '-'.repeat(60)));
    if (result.stderr.hasMore) {
      console.log(chalk.yellow(`  ... ${result.stderr.totalBytes - result.stderr.offset - result.stderr.content.length} more bytes available`));
    }
    console.log();
  }
}

/**
 * Test endpoint for debugging multi-line prompt parsing
 * Shows exactly how Commander.js parsed the arguments
 */
function testParseAction(args: string[], options: CliExecOptions): void {
  console.log(chalk.bold.cyan('\n  ═══════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('  │       CLI PARSE TEST ENDPOINT              │'));
  console.log(chalk.bold.cyan('  ═══════════════════════════════════════════════\n'));

  // Show args array parsing
  console.log(chalk.bold.yellow('📦 Positional Arguments (args[]):'));
  console.log(chalk.gray('   Length: ') + chalk.white(args.length));
  if (args.length === 0) {
    console.log(chalk.gray('   (empty)'));
  } else {
    args.forEach((arg, i) => {
      console.log(chalk.gray(`   [${i}]: `) + chalk.green(`"${arg}"`));
      // Show if multiline
      if (arg.includes('\n')) {
        console.log(chalk.yellow(`        ↳ Contains ${arg.split('\n').length} lines`));
      }
    });
  }

  console.log();

  // Show options parsing
  console.log(chalk.bold.yellow('⚙️  Options:'));
  const optionEntries = Object.entries(options).filter(([_, v]) => v !== undefined);
  if (optionEntries.length === 0) {
    console.log(chalk.gray('   (none)'));
  } else {
    optionEntries.forEach(([key, value]) => {
      const displayValue = typeof value === 'string' && value.includes('\n')
        ? `"${value.substring(0, 50)}..." (${value.split('\n').length} lines)`
        : JSON.stringify(value);
      console.log(chalk.gray(`   --${key}: `) + chalk.cyan(displayValue));
    });
  }

  console.log();

  // Show what would be used as prompt
  console.log(chalk.bold.yellow('🎯 Final Prompt Resolution:'));
  const { prompt: optionPrompt, file } = options;

  if (file) {
    console.log(chalk.gray('   Source: ') + chalk.magenta('--file/-f option'));
    console.log(chalk.gray('   File: ') + chalk.cyan(file));
  } else if (optionPrompt) {
    console.log(chalk.gray('   Source: ') + chalk.magenta('--prompt/-p option'));
    console.log(chalk.gray('   Value: ') + chalk.green(`"${optionPrompt.substring(0, 100)}${optionPrompt.length > 100 ? '...' : ''}"`));
    if (optionPrompt.includes('\n')) {
      console.log(chalk.yellow(`   ↳ Multiline: ${optionPrompt.split('\n').length} lines`));
    }
  } else if (args[0]) {
    console.log(chalk.gray('   Source: ') + chalk.magenta('positional argument (args[0])'));
    console.log(chalk.gray('   Value: ') + chalk.green(`"${args[0].substring(0, 100)}${args[0].length > 100 ? '...' : ''}"`));
    if (args[0].includes('\n')) {
      console.log(chalk.yellow(`   ↳ Multiline: ${args[0].split('\n').length} lines`));
    }
  } else {
    console.log(chalk.red('   No prompt found!'));
  }

  console.log();

  // Show raw debug info
  console.log(chalk.bold.yellow('🔍 Raw Debug Info:'));
  console.log(chalk.gray('   process.argv:'));
  process.argv.forEach((arg, i) => {
    console.log(chalk.gray(`     [${i}]: `) + chalk.dim(arg.length > 60 ? arg.substring(0, 60) + '...' : arg));
  });

  console.log(chalk.bold.cyan('\n  ═══════════════════════════════════════════════\n'));
}

/**
 * Show CLI tool status
 */
async function statusAction(debug?: boolean): Promise<void> {
  // Enable debug mode if --debug flag is set
  if (debug) {
    process.env.DEBUG = 'true';
    console.log(chalk.yellow('  Debug mode enabled\n'));
  }

  console.log(chalk.bold.cyan('\n  CLI Tools Status\n'));

  const status = await getCliToolsStatus();

  for (const [tool, info] of Object.entries(status)) {
    const statusIcon = info.available ? chalk.green('●') : chalk.red('○');
    const statusText = info.available ? chalk.green('Available') : chalk.red('Not Found');

    console.log(`  ${statusIcon} ${chalk.bold.white(tool.padEnd(10))} ${statusText}`);
    if (info.available && info.path) {
      console.log(chalk.gray(`      ${info.path}`));
    }
  }

  console.log();
}

/**
 * Execute a CLI tool
 * @param {string} prompt - Prompt to execute
 * @param {Object} options - CLI options
 */
async function execAction(positionalPrompt: string | undefined, options: CliExecOptions): Promise<void> {
  const { prompt: optionPrompt, file, tool = 'gemini', mode = 'analysis', model, cd, includeDirs, timeout, stream, resume, id, noNative, cache, injectMode, debug } = options;

  // Enable debug mode if --debug flag is set
  if (debug) {
    process.env.DEBUG = 'true';
    console.log(chalk.yellow('  Debug mode enabled\n'));
  }

  // Priority: 1. --file, 2. --prompt/-p option, 3. positional argument
  let finalPrompt: string | undefined;

  if (file) {
    // Read from file
    const { readFileSync, existsSync } = await import('fs');
    const { resolve } = await import('path');
    const filePath = resolve(file);
    if (!existsSync(filePath)) {
      console.error(chalk.red(`Error: File not found: ${filePath}`));
      process.exit(1);
    }
    finalPrompt = readFileSync(filePath, 'utf8').trim();
    if (!finalPrompt) {
      console.error(chalk.red('Error: File is empty'));
      process.exit(1);
    }
  } else if (optionPrompt) {
    // Use --prompt/-p option (preferred for multi-line)
    finalPrompt = optionPrompt;
  } else {
    // Fall back to positional argument
    finalPrompt = positionalPrompt;
  }

  // Prompt is required unless resuming
  if (!finalPrompt && !resume) {
    console.error(chalk.red('Error: Prompt is required'));
    console.error(chalk.gray('Usage: ccw cli -p "<prompt>" --tool gemini'));
    console.error(chalk.gray('   or: ccw cli -f prompt.txt --tool codex'));
    console.error(chalk.gray('   or: ccw cli --resume --tool gemini'));
    process.exit(1);
  }

  const prompt_to_use = finalPrompt || '';

  // Handle cache option: pack @patterns and/or content
  let cacheSessionId: string | undefined;
  let actualPrompt = prompt_to_use;

  if (cache) {
    const { handler: contextCacheHandler } = await import('../tools/context-cache.js');

    // Parse cache config from comma-separated string
    // Items starting with @ are patterns, others are text content
    let cacheConfig: CacheConfig = {};

    if (cache === true) {
      // --cache without value: auto-extract from CONTEXT field
      const contextMatch = prompt_to_use.match(/CONTEXT:\s*([^\n]+)/i);
      if (contextMatch) {
        const contextLine = contextMatch[1];
        const patternMatches = contextLine.matchAll(/@[^\s|]+/g);
        cacheConfig.patterns = Array.from(patternMatches).map(m => m[0]);
      }
    } else if (typeof cache === 'string') {
      // Parse comma-separated items: @patterns and text content
      const items = cache.split(',').map(s => s.trim()).filter(Boolean);
      const patterns: string[] = [];
      const contentParts: string[] = [];

      for (const item of items) {
        if (item.startsWith('@')) {
          patterns.push(item);
        } else {
          contentParts.push(item);
        }
      }

      if (patterns.length > 0) {
        cacheConfig.patterns = patterns;
      }
      if (contentParts.length > 0) {
        cacheConfig.content = contentParts.join('\n');
      }
    }

    // Also extract patterns from CONTEXT if not provided
    if ((!cacheConfig.patterns || cacheConfig.patterns.length === 0) && prompt_to_use) {
      const contextMatch = prompt_to_use.match(/CONTEXT:\s*([^\n]+)/i);
      if (contextMatch) {
        const contextLine = contextMatch[1];
        const patternMatches = contextLine.matchAll(/@[^\s|]+/g);
        cacheConfig.patterns = Array.from(patternMatches).map(m => m[0]);
      }
    }

    // Pack if we have patterns or content
    if ((cacheConfig.patterns && cacheConfig.patterns.length > 0) || cacheConfig.content) {
      const patternCount = cacheConfig.patterns?.length || 0;
      const hasContent = !!cacheConfig.content;
      console.log(chalk.gray(`  Caching: ${patternCount} pattern(s)${hasContent ? ' + text content' : ''}...`));

      const cacheResult = await contextCacheHandler({
        operation: 'pack',
        patterns: cacheConfig.patterns,
        content: cacheConfig.content,
        cwd: cd || process.cwd(),
        include_dirs: includeDirs ? includeDirs.split(',') : undefined,
      });

      if (cacheResult.success && cacheResult.result) {
        const packResult = cacheResult.result as { session_id: string; files_packed: number; total_bytes: number };
        cacheSessionId = packResult.session_id;
        console.log(chalk.gray(`  Cached: ${packResult.files_packed} files, ${packResult.total_bytes} bytes`));
        console.log(chalk.gray(`  Session: ${cacheSessionId}`));

        // Determine inject mode:
        // --inject-mode explicitly set > tool default (codex=full, others=none)
        const effectiveInjectMode = injectMode ?? (tool === 'codex' ? 'full' : 'none');

        if (effectiveInjectMode !== 'none' && cacheSessionId) {
          if (effectiveInjectMode === 'full') {
            // Read full cache content
            const readResult = await contextCacheHandler({
              operation: 'read',
              session_id: cacheSessionId,
              offset: 0,
              limit: 1024 * 1024, // 1MB max
            });

            if (readResult.success && readResult.result) {
              const { content: cachedContent, total_bytes } = readResult.result as { content: string; total_bytes: number };
              console.log(chalk.gray(`  Injecting ${total_bytes} bytes (full mode)...`));
              actualPrompt = `=== CACHED CONTEXT (${packResult.files_packed} files) ===\n${cachedContent}\n\n=== USER PROMPT ===\n${prompt_to_use}`;
            }
          } else if (effectiveInjectMode === 'progressive') {
            // Progressive mode: read first page only (64KB default)
            const pageLimit = 65536;
            const readResult = await contextCacheHandler({
              operation: 'read',
              session_id: cacheSessionId,
              offset: 0,
              limit: pageLimit,
            });

            if (readResult.success && readResult.result) {
              const { content: cachedContent, total_bytes, has_more, next_offset } = readResult.result as {
                content: string; total_bytes: number; has_more: boolean; next_offset: number | null
              };
              console.log(chalk.gray(`  Injecting ${cachedContent.length}/${total_bytes} bytes (progressive mode)...`));

              const moreInfo = has_more
                ? `\n[... ${total_bytes - cachedContent.length} more bytes available via: context_cache(operation="read", session_id="${cacheSessionId}", offset=${next_offset}) ...]`
                : '';

              actualPrompt = `=== CACHED CONTEXT (${packResult.files_packed} files, progressive) ===\n${cachedContent}${moreInfo}\n\n=== USER PROMPT ===\n${prompt_to_use}`;
            }
          }
        }

        console.log();
      } else {
        console.log(chalk.yellow(`  Cache warning: ${cacheResult.error}`));
      }
    }
  }

  // Parse resume IDs for merge scenario
  const resumeIds = resume && typeof resume === 'string' ? resume.split(',').map(s => s.trim()).filter(Boolean) : [];
  const isMerge = resumeIds.length > 1;

  // Show execution mode
  let resumeInfo = '';
  if (isMerge) {
    resumeInfo = ` merging ${resumeIds.length} conversations`;
  } else if (resume) {
    resumeInfo = typeof resume === 'string' ? ` resuming ${resume}` : ' resuming last';
  }
  const nativeMode = noNative ? ' (prompt-concat)' : '';
  const idInfo = id ? ` [${id}]` : '';

  // Show merge details
  if (isMerge) {
    console.log(chalk.gray('  Merging conversations:'));
    for (const rid of resumeIds) {
      console.log(chalk.gray(`    • ${rid}`));
    }
    console.log();
  }

  // Generate execution ID for streaming (use custom ID or timestamp-based)
  const executionId = id || `${Date.now()}-${tool}`;
  const startTime = Date.now();
  const spinnerBaseText = `Executing ${tool} (${mode} mode${resumeInfo}${nativeMode})${idInfo}...`;
  console.log();

  const spinner = stream ? null : createSpinner(`  ${spinnerBaseText}`).start();
  const elapsedInterval = spinner
    ? setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      spinner.text = `  ${spinnerBaseText} (${elapsedSeconds}s elapsed)`;
    }, 1000)
    : null;
  elapsedInterval?.unref?.();

  if (!spinner) {
    console.log(chalk.cyan(`  ${spinnerBaseText}\n`));
  }

  // Handle process interruption (SIGINT/SIGTERM) to notify dashboard
  const handleInterrupt = (signal: string) => {
    const duration = Date.now() - startTime;
    if (elapsedInterval) clearInterval(elapsedInterval);
    if (spinner) {
      spinner.warn(`Interrupted by ${signal} (${Math.floor(duration / 1000)}s elapsed)`);
    } else {
      console.log(chalk.yellow(`\n  Interrupted by ${signal}`));
    }

    // Kill child process (gemini/codex/qwen CLI) if running
    killCurrentCliProcess();

    // Broadcast interruption to dashboard
    broadcastStreamEvent('CLI_EXECUTION_COMPLETED', {
      executionId,
      success: false,
      duration,
      interrupted: true
    });

    // Give time for the event to be sent before exiting
    setTimeout(() => process.exit(130), 100);
  };

  process.on('SIGINT', () => handleInterrupt('SIGINT'));
  process.on('SIGTERM', () => handleInterrupt('SIGTERM'));

  // Notify dashboard: execution started (legacy)
  notifyDashboard({
    event: 'started',
    tool,
    mode,
    prompt_preview: prompt_to_use.substring(0, 100) + (prompt_to_use.length > 100 ? '...' : ''),
    custom_id: id || null
  });

  // Broadcast CLI_EXECUTION_STARTED for real-time streaming viewer
  // Note: /api/hook wraps extraData into payload, so send fields directly
  broadcastStreamEvent('CLI_EXECUTION_STARTED', {
    executionId,
    tool,
    mode
  });

  // Streaming output handler - broadcasts to dashboard AND writes to stdout
  const onOutput = (chunk: any) => {
    // Always broadcast to dashboard for real-time viewing
    // Note: /api/hook wraps extraData into payload, so send fields directly
    broadcastStreamEvent('CLI_OUTPUT', {
      executionId,
      chunkType: chunk.type,
      data: chunk.data
    });
    // Write to terminal only when --stream flag is passed
    if (stream) {
      process.stdout.write(chunk.data);
    }
  };

  try {
    const result = await cliExecutorTool.execute({
      tool,
      prompt: actualPrompt,
      mode,
      model,
      cd,
      includeDirs,
      timeout: timeout ? parseInt(timeout, 10) : 0, // 0 = no internal timeout, controlled by external caller
      resume,
      id, // custom execution ID
      noNative,
      stream: !!stream // stream=true → streaming enabled (no cache), stream=false → cache output (default)
    }, onOutput); // Always pass onOutput for real-time dashboard streaming

    if (elapsedInterval) clearInterval(elapsedInterval);
    if (spinner) {
      const durationSeconds = (result.execution.duration_ms / 1000).toFixed(1);
      const turnInfo = result.success && result.conversation.turn_count > 1
        ? ` (turn ${result.conversation.turn_count})`
        : '';
      if (result.success) {
        spinner.succeed(`Completed in ${durationSeconds}s${turnInfo}`);
      } else {
        spinner.fail(`Failed after ${durationSeconds}s`);
      }
    }

    // If not streaming (default), print output now
    if (!stream && result.stdout) {
      console.log(result.stdout);
    }

    // Print summary with execution ID and turn info
    console.log();
    if (result.success) {
      if (!spinner) {
        const turnInfo = result.conversation.turn_count > 1
          ? ` (turn ${result.conversation.turn_count})`
          : '';
        console.log(chalk.green(`  ✓ Completed in ${(result.execution.duration_ms / 1000).toFixed(1)}s${turnInfo}`));
      }
      console.log(chalk.gray(`  ID: ${result.execution.id}`));
      if (isMerge && !id) {
        // Merge without custom ID: updated all source conversations
        console.log(chalk.gray(`  Updated ${resumeIds.length} conversations: ${resumeIds.join(', ')}`));
      } else if (isMerge && id) {
        // Merge with custom ID: created new merged conversation
        console.log(chalk.gray(`  Created merged conversation from ${resumeIds.length} sources`));
      }
      if (result.conversation.turn_count > 1) {
        console.log(chalk.gray(`  Total: ${result.conversation.turn_count} turns, ${(result.conversation.total_duration_ms / 1000).toFixed(1)}s`));
      }
      console.log(chalk.dim(`  Continue: ccw cli -p "..." --resume ${result.execution.id}`));
      if (!stream) {
        console.log(chalk.dim(`  Output (optional): ccw cli output ${result.execution.id}`));
      }

      // Notify dashboard: execution completed (legacy)
      notifyDashboard({
        event: 'completed',
        tool,
        mode,
        execution_id: result.execution.id,
        success: true,
        duration_ms: result.execution.duration_ms,
        turn_count: result.conversation.turn_count
      });

      // Broadcast CLI_EXECUTION_COMPLETED for real-time streaming viewer
      broadcastStreamEvent('CLI_EXECUTION_COMPLETED', {
        executionId,  // Use the same executionId as started event
        success: true,
        duration: result.execution.duration_ms
      });

      // Ensure clean exit after successful execution
      // Delay to allow HTTP request to complete
      setTimeout(() => process.exit(0), 150);
    } else {
      if (!spinner) {
        console.log(chalk.red(`  ✗ Failed (${result.execution.status})`));
      }
      console.log(chalk.gray(`  ID: ${result.execution.id}`));
      console.log(chalk.gray(`  Duration: ${(result.execution.duration_ms / 1000).toFixed(1)}s`));
      console.log(chalk.gray(`  Exit Code: ${result.execution.exit_code}`));

      // Show stderr with better formatting
      if (result.stderr) {
        console.log();
        console.log(chalk.red.bold('  Error Output:'));
        console.log(chalk.gray('  ' + '─'.repeat(60)));
        // Indent stderr for better readability
        const stderrLines = result.stderr.split('\n');
        for (const line of stderrLines.slice(0, 30)) { // Limit to 30 lines
          console.error(chalk.red(`  ${line}`));
        }
        if (stderrLines.length > 30) {
          console.log(chalk.yellow(`  ... ${stderrLines.length - 30} more lines`));
        }
        console.log(chalk.gray('  ' + '─'.repeat(60)));
      }

      // Show troubleshooting hints
      console.log();
      console.log(chalk.yellow.bold('  Troubleshooting:'));
      console.log(chalk.gray(`    • Check if ${tool} is properly installed: ccw cli status`));
      console.log(chalk.gray(`    • Enable debug mode: DEBUG=true ccw cli -p "..."  or  set DEBUG=true && ccw cli -p "..."`));
      console.log(chalk.gray(`    • View full output: ccw cli output ${result.execution.id}`));
      if (result.stderr?.includes('API key') || result.stderr?.includes('Authentication')) {
        console.log(chalk.gray(`    • Check API key configuration for ${tool}`));
      }
      if (result.stderr?.includes('rate limit')) {
        console.log(chalk.gray(`    • Wait and retry - rate limit exceeded`));
      }

      // Notify dashboard: execution failed (legacy)
      notifyDashboard({
        event: 'completed',
        tool,
        mode,
        execution_id: result.execution.id,
        success: false,
        status: result.execution.status,
        duration_ms: result.execution.duration_ms
      });

      // Broadcast CLI_EXECUTION_COMPLETED for real-time streaming viewer
      broadcastStreamEvent('CLI_EXECUTION_COMPLETED', {
        executionId,  // Use the same executionId as started event
        success: false,
        duration: result.execution.duration_ms
      });

      // Delay to allow HTTP request to complete
      setTimeout(() => process.exit(1), 150);
    }
  } catch (error) {
    const err = error as Error;
    if (elapsedInterval) clearInterval(elapsedInterval);
    if (spinner) spinner.fail('Execution error');
    console.error(chalk.red.bold(`\n  ✗ Execution Error\n`));
    console.error(chalk.red(`  ${err.message}`));

    // Parse error message for additional context
    if (err.message.includes('Failed to spawn')) {
      console.log();
      console.log(chalk.yellow.bold('  Troubleshooting:'));
      console.log(chalk.gray(`    • Check if ${tool} is installed: npm ls -g @google/gemini-cli (or qwen/codex)`));
      console.log(chalk.gray(`    • Verify PATH includes npm global bin directory`));
      console.log(chalk.gray(`    • Run: ccw cli status`));
      console.log(chalk.gray(`    • Enable debug mode: DEBUG=true ccw cli -p "..."`));
    } else if (err.message.includes('not available')) {
      console.log();
      console.log(chalk.yellow.bold('  Troubleshooting:'));
      console.log(chalk.gray(`    • Install the tool: npm install -g <package-name>`));
      console.log(chalk.gray(`    • Run: ccw cli status`));
    }

    // Notify dashboard: execution error (legacy)
    notifyDashboard({
      event: 'error',
      tool,
      mode,
      error: err.message
    });

    // Broadcast CLI_EXECUTION_ERROR for real-time streaming viewer
    broadcastStreamEvent('CLI_EXECUTION_ERROR', {
      executionId,
      error: err.message
    });

    // Delay to allow HTTP request to complete
    setTimeout(() => process.exit(1), 150);
  }
}

/**
 * Show execution history
 * @param {Object} options - CLI options
 */
async function historyAction(options: HistoryOptions): Promise<void> {
  const { limit = '20', tool, status } = options;

  console.log(chalk.bold.cyan('\n  CLI Execution History\n'));

  // Use recursive: true to aggregate history from parent and child projects (matches Dashboard behavior)
  const history = await getExecutionHistoryAsync(process.cwd(), { limit: parseInt(limit, 10), tool, status, recursive: true });

  if (history.executions.length === 0) {
    console.log(chalk.gray('  No executions found.\n'));
    return;
  }

  // Count by tool
  const toolCounts: Record<string, number> = {};
  for (const exec of history.executions) {
    toolCounts[exec.tool] = (toolCounts[exec.tool] || 0) + 1;
  }
  const toolSummary = Object.entries(toolCounts).map(([t, c]) => `${t}:${c}`).join(' ');

  // Compact table header with tool breakdown
  console.log(chalk.gray(`  Total: ${history.total} | Showing: ${history.executions.length} (${toolSummary})\n`));
  console.log(chalk.gray('  Status  Tool      Time         Duration   ID'));
  console.log(chalk.gray('  ' + '─'.repeat(70)));

  for (const exec of history.executions) {
    const statusIcon = exec.status === 'success' ? chalk.green('●') :
                       exec.status === 'timeout' ? chalk.yellow('●') : chalk.red('●');
    const duration = exec.duration_ms >= 1000
      ? `${(exec.duration_ms / 1000).toFixed(1)}s`
      : `${exec.duration_ms}ms`;

    const timeAgo = getTimeAgo(new Date(exec.updated_at || exec.timestamp));
    const turnInfo = exec.turn_count && exec.turn_count > 1 ? chalk.cyan(`[${exec.turn_count}t]`) : '    ';

    // Compact format: status tool time duration [turns] + id on same line (no truncation)
    // Truncate prompt preview to 50 chars for compact display
    const shortPrompt = exec.prompt_preview.replace(/\n/g, ' ').substring(0, 50).trim();
    console.log(`  ${statusIcon}     ${chalk.bold.white(exec.tool.padEnd(8))}  ${chalk.gray(timeAgo.padEnd(11))}  ${chalk.gray(duration.padEnd(8))} ${turnInfo} ${chalk.dim(exec.id)}`);
    console.log(chalk.gray(`        ${shortPrompt}${exec.prompt_preview.length > 50 ? '...' : ''}`));
  }

  // Usage hint
  console.log();
  console.log(chalk.gray('  ' + '─'.repeat(70)));
  console.log(chalk.dim('  Filter: ccw cli history --tool <gemini|codex|qwen> --limit <n>'));
  console.log(chalk.dim('  Output: ccw cli output <id> --final'));
  console.log();
}

/**
 * Show conversation detail with all turns
 * @param {string} conversationId - Conversation ID
 */
async function detailAction(conversationId: string | undefined): Promise<void> {
  if (!conversationId) {
    console.error(chalk.red('Error: Conversation ID is required'));
    console.error(chalk.gray('Usage: ccw cli detail <conversation-id>'));
    process.exit(1);
  }

  const conversation = getConversationDetail(process.cwd(), conversationId);

  if (!conversation) {
    console.error(chalk.red(`Error: Conversation not found: ${conversationId}`));
    process.exit(1);
  }

  console.log(chalk.bold.cyan('\n  Conversation Detail\n'));
  console.log(`  ${chalk.gray('ID:')}         ${conversation.id}`);
  console.log(`  ${chalk.gray('Tool:')}       ${conversation.tool}`);
  console.log(`  ${chalk.gray('Model:')}      ${conversation.model}`);
  console.log(`  ${chalk.gray('Mode:')}       ${conversation.mode}`);
  console.log(`  ${chalk.gray('Status:')}     ${conversation.latest_status}`);
  console.log(`  ${chalk.gray('Turns:')}      ${conversation.turn_count}`);
  console.log(`  ${chalk.gray('Duration:')}   ${(conversation.total_duration_ms / 1000).toFixed(1)}s total`);
  console.log(`  ${chalk.gray('Created:')}    ${conversation.created_at}`);
  if (conversation.turn_count > 1) {
    console.log(`  ${chalk.gray('Updated:')}    ${conversation.updated_at}`);
  }

  // Show all turns
  for (const turn of conversation.turns) {
    console.log(chalk.bold.cyan(`\n  ═══ Turn ${turn.turn} ═══`));
    console.log(chalk.gray(`  ${turn.timestamp} | ${turn.status} | ${(turn.duration_ms / 1000).toFixed(1)}s`));

    console.log(chalk.bold.white('\n  Prompt:'));
    console.log(chalk.gray('  ' + turn.prompt.split('\n').join('\n  ')));

    if (turn.output.stdout) {
      console.log(chalk.bold.white('\n  Output:'));
      console.log(turn.output.stdout);
    }

    if (turn.output.stderr) {
      console.log(chalk.bold.red('\n  Errors:'));
      console.log(turn.output.stderr);
    }

    if (turn.output.truncated) {
      console.log(chalk.yellow('\n  Note: Output was truncated due to size.'));
    }
  }

  console.log(chalk.dim(`\n  Continue: ccw cli -p "..." --resume ${conversation.id}`));
  console.log();
}

/**
 * Get human-readable time ago string
 * @param {Date} date
 * @returns {string}
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

/**ccw cli -p
 * CLI command entry point
 * @param {string} subcommand - Subcommand (status, exec, history, detail)
 * @param {string[]} args - Arguments array
 * @param {Object} options - CLI options
 */
export async function cliCommand(
  subcommand: string,
  args: string | string[],
  options: CliExecOptions | HistoryOptions
): Promise<void> {
  const argsArray = Array.isArray(args) ? args : (args ? [args] : []);

  switch (subcommand) {
    case 'status':
      await statusAction((options as CliExecOptions).debug);
      break;

    case 'history':
      await historyAction(options as HistoryOptions);
      break;

    case 'detail':
      await detailAction(argsArray[0]);
      break;

    case 'storage':
      await storageAction(argsArray[0], options as unknown as StorageOptions);
      break;

    case 'output':
      await outputAction(argsArray[0], options as unknown as OutputViewOptions);
      break;

    case 'test-parse':
      // Test endpoint to debug multi-line prompt parsing
      testParseAction(argsArray, options as CliExecOptions);
      break;

    default: {
      const execOptions = options as CliExecOptions;
      // Auto-exec if: has -p/--prompt, has -f/--file, has --resume, or subcommand looks like a prompt
      const hasPromptOption = !!execOptions.prompt;
      const hasFileOption = !!execOptions.file;
      const hasResume = execOptions.resume !== undefined;
      const subcommandIsPrompt = subcommand && !subcommand.startsWith('-');

      if (hasPromptOption || hasFileOption || hasResume || subcommandIsPrompt) {
        // Treat as exec: use subcommand as positional prompt if no -p/-f option
        const positionalPrompt = subcommandIsPrompt ? subcommand : undefined;
        await execAction(positionalPrompt, execOptions);
      } else {
        // Show help
        console.log(chalk.bold.cyan('\n  CCW CLI Tool Executor\n'));
        console.log('  Unified interface for Gemini, Qwen, and Codex CLI tools.\n');
        console.log('  Usage:');
        console.log(chalk.gray('    ccw cli -p "<prompt>" --tool <tool>     Execute with prompt'));
        console.log(chalk.gray('    ccw cli -f prompt.txt --tool <tool>     Execute from file'));
        console.log();
        console.log('  Subcommands:');
        console.log(chalk.gray('    status              Check CLI tools availability'));
        console.log(chalk.gray('    storage [cmd]       Manage CCW storage (info/clean/config)'));
        console.log(chalk.gray('    history             Show execution history'));
        console.log(chalk.gray('    detail <id>         Show execution detail'));
        console.log(chalk.gray('    output <id>         Show execution output with pagination'));
        console.log(chalk.gray('    test-parse [args]   Debug CLI argument parsing'));
        console.log();
        console.log('  Options:');
        console.log(chalk.gray('    -p, --prompt <text> Prompt text'));
        console.log(chalk.gray('    -f, --file <file>   Read prompt from file'));
        console.log(chalk.gray('    --tool <tool>       Tool: gemini, qwen, codex (default: gemini)'));
        console.log(chalk.gray('    --mode <mode>       Mode: analysis, write, auto (default: analysis)'));
        console.log(chalk.gray('    -d, --debug         Enable debug logging for troubleshooting'));
        console.log(chalk.gray('    --model <model>     Model override'));
        console.log(chalk.gray('    --cd <path>         Working directory'));
        console.log(chalk.gray('    --includeDirs <dirs>  Additional directories'));
        console.log(chalk.gray('    --timeout <ms>      Timeout (default: 0=disabled)'));
        console.log(chalk.gray('    --resume [id]       Resume previous session'));
        console.log(chalk.gray('    --cache <items>     Cache: comma-separated @patterns and text'));
        console.log(chalk.gray('    --inject-mode <m>   Inject mode: none, full, progressive'));
        console.log();
        console.log('  Cache format:');
        console.log(chalk.gray('    --cache "@src/**/*.ts,@CLAUDE.md"     # @patterns to pack'));
        console.log(chalk.gray('    --cache "@src/**/*,extra context"     # patterns + text content'));
        console.log(chalk.gray('    --cache                               # auto from CONTEXT field'));
        console.log();
        console.log('  Inject modes:');
        console.log(chalk.gray('    none:        cache only, no injection (default for gemini/qwen)'));
        console.log(chalk.gray('    full:        inject all cached content (default for codex)'));
        console.log(chalk.gray('    progressive: inject first 64KB with MCP continuation hint'));
        console.log();
        console.log('  Output options (ccw cli output <id>):');
        console.log(chalk.gray('    --final      Final result only with usage hint'));
        console.log(chalk.gray('    --raw        Raw output only (no formatting, for piping)'));
        console.log(chalk.gray('    --offset <n> Start from byte offset'));
        console.log(chalk.gray('    --limit <n>  Limit output bytes'));
        console.log();
        console.log('  Examples:');
        console.log(chalk.gray('    ccw cli -p "Analyze auth module" --tool gemini'));
        console.log(chalk.gray('    ccw cli -f prompt.txt --tool codex --mode write'));
        console.log(chalk.gray('    ccw cli -p "$(cat template.md)" --tool gemini'));
        console.log(chalk.gray('    ccw cli --resume --tool gemini'));
        console.log(chalk.gray('    ccw cli -p "..." --cache "@src/**/*.ts" --tool codex'));
        console.log(chalk.gray('    ccw cli -p "..." --cache "@src/**/*" --inject-mode progressive --tool gemini'));
        console.log(chalk.gray('    ccw cli output <id> --final      # View result with usage hint'));
        console.log();
      }
    }
  }
}
