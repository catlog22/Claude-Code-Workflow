/**
 * Detect Changed Modules Tool
 * Find modules affected by git changes or recent modifications
 */

import { z } from 'zod';
import type { ToolSchema, ToolResult } from '../types/tool.js';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname, extname, relative } from 'path';
import { execSync } from 'child_process';
import { EXEC_TIMEOUTS } from '../utils/exec-constants.js';

function isExecTimeoutError(error: unknown): boolean {
  const err = error as { code?: unknown; errno?: unknown; message?: unknown } | null;
  const code = err?.code ?? err?.errno;
  if (code === 'ETIMEDOUT') return true;
  const message = typeof err?.message === 'string' ? err.message : '';
  return message.includes('ETIMEDOUT');
}

// Source file extensions to track
const SOURCE_EXTENSIONS = [
  '.md', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h',
  '.sh', '.ps1', '.json', '.yaml', '.yml'
];

// Directories to exclude
const EXCLUDE_DIRS = [
  '.git', '__pycache__', 'node_modules', '.venv', 'venv', 'env',
  'dist', 'build', '.cache', '.pytest_cache', '.mypy_cache',
  'coverage', '.nyc_output', 'logs', 'tmp', 'temp'
];

// Define Zod schema for validation
const ParamsSchema = z.object({
  format: z.enum(['list', 'grouped', 'paths']).default('paths'),
  path: z.string().default('.'),
});

type Params = z.infer<typeof ParamsSchema>;

interface ModuleResult {
  depth: number;
  path: string;
  files: number;
  types: string[];
  has_claude: boolean;
}

interface ToolOutput {
  format: string;
  change_source: 'git' | 'mtime' | 'none';
  changed_files_count: number;
  affected_modules_count: number;
  results: ModuleResult[];
  output: string;
}

/**
 * Check if git is available and we're in a repo
 */
function isGitRepo(basePath: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: basePath, stdio: 'pipe', timeout: EXEC_TIMEOUTS.GIT_QUICK });
    return true;
  } catch (e: unknown) {
    if (isExecTimeoutError(e)) {
      console.warn(`[detect_changed_modules] git rev-parse timed out after ${EXEC_TIMEOUTS.GIT_QUICK}ms`);
    }
    return false;
  }
}

/**
 * Get changed files from git
 */
function getGitChangedFiles(basePath: string): string[] {
  try {
    // Get staged + unstaged changes
    let output = execSync('git diff --name-only HEAD 2>/dev/null', {
      cwd: basePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: EXEC_TIMEOUTS.GIT_DIFF,
    }).trim();

    const cachedOutput = execSync('git diff --name-only --cached 2>/dev/null', {
      cwd: basePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: EXEC_TIMEOUTS.GIT_DIFF,
    }).trim();

    if (cachedOutput) {
      output = output ? `${output}\n${cachedOutput}` : cachedOutput;
    }

    // If no working changes, check last commit
    if (!output) {
      output = execSync('git diff --name-only HEAD~1 HEAD 2>/dev/null', {
        cwd: basePath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: EXEC_TIMEOUTS.GIT_DIFF,
      }).trim();
    }

    return output ? output.split('\n').filter(f => f.trim()) : [];
  } catch (e: unknown) {
    if (isExecTimeoutError(e)) {
      console.warn(`[detect_changed_modules] git diff timed out after ${EXEC_TIMEOUTS.GIT_DIFF}ms`);
    }
    return [];
  }
}

/**
 * Find recently modified files (fallback when no git changes)
 */
function findRecentlyModified(basePath: string, hoursAgo: number = 24): string[] {
  const results: string[] = [];
  const cutoffTime = Date.now() - (hoursAgo * 60 * 60 * 1000);

  function scan(dirPath: string): void {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (EXCLUDE_DIRS.includes(entry.name)) continue;
          scan(join(dirPath, entry.name));
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (!SOURCE_EXTENSIONS.includes(ext)) continue;

          const fullPath = join(dirPath, entry.name);
          try {
            const stat = statSync(fullPath);
            if (stat.mtimeMs > cutoffTime) {
              results.push(relative(basePath, fullPath));
            }
          } catch (e) {
            // Skip files we can't stat
          }
        }
      }
    } catch (e) {
      // Ignore permission errors
    }
  }

  scan(basePath);
  return results;
}

/**
 * Extract unique parent directories from file list
 */
