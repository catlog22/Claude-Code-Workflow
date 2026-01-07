/**
 * CodexLens file watcher handlers.
 *
 * Maintains watcher process state across requests to support dashboard controls.
 */

import {
  checkVenvStatus,
  executeCodexLens,
  getVenvPythonPath,
} from '../../../tools/codex-lens.js';
import type { RouteContext } from '../types.js';
import { extractJSON, stripAnsiCodes } from './utils.js';

// File watcher state (persisted across requests)
let watcherProcess: any = null;
let watcherStats = {
  running: false,
  root_path: '',
  events_processed: 0,
  start_time: null as Date | null
};

export async function stopWatcherForUninstall(): Promise<void> {
  if (!watcherStats.running || !watcherProcess) return;

  try {
    watcherProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 500));
    if (watcherProcess && !watcherProcess.killed) {
      watcherProcess.kill('SIGKILL');
    }
  } catch {
    // Ignore errors stopping watcher
  }

  watcherStats = {
    running: false,
    root_path: '',
    events_processed: 0,
    start_time: null
  };
  watcherProcess = null;
}

/**
 * Handle CodexLens watcher routes
 * @returns true if route was handled, false otherwise
 */
export async function handleCodexLensWatcherRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, req, res, initialPath, handlePostRequest, broadcastToClients } = ctx;

  // API: Get File Watcher Status
  if (pathname === '/api/codexlens/watch/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      running: watcherStats.running,
      root_path: watcherStats.root_path,
      events_processed: watcherStats.events_processed,
      start_time: watcherStats.start_time?.toISOString() || null,
      uptime_seconds: watcherStats.start_time
        ? Math.floor((Date.now() - watcherStats.start_time.getTime()) / 1000)
        : 0
    }));
    return true;
  }

  // API: Start File Watcher
  if (pathname === '/api/codexlens/watch/start' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { path: watchPath, debounce_ms = 1000 } = body as { path?: unknown; debounce_ms?: unknown };
      const targetPath = typeof watchPath === 'string' && watchPath.trim().length > 0 ? watchPath : initialPath;
      const resolvedDebounceMs = typeof debounce_ms === 'number' ? debounce_ms : Number(debounce_ms);
      const debounceMs = !Number.isNaN(resolvedDebounceMs) && resolvedDebounceMs > 0 ? resolvedDebounceMs : 1000;

      if (watcherStats.running) {
        return { success: false, error: 'Watcher already running', status: 400 };
      }

      try {
        const { spawn } = await import('child_process');
        const { existsSync, statSync } = await import('fs');

        // Validate path exists and is a directory
        if (!existsSync(targetPath)) {
          return { success: false, error: `Path does not exist: ${targetPath}`, status: 400 };
        }
        const pathStat = statSync(targetPath);
        if (!pathStat.isDirectory()) {
          return { success: false, error: `Path is not a directory: ${targetPath}`, status: 400 };
        }

        // Get the codexlens CLI path
        const venvStatus = await checkVenvStatus();
        if (!venvStatus.ready) {
          return { success: false, error: 'CodexLens not installed', status: 400 };
        }

        // Verify directory is indexed before starting watcher
        try {
          const statusResult = await executeCodexLens(['projects', 'list', '--json']);
          if (statusResult.success && statusResult.output) {
            const parsed = extractJSON(statusResult.output);
            const projects = parsed.result || parsed || [];
            const normalizedTarget = targetPath.toLowerCase().replace(/\\/g, '/');
            const isIndexed = Array.isArray(projects) && projects.some((p: { source_root?: string }) =>
              p.source_root && p.source_root.toLowerCase().replace(/\\/g, '/') === normalizedTarget
            );
            if (!isIndexed) {
              return {
                success: false,
                error: `Directory is not indexed: ${targetPath}. Run 'codexlens init' first.`,
                status: 400
              };
            }
          }
        } catch (err) {
          console.warn('[CodexLens] Could not verify index status:', err);
          // Continue anyway - watcher will fail with proper error if not indexed
        }

        // Spawn watch process using Python (no shell: true for security)
        // CodexLens is a Python package, must run via python -m codexlens
        const pythonPath = getVenvPythonPath();
        const args = ['-m', 'codexlens', 'watch', targetPath, '--debounce', String(debounceMs)];
        watcherProcess = spawn(pythonPath, args, {
          cwd: targetPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env }
        });

        watcherStats = {
          running: true,
          root_path: targetPath,
          events_processed: 0,
          start_time: new Date()
        };

        // Capture stderr for error messages (capped at 4KB to prevent memory leak)
        const MAX_STDERR_SIZE = 4096;
        let stderrBuffer = '';
        if (watcherProcess.stderr) {
          watcherProcess.stderr.on('data', (data: Buffer) => {
            stderrBuffer += data.toString();
            // Cap buffer size to prevent memory leak in long-running watchers
            if (stderrBuffer.length > MAX_STDERR_SIZE) {
              stderrBuffer = stderrBuffer.slice(-MAX_STDERR_SIZE);
            }
          });
        }

        // Handle process output for event counting
        if (watcherProcess.stdout) {
          watcherProcess.stdout.on('data', (data: Buffer) => {
            const output = data.toString();
            // Count processed events from output
            const matches = output.match(/Processed \d+ events?/g);
            if (matches) {
              watcherStats.events_processed += matches.length;
            }
          });
        }

        // Handle spawn errors (e.g., ENOENT)
        watcherProcess.on('error', (err: Error) => {
          console.error(`[CodexLens] Watcher spawn error: ${err.message}`);
          watcherStats.running = false;
          watcherProcess = null;
          broadcastToClients({
            type: 'CODEXLENS_WATCHER_STATUS',
            payload: { running: false, error: `Spawn error: ${err.message}` }
          });
        });

        // Handle process exit
        watcherProcess.on('exit', (code: number) => {
          watcherStats.running = false;
          watcherProcess = null;
          console.log(`[CodexLens] Watcher exited with code ${code}`);

          // Broadcast error if exited with non-zero code
          if (code !== 0) {
            const errorMsg = stderrBuffer.trim() || `Exited with code ${code}`;
            const cleanError = stripAnsiCodes(errorMsg);
            broadcastToClients({
              type: 'CODEXLENS_WATCHER_STATUS',
              payload: { running: false, error: cleanError }
            });
          } else {
            broadcastToClients({
              type: 'CODEXLENS_WATCHER_STATUS',
              payload: { running: false }
            });
          }
        });

        // Broadcast watcher started
        broadcastToClients({
          type: 'CODEXLENS_WATCHER_STATUS',
          payload: { running: true, path: targetPath }
        });

        return {
          success: true,
          message: 'Watcher started',
          path: targetPath,
          pid: watcherProcess.pid
        };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: Stop File Watcher
  if (pathname === '/api/codexlens/watch/stop' && req.method === 'POST') {
    handlePostRequest(req, res, async () => {
      if (!watcherStats.running || !watcherProcess) {
        return { success: false, error: 'Watcher not running', status: 400 };
      }

      try {
        watcherProcess.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 500));
        if (watcherProcess && !watcherProcess.killed) {
          watcherProcess.kill('SIGKILL');
        }

        const finalStats = {
          events_processed: watcherStats.events_processed,
          uptime_seconds: watcherStats.start_time
            ? Math.floor((Date.now() - watcherStats.start_time.getTime()) / 1000)
            : 0
        };

        watcherStats = {
          running: false,
          root_path: '',
          events_processed: 0,
          start_time: null
        };
        watcherProcess = null;

        broadcastToClients({
          type: 'CODEXLENS_WATCHER_STATUS',
          payload: { running: false }
        });

        return {
          success: true,
          message: 'Watcher stopped',
          ...finalStats
        };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  return false;
}

