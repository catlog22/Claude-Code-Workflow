/**
 * Session Manager Tool - Workflow session lifecycle management
 * Operations: init, list, read, write, update, archive, mkdir, delete, stats
 * Content routing via content_type + path_params
 */

import { z } from 'zod';
import type { ToolSchema, ToolResult } from '../types/tool.js';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs';
import { resolve, join, dirname } from 'path';

// Base paths for session storage
const WORKFLOW_BASE = '.workflow';
const ACTIVE_BASE = '.workflow/active';
const ARCHIVE_BASE = '.workflow/archives';
const LITE_PLAN_BASE = '.workflow/.lite-plan';
const LITE_FIX_BASE = '.workflow/.lite-fix';

// Session ID validation pattern (alphanumeric, hyphen, underscore)
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Zod schemas - using tuple syntax for z.enum
const ContentTypeEnum = z.enum([
  'session', 'plan', 'task', 'summary', 'process', 'chat', 'brainstorm',
  'review-dim', 'review-iter', 'review-fix', 'todo', 'context',
  // Lite-specific content types
  'lite-plan', 'lite-fix-plan', 'exploration', 'explorations-manifest',
  'diagnosis', 'diagnoses-manifest', 'clarifications', 'execution-context', 'session-metadata'
]);

const OperationEnum = z.enum(['init', 'list', 'read', 'write', 'update', 'archive', 'mkdir', 'delete', 'stats']);

const LocationEnum = z.enum([
  'active', 'archived', 'both',
  'lite-plan', 'lite-fix', 'all'
]);

const ParamsSchema = z.object({
  operation: OperationEnum,
  session_id: z.string().optional(),
  content_type: ContentTypeEnum.optional(),
  content: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
  path_params: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  location: LocationEnum.optional(),
  include_metadata: z.boolean().optional(),
  dirs: z.array(z.string()).optional(),
  update_status: z.boolean().optional(),
  file_path: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;
type ContentType = z.infer<typeof ContentTypeEnum>;
type Operation = z.infer<typeof OperationEnum>;
type Location = z.infer<typeof LocationEnum>;

interface SessionInfo {
  session_id: string;
  location: string;
  metadata?: any;
}

interface SessionLocation {
  path: string;
  location: string;
}

interface TaskStats {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
  cancelled: number;
}

// Cached workflow root (computed once per execution)
let cachedWorkflowRoot: string | null = null;

/**
 * Find project root by traversing up looking for .workflow directory
 * Falls back to cwd if not found
 */
function findWorkflowRoot(): string {
  if (cachedWorkflowRoot) return cachedWorkflowRoot;

  let dir = process.cwd();
  const root = dirname(dir) === dir ? dir : null; // filesystem root

  while (dir && dir !== root) {
    if (existsSync(join(dir, WORKFLOW_BASE))) {
      cachedWorkflowRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Fallback to cwd (for init operation)
  cachedWorkflowRoot = process.cwd();
  return cachedWorkflowRoot;
}

/**
 * Validate session ID format
 */
function validateSessionId(sessionId: string): void {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('session_id must be a non-empty string');
  }
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(
      `Invalid session_id format: "${sessionId}". Only alphanumeric, hyphen, and underscore allowed.`
    );
  }
  if (sessionId.length > 100) {
    throw new Error('session_id must be 100 characters or less');
  }
}

/**
 * Validate path params to prevent path traversal
 */
function validatePathParams(pathParams: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(pathParams)) {
    if (typeof value !== 'string') continue;
    if (value.includes('..') || value.includes('/') || value.includes('\\')) {
      throw new Error(`Invalid path_params.${key}: path traversal characters not allowed`);
    }
  }
}

/**
 * Content type to file path routing
 * {base} is replaced with session base path
 * Dynamic params: {task_id}, {filename}, {dimension}, {iteration}
 */
const PATH_ROUTES: Record<ContentType, string> = {
  // Standard WFS content types
  session: '{base}/workflow-session.json',
  plan: '{base}/IMPL_PLAN.md',
  task: '{base}/.task/{task_id}.json',
  summary: '{base}/.summaries/{task_id}-summary.md',
  process: '{base}/.process/{filename}',
  chat: '{base}/.chat/{filename}',
  brainstorm: '{base}/.brainstorming/{filename}',
  'review-dim': '{base}/.review/dimensions/{dimension}.json',
  'review-iter': '{base}/.review/iterations/{iteration}.json',
  'review-fix': '{base}/.review/fixes/{filename}',
  todo: '{base}/TODO_LIST.md',
  context: '{base}/context-package.json',
  // Lite-specific content types
  'lite-plan': '{base}/plan.json',
  'lite-fix-plan': '{base}/fix-plan.json',
  'exploration': '{base}/exploration-{angle}.json',
  'explorations-manifest': '{base}/explorations-manifest.json',
  'diagnosis': '{base}/diagnosis-{angle}.json',
  'diagnoses-manifest': '{base}/diagnoses-manifest.json',
  'clarifications': '{base}/clarifications.json',
  'execution-context': '{base}/execution-context.json',
  'session-metadata': '{base}/session-metadata.json',
};

/**
 * Resolve path with base and parameters
 */
function resolvePath(
  base: string,
  contentType: ContentType,
  pathParams: Record<string, string> = {}
): string {
  const template = PATH_ROUTES[contentType];
  if (!template) {
    throw new Error(
      `Unknown content_type: ${contentType}. Valid types: ${Object.keys(PATH_ROUTES).join(', ')}`
    );
  }

  let path = template.replace('{base}', base);

  // Replace dynamic parameters
  for (const [key, value] of Object.entries(pathParams)) {
    path = path.replace(`{${key}}`, value);
  }

  // Check for unreplaced placeholders
  const unreplaced = path.match(/\{[^}]+\}/g);
  if (unreplaced) {
    throw new Error(
      `Missing path_params: ${unreplaced.join(', ')} for content_type "${contentType}"`
    );
  }

  return resolve(findWorkflowRoot(), path);
}

