/**
 * Unit tests for CsrfTokenManager (ccw/dist/core/auth/csrf-manager.js).
 *
 * Notes:
 * - Targets the runtime implementation shipped in `ccw/dist`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const csrfManagerUrl = new URL('../dist/core/auth/csrf-manager.js', import.meta.url).href;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

describe('CsrfTokenManager', async () => {
  mod = await import(csrfManagerUrl);

  it('generateToken produces a 64-character hex token', () => {
    const manager = new mod.CsrfTokenManager({ cleanupIntervalMs: 0 });
    const token = manager.generateToken('session-1');

    assert.match(token, /^[a-f0-9]{64}$/);
    manager.dispose();
  });

  it('validateToken accepts correct session token once', () => {
    const manager = new mod.CsrfTokenManager({ cleanupIntervalMs: 0 });
    const token = manager.generateToken('session-1');

    assert.equal(manager.validateToken(token, 'session-1'), true);
    assert.equal(manager.validateToken(token, 'session-1'), false);
    manager.dispose();
  });

  it('validateToken rejects expired tokens', () => {
    const manager = new mod.CsrfTokenManager({ tokenTtlMs: -1000, cleanupIntervalMs: 0 });
    const token = manager.generateToken('session-1');

    assert.equal(manager.validateToken(token, 'session-1'), false);
    assert.equal(manager.getActiveTokenCount(), 0);
    manager.dispose();
  });

  it('cleanupExpiredTokens removes expired entries', () => {
    const manager = new mod.CsrfTokenManager({ tokenTtlMs: 10, cleanupIntervalMs: 0 });
    manager.generateToken('session-1');

    const removed = manager.cleanupExpiredTokens(Date.now() + 100);
    assert.equal(removed, 1);
    assert.equal(manager.getActiveTokenCount(), 0);
    manager.dispose();
  });

  it('session association prevents cross-session token reuse', () => {
    const manager = new mod.CsrfTokenManager({ cleanupIntervalMs: 0 });
    const token = manager.generateToken('session-1');

    assert.equal(manager.validateToken(token, 'session-2'), false);
    assert.equal(manager.validateToken(token, 'session-1'), true);
    manager.dispose();
  });
});

