/**
 * Integration tests for CLAUDE.md routes (scan + CRUD).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Uses temporary HOME/USERPROFILE to isolate user-level files.
 * - Uses a temporary project root as initialPath for project/module operations.
 */

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const claudeRoutesUrl = new URL('../../dist/core/routes/claude-routes.js', import.meta.url);
claudeRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

const originalEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

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

function handlePostRequest(req: http.IncomingMessage, res: http.ServerResponse, handler: (body: unknown) => Promise<any>): void {
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

describe('claude routes integration', async () => {
  let server: http.Server | null = null;
  let baseUrl = '';
  let homeDir = '';
  let projectRoot = '';

  before(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'ccw-claude-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-claude-project-'));

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.HOMEDRIVE = undefined;
    process.env.HOMEPATH = undefined;

    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});

    mod = await import(claudeRoutesUrl.href);

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
        broadcastToClients() {},
      };

      try {
        const handled = await mod.handleClaudeRoutes(ctx);
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

  after(async () => {
    mock.restoreAll();
    process.env.HOME = originalEnv.HOME;
    process.env.USERPROFILE = originalEnv.USERPROFILE;
    process.env.HOMEDRIVE = originalEnv.HOMEDRIVE;
    process.env.HOMEPATH = originalEnv.HOMEPATH;

    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }

    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = '';
    }

    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
      homeDir = '';
    }
  });

  it('POST /api/memory/claude/create creates a project-level CLAUDE.md', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/memory/claude/create', { level: 'project', template: 'minimal' });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
    assert.ok(typeof res.json.path === 'string' && res.json.path.endsWith('CLAUDE.md'));
    assert.equal(existsSync(res.json.path), true);
  });

  it('GET /api/memory/claude/file parses frontmatter for project CLAUDE.md', async () => {
    const claudePath = join(projectRoot, '.claude', 'CLAUDE.md');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      claudePath,
      ['---', 'paths: [src, docs]', '---', '', '# Project Rules', '', 'ok'].join('\n'),
      'utf8',
    );

    const res = await requestJson(baseUrl, 'GET', `/api/memory/claude/file?path=${encodeURIComponent(claudePath)}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.level, 'project');
    assert.deepEqual(res.json.frontmatter?.paths, ['src', 'docs']);
    assert.match(res.json.content, /# Project Rules/);
    assert.equal(String(res.json.content).includes('paths:'), false);
  });

  it('POST /api/memory/claude/file saves updated content', async () => {
    const claudePath = join(projectRoot, '.claude', 'CLAUDE.md');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(claudePath, 'before\n', 'utf8');

    const res = await requestJson(baseUrl, 'POST', '/api/memory/claude/file', { path: claudePath, content: 'after\n' });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
    assert.equal(readFileSync(claudePath, 'utf8'), 'after\n');
  });

  it('GET /api/memory/claude/scan separates user/project/module levels', async () => {
    const userClaudePath = join(homeDir, '.claude', 'CLAUDE.md');
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(userClaudePath, '# User CLAUDE\n', 'utf8');

    const projectClaudePath = join(projectRoot, '.claude', 'CLAUDE.md');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(projectClaudePath, ['---', 'paths: [src]', '---', '', '# Project CLAUDE'].join('\n'), 'utf8');

    const moduleDir = join(projectRoot, 'module-a');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, 'CLAUDE.md'), '# Module CLAUDE\n', 'utf8');

    const res = await requestJson(baseUrl, 'GET', `/api/memory/claude/scan?path=${encodeURIComponent(projectRoot)}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.user?.main?.level, 'user');
    assert.ok(String(res.json.user.main.path).includes(homeDir));

    assert.equal(res.json.project?.main?.level, 'project');
    assert.ok(String(res.json.project.main.path).includes(projectRoot));
    assert.deepEqual(res.json.project.main.frontmatter?.paths, ['src']);
    assert.equal(String(res.json.project.main.content).includes('paths:'), false);

    assert.equal(Array.isArray(res.json.modules), true);
    assert.ok(res.json.modules.length >= 1);
    const moduleFile = res.json.modules.find((m: any) => String(m.path).includes('module-a'));
    assert.ok(moduleFile);
    assert.equal(moduleFile.level, 'module');
    assert.equal(moduleFile.parentDirectory, 'module-a');
  });

  it('DELETE /api/memory/claude/file requires confirm=true', async () => {
    const moduleDir = join(projectRoot, 'module-del');
    const moduleFilePath = join(moduleDir, 'CLAUDE.md');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(moduleFilePath, '# To delete\n', 'utf8');

    const res = await requestJson(baseUrl, 'DELETE', `/api/memory/claude/file?path=${encodeURIComponent(moduleFilePath)}`);
    assert.equal(res.status, 400);
    assert.equal(res.json?.error, 'Confirmation required');
    assert.equal(existsSync(moduleFilePath), true);
  });

  it('DELETE /api/memory/claude/file deletes the file and creates a backup', async () => {
    const moduleDir = join(projectRoot, 'module-del-ok');
    const moduleFilePath = join(moduleDir, 'CLAUDE.md');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(moduleFilePath, '# Bye\n', 'utf8');

    const res = await requestJson(
      baseUrl,
      'DELETE',
      `/api/memory/claude/file?path=${encodeURIComponent(moduleFilePath)}&confirm=true`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
    assert.equal(existsSync(moduleFilePath), false);

    const backups = readdirSync(moduleDir).filter((name) => name.startsWith('CLAUDE.md.deleted-'));
    assert.equal(backups.length, 1);
  });
});

