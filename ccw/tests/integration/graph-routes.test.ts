/**
 * Integration tests for graph routes (CodexLens graph API helpers).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Calls route handler directly (no HTTP server required).
 */
import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const graphRoutesUrl = new URL('../../dist/core/routes/graph-routes.js', import.meta.url);
graphRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

async function callGraph(
  projectRoot: string,
  path: string,
): Promise<{ handled: boolean; status: number; json: any }> {
  const url = new URL(path, 'http://localhost');
  let status = 0;
  let body = '';

  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk?: any) {
      body = chunk === undefined ? '' : String(chunk);
    },
  };

  const handled = await mod.handleGraphRoutes({
    pathname: url.pathname,
    url,
    req: { method: 'GET' },
    res,
    initialPath: projectRoot,
  });

  return { handled, status, json: body ? JSON.parse(body) : null };
}

describe('graph routes integration', async () => {
  let projectRoot = '';

  before(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-graph-project-'));
    mock.method(console, 'error', () => {});
    mod = await import(graphRoutesUrl.href);
  });

  after(() => {
    mock.restoreAll();
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = '';
    }
  });

  it('GET /api/graph/search-process returns placeholder pipeline data', async () => {
    const res = await callGraph(projectRoot, '/api/graph/search-process');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.json.stages), true);
    assert.equal(res.json.stages.length, 5);
    assert.equal(typeof res.json.message, 'string');
  });

  it('GET /api/graph/files returns empty lists when no index exists', async () => {
    const res = await callGraph(projectRoot, `/api/graph/files?path=${encodeURIComponent(projectRoot)}`);
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.json.files), true);
    assert.equal(Array.isArray(res.json.modules), true);
    assert.equal(res.json.files.length, 0);
    assert.equal(res.json.modules.length, 0);
  });

  it('GET /api/graph/impact validates required symbol parameter', async () => {
    const res = await callGraph(projectRoot, `/api/graph/impact?path=${encodeURIComponent(projectRoot)}`);
    assert.equal(res.handled, true);
    assert.equal(res.status, 400);
    assert.ok(String(res.json.error).includes('symbol'));
    assert.equal(Array.isArray(res.json.directDependents), true);
    assert.equal(Array.isArray(res.json.affectedFiles), true);
  });
});

