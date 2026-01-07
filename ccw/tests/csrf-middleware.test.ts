/**
 * Unit tests for CSRF middleware (ccw/dist/core/auth/csrf-middleware.js)
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

type MockResponse = {
  status: number | null;
  headers: Record<string, unknown>;
  body: string;
  writeHead: (status: number, headers?: Record<string, string>) => void;
  setHeader: (name: string, value: unknown) => void;
  getHeader: (name: string) => unknown;
  end: (body?: string) => void;
};

function createMockRes(): MockResponse {
  const headers: Record<string, unknown> = {};
  const response: MockResponse = {
    status: null,
    headers,
    body: '',
    writeHead: (status: number, nextHeaders?: Record<string, string>) => {
      response.status = status;
      if (nextHeaders) {
        for (const [k, v] of Object.entries(nextHeaders)) {
          headers[k.toLowerCase()] = v;
        }
      }
    },
    setHeader: (name: string, value: unknown) => {
      headers[name.toLowerCase()] = value;
    },
    getHeader: (name: string) => headers[name.toLowerCase()],
    end: (body?: string) => {
      response.body = body ? String(body) : '';
    },
  };
  return response;
}

const middlewareUrl = new URL('../dist/core/auth/csrf-middleware.js', import.meta.url);

const managerUrl = new URL('../dist/core/auth/csrf-manager.js', import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let middleware: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let csrfManager: any;

const ORIGINAL_ENV = { ...process.env };

describe('csrf middleware', async () => {
  middleware = await import(middlewareUrl.href);
  csrfManager = await import(managerUrl.href);

  afterEach(() => {
    csrfManager.resetCsrfTokenManager();
    process.env = { ...ORIGINAL_ENV };
  });

  it('allows non-state-changing requests without tokens', async () => {
    const req: any = { method: 'GET', headers: {} };
    const res = createMockRes();

    const ok = await middleware.csrfValidation({ pathname: '/api/health', req, res });
    assert.equal(ok, true);
    assert.equal(res.status, null);
  });

  it('rejects state-changing requests when tokens are missing', async () => {
    const req = new PassThrough() as any;
    req.method = 'POST';
    req.headers = {};
    const res = createMockRes();

    const promise = middleware.csrfValidation({ pathname: '/api/remove-recent-path', req, res });
    queueMicrotask(() => {
      req.end();
    });
    const ok = await promise;
    assert.equal(ok, false);
    assert.equal(res.status, 403);
    assert.ok(res.body.includes('CSRF validation failed'));
  });

  it('accepts valid CSRF token from cookies and rotates token', async () => {
    const sessionId = 'session-1';
    const manager = csrfManager.getCsrfTokenManager({ cleanupIntervalMs: 0 });
    const token = manager.generateToken(sessionId);

    const req: any = { method: 'POST', headers: { cookie: `ccw_session_id=${sessionId}; XSRF-TOKEN=${token}` } };
    const res = createMockRes();

    const ok = await middleware.csrfValidation({ pathname: '/api/remove-recent-path', req, res });
    assert.equal(ok, true);

    const rotated = res.headers['x-csrf-token'];
    assert.ok(typeof rotated === 'string');
    assert.notEqual(rotated, token);
    assert.match(rotated, /^[a-f0-9]{64}$/);

    const setCookie = res.headers['set-cookie'];
    const cookieString = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    assert.ok(cookieString.includes('XSRF-TOKEN='));
    assert.ok(cookieString.includes(String(rotated)));
  });

  it('rejects token reuse', async () => {
    const sessionId = 'session-1';
    const manager = csrfManager.getCsrfTokenManager({ cleanupIntervalMs: 0 });
    const token = manager.generateToken(sessionId);

    const req1: any = { method: 'POST', headers: { cookie: `ccw_session_id=${sessionId}; XSRF-TOKEN=${token}` } };
    const res1 = createMockRes();
    assert.equal(await middleware.csrfValidation({ pathname: '/api/remove-recent-path', req: req1, res: res1 }), true);

    const req2: any = { method: 'POST', headers: { cookie: `ccw_session_id=${sessionId}; XSRF-TOKEN=${token}` } };
    const res2 = createMockRes();
    assert.equal(await middleware.csrfValidation({ pathname: '/api/remove-recent-path', req: req2, res: res2 }), false);
    assert.equal(res2.status, 403);
  });

  it('accepts valid CSRF token from JSON body when cookies are absent', async () => {
    const sessionId = 'session-1';
    const manager = csrfManager.getCsrfTokenManager({ cleanupIntervalMs: 0 });
    const token = manager.generateToken(sessionId);

    const req = new PassThrough() as any;
    req.method = 'POST';
    req.headers = { cookie: `ccw_session_id=${sessionId}` };

    const res = createMockRes();
    const promise = middleware.csrfValidation({ pathname: '/api/remove-recent-path', req, res });
    queueMicrotask(() => {
      req.end(JSON.stringify({ csrfToken: token }));
    });

    const ok = await promise;
    assert.equal(ok, true);
  });

  it('skips CSRF validation when CCW_DISABLE_CSRF is enabled', async () => {
    process.env.CCW_DISABLE_CSRF = 'true';
    const req: any = { method: 'POST', headers: {} };
    const res = createMockRes();

    const ok = await middleware.csrfValidation({ pathname: '/api/remove-recent-path', req, res });
    assert.equal(ok, true);
  });
});
