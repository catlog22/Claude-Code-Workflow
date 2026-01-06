/**
 * Integration tests for skills routes path validation.
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Focuses on access control for projectPath and traversal attempts.
 */

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'ccw-skills-routes-project-'));
const OUTSIDE_ROOT = mkdtempSync(join(tmpdir(), 'ccw-skills-routes-outside-'));

const skillsRoutesUrl = new URL('../dist/core/routes/skills-routes.js', import.meta.url);
skillsRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

type JsonResponse = { status: number; json: any; text: string };

async function requestJson(baseUrl: string, method: string, path: string, body?: unknown): Promise<JsonResponse> {
  const url = new URL(path, baseUrl);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          let json: any = null;
          try {
            json = responseBody ? JSON.parse(responseBody) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, json, text: responseBody });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function handlePostRequest(req: http.IncomingMessage, res: http.ServerResponse, handler: (body: unknown) => Promise<any>): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', async () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      const result = await handler(parsed);

      if (result?.error) {
        res.writeHead(result.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });
}

async function createServer(initialPath: string): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    const ctx = {
      pathname,
      url,
      req,
      res,
      initialPath,
      handlePostRequest,
      broadcastToClients() {},
    };

    try {
      const handled = await mod.handleSkillsRoutes(ctx);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('skills routes path validation', async () => {
  before(async () => {
    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});
    mod = await import(skillsRoutesUrl.href);
  });

  after(() => {
    mock.restoreAll();
    rmSync(PROJECT_ROOT, { recursive: true, force: true });
    rmSync(OUTSIDE_ROOT, { recursive: true, force: true });
  });

  it('GET /api/skills rejects projectPath outside initialPath', async () => {
    const { server, baseUrl } = await createServer(PROJECT_ROOT);
    try {
      const res = await requestJson(baseUrl, 'GET', `/api/skills?path=${encodeURIComponent(OUTSIDE_ROOT)}`);
      assert.equal(res.status, 403);
      assert.equal(res.json.error, 'Access denied');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('GET /api/skills/:name/dir rejects traversal via subpath', async () => {
    const { server, baseUrl } = await createServer(PROJECT_ROOT);
    try {
      const subpath = encodeURIComponent('../..');
      const pathParam = encodeURIComponent(PROJECT_ROOT);
      const res = await requestJson(baseUrl, 'GET', `/api/skills/demo/dir?subpath=${subpath}&path=${pathParam}&location=project`);
      assert.equal(res.status, 403);
      assert.equal(res.json.error, 'Access denied');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('GET /api/skills/:name rejects traversal via path segment', async () => {
    const { server, baseUrl } = await createServer(PROJECT_ROOT);
    try {
      const res = await requestJson(baseUrl, 'GET', '/api/skills/../../secret?location=project');
      assert.equal(res.status, 403);
      assert.equal(res.json.error, 'Access denied');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('GET /api/skills/:name/dir rejects unsafe skill names', async () => {
    const { server, baseUrl } = await createServer(PROJECT_ROOT);
    try {
      const pathParam = encodeURIComponent(PROJECT_ROOT);
      const res = await requestJson(baseUrl, 'GET', `/api/skills/${encodeURIComponent('bad..name')}/dir?path=${pathParam}&location=project`);
      assert.equal(res.status, 400);
      assert.ok(String(res.json.error).includes('Invalid skill name'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
