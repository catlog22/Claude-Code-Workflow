import { glob } from 'glob';
import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { scanLiteTasks } from './lite-scanner.js';
import { createDashboardCache } from './cache-manager.js';

interface SessionData {
  session_id: string;
  project: string;
  status: string;
  type: string;
  workflow_type: string | null;
  created_at: string | null;
  archived_at: string | null;
  path: string;
  tasks: TaskData[];
  taskCount: number;
  hasReview: boolean;
  reviewSummary: ReviewSummary | null;
  reviewDimensions: DimensionData[];
}

interface TaskData {
  task_id: string;
  title: string;
  status: string;
  type: string;
  meta?: Record<string, unknown>;
  context?: Record<string, unknown>;
  flow_control?: Record<string, unknown>;
}

interface ReviewSummary {
  phase: string;
  severityDistribution: Record<string, number>;
  criticalFiles: string[];
  status: string;
}

interface DimensionData {
  name: string;
  findings: Finding[];
  summary: unknown | null;
  status: string;
}

interface Finding {
  severity?: string;
  [key: string]: unknown;
}

interface SessionInput {
  session_id?: string;
  id?: string;
  project?: string;
  description?: string;
  status?: string;
  type?: string;
  workflow_type?: string | null;
  created_at?: string | null;  // For backward compatibility
  created?: string;  // From SessionMetadata
  updated?: string;  // From SessionMetadata
  archived_at?: string | null;
  path: string;
}

interface ScanSessionsResult {
  active: SessionInput[];
  archived: SessionInput[];
  hasReviewData: boolean;
}

interface DashboardData {
  generatedAt: string;
  activeSessions: SessionData[];
  archivedSessions: SessionData[];
  liteTasks: {
    litePlan: unknown[];
    liteFix: unknown[];
  };
  reviewData: ReviewData | null;
  projectOverview: ProjectOverview | null;
  statistics: {
    totalSessions: number;
    activeSessions: number;
    totalTasks: number;
    completedTasks: number;
    reviewFindings: number;
    litePlanCount: number;
    liteFixCount: number;
  };
}

interface ReviewData {
  totalFindings: number;
  severityDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  dimensionSummary: Record<string, { count: number; sessions: string[] }>;
  sessions: SessionReviewData[];
}

interface SessionReviewData {
  session_id: string;
  progress: unknown | null;
  dimensions: DimensionData[];
  findings: Array<Finding & { dimension: string }>;
}

interface ProjectGuidelines {
  conventions: {
    coding_style: string[];
    naming_patterns: string[];
    file_structure: string[];
    documentation: string[];
  };
  constraints: {
    architecture: string[];
    tech_stack: string[];
    performance: string[];
    security: string[];
  };
  quality_rules: Array<{ rule: string; scope: string; enforced_by?: string }>;
  learnings: Array<{
    date: string;
    session_id?: string;
    insight: string;
    context?: string;
    category?: string;
  }>;
  _metadata?: {
    created_at: string;
    updated_at?: string;
    version: string;
  };
}

interface ProjectOverview {
  projectName: string;
  description: string;
  initializedAt: string | null;
  technologyStack: {
    languages: string[];
    frameworks: string[];
    build_tools: string[];
    test_frameworks: string[];
  };
  architecture: {
    style: string;
    layers: string[];
    patterns: string[];
  };
  keyComponents: string[];
  features: unknown[];
  developmentIndex: {
    feature: unknown[];
    enhancement: unknown[];
    bugfix: unknown[];
    refactor: unknown[];
    docs: unknown[];
  };
  statistics: {
    total_features: number;
    total_sessions: number;
    last_updated: string | null;
  };
  metadata: {
    initialized_by: string;
    analysis_timestamp: string | null;
    analysis_mode: string;
  };
  guidelines: ProjectGuidelines | null;
}

/**
 * Aggregate all data for dashboard rendering (with caching)
 * @param sessions - Scanned sessions from session-scanner
 * @param workflowDir - Path to .workflow directory
 * @returns Aggregated dashboard data
 */
