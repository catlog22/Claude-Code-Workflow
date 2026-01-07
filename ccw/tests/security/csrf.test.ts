/**
 * Security regression tests for CSRF protection (DSC-006).
 *
 * Verifies:
 * - State-changing API routes require a valid CSRF token (cookie/header/body)
 * - Tokens are single-use and session-bound
 * - CORS rejects non-localhost origins (browser-enforced via mismatched Allow-Origin)
 * - Development bypass flag disables CSRF validation
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

function updateCookieJar(jar: Record<string, string>, setCookie: string | string[] | undefined): void {
  if (!setCookie) return;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const cookie of cookies) {
    const pair = cookie.split(';')[0]?.trim();
    if (!pair) continue;
    const [name, ...valueParts] = pair.split('=');
    jar[name] = valueParts.join('=');
  }
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function cloneJar(jar: Record<string, string>): Record<string, string> {
  return { ...jar };
}

async function getDashboardSession(port: number): Promise<{ jar: Record<string, string>; csrfHeader: string | null }> {
  const jar: Record<string, string> = {};
  const res = await httpRequest({ hostname: '127.0.0.1', port, path: '/', method: 'GET' });
  updateCookieJar(jar, res.headers['set-cookie']);
  return { jar, csrfHeader: typeof res.headers['x-csrf-token'] === 'string' ? res.headers['x-csrf-token'] : null };
}

async function postNotify(port: number, jar: Record<string, string>, extraHeaders?: Record<string, string>, body?: unknown): Promise<HttpResult> {
  const payload = body === undefined ? { type: 'REFRESH_REQUIRED', scope: 'all' } : body;
  const encoded = JSON.stringify(payload);
  return httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/system/notify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {}),
        ...(extraHeaders ?? {}),
      },
    },
    encoded,
  );
}

const ORIGINAL_ENV = { ...process.env };
const serverUrl = new URL('../../dist/core/server.js', import.meta.url).href;
const csrfManagerUrl = new URL('../../dist/core/auth/csrf-manager.js', import.meta.url).href;

describe('security: CSRF protection', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serverMod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let csrfMod: any;

  let server: http.Server;
  let port: number;
  let projectRoot: string;
  let ccwHome: string;

  before(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-csrf-project-'));
    ccwHome = mkdtempSync(join(tmpdir(), 'ccw-csrf-home-'));

    process.env = { ...ORIGINAL_ENV, CCW_DATA_DIR: ccwHome };

    serverMod = await import(serverUrl);
    csrfMod = await import(csrfManagerUrl);

    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});

    server = await serverMod.startServer({ initialPath: projectRoot, port: 0 });
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
    assert.ok(port > 0, 'Server should start on a valid port');
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    mock.restoreAll();
    process.env = ORIGINAL_ENV;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(ccwHome, { recursive: true, force: true });
  });

  it('blocks POST requests without CSRF token', async () => {
    const { jar } = await getDashboardSession(port);
    delete jar['XSRF-TOKEN'];

    const res = await postNotify(port, jar);
    assert.equal(res.status, 403);
    assert.ok(res.body.includes('CSRF validation failed'));
  });

  it('blocks POST requests with forged CSRF token', async () => {
    const { jar } = await getDashboardSession(port);
    jar['XSRF-TOKEN'] = 'forged-token';

    const res = await postNotify(port, jar);
    assert.equal(res.status, 403);
  });

  it('blocks expired CSRF tokens', async () => {
    csrfMod.resetCsrfTokenManager();
    csrfMod.getCsrfTokenManager({ tokenTtlMs: 1, cleanupIntervalMs: 0 });

    const { jar } = await getDashboardSession(port);
    await new Promise(resolve => setTimeout(resolve, 10));

    const res = await postNotify(port, jar);
    assert.equal(res.status, 403);

    csrfMod.resetCsrfTokenManager();
  });

  it('blocks token reuse (single-use tokens)', async () => {
    const { jar } = await getDashboardSession(port);
    const oldToken = jar['XSRF-TOKEN'];

    const first = await postNotify(port, jar);
    assert.equal(first.status, 200);
    updateCookieJar(jar, first.headers['set-cookie']);

    // Try again using the old token explicitly (should fail).
    const reuseJar = cloneJar(jar);
    reuseJar['XSRF-TOKEN'] = oldToken;
    const secondUse = await postNotify(port, reuseJar);
    assert.equal(secondUse.status, 403);
  });

  it('blocks CSRF token theft across sessions', async () => {
    const sessionA = await getDashboardSession(port);
    const sessionB = await getDashboardSession(port);

    const jar = cloneJar(sessionB.jar);
    jar['XSRF-TOKEN'] = sessionA.jar['XSRF-TOKEN'];

    const res = await postNotify(port, jar);
    assert.equal(res.status, 403);
  });

  it('does not require CSRF on GET requests', async () => {
    const { jar } = await getDashboardSession(port);
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
      headers: { Cookie: cookieHeader(jar) },
    });
    assert.equal(res.status, 200);
  });

  it('accepts CSRF token provided via cookie (legitimate flow)', async () => {
    const { jar } = await getDashboardSession(port);
    const res = await postNotify(port, jar);
    assert.equal(res.status, 200);
  });

  it('accepts CSRF token provided via header', async () => {
    const { jar } = await getDashboardSession(port);
    const token = jar['XSRF-TOKEN'];
    delete jar['XSRF-TOKEN'];

    const res = await postNotify(port, jar, { 'X-CSRF-Token': token });
    assert.equal(res.status, 200);
  });

  it('accepts CSRF token provided via request body', async () => {
    const { jar } = await getDashboardSession(port);
    const token = jar['XSRF-TOKEN'];
    delete jar['XSRF-TOKEN'];

    const res = await postNotify(port, jar, undefined, { type: 'REFRESH_REQUIRED', scope: 'all', csrfToken: token });
    assert.equal(res.status, 200);
  });

  it('rotates CSRF token after successful POST', async () => {
    const { jar } = await getDashboardSession(port);
    const firstToken = jar['XSRF-TOKEN'];

    const res = await postNotify(port, jar);
    assert.equal(res.status, 200);
    updateCookieJar(jar, res.headers['set-cookie']);

    assert.notEqual(jar['XSRF-TOKEN'], firstToken);
  });

  it('allows localhost origins and rejects external origins (CORS)', async () => {
    const allowedOrigin = `http://localhost:${port}`;
    const allowed = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
      headers: { Origin: allowedOrigin },
    });
    assert.equal(allowed.headers['access-control-allow-origin'], allowedOrigin);
    assert.equal(allowed.headers['vary'], 'Origin');

    const evilOrigin = 'http://evil.com';
    const denied = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
      headers: { Origin: evilOrigin },
    });
    assert.notEqual(denied.headers['access-control-allow-origin'], evilOrigin);
    assert.equal(denied.headers['access-control-allow-origin'], `http://localhost:${port}`);
  });

  it('bypasses CSRF validation when CCW_DISABLE_CSRF=true', async () => {
    process.env.CCW_DISABLE_CSRF = 'true';
    const { jar } = await getDashboardSession(port);
    delete jar['XSRF-TOKEN'];

    const res = await postNotify(port, jar);
    assert.equal(res.status, 200);

    delete process.env.CCW_DISABLE_CSRF;
  });

  it('skips CSRF validation for Authorization header auth', async () => {
    const tokenRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/token',
      method: 'GET',
    });

    const parsed = JSON.parse(tokenRes.body) as { token: string };
    assert.ok(parsed.token);

    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/system/notify',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${parsed.token}`,
          'Content-Type': 'application/json',
        },
      },
      JSON.stringify({ type: 'REFRESH_REQUIRED', scope: 'all' }),
    );

    assert.equal(res.status, 200);
  });
});
