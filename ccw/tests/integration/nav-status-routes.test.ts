/**
 * Integration tests for nav-status routes (badge count aggregation).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Calls route handler directly (no HTTP server required).
 * - Uses temporary HOME/USERPROFILE and project root to isolate filesystem reads.
 */

import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const navStatusRoutesUrl = new URL('../../dist/core/routes/nav-status-routes.js', import.meta.url);
navStatusRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

const originalEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

async function getNavStatus(projectRoot: string): Promise<{ status: number; json: any }> {
  const url = new URL('/api/nav-status', 'http://localhost');
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

  const handled = await mod.handleNavStatusRoutes({
    pathname: '/api/nav-status',
    url,
    req: { method: 'GET' },
    res,
    initialPath: projectRoot,
  });

  assert.equal(handled, true);
  return { status, json: JSON.parse(body) };
}

describe('nav-status routes integration', async () => {
  let homeDir = '';
  let projectRoot = '';

  before(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'ccw-nav-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-nav-project-'));

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.HOMEDRIVE = undefined;
    process.env.HOMEPATH = undefined;

    mock.method(console, 'error', () => {});
    mod = await import(navStatusRoutesUrl.href);
  });

  beforeEach(() => {
    // Reset relevant trees per test.
    rmSync(join(projectRoot, '.workflow'), { recursive: true, force: true });
    rmSync(join(projectRoot, '.claude'), { recursive: true, force: true });
    rmSync(join(homeDir, '.claude'), { recursive: true, force: true });

    const rootClaude = join(projectRoot, 'CLAUDE.md');
    if (existsSync(rootClaude)) rmSync(rootClaude, { force: true });
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

  it('returns zero counts when no data exists', async () => {
    const res = await getNavStatus(projectRoot);
    assert.equal(res.status, 200);
    assert.ok(res.json);

    for (const key of ['issues', 'discoveries', 'skills', 'rules', 'claude', 'hooks', 'timestamp']) {
      assert.ok(Object.prototype.hasOwnProperty.call(res.json, key), `missing key: ${key}`);
    }

    assert.equal(res.json.issues.count, 0);
    assert.equal(res.json.discoveries.count, 0);
    assert.equal(res.json.skills.count, 0);
    assert.equal(res.json.rules.count, 0);
    assert.equal(res.json.claude.count, 0);
    assert.equal(res.json.hooks.count, 0);
    assert.equal(typeof res.json.timestamp, 'string');
  });

  it('counts issues.jsonl lines and discovery index entries', async () => {
    const issuesDir = join(projectRoot, '.workflow', 'issues');
    const discoveriesDir = join(issuesDir, 'discoveries');
    mkdirSync(discoveriesDir, { recursive: true });

    writeFileSync(join(issuesDir, 'issues.jsonl'), '{"id":"ISS-1"}\n{"id":"ISS-2"}\n', 'utf8');
    writeFileSync(join(discoveriesDir, 'index.json'), JSON.stringify({ discoveries: [{ id: 'DSC-1' }, { id: 'DSC-2' }, { id: 'DSC-3' }] }), 'utf8');

    const res = await getNavStatus(projectRoot);
    assert.equal(res.status, 200);
    assert.equal(res.json.issues.count, 2);
    assert.equal(res.json.discoveries.count, 3);
  });

  it('aggregates skills, rules, CLAUDE.md files, and hooks across user/project', async () => {
    // Skills
    mkdirSync(join(projectRoot, '.claude', 'skills', 'proj-skill'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'skills', 'proj-skill', 'SKILL.md'), '# skill\n', 'utf8');
    mkdirSync(join(homeDir, '.claude', 'skills', 'user-skill-1'), { recursive: true });
    mkdirSync(join(homeDir, '.claude', 'skills', 'user-skill-2'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', 'skills', 'user-skill-1', 'SKILL.md'), '# skill\n', 'utf8');
    writeFileSync(join(homeDir, '.claude', 'skills', 'user-skill-2', 'SKILL.md'), '# skill\n', 'utf8');

    // Rules (recursive)
    mkdirSync(join(projectRoot, '.claude', 'rules', 'nested'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'rules', 'a.md'), '# a\n', 'utf8');
    writeFileSync(join(projectRoot, '.claude', 'rules', 'nested', 'b.md'), '# b\n', 'utf8');
    mkdirSync(join(homeDir, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', 'rules', 'c.md'), '# c\n', 'utf8');

    // CLAUDE.md files (user main + project main + root + module)
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', 'CLAUDE.md'), '# user\n', 'utf8');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'CLAUDE.md'), '# project\n', 'utf8');
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# root\n', 'utf8');
    const moduleDir = join(projectRoot, 'module-a');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, 'CLAUDE.md'), '# module\n', 'utf8');

    // Hooks in settings.json
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(
      join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{}, {}], PostToolUse: {} } }),
      'utf8',
    );
    writeFileSync(
      join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{}] } }),
      'utf8',
    );

    const res = await getNavStatus(projectRoot);
    assert.equal(res.status, 200);

    assert.equal(res.json.skills.project, 1);
    assert.equal(res.json.skills.user, 2);
    assert.equal(res.json.skills.count, 3);

    assert.equal(res.json.rules.project, 2);
    assert.equal(res.json.rules.user, 1);
    assert.equal(res.json.rules.count, 3);

    assert.equal(res.json.claude.count, 4);

    assert.equal(res.json.hooks.global, 3);
    assert.equal(res.json.hooks.project, 1);
    assert.equal(res.json.hooks.count, 4);
  });
});

