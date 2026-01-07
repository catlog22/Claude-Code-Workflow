/**
 * Navigation Status Routes Module
 * Aggregated status endpoint for navigation bar badge updates
 *
 * API Endpoints:
 * - GET /api/nav-status - Get aggregated navigation bar status (counts for all badges)
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { RouteContext } from './types.js';

// ========== Count Helper Functions ==========

/**
 * Count issues from JSONL file
 */
function countIssues(projectPath: string): number {
  const issuesPath = join(projectPath, '.workflow', 'issues', 'issues.jsonl');
  if (!existsSync(issuesPath)) return 0;
  try {
    const content = readFileSync(issuesPath, 'utf8');
    return content.split('\n').filter(line => line.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Count discoveries from index or directory scan
 */
function countDiscoveries(projectPath: string): number {
  const discoveriesDir = join(projectPath, '.workflow', 'issues', 'discoveries');
  const indexPath = join(discoveriesDir, 'index.json');

  // Try index.json first
  if (existsSync(indexPath)) {
    try {
      const index = JSON.parse(readFileSync(indexPath, 'utf8'));
      return index.discoveries?.length || 0;
    } catch { /* fall through */ }
  }

  // Fallback: scan directory
  if (!existsSync(discoveriesDir)) return 0;
  try {
    const entries = readdirSync(discoveriesDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory() && e.name.startsWith('DSC-')).length;
  } catch {
    return 0;
  }
}

/**
 * Count skills from project and user directories
 */
function countSkills(projectPath: string): { project: number; user: number; total: number } {
  let project = 0, user = 0;

  // Project skills
  const projectSkillsDir = join(projectPath, '.claude', 'skills');
  if (existsSync(projectSkillsDir)) {
    try {
      const entries = readdirSync(projectSkillsDir, { withFileTypes: true });
      project = entries.filter(e =>
        e.isDirectory() && existsSync(join(projectSkillsDir, e.name, 'SKILL.md'))
      ).length;
    } catch { /* ignore */ }
  }

  // User skills
  const userSkillsDir = join(homedir(), '.claude', 'skills');
  if (existsSync(userSkillsDir)) {
    try {
      const entries = readdirSync(userSkillsDir, { withFileTypes: true });
      user = entries.filter(e =>
        e.isDirectory() && existsSync(join(userSkillsDir, e.name, 'SKILL.md'))
      ).length;
    } catch { /* ignore */ }
  }

  return { project, user, total: project + user };
}

/**
 * Recursively count rules in a directory
 */
function countRulesInDir(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let count = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        count++;
      } else if (entry.isDirectory()) {
        count += countRulesInDir(join(dirPath, entry.name));
      }
    }
  } catch { /* ignore */ }
  return count;
}

/**
 * Count rules from project and user directories
 */
function countRules(projectPath: string): { project: number; user: number; total: number } {
  const project = countRulesInDir(join(projectPath, '.claude', 'rules'));
  const user = countRulesInDir(join(homedir(), '.claude', 'rules'));
  return { project, user, total: project + user };
}

/**
 * Count CLAUDE.md files
 */
function countClaudeFiles(projectPath: string): number {
  let count = 0;
  const EXCLUDES = ['.git', 'node_modules', 'dist', 'build', '.venv', 'venv', '__pycache__', 'coverage', '.workflow'];

  // User main
  if (existsSync(join(homedir(), '.claude', 'CLAUDE.md'))) count++;

  // Project main
  if (existsSync(join(projectPath, '.claude', 'CLAUDE.md'))) count++;

  // Root CLAUDE.md
  if (existsSync(join(projectPath, 'CLAUDE.md'))) count++;

  // Module-level (scan project subdirectories for CLAUDE.md files)
  function scanDir(dir: string, depth: number = 0) {
    if (depth > 3) return; // Limit recursion depth
    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !EXCLUDES.includes(entry.name) && !entry.name.startsWith('.')) {
          const subDir = join(dir, entry.name);
          if (existsSync(join(subDir, 'CLAUDE.md'))) count++;
          scanDir(subDir, depth + 1);
        }
      }
    } catch { /* ignore */ }
  }

  scanDir(projectPath);
  return count;
}

/**
 * Count hooks from settings object
 */
function countHooksFromSettings(settings: any): number {
  if (!settings?.hooks) return 0;
  let count = 0;
  for (const event of Object.keys(settings.hooks)) {
    const hookList = settings.hooks[event];
    count += Array.isArray(hookList) ? hookList.length : 1;
  }
  return count;
}

/**
 * Count hooks from global and project settings
 */
function countHooks(projectPath: string): { global: number; project: number; total: number } {
  let global = 0, project = 0;

  // Global settings
  const globalSettingsPath = join(homedir(), '.claude', 'settings.json');
  if (existsSync(globalSettingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(globalSettingsPath, 'utf8'));
      global = countHooksFromSettings(settings);
    } catch { /* ignore */ }
  }

  // Project settings
  const projectSettingsPath = join(projectPath, '.claude', 'settings.json');
  if (existsSync(projectSettingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(projectSettingsPath, 'utf8'));
      project = countHooksFromSettings(settings);
    } catch { /* ignore */ }
  }

  return { global, project, total: global + project };
}

// ========== Route Handler ==========

export async function handleNavStatusRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, res, initialPath } = ctx;

  // GET /api/nav-status - Aggregated navigation badge status
  if (pathname === '/api/nav-status' && ctx.req.method === 'GET') {
    try {
      const projectPath = url.searchParams.get('path') || initialPath;

      // Execute all counts (synchronous file reads wrapped in Promise.resolve for consistency)
      const [issues, discoveries, skills, rules, claude, hooks] = await Promise.all([
        Promise.resolve(countIssues(projectPath)),
        Promise.resolve(countDiscoveries(projectPath)),
        Promise.resolve(countSkills(projectPath)),
        Promise.resolve(countRules(projectPath)),
        Promise.resolve(countClaudeFiles(projectPath)),
        Promise.resolve(countHooks(projectPath))
      ]);

      const response = {
        issues: { count: issues },
        discoveries: { count: discoveries },
        skills: { count: skills.total, project: skills.project, user: skills.user },
        rules: { count: rules.total, project: rules.project, user: rules.user },
        claude: { count: claude },
        hooks: { count: hooks.total, global: hooks.global, project: hooks.project },
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return true;
    } catch (error) {
      console.error('[Nav Status] Error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
      return true;
    }
  }

  return false;
}