/**
 * Get session base path
 */
function getSessionBase(
  sessionId: string,
  location: 'active' | 'archived' | 'lite-plan' | 'lite-fix' = 'active'
): string {
  const locationMap: Record<string, string> = {
    'active': ACTIVE_BASE,
    'archived': ARCHIVE_BASE,
    'lite-plan': LITE_PLAN_BASE,
    'lite-fix': LITE_FIX_BASE,
  };
  const basePath = locationMap[location] || ACTIVE_BASE;
  return resolve(findWorkflowRoot(), basePath, sessionId);
}

/**
 * Auto-detect session location by searching all known paths
 * Search order: active, archives, lite-plan, lite-fix
 */
function findSession(sessionId: string): SessionLocation | null {
  const root = findWorkflowRoot();
  const searchPaths = [
    { path: resolve(root, ACTIVE_BASE, sessionId), location: 'active' },
    { path: resolve(root, ARCHIVE_BASE, sessionId), location: 'archived' },
    { path: resolve(root, LITE_PLAN_BASE, sessionId), location: 'lite-plan' },
    { path: resolve(root, LITE_FIX_BASE, sessionId), location: 'lite-fix' },
  ];

  for (const { path, location } of searchPaths) {
    if (existsSync(path)) {
      return { path, location };
    }
  }
  return null;
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Read JSON file safely
 */
function readJsonFile(filePath: string): any {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
    throw new Error(`Failed to read ${filePath}: ${(error as Error).message}`);
  }
}

/**
 * Write JSON file with formatting
 */
function writeJsonFile(filePath: string, data: any): void {
  ensureDir(dirname(filePath));
  const content = JSON.stringify(data, null, 2);
  writeFileSync(filePath, content, 'utf8');
}

/**
 * Write text file
 */
function writeTextFile(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content, 'utf8');
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * List sessions in a specific directory
 * @param dirPath - Directory to scan
 * @param location - Location identifier for returned sessions
 * @param prefix - Optional prefix filter (e.g., 'WFS-'), null means no filter
 * @param includeMetadata - Whether to load metadata for each session
 */
function listSessionsInDir(
  dirPath: string,
  location: string,
  prefix: string | null,
  includeMetadata: boolean
): SessionInfo[] {
  if (!existsSync(dirPath)) return [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && (prefix === null || e.name.startsWith(prefix)))
      .map(e => {
        const sessionInfo: SessionInfo = { session_id: e.name, location };
        if (includeMetadata) {
          // Try multiple metadata file locations
          const metaPaths = [
            join(dirPath, e.name, 'workflow-session.json'),
            join(dirPath, e.name, 'session-metadata.json'),
            join(dirPath, e.name, 'explorations-manifest.json'),
            join(dirPath, e.name, 'diagnoses-manifest.json'),
          ];
          for (const metaPath of metaPaths) {
            if (existsSync(metaPath)) {
              try {
                sessionInfo.metadata = readJsonFile(metaPath);
                break;
              } catch { /* continue */ }
            }
          }
        }
        return sessionInfo;
      });
  } catch {
    return [];
  }
}

