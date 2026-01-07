/**
 * CLAUDE.md Freshness Calculator
 * Calculates freshness scores based on git changes since last update
 */

import { execSync } from 'child_process';
import { existsSync, statSync, readdirSync } from 'fs';
import { dirname, extname, relative, join } from 'path';
import { getCoreMemoryStore, ClaudeUpdateRecord } from './core-memory-store.js';
import { EXEC_TIMEOUTS } from '../utils/exec-constants.js';

function isExecTimeoutError(error: unknown): boolean {
  const err = error as { code?: unknown; errno?: unknown; message?: unknown } | null;
  const code = err?.code ?? err?.errno;
  if (code === 'ETIMEDOUT') return true;
  const message = typeof err?.message === 'string' ? err.message : '';
  return message.includes('ETIMEDOUT');
}

// Source file extensions to track (from detect-changed-modules.ts)
const SOURCE_EXTENSIONS = [
  '.md', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h',
  '.sh', '.ps1', '.json', '.yaml', '.yml'
];

// Directories to exclude
const EXCLUDE_DIRS = [
  '.git', '__pycache__', 'node_modules', '.venv', 'venv', 'env',
  'dist', 'build', '.cache', '.pytest_cache', '.mypy_cache',
  'coverage', '.nyc_output', 'logs', 'tmp', 'temp', '.ccw', '.workflow'
];

export interface FreshnessResult {
  path: string;
  level: 'user' | 'project' | 'module';
  relativePath: string;
  parentDirectory?: string;
  lastUpdated: string | null;
  lastModified: string;
  changedFilesCount: number;
  freshness: number;
  updateSource?: string;
  needsUpdate: boolean;
  changedFiles?: string[];
}

export interface FreshnessSummary {
  totalFiles: number;
  staleCount: number;
  averageFreshness: number;
  lastScanAt: string;
}

export interface FreshnessResponse {
  files: FreshnessResult[];
  summary: FreshnessSummary;
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
      console.warn(`[Claude Freshness] git rev-parse timed out after ${EXEC_TIMEOUTS.GIT_QUICK}ms`);
    }
    return false;
  }
}

/**
 * Get current git commit hash
 */
export function getCurrentGitCommit(basePath: string): string | null {
  try {
    const output = execSync('git rev-parse HEAD', {
      cwd: basePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: EXEC_TIMEOUTS.GIT_QUICK,
    }).trim();
    return output || null;
  } catch (e: unknown) {
    if (isExecTimeoutError(e)) {
      console.warn(`[Claude Freshness] git rev-parse HEAD timed out after ${EXEC_TIMEOUTS.GIT_QUICK}ms`);
    }
    return null;
  }
}

/**
 * Get files changed since a specific date within a directory
 */
function getChangedFilesSince(basePath: string, modulePath: string, sinceDate: string): string[] {
  try {
    // Format date for git
    const date = new Date(sinceDate);
    const formattedDate = date.toISOString().split('T')[0];

    // Get files changed since the date
    const output = execSync(
      `git log --name-only --since="${formattedDate}" --pretty=format: -- "${modulePath}"`,
      {
        cwd: basePath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: EXEC_TIMEOUTS.GIT_LOG,
      }
    ).trim();

    if (!output) return [];

    // Get unique files and filter by source extensions
    const files = [...new Set(output.split('\n').filter(f => f.trim()))];
    return files.filter(f => {
      const ext = extname(f).toLowerCase();
      return SOURCE_EXTENSIONS.includes(ext);
    });
  } catch (e: unknown) {
    if (isExecTimeoutError(e)) {
      console.warn(`[Claude Freshness] git log timed out after ${EXEC_TIMEOUTS.GIT_LOG}ms, falling back to mtime scan`);
    }
    // Fallback to mtime-based detection
    return findFilesModifiedSince(modulePath, sinceDate);
  }
}

/**
 * Fallback: Find files modified since a date using mtime
 */
