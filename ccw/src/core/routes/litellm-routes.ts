/**
 * LiteLLM Routes Module
 * Handles all LiteLLM-related API endpoints
 */
import type { ChatMessage } from '../../tools/litellm-client.js';
import { getLiteLLMClient, getLiteLLMStatus, checkLiteLLMAvailable } from '../../tools/litellm-client.js';
import type { RouteContext } from './types.js';

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const role = candidate.role;
  const content = candidate.content;
  if (role !== 'system' && role !== 'user' && role !== 'assistant') return false;
  return typeof content === 'string';
}

/**
 * Handle LiteLLM routes
 * @returns true if route was handled, false otherwise
 */
export async function handleLiteLLMRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest } = ctx;

  // API: LiteLLM Status - Check availability and version
  if (pathname === '/api/litellm/status') {
    try {
      const status = await getLiteLLMStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: LiteLLM Config - Get configuration
  if (pathname === '/api/litellm/config' && req.method === 'GET') {
    try {
      const client = getLiteLLMClient();
      const config = await client.getConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return true;
  }

  // API: LiteLLM Embed - Generate embeddings
  if (pathname === '/api/litellm/embed' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (typeof body !== 'object' || body === null) {
        return { error: 'Invalid request body', status: 400 };
      }

      const { texts, model = 'default' } = body as { texts?: unknown; model?: unknown };

      if (!Array.isArray(texts) || texts.some((t) => typeof t !== 'string')) {
        return { error: 'texts array is required', status: 400 };
      }

      if (texts.length === 0) {
        return { error: 'texts array cannot be empty', status: 400 };
      }

      try {
        const client = getLiteLLMClient();
        const result = await client.embed(texts, typeof model === 'string' ? model : 'default');
        return { success: true, ...result };
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  // API: LiteLLM Chat - Chat with LLM
  if (pathname === '/api/litellm/chat' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (typeof body !== 'object' || body === null) {
        return { error: 'Invalid request body', status: 400 };
      }

      const { message, messages, model = 'default' } = body as { message?: unknown; messages?: unknown; model?: unknown };

      // Support both single message and messages array
      if (typeof message !== 'string' && (!Array.isArray(messages) || !messages.every(isChatMessage))) {
        return { error: 'message or messages array is required', status: 400 };
      }

      try {
        const client = getLiteLLMClient();

        if (Array.isArray(messages) && messages.every(isChatMessage)) {
          // Multi-turn chat
          const result = await client.chatMessages(messages, typeof model === 'string' ? model : 'default');
          return { success: true, ...result };
        } else {
          // Single message chat
          const resolvedModel = typeof model === 'string' ? model : 'default';
          const content = await client.chat(message as string, resolvedModel);
          return { success: true, content, model: resolvedModel };
        }
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err), status: 500 };
      }
    });
    return true;
  }

  return false;
}
