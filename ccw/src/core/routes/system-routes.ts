/**
 * System Routes Module
 * Handles all system-related API endpoints
 */
import type { Server } from 'http';
import { readFileSync, existsSync, promises as fsPromises } from 'fs';
import { join } from 'path';
import { resolvePath, getRecentPaths, trackRecentPath, removeRecentPath, normalizePathForDisplay } from '../../utils/path-resolver.js';
import { scanSessions } from '../session-scanner.js';
import { aggregateData } from '../data-aggregator.js';
import {
  getStorageStats,
  getStorageConfig,
  cleanProjectStorage,
  cleanAllStorage,
  resolveProjectId,
  projectExists,
   formatBytes
 } from '../../tools/storage-manager.js';
import type { RouteContext } from './types.js';

interface SystemRouteContext extends RouteContext {
  server: Server;
}

// ========================================
// Helper Functions
// ========================================

// Package name on npm registry
const NPM_PACKAGE_NAME = 'claude-code-workflow';

// Cache for version check (avoid too frequent requests)
let versionCheckCache: Record<string, unknown> | null = null;
let versionCheckTime = 0;
const VERSION_CHECK_CACHE_TTL = 3600000; // 1 hour

/**
 * Get current package version from package.json
 * @returns {string}
 */
function getCurrentVersion(): string {
  try {
    const packageJsonPath = join(import.meta.dirname, '../../../../package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      return pkg.version || '0.0.0';
    }
  } catch (e) {
    console.error('Error reading package.json:', e);
  }
  return '0.0.0';
}

/**
 * Compare two semver versions
 * @param {string} v1
 * @param {string} v2
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Check npm registry for latest version
 * @returns {Promise<Object>}
 */
