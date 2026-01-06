/**
 * Integration tests for server authentication flow.
 *
 * Verifies:
 * - API routes require auth token
 * - /api/auth/token returns token + cookie for localhost requests
 * - Authorization header and cookie auth both work
 */

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type HttpResult = {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
};

function httpRequest(options: http.RequestOptions, body?: string, timeout = 10000): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

const ORIGINAL_ENV = { ...process.env };
const serverUrl = new URL('../dist/core/server.js', import.meta.url);
serverUrl.searchParams.set('t', String(Date.now()));

describe('server authentication integration', async () => {
  let server: http.Server;
  let port: number;
  let projectRoot: string;
  let ccwHome: string;

  before(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-auth-project-'));
    ccwHome = mkdtempSync(join(tmpdir(), 'ccw-auth-home-'));

    process.env = { ...ORIGINAL_ENV, CCW_DATA_DIR: ccwHome };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serverMod: any = await import(serverUrl.href);

    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});

    server = await serverMod.startServer({ initialPath: projectRoot, port: 0 });
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
    assert.ok(port > 0, 'Server should start on a valid port');
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    mock.restoreAll();
    process.env = ORIGINAL_ENV;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(ccwHome, { recursive: true, force: true });
  });

  it('rejects unauthenticated API requests with 401', async () => {
    const response = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
    });

    assert.equal(response.status, 401);
    assert.ok(response.body.includes('Unauthorized'));
  });

  it('returns auth token and cookie for localhost requests', async () => {
    const response = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/token',
      method: 'GET',
    });

    assert.equal(response.status, 200);
    const data = JSON.parse(response.body) as { token: string; expiresAt: string };
    assert.ok(data.token);
    assert.ok(data.expiresAt);

    const setCookie = response.headers['set-cookie'];
    assert.ok(setCookie && setCookie.length > 0, 'Expected Set-Cookie header');
  });

  it('accepts Authorization header on API routes', async () => {
    const tokenResponse = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/token',
      method: 'GET',
    });

    const { token } = JSON.parse(tokenResponse.body) as { token: string };
    const response = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    assert.equal(response.status, 200);
  });

  it('accepts cookie auth on API routes', async () => {
    const tokenResponse = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/token',
      method: 'GET',
    });

    const { token } = JSON.parse(tokenResponse.body) as { token: string };
    const response = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
      headers: {
        Cookie: `auth_token=${encodeURIComponent(token)}`,
      },
    });

    assert.equal(response.status, 200);
  });
});

