/**
 * CodexLens index management handlers.
 */

import {
  cancelIndexing,
  checkVenvStatus,
  ensureLiteLLMEmbedderReady,
  executeCodexLens,
  isIndexingInProgress,
} from '../../../tools/codex-lens.js';
import type { ProgressInfo } from '../../../tools/codex-lens.js';
import type { RouteContext } from '../types.js';
import { extractJSON, formatSize } from './utils.js';

/**
 * Handle CodexLens index routes
 * @returns true if route was handled, false otherwise
 */
export async function handleCodexLensIndexRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest, broadcastToClients } = ctx;

  // API: CodexLens Index List - Get all indexed projects with details
  if (pathname === '/api/codexlens/indexes') {
    try {
      // Check if CodexLens is installed first (without auto-installing)
      const venvStatus = await checkVenvStatus();
      if (!venvStatus.ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, indexes: [], totalSize: 0, totalSizeFormatted: '0 B' }));
        return true;
      }

      // Execute all CLI commands in parallel
      const [configResult, projectsResult, statusResult] = await Promise.all([
        executeCodexLens(['config', '--json']),
        executeCodexLens(['projects', 'list', '--json']),
        executeCodexLens(['status', '--json'])
      ]);

      let indexDir = '';
      if (configResult.success) {
        try {
          const config = extractJSON(configResult.output ?? '');
          if (config.success && config.result) {
            // CLI returns index_dir (not index_root)
            indexDir = config.result.index_dir || config.result.index_root || '';
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse config for index list:', e instanceof Error ? e.message : String(e));
        }
      }

      let indexes: any[] = [];
      let totalSize = 0;
      let vectorIndexCount = 0;
      let normalIndexCount = 0;

      if (projectsResult.success) {
        try {
          const projectsData = extractJSON(projectsResult.output ?? '');
          if (projectsData.success && Array.isArray(projectsData.result)) {
            const { stat, readdir } = await import('fs/promises');
            const { existsSync } = await import('fs');
            const { basename, join } = await import('path');

            for (const project of projectsData.result) {
              // Skip test/temp projects
              if (project.source_root && (
                project.source_root.includes('\\Temp\\') ||
                project.source_root.includes('/tmp/') ||
                project.total_files === 0
              )) {
                continue;
              }

              let projectSize = 0;
              let hasVectorIndex = false;
              let hasNormalIndex = true; // All projects have FTS index
              let lastModified = null;

              // Try to get actual index size from index_root
              if (project.index_root && existsSync(project.index_root)) {
                try {
                  const files = await readdir(project.index_root);
                  for (const file of files) {
                    try {
                      const filePath = join(project.index_root, file);
                      const fileStat = await stat(filePath);
                      projectSize += fileStat.size;
                      if (!lastModified || fileStat.mtime > lastModified) {
                        lastModified = fileStat.mtime;
                      }
                      // Check for vector/embedding files
                      if (file.includes('vector') || file.includes('embedding') ||
                          file.endsWith('.faiss') || file.endsWith('.npy') ||
                          file.includes('semantic_chunks')) {
                        hasVectorIndex = true;
                      }
                    } catch {
                      // Skip files we can't stat
                    }
                  }
                } catch {
                  // Can't read index directory
                }
              }

              if (hasVectorIndex) vectorIndexCount++;
              if (hasNormalIndex) normalIndexCount++;
              totalSize += projectSize;

              // Use source_root as the display name
              const displayName = project.source_root ? basename(project.source_root) : `project_${project.id}`;

              indexes.push({
                id: displayName,
                path: project.source_root || '',
                indexPath: project.index_root || '',
                size: projectSize,
                sizeFormatted: formatSize(projectSize),
                fileCount: project.total_files || 0,
                dirCount: project.total_dirs || 0,
                hasVectorIndex,
                hasNormalIndex,
                status: project.status || 'active',
                lastModified: lastModified ? lastModified.toISOString() : null
              });
            }

            // Sort by file count (most files first), then by name
            indexes.sort((a, b) => {
              if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
              return a.id.localeCompare(b.id);
            });
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse projects list:', e instanceof Error ? e.message : String(e));
        }
      }

      // Parse summary stats from status command (already fetched in parallel)
      let statusSummary: any = {};

      if (statusResult.success) {
        try {
          const status = extractJSON(statusResult.output ?? '');
          if (status.success && status.result) {
            statusSummary = {
              totalProjects: status.result.projects_count || indexes.length,
              totalFiles: status.result.total_files || 0,
              totalDirs: status.result.total_dirs || 0,
              // Keep calculated totalSize for consistency with per-project sizes
              // status.index_size_bytes includes shared resources (models, cache)
              indexSizeBytes: totalSize,
              indexSizeMb: totalSize / (1024 * 1024),
              embeddings: status.result.embeddings || {},
              // Store full index dir size separately for reference
              fullIndexDirSize: status.result.index_size_bytes || 0,
              fullIndexDirSizeFormatted: formatSize(status.result.index_size_bytes || 0)
            };
          }
        } catch (e: unknown) {
          console.error('[CodexLens] Failed to parse status:', e instanceof Error ? e.message : String(e));
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        indexDir,
        indexes,
        summary: {
          totalProjects: indexes.length,
          totalSize,
          totalSizeFormatted: formatSize(totalSize),
          vectorIndexCount,
          normalIndexCount,
          ...statusSummary
        }
      }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: CodexLens Clean (Clean indexes)
  if (pathname === '/api/codexlens/clean' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { all = false, path } = body as { all?: unknown; path?: unknown };

      try {
        const args = ['clean'];
        if (all === true) {
          args.push('--all');
        } else if (typeof path === 'string' && path.trim().length > 0) {
          // Path is passed as a positional argument, not as a flag
          args.push(path);
        }
        args.push('--json');

        const result = await executeCodexLens(args);
        if (result.success) {
          return { success: true, message: 'Indexes cleaned successfully' };
        } else {
          return { success: false, error: result.error || 'Failed to clean indexes', status: 500 };
        }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: CodexLens Init (Initialize workspace index)
  if (pathname === '/api/codexlens/init' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { path: projectPath, indexType = 'vector', embeddingModel = 'code', embeddingBackend = 'fastembed', maxWorkers = 1 } = body as {
        path?: unknown;
        indexType?: unknown;
        embeddingModel?: unknown;
        embeddingBackend?: unknown;
        maxWorkers?: unknown;
      };
      const targetPath = typeof projectPath === 'string' && projectPath.trim().length > 0 ? projectPath : initialPath;
      const resolvedIndexType = indexType === 'normal' ? 'normal' : 'vector';
      const resolvedEmbeddingModel = typeof embeddingModel === 'string' && embeddingModel.trim().length > 0 ? embeddingModel : 'code';
      const resolvedEmbeddingBackend = typeof embeddingBackend === 'string' && embeddingBackend.trim().length > 0 ? embeddingBackend : 'fastembed';
      const resolvedMaxWorkers = typeof maxWorkers === 'number' ? maxWorkers : Number(maxWorkers);

      // Ensure LiteLLM backend dependencies are installed before running the CLI
      if (resolvedIndexType !== 'normal' && resolvedEmbeddingBackend === 'litellm') {
        const installResult = await ensureLiteLLMEmbedderReady();
        if (!installResult.success) {
          return { success: false, error: installResult.error || 'Failed to prepare LiteLLM embedder', status: 500 };
        }
      }

      // Build CLI arguments based on index type
      // Use 'index init' subcommand (new CLI structure)
      const args = ['index', 'init', targetPath, '--json'];
      if (resolvedIndexType === 'normal') {
        args.push('--no-embeddings');
      } else {
        // Add embedding model selection for vector index (use --model, not --embedding-model)
        args.push('--model', resolvedEmbeddingModel);
        // Add embedding backend if not using default fastembed (use --backend, not --embedding-backend)
        if (resolvedEmbeddingBackend && resolvedEmbeddingBackend !== 'fastembed') {
          args.push('--backend', resolvedEmbeddingBackend);
        }
        // Add max workers for concurrent API calls (useful for litellm backend)
        if (!Number.isNaN(resolvedMaxWorkers) && resolvedMaxWorkers > 1) {
          args.push('--max-workers', String(resolvedMaxWorkers));
        }
      }

      // Broadcast start event
      broadcastToClients({
        type: 'CODEXLENS_INDEX_PROGRESS',
        payload: { stage: 'start', message: 'Starting index...', percent: 0, path: targetPath, indexType: resolvedIndexType }
      });

      try {
        const result = await executeCodexLens(args, {
          cwd: targetPath,
          timeout: 1800000, // 30 minutes for large codebases
          onProgress: (progress: ProgressInfo) => {
            broadcastToClients({
              type: 'CODEXLENS_INDEX_PROGRESS',
              payload: { ...progress, path: targetPath }
            });
          }
        });

        if (result.success) {
          broadcastToClients({
            type: 'CODEXLENS_INDEX_PROGRESS',
            payload: { stage: 'complete', message: 'Index complete', percent: 100, path: targetPath }
          });

          try {
            const parsed = extractJSON(result.output ?? '');
            return { success: true, result: parsed };
          } catch {
            return { success: true, output: result.output ?? '' };
          }
        } else {
          broadcastToClients({
            type: 'CODEXLENS_INDEX_PROGRESS',
            payload: { stage: 'error', message: result.error || 'Unknown error', percent: 0, path: targetPath }
          });
          return { success: false, error: result.error, status: 500 };
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        broadcastToClients({
          type: 'CODEXLENS_INDEX_PROGRESS',
          payload: { stage: 'error', message, percent: 0, path: targetPath }
        });
        return { success: false, error: message, status: 500 };
      }
    });
    return true;
  }

  // API: Cancel CodexLens Indexing
  if (pathname === '/api/codexlens/cancel' && req.method === 'POST') {
    const result = cancelIndexing();

    // Broadcast cancellation event
    if (result.success) {
      broadcastToClients({
        type: 'CODEXLENS_INDEX_PROGRESS',
        payload: { stage: 'cancelled', message: 'Indexing cancelled by user', percent: 0 }
      });
    }

    res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  }

  // API: Check if indexing is in progress
  if (pathname === '/api/codexlens/indexing-status') {
    const inProgress = isIndexingInProgress();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, inProgress }));
    return true;
  }

  return false;
}

