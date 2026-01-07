/**
 * CLI Routes Module
 * Handles all CLI-related API endpoints
 */
import {
  getCliToolsStatus,
  getCliToolsFullStatus,
  installCliTool,
  uninstallCliTool,
  enableCliTool,
  disableCliTool,
  getExecutionHistory,
  getExecutionHistoryAsync,
  getExecutionDetail,
  getConversationDetail,
  getConversationDetailWithNativeInfo,
  deleteExecution,
  deleteExecutionAsync,
  batchDeleteExecutionsAsync,
  executeCliTool,
  getNativeSessionContent,
  getFormattedNativeConversation,
  getEnrichedConversation,
  getHistoryWithNativeInfo
} from '../../tools/cli-executor.js';
import { generateSmartContext, formatSmartContext } from '../../tools/smart-context.js';
import {
  loadCliConfig,
  getToolConfig,
  updateToolConfig,
  getFullConfigResponse,
  PREDEFINED_MODELS
} from '../../tools/cli-config-manager.js';
import {
  loadClaudeCliTools,
  saveClaudeCliTools,
  updateClaudeToolEnabled,
  updateClaudeCacheSettings,
  getClaudeCliToolsInfo,
  addClaudeCustomEndpoint,
  removeClaudeCustomEndpoint,
  updateCodeIndexMcp,
  getCodeIndexMcp
} from '../../tools/claude-cli-tools.js';
import type { RouteContext } from './types.js';

// ========== Active Executions State ==========
// Stores running CLI executions for state recovery when view is opened/refreshed
interface ActiveExecution {
  id: string;
  tool: string;
  mode: string;
  prompt: string;
  startTime: number;
  output: string;
  status: 'running' | 'completed' | 'error';
}

const activeExecutions = new Map<string, ActiveExecution>();

/**
 * Get all active CLI executions
 * Used by frontend to restore state when view is opened during execution
 */
export function getActiveExecutions(): ActiveExecution[] {
  return Array.from(activeExecutions.values());
}

/**
 * Handle CLI routes
 * @returns true if route was handled, false otherwise
 */