export async function aggregateData(sessions: ScanSessionsResult, workflowDir: string): Promise<DashboardData> {
  // Initialize cache manager
  const cache = createDashboardCache(workflowDir);

  // Prepare paths to watch for changes (includes both new dual files and legacy)
  const watchPaths = [
    join(workflowDir, 'active'),
    join(workflowDir, 'archives'),
    join(workflowDir, 'project-tech.json'),
    join(workflowDir, 'project-guidelines.json'),
    join(workflowDir, 'project.json'),  // Legacy support
    ...sessions.active.map(s => s.path),
    ...sessions.archived.map(s => s.path)
  ];

  // Check cache first
  const cachedData = await cache.get(watchPaths);
  if (cachedData !== null) {
    console.log('Using cached dashboard data');
    return cachedData;
  }

  console.log('Cache miss - regenerating dashboard data');

  const data: DashboardData = {
    generatedAt: new Date().toISOString(),
    activeSessions: [],
    archivedSessions: [],
    liteTasks: {
      litePlan: [],
      liteFix: []
    },
    reviewData: null,
    projectOverview: null,
    statistics: {
      totalSessions: 0,
      activeSessions: 0,
      totalTasks: 0,
      completedTasks: 0,
      reviewFindings: 0,
      litePlanCount: 0,
      liteFixCount: 0
    }
  };

  // Process active sessions
  for (const session of sessions.active) {
    const sessionData = await processSession(session, true);
    data.activeSessions.push(sessionData);
    data.statistics.totalTasks += sessionData.tasks.length;
    data.statistics.completedTasks += sessionData.tasks.filter(t => t.status === 'completed').length;
  }

  // Process archived sessions
  for (const session of sessions.archived) {
    const sessionData = await processSession(session, false);
    data.archivedSessions.push(sessionData);
    data.statistics.totalTasks += sessionData.taskCount || 0;
    data.statistics.completedTasks += sessionData.taskCount || 0;
  }

  // Aggregate review data if present
  if (sessions.hasReviewData) {
    data.reviewData = await aggregateReviewData(sessions.active);
    data.statistics.reviewFindings = data.reviewData.totalFindings;
  }

  data.statistics.totalSessions = sessions.active.length + sessions.archived.length;
  data.statistics.activeSessions = sessions.active.length;

  // Scan and include lite tasks
  try {
    const liteTasks = await scanLiteTasks(workflowDir);
    data.liteTasks = liteTasks;
    data.statistics.litePlanCount = liteTasks.litePlan.length;
    data.statistics.liteFixCount = liteTasks.liteFix.length;
  } catch (err) {
    console.error('Error scanning lite tasks:', (err as Error).message);
  }

  // Load project overview from project.json
  try {
    data.projectOverview = loadProjectOverview(workflowDir);
  } catch (err) {
    console.error('Error loading project overview:', (err as Error).message);
  }

  // Store in cache before returning
  await cache.set(data, watchPaths);

  return data;
}

/**
 * Process a single session, loading tasks and review info
 * @param session - Session object from scanner
 * @param isActive - Whether session is active
 * @returns Processed session data
 */
