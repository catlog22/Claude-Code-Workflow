/**
 * Integration tests for skills routes (skills listing + details).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Calls route handler directly (no HTTP server required).
 * - Uses temporary HOME/USERPROFILE to isolate user skills directory.
 */

import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const skillsRoutesUrl = new URL('../../dist/core/routes/skills-routes.js', import.meta.url);
skillsRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

const originalEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

async function callSkills(
  initialPath: string,
  method: string,
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

  const handled = await mod.handleSkillsRoutes({
    pathname: url.pathname,
    url,
    req: { method },
    res,
    initialPath,
    handlePostRequest() {
      throw new Error('handlePostRequest should not be called for these tests');
    },
  });

  return { handled, status, json: body ? JSON.parse(body) : null };
}

describe('skills routes integration', async () => {
  let homeDir = '';
  let projectRoot = '';

  before(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'ccw-skills-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'ccw-skills-project-'));

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.HOMEDRIVE = undefined;
    process.env.HOMEPATH = undefined;

    mock.method(console, 'error', () => {});
    mod = await import(skillsRoutesUrl.href);
  });

  beforeEach(() => {
    rmSync(join(homeDir, '.claude'), { recursive: true, force: true });
    rmSync(join(projectRoot, '.claude'), { recursive: true, force: true });

    const skillDir = join(projectRoot, '.claude', 'skills', 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: "Test Skill"
description: "A test skill"
version: "1.0.0"
allowed-tools: [ccw issue next]
---

# Test
`,
      'utf8',
    );
    writeFileSync(join(skillDir, 'extra.txt'), 'extra', 'utf8');
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

  it('GET /api/skills lists projectSkills and userSkills', async () => {
    const res = await callSkills(projectRoot, 'GET', `/api/skills?path=${encodeURIComponent(projectRoot)}`);
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.json.projectSkills), true);
    assert.equal(Array.isArray(res.json.userSkills), true);
    assert.equal(res.json.projectSkills.length, 1);
    assert.equal(res.json.projectSkills[0].folderName, 'test-skill');
    assert.equal(res.json.projectSkills[0].name, 'Test Skill');
    assert.ok(res.json.projectSkills[0].supportingFiles.includes('extra.txt'));
  });

  it('GET /api/skills/:name returns skill detail with parsed content', async () => {
    const res = await callSkills(projectRoot, 'GET', `/api/skills/test-skill?location=project&path=${encodeURIComponent(projectRoot)}`);
    assert.equal(res.handled, true);
    assert.equal(res.status, 200);
    assert.equal(res.json.skill.folderName, 'test-skill');
    assert.equal(res.json.skill.name, 'Test Skill');
    assert.equal(Array.isArray(res.json.skill.allowedTools), true);
    assert.ok(String(res.json.skill.content).includes('# Test'));
  });

  it('returns 404 when skill is missing', async () => {
    const res = await callSkills(projectRoot, 'GET', `/api/skills/nope?location=project&path=${encodeURIComponent(projectRoot)}`);
    assert.equal(res.handled, true);
    assert.equal(res.status, 404);
    assert.ok(res.json.error);
  });
});

