/**
 * Unit tests for auth middleware (ccw/dist/core/auth/middleware.js)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const middlewareUrl = new URL('../dist/core/auth/middleware.js', import.meta.url).href;
const tokenManagerUrl = new URL('../dist/core/auth/token-manager.js', import.meta.url).href;

type MockResponse = {
  status: number | null;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers?: Record<string, string>) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

function createMockRes(): MockResponse {
  const headers: Record<string, string> = {};
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
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    end: (body?: string) => {
      response.body = body ? String(body) : '';
    },
  };
  return response;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let middleware: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenMod: any;

describe('auth middleware', async () => {
  middleware = await import(middlewareUrl);
  tokenMod = await import(tokenManagerUrl);

  it('rejects requests without tokens', () => {
    const tokenManager = new tokenMod.TokenManager();
    const secretKey = 'secret';

    const req: any = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = createMockRes();

    const ok = middleware.authMiddleware({
      pathname: '/api/health',
      req,
      res,
      tokenManager,
      secretKey,
      unauthenticatedPaths: new Set(['/api/auth/token']),
    });

    assert.equal(ok, false);
    assert.equal(res.status, 401);
    assert.ok(res.body.includes('Unauthorized'));
  });

  it('accepts Authorization: Bearer tokens', () => {
    const tokenManager = new tokenMod.TokenManager();
    const secretKey = 'secret';
    const { token } = tokenManager.generateToken(secretKey);

    const req: any = { headers: { authorization: `Bearer ${token}` }, socket: { remoteAddress: '127.0.0.1' } };
    const res = createMockRes();

    const ok = middleware.authMiddleware({
      pathname: '/api/health',
      req,
      res,
      tokenManager,
      secretKey,
    });

    assert.equal(ok, true);
    assert.equal(req.authenticated, true);
  });

  it('accepts auth_token cookies', () => {
    const tokenManager = new tokenMod.TokenManager();
    const secretKey = 'secret';
    const { token } = tokenManager.generateToken(secretKey);

    const req: any = { headers: { cookie: `auth_token=${encodeURIComponent(token)}` }, socket: { remoteAddress: '127.0.0.1' } };
    const res = createMockRes();

    const ok = middleware.authMiddleware({
      pathname: '/api/health',
      req,
      res,
      tokenManager,
      secretKey,
    });

    assert.equal(ok, true);
  });

  it('isLocalhostRequest detects loopback addresses', () => {
    assert.equal(middleware.isLocalhostRequest({ socket: { remoteAddress: '127.0.0.1' } } as any), true);
    assert.equal(middleware.isLocalhostRequest({ socket: { remoteAddress: '::1' } } as any), true);
    assert.equal(middleware.isLocalhostRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } } as any), true);
    assert.equal(middleware.isLocalhostRequest({ socket: { remoteAddress: '10.0.0.5' } } as any), false);
  });
});
