import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

interface TaskMeta {
  type: string;
  agent: string | null;
  scope: string | null;
  module: string | null;
}

interface TaskContext {
  requirements: string[];
  focus_paths: string[];
  acceptance: string[];
  depends_on: string[];
}

interface TaskFlowControl {
  implementation_approach: Array<{
    step: string;
    action: string;
  }>;
}

interface NormalizedTask {
  id: string;
  title: string;
  status: string;
  meta: TaskMeta;
  context: TaskContext;
  flow_control: TaskFlowControl;
  _raw: unknown;
}

interface Progress {
  total: number;
  completed: number;
  percentage: number;
}

interface DiagnosisItem {
  id: string;
  filename: string;
  [key: string]: unknown;
}

interface Diagnoses {
  manifest: unknown | null;
  items: DiagnosisItem[];
}

interface LiteSession {
  id: string;
  type: string;
  path: string;
  createdAt: string;
  plan: unknown | null;
  tasks: NormalizedTask[];
  diagnoses?: Diagnoses;
  progress: Progress;
}

interface LiteTasks {
  litePlan: LiteSession[];
  liteFix: LiteSession[];
}

interface LiteTaskDetail {
  id: string;
  type: string;
  path: string;
  plan: unknown | null;
  tasks: NormalizedTask[];
  explorations: unknown[];
  clarifications: unknown | null;
  diagnoses?: Diagnoses;
}

/**
 * Scan lite-plan and lite-fix directories for task sessions
 * @param workflowDir - Path to .workflow directory
 * @returns Lite tasks data
 */
export async function scanLiteTasks(workflowDir: string): Promise<LiteTasks> {
  const litePlanDir = join(workflowDir, '.lite-plan');
  const liteFixDir = join(workflowDir, '.lite-fix');

  const [litePlan, liteFix] = await Promise.all([
    scanLiteDir(litePlanDir, 'lite-plan'),
    scanLiteDir(liteFixDir, 'lite-fix'),
  ]);

  return { litePlan, liteFix };
}

/**
 * Scan a lite task directory
 * @param dir - Directory path
 * @param type - Task type ('lite-plan' or 'lite-fix')
 * @returns Array of lite task sessions
 */
async function scanLiteDir(dir: string, type: string): Promise<LiteSession[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    const sessions = (await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const sessionPath = join(dir, entry.name);

          const [createdAt, plan, tasks, diagnoses] = await Promise.all([
            getCreatedTime(sessionPath),
            loadPlanJson(sessionPath),
            loadTaskJsons(sessionPath),
            type === 'lite-fix' ? loadDiagnoses(sessionPath) : Promise.resolve(undefined),
          ]);

          const session: LiteSession = {
            id: entry.name,
            type,
            path: sessionPath,
            createdAt,
            plan,
            tasks,
            diagnoses,
            progress: { total: 0, completed: 0, percentage: 0 },
          };

          session.progress = calculateProgress(session.tasks);
          return session;
        }),
    ))
      .filter((session): session is LiteSession => session !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return sessions;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    console.error(`Error scanning ${dir}:`, err?.message || String(err));
    return [];
  }
}

/**
 * Load plan.json or fix-plan.json from session directory
 * @param sessionPath - Session directory path
 * @returns Plan data or null
 */
