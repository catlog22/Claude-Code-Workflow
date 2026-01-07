/**
 * Issue Command - Unified JSONL storage with CLI & API compatibility
 * Storage: issues.jsonl + solutions/{issue-id}.jsonl + queue.json
 * Commands: init, list, status, task, bind, queue, next, done, retry
 */

import chalk from 'chalk';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { EXEC_TIMEOUTS } from '../utils/exec-constants.js';

function isExecTimeoutError(error: unknown): boolean {
  const err = error as { code?: unknown; errno?: unknown; message?: unknown } | null;
  const code = err?.code ?? err?.errno;
  if (code === 'ETIMEDOUT') return true;
  const message = typeof err?.message === 'string' ? err.message : '';
  return message.includes('ETIMEDOUT');
}

// Handle EPIPE errors gracefully
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
  throw err;
});

// ============ Interfaces ============

interface IssueFeedback {
  type: 'failure' | 'clarification' | 'rejection';
  stage: string;               // new/plan/execute
  content: string;
  created_at: string;
}

interface Issue {
  id: string;
  title: string;
  status: 'registered' | 'planning' | 'planned' | 'queued' | 'executing' | 'completed' | 'failed' | 'paused';
  priority: number;
  context: string;             // Problem description (single source of truth)
  source?: 'github' | 'text' | 'discovery';
  source_url?: string;
  tags?: string[];

  // Optional structured fields
  expected_behavior?: string;
  actual_behavior?: string;
  affected_components?: string[];

  // Feedback history (failures + human clarifications)
  feedback?: IssueFeedback[];

  // Solution binding
  bound_solution_id: string | null;

  // Timestamps
  created_at: string;
  updated_at: string;
  planned_at?: string;
  queued_at?: string;
  completed_at?: string;
}

interface TaskTest {
  unit?: string[];              // Unit test requirements
  integration?: string[];       // Integration test requirements
  commands?: string[];          // Test commands to run
  coverage_target?: number;     // Minimum coverage % (optional)
}

interface TaskAcceptance {
  criteria: string[];           // Acceptance criteria (testable)
  verification: string[];       // How to verify each criterion
  manual_checks?: string[];     // Manual verification steps if needed
}

interface TaskCommit {
  type: 'feat' | 'fix' | 'refactor' | 'test' | 'docs' | 'chore';
  scope: string;                // Commit scope (e.g., "auth", "api")
  message_template: string;     // Commit message template
  breaking?: boolean;           // Breaking change flag
}

interface SolutionTask {
  id: string;
  title: string;
  scope: string;
  action: string;
  description?: string;
  modification_points?: { file: string; target: string; change: string }[];

  // Lifecycle phases (closed-loop)
  implementation: string[];     // Implementation steps
  test: TaskTest;               // Test requirements
  regression: string[];         // Regression check points
  acceptance: TaskAcceptance;   // Acceptance criteria & verification
  commit: TaskCommit;           // Commit specification

  depends_on: string[];
  estimated_minutes?: number;
  status?: string;
  priority?: number;
}

interface Solution {
  id: string;
  description?: string;
  approach?: string;             // Solution approach description
  tasks: SolutionTask[];
  exploration_context?: Record<string, any>;
  analysis?: { risk?: string; impact?: string; complexity?: string };
  score?: number;
  is_bound: boolean;
  created_at: string;
  bound_at?: string;
}

// Structured failure detail for debugging
interface FailureDetail {
  task_id?: string;              // Which task failed within the solution
  error_type: string;            // e.g., "compilation", "test_failure", "timeout"
  message: string;               // Human-readable error message
  stack_trace?: string;          // Optional stack trace
  timestamp: string;             // ISO timestamp
}

interface QueueItem {
  item_id: string;               // Item ID in queue: T-1, T-2, ... (task-level) or S-1, S-2, ... (solution-level)
  issue_id: string;
  solution_id: string;
  task_id?: string;              // Only for task-level queues
  status: 'pending' | 'ready' | 'executing' | 'completed' | 'failed' | 'blocked';
  execution_order: number;
  execution_group: string;
  depends_on: string[];
  semantic_priority: number;
  task_count?: number;           // For solution-level queues
  files_touched?: string[];      // For solution-level queues
  queued_at?: string;
  started_at?: string;
  completed_at?: string;
  result?: Record<string, any>;
  failure_reason?: string;       // Simple string (backward compat)
  failure_details?: FailureDetail;   // Structured failure info
  failure_history?: FailureDetail[]; // Preserved on retry for debugging
}

interface QueueConflict {
  type: 'file_conflict' | 'dependency_conflict' | 'resource_conflict';
  tasks?: string[];              // Task IDs involved (task-level queues)
  solutions?: string[];          // Solution IDs involved (solution-level queues)
  file?: string;                 // Conflicting file path
  resolution: 'sequential' | 'merge' | 'manual';
  resolution_order?: string[];
  rationale?: string;
  resolved: boolean;
}

interface ExecutionGroup {
  id: string;                    // Group ID: P1, S1, etc.
  type: 'parallel' | 'sequential';
  task_count?: number;           // For task-level queues
  solution_count?: number;       // For solution-level queues
  tasks?: string[];              // Task IDs in this group (task-level)
  solutions?: string[];          // Solution IDs in this group (solution-level)
}

interface Queue {
  id: string;                    // Queue unique ID: QUE-YYYYMMDD-HHMMSS (derived from filename)
  name?: string;                 // Optional queue name
  status: 'active' | 'completed' | 'archived' | 'failed';
  issue_ids: string[];           // Issues in this queue
  tasks: QueueItem[];            // Task items (task-level queue)
  solutions?: QueueItem[];       // Solution items (solution-level queue)
  conflicts: QueueConflict[];
  execution_groups?: ExecutionGroup[];
  _metadata: {
    version: string;
    total_tasks: number;
    pending_count: number;
    executing_count: number;
    completed_count: number;
    failed_count: number;
    updated_at: string;
  };
}

interface QueueIndex {
  active_queue_id: string | null;    // Single active queue (backward compat)
  active_queue_ids?: string[];       // Multiple active queues, ordered by priority
  queues: {
    id: string;
    status: string;
    priority?: number;               // Queue execution priority (lower = higher priority)
    issue_ids: string[];
    total_tasks?: number;          // For task-level queues
    total_solutions?: number;      // For solution-level queues
    completed_tasks?: number;      // For task-level queues
    completed_solutions?: number;  // For solution-level queues
    created_at: string;
    completed_at?: string;
  }[];
}

interface IssueOptions {
  status?: string;
  title?: string;
  description?: string;
  executor?: string;
  priority?: string;
  solution?: string;
  result?: string;
  reason?: string;
  json?: boolean;
  force?: boolean;
  fail?: boolean;
  brief?: boolean;      // List brief info only (id, title, status, priority, tags) - JSON format
  data?: string;        // JSON data for create
  fromQueue?: boolean | string;  // Sync statuses from queue (true=active, string=specific queue ID)
  queue?: string;       // Target queue ID for multi-queue operations
}

const ISSUES_DIR = '.workflow/issues';

// ============ Storage Layer (JSONL) ============

/**
 * Normalize path for comparison (handles Windows case sensitivity)
 */