async function processSession(session: SessionInput, isActive: boolean): Promise<SessionData> {
  const result: SessionData = {
    session_id: session.session_id || session.id || '',
    project: session.project || session.description || session.session_id || session.id || '',
    status: session.status || (isActive ? 'active' : 'archived'),
    type: session.type || 'workflow',  // Session type (workflow, review, test, docs)
    workflow_type: session.workflow_type || null,  // Original workflow_type for reference
    created_at: session.created || session.created_at || null,  // Prefer 'created' from SessionMetadata, fallback to 'created_at'
    archived_at: session.archived_at || null,  // Raw ISO string - let frontend format
    path: session.path,
    tasks: [],
    taskCount: 0,
    hasReview: false,
    reviewSummary: null,
    reviewDimensions: []
  };

  // Load tasks for active sessions (full details)
  if (isActive) {
    const taskDir = join(session.path, '.task');
    if (existsSync(taskDir)) {
      const taskFiles = await safeGlob('IMPL-*.json', taskDir);
      for (const taskFile of taskFiles) {
        try {
          const taskData = JSON.parse(readFileSync(join(taskDir, taskFile), 'utf8')) as Record<string, unknown>;
          result.tasks.push({
            task_id: (taskData.id as string) || basename(taskFile, '.json'),
            title: (taskData.title as string) || 'Untitled Task',
            status: (taskData.status as string) || 'pending',
            type: ((taskData.meta as Record<string, unknown>)?.type as string) || 'task',
            meta: (taskData.meta as Record<string, unknown>) || {},
            context: (taskData.context as Record<string, unknown>) || {},
            flow_control: (taskData.flow_control as Record<string, unknown>) || {}
          });
        } catch {
          // Skip invalid task files
        }
      }
      // Sort tasks by ID
      result.tasks.sort((a, b) => sortTaskIds(a.task_id, b.task_id));
    }
    result.taskCount = result.tasks.length;

    // Check for review data
    const reviewDir = join(session.path, '.review');
    if (existsSync(reviewDir)) {
      result.hasReview = true;
      result.reviewSummary = loadReviewSummary(reviewDir);
      // Load dimension data for review sessions
      if (session.type === 'review') {
        result.reviewDimensions = await loadDimensionData(reviewDir);
      }
    }
  } else {
    // For archived, also load tasks (same as active)
    const taskDir = join(session.path, '.task');
    if (existsSync(taskDir)) {
      const taskFiles = await safeGlob('IMPL-*.json', taskDir);
      for (const taskFile of taskFiles) {
        try {
          const taskData = JSON.parse(readFileSync(join(taskDir, taskFile), 'utf8')) as Record<string, unknown>;
          result.tasks.push({
            task_id: (taskData.id as string) || basename(taskFile, '.json'),
            title: (taskData.title as string) || 'Untitled Task',
            status: (taskData.status as string) || 'completed', // Archived tasks are usually completed
            type: ((taskData.meta as Record<string, unknown>)?.type as string) || 'task'
          });
        } catch {
          // Skip invalid task files
        }
      }
      // Sort tasks by ID
      result.tasks.sort((a, b) => sortTaskIds(a.task_id, b.task_id));
      result.taskCount = result.tasks.length;
    }

    // Check for review data in archived sessions too
    const reviewDir = join(session.path, '.review');
    if (existsSync(reviewDir)) {
      result.hasReview = true;
      result.reviewSummary = loadReviewSummary(reviewDir);
      // Load dimension data for review sessions
      if (session.type === 'review') {
        result.reviewDimensions = await loadDimensionData(reviewDir);
      }
    }
  }

  return result;
}

/**
 * Aggregate review data from all active sessions with reviews
 * @param activeSessions - Active session objects
 * @returns Aggregated review data
 */
async function aggregateReviewData(activeSessions: SessionInput[]): Promise<ReviewData> {
  const reviewData: ReviewData = {
    totalFindings: 0,
    severityDistribution: { critical: 0, high: 0, medium: 0, low: 0 },
    dimensionSummary: {},
    sessions: []
  };

  for (const session of activeSessions) {
    const reviewDir = join(session.path, '.review');
    if (!existsSync(reviewDir)) continue;

    const reviewProgress = loadReviewProgress(reviewDir);
    const dimensionData = await loadDimensionData(reviewDir);

    if (reviewProgress || dimensionData.length > 0) {
      const sessionReview: SessionReviewData = {
        session_id: session.session_id || session.id || '',
        progress: reviewProgress,
        dimensions: dimensionData,
        findings: []
      };

      // Collect and count findings
      for (const dim of dimensionData) {
        if (dim.findings && Array.isArray(dim.findings)) {
          for (const finding of dim.findings) {
            const severity = (finding.severity || 'low').toLowerCase();
            if (reviewData.severityDistribution.hasOwnProperty(severity)) {
              reviewData.severityDistribution[severity as keyof typeof reviewData.severityDistribution]++;
            }
            reviewData.totalFindings++;
            sessionReview.findings.push({
              ...finding,
              dimension: dim.name
            });
          }
        }

        // Track dimension summary
        if (!reviewData.dimensionSummary[dim.name]) {
          reviewData.dimensionSummary[dim.name] = { count: 0, sessions: [] };
        }
        reviewData.dimensionSummary[dim.name].count += dim.findings?.length || 0;
        reviewData.dimensionSummary[dim.name].sessions.push(session.session_id || session.id || '');
      }

      reviewData.sessions.push(sessionReview);
    }
  }

  return reviewData;
}

/**
 * Load review progress from review-progress.json
 * @param reviewDir - Path to .review directory
 * @returns Review progress data or null
 */
