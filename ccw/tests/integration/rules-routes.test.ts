/**
 * Integration tests for rules routes (rules management CRUD).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Calls route handler directly (no HTTP server required).
 * - Uses temporary HOME/USERPROFILE to isolate user rules directory.
 */

import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rulesRoutesUrl = new URL('../../dist/core/routes/rules-routes.js', import.meta.url);
rulesRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

const originalEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

async function callRules(
  initialPath: string,
  method: string,
  path: string,
  body?: any,
): Promise<{ handled: boolean; status: number; json: any }> {
  const url = new URL(path, 'http://localhost');
  let status = 0;
  let text = '';
  let postPromise: Promise<void> | null = null;

  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk?: any) {
      text = chunk === undefined ? '' : String(chunk);
    },
  };

  const handlePostRequest = (_req: any, _res: any, handler: (parsed: any) => Promise<any>) => {
    postPromise = (async () => {
      const result = await handler(body ?? {});
      const errorValue = result && typeof result === 'object' ? (result as any).error : undefined;
      const statusValue = result && typeof result === 'object' ? (result as any).status : undefined;

      if (typeof errorValue === 'string' && errorValue.length > 0) {
        res.writeHead(typeof statusValue === 'number' ? statusValue : 500);
        res.end(JSON.stringify({ error: errorValue }));
        return;
      }

      res.writeHead(200);
      res.end(JSON.stringify(result));
    })();
  };

  const handled = await mod.handleRulesRoutes({
    pathname: url.pathname,
    url,
    req: { method },
    res,
    initialPath,
    handlePostRequest,
  });

  if (postPromise) await postPromise;

  return { handled, status, json: text ? JSON.parse(text) : null };
}

describe('rules routes integration', async () => {
  let homeDir = '';
  let projectRoot = '';

  before(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'ccw-rules-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-rules-project-'));

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.HOMEDRIVE = undefined;
    process.env.HOMEPATH = undefined;

    mock.method(console, 'log', () => {});
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});

    mod = await import(rulesRoutesUrl.href);
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

  it('GET /api/rules returns projectRules and userRules arrays', async () => {
    const res = await callRules(projectRoot, 'GET', '/api/rules');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.json.projectRules), true);
    assert.equal(Array.isArray(res.json.userRules), true);
  });

  it('POST /api/rules/create writes a project rule and GET reflects it', async () => {
    const create = await callRules(projectRoot, 'POST', '/api/rules/create', {
      fileName: 'test-rule.md',
      content: '# Hello rule\n',
      paths: ['src/**'],
      location: 'project',
    });

    assert.equal(create.handled, true);
    assert.equal(create.status, 200);
    assert.equal(create.json.success, true);
    assert.ok(typeof create.json.path === 'string' && create.json.path.length > 0);
    assert.equal(existsSync(create.json.path), true);

    const config = await callRules(projectRoot, 'GET', '/api/rules');
    assert.equal(config.status, 200);
    assert.equal(config.json.projectRules.length, 1);
    assert.equal(config.json.projectRules[0].name, 'test-rule.md');

    const detail = await callRules(projectRoot, 'GET', '/api/rules/test-rule.md?location=project');
    assert.equal(detail.status, 200);
    assert.equal(detail.json.rule.name, 'test-rule.md');
    assert.ok(String(detail.json.rule.content).includes('Hello rule'));

    // Ensure frontmatter was persisted.
    const raw = readFileSync(create.json.path, 'utf8');
    assert.ok(raw.startsWith('---'));
    assert.ok(raw.includes('paths: [src/**]'));
  });
});