function normalizePath(p: string): string {
  const normalized = resolve(p);
  // Windows: normalize to lowercase for comparison
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Try to resolve main repo from .git file (worktree link file)
 * .git file format: "gitdir: /path/to/main/.git/worktrees/name"
 */
function resolveMainRepoFromGitFile(gitFilePath: string): string | null {
  try {
    const content = readFileSync(gitFilePath, 'utf-8').trim();
    // Parse "gitdir: /path/to/.git/worktrees/name"
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (match) {
      const gitDir = match[1];
      // Navigate from .git/worktrees/name to .git to repo root
      // Pattern: /main/.git/worktrees/wt-name -> /main/.git -> /main
      const worktreesMatch = gitDir.match(/^(.+)[/\\]\.git[/\\]worktrees[/\\]/);
      if (worktreesMatch) {
        return worktreesMatch[1];
      }
    }
  } catch {
    // Failed to read or parse .git file
  }
  return null;
}

/**
 * Get the main repository root, even when running from a worktree.
 * This ensures .workflow/issues/ is always accessed from the main repo.
 */
function getProjectRoot(): string {
  // First, try to detect if we're in a git worktree using git commands
  try {
    // Get the common git directory (points to main repo's .git)
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: EXEC_TIMEOUTS.GIT_QUICK,
    }).trim();

    // Get the current git directory
    const gitDir = execSync('git rev-parse --git-dir', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: EXEC_TIMEOUTS.GIT_QUICK,
    }).trim();

    // Normalize paths for comparison (Windows case insensitive)
    const normalizedCommon = normalizePath(gitCommonDir);
    const normalizedGit = normalizePath(gitDir);

    // If gitDir != gitCommonDir, we're in a worktree
    if (normalizedGit !== normalizedCommon && gitDir !== '.git') {
      // We're in a worktree - resolve to main repo
      const absoluteCommonDir = resolve(process.cwd(), gitCommonDir);
      // .git directory's parent is the repo root
      const mainRepoRoot = resolve(absoluteCommonDir, '..');

      // Verify .workflow or .git exists in main repo
      if (existsSync(join(mainRepoRoot, '.workflow')) || existsSync(join(mainRepoRoot, '.git'))) {
        return mainRepoRoot;
      }
    }
  } catch (err: unknown) {
    if (isExecTimeoutError(err)) {
      console.warn(`[issue] git rev-parse timed out after ${EXEC_TIMEOUTS.GIT_QUICK}ms; falling back to filesystem detection`);
    }
    // Git command failed - fall through to manual detection
  }

  // Standard detection with worktree file support: walk up to find .workflow or .git
  let dir = process.cwd();
  while (dir !== resolve(dir, '..')) {
    const gitPath = join(dir, '.git');

    // Check if .git is a file (worktree link) rather than directory
    if (existsSync(gitPath)) {
      try {
        const gitStat = statSync(gitPath);
        if (gitStat.isFile()) {
          // .git is a file - this is a worktree, try to resolve main repo
          const mainRepo = resolveMainRepoFromGitFile(gitPath);
          if (mainRepo && existsSync(join(mainRepo, '.workflow'))) {
            return mainRepo;
          }
          // If main repo doesn't have .workflow, fall back to current worktree
        }
      } catch {
        // stat failed, continue with normal logic
      }
    }

    if (existsSync(join(dir, '.workflow')) || existsSync(gitPath)) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

function getIssuesDir(): string {
  return join(getProjectRoot(), ISSUES_DIR);
}

function ensureIssuesDir(): void {
  const dir = getIssuesDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============ Issues JSONL ============

export function readIssues(): Issue[] {
  const path = join(getIssuesDir(), 'issues.jsonl');
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

export function writeIssues(issues: Issue[]): void {
  ensureIssuesDir();
  const path = join(getIssuesDir(), 'issues.jsonl');
  // Always add trailing newline for proper JSONL format
  const content = issues.map(i => JSON.stringify(i)).join('\n');
  writeFileSync(path, content ? content + '\n' : '', 'utf-8');
}

function findIssue(issueId: string): Issue | undefined {
  return readIssues().find(i => i.id === issueId);
}

// ============ Issue History JSONL ============

function readIssueHistory(): Issue[] {
  const path = join(getIssuesDir(), 'issue-history.jsonl');
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function appendIssueHistory(issue: Issue): void {
  ensureIssuesDir();
  const path = join(getIssuesDir(), 'issue-history.jsonl');
  const line = JSON.stringify(issue) + '\n';
  // Append to history file
  if (existsSync(path)) {
    const content = readFileSync(path, 'utf-8');
    // Ensure proper newline before appending
    const needsNewline = content.length > 0 && !content.endsWith('\n');
    writeFileSync(path, (needsNewline ? '\n' : '') + line, { flag: 'a' });
  } else {
    writeFileSync(path, line, 'utf-8');
  }
}

/**
 * Move completed issue from issues.jsonl to issue-history.jsonl
 */
function moveIssueToHistory(issueId: string): boolean {
  const issues = readIssues();
  const idx = issues.findIndex(i => i.id === issueId);
  if (idx === -1) return false;

  const issue = issues[idx];
  if (issue.status !== 'completed') return false;

  // Append to history
  appendIssueHistory(issue);

  // Remove from active issues
  issues.splice(idx, 1);
  writeIssues(issues);

  return true;
}

function updateIssue(issueId: string, updates: Partial<Issue>): boolean {
  const issues = readIssues();
  const idx = issues.findIndex(i => i.id === issueId);
  if (idx === -1) return false;
  issues[idx] = { ...issues[idx], ...updates, updated_at: new Date().toISOString() };
  writeIssues(issues);

  // Auto-move to history when completed
  if (updates.status === 'completed') {
    moveIssueToHistory(issueId);
  }

  return true;
}

/**
 * Generate auto-increment issue ID: ISS-YYYYMMDD-NNN
 */
function generateIssueId(existingIssues: Issue[] = []): string {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ISS-${dateStr}-`;
  const todayPattern = new RegExp(`^ISS-${dateStr}-(\\d{3})$`);
  let maxSeq = 0;
  for (const issue of existingIssues) {
    const match = issue.id.match(todayPattern);
    if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

/**
 * Create a new issue with proper JSONL handling
 * Auto-generates ID if not provided
 */
function createIssue(data: Partial<Issue>): Issue {
  const issues = readIssues();
  const issueId = data.id || generateIssueId(issues);

  if (issues.some(i => i.id === issueId)) {
    throw new Error(`Issue "${issueId}" already exists`);
  }

  const newIssue: Issue = {
    id: issueId,
    title: data.title || issueId,
    status: data.status || 'registered',
    priority: data.priority || 3,
    context: data.context || '',
    source: data.source,
    source_url: data.source_url,
    tags: data.tags,
    expected_behavior: data.expected_behavior,
    actual_behavior: data.actual_behavior,
    affected_components: data.affected_components,
    feedback: data.feedback,
    bound_solution_id: data.bound_solution_id || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  issues.push(newIssue);
  writeIssues(issues);
  return newIssue;
}

// ============ Solutions JSONL ============

function getSolutionsPath(issueId: string): string {
  return join(getIssuesDir(), 'solutions', `${issueId}.jsonl`);
}

export function readSolutions(issueId: string): Solution[] {
  const path = getSolutionsPath(issueId);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

export function writeSolutions(issueId: string, solutions: Solution[]): void {
  const dir = join(getIssuesDir(), 'solutions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Always add trailing newline for proper JSONL format
  const content = solutions.map(s => JSON.stringify(s)).join('\n');
  writeFileSync(getSolutionsPath(issueId), content ? content + '\n' : '', 'utf-8');
}

function findSolution(issueId: string, solutionId: string): Solution | undefined {
  return readSolutions(issueId).find(s => s.id === solutionId);
}

function getBoundSolution(issueId: string): Solution | undefined {
  return readSolutions(issueId).find(s => s.is_bound);
}

/**
 * Generate solution ID in format: SOL-{issue-id}-{seq}
 * @param issueId - The issue ID to include in the solution ID
 * @param existingSolutions - Existing solutions to calculate next sequence number
 * @returns Solution ID like "SOL-GH-123-1" or "SOL-ISS-20251229-001-2"
 */
function generateSolutionId(issueId: string, existingSolutions: Solution[] = []): string {
  // Find the highest existing sequence number for this issue
  const pattern = new RegExp(`^SOL-${issueId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let maxSeq = 0;
  for (const sol of existingSolutions) {
    const match = sol.id.match(pattern);
    if (match) {
      maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
    }
  }
  return `SOL-${issueId}-${maxSeq + 1}`;
}

/**
 * Create a new solution with proper JSONL handling
 * Auto-generates ID if not provided
 */
function createSolution(issueId: string, data: Partial<Solution>): Solution {
  const issue = findIssue(issueId);
  if (!issue) {
    throw new Error(`Issue "${issueId}" not found`);
  }

  const solutions = readSolutions(issueId);
  const solutionId = data.id || generateSolutionId(issueId, solutions);

  if (solutions.some(s => s.id === solutionId)) {
    throw new Error(`Solution "${solutionId}" already exists`);
  }

  const newSolution: Solution = {
    id: solutionId,
    description: data.description || '',
    approach: data.approach || '',
    tasks: data.tasks || [],
    exploration_context: data.exploration_context,
    analysis: data.analysis,
    score: data.score,
    is_bound: false,
    created_at: new Date().toISOString()
  };

  solutions.push(newSolution);
  writeSolutions(issueId, solutions);
  return newSolution;
}

// ============ Queue Management (Multi-Queue) ============

function getQueuesDir(): string {
  return join(getIssuesDir(), 'queues');
}

function ensureQueuesDir(): void {
  const dir = getQueuesDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readQueueIndex(): QueueIndex {
  const path = join(getQueuesDir(), 'index.json');
  if (!existsSync(path)) {
    return { active_queue_id: null, queues: [] };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeQueueIndex(index: QueueIndex): void {
  ensureQueuesDir();
  writeFileSync(join(getQueuesDir(), 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

function generateQueueFileId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `QUE-${ts}`;
}

export function readQueue(queueId?: string): Queue | null {
  const index = readQueueIndex();
  const targetId = queueId || index.active_queue_id;

  if (!targetId) return null;

  const path = join(getQueuesDir(), `${targetId}.json`);
  if (!existsSync(path)) return null;

  return JSON.parse(readFileSync(path, 'utf-8'));
}

function readActiveQueue(): Queue {
  const queue = readQueue();
  if (queue) return queue;

  // Return empty queue structure if no active queue
  return createEmptyQueue();
}

function createEmptyQueue(): Queue {
  return {
    id: generateQueueFileId(),
    status: 'active',
    issue_ids: [],
    tasks: [],
    conflicts: [],
    _metadata: {
      version: '2.1',
      total_tasks: 0,
      pending_count: 0,
      executing_count: 0,
      completed_count: 0,
      failed_count: 0,
      updated_at: new Date().toISOString()
    }
  };
}

// ============ Multi-Queue Helper Functions ============

/**
 * Find which queue contains a given item ID
 * Supports both simple (S-1) and qualified (QUE-xxx:S-1) formats
 */
function findItemQueue(itemId: string): { queue: Queue; item: QueueItem; itemIndex: number } | null {
  // Check if qualified format (QUE-xxx:S-1)
  const qualifiedMatch = itemId.match(/^(QUE-[^:]+):(.+)$/);
  if (qualifiedMatch) {
    const [, queueId, actualItemId] = qualifiedMatch;
    const queue = readQueue(queueId);
    if (!queue) return null;
    const items = queue.solutions || queue.tasks || [];
    const itemIndex = items.findIndex(i => i.item_id === actualItemId);
    if (itemIndex === -1) return null;
    return { queue, item: items[itemIndex], itemIndex };
  }

  // Search all queues for unqualified item ID
  const index = readQueueIndex();
  const activeQueueIds = index.active_queue_ids || (index.active_queue_id ? [index.active_queue_id] : []);

  // Search active queues first
  for (const queueId of activeQueueIds) {
    const queue = readQueue(queueId);
    if (!queue) continue;
    const items = queue.solutions || queue.tasks || [];
    const itemIndex = items.findIndex(i => i.item_id === itemId);
    if (itemIndex >= 0) {
      return { queue, item: items[itemIndex], itemIndex };
    }
  }

  // Search all other queues
  for (const queueEntry of index.queues) {
    if (activeQueueIds.includes(queueEntry.id)) continue;
    const queue = readQueue(queueEntry.id);
    if (!queue) continue;
    const items = queue.solutions || queue.tasks || [];
    const itemIndex = items.findIndex(i => i.item_id === itemId);
    if (itemIndex >= 0) {
      return { queue, item: items[itemIndex], itemIndex };
    }
  }

  return null;
}

/**
 * Get all active queues ordered by priority (lower = higher priority)
 * Falls back to creation date order
 */
function getActiveQueues(): Queue[] {
  const index = readQueueIndex();
  const activeIds = index.active_queue_ids || (index.active_queue_id ? [index.active_queue_id] : []);

  const queues: Queue[] = [];
  for (const queueId of activeIds) {
    const queue = readQueue(queueId);
    if (queue && queue.status === 'active') {
      queues.push(queue);
    }
  }

  // Sort by priority field in index (lower = higher priority)
  const priorityMap = new Map<string, number>();
  for (const entry of index.queues) {
    priorityMap.set(entry.id, entry.priority ?? Number.MAX_SAFE_INTEGER);
  }

  queues.sort((a, b) => {
    const pa = priorityMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const pb = priorityMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    // Fall back to creation date (from queue ID)
    return a.id.localeCompare(b.id);
  });

  return queues;
}

/**
 * Parse failure reason into structured FailureDetail
 * Detects JSON format vs plain string
 */
function parseFailureReason(reason: string): FailureDetail {
  const timestamp = new Date().toISOString();

  // Try to parse as JSON first
  if (reason.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(reason);
      return {
        task_id: parsed.task_id,
        error_type: parsed.error_type || 'unknown',
        message: parsed.message || reason,
        stack_trace: parsed.stack_trace,
        timestamp
      };
    } catch {
      // Not valid JSON, treat as plain message
    }
  }

  // Plain string message
  return {
    error_type: 'execution_error',
    message: reason,
    timestamp
  };
}

export function writeQueue(queue: Queue): void {
  ensureQueuesDir();

  // Support both old (tasks) and new (solutions) queue format
  const items = queue.solutions || queue.tasks || [];
  const isSolutionQueue = !!queue.solutions;

  // Ensure _metadata exists (support queues with 'metadata' field from external sources)
  if (!queue._metadata) {
    const extMeta = (queue as any).metadata;
    queue._metadata = {
      version: '2.0',
      total_tasks: extMeta?.total_tasks || items.length,
      pending_count: items.filter(q => q.status === 'pending').length,
      executing_count: items.filter(q => q.status === 'executing').length,
      completed_count: items.filter(q => q.status === 'completed').length,
      failed_count: items.filter(q => q.status === 'failed').length,
      updated_at: new Date().toISOString()
    };
  }

  // Update metadata counts
  queue._metadata.total_tasks = items.length;
  queue._metadata.pending_count = items.filter(q => q.status === 'pending').length;
  queue._metadata.executing_count = items.filter(q => q.status === 'executing').length;
  queue._metadata.completed_count = items.filter(q => q.status === 'completed').length;
  queue._metadata.failed_count = items.filter(q => q.status === 'failed').length;
  queue._metadata.updated_at = new Date().toISOString();

  // Write queue file
  const path = join(getQueuesDir(), `${queue.id}.json`);
  writeFileSync(path, JSON.stringify(queue, null, 2), 'utf-8');

  // Update index
  const index = readQueueIndex();
  const existingIdx = index.queues.findIndex(q => q.id === queue.id);

  // Derive issue_ids from solutions if not present
  const issueIds = queue.issue_ids || (isSolutionQueue
    ? [...new Set(items.map(item => item.issue_id))]
    : []);

  const indexEntry: QueueIndex['queues'][0] = {
    id: queue.id,
    status: queue.status,
    issue_ids: issueIds,
    created_at: queue.id.replace('QUE-', '').replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z'), // Derive from ID
    completed_at: queue.status === 'completed' ? new Date().toISOString() : undefined
  };

  // Add format-specific counts
  if (isSolutionQueue) {
    indexEntry.total_solutions = items.length;
    indexEntry.completed_solutions = queue._metadata.completed_count;
  } else {
    indexEntry.total_tasks = items.length;
    indexEntry.completed_tasks = queue._metadata.completed_count;
  }

  if (existingIdx >= 0) {
    index.queues[existingIdx] = indexEntry;
  } else {
    index.queues.unshift(indexEntry);
  }

  if (queue.status === 'active') {
    index.active_queue_id = queue.id;
  }

  writeQueueIndex(index);
}

function generateQueueItemId(queue: Queue, level: 'solution' | 'task' = 'solution'): string {
  const prefix = level === 'solution' ? 'S' : 'T';
  const items = level === 'solution' ? (queue.solutions || []) : (queue.tasks || []);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);

  const maxNum = items.reduce((max, q) => {
    const match = q.item_id.match(pattern);
    return match ? Math.max(max, parseInt(match[1])) : max;
  }, 0);
  return `${prefix}-${maxNum + 1}`;
}

// ============ Commands ============

/**
 * create - Create issue from JSON data
 * Usage: ccw issue create --data '{"title":"...", "context":"..."}'
 *        echo '{"title":"..."}' | ccw issue create
 * Output: JSON with created issue (includes auto-generated ID)
 */
async function createAction(options: IssueOptions): Promise<void> {
  let jsonData: string | undefined = options.data;

  // Support stdin pipe input (avoids shell escaping issues)
  if (!jsonData && !process.stdin.isTTY) {
    try {
      jsonData = readFileSync(0, 'utf-8').trim();
    } catch {
      // stdin not available or empty
    }
  }

  if (!jsonData) {
    console.error(chalk.red('JSON data required'));
    console.error(chalk.gray('Usage: ccw issue create --data \'{"title":"...", "context":"..."}\''));
    console.error(chalk.gray('       echo \'{"title":"..."}\' | ccw issue create'));
    process.exit(1);
  }

  try {
    const data = JSON.parse(jsonData);
    const issue = createIssue(data);
    console.log(JSON.stringify(issue, null, 2));
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

/**
 * solution - Create solution from JSON data
 * Usage: ccw issue solution <issue-id> --data '{"tasks":[...]}'
 *        echo '{"tasks":[...]}' | ccw issue solution <issue-id>
 * Output: JSON with created solution (includes auto-generated ID)
 */
async function solutionAction(issueId: string | undefined, options: IssueOptions): Promise<void> {
  if (!issueId) {
    console.error(chalk.red('Issue ID required'));
    console.error(chalk.gray('Usage: ccw issue solution <issue-id> --data \'{"tasks":[...]}\''));
    console.error(chalk.gray('       echo \'{"tasks":[...]}\' | ccw issue solution <issue-id>'));
    process.exit(1);
  }

  let jsonData: string | undefined = options.data;

  // Support stdin pipe input (avoids shell escaping issues)
  if (!jsonData && !process.stdin.isTTY) {
    try {
      jsonData = readFileSync(0, 'utf-8').trim();
    } catch {
      // stdin not available or empty
    }
  }

  if (!jsonData) {
    console.error(chalk.red('JSON data required'));
    console.error(chalk.gray('Usage: ccw issue solution <issue-id> --data \'{"tasks":[...]}\''));
    console.error(chalk.gray('       echo \'{"tasks":[...]}\' | ccw issue solution <issue-id>'));
    process.exit(1);
  }

  try {
    const data = JSON.parse(jsonData);
    const solution = createSolution(issueId, data);
    console.log(JSON.stringify(solution, null, 2));
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

/**
 * init - Initialize a new issue (manual ID)
 */
async function initAction(issueId: string | undefined, options: IssueOptions): Promise<void> {
  if (!issueId) {
    console.error(chalk.red('Issue ID is required'));
    console.error(chalk.gray('Usage: ccw issue init <issue-id> [--title "..."]'));
    process.exit(1);
  }

  const existing = findIssue(issueId);
  if (existing && !options.force) {
    console.error(chalk.red(`Issue "${issueId}" already exists`));
    console.error(chalk.gray('Use --force to reinitialize'));
    process.exit(1);
  }

  const issues = readIssues().filter(i => i.id !== issueId);
  const newIssue: Issue = {
    id: issueId,
    title: options.title || issueId,
    status: 'registered',
    priority: options.priority ? parseInt(options.priority) : 3,
    context: options.description || '',
    bound_solution_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  issues.push(newIssue);
  writeIssues(issues);

  console.log(chalk.green(`✓ Issue "${issueId}" initialized`));
  console.log(chalk.gray(`  Next: ccw issue task ${issueId} --title "Task title"`));
}

/**
 * list - List issues or tasks
 */
async function listAction(issueId: string | undefined, options: IssueOptions): Promise<void> {
  if (!issueId) {
    // List all issues
    let issues = readIssues();

    // Filter by status if specified
    if (options.status) {
      const statuses = options.status.split(',').map(s => s.trim());
      issues = issues.filter(i => statuses.includes(i.status));
    }

    // Brief mode: minimal fields only (id, title, status, priority, tags, bound_solution_id)
    if (options.brief) {
      const briefIssues = issues.map(i => ({
        id: i.id,
        title: i.title,
        status: i.status,
        priority: i.priority,
        tags: i.tags || [],
        bound_solution_id: i.bound_solution_id
      }));
      console.log(JSON.stringify(briefIssues, null, 2));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(issues, null, 2));
      return;
    }

    if (issues.length === 0) {
      console.log(chalk.yellow('No issues found'));
      console.log(chalk.gray('Create one with: ccw issue init <issue-id>'));
      return;
    }

    console.log(chalk.bold.cyan('\nIssues\n'));
    console.log(chalk.gray('ID'.padEnd(20) + 'Status'.padEnd(15) + 'Solutions'.padEnd(12) + 'Title'));
    console.log(chalk.gray('-'.repeat(70)));

    for (const issue of issues) {
      const statusColor = {
        'registered': chalk.gray,
        'planning': chalk.blue,
        'planned': chalk.cyan,
        'queued': chalk.yellow,
        'executing': chalk.yellow,
        'completed': chalk.green,
        'failed': chalk.red,
        'paused': chalk.magenta
      }[issue.status] || chalk.white;

      const solutionCount = readSolutions(issue.id).length;
      const bound = issue.bound_solution_id ? `[${issue.bound_solution_id}]` : `${solutionCount}`;
      console.log(
        issue.id.padEnd(20) +
        statusColor(issue.status.padEnd(15)) +
        bound.padEnd(12) +
        (issue.title || '').substring(0, 30)
      );
    }
    return;
  }

  // List tasks in bound solution
  const issue = findIssue(issueId);
  if (!issue) {
    console.error(chalk.red(`Issue "${issueId}" not found`));
    process.exit(1);
  }

  const solution = getBoundSolution(issueId);
  const tasks = solution?.tasks || [];

  if (options.json) {
    console.log(JSON.stringify({ issue, solution, tasks }, null, 2));
    return;
  }

  console.log(chalk.bold.cyan(`\nIssue: ${issueId}\n`));
  console.log(`Title: ${issue.title}`);
  console.log(`Status: ${issue.status}`);
  console.log(`Bound: ${issue.bound_solution_id || 'none'}`);
  console.log();

  if (tasks.length === 0) {
    console.log(chalk.yellow('No tasks (bind a solution first)'));
    return;
  }

  console.log(chalk.gray('ID'.padEnd(8) + 'Action'.padEnd(12) + 'Scope'.padEnd(20) + 'Title'));
  console.log(chalk.gray('-'.repeat(70)));

  for (const task of tasks) {
    console.log(
      task.id.padEnd(8) +
      task.action.padEnd(12) +
      task.scope.substring(0, 18).padEnd(20) +
      task.title.substring(0, 30)
    );
  }
}

/**
 * history - List completed issues from history
 */
async function historyAction(options: IssueOptions): Promise<void> {
  const history = readIssueHistory();

  // Brief mode: minimal fields only
  if (options.brief) {
    const briefHistory = history.map(i => ({
      id: i.id,
      title: i.title,
      status: i.status,
      completed_at: i.completed_at
    }));
    console.log(JSON.stringify(briefHistory, null, 2));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(history, null, 2));
    return;
  }

  if (history.length === 0) {
    console.log(chalk.yellow('No completed issues in history'));
    return;
  }

  console.log(chalk.bold.cyan('\nIssue History (Completed)\n'));
  console.log(chalk.gray('ID'.padEnd(25) + 'Completed At'.padEnd(22) + 'Title'));
  console.log(chalk.gray('-'.repeat(80)));

  for (const issue of history) {
    const completedAt = issue.completed_at
      ? new Date(issue.completed_at).toLocaleString()
      : 'N/A';
    console.log(
      chalk.green(issue.id.padEnd(25)) +
      completedAt.padEnd(22) +
      (issue.title || '').substring(0, 35)
    );
  }

  console.log(chalk.gray(`\nTotal: ${history.length} completed issues`));
}

/**
 * status - Show detailed status
 */
async function statusAction(issueId: string | undefined, options: IssueOptions): Promise<void> {
  if (!issueId) {
    // Show queue status
    const queue = readActiveQueue();
    const issues = readIssues();
    const index = readQueueIndex();

    if (options.json) {
      // Return full queue for programmatic access
      console.log(JSON.stringify(queue, null, 2));
      return;
    }

    console.log(chalk.bold.cyan('\nSystem Status\n'));
    console.log(`Issues: ${issues.length}`);
    console.log(`Queues: ${index.queues.length} (Active: ${index.active_queue_id || 'none'})`);
    console.log(`Active Queue: ${queue._metadata.total_tasks} tasks`);
    console.log(`  Pending: ${queue._metadata.pending_count}`);
    console.log(`  Executing: ${queue._metadata.executing_count}`);
    console.log(`  Completed: ${queue._metadata.completed_count}`);
    console.log(`  Failed: ${queue._metadata.failed_count}`);
    return;
  }

  const issue = findIssue(issueId);
  if (!issue) {
    console.error(chalk.red(`Issue "${issueId}" not found`));
    process.exit(1);
  }

  const solutions = readSolutions(issueId);
  const boundSol = solutions.find(s => s.is_bound);

  if (options.json) {
    console.log(JSON.stringify({ issue, solutions, bound: boundSol }, null, 2));
    return;
  }

  console.log(chalk.bold.cyan(`\nIssue: ${issueId}\n`));
  console.log(`Title: ${issue.title}`);
  console.log(`Status: ${issue.status}`);
  console.log(`Priority: ${issue.priority}`);
  console.log(`Created: ${issue.created_at}`);
  console.log(`Updated: ${issue.updated_at}`);

  if (issue.context) {
    console.log();
    console.log(chalk.bold('Context:'));
    console.log(issue.context.substring(0, 200));
  }

  console.log();
  console.log(chalk.bold(`Solutions (${solutions.length}):`));
  for (const sol of solutions) {
    const marker = sol.is_bound ? chalk.green('◉') : chalk.gray('○');
    console.log(`  ${marker} ${sol.id}: ${sol.tasks.length} tasks`);
  }
}

/**
 * task - Add or update task (simplified - mainly for manual task management)
 */
async function taskAction(issueId: string | undefined, taskId: string | undefined, options: IssueOptions): Promise<void> {
  if (!issueId) {
    console.error(chalk.red('Issue ID is required'));
    console.error(chalk.gray('Usage: ccw issue task <issue-id> [task-id] --title "..."'));
    process.exit(1);
  }

  const issue = findIssue(issueId);
  if (!issue) {
    console.error(chalk.red(`Issue "${issueId}" not found`));
    process.exit(1);
  }

  const solutions = readSolutions(issueId);
  let boundIdx = solutions.findIndex(s => s.is_bound);

  // Create default solution if none bound
  if (boundIdx === -1) {
    const newSol: Solution = {
      id: generateSolutionId(issueId, solutions),
      description: 'Manual tasks',
      tasks: [],
      is_bound: true,
      created_at: new Date().toISOString(),
      bound_at: new Date().toISOString()
    };
    solutions.push(newSol);
    boundIdx = solutions.length - 1;
    updateIssue(issueId, { bound_solution_id: newSol.id, status: 'planned' });
  }

  const solution = solutions[boundIdx];

  if (taskId) {
    // Update existing task
    const taskIdx = solution.tasks.findIndex(t => t.id === taskId);
    if (taskIdx === -1) {
      console.error(chalk.red(`Task "${taskId}" not found`));
      process.exit(1);
    }

    if (options.title) solution.tasks[taskIdx].title = options.title;
    if (options.status) solution.tasks[taskIdx].status = options.status;

    writeSolutions(issueId, solutions);
    console.log(chalk.green(`✓ Task ${taskId} updated`));
  } else {
    // Add new task
    if (!options.title) {
      console.error(chalk.red('Task title is required (--title)'));
      process.exit(1);
    }

    const newTaskId = `T${solution.tasks.length + 1}`;
    const newTask: SolutionTask = {
      id: newTaskId,
      title: options.title,
      scope: '',
      action: 'Implement',
      description: options.description || options.title,
      implementation: [],
      test: {
        unit: [],
        commands: ['npm test']
      },
      regression: ['npm test'],
      acceptance: {
        criteria: ['Task completed successfully'],
        verification: ['Manual verification']
      },
      commit: {
        type: 'feat',
        scope: 'core',
        message_template: `feat(core): ${options.title}`
      },
      depends_on: []
    };

    solution.tasks.push(newTask);
    writeSolutions(issueId, solutions);
    console.log(chalk.green(`✓ Task ${newTaskId} added to ${issueId}`));
  }
}

/**
 * update - Update issue fields (status, priority, title, etc.)
 * --from-queue: Sync statuses from active queue (auto-update queued issues)
 */
async function updateAction(issueId: string | undefined, options: IssueOptions): Promise<void> {
  // Handle --from-queue: Sync statuses from queue
  if (options.fromQueue) {
    // Determine queue ID: string value = specific queue, true = active queue
    const queueId = typeof options.fromQueue === 'string' ? options.fromQueue : undefined;
    const queue = queueId ? readQueue(queueId) : readActiveQueue();

    if (!queue) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, message: `Queue not found: ${queueId}`, queued: [], unplanned: [] }));
      } else {
        console.log(chalk.red(`Queue not found: ${queueId}`));
      }
      return;
    }

    const items = queue.solutions || queue.tasks || [];
    const allIssues = readIssues();

    if (!queue.id || items.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, message: 'No active queue', queued: [], unplanned: [] }));
      } else {
        console.log(chalk.yellow('No active queue to sync from'));
      }
      return;
    }

    // Get issue IDs from queue
    const queuedIssueIds = new Set(items.map(item => item.issue_id));
    const now = new Date().toISOString();

    // Track updates
    const updated: string[] = [];
    const unplanned: string[] = [];

    // Update queued issues
    for (const issueId of queuedIssueIds) {
      const issue = allIssues.find(i => i.id === issueId);
      if (issue && issue.status !== 'queued' && issue.status !== 'executing' && issue.status !== 'completed') {
        updateIssue(issueId, { status: 'queued', queued_at: now });
        updated.push(issueId);
      }
    }

    // Find planned issues NOT in queue
    for (const issue of allIssues) {
      if (issue.status === 'planned' && issue.bound_solution_id && !queuedIssueIds.has(issue.id)) {
        unplanned.push(issue.id);
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        queue_id: queue.id,
        queued: updated,
        queued_count: updated.length,
        unplanned: unplanned,
        unplanned_count: unplanned.length
      }, null, 2));
    } else {
      console.log(chalk.green(`✓ Synced from queue ${queue.id}`));
      console.log(chalk.gray(`  Updated to 'queued': ${updated.length} issues`));
      if (updated.length > 0) {
        updated.forEach(id => console.log(chalk.gray(`    - ${id}`)));
      }
      if (unplanned.length > 0) {
        console.log(chalk.yellow(`  Planned but NOT in queue: ${unplanned.length} issues`));
        unplanned.forEach(id => console.log(chalk.yellow(`    - ${id}`)));
      }
    }
    return;
  }

  // Standard single-issue update
  if (!issueId) {
    console.error(chalk.red('Issue ID is required'));
    console.error(chalk.gray('Usage: ccw issue update <issue-id> --status <status>'));
    console.error(chalk.gray('       ccw issue update --from-queue [queue-id]  (sync from queue)'));
    process.exit(1);
  }

  const issue = findIssue(issueId);
  if (!issue) {
    console.error(chalk.red(`Issue "${issueId}" not found`));
    process.exit(1);
  }

  const updates: Partial<Issue> = {};

  if (options.status) {
    const validStatuses = ['registered', 'planning', 'planned', 'queued', 'executing', 'completed', 'failed', 'paused'];
    if (!validStatuses.includes(options.status)) {
      console.error(chalk.red(`Invalid status: ${options.status}`));
      console.error(chalk.gray(`Valid: ${validStatuses.join(', ')}`));
      process.exit(1);
    }
    updates.status = options.status as Issue['status'];

    // Auto-set timestamps based on status
    if (options.status === 'planned') updates.planned_at = new Date().toISOString();
    if (options.status === 'queued') updates.queued_at = new Date().toISOString();
    if (options.status === 'completed') updates.completed_at = new Date().toISOString();
  }

  if (options.priority) {
    updates.priority = parseInt(options.priority);
  }

  if (options.title) {
    updates.title = options.title;
  }

  if (options.description) {
    updates.context = options.description;
  }

  if (Object.keys(updates).length === 0) {
    console.error(chalk.yellow('No updates specified'));
    console.error(chalk.gray('Use --status, --priority, --title, or --description'));
    return;
  }

  updateIssue(issueId, updates);

  if (options.json) {
    console.log(JSON.stringify({ success: true, issue_id: issueId, updates }));
  } else {
    console.log(chalk.green(`✓ Issue "${issueId}" updated`));
    Object.entries(updates).forEach(([k, v]) => {
      console.log(chalk.gray(`  ${k}: ${v}`));
    });
  }
}

