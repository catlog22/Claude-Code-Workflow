import { Command } from 'commander';
import { viewCommand } from './commands/view.js';
import { serveCommand } from './commands/serve.js';
import { stopCommand } from './commands/stop.js';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { upgradeCommand } from './commands/upgrade.js';
import { listCommand } from './commands/list.js';
import { toolCommand } from './commands/tool.js';
import { sessionCommand } from './commands/session.js';
import { cliCommand } from './commands/cli.js';
import { memoryCommand } from './commands/memory.js';
import { coreMemoryCommand } from './commands/core-memory.js';
import { hookCommand } from './commands/hook.js';
import { issueCommand } from './commands/issue.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * Load package.json with error handling
 * Tries root package.json first (../../package.json from dist),
 * then falls back to ccw package.json (../package.json from dist)
 * @returns Package info with version
 */
function loadPackageInfo(): PackageInfo {
  // First try root package.json (parent of ccw directory)
  const rootPkgPath = join(__dirname, '../../package.json');
  // Fallback to ccw package.json
  const ccwPkgPath = join(__dirname, '../package.json');

  try {
    // Try root package.json first
    if (existsSync(rootPkgPath)) {
      const content = readFileSync(rootPkgPath, 'utf8');
      return JSON.parse(content) as PackageInfo;
    }

    // Fallback to ccw package.json
    if (existsSync(ccwPkgPath)) {
      const content = readFileSync(ccwPkgPath, 'utf8');
      return JSON.parse(content) as PackageInfo;
    }

    console.error('Fatal Error: package.json not found.');
    console.error(`Tried locations:\n  - ${rootPkgPath}\n  - ${ccwPkgPath}`);
    process.exit(1);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('Fatal Error: package.json contains invalid JSON.');
      console.error(`Parse error: ${error.message}`);
    } else if (error instanceof Error) {
      console.error('Fatal Error: Could not read package.json.');
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

const pkg = loadPackageInfo();

export function run(argv: string[]): void {
  const program = new Command();

  program
    .name('ccw')
    .description('Claude Code Workflow CLI - Dashboard and workflow tools')
    .version(pkg.version);

  // View command (server mode with live path switching)
  program
    .command('view')
    .description('Open workflow dashboard server with live path switching')
    .option('-p, --path <path>', 'Path to project directory', '.')
    .option('--port <port>', 'Server port', '3456')
    .option('--host <host>', 'Server host to bind', '127.0.0.1')
    .option('--no-browser', 'Start server without opening browser')
    .action(viewCommand);

  // Serve command (alias for view)
  program
    .command('serve')
    .description('Alias for view command')
    .option('-p, --path <path>', 'Initial project directory')
    .option('--port <port>', 'Server port', '3456')
    .option('--host <host>', 'Server host to bind', '127.0.0.1')
    .option('--no-browser', 'Start server without opening browser')
    .action(serveCommand);

  // Stop command
  program
    .command('stop')
    .description('Stop the running CCW dashboard server')
    .option('--port <port>', 'Server port', '3456')
    .option('-f, --force', 'Force kill process on the port')
    .action(stopCommand);

  // Install command
  program
    .command('install')
    .description('Install Claude Code Workflow to your system (includes .codex/prompts)')
    .option('-m, --mode <mode>', 'Installation mode: Global or Path')
    .option('-p, --path <path>', 'Installation path (for Path mode)')
    .option('-f, --force', 'Force installation without prompts')
    .action(installCommand);

  // Uninstall command
  program
    .command('uninstall')
    .description('Uninstall Claude Code Workflow')
    .action(uninstallCommand);

  // Upgrade command
  program
    .command('upgrade')
    .description('Upgrade Claude Code Workflow installations')
    .option('-a, --all', 'Upgrade all installations without prompting')
    .action(upgradeCommand);

  // List command
  program
    .command('list')
    .description('List all installed Claude Code Workflow instances')
    .action(listCommand);

  // Tool command
  program
    .command('tool [subcommand] [args...]')
    .description('Execute CCW tools')
    .option('--path <path>', 'File path (for edit_file)')
    .option('--old <text>', 'Old text to replace (for edit_file)')
    .option('--new <text>', 'New text (for edit_file)')
    .option('--action <action>', 'Action to perform (for codex_lens)')
    .option('--query <query>', 'Search query (for codex_lens)')
    .option('--limit <n>', 'Max results (for codex_lens)', '20')
    .option('--file <file>', 'File path for symbol extraction (for codex_lens)')
    .option('--files <files>', 'Comma-separated file paths (for codex_lens update)')
    .option('--languages <langs>', 'Comma-separated languages (for codex_lens init)')
    .action((subcommand, args, options) => toolCommand(subcommand, args, options));

  // Session command
  program
    .command('session [subcommand] [args...]')
    .description('Workflow session lifecycle management')
    .option('--location <loc>', 'Session location: active|lite-plan|lite-fix (init); Filter: active|archived|both (list)')
    .option('--type <type>', 'Content type or session type')
    .option('--content <json>', 'Content for write/update')
    .option('--task-id <id>', 'Task ID for task content')
    .option('--filename <name>', 'Filename for process/chat/etc')
    .option('--dimension <dim>', 'Dimension for review-dim')
    .option('--iteration <iter>', 'Iteration for review-iter')
    .option('--subdir <dir>', 'Subdirectory for mkdir')
    .option('--raw', 'Output raw content only')
    .option('--no-metadata', 'Exclude metadata from list')
    .option('--no-update-status', 'Skip status update on archive')
    .action((subcommand, args, options) => sessionCommand(subcommand, args, options));

  // CLI command
  program
    .command('cli [subcommand] [args...]')
    .description('Unified CLI tool executor (gemini/qwen/codex/claude)')
    .option('-p, --prompt <prompt>', 'Prompt text (alternative to positional argument)')
    .option('-f, --file <file>', 'Read prompt from file (best for multi-line prompts)')
    .option('--tool <tool>', 'CLI tool to use', 'gemini')
    .option('--mode <mode>', 'Execution mode: analysis, write, auto', 'analysis')
    .option('-d, --debug', 'Enable debug logging for troubleshooting')
    .option('--model <model>', 'Model override')
    .option('--cd <path>', 'Working directory')
    .option('--includeDirs <dirs>', 'Additional directories (--include-directories for gemini/qwen, --add-dir for codex/claude)')
    .option('--timeout <ms>', 'Timeout in milliseconds (0=disabled, controlled by external caller)', '0')
    .option('--stream', 'Enable streaming output (default: non-streaming with caching)')
    .option('--limit <n>', 'History limit')
    .option('--status <status>', 'Filter by status')
    .option('--category <category>', 'Execution category: user, internal, insight', 'user')
    .option('--resume [id]', 'Resume previous session (empty=last, or execution ID, or comma-separated IDs for merge)')
    .option('--id <id>', 'Custom execution ID (e.g., IMPL-001-step1)')
    .option('--no-native', 'Force prompt concatenation instead of native resume')
    .option('--cache [items]', 'Cache: comma-separated @patterns and text content')
    .option('--inject-mode <mode>', 'Inject mode: none, full, progressive (default: codex=full, others=none)')
    // Storage options
    .option('--project <path>', 'Project path for storage operations')
    .option('--force', 'Confirm destructive operations')
    .option('--cli-history', 'Target CLI history storage')
    .option('--memory', 'Target memory storage')
    .option('--storage-cache', 'Target cache storage')
    .option('--config', 'Target config storage')
    // Cache subcommand options
    .option('--offset <n>', 'Character offset for cache pagination', '0')
    .option('--output-type <type>', 'Output type: stdout, stderr, both', 'both')
    .option('--turn <n>', 'Turn number for cache (default: latest)')
    .option('--raw', 'Raw output only (no formatting)')
    .option('--final', 'Output final result only with usage hint')
    .action((subcommand, args, options) => cliCommand(subcommand, args, options));

  // Memory command
  program
    .command('memory [subcommand] [args...]')
    .description('Memory module for context tracking and prompt optimization')
    .option('--type <type>', 'Entity type: file, module, topic (track) OR source type: core_memory, workflow, cli_history (search)')
    .option('--action <action>', 'Action: read, write, mention')
    .option('--value <value>', 'Entity value (file path, etc.)')
    .option('--session <session>', 'Session ID')
    .option('--stdin', 'Read input from stdin (for Claude Code hooks)')
    .option('--source <source>', 'Import source: history, sessions, all', 'all')
    .option('--project <project>', 'Project name filter')
    .option('--limit <n>', 'Number of results (prompt search)', '20')
    .option('--sort <field>', 'Sort by: heat, reads, writes', 'heat')
    .option('--json', 'Output as JSON')
    .option('--context <text>', 'Current task context')
    .option('--older-than <age>', 'Age threshold for pruning', '30d')
    .option('--dry-run', 'Preview without deleting')
    .option('--id <id>', 'Memory/session ID (for embed command)')
    .option('--force', 'Force re-embed all chunks')
    .option('--batch-size <n>', 'Batch size for embedding', '8')
    .option('--top-k <n>', 'Number of semantic search results', '10')
    .option('--min-score <f>', 'Minimum similarity score for semantic search', '0.5')
    .action((subcommand, args, options) => memoryCommand(subcommand, args, options));

  // Core Memory command
  program
    .command('core-memory [subcommand] [args...]')
    .description('Manage core memory entries for strategic context')
    .option('--id <id>', 'Memory ID')
    .option('--all', 'Archive all memories')
    .option('--before <date>', 'Archive memories before date (YYYY-MM-DD)')
    .option('--interactive', 'Interactive selection')
    .option('--archived', 'List archived memories')
    .option('--limit <n>', 'Number of results', '50')
    .option('--json', 'Output as JSON')
    .option('--force', 'Skip confirmation')
    .option('--tool <tool>', 'Tool to use for summary: gemini, qwen', 'gemini')
    .option('--auto', 'Run auto-clustering')
    .option('--scope <scope>', 'Auto-cluster scope: all, recent, unclustered', 'recent')
    .option('--create', 'Create new cluster')
    .option('--name <name>', 'Cluster name')
    .option('--members <ids>', 'Cluster member IDs (comma-separated)')
    .option('--status <status>', 'Cluster status filter')
    .option('--level <level>', 'Context level: metadata, keyFiles, full')
    .option('--delete', 'Delete a cluster')
    .option('--merge <ids>', 'Merge clusters into target (comma-separated source IDs)')
    .option('--dedup', 'Deduplicate clusters by merging similar ones')
    .option('--output <file>', 'Output file path for export')
    .option('--overwrite', 'Overwrite existing memories when importing')
    .option('--prefix <prefix>', 'Add prefix to imported memory IDs')
    .action((subcommand, args, options) => coreMemoryCommand(subcommand, args, options));

  // Hook command - CLI endpoint for Claude Code hooks
  program
    .command('hook [subcommand] [args...]')
    .description('CLI endpoint for Claude Code hooks (session-context, notify)')
    .option('--stdin', 'Read input from stdin (for Claude Code hooks)')
    .option('--session-id <id>', 'Session ID')
    .option('--prompt <text>', 'Prompt text')
    .option('--type <type>', 'Context type: session-start, context')
    .action((subcommand, args, options) => hookCommand(subcommand, args, options));

  // Issue command - Issue lifecycle management with JSONL task tracking
  program
    .command('issue [subcommand] [args...]')
    .description('Issue lifecycle management with JSONL task tracking')
    .option('--title <title>', 'Task title')
    .option('--type <type>', 'Task type: feature, bug, refactor, test, chore, docs')
    .option('--status <status>', 'Task status')
    .option('--phase <phase>', 'Execution phase')
    .option('--description <desc>', 'Task description')
    .option('--depends-on <ids>', 'Comma-separated dependency task IDs')
    .option('--delivery-criteria <items>', 'Pipe-separated delivery criteria')
    .option('--pause-criteria <items>', 'Pipe-separated pause criteria')
    .option('--executor <type>', 'Executor: agent, codex, gemini, auto')
    .option('--priority <n>', 'Task priority (1-5)')
    .option('--format <fmt>', 'Output format: json, markdown')
    .option('--json', 'Output as JSON')
    .option('--brief', 'Brief JSON output (minimal fields)')
    .option('--force', 'Force operation')
    // New options for solution/queue management
    .option('--solution <path>', 'Solution JSON file path')
    .option('--solution-id <id>', 'Solution ID')
    .option('--data <json>', 'JSON data for create/solution')
    .option('--result <json>', 'Execution result JSON')
    .option('--reason <text>', 'Failure reason')
    .option('--fail', 'Mark task as failed')
    .option('--from-queue [queue-id]', 'Sync issue statuses from queue (default: active queue)')
    .option('--queue <queue-id>', 'Target queue ID for multi-queue operations')
    .action((subcommand, args, options) => issueCommand(subcommand, args, options));

  program.parse(argv);
}