// ============================================================
// Operation Handlers
// ============================================================

/**
 * Operation: init
 * Create new session with directory structure
 * Supports both WFS sessions and lite sessions (lite-plan, lite-fix)
 */
function executeInit(params: Params): any {
  const { session_id, metadata, location } = params;

  if (!session_id) {
    throw new Error('Parameter "session_id" is required for init');
  }

  // Validate session_id format
  validateSessionId(session_id);

  // Auto-infer location from metadata.type if location not explicitly provided
  // Priority: explicit location > metadata.type > default 'active'
  const sessionLocation: 'active' | 'archived' | 'lite-plan' | 'lite-fix' = 
    (location === 'active' || location === 'archived' || location === 'lite-plan' || location === 'lite-fix') 
      ? location
      : (metadata?.type === 'lite-plan' ? 'lite-plan' :
         metadata?.type === 'lite-fix' ? 'lite-fix' :
         'active');

  // Check if session already exists (auto-detect all locations)
  const existing = findSession(session_id);
  if (existing) {
    throw new Error(`Session "${session_id}" already exists in ${existing.location}`);
  }

  const sessionPath = getSessionBase(session_id, sessionLocation);

  // Create session directory structure based on type
  ensureDir(sessionPath);

  let directoriesCreated: string[] = [];
  if (sessionLocation === 'lite-plan' || sessionLocation === 'lite-fix') {
    // Lite sessions: minimal structure, files created by workflow
    // No subdirectories needed initially
    directoriesCreated = [];
  } else {
    // WFS sessions: standard structure
    ensureDir(join(sessionPath, '.task'));
    ensureDir(join(sessionPath, '.summaries'));
    ensureDir(join(sessionPath, '.process'));
    directoriesCreated = ['.task', '.summaries', '.process'];
  }

  // Create session metadata file if provided
  let sessionMetadata = null;
  if (metadata) {
    const sessionFile = sessionLocation.startsWith('lite-')
      ? join(sessionPath, 'session-metadata.json')  // Lite sessions
      : join(sessionPath, 'workflow-session.json'); // WFS sessions

    const sessionData = {
      session_id,
      type: metadata?.type || sessionLocation,  // Preserve user-specified type if provided
      status: 'initialized',
      created_at: new Date().toISOString(),
      ...metadata,
    };
    writeJsonFile(sessionFile, sessionData);
    sessionMetadata = sessionData;
  }

  return {
    operation: 'init',
    session_id,
    location: sessionLocation,
    path: sessionPath,
    directories_created: directoriesCreated,
    metadata: sessionMetadata,
    message: `Session "${session_id}" initialized in ${sessionLocation}`,
  };
}

/**
 * Operation: list
 * List sessions (active, archived, lite-plan, lite-fix, or all)
 */
function executeList(params: Params): any {
  const { location = 'both', include_metadata = false } = params;

  const result: {
    operation: string;
    active: SessionInfo[];
    archived: SessionInfo[];
    litePlan: SessionInfo[];
    liteFix: SessionInfo[];
    total: number;
  } = {
    operation: 'list',
    active: [],
    archived: [],
    litePlan: [],
    liteFix: [],
    total: 0,
  };

  const root = findWorkflowRoot();

  // Helper to check if location should be included
  const shouldInclude = (loc: string) =>
    location === 'all' || location === 'both' || location === loc;

  // List active sessions (WFS-* prefix)
  if (shouldInclude('active')) {
    result.active = listSessionsInDir(
      resolve(root, ACTIVE_BASE),
      'active',
      'WFS-',
      include_metadata
    );
  }

  // List archived sessions (WFS-* prefix)
  if (shouldInclude('archived')) {
    result.archived = listSessionsInDir(
      resolve(root, ARCHIVE_BASE),
      'archived',
      'WFS-',
      include_metadata
    );
  }

  // List lite-plan sessions (no prefix filter)
  if (location === 'all' || location === 'lite-plan') {
    result.litePlan = listSessionsInDir(
      resolve(root, LITE_PLAN_BASE),
      'lite-plan',
      null,
      include_metadata
    );
  }

  // List lite-fix sessions (no prefix filter)
  if (location === 'all' || location === 'lite-fix') {
    result.liteFix = listSessionsInDir(
      resolve(root, LITE_FIX_BASE),
      'lite-fix',
      null,
      include_metadata
    );
  }

  result.total = result.active.length + result.archived.length +
                 result.litePlan.length + result.liteFix.length;

  return result;
}