/**
 * bind - Register and/or bind a solution
 */
async function bindAction(issueId: string | undefined, solutionId: string | undefined, options: IssueOptions): Promise<void> {
  if (!issueId) {
    console.error(chalk.red('Issue ID is required'));
    console.error(chalk.gray('Usage: ccw issue bind <issue-id> [solution-id] [--solution <path>]'));
    process.exit(1);
  }

  const issue = findIssue(issueId);
  if (!issue) {
    console.error(chalk.red(`Issue "${issueId}" not found`));
    process.exit(1);
  }

  let solutions = readSolutions(issueId);

  // Register new solution from file if provided
  if (options.solution) {
    try {
      const content = readFileSync(options.solution, 'utf-8');
      const data = JSON.parse(content);
      // Priority: CLI arg > file content ID > generate new (SOL-{issue-id}-{seq})
      const newSol: Solution = {
        id: solutionId || data.id || generateSolutionId(issueId, solutions),
        description: data.description || data.approach_name || 'Imported solution',
        tasks: data.tasks || [],
        exploration_context: data.exploration_context,
        analysis: data.analysis,
        score: data.score,
        is_bound: false,
        created_at: new Date().toISOString()
      };
      solutions.push(newSol);
      solutionId = newSol.id;
      console.log(chalk.green(`✓ Solution ${solutionId} registered (${newSol.tasks.length} tasks)`));
    } catch (e) {
      console.error(chalk.red(`Failed to read solution file: ${options.solution}`));
      process.exit(1);
    }
  }

  if (!solutionId) {
    // List available solutions
    if (solutions.length === 0) {
      console.log(chalk.yellow('No solutions available'));
      console.log(chalk.gray('Register one: ccw issue bind <issue-id> --solution <path>'));
      return;
    }

    console.log(chalk.bold.cyan(`\nSolutions for ${issueId}:\n`));
    for (const sol of solutions) {
      const marker = sol.is_bound ? chalk.green('◉') : chalk.gray('○');
      console.log(`  ${marker} ${sol.id}: ${sol.tasks.length} tasks - ${sol.description || ''}`);
    }
    return;
  }

  // Bind the specified solution
  const solIdx = solutions.findIndex(s => s.id === solutionId);
  if (solIdx === -1) {
    console.error(chalk.red(`Solution "${solutionId}" not found`));
    process.exit(1);
  }

  // Unbind all, bind selected
  solutions = solutions.map(s => ({ ...s, is_bound: false }));
  solutions[solIdx].is_bound = true;
  solutions[solIdx].bound_at = new Date().toISOString();

  writeSolutions(issueId, solutions);
  updateIssue(issueId, {
    bound_solution_id: solutionId,
    status: 'planned',
    planned_at: new Date().toISOString()
  });

  console.log(chalk.green(`✓ Solution ${solutionId} bound to ${issueId}`));
}

