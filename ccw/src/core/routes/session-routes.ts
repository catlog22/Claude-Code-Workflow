/**
 * Session Routes Module
 * Handles all Session/Task-related API endpoints
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { RouteContext } from './types.js';

/**
 * Get session detail data (context, summaries, impl-plan, review)
 * @param {string} sessionPath - Path to session directory
 * @param {string} dataType - Type of data to load ('all', 'context', 'tasks', 'summary', 'plan', 'explorations', 'conflict', 'impl-plan', 'review')
 * @returns {Promise<Object>}
 */
async function getSessionDetailData(sessionPath: string, dataType: string): Promise<Record<string, unknown>> {
  const result: any = {};

  // Normalize path
  const normalizedPath = sessionPath.replace(/\\/g, '/');

  try {
    // Load context-package.json (in .process/ subfolder)
    if (dataType === 'context' || dataType === 'all') {
      // Try .process/context-package.json first (common location)
      let contextFile = join(normalizedPath, '.process', 'context-package.json');
      if (!existsSync(contextFile)) {
        // Fallback to session root
        contextFile = join(normalizedPath, 'context-package.json');
      }
      if (existsSync(contextFile)) {
        try {
          result.context = JSON.parse(readFileSync(contextFile, 'utf8'));
        } catch (e) {
          result.context = null;
        }
      }
    }

    // Load task JSONs from .task/ folder
    if (dataType === 'tasks' || dataType === 'all') {
      const taskDir = join(normalizedPath, '.task');
      result.tasks = [];
      if (existsSync(taskDir)) {
        const files = readdirSync(taskDir).filter(f => f.endsWith('.json') && f.startsWith('IMPL-'));
        for (const file of files) {
          try {
            const content = JSON.parse(readFileSync(join(taskDir, file), 'utf8'));
            result.tasks.push({
              filename: file,
              task_id: file.replace('.json', ''),
              ...content
            });
          } catch (e) {
            // Skip unreadable files
          }
        }
        // Sort by task ID
        result.tasks.sort((a: { task_id: string }, b: { task_id: string }) => a.task_id.localeCompare(b.task_id));
      }
    }

    // Load summaries from .summaries/
    if (dataType === 'summary' || dataType === 'all') {
      const summariesDir = join(normalizedPath, '.summaries');
      result.summaries = [];
      if (existsSync(summariesDir)) {
        const files = readdirSync(summariesDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          try {
            const content = readFileSync(join(summariesDir, file), 'utf8');
            result.summaries.push({ name: file.replace('.md', ''), content });
          } catch (e) {
            // Skip unreadable files
          }
        }
      }
    }

    // Load plan.json (for lite tasks)
    if (dataType === 'plan' || dataType === 'all') {
      const planFile = join(normalizedPath, 'plan.json');
      if (existsSync(planFile)) {
        try {
          result.plan = JSON.parse(readFileSync(planFile, 'utf8'));
        } catch (e) {
          result.plan = null;
        }
      }
    }

    // Load explorations (exploration-*.json files) and diagnoses (diagnosis-*.json files) - check .process/ first, then session root
    if (dataType === 'context' || dataType === 'explorations' || dataType === 'all') {
      result.explorations = { manifest: null, data: {} };
      result.diagnoses = { manifest: null, data: {} };

      // Try .process/ first (standard workflow sessions), then session root (lite tasks)
      const searchDirs = [
        join(normalizedPath, '.process'),
        normalizedPath
      ];

      for (const searchDir of searchDirs) {
        if (!existsSync(searchDir)) continue;

        // Look for explorations-manifest.json
        const manifestFile = join(searchDir, 'explorations-manifest.json');
        if (existsSync(manifestFile)) {
          try {
            result.explorations.manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));

            // Load each exploration file based on manifest
            const explorations = result.explorations.manifest.explorations || [];
            for (const exp of explorations) {
              const expFile = join(searchDir, exp.file);
              if (existsSync(expFile)) {
                try {
                  result.explorations.data[exp.angle] = JSON.parse(readFileSync(expFile, 'utf8'));
                } catch (e) {
                  // Skip unreadable exploration files
                }
              }
            }
            break; // Found manifest, stop searching
          } catch (e) {
            result.explorations.manifest = null;
          }
        }

        // Look for diagnoses-manifest.json
        const diagManifestFile = join(searchDir, 'diagnoses-manifest.json');
        if (existsSync(diagManifestFile)) {
          try {
            result.diagnoses.manifest = JSON.parse(readFileSync(diagManifestFile, 'utf8'));

            // Load each diagnosis file based on manifest
            const diagnoses = result.diagnoses.manifest.diagnoses || [];
            for (const diag of diagnoses) {
              const diagFile = join(searchDir, diag.file);
              if (existsSync(diagFile)) {
                try {
                  result.diagnoses.data[diag.angle] = JSON.parse(readFileSync(diagFile, 'utf8'));
                } catch (e) {
                  // Skip unreadable diagnosis files
                }
              }
            }
            break; // Found manifest, stop searching
          } catch (e) {
            result.diagnoses.manifest = null;
          }
        }

        // Fallback: scan for exploration-*.json and diagnosis-*.json files directly
        if (!result.explorations.manifest) {
          try {
            const expFiles = readdirSync(searchDir).filter(f => f.startsWith('exploration-') && f.endsWith('.json') && f !== 'explorations-manifest.json');
            if (expFiles.length > 0) {
              // Create synthetic manifest
              result.explorations.manifest = {
                exploration_count: expFiles.length,
                explorations: expFiles.map((f, i) => ({
                  angle: f.replace('exploration-', '').replace('.json', ''),
                  file: f,
                  index: i + 1
                }))
              };

              // Load each file
              for (const file of expFiles) {
                const angle = file.replace('exploration-', '').replace('.json', '');
                try {
                  result.explorations.data[angle] = JSON.parse(readFileSync(join(searchDir, file), 'utf8'));
                } catch (e) {
                  // Skip unreadable files
                }
              }
            }
          } catch (e) {
            // Directory read failed
          }
        }

        // Fallback: scan for diagnosis-*.json files directly
        if (!result.diagnoses.manifest) {
          try {
            const diagFiles = readdirSync(searchDir).filter(f => f.startsWith('diagnosis-') && f.endsWith('.json') && f !== 'diagnoses-manifest.json');
            if (diagFiles.length > 0) {
              // Create synthetic manifest
              result.diagnoses.manifest = {
                diagnosis_count: diagFiles.length,
                diagnoses: diagFiles.map((f, i) => ({
                  angle: f.replace('diagnosis-', '').replace('.json', ''),
                  file: f,
                  index: i + 1
                }))
              };

              // Load each file
              for (const file of diagFiles) {
                const angle = file.replace('diagnosis-', '').replace('.json', '');
                try {
                  result.diagnoses.data[angle] = JSON.parse(readFileSync(join(searchDir, file), 'utf8'));
                } catch (e) {
                  // Skip unreadable files
                }
              }
            }
          } catch (e) {
            // Directory read failed
          }
        }

        // If we found either explorations or diagnoses, break out of the loop
        if (result.explorations.manifest || result.diagnoses.manifest) {
          break;
        }
      }
    }

    // Load conflict resolution decisions (conflict-resolution-decisions.json)
    if (dataType === 'context' || dataType === 'conflict' || dataType === 'all') {
      result.conflictResolution = null;

      // Try .process/ first (standard workflow sessions)
      const conflictFiles = [
        join(normalizedPath, '.process', 'conflict-resolution-decisions.json'),
        join(normalizedPath, 'conflict-resolution-decisions.json')
      ];

      for (const conflictFile of conflictFiles) {
        if (existsSync(conflictFile)) {
          try {
            result.conflictResolution = JSON.parse(readFileSync(conflictFile, 'utf8'));
            break; // Found file, stop searching
          } catch (e) {
            // Skip unreadable file
          }
        }
      }
    }

    // Load IMPL_PLAN.md
    if (dataType === 'impl-plan' || dataType === 'all') {
      const implPlanFile = join(normalizedPath, 'IMPL_PLAN.md');
      if (existsSync(implPlanFile)) {
        try {
          result.implPlan = readFileSync(implPlanFile, 'utf8');
        } catch (e) {
          result.implPlan = null;
        }
      }
    }

    // Load review data from .review/
    if (dataType === 'review' || dataType === 'all') {
      const reviewDir = join(normalizedPath, '.review');
      result.review = {
        state: null,
        dimensions: [],
        severityDistribution: null,
        totalFindings: 0
      };

      if (existsSync(reviewDir)) {
        // Load review-state.json
        const stateFile = join(reviewDir, 'review-state.json');
        if (existsSync(stateFile)) {
          try {
            const state = JSON.parse(readFileSync(stateFile, 'utf8'));
            result.review.state = state;
            result.review.severityDistribution = state.severity_distribution || {};
            result.review.totalFindings = state.total_findings || 0;
            result.review.phase = state.phase || 'unknown';
            result.review.dimensionSummaries = state.dimension_summaries || {};
            result.review.crossCuttingConcerns = state.cross_cutting_concerns || [];
            result.review.criticalFiles = state.critical_files || [];
          } catch (e) {
            // Skip unreadable state
          }
        }

        // Load dimension findings
        const dimensionsDir = join(reviewDir, 'dimensions');
        if (existsSync(dimensionsDir)) {
          const files = readdirSync(dimensionsDir).filter(f => f.endsWith('.json'));
          for (const file of files) {
            try {
              const dimName = file.replace('.json', '');
              const data = JSON.parse(readFileSync(join(dimensionsDir, file), 'utf8'));

              // Handle array structure: [ { findings: [...] } ]
              let findings = [];
              let summary = null;

              if (Array.isArray(data) && data.length > 0) {
                const dimData = data[0];
                findings = dimData.findings || [];
                summary = dimData.summary || null;
              } else if (data.findings) {
                findings = data.findings;
                summary = data.summary || null;
              }

              result.review.dimensions.push({
                name: dimName,
                findings: findings,
                summary: summary,
                count: findings.length
              });
            } catch (e) {
              // Skip unreadable files
            }
          }
        }
      }
    }

  } catch (error: unknown) {
    console.error('Error loading session detail:', error);
    result.error = (error as Error).message;
  }

  return result;
}