function extractDirectories(files: string[], basePath: string): string[] {
  const dirs = new Set<string>();

  for (const file of files) {
    const dir = dirname(file);
    if (dir === '.' || dir === '') {
      dirs.add('.');
    } else {
      dirs.add('./' + dir.replace(/\\/g, '/'));
    }
  }

  return Array.from(dirs).sort();
}

/**
 * Count files in directory
 */
function countFiles(dirPath: string): number {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isFile()).length;
  } catch (e) {
    return 0;
  }
}

/**
 * Get file types in directory
 */
function getFileTypes(dirPath: string): string[] {
  const types = new Set<string>();
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    entries.forEach(entry => {
      if (entry.isFile()) {
        const ext = extname(entry.name).slice(1);
        if (ext) types.add(ext);
      }
    });
  } catch (e) {
    // Ignore
  }
  return Array.from(types);
}

// Tool schema for MCP
export const schema: ToolSchema = {
  name: 'detect_changed_modules',
  description: `Detect modules affected by git changes or recent file modifications.
Features:
- Git-aware: detects staged, unstaged, or last commit changes
- Fallback: finds files modified in last 24 hours
- Respects .gitignore patterns

Output formats: list, grouped, paths (default)`,
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['list', 'grouped', 'paths'],
        description: 'Output format (default: paths)',
        default: 'paths'
      },
      path: {
        type: 'string',
        description: 'Target directory path (default: current directory)',
        default: '.'
      }
    },
    required: []
  }
};

// Handler function
export async function handler(params: Record<string, unknown>): Promise<ToolResult<ToolOutput>> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  const { format, path: targetPath } = parsed.data;

  try {
    const basePath = resolve(process.cwd(), targetPath);

    if (!existsSync(basePath)) {
      return { success: false, error: `Directory not found: ${basePath}` };
    }

    // Get changed files
    let changedFiles: string[] = [];
    let changeSource: 'git' | 'mtime' | 'none' = 'none';

    if (isGitRepo(basePath)) {
      changedFiles = getGitChangedFiles(basePath);
      changeSource = changedFiles.length > 0 ? 'git' : 'none';
    }

    // Fallback to recently modified files
    if (changedFiles.length === 0) {
      changedFiles = findRecentlyModified(basePath);
      changeSource = changedFiles.length > 0 ? 'mtime' : 'none';
    }

    // Extract affected directories
    const affectedDirs = extractDirectories(changedFiles, basePath);

    // Format output
    let output: string;
    const results: ModuleResult[] = [];

    for (const dir of affectedDirs) {
      const fullPath = dir === '.' ? basePath : resolve(basePath, dir);
      if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) continue;

      const fileCount = countFiles(fullPath);
      const types = getFileTypes(fullPath);
      const depth = dir === '.' ? 0 : (dir.match(/\//g) || []).length;
      const hasClaude = existsSync(join(fullPath, 'CLAUDE.md'));

      results.push({
        depth,
        path: dir,
        files: fileCount,
        types,
        has_claude: hasClaude
      });
    }

    switch (format) {
      case 'list':
        output = results.map(r =>
          `depth:${r.depth}|path:${r.path}|files:${r.files}|types:[${r.types.join(',')}]|has_claude:${r.has_claude ? 'yes' : 'no'}|status:changed`
        ).join('\n');
        break;

      case 'grouped':
        const maxDepth = results.length > 0 ? Math.max(...results.map(r => r.depth)) : 0;
        const lines = ['Affected modules by changes:'];

        for (let d = 0; d <= maxDepth; d++) {
          const atDepth = results.filter(r => r.depth === d);
          if (atDepth.length > 0) {
            lines.push(`  Depth ${d}:`);
            atDepth.forEach(r => {
              const claudeIndicator = r.has_claude ? ' [OK]' : '';
              lines.push(`    - ${r.path}${claudeIndicator} (changed)`);
            });
          }
        }

        if (results.length === 0) {
          lines.push('  No recent changes detected');
        }

        output = lines.join('\n');
        break;

      case 'paths':
      default:
        output = affectedDirs.join('\n');
        break;
    }

    return {
      success: true,
      result: {
        format,
        change_source: changeSource,
        changed_files_count: changedFiles.length,
        affected_modules_count: results.length,
        results,
        output
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to detect changed modules: ${(error as Error).message}`
    };
  }
}