/**
 * queue - Queue management (list / add / history)
 */
async function queueAction(subAction: string | undefined, issueId: string | undefined, options: IssueOptions): Promise<void> {
  // List all queues (history)
  if (subAction === 'list' || subAction === 'history') {
    const index = readQueueIndex();

    // Brief mode: minimal queue index info
    if (options.brief) {
      const briefIndex = {
        active_queue_id: index.active_queue_id,
        queues: index.queues.map(q => ({
          id: q.id,
          status: q.status,
          issue_ids: q.issue_ids,
          total_solutions: q.total_solutions,
          completed_solutions: q.completed_solutions
        }))
      };
      console.log(JSON.stringify(briefIndex, null, 2));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(index, null, 2));
      return;
    }

    console.log(chalk.bold.cyan('\nQueue History\n'));
    console.log(chalk.gray(`Active: ${index.active_queue_id || 'none'}`));
    console.log();

    if (index.queues.length === 0) {
      console.log(chalk.yellow('No queues found'));
      console.log(chalk.gray('Create one: ccw issue queue add <issue-id>'));
      return;
    }

    console.log(chalk.gray('ID'.padEnd(22) + 'Status'.padEnd(12) + 'Tasks'.padEnd(10) + 'Issues'));
    console.log(chalk.gray('-'.repeat(70)));

    for (const q of index.queues) {
      const statusColor = {
        'active': chalk.green,
        'completed': chalk.cyan,
        'archived': chalk.gray,
        'failed': chalk.red
      }[q.status] || chalk.white;

      const marker = q.id === index.active_queue_id ? '→ ' : '  ';
      console.log(
        marker +
        q.id.padEnd(20) +
        statusColor(q.status.padEnd(12)) +
        `${q.completed_tasks}/${q.total_tasks}`.padEnd(10) +
        q.issue_ids.join(', ')
      );
    }
    return;
  }

  // Switch active queue
  if (subAction === 'switch' && issueId) {
    const queueId = issueId; // issueId is actually queue ID here
    const targetQueue = readQueue(queueId);

    if (!targetQueue) {
      console.error(chalk.red(`Queue "${queueId}" not found`));
      process.exit(1);
    }

    const index = readQueueIndex();
    index.active_queue_id = queueId;
    // Also update active_queue_ids for multi-queue support
    index.active_queue_ids = [queueId];
    writeQueueIndex(index);

    console.log(chalk.green(`✓ Switched to queue ${queueId}`));
    return;
  }

  // Set queue priority (lower = higher priority)
  if (subAction === 'priority' && issueId) {
    const queueId = issueId;
    const priority = parseInt(options.priority || '0');

    if (isNaN(priority)) {
      console.error(chalk.red('Invalid priority value (must be a number)'));
      process.exit(1);
    }

    const index = readQueueIndex();
    const queueEntry = index.queues.find(q => q.id === queueId);

    if (!queueEntry) {
      console.error(chalk.red(`Queue "${queueId}" not found`));
      process.exit(1);
    }

    queueEntry.priority = priority;
    writeQueueIndex(index);

    console.log(chalk.green(`✓ Queue ${queueId} priority set to ${priority}`));
    return;
  }

  // Activate multiple queues at once
  if (subAction === 'activate' && issueId) {
    const queueIds = issueId.split(',').map(id => id.trim());
    const index = readQueueIndex();

    // Validate all queue IDs
    for (const queueId of queueIds) {
      if (!index.queues.some(q => q.id === queueId)) {
        console.error(chalk.red(`Queue "${queueId}" not found`));
        process.exit(1);
      }
    }

    index.active_queue_ids = queueIds;
    index.active_queue_id = queueIds[0] || null; // Backward compat
    writeQueueIndex(index);

    console.log(chalk.green(`✓ Activated ${queueIds.length} queue(s): ${queueIds.join(', ')}`));
    return;
  }

  // DAG - Return dependency graph for parallel execution planning (solution-level)
  if (subAction === 'dag') {
    let queue: Queue;

    // Use explicit queue if provided via --queue or issueId, otherwise use active queue
    if (options.queue) {
      const targetQueue = readQueue(options.queue);
      if (!targetQueue) {
        console.log(JSON.stringify({ error: `Queue ${options.queue} not found`, nodes: [], edges: [], groups: [] }));
        return;
      }
      queue = targetQueue;
    } else if (issueId && issueId.startsWith('QUE-')) {
      const targetQueue = readQueue(issueId);
      if (!targetQueue) {
        console.log(JSON.stringify({ error: `Queue ${issueId} not found`, nodes: [], edges: [], groups: [] }));
        return;
      }
      queue = targetQueue;
    } else {
      queue = readActiveQueue();
    }

    // Support both old (tasks) and new (solutions) queue format
    const items = queue.solutions || queue.tasks || [];
    if (!queue.id || items.length === 0) {
      console.log(JSON.stringify({ error: 'No active queue', nodes: [], edges: [], groups: [] }));
      return;
    }

    // Build DAG nodes (solution-level)
    const completedIds = new Set(items.filter(t => t.status === 'completed').map(t => t.item_id));
    const failedIds = new Set(items.filter(t => t.status === 'failed').map(t => t.item_id));

    const nodes = items.map(item => ({
      id: item.item_id,
      issue_id: item.issue_id,
      solution_id: item.solution_id,
      status: item.status,
      priority: item.semantic_priority,
      depends_on: item.depends_on || [],
      task_count: item.task_count || 1,
      files_touched: item.files_touched || [],
      // Calculate if ready (dependencies satisfied)
      ready: item.status === 'pending' && (item.depends_on || []).every(d => completedIds.has(d)),
      blocked_by: (item.depends_on || []).filter(d => !completedIds.has(d) && !failedIds.has(d))
    }));

    // Build edges for visualization
    const edges = items.flatMap(item =>
      (item.depends_on || []).map(dep => ({ from: dep, to: item.item_id }))
    );

    // Group ready items by execution_group
    const readyItems = nodes.filter(n => n.ready || n.status === 'executing');
    const groups: Record<string, string[]> = {};

    for (const item of items) {
      if (readyItems.some(r => r.id === item.item_id)) {
        const group = item.execution_group || 'P1';
        if (!groups[group]) groups[group] = [];
        groups[group].push(item.item_id);
      }
    }

    // Calculate parallel batches - prefer execution_groups from queue if available
    const parallelBatches: string[][] = [];
    const readyItemIds = new Set(readyItems.map(t => t.id));

    // Check if queue has pre-assigned execution_groups
    if (queue.execution_groups && queue.execution_groups.length > 0) {
      // Use agent-assigned execution groups
      for (const group of queue.execution_groups) {
        const groupItems = (group.solutions || group.tasks || [])
          .filter((id: string) => readyItemIds.has(id));
        if (groupItems.length > 0) {
          if (group.type === 'parallel') {
            // All items in parallel group can run together
            parallelBatches.push(groupItems);
          } else {
            // Sequential group: each item is its own batch
            for (const itemId of groupItems) {
              parallelBatches.push([itemId]);
            }
          }
        }
      }
    } else {
      // Fallback: calculate parallel batches from file conflicts
      const remainingReady = new Set(readyItemIds);

      while (remainingReady.size > 0) {
        const batch: string[] = [];
        const batchFiles = new Set<string>();

        for (const itemId of Array.from(remainingReady)) {
          const item = items.find(t => t.item_id === itemId);
          if (!item) continue;

          // Get all files touched by this solution
          let solutionFiles: string[] = item.files_touched || [];

          // If not in queue item, fetch from solution definition
          if (solutionFiles.length === 0) {
            const solution = findSolution(item.issue_id, item.solution_id);
            if (solution?.tasks) {
              for (const task of solution.tasks) {
                for (const mp of task.modification_points || []) {
                  solutionFiles.push(mp.file);
                }
              }
            }
          }

          const hasConflict = solutionFiles.some(f => batchFiles.has(f));

          if (!hasConflict) {
            batch.push(itemId);
            solutionFiles.forEach(f => batchFiles.add(f));
          }
        }

        if (batch.length === 0) {
          // Fallback: take one at a time if all conflict
          const first = Array.from(remainingReady)[0];
          batch.push(first);
        }

        parallelBatches.push(batch);
        batch.forEach(id => remainingReady.delete(id));
      }
    }

    console.log(JSON.stringify({
      queue_id: queue.id,
      total: nodes.length,
      ready_count: readyItems.length,
      completed_count: completedIds.size,
      nodes,
      edges,
      groups: Object.entries(groups).map(([id, solutions]) => ({ id, solutions })),
      parallel_batches: parallelBatches,
      _summary: {
        can_parallel: parallelBatches[0]?.length || 0,
        batches_needed: parallelBatches.length
      }
    }, null, 2));
    return;
  }

  // Archive current queue
  if (subAction === 'archive') {
    const queue = readActiveQueue();
    const items = queue.solutions || queue.tasks || [];
    if (!queue.id || items.length === 0) {
      console.log(chalk.yellow('No active queue to archive'));
      return;
    }

    queue.status = 'archived';
    writeQueue(queue);

    const index = readQueueIndex();
    index.active_queue_id = null;
    writeQueueIndex(index);

    console.log(chalk.green(`✓ Archived queue ${queue.id}`));
    return;
  }

  // Delete queue from history
  if ((subAction === 'clear' || subAction === 'delete') && issueId) {
    const queueId = issueId; // issueId is actually queue ID here
    const queuePath = join(getQueuesDir(), `${queueId}.json`);

    if (!existsSync(queuePath)) {
      console.error(chalk.red(`Queue "${queueId}" not found`));
      process.exit(1);
    }

    if (!options.force) {
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: `Delete queue ${queueId}? This action cannot be undone.`,
        default: false
      }]);

      if (!proceed) {
        console.log(chalk.yellow('Queue deletion cancelled'));
        return;
      }
    }

    // Remove from index
    const index = readQueueIndex();
    index.queues = index.queues.filter(q => q.id !== queueId);
    if (index.active_queue_id === queueId) {
      index.active_queue_id = null;
    }
    writeQueueIndex(index);

    // Delete queue file
    unlinkSync(queuePath);

    console.log(chalk.green(`✓ Deleted queue ${queueId}`));
    return;
  }

  // Add issue solution to queue (solution-level granularity)
  if (subAction === 'add' && issueId) {
    const issue = findIssue(issueId);
    if (!issue) {
      console.error(chalk.red(`Issue "${issueId}" not found`));
      process.exit(1);
    }

    const solution = getBoundSolution(issueId);
    if (!solution) {
      console.error(chalk.red(`No bound solution for "${issueId}"`));
      console.error(chalk.gray('First bind a solution: ccw issue bind <issue-id> <solution-id>'));
      process.exit(1);
    }

    // Get or create active queue (create new if current is completed/archived)
    let queue = readActiveQueue();
    const items = queue.solutions || [];
    const isNewQueue = items.length === 0 || queue.status !== 'active';

    if (queue.status !== 'active') {
      // Create new queue if current is not active
      queue = createEmptyQueue();
    }

    // Ensure solutions array exists
    if (!queue.solutions) {
      queue.solutions = [];
    }

    // Check if solution already in queue
    const exists = queue.solutions.some(q => q.issue_id === issueId && q.solution_id === solution.id);
    if (exists) {
      console.log(chalk.yellow(`Solution ${solution.id} already in queue`));
      return;
    }

    // Add issue to queue's issue list
    if (!queue.issue_ids.includes(issueId)) {
      queue.issue_ids.push(issueId);
    }

    // Collect all files touched by this solution
    const filesTouched = new Set<string>();
    for (const task of solution.tasks || []) {
      for (const mp of task.modification_points || []) {
        filesTouched.add(mp.file);
      }
    }

    // Create solution-level queue item (S-N)
    queue.solutions.push({
      item_id: generateQueueItemId(queue, 'solution'),
      issue_id: issueId,
      solution_id: solution.id,
      status: 'pending',
      execution_order: queue.solutions.length + 1,
      execution_group: 'P1',
      depends_on: [],
      semantic_priority: 0.5,
      task_count: solution.tasks?.length || 0,
      files_touched: Array.from(filesTouched)
    });

    writeQueue(queue);
    updateIssue(issueId, { status: 'queued', queued_at: new Date().toISOString() });

    if (isNewQueue) {
      console.log(chalk.green(`✓ Created queue ${queue.id}`));
    }
    console.log(chalk.green(`✓ Added solution ${solution.id} (${solution.tasks?.length || 0} tasks) to queue`));
    return;
  }

  // Show current queue
  const queue = readActiveQueue();

  // Brief mode: minimal queue info (id, issue_ids, item summaries)
  if (options.brief) {
    const items = queue.solutions || queue.tasks || [];
    const briefQueue = {
      id: queue.id,
      issue_ids: queue.issue_ids || [],
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      executing: items.filter(i => i.status === 'executing').length,
      completed: items.filter(i => i.status === 'completed').length,
      items: items.map(i => ({
        item_id: i.item_id,
        issue_id: i.issue_id,
        solution_id: i.solution_id,
        status: i.status,
        task_count: i.task_count
      }))
    };
    console.log(JSON.stringify(briefQueue, null, 2));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(queue, null, 2));
    return;
  }

  console.log(chalk.bold.cyan('\nActive Queue\n'));

  // Support both solution-level and task-level queues
  const items = queue.solutions || queue.tasks || [];
  const isSolutionLevel = !!(queue.solutions && queue.solutions.length > 0);

  if (!queue.id || items.length === 0) {
    console.log(chalk.yellow('No active queue'));
    console.log(chalk.gray('Create one: ccw issue queue add <issue-id>'));
    console.log(chalk.gray('Or list history: ccw issue queue list'));
    return;
  }

  console.log(chalk.gray(`Queue: ${queue.id}`));
  console.log(chalk.gray(`Issues: ${queue.issue_ids.join(', ')}`));
  console.log(chalk.gray(`Total: ${items.length} | Pending: ${items.filter(i => i.status === 'pending').length} | Executing: ${items.filter(i => i.status === 'executing').length} | Completed: ${items.filter(i => i.status === 'completed').length}`));
  console.log();

  if (isSolutionLevel) {
    console.log(chalk.gray('ItemID'.padEnd(10) + 'Issue'.padEnd(15) + 'Tasks'.padEnd(8) + 'Status'));
  } else {
    console.log(chalk.gray('ItemID'.padEnd(10) + 'Issue'.padEnd(15) + 'Task'.padEnd(8) + 'Status'));
  }
  console.log(chalk.gray('-'.repeat(48)));

  for (const item of items) {
    const statusColor = {
      'pending': chalk.gray,
      'ready': chalk.cyan,
      'executing': chalk.yellow,
      'completed': chalk.green,
      'failed': chalk.red,
      'blocked': chalk.magenta
    }[item.status] || chalk.white;

    const thirdCol = isSolutionLevel
      ? String(item.task_count || 0).padEnd(8)
      : (item.task_id || '-').padEnd(8);

    let line = item.item_id.padEnd(10) +
      item.issue_id.substring(0, 13).padEnd(15) +
      thirdCol +
      statusColor(item.status);

    // Show failure reason for failed items
    if (item.status === 'failed') {
      const reason = item.failure_details?.message || item.failure_reason;
      if (reason) {
        // Truncate to 40 chars for display
        const shortReason = reason.length > 40 ? reason.substring(0, 37) + '...' : reason;
        line += chalk.gray(` [${shortReason}]`);
      }
      // Show retry count if there's failure history
      if (item.failure_history && item.failure_history.length > 0) {
        line += chalk.gray(` (${item.failure_history.length} retry)`);
      }
    }

    console.log(line);
  }
}

