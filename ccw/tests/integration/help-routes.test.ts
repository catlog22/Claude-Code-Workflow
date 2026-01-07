/**
 * Integration tests for help routes (command guide + CodexLens docs).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Avoids spinning up a real HTTP server; calls route handler directly.
 * - Uses a temporary HOME/USERPROFILE to isolate ~/.claude/skills/command-guide/index data.
 */

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const helpRoutesUrl = new URL('../../dist/core/routes/help-routes.js', import.meta.url);
helpRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

const originalEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

async function callRoute(path: string): Promise<{ handled: boolean; status: number; json: any; text: string }> {
  const url = new URL(path, 'http://localhost');
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

  const ctx = {
    pathname: url.pathname,
    url,
    req: { method: 'GET' },
    res,
  };

  const handled = await mod.handleHelpRoutes(ctx);

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { handled, status, json, text };
}

describe('help routes integration', async () => {
  let homeDir = '';

  before(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'ccw-help-home-'));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.HOMEDRIVE = undefined;
    process.env.HOMEPATH = undefined;

    mock.method(console, 'log', () => {});
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});

    const indexDir = join(homeDir, '.claude', 'skills', 'command-guide', 'index');
    mkdirSync(indexDir, { recursive: true });

    writeFileSync(
      join(indexDir, 'all-commands.json'),
      JSON.stringify(
        [
          { name: 'Issue Next', command: 'ccw issue next', description: 'Fetch next item', category: 'issue', subcategory: 'queue' },
          { name: 'Serve', command: 'ccw serve', description: 'Start dashboard server', category: 'core' },
        ],
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(indexDir, 'command-relationships.json'),
      JSON.stringify({ workflows: [{ name: 'Issue Queue', commands: ['ccw issue next', 'ccw issue done'] }] }, null, 2),
      'utf8',
    );

    writeFileSync(
      join(indexDir, 'by-category.json'),
      JSON.stringify({ issue: ['ccw issue next'], core: ['ccw serve'] }, null, 2),
      'utf8',
    );

    mod = await import(helpRoutesUrl.href);
  });

  after(() => {
    mock.restoreAll();
    process.env.HOME = originalEnv.HOME;
    process.env.USERPROFILE = originalEnv.USERPROFILE;
    process.env.HOMEDRIVE = originalEnv.HOMEDRIVE;
    process.env.HOMEPATH = originalEnv.HOMEPATH;

    const activeHandles: any[] = (process as any)._getActiveHandles?.() || [];
    for (const handle of activeHandles) {
      if (handle?.constructor?.name === 'FSWatcher' && typeof handle.close === 'function') {
        try {
          handle.close();
        } catch {
          // ignore
        }
      }
    }

    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
      homeDir = '';
    }
  });

  it('GET /api/help/commands returns commands and grouped categories', async () => {
    const res = await callRoute('/api/help/commands');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.json.commands), true);
    assert.equal(res.json.total, 2);
    assert.equal(typeof res.json.grouped, 'object');
    assert.ok(res.json.grouped.issue);
  });

  it('GET /api/help/commands?q filters commands by search query', async () => {
    const res = await callRoute('/api/help/commands?q=issue');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(res.json.total, 1);
    assert.equal(res.json.commands[0].command, 'ccw issue next');
  });

  it('GET /api/help/workflows returns workflow relationships data', async () => {
    const res = await callRoute('/api/help/workflows');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.json.workflows), true);
    assert.equal(res.json.workflows[0].name, 'Issue Queue');
  });

  it('GET /api/help/commands/by-category returns category index data', async () => {
    const res = await callRoute('/api/help/commands/by-category');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.json.issue), true);
    assert.equal(res.json.issue[0], 'ccw issue next');
  });

  it('GET /api/help/codexlens returns CodexLens quick start content', async () => {
    const res = await callRoute('/api/help/codexlens');
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(res.json.title, 'CodexLens Quick Start');
    assert.equal(Array.isArray(res.json.sections), true);
    assert.ok(res.json.sections.length > 0);
  });
});

