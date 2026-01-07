/**
 * CodexLens Routes Module
 * Handles all CodexLens-related API endpoints.
 */

import type { RouteContext } from './types.js';
import { handleCodexLensConfigRoutes } from './codexlens/config-handlers.js';
import { handleCodexLensIndexRoutes } from './codexlens/index-handlers.js';
import { handleCodexLensSemanticRoutes } from './codexlens/semantic-handlers.js';
import { handleCodexLensWatcherRoutes } from './codexlens/watcher-handlers.js';

/**
 * Handle CodexLens routes
 * @returns true if route was handled, false otherwise
 */
export async function handleCodexLensRoutes(ctx: RouteContext): Promise<boolean> {
  if (await handleCodexLensIndexRoutes(ctx)) return true;
  if (await handleCodexLensConfigRoutes(ctx)) return true;
  if (await handleCodexLensSemanticRoutes(ctx)) return true;
  if (await handleCodexLensWatcherRoutes(ctx)) return true;
  return false;
}