/**
 * next - Get next ready task for execution (JSON output)
 * Accepts optional item_id to fetch a specific task directly
 */
async function nextAction(itemId: string | undefined, options: IssueOptions): Promise<void> {
  let queue: Queue;
  let items: QueueItem[];

  // Determine which queue(s) to use
  if (options.queue) {
    // Explicit queue specified
    const targetQueue = readQueue(options.queue);
    if (!targetQueue) {
      console.log(JSON.stringify({ status: 'error', message: `Queue ${options.queue} not found` }));
      return;
    }
    queue = targetQueue;
    items = queue.solutions || queue.tasks || [];
  } else {
    // Multi-queue: iterate active queues in priority order (serialized execution)
    const activeQueues = getActiveQueues();

    if (activeQueues.length === 0) {
      console.log(JSON.stringify({ status: 'empty', message: 'No active queues' }));
      return;
    }

    // Find first queue with incomplete items (serialized: complete Q1 before Q2)
    let foundQueue: Queue | null = null;
    for (const q of activeQueues) {
      const queueItems = q.solutions || q.tasks || [];
      const hasIncomplete = queueItems.some(i =>
        i.status === 'pending' || i.status === 'executing'
      );
      if (hasIncomplete) {
        foundQueue = q;
        break;
      }
    }

    if (!foundQueue) {
      console.log(JSON.stringify({ status: 'empty', message: 'All queues completed' }));
      return;
    }

    queue = foundQueue;
    items = queue.solutions || queue.tasks || [];
  }

  let nextItem: QueueItem | undefined;
  let isResume = false;

  // If specific item_id provided, fetch that item directly
  if (itemId) {
    nextItem = items.find(t => t.item_id === itemId);
    if (!nextItem) {
      console.log(JSON.stringify({ status: 'error', message: `Item ${itemId} not found in queue ${queue.id}` }));
      return;
    }
    if (nextItem.status === 'completed') {
      console.log(JSON.stringify({ status: 'completed', message: `Item ${itemId} already completed` }));
      return;
    }
    if (nextItem.status === 'failed') {
      console.log(JSON.stringify({ status: 'failed', message: `Item ${itemId} failed, use retry to reset` }));
      return;
    }
    isResume = nextItem.status === 'executing';
  } else {
    // Auto-select: Priority 1 - executing, Priority 2 - ready pending
    const executingItems = items.filter(item => item.status === 'executing');
    const pendingItems = items.filter(item => {
      if (item.status !== 'pending') return false;
      return (item.depends_on || []).every(depId => {
        const dep = items.find(q => q.item_id === depId);
        return !dep || dep.status === 'completed';
      });
    });

    const readyItems = [...executingItems, ...pendingItems];

    if (readyItems.length === 0) {
      console.log(JSON.stringify({
        status: 'empty',
        message: 'No ready items',
        queue_id: queue.id,
        queue_status: queue._metadata
      }, null, 2));
      return;
    }

    readyItems.sort((a, b) => a.execution_order - b.execution_order);
    nextItem = readyItems[0];
    isResume = nextItem.status === 'executing';
  }

  // Load FULL solution with all tasks
  const solution = findSolution(nextItem.issue_id, nextItem.solution_id);

  if (!solution) {
    console.log(JSON.stringify({ status: 'error', message: 'Solution not found' }));
    process.exit(1);
  }

  // Only update status if not already executing
  if (!isResume) {
    const idx = items.findIndex(q => q.item_id === nextItem.item_id);
    items[idx].status = 'executing';
    items[idx].started_at = new Date().toISOString();
    // Write back to correct array
    if (queue.solutions) {
      queue.solutions = items;
    } else {
      queue.tasks = items;
    }
    writeQueue(queue);
    updateIssue(nextItem.issue_id, { status: 'executing' });
  }

  // Calculate queue stats
  const stats = {
    total: items.length,
    completed: items.filter(q => q.status === 'completed').length,
    failed: items.filter(q => q.status === 'failed').length,
    executing: items.filter(q => q.status === 'executing').length,
    pending: items.filter(q => q.status === 'pending').length
  };
  const remaining = stats.pending + stats.executing;

  // Calculate total estimated time for all tasks
  const totalMinutes = solution.tasks?.reduce((sum, t) => sum + (t.estimated_minutes || 30), 0) || 30;

  console.log(JSON.stringify({
    queue_id: queue.id,
    item_id: nextItem.item_id,
    issue_id: nextItem.issue_id,
    solution_id: nextItem.solution_id,
    // Return full solution object with all tasks
    solution: {
      id: solution.id,
      approach: solution.approach,
      tasks: solution.tasks || [],
      exploration_context: solution.exploration_context || {}
    },
    resumed: isResume,
    resume_note: isResume ? `Resuming interrupted item (started: ${nextItem.started_at})` : undefined,
    execution_hints: {
      task_count: solution.tasks?.length || 0,
      estimated_minutes: totalMinutes
    },
    queue_progress: {
      completed: stats.completed,
      remaining: remaining,
      total: stats.total,
      progress: `${stats.completed}/${stats.total}`
    }
  }, null, 2));
}

