/**
 * Discovery Routes Module
 *
 * Storage Structure:
 * .workflow/issues/discoveries/
 * ├── index.json                    # Discovery session index
 * └── {discovery-id}/
 *     ├── discovery-state.json      # State machine
 *     ├── discovery-progress.json   # Real-time progress
 *     ├── perspectives/             # Per-perspective results
 *     │   ├── bug.json
 *     │   └── ...
 *     ├── external-research.json    # Exa research results
 *     ├── discovery-issues.jsonl    # Generated candidate issues
 *     └── reports/
 *
 * API Endpoints:
 * - GET    /api/discoveries              - List all discovery sessions
 * - GET    /api/discoveries/:id          - Get discovery session detail
 * - GET    /api/discoveries/:id/findings - Get all findings
 * - GET    /api/discoveries/:id/progress - Get real-time progress
 * - POST   /api/discoveries/:id/export   - Export findings as issues
 * - PATCH  /api/discoveries/:id/findings/:fid - Update finding status
 * - DELETE /api/discoveries/:id          - Delete discovery session
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { RouteContext } from './types.js';

// ========== Helper Functions ==========

function getDiscoveriesDir(projectPath: string): string {
  return join(projectPath, '.workflow', 'issues', 'discoveries');
}

function readDiscoveryIndex(discoveriesDir: string): { discoveries: any[]; total: number } {
  const indexPath = join(discoveriesDir, 'index.json');

  // Try to read index.json first
  if (existsSync(indexPath)) {
    try {
      return JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch {
      // Fall through to scan
    }
  }

  // Fallback: scan directory for discovery folders
  if (!existsSync(discoveriesDir)) {
    return { discoveries: [], total: 0 };
  }

  try {
    const entries = readdirSync(discoveriesDir, { withFileTypes: true });
    const discoveries: any[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('DSC-')) {
        const statePath = join(discoveriesDir, entry.name, 'discovery-state.json');
        if (existsSync(statePath)) {
          try {
            const state = JSON.parse(readFileSync(statePath, 'utf8'));
            discoveries.push({
              discovery_id: entry.name,
              target_pattern: state.target_pattern,
              perspectives: state.metadata?.perspectives || [],
              created_at: state.metadata?.created_at,
              completed_at: state.completed_at
            });
          } catch {
            // Skip invalid entries
          }
        }
      }
    }

    // Sort by creation time descending
    discoveries.sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeB - timeA;
    });

    return { discoveries, total: discoveries.length };
  } catch {
    return { discoveries: [], total: 0 };
  }
}

function writeDiscoveryIndex(discoveriesDir: string, index: any) {
  if (!existsSync(discoveriesDir)) {
    mkdirSync(discoveriesDir, { recursive: true });
  }
  writeFileSync(join(discoveriesDir, 'index.json'), JSON.stringify(index, null, 2));
}

function readDiscoveryState(discoveriesDir: string, discoveryId: string): any | null {
  const statePath = join(discoveriesDir, discoveryId, 'discovery-state.json');
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function readDiscoveryProgress(discoveriesDir: string, discoveryId: string): any | null {
  // Try merged state first (new schema)
  const statePath = join(discoveriesDir, discoveryId, 'discovery-state.json');
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      // New merged schema: perspectives array + results object
      if (state.perspectives && Array.isArray(state.perspectives)) {
        const completed = state.perspectives.filter((p: any) => p.status === 'completed').length;
        const total = state.perspectives.length;
        return {
          discovery_id: discoveryId,
          phase: state.phase,
          last_update: state.updated_at || state.created_at,
          progress: {
            perspective_analysis: {
              total,
              completed,
              in_progress: state.perspectives.filter((p: any) => p.status === 'in_progress').length,
              percent_complete: total > 0 ? Math.round((completed / total) * 100) : 0
            },
            external_research: state.external_research || { enabled: false, completed: false },
            aggregation: { completed: state.phase === 'aggregation' || state.phase === 'complete' },
            issue_generation: { completed: state.phase === 'complete', issues_count: state.results?.issues_generated || 0 }
          },
          agent_status: state.perspectives
        };
      }
      // Old schema: metadata.perspectives (backward compat)
      if (state.metadata?.perspectives) {
        return {
          discovery_id: discoveryId,
          phase: state.phase,
          progress: { perspective_analysis: { total: state.metadata.perspectives.length, completed: state.perspectives_completed?.length || 0 } }
        };
      }
    } catch {
      // Fall through
    }
  }
  // Fallback: try legacy progress file
  const progressPath = join(discoveriesDir, discoveryId, 'discovery-progress.json');
  if (existsSync(progressPath)) {
    try { return JSON.parse(readFileSync(progressPath, 'utf8')); } catch { return null; }
  }
  return null;
}

function readPerspectiveFindings(discoveriesDir: string, discoveryId: string): any[] {
  const perspectivesDir = join(discoveriesDir, discoveryId, 'perspectives');
  if (!existsSync(perspectivesDir)) return [];

  const allFindings: any[] = [];
  const files = readdirSync(perspectivesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(join(perspectivesDir, file), 'utf8'));
      const perspective = file.replace('.json', '');

      if (content.findings && Array.isArray(content.findings)) {
        allFindings.push({
          perspective,
          summary: content.summary || {},
          findings: content.findings.map((f: any) => ({
            ...f,
            perspective: f.perspective || perspective
          }))
        });
      }
    } catch {
      // Skip invalid files
    }
  }

  return allFindings;
}

function readDiscoveryIssues(discoveriesDir: string, discoveryId: string): any[] {
  const issuesPath = join(discoveriesDir, discoveryId, 'discovery-issues.jsonl');
  if (!existsSync(issuesPath)) return [];
  try {
    const content = readFileSync(issuesPath, 'utf8');
    return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function writeDiscoveryIssues(discoveriesDir: string, discoveryId: string, issues: any[]) {
  const issuesPath = join(discoveriesDir, discoveryId, 'discovery-issues.jsonl');
  writeFileSync(issuesPath, issues.map(i => JSON.stringify(i)).join('\n'));
}

function flattenFindings(perspectiveResults: any[]): any[] {
  const allFindings: any[] = [];
  for (const result of perspectiveResults) {
    if (result.findings) {
      allFindings.push(...result.findings);
    }
  }
  return allFindings;
}

function appendToIssuesJsonl(projectPath: string, issues: any[]): { added: number; skipped: number; skippedIds: string[] } {
  const issuesDir = join(projectPath, '.workflow', 'issues');
  const issuesPath = join(issuesDir, 'issues.jsonl');

  if (!existsSync(issuesDir)) {
    mkdirSync(issuesDir, { recursive: true });
  }

  // Read existing issues
  let existingIssues: any[] = [];
  if (existsSync(issuesPath)) {
    try {
      const content = readFileSync(issuesPath, 'utf8');
      existingIssues = content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    } catch {
      // Start fresh
    }
  }

  // Build set of existing IDs and source_finding combinations for deduplication
  const existingIds = new Set(existingIssues.map(i => i.id));
  const existingSourceFindings = new Set(
    existingIssues
      .filter(i => i.source === 'discovery' && i.source_finding_id)
      .map(i => `${i.source_discovery_id}:${i.source_finding_id}`)
  );

  // Convert and filter duplicates
  const skippedIds: string[] = [];
  const newIssues: any[] = [];

  for (const di of issues) {
    // Check for duplicate by ID
    if (existingIds.has(di.id)) {
      skippedIds.push(di.id);
      continue;
    }

    // Check for duplicate by source_discovery_id + source_finding_id
    const sourceKey = `${di.source_discovery_id}:${di.source_finding_id}`;
    if (di.source_finding_id && existingSourceFindings.has(sourceKey)) {
      skippedIds.push(di.id);
      continue;
    }

    newIssues.push({
      id: di.id,
      title: di.title,
      status: 'registered',
      priority: di.priority || 3,
      context: di.context || di.description || '',
      source: 'discovery',
      source_discovery_id: di.source_discovery_id,
      source_finding_id: di.source_finding_id,
      perspective: di.perspective,
      file: di.file,
      line: di.line,
      labels: di.labels || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  if (newIssues.length > 0) {
    const allIssues = [...existingIssues, ...newIssues];
    writeFileSync(issuesPath, allIssues.map(i => JSON.stringify(i)).join('\n'));
  }

  return { added: newIssues.length, skipped: skippedIds.length, skippedIds };
}

// ========== Route Handler ==========

export async function handleDiscoveryRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest } = ctx;
  const projectPath = url.searchParams.get('path') || initialPath;
  const discoveriesDir = getDiscoveriesDir(projectPath);

  // GET /api/discoveries - List all discovery sessions
  if (pathname === '/api/discoveries' && req.method === 'GET') {
    const index = readDiscoveryIndex(discoveriesDir);

    // Enrich with state info
    const enrichedDiscoveries = index.discoveries.map((d: any) => {
      const state = readDiscoveryState(discoveriesDir, d.discovery_id);
      const progress = readDiscoveryProgress(discoveriesDir, d.discovery_id);
      return {
        ...d,
        phase: state?.phase || 'unknown',
        total_findings: state?.total_findings || 0,
        issues_generated: state?.issues_generated || 0,
        priority_distribution: state?.priority_distribution || {},
        progress: progress?.progress || null
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      discoveries: enrichedDiscoveries,
      total: enrichedDiscoveries.length,
      _metadata: { updated_at: new Date().toISOString() }
    }));
    return true;
  }

  // GET /api/discoveries/:id - Get discovery detail
  const detailMatch = pathname.match(/^\/api\/discoveries\/([^/]+)$/);
  if (detailMatch && req.method === 'GET') {
    const discoveryId = detailMatch[1];
    const state = readDiscoveryState(discoveriesDir, discoveryId);

    if (!state) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Discovery ${discoveryId} not found` }));
      return true;
    }

    const progress = readDiscoveryProgress(discoveriesDir, discoveryId);
    const perspectiveResults = readPerspectiveFindings(discoveriesDir, discoveryId);
    const discoveryIssues = readDiscoveryIssues(discoveriesDir, discoveryId);

    // Read external research if exists
    let externalResearch = null;
    const externalPath = join(discoveriesDir, discoveryId, 'external-research.json');
    if (existsSync(externalPath)) {
      try {
        externalResearch = JSON.parse(readFileSync(externalPath, 'utf8'));
      } catch {
        // Ignore
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...state,
      progress: progress?.progress || null,
      perspectives: perspectiveResults,
      external_research: externalResearch,
      discovery_issues: discoveryIssues
    }));
    return true;
  }

  // GET /api/discoveries/:id/findings - Get all findings
  const findingsMatch = pathname.match(/^\/api\/discoveries\/([^/]+)\/findings$/);
  if (findingsMatch && req.method === 'GET') {
    const discoveryId = findingsMatch[1];

    if (!existsSync(join(discoveriesDir, discoveryId))) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Discovery ${discoveryId} not found` }));
      return true;
    }

    const perspectiveResults = readPerspectiveFindings(discoveriesDir, discoveryId);
    const allFindings = flattenFindings(perspectiveResults);

    // Support filtering
    const perspectiveFilter = url.searchParams.get('perspective');
    const priorityFilter = url.searchParams.get('priority');

    let filtered = allFindings;
    if (perspectiveFilter) {
      filtered = filtered.filter(f => f.perspective === perspectiveFilter);
    }
    if (priorityFilter) {
      filtered = filtered.filter(f => f.priority === priorityFilter);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      findings: filtered,
      total: filtered.length,
      perspectives: [...new Set(allFindings.map(f => f.perspective))],
      _metadata: { discovery_id: discoveryId }
    }));
    return true;
  }

  // GET /api/discoveries/:id/progress - Get real-time progress
  const progressMatch = pathname.match(/^\/api\/discoveries\/([^/]+)\/progress$/);
  if (progressMatch && req.method === 'GET') {
    const discoveryId = progressMatch[1];
    const progress = readDiscoveryProgress(discoveriesDir, discoveryId);

    if (!progress) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Progress for ${discoveryId} not found` }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(progress));
    return true;
  }

  // POST /api/discoveries/:id/export - Export findings as issues
  const exportMatch = pathname.match(/^\/api\/discoveries\/([^/]+)\/export$/);
  if (exportMatch && req.method === 'POST') {
    handlePostRequest(req, res, async (body: any) => {
      const discoveryId = exportMatch[1];
      const { finding_ids, export_all } = body as { finding_ids?: string[]; export_all?: boolean };

      if (!existsSync(join(discoveriesDir, discoveryId))) {
        return { error: `Discovery ${discoveryId} not found` };
      }

      const perspectiveResults = readPerspectiveFindings(discoveriesDir, discoveryId);
      const allFindings = flattenFindings(perspectiveResults);

      let toExport: any[];
      if (export_all) {
        toExport = allFindings;
      } else if (finding_ids && finding_ids.length > 0) {
        toExport = allFindings.filter(f => finding_ids.includes(f.id));
      } else {
        return { error: 'Either finding_ids or export_all required' };
      }

      if (toExport.length === 0) {
        return { error: 'No findings to export' };
      }

      // Convert findings to issue format
      const issuesToExport = toExport.map((f, idx) => {
        const suggestedIssue = f.suggested_issue || {};
        return {
          id: `ISS-${Date.now()}-${idx}`,
          title: suggestedIssue.title || f.title,
          priority: suggestedIssue.priority || 3,
          context: f.description || '',
          source: 'discovery',
          source_discovery_id: discoveryId,
          source_finding_id: f.id, // Track original finding ID for deduplication
          perspective: f.perspective,
          file: f.file,
          line: f.line,
          labels: suggestedIssue.labels || [f.perspective]
        };
      });

      // Append to main issues.jsonl (with deduplication)
      const result = appendToIssuesJsonl(projectPath, issuesToExport);

      // Mark exported findings in perspective files
      if (result.added > 0) {
        const exportedFindingIds = new Set(
          issuesToExport
            .filter((_, idx) => !result.skippedIds.includes(issuesToExport[idx].id))
            .map(i => i.source_finding_id)
        );

        // Update each perspective file to mark findings as exported
        const perspectivesDir = join(discoveriesDir, discoveryId, 'perspectives');
        if (existsSync(perspectivesDir)) {
          const files = readdirSync(perspectivesDir).filter(f => f.endsWith('.json'));
          for (const file of files) {
            const filePath = join(perspectivesDir, file);
            try {
              const content = JSON.parse(readFileSync(filePath, 'utf8'));
              if (content.findings) {
                let modified = false;
                for (const finding of content.findings) {
                  if (exportedFindingIds.has(finding.id) && !finding.exported) {
                    finding.exported = true;
                    finding.exported_at = new Date().toISOString();
                    modified = true;
                  }
                }
                if (modified) {
                  writeFileSync(filePath, JSON.stringify(content, null, 2));
                }
              }
            } catch {
              // Skip invalid files
            }
          }
        }
      }

      // Update discovery state
      const state = readDiscoveryState(discoveriesDir, discoveryId);
      if (state) {
        state.issues_generated = (state.issues_generated || 0) + result.added;
        writeFileSync(
          join(discoveriesDir, discoveryId, 'discovery-state.json'),
          JSON.stringify(state, null, 2)
        );
      }

      return {
        success: true,
        exported_count: result.added,
        skipped_count: result.skipped,
        skipped_ids: result.skippedIds,
        message: result.skipped > 0
          ? `Exported ${result.added} issues, skipped ${result.skipped} duplicates`
          : `Exported ${result.added} issues`
      };
    });
    return true;
  }

  // PATCH /api/discoveries/:id/findings/:fid - Update finding status
  const updateFindingMatch = pathname.match(/^\/api\/discoveries\/([^/]+)\/findings\/([^/]+)$/);
  if (updateFindingMatch && req.method === 'PATCH') {
    handlePostRequest(req, res, async (body: any) => {
      const [, discoveryId, findingId] = updateFindingMatch;
      const { status, dismissed } = body as { status?: string; dismissed?: boolean };

      const perspectivesDir = join(discoveriesDir, discoveryId, 'perspectives');
      if (!existsSync(perspectivesDir)) {
        return { error: `Discovery ${discoveryId} not found` };
      }

      // Find and update the finding
      const files = readdirSync(perspectivesDir).filter(f => f.endsWith('.json'));
      let updated = false;

      for (const file of files) {
        const filePath = join(perspectivesDir, file);
        try {
          const content = JSON.parse(readFileSync(filePath, 'utf8'));
          if (content.findings) {
            const findingIndex = content.findings.findIndex((f: any) => f.id === findingId);
            if (findingIndex !== -1) {
              if (status !== undefined) {
                content.findings[findingIndex].status = status;
              }
              if (dismissed !== undefined) {
                content.findings[findingIndex].dismissed = dismissed;
              }
              content.findings[findingIndex].updated_at = new Date().toISOString();
              writeFileSync(filePath, JSON.stringify(content, null, 2));
              updated = true;
              break;
            }
          }
        } catch {
          // Skip invalid files
        }
      }

      if (!updated) {
        return { error: `Finding ${findingId} not found` };
      }

      return { success: true, finding_id: findingId };
    });
    return true;
  }

  // DELETE /api/discoveries/:id - Delete discovery session
  const deleteMatch = pathname.match(/^\/api\/discoveries\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const discoveryId = deleteMatch[1];
    const discoveryPath = join(discoveriesDir, discoveryId);

    if (!existsSync(discoveryPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Discovery ${discoveryId} not found` }));
      return true;
    }

    try {
      // Remove directory
      rmSync(discoveryPath, { recursive: true, force: true });

      // Update index
      const index = readDiscoveryIndex(discoveriesDir);
      index.discoveries = index.discoveries.filter((d: any) => d.discovery_id !== discoveryId);
      index.total = index.discoveries.length;
      writeDiscoveryIndex(discoveriesDir, index);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deleted: discoveryId }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to delete discovery' }));
    }
    return true;
  }

  // Not handled
  return false;
}
