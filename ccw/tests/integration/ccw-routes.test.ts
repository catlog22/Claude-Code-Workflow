/**
 * Integration tests for CCW routes (installations/tools).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Exercises real HTTP request/response flow via a minimal test server.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const ccwRoutesUrl = new URL('../../dist/core/routes/ccw-routes.js', import.meta.url);
ccwRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

type JsonResponse = { status: number; json: any; text: string };

async function requestJson(baseUrl: string, method: string, path: string): Promise<JsonResponse> {
  const url = new URL(path, baseUrl);

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          let json: any = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, json, text: body });
        });
      },
    );
    req.on('error', reject);
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

describe('ccw routes integration', async () => {
  let server: http.Server | null = null;
  let baseUrl = '';

  before(async () => {
    mod = await import(ccwRoutesUrl.href);

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;

      const ctx = {
        pathname,
        url,
        req,
        res,
        initialPath: process.cwd(),
        handlePostRequest,
        broadcastToClients() {},
      };

      try {
        const handled = await mod.handleCcwRoutes(ctx);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        }
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, () => resolve());
    });

    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it('GET /api/ccw/installations returns installation manifests', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/ccw/installations');
    assert.equal(res.status, 200);
    assert.ok(res.json);
    assert.equal(Array.isArray(res.json.installations), true);
  });

  it('GET /api/ccw/tools returns available tools', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/ccw/tools');
    assert.equal(res.status, 200);
    assert.ok(res.json);
    assert.equal(Array.isArray(res.json.tools), true);
  });

  it('GET /api/ccw/upgrade returns 404 (POST-only endpoint)', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/ccw/upgrade');
    assert.equal(res.status, 404);
    assert.ok(res.json?.error);
  });

  it('returns 404 for unknown /api/ccw/* routes', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/ccw/nope');
    assert.equal(res.status, 404);
    assert.ok(res.json?.error);
  });
});