/**
 * detail - Get task details by item_id (READ-ONLY, does NOT change status)
 * Used for parallel execution: orchestrator gets dag, then dispatches with detail <id>
 */
async function detailAction(itemId: string | undefined, options: IssueOptions): Promise<void> {
  if (!itemId) {
    console.log(JSON.stringify({ status: 'error', message: 'item_id is required' }));
    return;
  }

  let queue: Queue;
  let queueItem: QueueItem | undefined;

  // Use explicit queue if provided, otherwise auto-detect
  if (options.queue) {
    const targetQueue = readQueue(options.queue);
    if (!targetQueue) {
      console.log(JSON.stringify({ status: 'error', message: `Queue ${options.queue} not found` }));
      return;
    }
    queue = targetQueue;
    const items = queue.solutions || queue.tasks || [];
    queueItem = items.find(t => t.item_id === itemId);
  } else {
    // Auto-detect queue from item ID
    const found = findItemQueue(itemId);
    if (found) {
      queue = found.queue;
      queueItem = found.item;
    } else {
      console.log(JSON.stringify({ status: 'error', message: `Item ${itemId} not found in any queue` }));
      return;
    }
  }

  if (!queueItem) {
    console.log(JSON.stringify({ status: 'error', message: `Item ${itemId} not found` }));
    return;
  }

  // Load FULL solution with all tasks
  const solution = findSolution(queueItem.issue_id, queueItem.solution_id);

  if (!solution) {
    console.log(JSON.stringify({ status: 'error', message: 'Solution not found' }));
    return;
  }

  // Calculate total estimated time for all tasks
  const totalMinutes = solution.tasks?.reduce((sum, t) => sum + (t.estimated_minutes || 30), 0) || 30;

  // Return FULL SOLUTION with all tasks (READ-ONLY - no status update)
  console.log(JSON.stringify({
    queue_id: queue.id,
    item_id: queueItem.item_id,
    issue_id: queueItem.issue_id,
    solution_id: queueItem.solution_id,
    status: queueItem.status,
    // Return full solution object with all tasks
    solution: {
      id: solution.id,
      approach: solution.approach,
      tasks: solution.tasks || [],
      exploration_context: solution.exploration_context || {}
    },
    execution_hints: {
      task_count: solution.tasks?.length || 0,
      estimated_minutes: totalMinutes
    }
  }, null, 2));
}

