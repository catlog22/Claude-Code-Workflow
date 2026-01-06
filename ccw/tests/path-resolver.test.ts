/**
 * Unit tests for path-resolver utility module.
 *
 * Notes:
 * - Targets the runtime implementation shipped in `ccw/dist`.
 * - Uses in-memory stubs for fs + os to avoid touching the real filesystem.
 */

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Use CJS exports so we can monkeypatch properties before importing the ESM under test.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('node:os') as typeof import('node:os');

const TEST_CCW_HOME = path.join(process.cwd(), '.tmp-ccw-path-resolver-home');
const ORIGINAL_ENV = { ...process.env };
process.env.CCW_DATA_DIR = TEST_CCW_HOME;

type FsState = {
  existing: Set<string>;
  files: Map<string, string>;
  directories: Set<string>;
  realpaths: Map<string, string>;
  mkdirCalls: Array<{ path: string; options: unknown }>;
  writeCalls: Array<{ path: string; data: string; encoding: string }>;
};

const fsState: FsState = {
  existing: new Set(),
  files: new Map(),
  directories: new Set(),
  realpaths: new Map(),
  mkdirCalls: [],
  writeCalls: [],
};

function key(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

function setExists(filePath: string, exists: boolean): void {
  const normalized = key(filePath);
  if (exists) fsState.existing.add(normalized);
  else fsState.existing.delete(normalized);
}

function setDir(filePath: string, isDirectory: boolean): void {
  const normalized = key(filePath);
  if (isDirectory) fsState.directories.add(normalized);
  else fsState.directories.delete(normalized);
}

function setFile(filePath: string, content: string): void {
  const normalized = key(filePath);
  fsState.files.set(normalized, content);
  fsState.existing.add(normalized);
}

function setRealpath(filePath: string, realPath: string): void {
  fsState.realpaths.set(key(filePath), realPath);
}

const originalFs = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  realpathSync: fs.realpathSync,
  statSync: fs.statSync,
};
const originalHomedir = os.homedir;

const TEST_HOME = path.join(process.cwd(), '.tmp-ccw-path-resolver-user-home');
os.homedir = () => TEST_HOME;

fs.existsSync = ((filePath: string) => fsState.existing.has(key(filePath))) as any;
fs.readFileSync = ((filePath: string, encoding: string) => {
  assert.equal(encoding, 'utf8');
  const value = fsState.files.get(key(filePath));
  if (value === undefined) {
    throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
  }
  return value;
}) as any;
fs.writeFileSync = ((filePath: string, data: string, encoding: string) => {
  fsState.writeCalls.push({ path: filePath, data: String(data), encoding: String(encoding) });
  setFile(filePath, String(data));
}) as any;
fs.mkdirSync = ((dirPath: string, options: unknown) => {
  fsState.mkdirCalls.push({ path: dirPath, options });
  setExists(dirPath, true);
  setDir(dirPath, true);
}) as any;
fs.realpathSync = ((filePath: string) => {
  const mapped = fsState.realpaths.get(key(filePath));
  return mapped ?? filePath;
}) as any;
fs.statSync = ((filePath: string) => {
  return {
    isDirectory: () => fsState.directories.has(key(filePath)),
  } as any;
}) as any;

