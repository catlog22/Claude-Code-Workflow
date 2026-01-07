/**
 * Unit tests for auth routes (ccw/dist/core/routes/auth-routes.js).
 */

import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

type JsonResponse = {
  status: number;
  json: any;
  text: string;
  headers: http.IncomingHttpHeaders;
};

async function requestJson(baseUrl: string, method: string, reqPath: string, headers?: Record<string, string>): Promise<JsonResponse> {
  const url = new URL(reqPath, baseUrl);

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: { Accept: 'application/json', ...(headers ?? {}) },
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
          resolve({ status: res.statusCode || 0, json, text: responseBody, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function cookiePairsFromSetCookie(setCookie: string | string[] | undefined): string {
  if (!setCookie) return '';
  const items = Array.isArray(setCookie) ? setCookie : [setCookie];
  const pairs: string[] = [];
  for (const item of items) {
    const pair = item.split(';')[0]?.trim();
    if (pair) pairs.push(pair);
  }
  return pairs.join('; ');
}

async function createServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    const ctx = {
      pathname,
      url,
      req,
      res,
      initialPath: process.cwd(),
      handlePostRequest() {},
      broadcastToClients() {},
    };

    try {
      const handled = await authRoutes.handleAuthRoutes(ctx);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected server to listen on a TCP port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let authRoutes: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let csrfManager: any;

describe('auth routes: csrf-token endpoint', async () => {
  before(async () => {
    authRoutes = await import(new URL('../dist/core/routes/auth-routes.js', import.meta.url).href);
    csrfManager = await import(new URL('../dist/core/auth/csrf-manager.js', import.meta.url).href);
  });

  afterEach(() => {
    csrfManager.resetCsrfTokenManager();
  });

  it('GET /api/csrf-token returns token in body, header, and cookie', async () => {
    const { server, baseUrl } = await createServer();
    try {
      const res = await requestJson(baseUrl, 'GET', '/api/csrf-token');
      assert.equal(res.status, 200);
      assert.ok(res.json?.csrfToken);

      const token = String(res.json.csrfToken);
      assert.match(token, /^[a-f0-9]{64}$/);
      assert.equal(res.headers['x-csrf-token'], token);

      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie || '');
      assert.ok(cookies.includes('XSRF-TOKEN='));
      assert.ok(cookies.includes('HttpOnly'));
      assert.ok(cookies.includes('SameSite=Strict'));
      assert.ok(cookies.includes(token));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('GET /api/csrf-token returns a new token per request (same session)', async () => {
    const { server, baseUrl } = await createServer();
    try {
      const first = await requestJson(baseUrl, 'GET', '/api/csrf-token');
      assert.equal(first.status, 200);
      const cookieHeader = cookiePairsFromSetCookie(first.headers['set-cookie']);
      assert.ok(cookieHeader.includes('ccw_session_id='));

      const second = await requestJson(baseUrl, 'GET', '/api/csrf-token', { Cookie: cookieHeader });
      assert.equal(second.status, 200);

      assert.notEqual(first.json.csrfToken, second.json.csrfToken);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