/**
 * done - Mark task completed or failed
 */
async function doneAction(queueItemId: string | undefined, options: IssueOptions): Promise<void> {
  if (!queueItemId) {
    console.error(chalk.red('Item ID is required'));
    console.error(chalk.gray('Usage: ccw issue done <item-id> [--fail] [--reason "..."] [--queue <queue-id>]'));
    process.exit(1);
  }

  let queue: Queue;
  let items: QueueItem[];
  let idx: number;

  // Use explicit queue if provided, otherwise auto-detect
  if (options.queue) {
    const targetQueue = readQueue(options.queue);
    if (!targetQueue) {
      console.error(chalk.red(`Queue "${options.queue}" not found`));
      process.exit(1);
    }
    queue = targetQueue;
    items = queue.solutions || queue.tasks || [];
    idx = items.findIndex(q => q.item_id === queueItemId);
    if (idx === -1) {
      console.error(chalk.red(`Queue item "${queueItemId}" not found in queue ${options.queue}`));
      process.exit(1);
    }
  } else {
    // Auto-detect queue from item ID
    const found = findItemQueue(queueItemId);
    if (!found) {
      console.error(chalk.red(`Queue item "${queueItemId}" not found in any queue`));
      process.exit(1);
    }
    queue = found.queue;
    items = queue.solutions || queue.tasks || [];
    idx = found.itemIndex;
  }

  const isFail = options.fail;
  items[idx].status = isFail ? 'failed' : 'completed';
  items[idx].completed_at = new Date().toISOString();

  if (isFail) {
    const reason = options.reason || 'Unknown failure';
    items[idx].failure_reason = reason;  // Backward compat
    items[idx].failure_details = parseFailureReason(reason);  // Structured failure
  } else if (options.result) {
    try {
      items[idx].result = JSON.parse(options.result);
    } catch {
      console.warn(chalk.yellow('Warning: Could not parse result JSON'));
    }
  }

  // Update issue status (solution = issue in new model)
  const issueId = items[idx].issue_id;

  if (isFail) {
    updateIssue(issueId, { status: 'failed' });
    console.log(chalk.red(`✗ ${queueItemId} failed`));
  } else {
    updateIssue(issueId, { status: 'completed', completed_at: new Date().toISOString() });
    console.log(chalk.green(`✓ ${queueItemId} completed`));
    console.log(chalk.green(`✓ Issue ${issueId} completed`));
  }

  // Check if entire queue is complete
  const allQueueComplete = items.every(q => q.status === 'completed');
  const anyQueueFailed = items.some(q => q.status === 'failed');

  if (allQueueComplete) {
    queue.status = 'completed';
    console.log(chalk.green(`\n✓ Queue ${queue.id} completed (all solutions done)`));
  } else if (anyQueueFailed && items.every(q => q.status === 'completed' || q.status === 'failed')) {
    queue.status = 'failed';
    console.log(chalk.yellow(`\n⚠ Queue ${queue.id} has failed solutions`));
  }

  // Write back to queue (update the correct array)
  if (queue.solutions) {
    queue.solutions = items;
  } else {
    queue.tasks = items;
  }
  writeQueue(queue);
}

