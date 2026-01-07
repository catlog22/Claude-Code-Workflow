/**
 * Integration tests for LiteLLM API routes (providers + model discovery).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Calls route handler directly (no HTTP server required).
 * - Uses temporary CCW_DATA_DIR to isolate ~/.ccw config writes.
 */

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CCW_HOME = mkdtempSync(join(tmpdir(), 'ccw-litellm-api-home-'));
const PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'ccw-litellm-api-project-'));

const litellmApiRoutesUrl = new URL('../../dist/core/routes/litellm-api-routes.js', import.meta.url);
litellmApiRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

const originalEnv = { CCW_DATA_DIR: process.env.CCW_DATA_DIR };

async function callLiteLLMApi(
  initialPath: string,
  method: string,
  path: string,
  body?: any,
): Promise<{ handled: boolean; status: number; json: any; broadcasts: any[] }> {
  const url = new URL(path, 'http://localhost');
  let status = 0;
  let text = '';
  const broadcasts: any[] = [];

  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk?: any) {
      text = chunk === undefined ? '' : String(chunk);
    },
  };

  const handlePostRequest = async (_req: any, _res: any, handler: (parsed: any) => Promise<any>) => {
    const result = await handler(body ?? {});
    const errorValue = result && typeof result === 'object' ? (result as any).error : undefined;
    const statusValue = result && typeof result === 'object' ? (result as any).status : undefined;

    if (typeof errorValue === 'string' && errorValue.length > 0) {
      res.writeHead(typeof statusValue === 'number' ? statusValue : 500);
      res.end(JSON.stringify({ error: errorValue }));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify(result));
  };

  const handled = await mod.handleLiteLLMApiRoutes({
    pathname: url.pathname,
    url,
    req: { method },
    res,
    initialPath,
    handlePostRequest,
    broadcastToClients(data: unknown) {
      broadcasts.push(data);
    },
  });

  return { handled, status, json: text ? JSON.parse(text) : null, broadcasts };
}

describe('litellm-api routes integration', async () => {
  before(async () => {
    process.env.CCW_DATA_DIR = CCW_HOME;
    mock.method(console, 'log', () => {});
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});
    mod = await import(litellmApiRoutesUrl.href);
  });

  after(() => {
    mock.restoreAll();
    process.env.CCW_DATA_DIR = originalEnv.CCW_DATA_DIR;
    rmSync(CCW_HOME, { recursive: true, force: true });
    rmSync(PROJECT_ROOT, { recursive: true, force: true });
  });

  it('GET /api/litellm-api/models/openai returns static model list', async () => {
    const res = await callLiteLLMApi(PROJECT_ROOT, 'GET', '/api/litellm-api/models/openai');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(res.json.providerType, 'openai');
    assert.equal(Array.isArray(res.json.models), true);
    assert.ok(res.json.models.length > 0);
  });

  it('GET /api/litellm-api/providers returns default empty config', async () => {
    const res = await callLiteLLMApi(PROJECT_ROOT, 'GET', '/api/litellm-api/providers');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.json.providers), true);
    assert.equal(typeof res.json.count, 'number');
  });

  it('POST /api/litellm-api/providers validates required fields', async () => {
    const res = await callLiteLLMApi(PROJECT_ROOT, 'POST', '/api/litellm-api/providers', { name: 'x' });
    assert.equal(res.handled, true);
    assert.equal(res.status, 400);
    assert.ok(String(res.json.error).includes('required'));
    assert.equal(res.broadcasts.length, 0);
  });
});

