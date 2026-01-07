/**
 * CodexLens configuration + environment handlers.
 */

import {
  bootstrapVenv,
  cancelIndexing,
  checkSemanticStatus,
  checkVenvStatus,
  detectGpuSupport,
  executeCodexLens,
  isIndexingInProgress,
  uninstallCodexLens,
} from '../../../tools/codex-lens.js';
import type { RouteContext } from '../types.js';
import { EXEC_TIMEOUTS } from '../../../utils/exec-constants.js';
import { extractJSON } from './utils.js';
import { stopWatcherForUninstall } from './watcher-handlers.js';

export async function handleCodexLensConfigRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest, broadcastToClients } = ctx;

  // API: CodexLens Status
  if (pathname === '/api/codexlens/status') {
    const status = await checkVenvStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return true;
  }

  // API: CodexLens Dashboard Init - Aggregated endpoint for page initialization
  if (pathname === '/api/codexlens/dashboard-init') {
    try {
      const venvStatus = await checkVenvStatus();

      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          installed: false,
          status: venvStatus,
          config: { index_dir: '~/.codexlens/indexes', index_count: 0 },
          semantic: { available: false }
        }));
        return true;
      }

      // Parallel fetch all initialization data
      const [configResult, statusResult, semanticStatus] = await Promise.all([
        executeCodexLens(['config', '--json']),
        executeCodexLens(['status', '--json']),
        checkSemanticStatus()
      ]);

      // Parse config
      let config = { index_dir: '~/.codexlens/indexes', index_count: 0 };
      if (configResult.success) {
        try {
          const configData = extractJSON(configResult.output ?? '');
          if (configData.success && configData.result) {
            config.index_dir = configData.result.index_dir || configData.result.index_root || config.index_dir;
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse config for dashboard init:', e instanceof Error ? e.message : String(e));
        }
      }

      // Parse status
      let statusData: any = {};
      if (statusResult.success) {
        try {
          const status = extractJSON(statusResult.output ?? '');
          if (status.success && status.result) {
            config.index_count = status.result.projects_count || 0;
            statusData = status.result;
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse status for dashboard init:', e instanceof Error ? e.message : String(e));
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        installed: true,
        status: venvStatus,
        config,
        semantic: semanticStatus,
        statusData
      }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: CodexLens Bootstrap (Install)
  if (pathname === '/api/codexlens/bootstrap' && req.method === 'POST') {
    handlePostRequest(req, res, async () => {
      try {
        const result = await bootstrapVenv();
        if (result.success) {
          const status = await checkVenvStatus();
          broadcastToClients({
            type: 'CODEXLENS_INSTALLED',
            payload: { version: status.version, timestamp: new Date().toISOString() }
          });
          return { success: true, message: 'CodexLens installed successfully', version: status.version };
        } else {
          return { success: false, error: result.error, status: 500 };
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: CodexLens Uninstall
  if (pathname === '/api/codexlens/uninstall' && req.method === 'POST') {
    handlePostRequest(req, res, async () => {
      try {
        // Stop watcher if running (to release file handles)
        await stopWatcherForUninstall();

        if (isIndexingInProgress()) {
          console.log('[CodexLens] Cancelling indexing before uninstall...');
          try {
            cancelIndexing();
          } catch {
            // Ignore errors
          }
        }

        // Wait a moment for processes to fully exit and release handles
        await new Promise(resolve => setTimeout(resolve, 1000));

        const result = await uninstallCodexLens();
        if (result.success) {
          broadcastToClients({
            type: 'CODEXLENS_UNINSTALLED',
            payload: { timestamp: new Date().toISOString() }
          });
          return { success: true, message: 'CodexLens uninstalled successfully' };
        } else {
          return { success: false, error: result.error, status: 500 };
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: CodexLens Config - GET (Get current configuration with index count)
  if (pathname === '/api/codexlens/config' && req.method === 'GET') {
    try {
      const venvStatus = await checkVenvStatus();
      let responseData = { index_dir: '~/.codexlens/indexes', index_count: 0, api_max_workers: 4, api_batch_size: 8 };

      // If not installed, return default config without executing CodexLens
      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
        return true;
      }

      const [configResult, statusResult] = await Promise.all([
        executeCodexLens(['config', '--json']),
        executeCodexLens(['status', '--json'])
      ]);

      // Parse config (extract JSON from output that may contain log messages)
      if (configResult.success) {
        try {
          const config = extractJSON(configResult.output ?? '');
          if (config.success && config.result) {
            // CLI returns index_dir (not index_root)
            responseData.index_dir = config.result.index_dir || config.result.index_root || responseData.index_dir;
            // Extract API settings
            if (config.result.api_max_workers !== undefined) {
              responseData.api_max_workers = config.result.api_max_workers;
            }
            if (config.result.api_batch_size !== undefined) {
              responseData.api_batch_size = config.result.api_batch_size;
            }
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse config:', e instanceof Error ? e.message : String(e));
          console.error('[CodexLens] Config output:', (configResult.output ?? '').substring(0, 200));
        }
      }

      // Parse status to get index_count (projects_count)
      if (statusResult.success) {
        try {
          const status = extractJSON(statusResult.output ?? '');
          if (status.success && status.result) {
            responseData.index_count = status.result.projects_count || 0;
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse status:', e instanceof Error ? e.message : String(e));
          console.error('[CodexLens] Status output:', (statusResult.output ?? '').substring(0, 200));
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseData));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: CodexLens Config - POST (Set configuration)
  if (pathname === '/api/codexlens/config' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: unknown) => {
      const { index_dir, api_max_workers, api_batch_size } = body as {
        index_dir?: unknown;
        api_max_workers?: unknown;
        api_batch_size?: unknown;
      };

      if (!index_dir) {
        return { success: false, error: 'index_dir is required', status: 400 };
      }

      // Validate index_dir path
      const indexDirStr = String(index_dir).trim();

      // Check for dangerous patterns
      if (indexDirStr.includes('\0')) {
        return { success: false, error: 'Invalid path: contains null bytes', status: 400 };
      }

      // Prevent system root paths and their subdirectories (Windows and Unix)
      const dangerousPaths = ['/', 'C:\\', 'C:/', '/etc', '/usr', '/bin', '/sys', '/proc', '/var',
                              'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\System32'];
      const normalizedPath = indexDirStr.replace(/\\/g, '/').toLowerCase();
      for (const dangerous of dangerousPaths) {
        const dangerousLower = dangerous.replace(/\\/g, '/').toLowerCase();
        // Block exact match OR any subdirectory (using startsWith)
        if (normalizedPath === dangerousLower ||
            normalizedPath === dangerousLower + '/' ||
            normalizedPath.startsWith(dangerousLower + '/')) {
          return { success: false, error: 'Invalid path: cannot use system directories or their subdirectories', status: 400 };
        }
      }

      // Additional check: prevent path traversal attempts
      if (normalizedPath.includes('../') || normalizedPath.includes('/..')) {
        return { success: false, error: 'Invalid path: path traversal not allowed', status: 400 };
      }

      // Validate api settings
      if (api_max_workers !== undefined) {
        const workers = Number(api_max_workers);
        if (isNaN(workers) || workers < 1 || workers > 32) {
          return { success: false, error: 'api_max_workers must be between 1 and 32', status: 400 };
        }
      }
      if (api_batch_size !== undefined) {
        const batch = Number(api_batch_size);
        if (isNaN(batch) || batch < 1 || batch > 64) {
          return { success: false, error: 'api_batch_size must be between 1 and 64', status: 400 };
        }
      }

      try {
        // Set index_dir
        const result = await executeCodexLens(['config', 'set', 'index_dir', indexDirStr, '--json']);
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to update index_dir', status: 500 };
        }

        // Set API settings if provided
        if (api_max_workers !== undefined) {
          await executeCodexLens(['config', 'set', 'api_max_workers', String(api_max_workers), '--json']);
        }
        if (api_batch_size !== undefined) {
          await executeCodexLens(['config', 'set', 'api_batch_size', String(api_batch_size), '--json']);
        }

        return { success: true, message: 'Configuration updated successfully' };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: Detect GPU support for semantic search
  if (pathname === '/api/codexlens/gpu/detect' && req.method === 'GET') {
    try {
      const gpuInfo = await detectGpuSupport();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...gpuInfo }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: List available GPU devices for selection
  if (pathname === '/api/codexlens/gpu/list' && req.method === 'GET') {
    try {
      // Try CodexLens gpu-list first if available
      const venvStatus = await checkVenvStatus();
      if (venvStatus.ready) {
        const result = await executeCodexLens(['gpu-list', '--json']);
        if (result.success) {
          try {
            const parsed = extractJSON(result.output ?? '');
            if (parsed.devices && parsed.devices.length > 0) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(parsed));
              return true;
            }
          } catch {
            // Fall through to system detection
          }
        }
      }

      // Fallback: Use system commands to detect GPUs
      const devices: Array<{ name: string; type: string; index: number }> = [];

      if (process.platform === 'win32') {
        // Windows: Use WMIC to get GPU info
        try {
          const { execSync } = await import('child_process');
          const wmicOutput = execSync('wmic path win32_VideoController get name', {
            encoding: 'utf-8',
            timeout: EXEC_TIMEOUTS.SYSTEM_INFO,
            stdio: ['pipe', 'pipe', 'pipe']
          });

          const lines = wmicOutput.split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'Name');

          lines.forEach((name, index) => {
            if (name) {
              const isIntegrated = name.toLowerCase().includes('intel') ||
                                   name.toLowerCase().includes('integrated');
              devices.push({
                name: name,
                type: isIntegrated ? 'integrated' : 'discrete',
                index: index
              });
            }
          });
        } catch (e) {
          console.warn('[CodexLens] WMIC GPU detection failed:', (e as Error).message);
        }
      } else {
        // Linux/Mac: Try nvidia-smi for NVIDIA GPUs
        try {
          const { execSync } = await import('child_process');
          const nvidiaOutput = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', {
            encoding: 'utf-8',
            timeout: EXEC_TIMEOUTS.SYSTEM_INFO,
            stdio: ['pipe', 'pipe', 'pipe']
          });

          const lines = nvidiaOutput.split('\n').filter(line => line.trim());
          lines.forEach((name, index) => {
            devices.push({
              name: name.trim(),
              type: 'discrete',
              index: index
            });
          });
        } catch {
          // NVIDIA not available, that's fine
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, devices: devices, selected_device_id: null }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: Select GPU device for embedding
  if (pathname === '/api/codexlens/gpu/select' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { device_id } = body as { device_id?: unknown };
      const resolvedDeviceId = typeof device_id === 'string' || typeof device_id === 'number' ? device_id : undefined;

      if (resolvedDeviceId === undefined) {
        return { success: false, error: 'device_id is required', status: 400 };
      }

      try {
        const result = await executeCodexLens(['gpu-select', String(resolvedDeviceId), '--json']);
        if (result.success) {
          try {
            const parsed = extractJSON(result.output ?? '');
            return parsed;
          } catch {
            return { success: true, message: 'GPU selected', output: result.output };
          }
        } else {
          return { success: false, error: result.error, status: 500 };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: Reset GPU selection to auto-detection
  if (pathname === '/api/codexlens/gpu/reset' && req.method === 'POST') {
    handlePostRequest(req, res, async () => {
      try {
        const result = await executeCodexLens(['gpu-reset', '--json']);
        if (result.success) {
          try {
            const parsed = extractJSON(result.output ?? '');
            return parsed;
          } catch {
            return { success: true, message: 'GPU selection reset', output: result.output };
          }
        } else {
          return { success: false, error: result.error, status: 500 };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: CodexLens Model List (list available embedding models)
  if (pathname === '/api/codexlens/models' && req.method === 'GET') {
    try {
      // Check if CodexLens is installed first (without auto-installing)
      const venvStatus = await checkVenvStatus();
      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'CodexLens not installed' }));
        return true;
      }
      const result = await executeCodexLens(['model-list', '--json']);
      if (result.success) {
        try {
          const parsed = extractJSON(result.output ?? '');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(parsed));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, result: { models: [] }, output: result.output }));
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error }));
      }
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: CodexLens Model Download (download embedding model by profile)
  if (pathname === '/api/codexlens/models/download' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { profile } = body as { profile?: unknown };
      const resolvedProfile = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : undefined;

      if (!resolvedProfile) {
        return { success: false, error: 'profile is required', status: 400 };
      }

      try {
        const result = await executeCodexLens(['model-download', resolvedProfile, '--json'], { timeout: 600000 }); // 10 min for download
        if (result.success) {
          try {
            const parsed = extractJSON(result.output ?? '');
            return { success: true, ...parsed };
          } catch {
            return { success: true, output: result.output };
          }
        } else {
          return { success: false, error: result.error, status: 500 };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: CodexLens Model Delete (delete embedding model by profile)
  if (pathname === '/api/codexlens/models/delete' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { profile } = body as { profile?: unknown };
      const resolvedProfile = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : undefined;

      if (!resolvedProfile) {
        return { success: false, error: 'profile is required', status: 400 };
      }

      try {
        const result = await executeCodexLens(['model-delete', resolvedProfile, '--json']);
        if (result.success) {
          try {
            const parsed = extractJSON(result.output ?? '');
            return { success: true, ...parsed };
          } catch {
            return { success: true, output: result.output };
          }
        } else {
          return { success: false, error: result.error, status: 500 };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: CodexLens Model Info (get model info by profile)
  if (pathname === '/api/codexlens/models/info' && req.method === 'GET') {
    const profile = url.searchParams.get('profile');

    if (!profile) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'profile parameter is required' }));
      return true;
    }

    try {
      const result = await executeCodexLens(['model-info', profile, '--json']);
      if (result.success) {
        try {
          const parsed = extractJSON(result.output ?? '');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(parsed));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Failed to parse response' }));
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error }));
      }
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // ============================================================
  // ENV FILE MANAGEMENT ENDPOINTS
  // ============================================================

  // API: Get global env file content
  if (pathname === '/api/codexlens/env' && req.method === 'GET') {
    try {
      const { homedir } = await import('os');
      const { join } = await import('path');
      const { readFile } = await import('fs/promises');

      const envPath = join(homedir(), '.codexlens', '.env');
      let content = '';
      try {
        content = await readFile(envPath, 'utf-8');
      } catch {
        // File doesn't exist, return empty
      }

      // Parse env file into key-value pairs (robust parsing)
      const envVars: Record<string, string> = {};
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Find first = that's part of key=value (not in a quote)
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex <= 0) continue;

        const key = trimmed.substring(0, eqIndex).trim();
        // Validate key format (alphanumeric + underscore)
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

        let value = trimmed.substring(eqIndex + 1);

        // Handle quoted values (preserves = inside quotes)
        if (value.startsWith('"')) {
          // Find matching closing quote (handle escaped quotes)
          let end = 1;
          while (end < value.length) {
            if (value[end] === '"' && value[end - 1] !== '\\') break;
            end++;
          }
          value = value.substring(1, end).replace(/\\"/g, '"');
        } else if (value.startsWith("'")) {
          // Single quotes don't support escaping
          const end = value.indexOf("'", 1);
          value = end > 0 ? value.substring(1, end) : value.substring(1);
        } else {
          // Unquoted: trim and take until comment or end
          const commentIndex = value.indexOf(' #');
          if (commentIndex > 0) {
            value = value.substring(0, commentIndex);
          }
          value = value.trim();
        }

        envVars[key] = value;
      }

      // Also read settings.json for current configuration
      const settingsPath = join(homedir(), '.codexlens', 'settings.json');
      let settings: Record<string, any> = {};
      try {
        const settingsContent = await readFile(settingsPath, 'utf-8');
        settings = JSON.parse(settingsContent);
      } catch {
        // Settings file doesn't exist or is invalid, use empty
      }

      // Map settings to env var format for defaults
      const settingsDefaults: Record<string, string> = {};

      // Embedding settings
      if (settings.embedding?.backend) {
        settingsDefaults['CODEXLENS_EMBEDDING_BACKEND'] = settings.embedding.backend;
      }
      if (settings.embedding?.model) {
        settingsDefaults['CODEXLENS_EMBEDDING_MODEL'] = settings.embedding.model;
        settingsDefaults['LITELLM_EMBEDDING_MODEL'] = settings.embedding.model;
      }
      if (settings.embedding?.use_gpu !== undefined) {
        settingsDefaults['CODEXLENS_USE_GPU'] = String(settings.embedding.use_gpu);
      }
      if (settings.embedding?.strategy) {
        settingsDefaults['CODEXLENS_EMBEDDING_STRATEGY'] = settings.embedding.strategy;
      }
      if (settings.embedding?.cooldown !== undefined) {
        settingsDefaults['CODEXLENS_EMBEDDING_COOLDOWN'] = String(settings.embedding.cooldown);
      }

      // Reranker settings
      if (settings.reranker?.backend) {
        settingsDefaults['CODEXLENS_RERANKER_BACKEND'] = settings.reranker.backend;
      }
      if (settings.reranker?.model) {
        settingsDefaults['CODEXLENS_RERANKER_MODEL'] = settings.reranker.model;
        settingsDefaults['LITELLM_RERANKER_MODEL'] = settings.reranker.model;
      }
      if (settings.reranker?.enabled !== undefined) {
        settingsDefaults['CODEXLENS_RERANKER_ENABLED'] = String(settings.reranker.enabled);
      }
      if (settings.reranker?.top_k !== undefined) {
        settingsDefaults['CODEXLENS_RERANKER_TOP_K'] = String(settings.reranker.top_k);
      }

      // API/Concurrency settings
      if (settings.api?.max_workers !== undefined) {
        settingsDefaults['CODEXLENS_API_MAX_WORKERS'] = String(settings.api.max_workers);
      }
      if (settings.api?.batch_size !== undefined) {
        settingsDefaults['CODEXLENS_API_BATCH_SIZE'] = String(settings.api.batch_size);
      }

      // Cascade search settings
      if (settings.cascade?.strategy) {
        settingsDefaults['CODEXLENS_CASCADE_STRATEGY'] = settings.cascade.strategy;
      }
      if (settings.cascade?.coarse_k !== undefined) {
        settingsDefaults['CODEXLENS_CASCADE_COARSE_K'] = String(settings.cascade.coarse_k);
      }
      if (settings.cascade?.fine_k !== undefined) {
        settingsDefaults['CODEXLENS_CASCADE_FINE_K'] = String(settings.cascade.fine_k);
      }

      // LLM settings
      if (settings.llm?.enabled !== undefined) {
        settingsDefaults['CODEXLENS_LLM_ENABLED'] = String(settings.llm.enabled);
      }
      if (settings.llm?.batch_size !== undefined) {
        settingsDefaults['CODEXLENS_LLM_BATCH_SIZE'] = String(settings.llm.batch_size);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        path: envPath,
        env: envVars,
        raw: content,
        settings: settingsDefaults
      }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: Save global env file content (merge mode - preserves existing values)
  if (pathname === '/api/codexlens/env' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { env } = body as { env: Record<string, string> };

      if (!env || typeof env !== 'object') {
        return { success: false, error: 'env object is required', status: 400 };
      }

      try {
        const { homedir } = await import('os');
        const { join, dirname } = await import('path');
        const { writeFile, mkdir, readFile } = await import('fs/promises');

        const envPath = join(homedir(), '.codexlens', '.env');
        await mkdir(dirname(envPath), { recursive: true });

        // Read existing env file to preserve custom variables
        let existingEnv: Record<string, string> = {};
        let existingComments: string[] = [];
        try {
          const content = await readFile(envPath, 'utf-8');
          const lines = content.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            // Preserve comment lines that aren't our headers
            if (trimmed.startsWith('#') && !trimmed.includes('Managed by CCW')) {
              if (!trimmed.includes('Reranker API') && !trimmed.includes('Embedding API') &&
                  !trimmed.includes('LiteLLM Config') && !trimmed.includes('CodexLens Settings') &&
                  !trimmed.includes('Other Settings') && !trimmed.includes('CodexLens Environment')) {
                existingComments.push(line);
              }
            }
            if (!trimmed || trimmed.startsWith('#')) continue;

            // Robust parsing (same as GET handler)
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex <= 0) continue;

            const key = trimmed.substring(0, eqIndex).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

            let value = trimmed.substring(eqIndex + 1);
            if (value.startsWith('"')) {
              let end = 1;
              while (end < value.length) {
                if (value[end] === '"' && value[end - 1] !== '\\') break;
                end++;
              }
              value = value.substring(1, end).replace(/\\"/g, '"');
            } else if (value.startsWith("'")) {
              const end = value.indexOf("'", 1);
              value = end > 0 ? value.substring(1, end) : value.substring(1);
            } else {
              const commentIndex = value.indexOf(' #');
              if (commentIndex > 0) value = value.substring(0, commentIndex);
              value = value.trim();
            }
            existingEnv[key] = value;
          }
        } catch {
          // File doesn't exist, start fresh
        }

        // Merge: update known keys from payload, preserve unknown keys
        const knownKeys = new Set([
          'RERANKER_API_KEY', 'RERANKER_API_BASE', 'RERANKER_MODEL',
          'EMBEDDING_API_KEY', 'EMBEDDING_API_BASE', 'EMBEDDING_MODEL',
          'LITELLM_API_KEY', 'LITELLM_API_BASE', 'LITELLM_MODEL'
        ]);

        // Apply updates from payload
        for (const [key, value] of Object.entries(env)) {
          if (value) {
            existingEnv[key] = value;
          } else if (knownKeys.has(key)) {
            // Remove known key if value is empty
            delete existingEnv[key];
          }
        }

        // Build env file content
        const lines = [
          '# CodexLens Environment Configuration',
          '# Managed by CCW Dashboard',
          ''
        ];

        // Add preserved custom comments
        if (existingComments.length > 0) {
          lines.push(...existingComments, '');
        }

        // Group by prefix
        const groups: Record<string, string[]> = {
          'RERANKER': [],
          'EMBEDDING': [],
          'LITELLM': [],
          'CODEXLENS': [],
          'OTHER': []
        };

        for (const [key, value] of Object.entries(existingEnv)) {
          if (!value) continue;
          // SECURITY: Escape special characters to prevent .env injection
          const escapedValue = value
            .replace(/\\/g, '\\\\')  // Escape backslashes first
            .replace(/"/g, '\\"')    // Escape double quotes
            .replace(/\n/g, '\\n')   // Escape newlines
            .replace(/\r/g, '\\r');  // Escape carriage returns
          const line = `${key}="${escapedValue}"`;
          if (key.startsWith('RERANKER_')) groups['RERANKER'].push(line);
          else if (key.startsWith('EMBEDDING_')) groups['EMBEDDING'].push(line);
          else if (key.startsWith('LITELLM_')) groups['LITELLM'].push(line);
          else if (key.startsWith('CODEXLENS_')) groups['CODEXLENS'].push(line);
          else groups['OTHER'].push(line);
        }

        // Add grouped content
        if (groups['RERANKER'].length) {
          lines.push('# Reranker API Configuration');
          lines.push(...groups['RERANKER'], '');
        }
        if (groups['EMBEDDING'].length) {
          lines.push('# Embedding API Configuration');
          lines.push(...groups['EMBEDDING'], '');
        }
        if (groups['LITELLM'].length) {
          lines.push('# LiteLLM Configuration');
          lines.push(...groups['LITELLM'], '');
        }
        if (groups['CODEXLENS'].length) {
          lines.push('# CodexLens Settings');
          lines.push(...groups['CODEXLENS'], '');
        }
        if (groups['OTHER'].length) {
          lines.push('# Other Settings');
          lines.push(...groups['OTHER'], '');
        }

        await writeFile(envPath, lines.join('\n'), 'utf-8');

        // Also update settings.json with mapped values
        const settingsPath = join(homedir(), '.codexlens', 'settings.json');
        let settings: Record<string, any> = {};
        try {
          const settingsContent = await readFile(settingsPath, 'utf-8');
          settings = JSON.parse(settingsContent);
        } catch {
          // File doesn't exist, create default structure
          settings = { embedding: {}, reranker: {}, api: {}, cascade: {}, llm: {} };
        }

        // Map env vars to settings.json structure
        const envToSettings: Record<string, { path: string[], transform?: (v: string) => any }> = {
          'CODEXLENS_EMBEDDING_BACKEND': { path: ['embedding', 'backend'] },
          'CODEXLENS_EMBEDDING_MODEL': { path: ['embedding', 'model'] },
          'CODEXLENS_USE_GPU': { path: ['embedding', 'use_gpu'], transform: v => v === 'true' },
          'CODEXLENS_EMBEDDING_STRATEGY': { path: ['embedding', 'strategy'] },
          'CODEXLENS_EMBEDDING_COOLDOWN': { path: ['embedding', 'cooldown'], transform: v => parseFloat(v) },
          'CODEXLENS_RERANKER_BACKEND': { path: ['reranker', 'backend'] },
          'CODEXLENS_RERANKER_MODEL': { path: ['reranker', 'model'] },
          'CODEXLENS_RERANKER_ENABLED': { path: ['reranker', 'enabled'], transform: v => v === 'true' },
          'CODEXLENS_RERANKER_TOP_K': { path: ['reranker', 'top_k'], transform: v => parseInt(v, 10) },
          'CODEXLENS_API_MAX_WORKERS': { path: ['api', 'max_workers'], transform: v => parseInt(v, 10) },
          'CODEXLENS_API_BATCH_SIZE': { path: ['api', 'batch_size'], transform: v => parseInt(v, 10) },
          'CODEXLENS_CASCADE_STRATEGY': { path: ['cascade', 'strategy'] },
          'CODEXLENS_CASCADE_COARSE_K': { path: ['cascade', 'coarse_k'], transform: v => parseInt(v, 10) },
          'CODEXLENS_CASCADE_FINE_K': { path: ['cascade', 'fine_k'], transform: v => parseInt(v, 10) },
          'CODEXLENS_LLM_ENABLED': { path: ['llm', 'enabled'], transform: v => v === 'true' },
          'CODEXLENS_LLM_BATCH_SIZE': { path: ['llm', 'batch_size'], transform: v => parseInt(v, 10) },
          'LITELLM_EMBEDDING_MODEL': { path: ['embedding', 'model'] },
          'LITELLM_RERANKER_MODEL': { path: ['reranker', 'model'] }
        };

        // Apply env vars to settings
        for (const [envKey, value] of Object.entries(env)) {
          const mapping = envToSettings[envKey];
          if (mapping && value) {
            const [section, key] = mapping.path;
            if (!settings[section]) settings[section] = {};
            settings[section][key] = mapping.transform ? mapping.transform(value) : value;
          }
        }

        // Write updated settings
        await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

        return {
          success: true,
          message: 'Environment and settings configuration saved',
          path: envPath,
          settingsPath
        };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  return false;
}
