/**
 * Status Routes Module
 * Aggregated status endpoint for faster dashboard loading
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getCliToolsStatus } from '../../tools/cli-executor.js';
import { checkVenvStatus, checkSemanticStatus } from '../../tools/codex-lens.js';
import type { RouteContext } from './types.js';

/**
 * Check CCW installation status
 * Verifies that required workflow files are installed in user's home directory
 */
function checkCcwInstallStatus(): {
  installed: boolean;
  workflowsInstalled: boolean;
  missingFiles: string[];
  installPath: string;
} {
  const claudeDir = join(homedir(), '.claude');
  const workflowsDir = join(claudeDir, 'workflows');

  // Required workflow files for full functionality
  const requiredFiles = [
    'chinese-response.md',
    'windows-platform.md',
    'cli-tools-usage.md',
    'coding-philosophy.md',
    'context-tools.md',
    'file-modification.md'
  ];

  const missingFiles: string[] = [];

  // Check each required file
  for (const file of requiredFiles) {
    const filePath = join(workflowsDir, file);
    if (!existsSync(filePath)) {
      missingFiles.push(file);
    }
  }

  const workflowsInstalled = existsSync(workflowsDir) && missingFiles.length === 0;
  const installed = existsSync(claudeDir) && workflowsInstalled;

  return {
    installed,
    workflowsInstalled,
    missingFiles,
    installPath: claudeDir
  };
}

/**
 * Handle status routes
 * @returns true if route was handled, false otherwise
 */
export async function handleStatusRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, res } = ctx;

  // API: Aggregated Status (all statuses in one call)
  if (pathname === '/api/status/all') {
    try {
      // Check CCW installation status (sync, fast)
      const ccwInstallStatus = checkCcwInstallStatus();

      // Execute all status checks in parallel
      const [cliStatus, codexLensStatus, semanticStatus] = await Promise.all([
        getCliToolsStatus(),
        checkVenvStatus(),
        // Always check semantic status (will return available: false if CodexLens not ready)
        checkSemanticStatus().catch(() => ({ available: false, backend: null }))
      ]);

      const response = {
        cli: cliStatus,
        codexLens: codexLensStatus,
        semantic: semanticStatus,
        ccwInstall: ccwInstallStatus,
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return true;
    } catch (error) {
      console.error('[Status Routes] Error fetching aggregated status:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
      return true;
    }
  }

  return false;
}
