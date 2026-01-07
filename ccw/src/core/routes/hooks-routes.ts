/**
 * Hooks Routes Module
 * Handles all hooks-related API endpoints
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

import type { RouteContext } from './types.js';

interface HooksRouteContext extends RouteContext {
  extractSessionIdFromPath: (filePath: string) => string | null;
}

// ========================================
// Helper Functions
// ========================================

const GLOBAL_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

/**
 * Get project settings path
 * @param {string} projectPath
 * @returns {string}
 */
function getProjectSettingsPath(projectPath: string): string {
  // path.join automatically handles cross-platform path separators
  return join(projectPath, '.claude', 'settings.json');
}

/**
 * Read settings file safely
 * @param {string} filePath
 * @returns {Object}
 */
function readSettingsFile(filePath: string): Record<string, unknown> {
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error: unknown) {
    console.error(`Error reading settings file ${filePath}:`, error);
    return {};
  }
}

/**
 * Get hooks configuration from global and project settings
 * @param {string} projectPath
 * @returns {Object}
 */
function getHooksConfig(projectPath: string): { global: { path: string; hooks: unknown }; project: { path: string | null; hooks: unknown } } {
  const globalSettings = readSettingsFile(GLOBAL_SETTINGS_PATH);
  const projectSettingsPath = projectPath ? getProjectSettingsPath(projectPath) : null;
  const projectSettings = projectSettingsPath ? readSettingsFile(projectSettingsPath) : {};

  return {
    global: {
      path: GLOBAL_SETTINGS_PATH,
      hooks: (globalSettings as { hooks?: unknown }).hooks || {}
    },
    project: {
      path: projectSettingsPath,
      hooks: (projectSettings as { hooks?: unknown }).hooks || {}
    }
  };
}

/**
 * Save a hook to settings file
 * @param {string} projectPath
 * @param {string} scope - 'global' or 'project'
 * @param {string} event - Hook event type
 * @param {Object} hookData - Hook configuration
 * @returns {Object}
 */