function loadReviewProgress(reviewDir: string): unknown | null {
  const progressFile = join(reviewDir, 'review-progress.json');
  if (!existsSync(progressFile)) return null;
  try {
    return JSON.parse(readFileSync(progressFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Load review summary from review-state.json
 * @param reviewDir - Path to .review directory
 * @returns Review summary or null
 */
function loadReviewSummary(reviewDir: string): ReviewSummary | null {
  const stateFile = join(reviewDir, 'review-state.json');
  if (!existsSync(stateFile)) return null;
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    return {
      phase: (state.phase as string) || 'unknown',
      severityDistribution: (state.severity_distribution as Record<string, number>) || {},
      criticalFiles: ((state.critical_files as string[]) || []).slice(0, 3),
      status: (state.status as string) || 'in_progress'
    };
  } catch {
    return null;
  }
}

/**
 * Load dimension data from .review/dimensions/
 * @param reviewDir - Path to .review directory
 * @returns Array of dimension data
 */
async function loadDimensionData(reviewDir: string): Promise<DimensionData[]> {
  const dimensionsDir = join(reviewDir, 'dimensions');
  if (!existsSync(dimensionsDir)) return [];

  const dimensions: DimensionData[] = [];
  const dimFiles = await safeGlob('*.json', dimensionsDir);

  for (const file of dimFiles) {
    try {
      const data = JSON.parse(readFileSync(join(dimensionsDir, file), 'utf8'));
      // Handle array structure: [ { findings: [...], summary: {...} } ]
      let findings: Finding[] = [];
      let summary: unknown | null = null;
      let status = 'completed';

      if (Array.isArray(data) && data.length > 0) {
        const dimData = data[0] as Record<string, unknown>;
        findings = (dimData.findings as Finding[]) || [];
        summary = dimData.summary || null;
        status = (dimData.status as string) || 'completed';
      } else if ((data as Record<string, unknown>).findings) {
        const dataObj = data as Record<string, unknown>;
        findings = (dataObj.findings as Finding[]) || [];
        summary = dataObj.summary || null;
        status = (dataObj.status as string) || 'completed';
      }

      dimensions.push({
        name: basename(file, '.json'),
        findings: findings,
        summary: summary,
        status: status
      });
    } catch {
      // Skip invalid dimension files
    }
  }

  return dimensions;
}

/**
 * Safe glob wrapper that returns empty array on error
 * @param pattern - Glob pattern
 * @param cwd - Current working directory
 * @returns Array of matching file names
 */
async function safeGlob(pattern: string, cwd: string): Promise<string[]> {
  try {
    return await glob(pattern, { cwd, absolute: false });
  } catch {
    return [];
  }
}

// formatDate removed - dates are now passed as raw ISO strings
// Frontend (dashboard.js) handles all date formatting

/**
 * Sort task IDs numerically (IMPL-1, IMPL-2, IMPL-1.1, etc.)
 * @param a - First task ID
 * @param b - Second task ID
 * @returns Comparison result
 */
function sortTaskIds(a: string, b: string): number {
  const parseId = (id: string): [number, number] => {
    const match = id.match(/IMPL-(\d+)(?:\.(\d+))?/);
    if (!match) return [0, 0];
    return [parseInt(match[1]), parseInt(match[2] || '0')];
  };
  const [a1, a2] = parseId(a);
  const [b1, b2] = parseId(b);
  return a1 - b1 || a2 - b2;
}

/**
 * Load project overview from project-tech.json and project-guidelines.json
 * Supports dual file structure with backward compatibility for legacy project.json
 * @param workflowDir - Path to .workflow directory
 * @returns Project overview data or null if not found
 */
function loadProjectOverview(workflowDir: string): ProjectOverview | null {
  const techFile = join(workflowDir, 'project-tech.json');
  const guidelinesFile = join(workflowDir, 'project-guidelines.json');
  const legacyFile = join(workflowDir, 'project.json');

  // Check for new dual file structure first, fallback to legacy
  const useLegacy = !existsSync(techFile) && existsSync(legacyFile);
  const projectFile = useLegacy ? legacyFile : techFile;

  if (!existsSync(projectFile)) {
    console.log(`Project file not found at: ${projectFile}`);
    return null;
  }

  try {
    const fileContent = readFileSync(projectFile, 'utf8');
    const projectData = JSON.parse(fileContent) as Record<string, unknown>;

    console.log(`Successfully loaded project overview: ${projectData.project_name || 'Unknown'} (${useLegacy ? 'legacy' : 'tech'})`);

    // Parse tech data (compatible with both legacy and new structure)
    const overview = projectData.overview as Record<string, unknown> | undefined;
    const technologyAnalysis = projectData.technology_analysis as Record<string, unknown> | undefined;
    const developmentStatus = projectData.development_status as Record<string, unknown> | undefined;

    // Support both old and new schema field names
    const technologyStack = (overview?.technology_stack || technologyAnalysis?.technology_stack) as Record<string, unknown[]> | undefined;
    const architecture = (overview?.architecture || technologyAnalysis?.architecture) as Record<string, unknown> | undefined;
    const developmentIndex = (projectData.development_index || developmentStatus?.development_index) as Record<string, unknown[]> | undefined;
    const statistics = (projectData.statistics || developmentStatus?.statistics) as Record<string, unknown> | undefined;
    const metadata = projectData._metadata as Record<string, unknown> | undefined;

    // Load guidelines from separate file if exists
    let guidelines: ProjectGuidelines | null = null;
    if (existsSync(guidelinesFile)) {
      try {
        const guidelinesContent = readFileSync(guidelinesFile, 'utf8');
        const guidelinesData = JSON.parse(guidelinesContent) as Record<string, unknown>;

        const conventions = guidelinesData.conventions as Record<string, string[]> | undefined;
        const constraints = guidelinesData.constraints as Record<string, string[]> | undefined;

        guidelines = {
          conventions: {
            coding_style: conventions?.coding_style || [],
            naming_patterns: conventions?.naming_patterns || [],
            file_structure: conventions?.file_structure || [],
            documentation: conventions?.documentation || []
          },
          constraints: {
            architecture: constraints?.architecture || [],
            tech_stack: constraints?.tech_stack || [],
            performance: constraints?.performance || [],
            security: constraints?.security || []
          },
          quality_rules: (guidelinesData.quality_rules as Array<{ rule: string; scope: string; enforced_by?: string }>) || [],
          learnings: (guidelinesData.learnings as Array<{
            date: string;
            session_id?: string;
            insight: string;
            context?: string;
            category?: string;
          }>) || [],
          _metadata: guidelinesData._metadata as ProjectGuidelines['_metadata'] | undefined
        };
        console.log(`Successfully loaded project guidelines`);
      } catch (guidelinesErr) {
        console.error(`Failed to parse project-guidelines.json:`, (guidelinesErr as Error).message);
      }
    }

    return {
      projectName: (projectData.project_name as string) || 'Unknown',
      description: (overview?.description as string) || '',
      initializedAt: (projectData.initialized_at as string) || null,
      technologyStack: {
        languages: (technologyStack?.languages as string[]) || [],
        frameworks: (technologyStack?.frameworks as string[]) || [],
        build_tools: (technologyStack?.build_tools as string[]) || [],
        test_frameworks: (technologyStack?.test_frameworks as string[]) || []
      },
      architecture: {
        style: (architecture?.style as string) || 'Unknown',
        layers: (architecture?.layers as string[]) || [],
        patterns: (architecture?.patterns as string[]) || []
      },
      keyComponents: (overview?.key_components as string[]) || [],
      features: (projectData.features as unknown[]) || [],
      developmentIndex: {
        feature: (developmentIndex?.feature as unknown[]) || [],
        enhancement: (developmentIndex?.enhancement as unknown[]) || [],
        bugfix: (developmentIndex?.bugfix as unknown[]) || [],
        refactor: (developmentIndex?.refactor as unknown[]) || [],
        docs: (developmentIndex?.docs as unknown[]) || []
      },
      statistics: {
        total_features: (statistics?.total_features as number) || 0,
        total_sessions: (statistics?.total_sessions as number) || 0,
        last_updated: (statistics?.last_updated as string) || null
      },
      metadata: {
        initialized_by: (metadata?.initialized_by as string) || 'unknown',
        analysis_timestamp: (metadata?.analysis_timestamp as string) || null,
        analysis_mode: (metadata?.analysis_mode as string) || 'unknown'
      },
      guidelines
    };
  } catch (err) {
    console.error(`Failed to parse project file at ${projectFile}:`, (err as Error).message);
    console.error('Error stack:', (err as Error).stack);
    return null;
  }
}
