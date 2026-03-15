/**
 * CodexLens configuration + environment handlers.
 */

import {
  bootstrapVenv,
  cancelIndexing,
  checkBuildTools,
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
import { getCodexLensDataDir } from '../../../utils/codexlens-path.js';

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

  // API: CodexLens Workspace Status - Get FTS and Vector index status for current workspace
  if (pathname === '/api/codexlens/workspace-status') {
    try {
      const venvStatus = await checkVenvStatus();

      // Default response when not installed
      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          hasIndex: false,
          fts: { percent: 0, indexedFiles: 0, totalFiles: 0 },
          vector: { percent: 0, filesWithEmbeddings: 0, totalFiles: 0, totalChunks: 0 }
        }));
        return true;
      }

      // Use path from query param, fallback to initialPath
      const projectPath = url.searchParams.get('path') || initialPath;

      // Get project info using 'projects show' command
      const projectResult = await executeCodexLens(['projects', 'show', projectPath, '--json']);

      if (!projectResult.success) {
        // No index for this workspace
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          hasIndex: false,
          fts: { percent: 0, indexedFiles: 0, totalFiles: 0 },
          vector: { percent: 0, filesWithEmbeddings: 0, totalFiles: 0, totalChunks: 0 }
        }));
        return true;
      }

      // Parse project data
      let projectData: any = null;
      try {
        const parsed = extractJSON(projectResult.output ?? '');
        if (parsed.success && parsed.result) {
          projectData = parsed.result;
        }
      } catch (e: unknown) {
        console.error('[CodexLens] Failed to parse project data:', e instanceof Error ? e.message : String(e));
      }

      if (!projectData) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          hasIndex: false,
          fts: { percent: 0, indexedFiles: 0, totalFiles: 0 },
          vector: { percent: 0, filesWithEmbeddings: 0, totalFiles: 0, totalChunks: 0 }
        }));
        return true;
      }

      // Get index status for embeddings coverage using 'index status' command
      const indexStatusResult = await executeCodexLens(['index', 'status', projectPath, '--json']);

      let embeddingsData: any = null;
      if (indexStatusResult.success && indexStatusResult.output) {
        try {
          const parsed = extractJSON(indexStatusResult.output);
          if (parsed.success && parsed.result?.embeddings) {
            embeddingsData = parsed.result.embeddings;
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse index status:', e instanceof Error ? e.message : String(e));
        }
      }

      // Calculate FTS and Vector percentages
      const totalFiles = projectData.total_files || 0;
      const indexedFiles = projectData.total_files || 0; // All indexed files have FTS

      // Get embeddings data from index status
      // The response structure is: { total_indexes, indexes_with_embeddings, total_chunks, indexes: [{coverage_percent, total_files, ...}] }
      const indexesWithEmbeddings = embeddingsData?.indexes_with_embeddings || 0;
      const totalChunks = embeddingsData?.total_chunks || 0;
      // coverage_percent is in the indexes array - get the first one (for single project query)
      const indexEntry = embeddingsData?.indexes?.[0];
      const vectorPercent = indexEntry?.coverage_percent || 0;
      const filesWithEmbeddings = indexEntry?.total_files || 0;

      // FTS percentage (all indexed files have FTS, so it's always 100% if indexed)
      const ftsPercent = totalFiles > 0 ? 100 : 0;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        hasIndex: true,
        path: projectPath,
        fts: {
          percent: ftsPercent,
          indexedFiles,
          totalFiles
        },
        vector: {
          percent: vectorPercent,
          filesWithEmbeddings,
          totalFiles,
          totalChunks
        }
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

  // API: CodexLens Check Environment - Check if build tools are available
  if (pathname === '/api/codexlens/check-env' && req.method === 'GET') {
    const buildTools = checkBuildTools();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildTools));
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

      // Use projects list for accurate index_count (same source as /api/codexlens/indexes)
      const [configResult, projectsResult] = await Promise.all([
        executeCodexLens(['config', '--json']),
        executeCodexLens(['projects', 'list', '--json'])
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

      // Parse projects list to get index_count (consistent with /api/codexlens/indexes)
      if (projectsResult.success) {
        try {
          const projectsData = extractJSON(projectsResult.output ?? '');
          if (projectsData.success && Array.isArray(projectsData.result)) {
            // Filter out test/temp projects (same logic as /api/codexlens/indexes)
            const validProjects = projectsData.result.filter((project: any) => {
              if (project.source_root && (
                project.source_root.includes('\\Temp\\') ||
                project.source_root.includes('/tmp/') ||
                project.total_files === 0
              )) {
                return false;
              }
              return true;
            });
            responseData.index_count = validProjects.length;
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse projects list:', e instanceof Error ? e.message : String(e));
          console.error('[CodexLens] Projects output:', (projectsResult.output ?? '').substring(0, 200));
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
        // Windows: Use PowerShell Get-CimInstance (wmic is deprecated in Windows 11)
        try {
          const { execSync } = await import('child_process');
          const psOutput = execSync(
            'powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController).Name"',
            {
              encoding: 'utf-8',
              timeout: EXEC_TIMEOUTS.SYSTEM_INFO,
              stdio: ['pipe', 'pipe', 'pipe']
            }
          );

          const lines = psOutput.split('\n')
            .map(line => line.trim())
            .filter(line => line);

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
          console.warn('[CodexLens] PowerShell GPU detection failed:', (e as Error).message);
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

  // API: CodexLens Model List (list available embedding AND reranker models)
  if (pathname === '/api/codexlens/models' && req.method === 'GET') {
    try {
      // Check if CodexLens is installed first (without auto-installing)
      const venvStatus = await checkVenvStatus();
      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'CodexLens not installed' }));
        return true;
      }

      // Fetch both embedding and reranker models in parallel
      const [embeddingResult, rerankerResult] = await Promise.all([
        executeCodexLens(['model-list', '--json']),
        executeCodexLens(['reranker-model-list', '--json'])
      ]);

      const allModels: any[] = [];

      // Parse embedding models and add type field
      if (embeddingResult.success) {
        try {
          const parsed = extractJSON(embeddingResult.output ?? '');
          const models = parsed?.result?.models ?? parsed?.models ?? [];
          for (const model of models) {
            allModels.push({ ...model, type: 'embedding' });
          }
        } catch {
          // Ignore parsing errors for embedding models
        }
      }

      // Parse reranker models and add type field
      if (rerankerResult.success) {
        try {
          const parsed = extractJSON(rerankerResult.output ?? '');
          const models = parsed?.result?.models ?? parsed?.models ?? [];
          for (const model of models) {
            allModels.push({ ...model, type: 'reranker' });
          }
        } catch {
          // Ignore parsing errors for reranker models
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        result: { models: allModels }
      }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: CodexLens Model Download (download embedding or reranker model by profile)
  if (pathname === '/api/codexlens/models/download' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { profile, model_type } = body as { profile?: unknown; model_type?: unknown };
      const resolvedProfile = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : undefined;
      const resolvedModelType = typeof model_type === 'string' ? model_type.trim() : undefined;

      if (!resolvedProfile) {
        return { success: false, error: 'profile is required', status: 400 };
      }

      try {
        // If model_type is specified, use it directly
        if (resolvedModelType === 'reranker') {
          const result = await executeCodexLens(['reranker-model-download', resolvedProfile, '--json'], { timeout: 600000 });
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
        }

        // Try embedding model first, then reranker if profile not found
        const embeddingResult = await executeCodexLens(['model-download', resolvedProfile, '--json'], { timeout: 600000 });

        // Check if the error indicates unknown profile
        const outputStr = embeddingResult.output ?? '';
        const isUnknownProfile = !embeddingResult.success &&
          (outputStr.includes('Unknown profile') || outputStr.includes('unknown profile'));

        if (isUnknownProfile) {
          // Try reranker model
          const rerankerResult = await executeCodexLens(['reranker-model-download', resolvedProfile, '--json'], { timeout: 600000 });
          if (rerankerResult.success) {
            try {
              const parsed = extractJSON(rerankerResult.output ?? '');
              return { success: true, ...parsed };
            } catch {
              return { success: true, output: rerankerResult.output };
            }
          } else {
            return { success: false, error: rerankerResult.error, status: 500 };
          }
        }

        if (embeddingResult.success) {
          try {
            const parsed = extractJSON(embeddingResult.output ?? '');
            return { success: true, ...parsed };
          } catch {
            return { success: true, output: embeddingResult.output };
          }
        } else {
          return { success: false, error: embeddingResult.error, status: 500 };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: CodexLens Model Download Custom (download any HuggingFace model)
  if (pathname === '/api/codexlens/models/download-custom' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { model_name, model_type } = body as { model_name?: unknown; model_type?: unknown };
      const resolvedModelName = typeof model_name === 'string' && model_name.trim().length > 0 ? model_name.trim() : undefined;
      const resolvedModelType = typeof model_type === 'string' ? model_type.trim() : 'embedding';

      if (!resolvedModelName) {
        return { success: false, error: 'model_name is required', status: 400 };
      }

      // Validate model name format
      if (!resolvedModelName.includes('/')) {
        return { success: false, error: 'Invalid model_name format. Expected: org/model-name', status: 400 };
      }

      try {
        const result = await executeCodexLens([
          'model-download-custom', resolvedModelName,
          '--type', resolvedModelType,
          '--json'
        ], { timeout: 600000 }); // 10 min for download

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

  // API: CodexLens Model Delete (delete embedding or reranker model by profile)
  if (pathname === '/api/codexlens/models/delete' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { profile, model_type } = body as { profile?: unknown; model_type?: unknown };
      const resolvedProfile = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : undefined;
      const resolvedModelType = typeof model_type === 'string' ? model_type.trim() : undefined;

      if (!resolvedProfile) {
        return { success: false, error: 'profile is required', status: 400 };
      }

      try {
        // If model_type is specified, use it directly
        if (resolvedModelType === 'reranker') {
          const result = await executeCodexLens(['reranker-model-delete', resolvedProfile, '--json']);
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
        }

        // Try embedding model first, then reranker if profile not found
        const embeddingResult = await executeCodexLens(['model-delete', resolvedProfile, '--json']);

        // Check if the error indicates unknown profile
        const outputStr = embeddingResult.output ?? '';
        const isUnknownProfile = !embeddingResult.success &&
          (outputStr.includes('Unknown profile') || outputStr.includes('unknown profile'));

        if (isUnknownProfile) {
          // Try reranker model
          const rerankerResult = await executeCodexLens(['reranker-model-delete', resolvedProfile, '--json']);
          if (rerankerResult.success) {
            try {
              const parsed = extractJSON(rerankerResult.output ?? '');
              return { success: true, ...parsed };
            } catch {
              return { success: true, output: rerankerResult.output };
            }
          } else {
            return { success: false, error: rerankerResult.error, status: 500 };
          }
        }

        if (embeddingResult.success) {
          try {
            const parsed = extractJSON(embeddingResult.output ?? '');
            return { success: true, ...parsed };
          } catch {
            return { success: true, output: embeddingResult.output };
          }
        } else {
          return { success: false, error: embeddingResult.error, status: 500 };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: CodexLens Model Delete by Path (delete discovered/manually placed model)
  if (pathname === '/api/codexlens/models/delete-path' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { cache_path } = body as { cache_path?: unknown };
      const resolvedPath = typeof cache_path === 'string' && cache_path.trim().length > 0 ? cache_path.trim() : undefined;

      if (!resolvedPath) {
        return { success: false, error: 'cache_path is required', status: 400 };
      }

      // Security: Validate that the path is within the HuggingFace cache directory
      const { homedir } = await import('os');
      const { join, resolve, normalize } = await import('path');
      const { rm } = await import('fs/promises');

      const hfCacheDir = process.env.HF_HOME || join(homedir(), '.cache', 'huggingface');
      const normalizedCachePath = normalize(resolve(resolvedPath));
      const normalizedHfCacheDir = normalize(resolve(hfCacheDir));

      // Ensure the path is within the HuggingFace cache directory
      if (!normalizedCachePath.startsWith(normalizedHfCacheDir)) {
        return { success: false, error: 'Path must be within the HuggingFace cache directory', status: 400 };
      }

      // Ensure it's a models-- directory
      const pathParts = normalizedCachePath.split(/[/\\]/);
      const lastPart = pathParts[pathParts.length - 1];
      if (!lastPart.startsWith('models--')) {
        return { success: false, error: 'Path must be a model cache directory (models--*)', status: 400 };
      }

      try {
        await rm(normalizedCachePath, { recursive: true, force: true });
        return { success: true, message: 'Model deleted successfully', cache_path: normalizedCachePath };
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

      const envPath = join(getCodexLensDataDir(), '.env');
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
      const settingsPath = join(getCodexLensDataDir(), 'settings.json');
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
      if (settings.embedding?.auto_embed_missing !== undefined) {
        settingsDefaults['CODEXLENS_AUTO_EMBED_MISSING'] = String(settings.embedding.auto_embed_missing);
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
      // Dynamic batch size settings
      if (settings.api?.batch_size_dynamic !== undefined) {
        settingsDefaults['CODEXLENS_API_BATCH_SIZE_DYNAMIC'] = String(settings.api.batch_size_dynamic);
      }
      if (settings.api?.batch_size_utilization_factor !== undefined) {
        settingsDefaults['CODEXLENS_API_BATCH_SIZE_UTILIZATION'] = String(settings.api.batch_size_utilization_factor);
      }
      if (settings.api?.batch_size_max !== undefined) {
        settingsDefaults['CODEXLENS_API_BATCH_SIZE_MAX'] = String(settings.api.batch_size_max);
      }
      if (settings.api?.chars_per_token_estimate !== undefined) {
        settingsDefaults['CODEXLENS_CHARS_PER_TOKEN'] = String(settings.api.chars_per_token_estimate);
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

      // Staged cascade settings (advanced)
      if (settings.staged?.stage2_mode) {
        settingsDefaults['CODEXLENS_STAGED_STAGE2_MODE'] = settings.staged.stage2_mode;
      }
      if (settings.staged?.clustering_strategy) {
        settingsDefaults['CODEXLENS_STAGED_CLUSTERING_STRATEGY'] = settings.staged.clustering_strategy;
      }
      if (settings.staged?.clustering_min_size !== undefined) {
        settingsDefaults['CODEXLENS_STAGED_CLUSTERING_MIN_SIZE'] = String(settings.staged.clustering_min_size);
      }
      if (settings.staged?.enable_rerank !== undefined) {
        settingsDefaults['CODEXLENS_ENABLE_STAGED_RERANK'] = String(settings.staged.enable_rerank);
      }

      // LLM settings
      if (settings.llm?.enabled !== undefined) {
        settingsDefaults['CODEXLENS_LLM_ENABLED'] = String(settings.llm.enabled);
      }
      if (settings.llm?.batch_size !== undefined) {
        settingsDefaults['CODEXLENS_LLM_BATCH_SIZE'] = String(settings.llm.batch_size);
      }

      // Parsing / indexing settings
      if (settings.parsing?.use_astgrep !== undefined) {
        settingsDefaults['CODEXLENS_USE_ASTGREP'] = String(settings.parsing.use_astgrep);
      }
      if (settings.indexing?.static_graph_enabled !== undefined) {
        settingsDefaults['CODEXLENS_STATIC_GRAPH_ENABLED'] = String(settings.indexing.static_graph_enabled);
      }
      if (settings.indexing?.static_graph_relationship_types !== undefined) {
        if (Array.isArray(settings.indexing.static_graph_relationship_types)) {
          settingsDefaults['CODEXLENS_STATIC_GRAPH_RELATIONSHIP_TYPES'] = settings.indexing.static_graph_relationship_types.join(',');
        } else if (typeof settings.indexing.static_graph_relationship_types === 'string') {
          settingsDefaults['CODEXLENS_STATIC_GRAPH_RELATIONSHIP_TYPES'] = settings.indexing.static_graph_relationship_types;
        }
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

        const envPath = join(getCodexLensDataDir(), '.env');
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
        const settingsPath = join(getCodexLensDataDir(), 'settings.json');
        let settings: Record<string, any> = {};
        try {
          const settingsContent = await readFile(settingsPath, 'utf-8');
          settings = JSON.parse(settingsContent);
        } catch {
          // File doesn't exist, create default structure
          settings = { embedding: {}, reranker: {}, api: {}, cascade: {}, staged: {}, llm: {}, parsing: {}, indexing: {} };
        }

        // Map env vars to settings.json structure
        const envToSettings: Record<string, { path: string[], transform?: (v: string) => any }> = {
          'CODEXLENS_EMBEDDING_BACKEND': { path: ['embedding', 'backend'] },
          'CODEXLENS_EMBEDDING_MODEL': { path: ['embedding', 'model'] },
          'CODEXLENS_USE_GPU': { path: ['embedding', 'use_gpu'], transform: v => v === 'true' },
          'CODEXLENS_AUTO_EMBED_MISSING': { path: ['embedding', 'auto_embed_missing'], transform: v => v === 'true' },
          'CODEXLENS_EMBEDDING_STRATEGY': { path: ['embedding', 'strategy'] },
          'CODEXLENS_EMBEDDING_COOLDOWN': { path: ['embedding', 'cooldown'], transform: v => parseFloat(v) },
          'CODEXLENS_RERANKER_BACKEND': { path: ['reranker', 'backend'] },
          'CODEXLENS_RERANKER_MODEL': { path: ['reranker', 'model'] },
          'CODEXLENS_RERANKER_ENABLED': { path: ['reranker', 'enabled'], transform: v => v === 'true' },
          'CODEXLENS_RERANKER_TOP_K': { path: ['reranker', 'top_k'], transform: v => parseInt(v, 10) },
          'CODEXLENS_API_MAX_WORKERS': { path: ['api', 'max_workers'], transform: v => parseInt(v, 10) },
          'CODEXLENS_API_BATCH_SIZE': { path: ['api', 'batch_size'], transform: v => parseInt(v, 10) },
          'CODEXLENS_API_BATCH_SIZE_DYNAMIC': { path: ['api', 'batch_size_dynamic'], transform: v => v === 'true' },
          'CODEXLENS_API_BATCH_SIZE_UTILIZATION': { path: ['api', 'batch_size_utilization_factor'], transform: v => parseFloat(v) },
          'CODEXLENS_API_BATCH_SIZE_MAX': { path: ['api', 'batch_size_max'], transform: v => parseInt(v, 10) },
          'CODEXLENS_CHARS_PER_TOKEN': { path: ['api', 'chars_per_token_estimate'], transform: v => parseInt(v, 10) },
          'CODEXLENS_CASCADE_STRATEGY': { path: ['cascade', 'strategy'] },
          'CODEXLENS_CASCADE_COARSE_K': { path: ['cascade', 'coarse_k'], transform: v => parseInt(v, 10) },
          'CODEXLENS_CASCADE_FINE_K': { path: ['cascade', 'fine_k'], transform: v => parseInt(v, 10) },
          'CODEXLENS_STAGED_STAGE2_MODE': { path: ['staged', 'stage2_mode'] },
          'CODEXLENS_STAGED_CLUSTERING_STRATEGY': { path: ['staged', 'clustering_strategy'] },
          'CODEXLENS_STAGED_CLUSTERING_MIN_SIZE': { path: ['staged', 'clustering_min_size'], transform: v => parseInt(v, 10) },
          'CODEXLENS_ENABLE_STAGED_RERANK': { path: ['staged', 'enable_rerank'], transform: v => v === 'true' },
          'CODEXLENS_LLM_ENABLED': { path: ['llm', 'enabled'], transform: v => v === 'true' },
          'CODEXLENS_LLM_BATCH_SIZE': { path: ['llm', 'batch_size'], transform: v => parseInt(v, 10) },
          'CODEXLENS_USE_ASTGREP': { path: ['parsing', 'use_astgrep'], transform: v => v === 'true' },
          'CODEXLENS_STATIC_GRAPH_ENABLED': { path: ['indexing', 'static_graph_enabled'], transform: v => v === 'true' },
          'CODEXLENS_STATIC_GRAPH_RELATIONSHIP_TYPES': {
            path: ['indexing', 'static_graph_relationship_types'],
            transform: v => v
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t.length > 0),
          },
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

  // ============================================================
  // IGNORE PATTERNS CONFIGURATION ENDPOINTS
  // ============================================================

  // API: Get ignore patterns configuration
  if (pathname === '/api/codexlens/ignore-patterns' && req.method === 'GET') {
    try {
      const { homedir } = await import('os');
      const { join } = await import('path');
      const { readFile } = await import('fs/promises');

      const settingsPath = join(getCodexLensDataDir(), 'settings.json');
      let settings: Record<string, any> = {};
      try {
        const content = await readFile(settingsPath, 'utf-8');
        settings = JSON.parse(content);
      } catch {
        // File doesn't exist
      }

      // Default ignore patterns (matching WatcherConfig defaults in events.py)
      const defaultPatterns = [
        // Version control
        '.git', '.svn', '.hg',
        // Python environments & cache
        '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
        // Node.js
        'node_modules', 'bower_components', '.npm', '.yarn',
        // Build artifacts
        'dist', 'build', 'out', 'target', 'bin', 'obj', '_build', 'coverage', 'htmlcov',
        // IDE & Editor
        '.idea', '.vscode', '.vs', '.eclipse',
        // CodexLens internal
        '.codexlens',
        // Package manager caches
        '.cache', '.parcel-cache', '.turbo', '.next', '.nuxt',
        // Logs & temp
        'logs', 'tmp', 'temp',
      ];

      // Default extension filters for embeddings (files skipped for vector index)
      const defaultExtensionFilters = [
        // Lock files (large, repetitive)
        'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Gemfile.lock', 'poetry.lock',
        // Generated/minified
        '*.min.js', '*.min.css', '*.bundle.js',
        // Binary-like text
        '*.svg', '*.map',
      ];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        patterns: settings.ignore_patterns || defaultPatterns,
        extensionFilters: settings.extension_filters || defaultExtensionFilters,
        defaults: {
          patterns: defaultPatterns,
          extensionFilters: defaultExtensionFilters
        }
      }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: Save ignore patterns configuration
  if (pathname === '/api/codexlens/ignore-patterns' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { patterns, extensionFilters } = body as {
        patterns?: string[];
        extensionFilters?: string[];
      };

      try {
        const { homedir } = await import('os');
        const { join, dirname } = await import('path');
        const { writeFile, mkdir, readFile } = await import('fs/promises');

        const settingsPath = join(getCodexLensDataDir(), 'settings.json');
        await mkdir(dirname(settingsPath), { recursive: true });

        // Read existing settings
        let settings: Record<string, any> = {};
        try {
          const content = await readFile(settingsPath, 'utf-8');
          settings = JSON.parse(content);
        } catch {
          // File doesn't exist, start fresh
        }

        // Validate patterns (alphanumeric, dots, underscores, dashes, asterisks)
        const validPatternRegex = /^[\w.*\-/]+$/;
        if (patterns) {
          const invalidPatterns = patterns.filter(p => !validPatternRegex.test(p));
          if (invalidPatterns.length > 0) {
            return {
              success: false,
              error: `Invalid patterns: ${invalidPatterns.join(', ')}`,
              status: 400
            };
          }
          settings.ignore_patterns = patterns;
        }

        if (extensionFilters) {
          const invalidFilters = extensionFilters.filter(p => !validPatternRegex.test(p));
          if (invalidFilters.length > 0) {
            return {
              success: false,
              error: `Invalid extension filters: ${invalidFilters.join(', ')}`,
              status: 400
            };
          }
          settings.extension_filters = extensionFilters;
        }

        // Write updated settings
        await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

        return {
          success: true,
          message: 'Ignore patterns saved successfully',
          patterns: settings.ignore_patterns,
          extensionFilters: settings.extension_filters
        };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  return false;
}
