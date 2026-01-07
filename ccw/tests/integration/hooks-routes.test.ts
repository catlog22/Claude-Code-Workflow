/**
 * Integration tests for hooks routes (hooks configuration CRUD).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Uses temporary HOME/USERPROFILE for global settings isolation.
 * - Calls route handler directly (no HTTP server required).
 */

import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hooksRoutesUrl = new URL('../../dist/core/routes/hooks-routes.js', import.meta.url);
hooksRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

const originalEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

async function callHooks(
  initialPath: string,
  method: string,
  pathname: string,
  body?: any,
): Promise<{ handled: boolean; status: number; json: any }> {
  const url = new URL(pathname, 'http://localhost');
  let status = 0;
  let text = '';

  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk?: any) {
      text = chunk === undefined ? '' : String(chunk);
    },
  };

  const handlePostRequest = async (_req: any, _res: any, handler: (parsed: any) => Promise<any>) => {
    const result = await handler(body ?? {});
    if (result && typeof result === 'object' && typeof result.error === 'string' && result.error.length > 0) {
      res.writeHead(typeof result.status === 'number' ? result.status : 500);
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify(result));
  };

  const handled = await mod.handleHooksRoutes({
    pathname: url.pathname,
    url,
    req: { method },
    res,
    initialPath,
    handlePostRequest,
    broadcastToClients() {},
    extractSessionIdFromPath() {
      return null;
    },
  });

  return { handled, status, json: text ? JSON.parse(text) : null };
}

describe('hooks routes integration', async () => {
  let homeDir = '';
  let projectRoot = '';

  before(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'ccw-hooks-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-hooks-project-'));

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.HOMEDRIVE = undefined;
    process.env.HOMEPATH = undefined;

    mock.method(console, 'log', () => {});
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});

    mod = await import(hooksRoutesUrl.href);
  });

  beforeEach(() => {
    rmSync(join(homeDir, '.claude'), { recursive: true, force: true });
    rmSync(join(projectRoot, '.claude'), { recursive: true, force: true });
  });

  after(() => {
    mock.restoreAll();
    process.env.HOME = originalEnv.HOME;
    process.env.USERPROFILE = originalEnv.USERPROFILE;
    process.env.HOMEDRIVE = originalEnv.HOMEDRIVE;
    process.env.HOMEPATH = originalEnv.HOMEPATH;

    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('GET /api/hooks returns global and project hook configs', async () => {
    const res = await callHooks(projectRoot, 'GET', '/api/hooks');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.ok(res.json);
    assert.ok(res.json.global);
    assert.ok(res.json.project);
    assert.deepEqual(res.json.global.hooks, {});
    assert.deepEqual(res.json.project.hooks, {});
  });

  it('POST /api/hooks saves a global hook and GET reflects it', async () => {
    const save = await callHooks(projectRoot, 'POST', '/api/hooks', {
      scope: 'global',
      event: 'PreToolUse',
      hookData: { command: 'echo hi' },
    });
    assert.equal(save.handled, true);
    assert.equal(save.status, 200);
    assert.equal(save.json.success, true);

    const read = await callHooks(projectRoot, 'GET', '/api/hooks');
    assert.equal(read.status, 200);
    assert.equal(Array.isArray(read.json.global.hooks.PreToolUse), true);
    assert.equal(read.json.global.hooks.PreToolUse.length, 1);
    assert.equal(read.json.global.hooks.PreToolUse[0].command, 'echo hi');
  });

  it('DELETE /api/hooks removes a hook by index', async () => {
    await callHooks(projectRoot, 'POST', '/api/hooks', {
      scope: 'global',
      event: 'PreToolUse',
      hookData: { command: 'echo hi' },
    });

    const del = await callHooks(projectRoot, 'DELETE', '/api/hooks', {
      scope: 'global',
      event: 'PreToolUse',
      hookIndex: 0,
    });
    assert.equal(del.status, 200);
    assert.equal(del.json.success, true);

    const read = await callHooks(projectRoot, 'GET', '/api/hooks');
    assert.equal(read.status, 200);
    assert.deepEqual(read.json.global.hooks, {});
  });
});