async function checkNpmVersion(): Promise<Record<string, unknown>> {
  // Return cached result if still valid
  const now = Date.now();
  if (versionCheckCache && (now - versionCheckTime) < VERSION_CHECK_CACHE_TTL) {
    return versionCheckCache;
  }

  const currentVersion = getCurrentVersion();

  try {
    // Fetch latest version from npm registry
    const npmUrl = 'https://registry.npmjs.org/' + encodeURIComponent(NPM_PACKAGE_NAME) + '/latest';
    const response = await fetch(npmUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const data = await response.json() as { version?: unknown };
    const latestVersion = typeof data.version === 'string' ? data.version : currentVersion;

    // Compare versions
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    const result = {
      currentVersion,
      latestVersion,
      hasUpdate,
      packageName: NPM_PACKAGE_NAME,
      updateCommand: 'npm update -g ' + NPM_PACKAGE_NAME,
      checkedAt: new Date().toISOString()
    };

    // Cache the result
    versionCheckCache = result;
    versionCheckTime = now;

    return result;
  } catch (error: unknown) {
    console.error('Version check failed:', (error as Error).message);
    return {
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      error: (error as Error).message,
      checkedAt: new Date().toISOString()
    };
  }
}

/**
 * Get workflow data for a project path
 * @param {string} projectPath
 * @returns {Promise<Object>}
 */
async function getWorkflowData(projectPath: string): Promise<any> {
  const resolvedPath = resolvePath(projectPath);
  const workflowDir = join(resolvedPath, '.workflow');

  // Track this path
  trackRecentPath(resolvedPath);

  // Check if .workflow exists
  if (!existsSync(workflowDir)) {
    return {
      generatedAt: new Date().toISOString(),
      activeSessions: [],
      archivedSessions: [],
      liteTasks: { litePlan: [], liteFix: [] },
      reviewData: { dimensions: {} },
      projectOverview: null,
      statistics: {
        totalSessions: 0,
        activeSessions: 0,
        totalTasks: 0,
        completedTasks: 0,
        reviewFindings: 0,
        litePlanCount: 0,
        liteFixCount: 0
      },
      projectPath: normalizePathForDisplay(resolvedPath),
      recentPaths: getRecentPaths()
    };
  }

  // Scan and aggregate data
  const sessions = await scanSessions(workflowDir);
  const data = await aggregateData(sessions, workflowDir);

  return {
    ...data,
    projectPath: normalizePathForDisplay(resolvedPath),
    recentPaths: getRecentPaths()
  };
}

// ========================================
// Route Handler
// ========================================

/**
 * Handle System routes
 * @returns true if route was handled, false otherwise
 */
export async function handleSystemRoutes(ctx: SystemRouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest, broadcastToClients, server } = ctx;

  // API: Get workflow data for a path
  if (pathname === '/api/data') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const data = await getWorkflowData(projectPath);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return true;
  }

  // API: Get recent paths
  if (pathname === '/api/recent-paths') {
    const paths = getRecentPaths();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ paths }));
    return true;
  }

  // API: Switch workspace path (for ccw view command)
  if (pathname === '/api/switch-path') {
    const newPath = url.searchParams.get('path');
    if (!newPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Path is required' }));
      return true;
    }

    const resolved = resolvePath(newPath);
    if (!existsSync(resolved)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Path does not exist' }));
      return true;
    }

    // Track the path and return success
    trackRecentPath(resolved);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      path: resolved,
      recentPaths: getRecentPaths()
    }));
    return true;
  }

  // API: Health check (for ccw view to detect running server)
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return true;
  }

  // API: Version check (check for npm updates)
  if (pathname === '/api/version-check') {
    const versionData = await checkNpmVersion();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(versionData));
    return true;
  }

  // API: Shutdown server (for ccw stop command)
  if (pathname === '/api/shutdown' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'shutting_down' }));

    // Graceful shutdown
    console.log('\n  Received shutdown signal...');
    setTimeout(() => {
      server.close(() => {
        console.log('  Server stopped.\n');
        process.exit(0);
      });
      // Force exit after 3 seconds if graceful shutdown fails
      setTimeout(() => process.exit(0), 3000);
    }, 100);
    return true;
  }

  // API: Remove a recent path
  if (pathname === '/api/remove-recent-path' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { path } = body as { path?: string };
      if (!path) {
        return { error: 'path is required', status: 400 };
      }
      const removed = removeRecentPath(path);
      return { success: removed, paths: getRecentPaths() };
    });
    return true;
  }

  // API: Read a JSON file (for fix progress tracking)
  if (pathname === '/api/file') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File path is required' }));
      return true;
    }

    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const json = JSON.parse(content);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found or invalid JSON' }));
    }
    return true;
  }

  // API: System notify - CLI to Server communication bridge
  // Allows CLI commands to trigger WebSocket broadcasts for UI updates
  if (pathname === '/api/system/notify' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { type, scope, data } = body as {
        type: 'REFRESH_REQUIRED' | 'MEMORY_UPDATED' | 'HISTORY_UPDATED' | 'INSIGHT_GENERATED';
        scope: 'memory' | 'history' | 'insights' | 'all';
        data?: Record<string, unknown>;
      };

      if (!type || !scope) {
        return { error: 'type and scope are required', status: 400 };
      }

      // Map CLI notification types to WebSocket broadcast format
      const notification = {
        type,
        payload: {
          scope,
          timestamp: new Date().toISOString(),
          ...data
        }
      };

      broadcastToClients(notification);

      return { success: true, broadcast: true };
    });
    return true;
  }

  // API: Get storage statistics
  if (pathname === '/api/storage/stats') {
    try {
      const stats = getStorageStats();
      const config = getStorageConfig();

      // Format for dashboard display
      const response = {
        location: stats.rootPath,
        isCustomLocation: config.isCustom,
        totalSize: stats.totalSize,
        totalSizeFormatted: formatBytes(stats.totalSize),
        projectCount: stats.projectCount,
        globalDb: stats.globalDb,
        projects: stats.projects.map(p => ({
          id: p.projectId,
          totalSize: p.totalSize,
          totalSizeFormatted: formatBytes(p.totalSize),
          historyRecords: p.cliHistory.recordCount ?? 0,
          hasCliHistory: p.cliHistory.exists,
          hasMemory: p.memory.exists,
          hasCache: p.cache.exists,
          lastModified: p.lastModified?.toISOString() || null
        }))
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get storage stats', details: String(err) }));
    }
    return true;
  }

  // API: Clean storage
  if (pathname === '/api/storage/clean' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { projectId, projectPath, all, types } = body as {
        projectId?: string;
        projectPath?: string;
        all?: boolean;
        types?: { cliHistory?: boolean; memory?: boolean; cache?: boolean; config?: boolean };
      };

      const cleanOptions = types || { all: true };

      if (projectId) {
        // Clean specific project by ID
        if (!projectExists(projectId)) {
          return { error: 'Project not found', status: 404 };
        }
        const result = cleanProjectStorage(projectId, cleanOptions);
        return {
          success: result.success,
          freedBytes: result.freedBytes,
          freedFormatted: formatBytes(result.freedBytes),
          errors: result.errors
        };
      } else if (projectPath) {
        // Clean specific project by path
        const id = resolveProjectId(projectPath);
        if (!projectExists(id)) {
          return { error: 'No storage found for project', status: 404 };
        }
        const result = cleanProjectStorage(id, cleanOptions);
        return {
          success: result.success,
          freedBytes: result.freedBytes,
          freedFormatted: formatBytes(result.freedBytes),
          errors: result.errors
        };
      } else if (all) {
        // Clean all storage
        const result = cleanAllStorage(cleanOptions);
        return {
          success: result.success,
          projectsCleaned: result.projectsCleaned,
          freedBytes: result.freedBytes,
          freedFormatted: formatBytes(result.freedBytes),
          errors: result.errors
        };
      } else {
        return { error: 'Specify projectId, projectPath, or all=true', status: 400 };
      }
    });
    return true;
  }

  return false;
}