/**
 * retry - Reset failed items to pending for re-execution
 */
async function retryAction(issueId: string | undefined, options: IssueOptions): Promise<void> {
  let queues: Queue[];

  // Use explicit queue if provided, otherwise use all active queues
  if (options.queue) {
    const targetQueue = readQueue(options.queue);
    if (!targetQueue) {
      console.log(chalk.red(`Queue "${options.queue}" not found`));
      return;
    }
    queues = [targetQueue];
  } else {
    queues = getActiveQueues();
  }

  if (queues.length === 0) {
    console.log(chalk.yellow('No active queues'));
    return;
  }

  let totalUpdated = 0;

  for (const queue of queues) {
    const items = queue.solutions || queue.tasks || [];
    let queueUpdated = 0;

    for (const item of items) {
      // Retry failed items only
      if (item.status === 'failed') {
        if (!issueId || item.issue_id === issueId) {
          // Preserve failure history before resetting
          if (item.failure_details) {
            if (!item.failure_history) {
              item.failure_history = [];
            }
            item.failure_history.push(item.failure_details);
          }

          // Reset for retry
          item.status = 'pending';
          item.failure_reason = undefined;
          item.failure_details = undefined;
          item.started_at = undefined;
          item.completed_at = undefined;
          queueUpdated++;
        }
      }
    }

    if (queueUpdated > 0) {
      // Reset queue status if it was failed
      if (queue.status === 'failed') {
        queue.status = 'active';
      }

      // Write back to queue
      if (queue.solutions) {
        queue.solutions = items;
      } else {
        queue.tasks = items;
      }
      writeQueue(queue);
      totalUpdated += queueUpdated;
    }
  }

  if (totalUpdated === 0) {
    console.log(chalk.yellow('No failed items to retry'));
    return;
  }

  if (issueId) {
    updateIssue(issueId, { status: 'queued' });
  }

  console.log(chalk.green(`✓ Reset ${totalUpdated} item(s) to pending (failure history preserved)`));
}

// ============ Main Entry ============

export async function issueCommand(
  subcommand: string,
  args: string | string[],
  options: IssueOptions
): Promise<void> {
  const argsArray = Array.isArray(args) ? args : (args ? [args] : []);

  switch (subcommand) {
    case 'create':
      await createAction(options);
      break;
    case 'solution':
      await solutionAction(argsArray[0], options);
      break;
    case 'init':
      await initAction(argsArray[0], options);
      break;
    case 'list':
      await listAction(argsArray[0], options);
      break;
    case 'history':
      await historyAction(options);
      break;
    case 'status':
      await statusAction(argsArray[0], options);
      break;
    case 'task':
      await taskAction(argsArray[0], argsArray[1], options);
      break;
    case 'bind':
      await bindAction(argsArray[0], argsArray[1], options);
      break;
    case 'update':
      await updateAction(argsArray[0], options);
      break;
    case 'queue':
      await queueAction(argsArray[0], argsArray[1], options);
      break;
    case 'next':
      await nextAction(argsArray[0], options);
      break;
    case 'detail':
      await detailAction(argsArray[0], options);
      break;
    case 'done':
      await doneAction(argsArray[0], options);
      break;
    case 'retry':
      await retryAction(argsArray[0], options);
      break;
    // Legacy aliases
    case 'register':
      console.log(chalk.yellow('Deprecated: use "ccw issue bind <issue-id> --solution <path>"'));
      await bindAction(argsArray[0], undefined, options);
      break;
    case 'complete':
      await doneAction(argsArray[0], options);
      break;
    case 'fail':
      await doneAction(argsArray[0], { ...options, fail: true });
      break;
    default:
      console.log(chalk.bold.cyan('\nCCW Issue Management (v3.0 - Multi-Queue + Lifecycle)\n'));
      console.log(chalk.bold('Core Commands:'));
      console.log(chalk.gray('  create --data \'{"title":"..."}\'    Create issue (auto-generates ID)'));
      console.log(chalk.gray('  init <issue-id>                    Initialize new issue (manual ID)'));
      console.log(chalk.gray('  list [issue-id]                    List issues or tasks'));
      console.log(chalk.gray('  history                            List completed issues (from history)'));
      console.log(chalk.gray('  status [issue-id]                  Show detailed status'));
      console.log(chalk.gray('  solution <id> --data \'{...}\'       Create solution (auto-generates ID)'));
      console.log(chalk.gray('  bind <issue-id> [sol-id]           Bind solution'));
      console.log(chalk.gray('  update <issue-id> --status <s>     Update issue status'));
      console.log(chalk.gray('  update --from-queue [queue-id]     Sync statuses from queue (default: active)'));
      console.log();
      console.log(chalk.bold('Queue Commands:'));
      console.log(chalk.gray('  queue                              Show active queue'));
      console.log(chalk.gray('  queue list                         List all queues (history)'));
      console.log(chalk.gray('  queue add <issue-id>               Add issue to active queue (or create new)'));
      console.log(chalk.gray('  queue switch <queue-id>            Switch active queue'));
      console.log(chalk.gray('  queue activate <q1,q2,...>         Activate multiple queues (comma-separated)'));
      console.log(chalk.gray('  queue priority <queue-id>          Set queue priority (--priority N, lower=higher)'));
      console.log(chalk.gray('  queue dag [--queue <id>]           Get dependency graph (JSON) for parallel execution'));
      console.log(chalk.gray('  queue archive                      Archive current queue'));
      console.log(chalk.gray('  queue delete <queue-id>            Delete queue from history'));
      console.log(chalk.gray('  retry [issue-id] [--queue <id>]    Retry failed tasks'));
      console.log();
      console.log(chalk.bold('Execution Endpoints:'));
      console.log(chalk.gray('  next [item-id] [--queue <id>]      Get & mark task executing (JSON)'));
      console.log(chalk.gray('  detail <item-id> [--queue <id>]    Get task details (READ-ONLY, for parallel)'));
      console.log(chalk.gray('  done <item-id> [--queue <id>]      Mark task completed'));
      console.log(chalk.gray('  done <item-id> --fail --reason "." Mark task failed with reason (supports JSON)'));
      console.log();
      console.log(chalk.bold('Options:'));
      console.log(chalk.gray('  --title <title>                    Issue/task title'));
      console.log(chalk.gray('  --status <status>                  Filter by status (comma-separated)'));
      console.log(chalk.gray('  --brief                            Brief JSON output (minimal fields)'));
      console.log(chalk.gray('  --solution <path>                  Solution JSON file'));
      console.log(chalk.gray('  --result <json>                    Execution result'));
      console.log(chalk.gray('  --reason <text>                    Failure reason (string or JSON)'));
      console.log(chalk.gray('  --queue <queue-id>                 Target queue for multi-queue operations'));
      console.log(chalk.gray('  --priority <n>                     Queue priority (lower = higher)'));
      console.log(chalk.gray('  --json                             JSON output'));
      console.log(chalk.gray('  --force                            Force operation'));
      console.log();
      console.log(chalk.bold('Storage:'));
      console.log(chalk.gray('  .workflow/issues/issues.jsonl         Active issues'));
      console.log(chalk.gray('  .workflow/issues/issue-history.jsonl  Completed issues'));
      console.log(chalk.gray('  .workflow/issues/solutions/*.jsonl Solutions per issue'));
      console.log(chalk.gray('  .workflow/issues/queues/           Queue files (multi-queue)'));
      console.log(chalk.gray('  .workflow/issues/queues/index.json Queue index'));
  }
}