function saveHookToSettings(
  projectPath: string,
  scope: 'global' | 'project',
  event: string,
  hookData: Record<string, unknown> & { replaceIndex?: unknown }
): Record<string, unknown> {
  try {
    const filePath = scope === 'global' ? GLOBAL_SETTINGS_PATH : getProjectSettingsPath(projectPath);
    const settings = readSettingsFile(filePath) as Record<string, unknown> & { hooks?: Record<string, unknown> };

    // Ensure hooks object exists
    settings.hooks = settings.hooks || {};

    // Ensure the event array exists
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    // Ensure it's an array
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [settings.hooks[event]];
    }

    // Check if we're replacing an existing hook
    if (typeof hookData.replaceIndex === 'number') {
      const index = hookData.replaceIndex;
      delete hookData.replaceIndex;
      const hooksForEvent = settings.hooks[event] as unknown[];
      if (index >= 0 && index < hooksForEvent.length) {
        hooksForEvent[index] = hookData;
      }
    } else {
      // Add new hook
      (settings.hooks[event] as unknown[]).push(hookData);
    }

    // Ensure directory exists and write file
    const dirPath = dirname(filePath);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');

    return {
      success: true,
      event,
      hookData
    };
  } catch (error: unknown) {
    console.error('Error saving hook:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Delete a hook from settings file
 * @param {string} projectPath
 * @param {string} scope - 'global' or 'project'
 * @param {string} event - Hook event type
 * @param {number} hookIndex - Index of hook to delete
 * @returns {Object}
 */
function deleteHookFromSettings(
  projectPath: string,
  scope: 'global' | 'project',
  event: string,
  hookIndex: number
): Record<string, unknown> {
  try {
    const filePath = scope === 'global' ? GLOBAL_SETTINGS_PATH : getProjectSettingsPath(projectPath);
    const settings = readSettingsFile(filePath) as Record<string, unknown> & { hooks?: Record<string, unknown> };

    if (!settings.hooks || !settings.hooks[event]) {
      return { error: 'Hook not found' };
    }

    // Ensure it's an array
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [settings.hooks[event]];
    }

    const hooksForEvent = settings.hooks[event] as unknown[];

    if (hookIndex < 0 || hookIndex >= hooksForEvent.length) {
      return { error: 'Invalid hook index' };
    }

    // Remove the hook
    hooksForEvent.splice(hookIndex, 1);

    // Remove empty event arrays
    if (hooksForEvent.length === 0) {
      delete settings.hooks[event];
    }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');

    return {
      success: true,
      event,
      hookIndex
    };
  } catch (error: unknown) {
    console.error('Error deleting hook:', error);
    return { error: (error as Error).message };
  }
}

// ========================================
// Session State Tracking
// ========================================
// NOTE: Session state is managed by the CLI command (src/commands/hook.ts)
// using file-based persistence (~/.claude/.ccw-sessions/).
// This ensures consistent state tracking across all invocation methods.
// The /api/hook endpoint delegates to SessionClusteringService without
// managing its own state, as the authoritative state lives in the CLI layer.

// ========================================
// Route Handler
// ========================================

/**
 * Handle hooks routes
 * @returns true if route was handled, false otherwise
 */
export async function handleHooksRoutes(ctx: HooksRouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest, broadcastToClients, extractSessionIdFromPath } = ctx;

  // API: Hook endpoint for Claude Code notifications
  if (pathname === '/api/hook' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (typeof body !== 'object' || body === null) {
        return { error: 'Invalid request body', status: 400 };
      }

      const payload = body as Record<string, unknown>;
      const type = payload.type;
      const filePath = payload.filePath;
      const sessionId = payload.sessionId;
      const extraData: Record<string, unknown> = { ...payload };
      delete extraData.type;
      delete extraData.filePath;
      delete extraData.sessionId;

      // Determine session ID from file path if not provided
      let resolvedSessionId = typeof sessionId === 'string' ? sessionId : undefined;
      if (!resolvedSessionId && typeof filePath === 'string') {
        resolvedSessionId = extractSessionIdFromPath(filePath) ?? undefined;
      }

      // Handle context hooks (session-start, context)
      if (type === 'session-start' || type === 'context') {
        try {
          const projectPath = url.searchParams.get('path') || initialPath;
          const { SessionClusteringService } = await import('../session-clustering-service.js');
          const clusteringService = new SessionClusteringService(projectPath);

          const format = url.searchParams.get('format') || 'markdown';

          // Pass type and prompt to getProgressiveIndex
          // session-start: returns recent sessions by time
          // context: returns intent-matched sessions based on prompt
          const index = await clusteringService.getProgressiveIndex({
            type: type as 'session-start' | 'context',
            sessionId: resolvedSessionId,
            prompt: typeof extraData.prompt === 'string' ? extraData.prompt : undefined // Pass user prompt for intent matching
          });

          // Return context directly
          return {
            success: true,
            type: 'context',
            format,
            content: index,
            sessionId: resolvedSessionId
          };
        } catch (error) {
          console.error('[Hooks] Failed to generate context:', error);
          // Return empty content on failure (fail silently)
          return {
            success: true,
            type: 'context',
            format: 'markdown',
            content: '',
            sessionId: resolvedSessionId,
            error: (error as Error).message
          };
        }
      }

      // Broadcast to all connected WebSocket clients
      const notification = {
        type: typeof type === 'string' && type.trim().length > 0 ? type : 'session_updated',
        payload: {
          sessionId: resolvedSessionId,
          filePath: typeof filePath === 'string' ? filePath : undefined,
          timestamp: new Date().toISOString(),
          ...extraData  // Pass through toolName, status, result, params, error, etc.
        }
      };

      broadcastToClients(notification);

      return { success: true, notification };
    });
    return true;
  }

  // API: Unified Session Context endpoint (Progressive Disclosure)
  // DEPRECATED: Use CLI command `ccw hook session-context --stdin` instead.
  // This endpoint now uses file-based state (shared with CLI) for consistency.
  // - First prompt: returns cluster-based session overview
  // - Subsequent prompts: returns intent-matched sessions based on prompt
  if (pathname === '/api/hook/session-context' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { sessionId, prompt } = body as { sessionId?: string; prompt?: string };

      if (!sessionId) {
        return {
          success: true,
          content: '',
          error: 'sessionId is required'
        };
      }

      try {
        const projectPath = url.searchParams.get('path') || initialPath;
        const { SessionClusteringService } = await import('../session-clustering-service.js');
        const clusteringService = new SessionClusteringService(projectPath);

        // Use file-based session state (shared with CLI hook.ts)
        const sessionStateDir = join(homedir(), '.claude', '.ccw-sessions');
        const sessionStateFile = join(sessionStateDir, `session-${sessionId}.json`);
        
        let existingState: { firstLoad: string; loadCount: number; lastPrompt?: string } | null = null;
        if (existsSync(sessionStateFile)) {
          try {
            existingState = JSON.parse(readFileSync(sessionStateFile, 'utf-8'));
          } catch {
            existingState = null;
          }
        }
        
        const isFirstPrompt = !existingState;

        // Update session state (file-based)
        const newState = isFirstPrompt
          ? { firstLoad: new Date().toISOString(), loadCount: 1, lastPrompt: prompt }
          : { ...existingState!, loadCount: existingState!.loadCount + 1, lastPrompt: prompt };
        
        if (!existsSync(sessionStateDir)) {
          mkdirSync(sessionStateDir, { recursive: true });
        }
        writeFileSync(sessionStateFile, JSON.stringify(newState, null, 2));

        // Determine which type of context to return
        let contextType: 'session-start' | 'context';
        let content: string;

        if (isFirstPrompt) {
          // First prompt: return session overview with clusters
          contextType = 'session-start';
          content = await clusteringService.getProgressiveIndex({
            type: 'session-start',
            sessionId
          });
        } else if (prompt && prompt.trim().length > 0) {
          // Subsequent prompts with content: return intent-matched sessions
          contextType = 'context';
          content = await clusteringService.getProgressiveIndex({
            type: 'context',
            sessionId,
            prompt
          });
        } else {
          // Subsequent prompts without content: return minimal context
          contextType = 'context';
          content = ''; // No context needed for empty prompts
        }

        return {
          success: true,
          type: contextType,
          isFirstPrompt,
          loadCount: newState.loadCount,
          content,
          sessionId
        };
      } catch (error) {
        console.error('[Hooks] Failed to generate session context:', error);
        return {
          success: true,
          content: '',
          sessionId,
          error: (error as Error).message
        };
      }
    });
    return true;
  }

  // API: Get hooks configuration
  if (pathname === '/api/hooks' && req.method === 'GET') {
    const projectPathParam = url.searchParams.get('path');
    const hooksData = getHooksConfig(projectPathParam || initialPath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(hooksData));
    return true;
  }

  // API: Save hook
  if (pathname === '/api/hooks' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (typeof body !== 'object' || body === null) {
        return { error: 'Invalid request body', status: 400 };
      }

      const { projectPath, scope, event, hookData } = body as {
        projectPath?: unknown;
        scope?: unknown;
        event?: unknown;
        hookData?: unknown;
      };

      if ((scope !== 'global' && scope !== 'project') || typeof event !== 'string' || typeof hookData !== 'object' || hookData === null) {
        return { error: 'scope, event, and hookData are required', status: 400 };
      }

      const resolvedProjectPath = typeof projectPath === 'string' && projectPath.trim().length > 0 ? projectPath : initialPath;
      return saveHookToSettings(resolvedProjectPath, scope, event, hookData as Record<string, unknown>);
    });
    return true;
  }

  // API: Delete hook
  if (pathname === '/api/hooks' && req.method === 'DELETE') {
    handlePostRequest(req, res, async (body) => {
      if (typeof body !== 'object' || body === null) {
        return { error: 'Invalid request body', status: 400 };
      }

      const { projectPath, scope, event, hookIndex } = body as {
        projectPath?: unknown;
        scope?: unknown;
        event?: unknown;
        hookIndex?: unknown;
      };

      if ((scope !== 'global' && scope !== 'project') || typeof event !== 'string' || typeof hookIndex !== 'number') {
        return { error: 'scope, event, and hookIndex are required', status: 400 };
      }

      const resolvedProjectPath = typeof projectPath === 'string' && projectPath.trim().length > 0 ? projectPath : initialPath;
      return deleteHookFromSettings(resolvedProjectPath, scope, event, hookIndex);
    });
    return true;
  }

  return false;
}
