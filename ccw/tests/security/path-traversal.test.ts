/**
 * Regression tests for path traversal protections (DSC-005).
 *
 * Focus:
 * - Allowlist enforcement + boundary checks (no "/allowedness" bypass)
 * - Symlink target re-validation via realpath
 * - Non-existent path handling via parent-directory validation
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Uses stubbed fs + fs/promises to avoid touching real filesystem.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fsp = require('node:fs/promises') as typeof import('node:fs/promises');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('node:os') as typeof import('node:os');

const pathValidatorUrl = new URL('../../dist/utils/path-validator.js', import.meta.url);
pathValidatorUrl.searchParams.set('t', String(Date.now()));

const pathResolverUrl = new URL('../../dist/utils/path-resolver.js', import.meta.url);
pathResolverUrl.searchParams.set('t', String(Date.now()));

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function enoent(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'ENOENT';
  return err;
}

type RealpathPlan = Map<string, { type: 'return'; value: string } | { type: 'throw'; error: any }>;
const realpathPlan: RealpathPlan = new Map();
const realpathCalls: string[] = [];

const originalRealpath = fsp.realpath;
fsp.realpath = (async (p: string) => {
  realpathCalls.push(p);
  const planned = realpathPlan.get(p);
  if (!planned) {
    throw enoent(`ENOENT: no such file or directory, realpath '${p}'`);
  }
  if (planned.type === 'throw') throw planned.error;
  return planned.value;
}) as any;

type FsState = {
  existing: Set<string>;
  realpaths: Map<string, string>;
};

const fsState: FsState = {
  existing: new Set(),
  realpaths: new Map(),
};

function key(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

function setExists(filePath: string, exists: boolean): void {
  const normalized = key(filePath);
  if (exists) fsState.existing.add(normalized);
  else fsState.existing.delete(normalized);
}

function setRealpath(filePath: string, realPath: string): void {
  fsState.realpaths.set(key(filePath), realPath);
}

const originalFs = {
  existsSync: fs.existsSync,
  realpathSync: fs.realpathSync,
};

fs.existsSync = ((filePath: string) => fsState.existing.has(key(filePath))) as any;
fs.realpathSync = ((filePath: string) => {
  const mapped = fsState.realpaths.get(key(filePath));
  return mapped ?? filePath;
}) as any;

const originalHomedir = os.homedir;
const TEST_HOME = path.join(process.cwd(), '.tmp-ccw-security-home');
os.homedir = () => TEST_HOME;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pathValidator: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pathResolver: any;

describe('security: path traversal regression', async () => {
  const isWindows = process.platform === 'win32';
  const allowedRoot = isWindows ? 'C:\\allowed' : '/allowed';
  const disallowedRoot = isWindows ? 'C:\\secret' : '/secret';

  before(async () => {
    pathValidator = await import(pathValidatorUrl.href);
    pathResolver = await import(pathResolverUrl.href);
  });

  beforeEach(() => {
    realpathCalls.length = 0;
    realpathPlan.clear();
    fsState.existing.clear();
    fsState.realpaths.clear();
    resetEnv();
  });

  it('path-validator rejects traversal/absolute escapes before realpath', async () => {
    process.env.CCW_PROJECT_ROOT = allowedRoot;
    const allowedDirectories = [allowedRoot];

    const vectors: Array<{ name: string; input: string }> = [
      { name: 'absolute outside allowlist', input: path.join(disallowedRoot, 'secret.txt') },
      { name: 'allowed prefix but different dir (allowedness)', input: `${allowedRoot}ness${isWindows ? '\\\\' : '/'}file.txt` },
      { name: 'allowed prefix but different dir (allowed-evil)', input: `${allowedRoot}-evil${isWindows ? '\\\\' : '/'}file.txt` },
      { name: 'absolute contains .. segment escaping allowlist', input: `${allowedRoot}${isWindows ? '\\\\' : '/'}..${isWindows ? '\\\\' : '/'}secret.txt` },
      { name: 'absolute multi-.. escaping allowlist', input: `${allowedRoot}${isWindows ? '\\\\' : '/'}sub${isWindows ? '\\\\' : '/'}..${isWindows ? '\\\\' : '/'}..${isWindows ? '\\\\' : '/'}secret.txt` },
      { name: 'relative traversal one level', input: `..${isWindows ? '\\\\' : '/'}secret.txt` },
      { name: 'relative traversal two levels', input: `..${isWindows ? '\\\\' : '/'}..${isWindows ? '\\\\' : '/'}secret.txt` },
      { name: 'mixed separators traversal', input: `sub${isWindows ? '/' : '/'}..${isWindows ? '\\\\' : '/'}..${isWindows ? '\\\\' : '/'}secret.txt` },
      { name: 'posix absolute escape', input: '/etc/passwd' },
      { name: 'encoded traversal (decoded once)', input: decodeURIComponent('%2e%2e%2f%2e%2e%2fetc%2fpasswd') },
      { name: 'double-encoded traversal (decoded twice)', input: decodeURIComponent(decodeURIComponent('%252e%252e%252f%252e%252e%252fetc%252fpasswd')) },
      { name: 'leading dot traversal', input: `.${isWindows ? '\\\\' : '/'}..${isWindows ? '\\\\' : '/'}secret.txt` },
      { name: 'nested traversal escape', input: 'sub/../../secret.txt' },
      { name: 'alt-drive absolute escape', input: isWindows ? 'D:\\\\secret\\\\file.txt' : '/var/secret/file.txt' },
      { name: 'UNC/extended path escape', input: isWindows ? '\\\\\\\\?\\\\C:\\\\secret\\\\file.txt' : '/private/secret/file.txt' },
    ];

    for (const vector of vectors) {
      await assert.rejects(
        pathValidator.validatePath(vector.input, { allowedDirectories }),
        (err: any) => err instanceof Error && err.message.includes('Access denied: path'),
        vector.name,
      );
    }

    assert.deepEqual(realpathCalls, []);
  });

  it('path-validator enforces directory-boundary allowlists', async () => {
    process.env.CCW_PROJECT_ROOT = allowedRoot;
    const allowedDirectories = [path.join(allowedRoot, 'dir')];

    await assert.rejects(
      pathValidator.validatePath(path.join(allowedRoot, 'dir-malicious', 'file.txt'), { allowedDirectories }),
      (err: any) => err instanceof Error && err.message.includes('Access denied: path'),
    );

    const okPath = path.join(allowedRoot, 'dir', 'file.txt');
    const resolvedOk = await pathValidator.validatePath(okPath, { allowedDirectories });
    assert.equal(pathValidator.isPathWithinAllowedDirectories(resolvedOk, allowedDirectories), true);
  });

  it('path-validator rejects symlink targets outside allowlist', async () => {
    const linkPath = path.join(allowedRoot, 'link.txt');
    realpathPlan.set(linkPath, { type: 'return', value: path.join(disallowedRoot, 'target.txt') });

    await assert.rejects(
      pathValidator.validatePath(linkPath, { allowedDirectories: [allowedRoot] }),
      (err: any) => err instanceof Error && err.message.includes('symlink target'),
    );
  });

  it('path-validator rejects non-existent paths when the parent resolves outside allowlist', async () => {
    const linkDir = path.join(allowedRoot, 'linkdir');
    const newFile = path.join(linkDir, 'newfile.txt');

    realpathPlan.set(newFile, { type: 'throw', error: enoent('missing') });
    realpathPlan.set(linkDir, { type: 'return', value: disallowedRoot });

    await assert.rejects(
      pathValidator.validatePath(newFile, { allowedDirectories: [allowedRoot] }),
      (err: any) => err instanceof Error && err.message.includes('parent directory'),
    );
  });

  it('path-resolver validates baseDir before and after symlink resolution', () => {
    const baseDir = allowedRoot;
    setExists(baseDir, true);

    const traversal = pathResolver.validatePath(`${baseDir}${isWindows ? '\\\\' : '/'}..${isWindows ? '\\\\' : '/'}secret`, { baseDir });
    assert.equal(traversal.valid, false);
    assert.ok(traversal.error?.includes('Path must be within'));

    const linkPath = path.join(baseDir, 'link');
    setExists(linkPath, true);
    setRealpath(linkPath, disallowedRoot);
    const symlinkEscape = pathResolver.validatePath(linkPath, { baseDir });
    assert.equal(symlinkEscape.valid, false);
    assert.ok(symlinkEscape.error?.includes('Path must be within'));

    setExists(linkPath, true);
    const symlinkParentEscape = pathResolver.validatePath(path.join(linkPath, 'newfile.txt'), { baseDir });
    assert.equal(symlinkParentEscape.valid, false);
    assert.ok(symlinkParentEscape.error?.includes('Path must be within'));
  });
});

after(() => {
  fsp.realpath = originalRealpath;
  fs.existsSync = originalFs.existsSync;
  fs.realpathSync = originalFs.realpathSync;
  os.homedir = originalHomedir;
  resetEnv();
});
