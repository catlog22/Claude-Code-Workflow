/**
 * Integration tests for files routes (directory listing + file preview).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Uses a temporary project directory as the allowed root (initialPath).
 */

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const filesRoutesUrl = new URL('../../dist/core/routes/files-routes.js', import.meta.url);
filesRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

type JsonResponse = { status: number; json: any; text: string };

async function requestJson(baseUrl: string, method: string, path: string): Promise<JsonResponse> {
  const url = new URL(path, baseUrl);

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          let json: any = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, json, text: body });
        });
      },
    );
    req.on('error', reject);
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

describe('files routes integration', async () => {
  let server: http.Server | null = null;
  let baseUrl = '';
  let projectRoot = '';

  before(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-files-routes-project-'));

    mkdirSync(join(projectRoot, 'subdir'), { recursive: true });
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
    mkdirSync(join(projectRoot, 'node_modules'), { recursive: true });
    mkdirSync(join(projectRoot, 'ignored-dir'), { recursive: true });

    writeFileSync(join(projectRoot, 'visible.txt'), 'ok\n', 'utf8');
    writeFileSync(join(projectRoot, 'ignored.txt'), 'nope\n', 'utf8');
    writeFileSync(join(projectRoot, '.secret'), 'hidden\n', 'utf8');
    writeFileSync(join(projectRoot, 'readme.md'), '# Hello\n', 'utf8');
    writeFileSync(join(projectRoot, '.gitignore'), ['ignored.txt', 'ignored-dir/'].join('\n') + '\n', 'utf8');

    mock.method(console, 'error', () => {});
    mod = await import(filesRoutesUrl.href);

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
        const handled = await mod.handleFilesRoutes(ctx);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        }
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, () => resolve());
    });

    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
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

  it('GET /api/files lists entries and respects gitignore/exclude rules', async () => {
    const res = await requestJson(baseUrl, 'GET', `/api/files?path=${encodeURIComponent(projectRoot)}`);
    assert.equal(res.status, 200);
    assert.ok(res.json);
    assert.equal(Array.isArray(res.json.files), true);

    const names = res.json.files.map((f: any) => f.name);
    assert.ok(names.includes('subdir'));
    assert.ok(names.includes('visible.txt'));
    assert.ok(names.includes('.claude'));
    assert.ok(names.includes('.workflow'));

    // Hidden dotfiles (except .claude/.workflow) are excluded.
    assert.equal(names.includes('.secret'), false);
    // Common excluded dirs are always removed.
    assert.equal(names.includes('node_modules'), false);
    // .gitignore patterns should be enforced.
    assert.equal(names.includes('ignored.txt'), false);
    assert.equal(names.includes('ignored-dir'), false);
    assert.equal(Array.isArray(res.json.gitignorePatterns), true);
    assert.ok(res.json.gitignorePatterns.includes('ignored.txt'));
  });

  it('GET /api/files returns 400 for non-existent path', async () => {
    const missing = join(projectRoot, 'missing-dir');
    const res = await requestJson(baseUrl, 'GET', `/api/files?path=${encodeURIComponent(missing)}`);
    assert.equal(res.status, 400);
    assert.equal(res.json?.error, 'Invalid path');
    assert.equal(Array.isArray(res.json?.files), true);
    assert.equal(res.json.files.length, 0);
  });

  it('GET /api/files blocks traversal outside initialPath', async () => {
    const outside = join(projectRoot, '..');
    const res = await requestJson(baseUrl, 'GET', `/api/files?path=${encodeURIComponent(outside)}`);
    assert.equal(res.status, 403);
    assert.equal(res.json?.error, 'Access denied');
  });

  it('GET /api/file-content returns preview content for files', async () => {
    const target = join(projectRoot, 'readme.md');
    const res = await requestJson(baseUrl, 'GET', `/api/file-content?path=${encodeURIComponent(target)}`);
    assert.equal(res.status, 200);
    assert.ok(res.json);
    assert.equal(res.json.fileName, 'readme.md');
    assert.equal(res.json.language, 'markdown');
    assert.equal(res.json.isMarkdown, true);
    assert.ok(String(res.json.content).includes('# Hello'));
  });

  it('GET /api/file-content returns 400 when path is missing', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/file-content');
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  });

  it('GET /api/file-content returns 404 when path is a directory', async () => {
    const res = await requestJson(baseUrl, 'GET', `/api/file-content?path=${encodeURIComponent(projectRoot)}`);
    assert.equal(res.status, 404);
    assert.equal(res.json?.error, 'Cannot read directory');
  });
});