export async function handleCliRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest, broadcastToClients } = ctx;

  // API: Get Active CLI Executions (for state recovery)
  if (pathname === '/api/cli/active' && req.method === 'GET') {
    const executions = getActiveExecutions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ executions }));
    return true;
  }

  // API: CLI Tools Status
  if (pathname === '/api/cli/status') {
    const status = await getCliToolsStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return true;
  }

  // API: CLI Tools Full Status (with enabled state)
  if (pathname === '/api/cli/full-status') {
    const status = await getCliToolsFullStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return true;
  }

  // API: Install CLI Tool
  if (pathname === '/api/cli/install' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: unknown) => {
      const { tool } = body as { tool: string };
      if (!tool) {
        return { error: 'Tool name is required', status: 400 };
      }

      const result = await installCliTool(tool);
      if (result.success) {
        // Broadcast tool installed event
        broadcastToClients({
          type: 'CLI_TOOL_INSTALLED',
          payload: { tool, timestamp: new Date().toISOString() }
        });
        return { success: true, message: `${tool} installed successfully` };
      } else {
        return { success: false, error: result.error, status: 500 };
      }
    });
    return true;
  }

  // API: Uninstall CLI Tool
  if (pathname === '/api/cli/uninstall' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: unknown) => {
      const { tool } = body as { tool: string };
      if (!tool) {
        return { error: 'Tool name is required', status: 400 };
      }

      const result = await uninstallCliTool(tool);
      if (result.success) {
        // Broadcast tool uninstalled event
        broadcastToClients({
          type: 'CLI_TOOL_UNINSTALLED',
          payload: { tool, timestamp: new Date().toISOString() }
        });
        return { success: true, message: `${tool} uninstalled successfully` };
      } else {
        return { success: false, error: result.error, status: 500 };
      }
    });
    return true;
  }

  // API: Enable CLI Tool
  if (pathname === '/api/cli/enable' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: unknown) => {
      const { tool } = body as { tool: string };
      if (!tool) {
        return { error: 'Tool name is required', status: 400 };
      }

      const result = enableCliTool(tool);
      // Broadcast tool enabled event
      broadcastToClients({
        type: 'CLI_TOOL_ENABLED',
        payload: { tool, timestamp: new Date().toISOString() }
      });
      return { success: true, message: `${tool} enabled` };
    });
    return true;
  }

  // API: Disable CLI Tool
  if (pathname === '/api/cli/disable' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: unknown) => {
      const { tool } = body as { tool: string };
      if (!tool) {
        return { error: 'Tool name is required', status: 400 };
      }

      const result = disableCliTool(tool);
      // Broadcast tool disabled event
      broadcastToClients({
        type: 'CLI_TOOL_DISABLED',
        payload: { tool, timestamp: new Date().toISOString() }
      });
      return { success: true, message: `${tool} disabled` };
    });
    return true;
  }

  // API: Get Full CLI Config (with predefined models)
  if (pathname === '/api/cli/config' && req.method === 'GET') {
    try {
      const response = getFullConfigResponse(initialPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  // API: Get/Update Tool Config
  const configMatch = pathname.match(/^\/api\/cli\/config\/(gemini|qwen|codex)$/);
  if (configMatch) {
    const tool = configMatch[1];

    // GET: Get single tool config
    if (req.method === 'GET') {
      try {
        const toolConfig = getToolConfig(initialPath, tool);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(toolConfig));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return true;
    }

    // PUT: Update tool config
    if (req.method === 'PUT') {
      handlePostRequest(req, res, async (body: unknown) => {
        try {
          const updates = body as { enabled?: boolean; primaryModel?: string; secondaryModel?: string };
          const updated = updateToolConfig(initialPath, tool, updates);

          // Broadcast config updated event
          broadcastToClients({
            type: 'CLI_CONFIG_UPDATED',
            payload: { tool, config: updated, timestamp: new Date().toISOString() }
          });

          return { success: true, config: updated };
        } catch (err) {
          return { error: (err as Error).message, status: 500 };
        }
      });
      return true;
    }
  }

  // API: Get all custom endpoints
  if (pathname === '/api/cli/endpoints' && req.method === 'GET') {
    try {
      const config = loadClaudeCliTools(initialPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ endpoints: config.customEndpoints || [] }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  // API: Add/Update custom endpoint
  if (pathname === '/api/cli/endpoints' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: unknown) => {
      try {
        const { id, name, enabled } = body as { id: string; name: string; enabled: boolean };
        if (!id || !name) {
          return { error: 'id and name are required', status: 400 };
        }
        const config = addClaudeCustomEndpoint(initialPath, { id, name, enabled: enabled !== false });

        broadcastToClients({
          type: 'CLI_ENDPOINT_UPDATED',
          payload: { endpoint: { id, name, enabled }, timestamp: new Date().toISOString() }
        });

        return { success: true, endpoints: config.customEndpoints };
      } catch (err) {
        return { error: (err as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Update custom endpoint enabled status
  if (pathname.match(/^\/api\/cli\/endpoints\/[^/]+$/) && req.method === 'PUT') {
    const endpointId = pathname.split('/').pop() || '';
    handlePostRequest(req, res, async (body: unknown) => {
      try {
        const { enabled, name } = body as { enabled?: boolean; name?: string };
        const config = loadClaudeCliTools(initialPath);
        const endpoint = config.customEndpoints.find(e => e.id === endpointId);

        if (!endpoint) {
          return { error: 'Endpoint not found', status: 404 };
        }

        if (typeof enabled === 'boolean') endpoint.enabled = enabled;
        if (name) endpoint.name = name;

        saveClaudeCliTools(initialPath, config);

        broadcastToClients({
          type: 'CLI_ENDPOINT_UPDATED',
          payload: { endpoint, timestamp: new Date().toISOString() }
        });

        return { success: true, endpoint };
      } catch (err) {
        return { error: (err as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Delete custom endpoint
  if (pathname.match(/^\/api\/cli\/endpoints\/[^/]+$/) && req.method === 'DELETE') {
    const endpointId = pathname.split('/').pop() || '';
    try {
      const config = removeClaudeCustomEndpoint(initialPath, endpointId);

      broadcastToClients({
        type: 'CLI_ENDPOINT_DELETED',
        payload: { endpointId, timestamp: new Date().toISOString() }
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, endpoints: config.customEndpoints }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  // API: CLI Execution History
  if (pathname === '/api/cli/history') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const tool = url.searchParams.get('tool') || null;
    const status = url.searchParams.get('status') || null;
    const category = url.searchParams.get('category') as 'user' | 'internal' | 'insight' | null;
    const search = url.searchParams.get('search') || null;
    const recursive = url.searchParams.get('recursive') !== 'false';

    getExecutionHistoryAsync(projectPath, { limit, tool, status, category, search, recursive })
      .then(history => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(history));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return true;
  }

  // API: CLI Execution Detail (GET) or Delete (DELETE)
  if (pathname === '/api/cli/execution') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const executionId = url.searchParams.get('id');

    if (!executionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Execution ID is required' }));
      return true;
    }

    // Handle DELETE request
    if (req.method === 'DELETE') {
      deleteExecutionAsync(projectPath, executionId)
        .then(result => {
          if (result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Execution deleted' }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: result.error || 'Delete failed' }));
          }
        })
        .catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return true;
    }

    // Handle GET request - return conversation with native session info
    const conversation = getConversationDetailWithNativeInfo(projectPath, executionId);
    if (!conversation) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Conversation not found' }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(conversation));
    return true;
  }

  // API: Batch Delete CLI Executions
  if (pathname === '/api/cli/batch-delete' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { path: projectPath, ids } = body as { path?: string; ids: string[] };

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return { error: 'ids array is required', status: 400 };
      }

      const basePath = projectPath || initialPath;
      return await batchDeleteExecutionsAsync(basePath, ids);
    });
    return true;
  }

  // API: Get Native Session Content
  if (pathname === '/api/cli/native-session') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const executionId = url.searchParams.get('id');
    const format = url.searchParams.get('format') || 'json';

    if (!executionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Execution ID is required' }));
      return true;
    }

    try {
      let result;
      if (format === 'text') {
        result = await getFormattedNativeConversation(projectPath, executionId, {
          includeThoughts: url.searchParams.get('thoughts') === 'true',
          includeToolCalls: url.searchParams.get('tools') === 'true',
          includeTokens: url.searchParams.get('tokens') === 'true'
        });
      } else if (format === 'pairs') {
        const enriched = await getEnrichedConversation(projectPath, executionId);
        result = enriched?.merged || null;
      } else {
        result = await getNativeSessionContent(projectPath, executionId);
      }

      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Native session not found' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': format === 'text' ? 'text/plain' : 'application/json' });
      res.end(format === 'text' ? result : JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  // API: Get Enriched Conversation
  if (pathname === '/api/cli/enriched') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const executionId = url.searchParams.get('id');

    if (!executionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Execution ID is required' }));
      return true;
    }

    getEnrichedConversation(projectPath, executionId)
      .then(result => {
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Conversation not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      });
    return true;
  }

  // API: Get History with Native Session Info
  if (pathname === '/api/cli/history-native') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const tool = url.searchParams.get('tool') || null;
    const status = url.searchParams.get('status') || null;
    const category = url.searchParams.get('category') as 'user' | 'internal' | 'insight' | null;
    const search = url.searchParams.get('search') || null;
    const recursive = url.searchParams.get('recursive') !== 'false';

    getHistoryWithNativeInfo(projectPath, { limit, tool, status, category, search, recursive })
      .then(history => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(history));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      });
    return true;
  }

  // API: Execute CLI Tool
  if (pathname === '/api/cli/execute' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { tool, prompt, mode, format, model, dir, includeDirs, timeout, smartContext, parentExecutionId, category } = body as any;

      if (!tool || !prompt) {
        return { error: 'tool and prompt are required', status: 400 };
      }

      // Generate smart context if enabled
      let finalPrompt = prompt;
      if (smartContext?.enabled) {
        try {
          const contextResult = await generateSmartContext(prompt, {
            enabled: true,
            maxFiles: smartContext.maxFiles || 10,
            searchMode: 'text'
          }, dir || initialPath);

          const contextAppendage = formatSmartContext(contextResult);
          if (contextAppendage) {
            finalPrompt = prompt + contextAppendage;
          }
        } catch (err) {
          console.warn('[Smart Context] Failed to generate:', err);
        }
      }

      const executionId = `${Date.now()}-${tool}`;

      // Store active execution for state recovery
      activeExecutions.set(executionId, {
        id: executionId,
        tool,
        mode: mode || 'analysis',
        prompt: prompt.substring(0, 500), // Truncate for display
        startTime: Date.now(),
        output: '',
        status: 'running'
      });

      // Broadcast execution started
      broadcastToClients({
        type: 'CLI_EXECUTION_STARTED',
        payload: {
          executionId,
          tool,
          mode: mode || 'analysis',
          parentExecutionId,
          timestamp: new Date().toISOString()
        }
      });

      try {
        const result = await executeCliTool({
          tool,
          prompt: finalPrompt,
          mode: mode || 'analysis',
          format: format || 'plain',
          model,
          cd: dir || initialPath,
          includeDirs,
          timeout: timeout || 0, // 0 = no internal timeout, controlled by external caller
          category: category || 'user',
          parentExecutionId,
          stream: true
        }, (chunk) => {
          // Append chunk to active execution buffer
          const activeExec = activeExecutions.get(executionId);
          if (activeExec) {
            activeExec.output += chunk.data || '';
          }

          broadcastToClients({
            type: 'CLI_OUTPUT',
            payload: {
              executionId,
              chunkType: chunk.type,
              data: chunk.data
            }
          });
        });

        // Remove from active executions on completion
        activeExecutions.delete(executionId);

        // Broadcast completion
        broadcastToClients({
          type: 'CLI_EXECUTION_COMPLETED',
          payload: {
            executionId,
            success: result.success,
            status: result.execution.status,
            duration_ms: result.execution.duration_ms
          }
        });

        return {
          success: result.success,
          execution: result.execution
        };

      } catch (error: unknown) {
        // Remove from active executions on error
        activeExecutions.delete(executionId);

        broadcastToClients({
          type: 'CLI_EXECUTION_ERROR',
          payload: {
            executionId,
            error: (error as Error).message
          }
        });

        return { error: (error as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: CLI Review - Submit review for an execution
  if (pathname.startsWith('/api/cli/review/') && req.method === 'POST') {
    const executionId = pathname.replace('/api/cli/review/', '');
    handlePostRequest(req, res, async (body) => {
      const { status, rating, comments, reviewer } = body as {
        status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
        rating?: number;
        comments?: string;
        reviewer?: string;
      };

      if (!status) {
        return { error: 'status is required', status: 400 };
      }

      try {
        const historyStore = await import('../../tools/cli-history-store.js').then(m => m.getHistoryStore(initialPath));

        const execution = historyStore.getConversation(executionId);
        if (!execution) {
          return { error: 'Execution not found', status: 404 };
        }

        const review = historyStore.saveReview({
          execution_id: executionId,
          status,
          rating,
          comments,
          reviewer
        });

        broadcastToClients({
          type: 'CLI_REVIEW_UPDATED',
          payload: {
            executionId,
            review,
            timestamp: new Date().toISOString()
          }
        });

        return { success: true, review };
      } catch (error: unknown) {
        return { error: (error as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: CLI Review - Get review for an execution
  if (pathname.startsWith('/api/cli/review/') && req.method === 'GET') {
    const executionId = pathname.replace('/api/cli/review/', '');
    try {
      const historyStore = await import('../../tools/cli-history-store.js').then(m => m.getHistoryStore(initialPath));
      const review = historyStore.getReview(executionId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ review }));
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: CLI Reviews - List all reviews
  if (pathname === '/api/cli/reviews' && req.method === 'GET') {
    try {
      const historyStore = await import('../../tools/cli-history-store.js').then(m => m.getHistoryStore(initialPath));
      const statusFilter = url.searchParams.get('status') as 'pending' | 'approved' | 'rejected' | 'changes_requested' | null;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      const reviews = historyStore.getReviews({
        status: statusFilter || undefined,
        limit
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reviews, count: reviews.length }));
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Get CLI Tools Config from .claude/cli-tools.json (with fallback to global)
  if (pathname === '/api/cli/tools-config' && req.method === 'GET') {
    try {
      const config = loadClaudeCliTools(initialPath);
      const info = getClaudeCliToolsInfo(initialPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...config,
        _configInfo: info
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  // API: Update CLI Tools Config
  if (pathname === '/api/cli/tools-config' && req.method === 'PUT') {
    handlePostRequest(req, res, async (body: unknown) => {
      try {
        const updates = body as Partial<any>;
        const config = loadClaudeCliTools(initialPath);

        // Merge updates
        const updatedConfig = {
          ...config,
          ...updates,
          tools: { ...config.tools, ...(updates.tools || {}) },
          settings: {
            ...config.settings,
            ...(updates.settings || {}),
            cache: {
              ...config.settings.cache,
              ...(updates.settings?.cache || {})
            }
          }
        };

        saveClaudeCliTools(initialPath, updatedConfig);

        broadcastToClients({
          type: 'CLI_TOOLS_CONFIG_UPDATED',
          payload: { config: updatedConfig, timestamp: new Date().toISOString() }
        });

        return { success: true, config: updatedConfig };
      } catch (err) {
        return { error: (err as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Update specific tool enabled status
  const toolsConfigMatch = pathname.match(/^\/api\/cli\/tools-config\/([a-zA-Z0-9_-]+)$/);
  if (toolsConfigMatch && req.method === 'PUT') {
    const toolName = toolsConfigMatch[1];
    handlePostRequest(req, res, async (body: unknown) => {
      try {
        const { enabled } = body as { enabled: boolean };
        const config = updateClaudeToolEnabled(initialPath, toolName, enabled);

        broadcastToClients({
          type: 'CLI_TOOL_TOGGLED',
          payload: { tool: toolName, enabled, timestamp: new Date().toISOString() }
        });

        return { success: true, config };
      } catch (err) {
        return { error: (err as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Update cache settings
  if (pathname === '/api/cli/tools-config/cache' && req.method === 'PUT') {
    handlePostRequest(req, res, async (body: unknown) => {
      try {
        const cacheSettings = body as { injectionMode?: string; defaultPrefix?: string; defaultSuffix?: string };
        const config = updateClaudeCacheSettings(initialPath, cacheSettings as any);

        broadcastToClients({
          type: 'CLI_CACHE_SETTINGS_UPDATED',
          payload: { cache: config.settings.cache, timestamp: new Date().toISOString() }
        });

        return { success: true, config };
      } catch (err) {
        return { error: (err as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Get Code Index MCP provider
  if (pathname === '/api/cli/code-index-mcp' && req.method === 'GET') {
    try {
      const provider = getCodeIndexMcp(initialPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return true;
  }

  // API: Update Code Index MCP provider
  if (pathname === '/api/cli/code-index-mcp' && req.method === 'PUT') {
    handlePostRequest(req, res, async (body: unknown) => {
      try {
        const { provider } = body as { provider: 'codexlens' | 'ace' | 'none' };
        if (!provider || !['codexlens', 'ace', 'none'].includes(provider)) {
          return { error: 'Invalid provider. Must be "codexlens", "ace", or "none"', status: 400 };
        }

        const result = updateCodeIndexMcp(initialPath, provider);

        if (result.success) {
          broadcastToClients({
            type: 'CODE_INDEX_MCP_UPDATED',
            payload: { provider, timestamp: new Date().toISOString() }
          });
          return { success: true, provider };
        } else {
          return { error: result.error, status: 500 };
        }
      } catch (err) {
        return { error: (err as Error).message, status: 500 };
      }
    });
    return true;
  }

  return false;
}