/**
 * Update task status in a task JSON file
 * @param {string} sessionPath - Path to session directory
 * @param {string} taskId - Task ID (e.g., IMPL-001)
 * @param {string} newStatus - New status (pending, in_progress, completed)
 * @returns {Promise<Object>}
 */
async function updateTaskStatus(sessionPath: string, taskId: string, newStatus: string): Promise<Record<string, unknown>> {
  // Normalize path (handle both forward and back slashes)
  let normalizedPath = sessionPath.replace(/\\/g, '/');

  // Handle Windows drive letter format
  if (normalizedPath.match(/^[a-zA-Z]:\//)) {
    // Already in correct format
  } else if (normalizedPath.match(/^\/[a-zA-Z]\//)) {
    // Convert /D/path to D:/path
    normalizedPath = normalizedPath.charAt(1).toUpperCase() + ':' + normalizedPath.slice(2);
  }

  const taskDir = join(normalizedPath, '.task');

  // Check if task directory exists
  if (!existsSync(taskDir)) {
    throw new Error(`Task directory not found: ${taskDir}`);
  }

  // Try to find the task file
  let taskFile = join(taskDir, `${taskId}.json`);

  if (!existsSync(taskFile)) {
    // Try without .json if taskId already has it
    if (taskId.endsWith('.json')) {
      taskFile = join(taskDir, taskId);
    }
    if (!existsSync(taskFile)) {
      throw new Error(`Task file not found: ${taskId}.json in ${taskDir}`);
    }
  }

  try {
    const content = JSON.parse(readFileSync(taskFile, 'utf8'));
    const oldStatus = content.status || 'pending';
    content.status = newStatus;

    // Add status change timestamp
    if (!content.status_history) {
      content.status_history = [];
    }
    content.status_history.push({
      from: oldStatus,
      to: newStatus,
      changed_at: new Date().toISOString()
    });

    writeFileSync(taskFile, JSON.stringify(content, null, 2), 'utf8');

    return {
      success: true,
      taskId,
      oldStatus,
      newStatus,
      file: taskFile
    };
  } catch (error: unknown) {
    throw new Error(`Failed to update task ${taskId}: ${(error as Error).message}`);
  }
}

/**
 * Handle Session routes
 * @returns true if route was handled, false otherwise
 */
export async function handleSessionRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, handlePostRequest } = ctx;

  // API: Get session detail data (context, summaries, impl-plan, review)
  if (pathname === '/api/session-detail') {
    const sessionPath = url.searchParams.get('path');
    const dataType = url.searchParams.get('type') || 'all';

    if (!sessionPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session path is required' }));
      return true;
    }

    const detail = await getSessionDetailData(sessionPath, dataType);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(detail));
    return true;
  }

  // API: Update task status
  if (pathname === '/api/update-task-status' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (typeof body !== 'object' || body === null) {
        return { error: 'Invalid request body', status: 400 };
      }

      const { sessionPath, taskId, newStatus } = body as {
        sessionPath?: unknown;
        taskId?: unknown;
        newStatus?: unknown;
      };

      if (typeof sessionPath !== 'string' || typeof taskId !== 'string' || typeof newStatus !== 'string') {
        return { error: 'sessionPath, taskId, and newStatus are required', status: 400 };
      }

      return await updateTaskStatus(sessionPath, taskId, newStatus);
    });
    return true;
  }

  // API: Bulk update task status
  if (pathname === '/api/bulk-update-task-status' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (typeof body !== 'object' || body === null) {
        return { error: 'Invalid request body', status: 400 };
      }

      const { sessionPath, taskIds, newStatus } = body as {
        sessionPath?: unknown;
        taskIds?: unknown;
        newStatus?: unknown;
      };

      if (typeof sessionPath !== 'string' || !Array.isArray(taskIds) || typeof newStatus !== 'string') {
        return { error: 'sessionPath, taskIds, and newStatus are required', status: 400 };
      }

      const results: Array<Record<string, unknown>> = [];
      for (const taskId of taskIds) {
        if (typeof taskId !== 'string') continue;
        try {
          const result = await updateTaskStatus(sessionPath, taskId, newStatus);
          results.push(result);
        } catch (err) {
          results.push({ taskId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { success: true, results };
    });
    return true;
  }

  return false;
}
