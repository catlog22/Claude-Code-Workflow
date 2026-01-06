/**
 * Unit tests for TokenManager authentication helper.
 *
 * Notes:
 * - Targets the runtime implementation shipped in `ccw/dist`.
 * - Uses in-memory fs stubs (no real file IO).
 */

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');

const ORIGINAL_ENV = { ...process.env };
const TEST_CCW_HOME = path.join(process.cwd(), '.tmp-ccw-auth-home');
process.env.CCW_DATA_DIR = TEST_CCW_HOME;

type FsState = {
  existing: Set<string>;
  files: Map<string, string>;
  mkdirCalls: Array<{ path: string; options: unknown }>;
  writeCalls: Array<{ path: string; data: string; options: unknown }>;
  chmodCalls: Array<{ path: string; mode: number }>;
};

const state: FsState = {
  existing: new Set(),
  files: new Map(),
  mkdirCalls: [],
  writeCalls: [],
  chmodCalls: [],
};

function key(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

function setExists(filePath: string): void {
  state.existing.add(key(filePath));
}

function setFile(filePath: string, content: string): void {
  const normalized = key(filePath);
  state.files.set(normalized, content);
  state.existing.add(normalized);
}

const originalFs = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  chmodSync: fs.chmodSync,
};

fs.existsSync = ((filePath: string) => state.existing.has(key(filePath))) as any;
fs.mkdirSync = ((dirPath: string, options: unknown) => {
  state.mkdirCalls.push({ path: dirPath, options });
  setExists(dirPath);
}) as any;
fs.readFileSync = ((filePath: string, encoding: string) => {
  assert.equal(encoding, 'utf8');
  const content = state.files.get(key(filePath));
  if (content !== undefined) return content;

  // Allow Node/third-party modules (e.g., jsonwebtoken) to load normally.
  return originalFs.readFileSync(filePath, encoding);
}) as any;
fs.writeFileSync = ((filePath: string, data: string, options: unknown) => {
  state.writeCalls.push({ path: filePath, data: String(data), options });
  setFile(filePath, String(data));
}) as any;
fs.chmodSync = ((filePath: string, mode: number) => {
  state.chmodCalls.push({ path: filePath, mode });
}) as any;

const tokenManagerUrl = new URL('../dist/core/auth/token-manager.js', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeEach(() => {
  state.existing.clear();
  state.files.clear();
  state.mkdirCalls.length = 0;
  state.writeCalls.length = 0;
  state.chmodCalls.length = 0;
});

describe('TokenManager authentication helper', async () => {
  mod = await import(tokenManagerUrl);

  it('generateToken produces a valid HS256 JWT with 24h expiry', () => {
    const manager = new mod.TokenManager();
    const secret = 's'.repeat(64);
    const now = Date.now();

    const result = manager.generateToken(secret);
    assert.ok(result.token.includes('.'));
    assert.ok(result.expiresAt instanceof Date);

    const [headerB64] = result.token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg?: string };
    assert.equal(header.alg, 'HS256');

    const msUntilExpiry = result.expiresAt.getTime() - now;
    assert.ok(msUntilExpiry > 23 * 60 * 60 * 1000);
    assert.ok(msUntilExpiry < 24 * 60 * 60 * 1000 + 60 * 1000);
  });

  it('validateToken accepts correct secret and rejects wrong secret', () => {
    const manager = new mod.TokenManager();
    const secret = 'my-secret';
    const { token } = manager.generateToken(secret);

    assert.equal(manager.validateToken(token, secret), true);
    assert.equal(manager.validateToken(token, 'wrong-secret'), false);
  });

  it('validateToken rejects expired tokens', () => {
    const manager = new mod.TokenManager({ tokenTtlMs: -1000 });
    const secret = 'my-secret';
    const { token } = manager.generateToken(secret);

    assert.equal(manager.validateToken(token, secret), false);
  });

  it('persists and reloads secret key with restrictive permissions', () => {
    const authDir = path.join(TEST_CCW_HOME, 'auth');
    const secretPath = path.join(authDir, 'secret.key');

    const manager1 = new mod.TokenManager({ authDir, secretKeyPath: secretPath });
    const secret1 = manager1.getSecretKey();

    assert.equal(secret1.length, 64); // 32 bytes hex
    assert.equal(state.writeCalls.length, 1);
    assert.equal(state.writeCalls[0].path, secretPath);
    assert.deepEqual(state.writeCalls[0].options, { encoding: 'utf8', mode: 0o600 });
    assert.deepEqual(state.chmodCalls, [{ path: secretPath, mode: 0o600 }]);

    const manager2 = new mod.TokenManager({ authDir, secretKeyPath: secretPath });
    const secret2 = manager2.getSecretKey();
    assert.equal(secret2, secret1);
  });

  it('rotates token before expiry and persists updated token', () => {
    const authDir = path.join(TEST_CCW_HOME, 'auth');
    const tokenPath = path.join(authDir, 'token.jwt');

    const manager = new mod.TokenManager({
      authDir,
      tokenPath,
      tokenTtlMs: 1000,
      rotateBeforeExpiryMs: 2000,
    });

    const first = manager.getOrCreateAuthToken();
    const tokenFileFirst = state.files.get(key(tokenPath));
    assert.equal(tokenFileFirst, first.token);

    const second = manager.getOrCreateAuthToken();
    const tokenFileSecond = state.files.get(key(tokenPath));
    assert.equal(tokenFileSecond, second.token);
    assert.notEqual(second.token, first.token);
  });
});

after(() => {
  fs.existsSync = originalFs.existsSync;
  fs.mkdirSync = originalFs.mkdirSync;
  fs.readFileSync = originalFs.readFileSync;
  fs.writeFileSync = originalFs.writeFileSync;
  fs.chmodSync = originalFs.chmodSync;
  process.env = ORIGINAL_ENV;
});