function findFilesModifiedSince(dirPath: string, sinceDate: string): string[] {
  const results: string[] = [];
  const cutoffTime = new Date(sinceDate).getTime();

  function scan(currentPath: string): void {
    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (EXCLUDE_DIRS.includes(entry.name)) continue;
          scan(join(currentPath, entry.name));
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (!SOURCE_EXTENSIONS.includes(ext)) continue;

          const fullPath = join(currentPath, entry.name);
          try {
            const stat = statSync(fullPath);
            if (stat.mtimeMs > cutoffTime) {
              results.push(relative(dirPath, fullPath));
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

  if (existsSync(dirPath)) {
    scan(dirPath);
  }
  return results;
}

/**
 * Calculate freshness for a single CLAUDE.md file
 */
export function calculateFreshness(
  filePath: string,
  fileLevel: 'user' | 'project' | 'module',
  lastUpdateTime: string | null,
  lastModified: string,
  projectPath: string,
  threshold: number = 20
): FreshnessResult {
  // Use lastUpdateTime from history, or fall back to file mtime
  const effectiveUpdateTime = lastUpdateTime || lastModified;

  // Calculate module path for change detection
  let modulePath: string | null = null;
  let changedFiles: string[] = [];

  if (fileLevel === 'module') {
    // For module-level files, scan the parent directory
    modulePath = dirname(filePath);
  } else if (fileLevel === 'project') {
    // For project-level files, scan the project root
    modulePath = projectPath;
  }

  // Only calculate changes for module/project level in git repos
  if (modulePath && isGitRepo(projectPath)) {
    changedFiles = getChangedFilesSince(projectPath, modulePath, effectiveUpdateTime);
    // Exclude the CLAUDE.md file itself
    changedFiles = changedFiles.filter(f => !f.endsWith('CLAUDE.md'));
  }

  // Calculate freshness percentage
  const changedCount = changedFiles.length;
  const freshness = Math.max(0, 100 - Math.floor((changedCount / threshold) * 100));

  // Determine parent directory for display
  const parentDirectory = fileLevel === 'module'
    ? filePath.split(/[\\/]/).slice(-2, -1)[0]
    : undefined;

  return {
    path: filePath,
    level: fileLevel,
    relativePath: relative(projectPath, filePath).replace(/\\/g, '/'),
    parentDirectory,
    lastUpdated: lastUpdateTime,
    lastModified,
    changedFilesCount: changedCount,
    freshness,
    needsUpdate: freshness < 50,
    changedFiles: changedFiles.slice(0, 20) // Limit to first 20 for detail view
  };
}

/**
 * Calculate freshness for all CLAUDE.md files in a project
 */
export function calculateAllFreshness(
  claudeFiles: Array<{
    path: string;
    level: 'user' | 'project' | 'module';
    lastModified: string;
  }>,
  projectPath: string,
  threshold: number = 20
): FreshnessResponse {
  // Get update records from store
  const store = getCoreMemoryStore(projectPath);
  const updateRecords = store.getAllClaudeUpdateRecords();

  // Create a map for quick lookup
  const updateMap = new Map<string, ClaudeUpdateRecord>();
  for (const record of updateRecords) {
    updateMap.set(record.file_path, record);
  }

  const results: FreshnessResult[] = [];

  for (const file of claudeFiles) {
    const updateRecord = updateMap.get(file.path);

    const result = calculateFreshness(
      file.path,
      file.level,
      updateRecord?.updated_at || null,
      file.lastModified,
      projectPath,
      threshold
    );

    if (updateRecord) {
      result.updateSource = updateRecord.update_source;
    }

    results.push(result);
  }

  // Calculate summary
  const staleCount = results.filter(r => r.needsUpdate).length;
  const totalFreshness = results.reduce((sum, r) => sum + r.freshness, 0);
  const averageFreshness = results.length > 0 ? Math.round(totalFreshness / results.length) : 100;

  return {
    files: results,
    summary: {
      totalFiles: results.length,
      staleCount,
      averageFreshness,
      lastScanAt: new Date().toISOString()
    }
  };
}

/**
 * Mark a CLAUDE.md file as updated
 */
export function markFileAsUpdated(
  filePath: string,
  fileLevel: 'user' | 'project' | 'module',
  updateSource: 'manual' | 'cli_sync' | 'dashboard' | 'api',
  projectPath: string,
  metadata?: object
): ClaudeUpdateRecord {
  const store = getCoreMemoryStore(projectPath);
  const now = new Date().toISOString();

  // Get current git commit
  const gitCommit = getCurrentGitCommit(projectPath);

  // Calculate changed files count before this update
  const lastUpdate = store.getLastClaudeUpdate(filePath);
  let filesChangedCount = 0;

  if (lastUpdate && isGitRepo(projectPath)) {
    const modulePath = fileLevel === 'module' ? dirname(filePath) : projectPath;
    const changedFiles = getChangedFilesSince(projectPath, modulePath, lastUpdate.updated_at);
    filesChangedCount = changedFiles.filter(f => !f.endsWith('CLAUDE.md')).length;
  }

  // Insert update record
  const record = store.insertClaudeUpdateRecord({
    file_path: filePath,
    file_level: fileLevel,
    module_path: fileLevel === 'module' ? dirname(filePath) : undefined,
    updated_at: now,
    update_source: updateSource,
    git_commit_hash: gitCommit || undefined,
    files_changed_before_update: filesChangedCount,
    metadata: metadata ? JSON.stringify(metadata) : undefined
  });

  return record;
}

/**
 * Get update history for a file
 */
export function getUpdateHistory(
  filePath: string,
  projectPath: string,
  limit: number = 50
): ClaudeUpdateRecord[] {
  const store = getCoreMemoryStore(projectPath);
  return store.getClaudeUpdateHistory(filePath, limit);
}