async function loadPlanJson(sessionPath: string): Promise<unknown | null> {
  // Try fix-plan.json first (for lite-fix), then plan.json (for lite-plan)
  const fixPlanPath = join(sessionPath, 'fix-plan.json');
  const planPath = join(sessionPath, 'plan.json');

  // Try fix-plan.json first
  try {
    const content = await readFile(fixPlanPath, 'utf8');
    return JSON.parse(content);
  } catch {
    // Continue to try plan.json
  }

  // Fallback to plan.json
  try {
    const content = await readFile(planPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load all task JSON files from session directory
 * Supports multiple task formats:
 * 1. .task/IMPL-*.json files
 * 2. tasks array in plan.json
 * 3. task-*.json files in session root
 * @param sessionPath - Session directory path
 * @returns Array of task objects
 */
async function loadTaskJsons(sessionPath: string): Promise<NormalizedTask[]> {
  let tasks: NormalizedTask[] = [];

  // Method 1: Check .task/IMPL-*.json files
  const taskDir = join(sessionPath, '.task');
  try {
    const implFiles = (await readdir(taskDir))
      .filter((fileName) => fileName.endsWith('.json') && (
        fileName.startsWith('IMPL-') ||
        fileName.startsWith('TASK-') ||
        fileName.startsWith('task-') ||
        fileName.startsWith('diagnosis-') ||
        /^T\d+\.json$/i.test(fileName)
      ));

    const implTasks = (await Promise.all(
      implFiles.map(async (fileName) => {
        const taskPath = join(taskDir, fileName);
        try {
          const content = await readFile(taskPath, 'utf8');
          return normalizeTask(JSON.parse(content));
        } catch {
          return null;
        }
      }),
    ))
      .filter((task): task is NormalizedTask => task !== null);

    tasks = tasks.concat(implTasks);
  } catch {
    // Continue to other methods
  }

  // Method 2: Check plan.json or fix-plan.json for embedded tasks array
  if (tasks.length === 0) {
    const planFiles = [join(sessionPath, 'fix-plan.json'), join(sessionPath, 'plan.json')];

    for (const planFile of planFiles) {
      try {
        const plan = JSON.parse(await readFile(planFile, 'utf8')) as { tasks?: unknown[] };
        if (Array.isArray(plan.tasks)) {
          tasks = plan.tasks
            .map((task) => normalizeTask(task))
            .filter((task): task is NormalizedTask => task !== null);
          break;
        }
      } catch {
        // Continue to other plan files
      }
    }
  }

  // Method 3: Check for task-*.json and diagnosis-*.json files in session root
  if (tasks.length === 0) {
    try {
      const rootFiles = (await readdir(sessionPath))
        .filter((fileName) => fileName.endsWith('.json') && (
          fileName.startsWith('task-') ||
          fileName.startsWith('TASK-') ||
          fileName.startsWith('diagnosis-') ||
          /^T\d+\.json$/i.test(fileName)
        ));

      const rootTasks = (await Promise.all(
        rootFiles.map(async (fileName) => {
          const taskPath = join(sessionPath, fileName);
          try {
            const content = await readFile(taskPath, 'utf8');
            return normalizeTask(JSON.parse(content));
          } catch {
            return null;
          }
        }),
      ))
        .filter((task): task is NormalizedTask => task !== null);

      tasks = tasks.concat(rootTasks);
    } catch {
      // No tasks found
    }
  }

  // Sort tasks by ID
  return tasks.sort((a, b) => {
    const aNum = parseInt(a.id?.replace(/\D/g, '') || '0');
    const bNum = parseInt(b.id?.replace(/\D/g, '') || '0');
    return aNum - bNum;
  });
}

/**
 * Normalize task object to consistent structure
 * @param task - Raw task object
 * @returns Normalized task
 */
function normalizeTask(task: unknown): NormalizedTask | null {
  if (!task || typeof task !== 'object') return null;

  const taskObj = task as Record<string, unknown>;

  // Determine status - support various status formats
  let status = (taskObj.status as string | { state?: string; value?: string }) || 'pending';
  if (typeof status === 'object') {
    status = status.state || status.value || 'pending';
  }

  const meta = taskObj.meta as Record<string, unknown> | undefined;
  const context = taskObj.context as Record<string, unknown> | undefined;
  const flowControl = taskObj.flow_control as Record<string, unknown> | undefined;
  const implementation = taskObj.implementation as unknown[] | undefined;
  const modificationPoints = taskObj.modification_points as Array<{ file?: string }> | undefined;

  // Ensure id is always a string (handle numeric IDs from JSON)
  const rawId = taskObj.id ?? taskObj.task_id;
  const stringId = rawId != null ? String(rawId) : 'unknown';

  return {
    id: stringId,
    title: (taskObj.title as string) || (taskObj.name as string) || (taskObj.summary as string) || 'Untitled Task',
    status: (status as string).toLowerCase(),
    // Preserve original fields for flexible rendering
    meta: meta ? {
      type: (meta.type as string) || (taskObj.type as string) || (taskObj.action as string) || 'task',
      agent: (meta.agent as string) || (taskObj.agent as string) || null,
      scope: (meta.scope as string) || (taskObj.scope as string) || null,
      module: (meta.module as string) || (taskObj.module as string) || null
    } : {
      type: (taskObj.type as string) || (taskObj.action as string) || 'task',
      agent: (taskObj.agent as string) || null,
      scope: (taskObj.scope as string) || null,
      module: (taskObj.module as string) || null
    },
    context: context ? {
      requirements: (context.requirements as string[]) || [],
      focus_paths: (context.focus_paths as string[]) || [],
      acceptance: (context.acceptance as string[]) || [],
      depends_on: (context.depends_on as string[]) || []
    } : {
      requirements: (taskObj.requirements as string[]) || (taskObj.description ? [taskObj.description as string] : []),
      focus_paths: (taskObj.focus_paths as string[]) || modificationPoints?.map(m => m.file).filter((f): f is string => !!f) || [],
      acceptance: (taskObj.acceptance as string[]) || [],
      depends_on: (taskObj.depends_on as string[]) || []
    },
    flow_control: flowControl ? {
      implementation_approach: (flowControl.implementation_approach as Array<{ step: string; action: string }>) || []
    } : {
      implementation_approach: implementation?.map((step, i) => ({
        step: `Step ${i + 1}`,
        action: step as string
      })) || []
    },
    // Keep all original fields for raw JSON view
    _raw: task
  };
}

/**
 * Get directory creation time
 * @param dirPath - Directory path
 * @returns ISO date string
 */
async function getCreatedTime(dirPath: string): Promise<string> {
  try {
    const stats = await stat(dirPath);
    return stats.birthtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Calculate progress from tasks
 * @param tasks - Array of task objects
 * @returns Progress info
 */
function calculateProgress(tasks: NormalizedTask[]): Progress {
  if (!tasks || tasks.length === 0) {
    return { total: 0, completed: 0, percentage: 0 };
  }

  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const percentage = Math.round((completed / total) * 100);

  return { total, completed, percentage };
}

/**
 * Get detailed lite task info
 * @param workflowDir - Workflow directory
 * @param type - 'lite-plan' or 'lite-fix'
 * @param sessionId - Session ID
 * @returns Detailed task info
 */
export async function getLiteTaskDetail(workflowDir: string, type: string, sessionId: string): Promise<LiteTaskDetail | null> {
  const dir = type === 'lite-plan'
    ? join(workflowDir, '.lite-plan', sessionId)
    : join(workflowDir, '.lite-fix', sessionId);

  try {
    const stats = await stat(dir);
    if (!stats.isDirectory()) return null;
  } catch {
    return null;
  }

  const [plan, tasks, explorations, clarifications, diagnoses] = await Promise.all([
    loadPlanJson(dir),
    loadTaskJsons(dir),
    loadExplorations(dir),
    loadClarifications(dir),
    type === 'lite-fix' ? loadDiagnoses(dir) : Promise.resolve(undefined),
  ]);

  const detail: LiteTaskDetail = {
    id: sessionId,
    type,
    path: dir,
    plan,
    tasks,
    explorations,
    clarifications,
    diagnoses,
  };

  return detail;
}

/**
 * Load exploration results
 * @param sessionPath - Session directory path
 * @returns Exploration results
 */
async function loadExplorations(sessionPath: string): Promise<unknown[]> {
  const explorePath = join(sessionPath, 'explorations.json');

  try {
    const content = await readFile(explorePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Load clarification data
 * @param sessionPath - Session directory path
 * @returns Clarification data
 */
async function loadClarifications(sessionPath: string): Promise<unknown | null> {
  const clarifyPath = join(sessionPath, 'clarifications.json');

  try {
    const content = await readFile(clarifyPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load diagnosis files for lite-fix sessions
 * Loads diagnosis-*.json files from session root directory
 * @param sessionPath - Session directory path
 * @returns Diagnoses data with manifest and items
 */
async function loadDiagnoses(sessionPath: string): Promise<Diagnoses> {
  const result: Diagnoses = {
    manifest: null,
    items: []
  };

  // Try to load diagnoses-manifest.json first
  const manifestPath = join(sessionPath, 'diagnoses-manifest.json');
  try {
    result.manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    // Continue without manifest
  }

  // Load all diagnosis-*.json files from session root
  try {
    const diagnosisFiles = (await readdir(sessionPath))
      .filter((fileName) => fileName.startsWith('diagnosis-') && fileName.endsWith('.json'));

    const items = (await Promise.all(
      diagnosisFiles.map(async (fileName) => {
        const filePath = join(sessionPath, fileName);
        try {
          const content = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
          return {
            id: fileName.replace('diagnosis-', '').replace('.json', ''),
            filename: fileName,
            ...content,
          } satisfies DiagnosisItem;
        } catch {
          return null;
        }
      }),
    ))
      .filter((item): item is DiagnosisItem => item !== null);

    result.items.push(...items);
  } catch {
    // Return empty items if directory read fails
  }

  return result;
}