/**
 * Operation: read
 * Read file content by content_type
 */
function executeRead(params: Params): any {
  const { session_id, content_type, path_params = {} } = params;

  if (!session_id) {
    throw new Error('Parameter "session_id" is required for read');
  }
  if (!content_type) {
    throw new Error('Parameter "content_type" is required for read');
  }

  // Validate inputs
  validateSessionId(session_id);
  validatePathParams(path_params);

  const session = findSession(session_id);
  if (!session) {
    throw new Error(`Session "${session_id}" not found`);
  }

  const filePath = resolvePath(session.path, content_type, path_params as Record<string, string>);

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Read content
  const rawContent = readFileSync(filePath, 'utf8');

  // Parse JSON for JSON content types
  const isJson = filePath.endsWith('.json');
  const content = isJson ? JSON.parse(rawContent) : rawContent;

  return {
    operation: 'read',
    session_id,
    content_type,
    path: filePath,
    location: session.location,
    content,
    is_json: isJson,
  };
}

/**
 * Operation: write
 * Write content to file by content_type
 */
function executeWrite(params: Params): any {
  const { session_id, content_type, content, path_params = {} } = params;

  if (!session_id) {
    throw new Error('Parameter "session_id" is required for write');
  }
  if (!content_type) {
    throw new Error('Parameter "content_type" is required for write');
  }
  if (content === undefined) {
    throw new Error('Parameter "content" is required for write');
  }

  // Validate inputs
  validateSessionId(session_id);
  validatePathParams(path_params);

  const session = findSession(session_id);
  if (!session) {
    throw new Error(`Session "${session_id}" not found. Use init operation first.`);
  }

  const filePath = resolvePath(session.path, content_type, path_params as Record<string, string>);
  const isJson = filePath.endsWith('.json');

  // Write content
  if (isJson) {
    writeJsonFile(filePath, content);
  } else {
    writeTextFile(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }

  // Return written content for task/summary types
  const returnContent =
    content_type === 'task' || content_type === 'summary' ? content : undefined;

  return {
    operation: 'write',
    session_id,
    content_type,
    written_content: returnContent,
    path: filePath,
    location: session.location,
    message: `File written successfully`,
  };
}

/**
 * Operation: update
 * Update existing JSON file with shallow merge
 */
function executeUpdate(params: Params): any {
  const { session_id, content_type, content, path_params = {} } = params;

  if (!session_id) {
    throw new Error('Parameter "session_id" is required for update');
  }
  if (!content_type) {
    throw new Error('Parameter "content_type" is required for update');
  }
  if (!content || typeof content !== 'object') {
    throw new Error('Parameter "content" must be an object for update');
  }

  const session = findSession(session_id);
  if (!session) {
    throw new Error(`Session "${session_id}" not found`);
  }

  const filePath = resolvePath(session.path, content_type, path_params as Record<string, string>);

  if (!filePath.endsWith('.json')) {
    throw new Error('Update operation only supports JSON files');
  }

  // Read existing content or start with empty object
  let existing: any = {};
  if (existsSync(filePath)) {
    existing = readJsonFile(filePath);
  }

  // Shallow merge
  const merged = { ...existing, ...(content as object) };
  writeJsonFile(filePath, merged);

  return {
    operation: 'update',
    session_id,
    content_type,
    path: filePath,
    location: session.location,
    fields_updated: Object.keys(content as object),
    merged_data: merged,
    message: `File updated successfully`,
  };
}

/**
 * Operation: archive
 * Move session from active to archives
 */
function executeArchive(params: Params): any {
  const { session_id, update_status = true } = params;

  if (!session_id) {
    throw new Error('Parameter "session_id" is required for archive');
  }

  // Find session in any location
  const session = findSession(session_id);
  if (!session) {
    throw new Error(`Session "${session_id}" not found`);
  }

  // Lite sessions do not support archiving
  if (session.location === 'lite-plan' || session.location === 'lite-fix') {
    throw new Error(`Lite sessions (${session.location}) do not support archiving. Use delete operation instead.`);
  }

  // Determine archive destination based on source location
  let archivePath: string;

  if (session.location === 'active') {
    archivePath = getSessionBase(session_id, 'archived');
  } else {
    // Already archived
    return {
      operation: 'archive',
      session_id,
      status: 'already_archived',
      path: session.path,
      location: session.location,
      message: `Session "${session_id}" is already archived`,
    };
  }

  // Update status before archiving
  if (update_status) {
    const metadataFiles = [
      join(session.path, 'workflow-session.json'),
      join(session.path, 'session-metadata.json'),
      join(session.path, 'explorations-manifest.json'),
    ];
    for (const metaFile of metadataFiles) {
      if (existsSync(metaFile)) {
        try {
          const data = readJsonFile(metaFile);
          data.status = 'completed';
          data.archived_at = new Date().toISOString();
          writeJsonFile(metaFile, data);
          break;
        } catch { /* continue */ }
      }
    }

    // Update all task JSONs to completed status
    const taskDir = join(session.path, '.task');
    if (existsSync(taskDir)) {
      const taskFiles = readdirSync(taskDir).filter(f => f.endsWith('.json'));
      for (const taskFile of taskFiles) {
        try {
          const taskPath = join(taskDir, taskFile);
          const taskData = readJsonFile(taskPath);
          if (taskData.status && taskData.status !== 'completed') {
            taskData.status = 'completed';
            taskData.completed_at = new Date().toISOString();
            writeJsonFile(taskPath, taskData);
          }
        } catch { /* skip invalid task files */ }
      }
    }
  }

  // Ensure archive directory exists
  ensureDir(dirname(archivePath));

  // Move session directory
  renameSync(session.path, archivePath);

  // Read session metadata after archiving
  let sessionMetadata = null;
  const metadataFiles = [
    join(archivePath, 'workflow-session.json'),
    join(archivePath, 'session-metadata.json'),
    join(archivePath, 'explorations-manifest.json'),
  ];
  for (const metaFile of metadataFiles) {
    if (existsSync(metaFile)) {
      try {
        sessionMetadata = readJsonFile(metaFile);
        break;
      } catch { /* continue */ }
    }
  }

  // Update development index with archived session info
  if (sessionMetadata) {
    updateDevelopmentIndex(sessionMetadata);
  }

  return {
    operation: 'archive',
    session_id,
    status: 'archived',
    source: session.path,
    source_location: session.location,
    destination: archivePath,
    metadata: sessionMetadata,
    message: `Session "${session_id}" archived from ${session.location}`,
  };
}

/**
 * Operation: mkdir
 * Create directory structure within session
 */
function executeMkdir(params: Params): any {
  const { session_id, dirs } = params;

  if (!session_id) {
    throw new Error('Parameter "session_id" is required for mkdir');
  }
  if (!dirs || !Array.isArray(dirs) || dirs.length === 0) {
    throw new Error('Parameter "dirs" must be a non-empty array');
  }

  const session = findSession(session_id);
  if (!session) {
    throw new Error(`Session "${session_id}" not found`);
  }

  const created: string[] = [];
  for (const dir of dirs) {
    const dirPath = join(session.path, dir);
    ensureDir(dirPath);
    created.push(dir);
  }

  return {
    operation: 'mkdir',
    session_id,
    location: session.location,
    directories_created: created,
    message: `Created ${created.length} directories`,
  };
}

/**
 * Operation: delete
 * Delete a file within session (security: path traversal prevention)
 */
function executeDelete(params: Params): any {
  const { session_id, file_path } = params;

  if (!session_id) {
    throw new Error('Parameter "session_id" is required for delete');
  }
  if (!file_path) {
    throw new Error('Parameter "file_path" is required for delete');
  }

  // Validate session exists
  const session = findSession(session_id);
  if (!session) {
    throw new Error(`Session "${session_id}" not found`);
  }

  // Security: Prevent path traversal
  if (file_path.includes('..') || file_path.includes('\\')) {
    throw new Error('Invalid file_path: path traversal characters not allowed');
  }

  // Construct absolute path
  const absolutePath = resolve(session.path, file_path);

  // Security: Verify path is within session directory
  if (!absolutePath.startsWith(session.path)) {
    throw new Error('Security error: file_path must be within session directory');
  }

  // Check file exists
  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${file_path}`);
  }

  // Delete the file
  rmSync(absolutePath, { force: true });

  return {
    operation: 'delete',
    session_id,
    deleted: file_path,
    absolute_path: absolutePath,
    message: `File deleted successfully`,
  };
}

/**
 * Operation: stats
 * Get session statistics (tasks, summaries, plan)
 */
function executeStats(params: Params): any {
  const { session_id } = params;

  if (!session_id) {
    throw new Error('Parameter "session_id" is required for stats');
  }

  // Validate session exists
  const session = findSession(session_id);
  if (!session) {
    throw new Error(`Session "${session_id}" not found`);
  }

  const taskDir = join(session.path, '.task');
  const summariesDir = join(session.path, '.summaries');
  const planFile = join(session.path, 'IMPL_PLAN.md');

  // Count tasks by status
  const taskStats: TaskStats = {
    total: 0,
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
  };

  if (existsSync(taskDir)) {
    const taskFiles = readdirSync(taskDir).filter((f) => f.endsWith('.json'));
    taskStats.total = taskFiles.length;

    for (const taskFile of taskFiles) {
      try {
        const taskPath = join(taskDir, taskFile);
        const taskData = readJsonFile(taskPath);
        const status = taskData.status || 'unknown';
        if (status in taskStats) {
          (taskStats as any)[status]++;
        }
      } catch {
        // Skip invalid task files
      }
    }
  }

  // Count summaries
  let summariesCount = 0;
  if (existsSync(summariesDir)) {
    summariesCount = readdirSync(summariesDir).filter((f) => f.endsWith('.md')).length;
  }

  // Check for plan
  const hasPlan = existsSync(planFile);

  return {
    operation: 'stats',
    session_id,
    location: session.location,
    tasks: taskStats,
    summaries: summariesCount,
    has_plan: hasPlan,
    message: `Session statistics retrieved`,
  };
}

/**
 * Updates the project's development index when a session is archived.
 * Simplified: only appends entries, does NOT manage statistics.
 * Dashboard aggregator handles dynamic calculation.
 */
function updateDevelopmentIndex(sessionMetadata: any): void {
  if (!sessionMetadata || !sessionMetadata.session_id) {
    console.warn('Skipping development index update due to missing session metadata.');
    return;
  }

  const root = findWorkflowRoot();
  const projectTechFile = join(root, WORKFLOW_BASE, 'project-tech.json');

  if (!existsSync(projectTechFile)) {
    console.warn(`Skipping development index update: ${projectTechFile} not found.`);
    return;
  }

  try {
    const projectData = readJsonFile(projectTechFile);

    // Ensure development_index exists
    if (!projectData.development_index) {
      projectData.development_index = { feature: [], enhancement: [], bugfix: [], refactor: [], docs: [] };
    }

    // Type inference from description
    const description = (sessionMetadata.description || '').toLowerCase();
    let devType: 'feature' | 'enhancement' | 'bugfix' | 'refactor' | 'docs' = 'enhancement';

    if (sessionMetadata.type === 'docs') {
      devType = 'docs';
    } else if (/\b(fix|bug|resolve)\b/.test(description)) {
      devType = 'bugfix';
    } else if (/\b(feature|implement|add|create)\b/.test(description)) {
      devType = 'feature';
    } else if (/\b(refactor|restructure|cleanup)\b/.test(description)) {
      devType = 'refactor';
    }

    const entry = {
      title: sessionMetadata.description || sessionMetadata.project || sessionMetadata.session_id,
      sessionId: sessionMetadata.session_id,
      type: devType,
      tags: sessionMetadata.tags || [],
      archivedAt: sessionMetadata.archived_at || new Date().toISOString(),
    };

    // Append to correct category
    if (!projectData.development_index[devType]) {
      projectData.development_index[devType] = [];
    }
    projectData.development_index[devType].push(entry);

    // CRITICAL: Do NOT touch projectData.statistics
    // Dashboard aggregator handles dynamic calculation

    writeJsonFile(projectTechFile, projectData);
    console.log(`Development index updated for session: ${sessionMetadata.session_id}`);

  } catch (error) {
    console.error(`Failed to update development index: ${(error as Error).message}`);
  }
}

// ============================================================
// Main Execute Function
// ============================================================

/**
 * Route to appropriate operation handler
 */
async function execute(params: Params): Promise<any> {
  const { operation } = params;

  if (!operation) {
    throw new Error(
      'Parameter "operation" is required. Valid operations: init, list, read, write, update, archive, mkdir, delete, stats'
    );
  }

  switch (operation) {
    case 'init':
      return executeInit(params);
    case 'list':
      return executeList(params);
    case 'read':
      return executeRead(params);
    case 'write':
      return executeWrite(params);
    case 'update':
      return executeUpdate(params);
    case 'archive':
      return executeArchive(params);
    case 'mkdir':
      return executeMkdir(params);
    case 'delete':
      return executeDelete(params);
    case 'stats':
      return executeStats(params);
    default:
      throw new Error(
        `Unknown operation: ${operation}. Valid operations: init, list, read, write, update, archive, mkdir, delete, stats`
      );
  }
}

// ============================================================
// Tool Definition
// ============================================================

export const schema: ToolSchema = {
  name: 'session_manager',
  description: `Workflow session management. Choose an operation and provide its required parameters.

**Operations & Required Parameters:**

*   **init**: Initialize a new workflow session.
    *   **metadata** (object, **REQUIRED**): Session metadata with project, type, description.
    *   Returns: New session ID.

*   **list**: List workflow sessions.
    *   *location* (string): Filter by "active" | "archived" | "both" (default: "both").
    *   *include_metadata* (boolean): Include session metadata (default: false).

*   **read**: Read content from a session file.
    *   **session_id** (string, **REQUIRED**): Session ID (e.g., WFS-my-session).
    *   **content_type** (string, **REQUIRED**): Type to read - "plan" | "task" | "summary" | "session" | "process" | "chat" | "brainstorm" | "review-dim" | "review-iter" | "review-fix" | "todo" | "context".
    *   *path_params* (object): Dynamic path parameters (task_id, filename, dimension, iteration).

*   **write**: Write content to a session file.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **content_type** (string, **REQUIRED**): Type to write (see read operation).
    *   **content** (object, **REQUIRED**): Content to write (object for JSON, string for text).
    *   *path_params* (object): Dynamic path parameters.

*   **update**: Update existing content.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **content_type** (string, **REQUIRED**): Type to update.
    *   **content** (object, **REQUIRED**): Updated content.
    *   *path_params* (object): Dynamic path parameters.

*   **archive**: Archive a completed session.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   *update_status* (boolean): Mark status as completed (default: true).

*   **mkdir**: Create session directories.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **dirs** (array, **REQUIRED**): Directory paths to create.

*   **delete**: Delete a file within a session.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **file_path** (string, **REQUIRED**): Relative file path to delete.

*   **stats**: Get session statistics.
    *   **session_id** (string, **REQUIRED**): Session ID.

**Session ID Format:** WFS-{name}-{date} (e.g., WFS-my-project-2026-03-05)`,
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['init', 'list', 'read', 'write', 'update', 'archive', 'mkdir', 'delete', 'stats'],
        description: 'Operation to perform',
      },
      session_id: {
        type: 'string',
        description: 'Session identifier (e.g., WFS-my-session). Required for all operations except list.',
      },
      content_type: {
        type: 'string',
        enum: [
          'session',
          'plan',
          'task',
          'summary',
          'process',
          'chat',
          'brainstorm',
          'review-dim',
          'review-iter',
          'review-fix',
          'todo',
          'context',
        ],
        description: 'Content type for read/write/update operations',
      },
      content: {
        type: 'object',
        description: 'Content for write/update operations (object for JSON, string for text)',
      },
      path_params: {
        type: 'object',
        description: 'Dynamic path parameters: task_id, filename, dimension, iteration',
      },
      metadata: {
        type: 'object',
        description: 'Session metadata for init operation (project, type, description, etc.)',
      },
      location: {
        type: 'string',
        enum: ['active', 'archived', 'both'],
        description: 'Session location filter for list operation (default: both)',
      },
      include_metadata: {
        type: 'boolean',
        description: 'Include session metadata in list results (default: false)',
      },
      dirs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Directory paths to create for mkdir operation',
      },
      update_status: {
        type: 'boolean',
        description: 'Update session status to completed when archiving (default: true)',
      },
      file_path: {
        type: 'string',
        description: 'Relative file path within session for delete operation',
      },
    },
    required: ['operation'],
  },
};

export async function handler(params: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  try {
    const result = await execute(parsed.data);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