const pathResolverUrl = new URL('../dist/utils/path-resolver.js', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pathResolver: any;

beforeEach(() => {
  fsState.existing.clear();
  fsState.files.clear();
  fsState.directories.clear();
  fsState.realpaths.clear();
  fsState.mkdirCalls.length = 0;
  fsState.writeCalls.length = 0;
});

describe('path-resolver utility module', async () => {
  pathResolver = await import(pathResolverUrl);

  it('resolvePath expands ~ and resolves relative paths', () => {
    const resolvedHome = pathResolver.resolvePath('~/proj');
    assert.equal(resolvedHome, path.join(TEST_HOME, 'proj'));

    const relativeInput = path.join('some', 'dir');
    assert.equal(pathResolver.resolvePath(relativeInput), path.resolve(relativeInput));

    assert.equal(pathResolver.resolvePath(''), process.cwd());
  });

  it('validatePath rejects empty input and control characters', () => {
    assert.deepEqual(pathResolver.validatePath(''), {
      valid: false,
      path: null,
      error: 'Path is required',
    });

    const res = pathResolver.validatePath('C:\\allowed\\file.txt\0');
    assert.equal(res.valid, false);
    assert.equal(res.path, null);
    assert.equal(res.error, 'Path contains invalid characters');
  });

  it('validatePath enforces baseDir boundary and detects traversal', () => {
    const baseDir = 'C:\\allowed';
    const traversal = pathResolver.validatePath('C:\\allowed\\..\\secret', { baseDir });
    assert.equal(traversal.valid, false);
    assert.equal(traversal.path, null);
    assert.ok(traversal.error?.includes('Path must be within'));

    const outside = pathResolver.validatePath('C:\\secret', { baseDir });
    assert.equal(outside.valid, false);
    assert.ok(outside.error?.includes('Path must be within'));
  });

  it('validatePath validates existence when mustExist is set', () => {
    const missing = pathResolver.validatePath('C:\\does-not-exist', { mustExist: true });
    assert.equal(missing.valid, false);
    assert.equal(missing.path, null);
    assert.ok(missing.error?.includes('Path does not exist:'));
  });

  it('validatePath resolves symlinks via realpathSync when path exists', () => {
    const baseDir = 'C:\\allowed';
    const linkPath = 'C:\\allowed\\link';
    setExists(linkPath, true);
    setRealpath(linkPath, 'C:\\secret');

    const res = pathResolver.validatePath(linkPath, { baseDir });
    assert.equal(res.valid, false);
    assert.equal(res.path, null);
    assert.ok(res.error?.includes('Path must be within'));
  });

  it('validatePath blocks symlink escapes even when target path does not exist', () => {
    const baseDir = 'C:\\allowed';
    const linkPath = 'C:\\allowed\\link';
    setExists(linkPath, true);
    setDir(linkPath, true);
    setRealpath(linkPath, 'C:\\secret');

    const res = pathResolver.validatePath(path.join(linkPath, 'newfile.txt'), { baseDir });
    assert.equal(res.valid, false);
    assert.equal(res.path, null);
    assert.ok(res.error?.includes('Path must be within'));
  });

  it('validatePath allows symlinked parent directories that resolve within baseDir', () => {
    const baseDir = 'C:\\allowed';
    const linkPath = 'C:\\allowed\\link';
    setExists(linkPath, true);
    setDir(linkPath, true);
    setRealpath(linkPath, 'C:\\allowed\\real');

    const res = pathResolver.validatePath(path.join(linkPath, 'newfile.txt'), { baseDir });
    assert.equal(res.valid, true);
    assert.equal(res.path, path.join('C:\\allowed\\real', 'newfile.txt'));
    assert.equal(res.error, null);
  });

  it('validateOutputPath rejects directories and resolves relative output paths', () => {
    assert.equal(pathResolver.validateOutputPath('').valid, false);

    const out = pathResolver.validateOutputPath('out.txt', 'C:\\base');
    assert.equal(out.valid, true);
    assert.equal(out.path, path.resolve(path.join('C:\\base', 'out.txt')));

    const existingDir = path.resolve('C:\\base\\dir-output');
    setExists(existingDir, true);
    setDir(existingDir, true);
    const dirRes = pathResolver.validateOutputPath(existingDir, 'C:\\base');
    assert.equal(dirRes.valid, false);
    assert.equal(dirRes.error, 'Output path is a directory, expected a file');
  });

  it('getTemplateLocations and findTemplate use known locations', () => {
    const homeTemplates = path.join(TEST_HOME, '.claude', 'templates');
    const cwdTemplates = path.join(process.cwd(), '.claude', 'templates');
    setExists(homeTemplates, true);
    setExists(cwdTemplates, false);

    const locations = pathResolver.getTemplateLocations();
    assert.deepEqual(locations, [homeTemplates]);

    const templateName = 'workflow-dashboard.html';
    const templatePath = path.join(homeTemplates, templateName);
    setExists(templatePath, true);

    assert.equal(pathResolver.findTemplate(templateName), templatePath);
    assert.equal(pathResolver.findTemplate('does-not-exist.html'), null);
  });

  it('ensureDir creates directory only when missing', () => {
    const dirPath = 'C:\\tmp\\ensureDir';
    pathResolver.ensureDir(dirPath);
    assert.equal(fsState.mkdirCalls.length, 1);
    assert.equal(fsState.mkdirCalls[0]?.path, dirPath);

    pathResolver.ensureDir(dirPath);
    assert.equal(fsState.mkdirCalls.length, 1);
  });

  it('normalizePathForDisplay converts backslashes to forward slashes', () => {
    assert.equal(pathResolver.normalizePathForDisplay('C:\\a\\b'), 'C:/a/b');
  });

  it('getRecentPaths reads legacy file when legacy exists and new does not', () => {
    const legacyFile = path.join(TEST_HOME, '.ccw-recent-paths.json');
    setExists(legacyFile, true);
    setFile(legacyFile, JSON.stringify({ paths: ['C:/one', 'C:/two'] }));

    const paths = pathResolver.getRecentPaths();
    assert.deepEqual(paths, ['C:/one', 'C:/two']);
  });

  it('trackRecentPath updates recent list and writes to centralized storage', () => {
    const recentFile = path.join(TEST_CCW_HOME, 'config', 'recent-paths.json');
    setExists(recentFile, true);
    setFile(recentFile, JSON.stringify({ paths: ['C:/old'] }));

    pathResolver.trackRecentPath('C:\\project\\demo');

    assert.ok(fsState.writeCalls.length >= 1);
    const latest = fsState.writeCalls.at(-1);
    assert.equal(latest?.path, recentFile);

    const data = JSON.parse(latest?.data ?? '{}') as { paths?: string[] };
    assert.deepEqual(data.paths?.[0], 'C:/project/demo');
  });

  it('removeRecentPath removes matching path and persists update', () => {
    const recentFile = path.join(TEST_CCW_HOME, 'config', 'recent-paths.json');
    setExists(recentFile, true);
    setFile(recentFile, JSON.stringify({ paths: ['C:/one', 'C:/two'] }));

    const removed = pathResolver.removeRecentPath('C:\\two');
    assert.equal(removed, true);

    const latest = fsState.writeCalls.at(-1);
    const data = JSON.parse(latest?.data ?? '{}') as { paths?: string[] };
    assert.deepEqual(data.paths, ['C:/one']);

    assert.equal(pathResolver.removeRecentPath('C:\\not-present'), false);
  });
});

after(() => {
  fs.existsSync = originalFs.existsSync;
  fs.readFileSync = originalFs.readFileSync;
  fs.writeFileSync = originalFs.writeFileSync;
  fs.mkdirSync = originalFs.mkdirSync;
  fs.realpathSync = originalFs.realpathSync;
  fs.statSync = originalFs.statSync;
  os.homedir = originalHomedir;

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
});
