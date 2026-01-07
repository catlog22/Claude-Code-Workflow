/**
 * Integration tests for issue routes (issues + solutions + queue).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Uses a temporary project root to isolate `.workflow/issues` JSONL storage.
 */

import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const issueRoutesUrl = new URL('../../dist/core/routes/issue-routes.js', import.meta.url);
issueRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

type JsonResponse = { status: number; json: any; text: string };

async function requestJson(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<JsonResponse> {
  const url = new URL(path, baseUrl);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
            : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          let json: any = null;
          try {
            json = responseBody ? JSON.parse(responseBody) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, json, text: responseBody });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function handlePostRequest(req: http.IncomingMessage, res: http.ServerResponse, handler: (body: any) => Promise<any>): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', async () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      const result = await handler(parsed);

      if (result?.error) {
        res.writeHead(result.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });
}

function readJsonl(path: string): any[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe('issue routes integration', async () => {
  let server: http.Server | null = null;
  let baseUrl = '';
  let projectRoot = '';

  before(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-issue-routes-project-'));

    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});

    mod = await import(issueRoutesUrl.href);

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;

      const ctx = {
        pathname,
        url,
        req,
        res,
        initialPath: projectRoot,
        handlePostRequest,
      };

      try {
        const handled = await mod.handleIssueRoutes(ctx);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        }
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    });

    await new Promise<void>((resolve) => server!.listen(0, () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    rmSync(join(projectRoot, '.workflow'), { recursive: true, force: true });
  });

  after(async () => {
    mock.restoreAll();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = '';
    }
  });

  it('GET /api/issues returns empty issues list with metadata', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/issues');
    assert.equal(res.status, 200);
    assert.ok(res.json);
    assert.equal(Array.isArray(res.json.issues), true);
    assert.equal(res.json.issues.length, 0);
    assert.equal(res.json._metadata.storage, 'jsonl');
  });

  it('POST /api/issues creates a new issue and writes JSONL', async () => {
    const issueId = 'ISS-IR-1';
    const res = await requestJson(baseUrl, 'POST', '/api/issues', { id: issueId, title: 'Issue routes test' });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
    assert.equal(res.json.issue.id, issueId);

    const issuesPath = join(projectRoot, '.workflow', 'issues', 'issues.jsonl');
    const lines = readJsonl(issuesPath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, issueId);
    assert.equal(typeof lines[0].created_at, 'string');
  });

  it('GET /api/issues returns enriched issue list with counts', async () => {
    const issueId = 'ISS-IR-2';
    await requestJson(baseUrl, 'POST', '/api/issues', { id: issueId, title: 'Counts' });

    const res = await requestJson(baseUrl, 'GET', '/api/issues');
    assert.equal(res.status, 200);
    const issue = res.json.issues.find((i: any) => i.id === issueId);
    assert.ok(issue);
    assert.equal(issue.solution_count, 0);
    assert.equal(issue.task_count, 0);
  });

  it('GET /api/issues/:id returns issue detail with solutions/tasks arrays', async () => {
    const issueId = 'ISS-IR-3';
    await requestJson(baseUrl, 'POST', '/api/issues', { id: issueId, title: 'Detail' });

    const res = await requestJson(baseUrl, 'GET', `/api/issues/${encodeURIComponent(issueId)}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.id, issueId);
    assert.equal(Array.isArray(res.json.solutions), true);
    assert.equal(Array.isArray(res.json.tasks), true);
    assert.equal(res.json.solutions.length, 0);
    assert.equal(res.json.tasks.length, 0);
  });

  it('POST /api/issues/:id/solutions appends a solution to solutions JSONL', async () => {
    const issueId = 'ISS-IR-4';
    const solutionId = 'SOL-ISS-IR-4-1';
    await requestJson(baseUrl, 'POST', '/api/issues', { id: issueId, title: 'Solution add' });

    const tasks = [{ id: 'T1', title: 'Do thing' }];
    const res = await requestJson(baseUrl, 'POST', `/api/issues/${encodeURIComponent(issueId)}/solutions`, { id: solutionId, tasks });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
    assert.equal(res.json.solution.id, solutionId);
    assert.equal(res.json.solution.is_bound, false);

    const solutionsPath = join(projectRoot, '.workflow', 'issues', 'solutions', `${issueId}.jsonl`);
    const lines = readJsonl(solutionsPath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, solutionId);
    assert.equal(Array.isArray(lines[0].tasks), true);
  });

  it('PATCH /api/issues/:id binds solution and updates planned status', async () => {
    const issueId = 'ISS-IR-5';
    const solutionId = 'SOL-ISS-IR-5-1';
    await requestJson(baseUrl, 'POST', '/api/issues', { id: issueId, title: 'Bind' });
    await requestJson(baseUrl, 'POST', `/api/issues/${encodeURIComponent(issueId)}/solutions`, { id: solutionId, tasks: [{ id: 'T1' }] });

    const res = await requestJson(baseUrl, 'PATCH', `/api/issues/${encodeURIComponent(issueId)}`, { bound_solution_id: solutionId });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
    assert.ok(res.json.updated.includes('bound_solution_id'));

    const detail = await requestJson(baseUrl, 'GET', `/api/issues/${encodeURIComponent(issueId)}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.bound_solution_id, solutionId);
    assert.equal(detail.json.status, 'planned');
    assert.ok(detail.json.planned_at);
    assert.equal(detail.json.tasks.length, 1);

    const solutionsPath = join(projectRoot, '.workflow', 'issues', 'solutions', `${issueId}.jsonl`);
    const lines = readJsonl(solutionsPath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].is_bound, true);
  });

  it('PATCH /api/issues/:id/tasks/:taskId updates bound solution task fields', async () => {
    const issueId = 'ISS-IR-6';
    const solutionId = 'SOL-ISS-IR-6-1';
    await requestJson(baseUrl, 'POST', '/api/issues', { id: issueId, title: 'Task update' });
    await requestJson(baseUrl, 'POST', `/api/issues/${encodeURIComponent(issueId)}/solutions`, { id: solutionId, tasks: [{ id: 'T1', status: 'pending' }] });
    await requestJson(baseUrl, 'PATCH', `/api/issues/${encodeURIComponent(issueId)}`, { bound_solution_id: solutionId });

    const res = await requestJson(baseUrl, 'PATCH', `/api/issues/${encodeURIComponent(issueId)}/tasks/T1`, { status: 'completed', result: { ok: true } });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
    assert.ok(res.json.updated.includes('status'));
    assert.ok(res.json.updated.includes('result'));

    const solutionsPath = join(projectRoot, '.workflow', 'issues', 'solutions', `${issueId}.jsonl`);
    const lines = readJsonl(solutionsPath);
    const task = lines[0].tasks.find((t: any) => t.id === 'T1');
    assert.equal(task.status, 'completed');
    assert.deepEqual(task.result, { ok: true });
    assert.ok(task.updated_at);
  });

  it('DELETE /api/issues/:id removes issue and deletes solutions JSONL', async () => {
    const issueId = 'ISS-IR-7';
    const solutionId = 'SOL-ISS-IR-7-1';
    await requestJson(baseUrl, 'POST', '/api/issues', { id: issueId, title: 'Delete me' });
    await requestJson(baseUrl, 'POST', `/api/issues/${encodeURIComponent(issueId)}/solutions`, { id: solutionId, tasks: [{ id: 'T1' }] });

    const res = await requestJson(baseUrl, 'DELETE', `/api/issues/${encodeURIComponent(issueId)}`);
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);

    const issuesPath = join(projectRoot, '.workflow', 'issues', 'issues.jsonl');
    assert.equal(readJsonl(issuesPath).length, 0);

    const solutionsPath = join(projectRoot, '.workflow', 'issues', 'solutions', `${issueId}.jsonl`);
    assert.equal(existsSync(solutionsPath), false);
  });

  it('GET /api/queue returns grouped queue structure', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/queue');
    assert.equal(res.status, 200);
    assert.ok(res.json);
    assert.equal(Array.isArray(res.json.execution_groups), true);
    assert.equal(typeof res.json.grouped_items, 'object');
  });
});

