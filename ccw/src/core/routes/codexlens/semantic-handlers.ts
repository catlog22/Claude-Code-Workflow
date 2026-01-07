/**
 * CodexLens semantic search + reranker + SPLADE handlers.
 */

import {
  checkSemanticStatus,
  checkVenvStatus,
  executeCodexLens,
  installSemantic,
} from '../../../tools/codex-lens.js';
import type { GpuMode } from '../../../tools/codex-lens.js';
import { loadLiteLLMApiConfig } from '../../../config/litellm-api-config-manager.js';
import type { RouteContext } from '../types.js';
import { extractJSON } from './utils.js';

export async function handleCodexLensSemanticRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest } = ctx;

  // API: CodexLens Semantic Search Status
  if (pathname === '/api/codexlens/semantic/status') {
    const status = await checkSemanticStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return true;
  }

  // API: CodexLens Semantic Metadata List
  if (pathname === '/api/codexlens/semantic/metadata') {
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const tool = url.searchParams.get('tool') || '';
    const projectPath = url.searchParams.get('path') || initialPath;

    try {
      const args = [
        'semantic-list',
        '--path', projectPath,
        '--offset', offset.toString(),
        '--limit', limit.toString(),
        '--json'
      ];
      if (tool) {
        args.push('--tool', tool);
      }

      const result = await executeCodexLens(args, { cwd: projectPath });

      if (result.success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(result.output ?? '');
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

  // API: CodexLens LLM Enhancement (run enhance command)
  if (pathname === '/api/codexlens/enhance' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { path: projectPath, tool = 'gemini', batchSize = 5, timeoutMs = 300000 } = body as {
        path?: unknown;
        tool?: unknown;
        batchSize?: unknown;
        timeoutMs?: unknown;
      };
      const targetPath = typeof projectPath === 'string' && projectPath.trim().length > 0 ? projectPath : initialPath;
      const resolvedTool = typeof tool === 'string' && tool.trim().length > 0 ? tool : 'gemini';
      const resolvedBatchSize = typeof batchSize === 'number' ? batchSize : Number(batchSize);
      const resolvedTimeoutMs = typeof timeoutMs === 'number' ? timeoutMs : Number(timeoutMs);

      try {
        const args = ['enhance', targetPath, '--tool', resolvedTool, '--batch-size', String(resolvedBatchSize)];
        const timeout = !Number.isNaN(resolvedTimeoutMs) ? resolvedTimeoutMs + 30000 : 330000;
        const result = await executeCodexLens(args, { cwd: targetPath, timeout });
        if (result.success) {
          try {
            const parsed = extractJSON(result.output ?? '');
            return { success: true, result: parsed };
          } catch {
            return { success: true, output: result.output ?? '' };
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

  // API: CodexLens Search (FTS5 text search with mode support)
  if (pathname === '/api/codexlens/search') {
    const query = url.searchParams.get('query') || '';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const mode = url.searchParams.get('mode') || 'exact';  // exact, fuzzy, hybrid, vector
    const maxContentLength = parseInt(url.searchParams.get('max_content_length') || '200', 10);
    const extraFilesCount = parseInt(url.searchParams.get('extra_files_count') || '10', 10);
    const projectPath = url.searchParams.get('path') || initialPath;

    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Query parameter is required' }));
      return true;
    }

    try {
      // Request more results to support split (full content + extra files)
      const totalToFetch = limit + extraFilesCount;
      // Use --method instead of deprecated --mode
      const args = ['search', query, '--path', projectPath, '--limit', totalToFetch.toString(), '--method', mode, '--json'];

      const result = await executeCodexLens(args, { cwd: projectPath });

      if (result.success) {
        try {
          const parsed = extractJSON(result.output ?? '');
          const allResults = parsed.result?.results || [];

          // Truncate content and split results
          const truncateContent = (content: string | null | undefined): string => {
            if (!content) return '';
            if (content.length <= maxContentLength) return content;
            return content.slice(0, maxContentLength) + '...';
          };

          // Split results: first N with full content, rest as file paths only
          const resultsWithContent = allResults.slice(0, limit).map((r: any) => ({
            ...r,
            content: truncateContent(r.content || r.excerpt),
            excerpt: truncateContent(r.excerpt || r.content),
          }));

          const extraResults = allResults.slice(limit, limit + extraFilesCount);
          const extraFiles = [...new Set(extraResults.map((r: any) => r.path || r.file))];

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            results: resultsWithContent,
            extra_files: extraFiles.length > 0 ? extraFiles : undefined,
            metadata: {
              total: allResults.length,
              limit,
              max_content_length: maxContentLength,
              extra_files_count: extraFilesCount,
            },
          }));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, results: [], output: result.output }));
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

  // API: CodexLens Search Files Only (return file paths only, with mode support)
  if (pathname === '/api/codexlens/search_files') {
    const query = url.searchParams.get('query') || '';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const mode = url.searchParams.get('mode') || 'exact';  // exact, fuzzy, hybrid, vector
    const projectPath = url.searchParams.get('path') || initialPath;

    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Query parameter is required' }));
      return true;
    }

    try {
      // Use --method instead of deprecated --mode
      const args = ['search', query, '--path', projectPath, '--limit', limit.toString(), '--method', mode, '--files-only', '--json'];

      const result = await executeCodexLens(args, { cwd: projectPath });

      if (result.success) {
        try {
          const parsed = extractJSON(result.output ?? '');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...parsed.result }));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, files: [], output: result.output }));
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

  // API: CodexLens Symbol Search (search for symbols by name)
  if (pathname === '/api/codexlens/symbol') {
    const query = url.searchParams.get('query') || '';
    const file = url.searchParams.get('file');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const projectPath = url.searchParams.get('path') || initialPath;

    if (!query && !file) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Either query or file parameter is required' }));
      return true;
    }

    try {
      let args;
      if (file) {
        // Get symbols from a specific file
        args = ['symbol', '--file', file, '--json'];
      } else {
        // Search for symbols by name
        args = ['symbol', query, '--path', projectPath, '--limit', limit.toString(), '--json'];
      }

      const result = await executeCodexLens(args, { cwd: projectPath });

      if (result.success) {
        try {
          const parsed = extractJSON(result.output ?? '');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...parsed.result }));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, symbols: [], output: result.output }));
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

  // API: CodexLens Semantic Search Install (with GPU mode support)
  if (pathname === '/api/codexlens/semantic/install' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      try {
        // Get GPU mode from request body, default to 'cpu'
        const { gpuMode } = body as { gpuMode?: unknown };
        const resolvedGpuModeCandidate = typeof gpuMode === 'string' && gpuMode.trim().length > 0 ? gpuMode : 'cpu';
        const validModes: GpuMode[] = ['cpu', 'cuda', 'directml'];

        if (!validModes.includes(resolvedGpuModeCandidate as GpuMode)) {
          return {
            success: false,
            error: `Invalid GPU mode: ${resolvedGpuModeCandidate}. Valid modes: ${validModes.join(', ')}`,
            status: 400
          };
        }

        const resolvedGpuMode = resolvedGpuModeCandidate as GpuMode;
        const result = await installSemantic(resolvedGpuMode);
        if (result.success) {
          const status = await checkSemanticStatus();
          const modeDescriptions = {
            cpu: 'CPU (ONNX Runtime)',
            cuda: 'NVIDIA CUDA GPU',
            directml: 'Windows DirectML GPU'
          };
          return {
            success: true,
            message: `Semantic search installed successfully with ${modeDescriptions[resolvedGpuMode]}`,
            gpuMode: resolvedGpuMode,
            ...status
          };
        } else {
          return { success: false, error: result.error, status: 500 };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // ============================================================
  // RERANKER CONFIGURATION ENDPOINTS
  // ============================================================

  // API: Get Reranker Configuration
  if (pathname === '/api/codexlens/reranker/config' && req.method === 'GET') {
    try {
      const venvStatus = await checkVenvStatus();

      // Default reranker config (matches fastembed default)
      const rerankerConfig = {
        backend: 'fastembed',
        model_name: 'Xenova/ms-marco-MiniLM-L-6-v2',
        api_provider: 'siliconflow',
        api_key_set: false,
        available_backends: ['onnx', 'api', 'litellm', 'legacy'],
        api_providers: ['siliconflow', 'cohere', 'jina'],
        litellm_endpoints: [] as string[],
        config_source: 'default'
      };

      // Load LiteLLM endpoints for dropdown
      try {
        const litellmConfig = loadLiteLLMApiConfig(initialPath);
        if (litellmConfig.endpoints && Array.isArray(litellmConfig.endpoints)) {
          rerankerConfig.litellm_endpoints = litellmConfig.endpoints.map(
            (ep: any) => ep.alias || ep.name || ep.baseUrl
          ).filter(Boolean);
        }
      } catch {
        // LiteLLM config not available, continue with empty endpoints
      }

      // If CodexLens is installed, try to get actual config
      if (venvStatus.ready) {
        try {
          const result = await executeCodexLens(['config', '--json']);
          if (result.success) {
            const config = extractJSON(result.output ?? '');
            if (config.success && config.result) {
              // Map config values
              if (config.result.reranker_backend) {
                rerankerConfig.backend = config.result.reranker_backend;
                rerankerConfig.config_source = 'codexlens';
              }
              if (config.result.reranker_model) {
                rerankerConfig.model_name = config.result.reranker_model;
              }
              if (config.result.reranker_api_provider) {
                rerankerConfig.api_provider = config.result.reranker_api_provider;
              }
              // Check if API key is set (from env)
              if (process.env.RERANKER_API_KEY) {
                rerankerConfig.api_key_set = true;
              }
            }
          }
        } catch (e) {
          console.error('[CodexLens] Failed to get reranker config:', e);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...rerankerConfig }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: Set Reranker Configuration
  if (pathname === '/api/codexlens/reranker/config' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { backend, model_name, api_provider, api_key, litellm_endpoint } = body as {
        backend?: unknown;
        model_name?: unknown;
        api_provider?: unknown;
        api_key?: unknown;
        litellm_endpoint?: unknown;
      };
      const resolvedBackend = typeof backend === 'string' && backend.trim().length > 0 ? backend : undefined;
      const resolvedModelName = typeof model_name === 'string' && model_name.trim().length > 0 ? model_name : undefined;
      const resolvedApiProvider = typeof api_provider === 'string' && api_provider.trim().length > 0 ? api_provider : undefined;
      const resolvedApiKey = typeof api_key === 'string' && api_key.trim().length > 0 ? api_key : undefined;
      const resolvedLiteLLMEndpoint =
        typeof litellm_endpoint === 'string' && litellm_endpoint.trim().length > 0 ? litellm_endpoint : undefined;

      // Validate backend
      const validBackends = ['onnx', 'api', 'litellm', 'legacy', 'fastembed'];
      if (resolvedBackend && !validBackends.includes(resolvedBackend)) {
        return {
          success: false,
          error: `Invalid backend: ${resolvedBackend}. Valid options: ${validBackends.join(', ')}`,
          status: 400
        };
      }

      // Validate api_provider
      const validProviders = ['siliconflow', 'cohere', 'jina'];
      if (resolvedApiProvider && !validProviders.includes(resolvedApiProvider)) {
        return {
          success: false,
          error: `Invalid api_provider: ${resolvedApiProvider}. Valid options: ${validProviders.join(', ')}`,
          status: 400
        };
      }

      try {
        const updates: string[] = [];

        // Set backend
        if (resolvedBackend) {
          const result = await executeCodexLens(['config', 'set', 'reranker_backend', resolvedBackend, '--json']);
          if (result.success) updates.push('backend');
        }

        // Set model
        if (resolvedModelName) {
          const result = await executeCodexLens(['config', 'set', 'reranker_model', resolvedModelName, '--json']);
          if (result.success) updates.push('model_name');
        }

        // Set API provider
        if (resolvedApiProvider) {
          const result = await executeCodexLens(['config', 'set', 'reranker_api_provider', resolvedApiProvider, '--json']);
          if (result.success) updates.push('api_provider');
        }

        // Set LiteLLM endpoint
        if (resolvedLiteLLMEndpoint) {
          const result = await executeCodexLens([
            'config',
            'set',
            'reranker_litellm_endpoint',
            resolvedLiteLLMEndpoint,
            '--json'
          ]);
          if (result.success) updates.push('litellm_endpoint');
        }

        // Handle API key - write to .env file or environment
        if (resolvedApiKey) {
          // For security, we store in process.env for the current session
          // In production, this should be written to a secure .env file
          process.env.RERANKER_API_KEY = resolvedApiKey;
          updates.push('api_key');
        }

        return {
          success: true,
          message: `Updated: ${updates.join(', ')}`,
          updated_fields: updates
        };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // ============================================================
  // RERANKER MODEL MANAGEMENT ENDPOINTS
  // ============================================================

  // API: List Reranker Models (list available reranker models)
  if (pathname === '/api/codexlens/reranker/models' && req.method === 'GET') {
    try {
      // Check if CodexLens is installed first
      const venvStatus = await checkVenvStatus();
      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'CodexLens not installed' }));
        return true;
      }
      const result = await executeCodexLens(['reranker-model-list', '--json']);
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

  // API: Download Reranker Model (download reranker model by profile)
  if (pathname === '/api/codexlens/reranker/models/download' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { profile } = body as { profile?: unknown };
      const resolvedProfile = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : undefined;

      if (!resolvedProfile) {
        return { success: false, error: 'profile is required', status: 400 };
      }

      try {
        const result = await executeCodexLens(['reranker-model-download', resolvedProfile, '--json'], { timeout: 600000 }); // 10 min for download
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

  // API: Delete Reranker Model (delete reranker model by profile)
  if (pathname === '/api/codexlens/reranker/models/delete' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { profile } = body as { profile?: unknown };
      const resolvedProfile = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : undefined;

      if (!resolvedProfile) {
        return { success: false, error: 'profile is required', status: 400 };
      }

      try {
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
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: Reranker Model Info (get reranker model info by profile)
  if (pathname === '/api/codexlens/reranker/models/info' && req.method === 'GET') {
    const profile = url.searchParams.get('profile');

    if (!profile) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'profile parameter is required' }));
      return true;
    }

    try {
      const result = await executeCodexLens(['reranker-model-info', profile, '--json']);
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
  // SPLADE ENDPOINTS
  // ============================================================

  // API: SPLADE Status - Check if SPLADE is available and installed
  if (pathname === '/api/codexlens/splade/status') {
    try {
      // Check if CodexLens is installed first
      const venvStatus = await checkVenvStatus();
      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          available: false,
          installed: false,
          model: 'naver/splade-cocondenser-ensembledistil',
          error: 'CodexLens not installed'
        }));
        return true;
      }

      // Check SPLADE availability using Python check
      const result = await executeCodexLens(['python', '-c',
        'from codexlens.semantic.splade_encoder import check_splade_available; ok, err = check_splade_available(); print(\"OK\" if ok else err)'
      ]);

      const output = result.output ?? '';
      const available = output.includes('OK');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        available,
        installed: available,
        model: 'naver/splade-cocondenser-ensembledistil',
        error: available ? null : output.trim()
      }));
    } catch (err: unknown) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        available: false,
        installed: false,
        model: 'naver/splade-cocondenser-ensembledistil',
        error: err instanceof Error ? err.message : String(err)
      }));
    }
    return true;
  }

  // API: SPLADE Install - Install SPLADE dependencies
  if (pathname === '/api/codexlens/splade/install' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      try {
        const { gpu } = body as { gpu?: unknown };
        const useGpu = typeof gpu === 'boolean' ? gpu : false;
        const packageName = useGpu ? 'codex-lens[splade-gpu]' : 'codex-lens[splade]';

        // Use pip to install the SPLADE extras
        const { promisify } = await import('util');
        const execFilePromise = promisify(require('child_process').execFile);

        const result = await execFilePromise('pip', ['install', packageName], {
          timeout: 600000 // 10 minutes
        });

        return {
          success: true,
          message: `SPLADE installed successfully (${useGpu ? 'GPU' : 'CPU'} mode)`,
          output: result.stdout
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const stderr = (err as { stderr?: unknown })?.stderr;
        return {
          success: false,
          error: message,
          stderr: typeof stderr === 'string' ? stderr : undefined,
          status: 500
        };
      }
    });
    return true;
  }

  // API: SPLADE Index Status - Check if SPLADE index exists for a project
  if (pathname === '/api/codexlens/splade/index-status') {
    try {
      const projectPath = url.searchParams.get('path');
      if (!projectPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing path parameter' }));
        return true;
      }

      // Check if CodexLens is installed first
      const venvStatus = await checkVenvStatus();
      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false, error: 'CodexLens not installed' }));
        return true;
      }

      const { join } = await import('path');
      const indexDb = join(projectPath, '.codexlens', '_index.db');

      // Use Python to check SPLADE index status
      const pythonCode = `
from codexlens.storage.splade_index import SpladeIndex
from pathlib import Path
try:
    idx = SpladeIndex(Path(\"${indexDb.replace(/\\\\/g, '\\\\\\\\')}\"))
    if idx.has_index():
        stats = idx.get_stats()
        meta = idx.get_metadata()
        model = meta.get('model_name', '') if meta else ''
        print(f\"OK|{stats['unique_chunks']}|{stats['total_postings']}|{model}\")
    else:
        print(\"NO_INDEX\")
except Exception as e:
    print(f\"ERROR|{str(e)}\")
`;

      const result = await executeCodexLens(['python', '-c', pythonCode]);

      const output = result.output ?? '';
      if (output.startsWith('OK|')) {
        const parts = output.trim().split('|');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          exists: true,
          chunks: parseInt(parts[1]),
          postings: parseInt(parts[2]),
          model: parts[3]
        }));
      } else if (output.startsWith('ERROR|')) {
        const errorMsg = output.substring(6).trim();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false, error: errorMsg }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false }));
      }
    } catch (err: unknown) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: SPLADE Index Rebuild - Rebuild SPLADE index for a project
  if (pathname === '/api/codexlens/splade/rebuild' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { path: projectPath } = body as { path?: unknown };
      const resolvedProjectPath = typeof projectPath === 'string' && projectPath.trim().length > 0 ? projectPath : undefined;

      if (!resolvedProjectPath) {
        return { success: false, error: 'Missing path parameter', status: 400 };
      }

      try {
        // Use 'index splade' instead of deprecated 'splade-index'
        const result = await executeCodexLens(['index', 'splade', resolvedProjectPath, '--rebuild'], {
          cwd: resolvedProjectPath,
          timeout: 1800000 // 30 minutes for large codebases
        });

        if (result.success) {
          return {
            success: true,
            message: 'SPLADE index rebuilt successfully',
            output: result.output
          };
        } else {
          return {
            success: false,
            error: result.error || 'Failed to rebuild SPLADE index',
            output: result.output,
            status: 500
          };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  return false;
}
