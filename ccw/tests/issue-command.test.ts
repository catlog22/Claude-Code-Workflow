/**
 * Unit tests for issue command module (ccw issue)
 *
 * Notes:
 * - Targets the runtime implementation shipped in `ccw/dist`.
 * - Uses isolated temp directories to avoid touching the real `.workflow/` tree.
 */

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import inquirer from 'inquirer';

const issueCommandUrl = new URL('../dist/commands/issue.js', import.meta.url).href;

interface TestIssuesEnv {
  projectDir: string;
  workflowDir: string;
  issuesDir: string;
  solutionsDir: string;
  queuesDir: string;
}

const ORIGINAL_CWD = process.cwd();

function setupTestIssuesDir(): TestIssuesEnv {
  const projectDir = mkdtempSync(join(tmpdir(), 'ccw-issue-cmd-'));
  const workflowDir = join(projectDir, '.workflow');
  const issuesDir = join(workflowDir, 'issues');
  const solutionsDir = join(issuesDir, 'solutions');
  const queuesDir = join(issuesDir, 'queues');

  mkdirSync(solutionsDir, { recursive: true });
  mkdirSync(queuesDir, { recursive: true });

  process.chdir(projectDir);

  return { projectDir, workflowDir, issuesDir, solutionsDir, queuesDir };
}

function cleanupTestIssuesDir(env: TestIssuesEnv): void {
  process.chdir(ORIGINAL_CWD);
  rmSync(env.projectDir, { recursive: true, force: true });
}

type MockIssue = {
  id: string;
  title: string;
  status: string;
  priority: number;
  context: string;
  bound_solution_id: string | null;
  created_at: string;
  updated_at: string;
};

type MockSolution = {
  id: string;
  tasks: unknown[];
  is_bound: boolean;
  created_at: string;
  bound_at?: string;
  description?: string;
  approach?: string;
  exploration_context?: Record<string, unknown>;
  analysis?: { risk?: string; impact?: string; complexity?: string };
  score?: number;
};

function createMockIssue(overrides: Partial<MockIssue> = {}): MockIssue {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'ISS-TEST-001',
    title: overrides.title ?? 'Test issue',
    status: overrides.status ?? 'registered',
    priority: overrides.priority ?? 3,
    context: overrides.context ?? 'Test context',
    bound_solution_id: overrides.bound_solution_id ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    ...overrides,
  };
}

function createMockSolution(overrides: Partial<MockSolution> = {}): MockSolution {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'SOL-ISS-TEST-001-1',
    tasks: overrides.tasks ?? [],
    is_bound: overrides.is_bound ?? false,
    created_at: overrides.created_at ?? now,
    bound_at: overrides.bound_at,
    description: overrides.description,
    approach: overrides.approach,
    exploration_context: overrides.exploration_context,
    analysis: overrides.analysis,
    score: overrides.score,
    ...overrides,
  };
}

function readJsonl(path: string): any[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

class ExitError extends Error {
  code?: number;

  constructor(code?: number) {
    super(`process.exit(${code ?? 'undefined'})`);
    this.code = code;
  }
}

async function expectProcessExit(fn: () => Promise<unknown>, code = 1): Promise<void> {
  mock.method(process as any, 'exit', (exitCode?: number) => {
    throw new ExitError(exitCode);
  });

  await assert.rejects(
    fn(),
    (err: any) => err instanceof ExitError && err.code === code,
  );
}

describe('issue command module', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let issueModule: any;
  let env: TestIssuesEnv | null = null;

  beforeEach(() => {
    mock.restoreAll();
    env = setupTestIssuesDir();
  });

  afterEach(() => {
    if (env) cleanupTestIssuesDir(env);
    env = null;
    mock.restoreAll();
  });

  it('setup/teardown creates isolated temp directories', () => {
    assert.ok(env);
    assert.ok(existsSync(env.workflowDir));
    assert.ok(existsSync(env.issuesDir));
    assert.ok(existsSync(env.solutionsDir));
    assert.ok(existsSync(env.queuesDir));
    assert.ok(resolve(process.cwd()).startsWith(resolve(env.projectDir)));
  });

  it('mock generators produce schema-shaped objects', () => {
    const issue = createMockIssue();
    assert.equal(typeof issue.id, 'string');
    assert.equal(typeof issue.title, 'string');
    assert.equal(typeof issue.status, 'string');
    assert.equal(typeof issue.priority, 'number');
    assert.equal(typeof issue.context, 'string');
    assert.ok(issue.created_at);
    assert.ok(issue.updated_at);
    assert.equal(issue.bound_solution_id, null);

    const solution = createMockSolution();
    assert.equal(typeof solution.id, 'string');
    assert.ok(Array.isArray(solution.tasks));
    assert.equal(typeof solution.is_bound, 'boolean');
    assert.ok(solution.created_at);
  });

  it('writes issue data under the temp .workflow directory', async () => {
    issueModule ??= await import(issueCommandUrl);

    assert.ok(env);
    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});

    issueModule.writeIssues([createMockIssue({ id: 'ISS-TEST-WRITE' })]);
    const issuesJsonlPath = join(env.issuesDir, 'issues.jsonl');
    assert.ok(existsSync(issuesJsonlPath));
    assert.match(readFileSync(issuesJsonlPath, 'utf8'), /ISS-TEST-WRITE/);
  });

  describe('JSONL Operations', () => {
    it('readIssues returns [] when issues.jsonl is missing', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.deepEqual(issueModule.readIssues(), []);
    });

    it('writeIssues writes newline-delimited JSON with trailing newline', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      issueModule.writeIssues([
        createMockIssue({ id: 'ISS-JSONL-1' }),
        createMockIssue({ id: 'ISS-JSONL-2' }),
      ]);

      const issuesJsonlPath = join(env.issuesDir, 'issues.jsonl');
      const content = readFileSync(issuesJsonlPath, 'utf8');
      assert.ok(content.endsWith('\n'));

      const lines = content.split('\n').filter((line) => line.trim().length > 0);
      assert.equal(lines.length, 2);
      assert.deepEqual(lines.map((l) => JSON.parse(l).id), ['ISS-JSONL-1', 'ISS-JSONL-2']);
      assert.deepEqual(issueModule.readIssues().map((i: any) => i.id), ['ISS-JSONL-1', 'ISS-JSONL-2']);
    });

    it('readIssues returns [] for corrupted JSONL', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      writeFileSync(join(env.issuesDir, 'issues.jsonl'), '{bad json}\n', 'utf8');
      assert.deepEqual(issueModule.readIssues(), []);
    });

    it('readIssues returns [] when issues.jsonl is a directory', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mkdirSync(join(env.issuesDir, 'issues.jsonl'), { recursive: true });
      assert.deepEqual(issueModule.readIssues(), []);
    });

    it('writeIssues throws when issues.jsonl is a directory', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mkdirSync(join(env.issuesDir, 'issues.jsonl'), { recursive: true });
      assert.throws(() => issueModule.writeIssues([createMockIssue({ id: 'ISS-WRITE-ERR' })]));
    });

    it('readSolutions returns [] when solution JSONL is missing', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.deepEqual(issueModule.readSolutions('ISS-NO-SOL'), []);
    });

    it('writeSolutions writes newline-delimited JSON with trailing newline', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      issueModule.writeSolutions('ISS-SOL-1', [
        createMockSolution({ id: 'SOL-ISS-SOL-1-1' }),
        createMockSolution({ id: 'SOL-ISS-SOL-1-2' }),
      ]);

      const solutionsPath = join(env.solutionsDir, 'ISS-SOL-1.jsonl');
      const content = readFileSync(solutionsPath, 'utf8');
      assert.ok(content.endsWith('\n'));

      const lines = content.split('\n').filter((line) => line.trim().length > 0);
      assert.equal(lines.length, 2);
      assert.deepEqual(lines.map((l) => JSON.parse(l).id), ['SOL-ISS-SOL-1-1', 'SOL-ISS-SOL-1-2']);
      assert.deepEqual(issueModule.readSolutions('ISS-SOL-1').map((s: any) => s.id), ['SOL-ISS-SOL-1-1', 'SOL-ISS-SOL-1-2']);
    });

    it('writeSolutions overwrites with full list (append via read->push->write)', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      issueModule.writeSolutions('ISS-SOL-APPEND', [createMockSolution({ id: 'SOL-ISS-SOL-APPEND-1' })]);
      issueModule.writeSolutions('ISS-SOL-APPEND', [
        createMockSolution({ id: 'SOL-ISS-SOL-APPEND-1' }),
        createMockSolution({ id: 'SOL-ISS-SOL-APPEND-2' }),
      ]);

      const ids = issueModule.readSolutions('ISS-SOL-APPEND').map((s: any) => s.id);
      assert.deepEqual(ids, ['SOL-ISS-SOL-APPEND-1', 'SOL-ISS-SOL-APPEND-2']);
    });

    it('readSolutions returns [] for corrupted JSONL', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      writeFileSync(join(env.solutionsDir, 'ISS-SOL-BAD.jsonl'), '{bad json}\n', 'utf8');
      assert.deepEqual(issueModule.readSolutions('ISS-SOL-BAD'), []);
    });

    it('writeSolutions throws when target path is a directory', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mkdirSync(join(env.solutionsDir, 'ISS-SOL-DIR.jsonl'), { recursive: true });
      assert.throws(() => issueModule.writeSolutions('ISS-SOL-DIR', [createMockSolution({ id: 'SOL-X' })]));
    });
  });

  describe('Issue Lifecycle', () => {
    it('transitions registered → planning → planned → queued → executing → completed', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});
      mock.method(console, 'warn', () => {});

      const issueId = 'ISS-LC-1';
      const solutionId = 'SOL-ISS-LC-1-1';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'registered' })]);
      issueModule.writeSolutions(issueId, [createMockSolution({ id: solutionId, is_bound: false })]);

      await issueModule.issueCommand('update', [issueId], { status: 'planning' });
      assert.equal(issueModule.readIssues().find((i: any) => i.id === issueId)?.status, 'planning');

      await issueModule.issueCommand('bind', [issueId, solutionId], {});
      const planned = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(planned?.status, 'planned');
      assert.equal(planned?.bound_solution_id, solutionId);
      assert.ok(planned?.planned_at);

      await issueModule.issueCommand('queue', ['add', issueId], {});
      const queued = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(queued?.status, 'queued');
      assert.ok(queued?.queued_at);

      await issueModule.issueCommand('next', [], {});
      const executing = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(executing?.status, 'executing');

      const queue = issueModule.readQueue();
      assert.ok(queue);
      const itemId = (queue.solutions || queue.tasks || [])[0]?.item_id;
      assert.equal(itemId, 'S-1');

      await issueModule.issueCommand('done', [itemId], {});

      // Completed issues are auto-moved to history.
      assert.equal(issueModule.readIssues().some((i: any) => i.id === issueId), false);
      const history = readJsonl(join(env.issuesDir, 'issue-history.jsonl'));
      const completed = history.find((i: any) => i.id === issueId);
      assert.equal(completed?.status, 'completed');
      assert.ok(completed?.completed_at);
    });

    it('transitions executing → failed when done is called with --fail', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});
      mock.method(console, 'warn', () => {});

      const issueId = 'ISS-LC-FAIL';
      const solutionId = 'SOL-ISS-LC-FAIL-1';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'registered' })]);
      issueModule.writeSolutions(issueId, [createMockSolution({ id: solutionId, is_bound: true })]);

      // Directly queue (already bound)
      await issueModule.issueCommand('queue', ['add', issueId], {});
      await issueModule.issueCommand('next', [], {});

      const queue = issueModule.readQueue();
      assert.ok(queue);
      const itemId = (queue.solutions || queue.tasks || [])[0]?.item_id;

      await issueModule.issueCommand('done', [itemId], { fail: true, reason: 'boom' });

      const failed = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(failed?.status, 'failed');

      const updatedQueue = issueModule.readQueue(queue.id);
      const updatedItem = (updatedQueue?.solutions || updatedQueue?.tasks || []).find((i: any) => i.item_id === itemId);
      assert.equal(updatedItem?.status, 'failed');
      assert.ok(updatedItem?.completed_at);
      assert.equal(updatedItem?.failure_reason, 'boom');
    });

    it('update sets planned_at when status is set to planned', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-UPD-PLANNED';
      const oldUpdatedAt = '2000-01-01T00:00:00.000Z';
      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planning', updated_at: oldUpdatedAt })]);

      await issueModule.issueCommand('update', [issueId], { status: 'planned' });

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'planned');
      assert.ok(issue?.planned_at);
      assert.notEqual(issue?.updated_at, oldUpdatedAt);
    });

    it('update sets queued_at when status is set to queued', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-UPD-QUEUED';
      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planned' })]);

      await issueModule.issueCommand('update', [issueId], { status: 'queued' });

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'queued');
      assert.ok(issue?.queued_at);
    });

    it('update rejects invalid status values', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-UPD-BAD';
      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'registered' })]);

      await expectProcessExit(() => issueModule.issueCommand('update', [issueId], { status: 'not-a-status' }), 1);

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'registered');
    });

    it('update to completed moves issue to history', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-UPD-COMPLETE';
      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'executing' })]);

      await issueModule.issueCommand('update', [issueId], { status: 'completed' });

      assert.equal(issueModule.readIssues().some((i: any) => i.id === issueId), false);
      const history = readJsonl(join(env.issuesDir, 'issue-history.jsonl'));
      const completed = history.find((i: any) => i.id === issueId);
      assert.equal(completed?.status, 'completed');
      assert.ok(completed?.completed_at);
    });

    it('queue add fails when issue has no bound solution', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-QUEUE-NO-SOL';
      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planned' })]);

      await expectProcessExit(() => issueModule.issueCommand('queue', ['add', issueId], {}), 1);

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'planned');
    });

    it('next returns empty when no active queues exist', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const logs: string[] = [];
      mock.method(console, 'log', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
      mock.method(console, 'error', () => {});

      await issueModule.issueCommand('next', [], {});

      const payload = JSON.parse(logs.at(-1) || '{}');
      assert.equal(payload.status, 'empty');
      assert.match(payload.message, /No active queues/);
    });
  });

  describe('Solution Binding', () => {
    it('binds a solution and marks the issue as planned', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-BIND-1';
      const solutionId = 'SOL-ISS-BIND-1-1';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planning' })]);
      issueModule.writeSolutions(issueId, [createMockSolution({ id: solutionId, is_bound: false })]);

      await issueModule.issueCommand('bind', [issueId, solutionId], {});

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'planned');
      assert.equal(issue?.bound_solution_id, solutionId);
      assert.ok(issue?.planned_at);

      const solutions = issueModule.readSolutions(issueId);
      assert.equal(solutions.length, 1);
      assert.equal(solutions[0].id, solutionId);
      assert.equal(solutions[0].is_bound, true);
      assert.ok(solutions[0].bound_at);
    });

    it('binding a second solution unbinds the previous one', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-BIND-2';
      const sol1 = 'SOL-ISS-BIND-2-1';
      const sol2 = 'SOL-ISS-BIND-2-2';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planning' })]);
      issueModule.writeSolutions(issueId, [
        createMockSolution({ id: sol1, is_bound: false }),
        createMockSolution({ id: sol2, is_bound: false }),
      ]);

      await issueModule.issueCommand('bind', [issueId, sol1], {});
      await issueModule.issueCommand('bind', [issueId, sol2], {});

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.bound_solution_id, sol2);
      assert.equal(issue?.status, 'planned');

      const solutions = issueModule.readSolutions(issueId);
      const bound = solutions.filter((s: any) => s.is_bound);
      assert.equal(bound.length, 1);
      assert.equal(bound[0].id, sol2);
      assert.equal(solutions.find((s: any) => s.id === sol1)?.is_bound, false);
    });

    it('bind fails when the requested solution does not exist', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-BIND-ERR';
      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planning' })]);
      issueModule.writeSolutions(issueId, [createMockSolution({ id: 'SOL-ISS-BIND-ERR-1', is_bound: false })]);

      await expectProcessExit(() => issueModule.issueCommand('bind', [issueId, 'SOL-NOT-FOUND'], {}), 1);
    });

    it('bind fails when issue does not exist', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      await expectProcessExit(() => issueModule.issueCommand('bind', ['ISS-NOT-FOUND', 'SOL-ISS-NOT-FOUND-1'], {}), 1);
    });

    it('bind lists available solutions when solution id is omitted', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const logs: string[] = [];
      mock.method(console, 'log', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-BIND-LIST';
      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planning' })]);
      issueModule.writeSolutions(issueId, [
        createMockSolution({ id: 'SOL-ISS-BIND-LIST-1', is_bound: false }),
        createMockSolution({ id: 'SOL-ISS-BIND-LIST-2', is_bound: false }),
      ]);

      await issueModule.issueCommand('bind', [issueId], {});

      const output = logs.join('\n');
      assert.match(output, new RegExp(`Solutions for ${issueId}`));
      assert.match(output, /SOL-ISS-BIND-LIST-1/);
      assert.match(output, /SOL-ISS-BIND-LIST-2/);

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.bound_solution_id, null);
      assert.equal(issue?.status, 'planning');
    });

    it('bind --solution registers and binds a solution file', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-BIND-FILE';
      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planning' })]);

      const solutionPath = join(env.projectDir, 'solution.json');
      writeFileSync(solutionPath, JSON.stringify({ description: 'From file', tasks: [{ id: 'T1' }] }), 'utf8');

      await issueModule.issueCommand('bind', [issueId], { solution: solutionPath });

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'planned');
      assert.ok(issue?.bound_solution_id);
      assert.match(issue.bound_solution_id, new RegExp(`^SOL-${issueId}-\\d+$`));

      const solutions = issueModule.readSolutions(issueId);
      assert.equal(solutions.length, 1);
      assert.equal(solutions[0].id, issue.bound_solution_id);
      assert.equal(solutions[0].is_bound, true);
      assert.ok(solutions[0].bound_at);
      assert.equal(Array.isArray(solutions[0].tasks), true);
      assert.equal(solutions[0].tasks.length, 1);
    });
  });

  describe('Queue Formation', () => {
    function makeSolutionWithFiles(id: string, files: string[], isBound = true): MockSolution {
      return createMockSolution({
        id,
        is_bound: isBound,
        tasks: [
          {
            id: 'T1',
            modification_points: files.map((file) => ({ file, target: 'x', change: 'y' })),
          },
        ],
      });
    }

    it('creates an active queue with a solution-level item', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-QUEUE-1';
      const solutionId = 'SOL-ISS-QUEUE-1-1';
      const files = ['src/a.ts', 'src/b.ts'];

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planned', bound_solution_id: solutionId })]);
      issueModule.writeSolutions(issueId, [makeSolutionWithFiles(solutionId, files, true)]);

      await issueModule.issueCommand('queue', ['add', issueId], {});

      const queue = issueModule.readQueue();
      assert.ok(queue);
      assert.ok(typeof queue.id === 'string' && queue.id.startsWith('QUE-'));
      assert.equal(queue.status, 'active');
      assert.ok(queue.issue_ids.includes(issueId));

      const items = queue.solutions || [];
      assert.equal(items.length, 1);
      assert.equal(items[0].item_id, 'S-1');
      assert.equal(items[0].issue_id, issueId);
      assert.equal(items[0].solution_id, solutionId);
      assert.equal(items[0].status, 'pending');
      assert.equal(items[0].execution_order, 1);
      assert.equal(items[0].execution_group, 'P1');
      assert.deepEqual(items[0].files_touched?.sort(), files.slice().sort());

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'queued');
    });

    it('generates queue IDs in QUE-YYYYMMDDHHMMSS format', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-QUEUE-ID';
      const solutionId = 'SOL-ISS-QUEUE-ID-1';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planned', bound_solution_id: solutionId })]);
      issueModule.writeSolutions(issueId, [makeSolutionWithFiles(solutionId, ['src/a.ts'], true)]);

      await issueModule.issueCommand('queue', ['add', issueId], {});

      const queue = issueModule.readQueue();
      assert.ok(queue);
      assert.match(queue.id, /^QUE-\d{14}$/);
    });

    it('does not add duplicate solution items to the queue', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-QUEUE-DUPE';
      const solutionId = 'SOL-ISS-QUEUE-DUPE-1';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planned', bound_solution_id: solutionId })]);
      issueModule.writeSolutions(issueId, [makeSolutionWithFiles(solutionId, ['src/a.ts'], true)]);

      await issueModule.issueCommand('queue', ['add', issueId], {});
      await issueModule.issueCommand('queue', ['add', issueId], {});

      const queue = issueModule.readQueue();
      assert.ok(queue);
      const items = queue.solutions || [];
      assert.equal(items.length, 1);
      assert.equal(items[0].issue_id, issueId);
      assert.equal(items[0].solution_id, solutionId);
    });

    it('deduplicates files_touched extracted from modification_points', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issueId = 'ISS-QUEUE-FILES';
      const solutionId = 'SOL-ISS-QUEUE-FILES-1';
      const files = ['src/dup.ts', 'src/dup.ts', 'src/other.ts', 'src/dup.ts'];

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planned', bound_solution_id: solutionId })]);
      issueModule.writeSolutions(issueId, [makeSolutionWithFiles(solutionId, files, true)]);

      await issueModule.issueCommand('queue', ['add', issueId], {});

      const queue = issueModule.readQueue();
      assert.ok(queue);
      const items = queue.solutions || [];
      assert.equal(items.length, 1);
      assert.deepEqual(items[0].files_touched?.sort(), ['src/dup.ts', 'src/other.ts']);
    });

    it('adds multiple issues to the same active queue with incrementing item IDs', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const issue1 = 'ISS-QUEUE-M-1';
      const issue2 = 'ISS-QUEUE-M-2';

      issueModule.writeIssues([
        createMockIssue({ id: issue1, status: 'planned' }),
        createMockIssue({ id: issue2, status: 'planned' }),
      ]);
      issueModule.writeSolutions(issue1, [makeSolutionWithFiles('SOL-ISS-QUEUE-M-1-1', ['src/one.ts'], true)]);
      issueModule.writeSolutions(issue2, [makeSolutionWithFiles('SOL-ISS-QUEUE-M-2-1', ['src/two.ts'], true)]);

      await issueModule.issueCommand('queue', ['add', issue1], {});
      await issueModule.issueCommand('queue', ['add', issue2], {});

      const queue = issueModule.readQueue();
      assert.ok(queue);
      const items = queue.solutions || [];
      assert.equal(items.length, 2);
      assert.deepEqual(items.map((i: any) => i.item_id), ['S-1', 'S-2']);
      assert.deepEqual(items.map((i: any) => i.execution_order), [1, 2]);
      assert.ok(queue.issue_ids.includes(issue1));
      assert.ok(queue.issue_ids.includes(issue2));
    });

    it('queue dag batches non-conflicting items together', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const logs: string[] = [];
      mock.method(console, 'log', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
      mock.method(console, 'error', () => {});

      const issue1 = 'ISS-DAG-1';
      const issue2 = 'ISS-DAG-2';
      issueModule.writeIssues([createMockIssue({ id: issue1 }), createMockIssue({ id: issue2 })]);
      issueModule.writeSolutions(issue1, [makeSolutionWithFiles('SOL-ISS-DAG-1-1', ['src/a.ts'], true)]);
      issueModule.writeSolutions(issue2, [makeSolutionWithFiles('SOL-ISS-DAG-2-1', ['src/b.ts'], true)]);

      await issueModule.issueCommand('queue', ['add', issue1], {});
      await issueModule.issueCommand('queue', ['add', issue2], {});

      logs.length = 0;
      await issueModule.issueCommand('queue', ['dag'], {});

      const payload = JSON.parse(logs.at(-1) || '{}');
      assert.deepEqual(payload.parallel_batches, [['S-1', 'S-2']]);
      assert.equal(payload._summary.batches_needed, 1);
    });

    it('queue dag separates conflicting items into multiple batches', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const logs: string[] = [];
      mock.method(console, 'log', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
      mock.method(console, 'error', () => {});

      const shared = 'src/shared.ts';
      const issue1 = 'ISS-DAG-C-1';
      const issue2 = 'ISS-DAG-C-2';
      issueModule.writeIssues([createMockIssue({ id: issue1 }), createMockIssue({ id: issue2 })]);
      issueModule.writeSolutions(issue1, [makeSolutionWithFiles('SOL-ISS-DAG-C-1-1', [shared], true)]);
      issueModule.writeSolutions(issue2, [makeSolutionWithFiles('SOL-ISS-DAG-C-2-1', [shared], true)]);

      await issueModule.issueCommand('queue', ['add', issue1], {});
      await issueModule.issueCommand('queue', ['add', issue2], {});

      logs.length = 0;
      await issueModule.issueCommand('queue', ['dag'], {});

      const payload = JSON.parse(logs.at(-1) || '{}');
      assert.equal(payload.parallel_batches.length, 2);
      assert.deepEqual(payload.parallel_batches[0], ['S-1']);
      assert.deepEqual(payload.parallel_batches[1], ['S-2']);
    });

    it('queue dag builds edges for depends_on and marks blocked items', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const logs: string[] = [];
      mock.method(console, 'log', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
      mock.method(console, 'error', () => {});

      const queueId = 'QUE-20260107000000';
      issueModule.writeQueue({
        id: queueId,
        status: 'active',
        issue_ids: ['ISS-DEP'],
        tasks: [],
        solutions: [
          {
            item_id: 'S-1',
            issue_id: 'ISS-DEP',
            solution_id: 'SOL-ISS-DEP-1',
            status: 'pending',
            execution_order: 1,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            files_touched: ['src/a.ts'],
            task_count: 1,
          },
          {
            item_id: 'S-2',
            issue_id: 'ISS-DEP',
            solution_id: 'SOL-ISS-DEP-2',
            status: 'pending',
            execution_order: 2,
            execution_group: 'P1',
            depends_on: ['S-1'],
            semantic_priority: 0.5,
            files_touched: ['src/b.ts'],
            task_count: 1,
          },
        ],
        conflicts: [],
      });

      await issueModule.issueCommand('queue', ['dag', queueId], {});
      const payload = JSON.parse(logs.at(-1) || '{}');

      assert.deepEqual(payload.edges, [{ from: 'S-1', to: 'S-2' }]);
      const node1 = payload.nodes.find((n: any) => n.id === 'S-1');
      const node2 = payload.nodes.find((n: any) => n.id === 'S-2');
      assert.equal(node1.ready, true);
      assert.equal(node2.ready, false);
      assert.deepEqual(node2.blocked_by, ['S-1']);
      assert.deepEqual(payload.parallel_batches, [['S-1']]);
    });

    it('prompts for confirmation before deleting a queue (and cancels safely)', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const logs: string[] = [];
      mock.method(console, 'log', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
      mock.method(console, 'error', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });

      const queueId = 'QUE-DELETE-CANCEL';
      issueModule.writeQueue({
        id: queueId,
        status: 'completed',
        issue_ids: [],
        tasks: [],
        solutions: [],
        conflicts: [],
      });

      const promptCalls: any[] = [];
      mock.method(inquirer, 'prompt', async (questions: any) => {
        promptCalls.push(questions);
        return { proceed: false };
      });

      await issueModule.issueCommand('queue', ['delete', queueId], {});

      assert.equal(promptCalls.length, 1);
      assert.equal(promptCalls[0][0].type, 'confirm');
      assert.equal(promptCalls[0][0].default, false);
      assert.ok(promptCalls[0][0].message.includes(queueId));
      assert.ok(logs.some((l) => l.includes('Queue deletion cancelled')));
      assert.ok(existsSync(join(env.queuesDir, `${queueId}.json`)));
    });

    it('deletes a queue after interactive confirmation', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const queueId = 'QUE-DELETE-CONFIRM';
      issueModule.writeQueue({
        id: queueId,
        status: 'completed',
        issue_ids: [],
        tasks: [],
        solutions: [],
        conflicts: [],
      });

      mock.method(inquirer, 'prompt', async () => ({ proceed: true }));

      await issueModule.issueCommand('queue', ['delete', queueId], {});

      assert.equal(existsSync(join(env.queuesDir, `${queueId}.json`)), false);
    });

    it('bypasses confirmation prompt when --force is set for queue delete', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const queueId = 'QUE-DELETE-FORCE';
      issueModule.writeQueue({
        id: queueId,
        status: 'completed',
        issue_ids: [],
        tasks: [],
        solutions: [],
        conflicts: [],
      });

      mock.method(inquirer, 'prompt', async () => {
        throw new Error('inquirer.prompt should not be called when --force is set');
      });

      await issueModule.issueCommand('queue', ['delete', queueId], { force: true });

      assert.equal(existsSync(join(env.queuesDir, `${queueId}.json`)), false);
    });
  });

  describe('Queue Execution', () => {
    async function runNext(queueId: string): Promise<any> {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const logs: string[] = [];
      mock.method(console, 'log', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
      mock.method(console, 'error', () => {});
      mock.method(console, 'warn', () => {});

      await issueModule.issueCommand('next', [], { queue: queueId });
      return JSON.parse(logs.at(-1) || '{}');
    }

    it('next respects dependencies and advances after done()', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});
      mock.method(console, 'warn', () => {});

      const queueId = 'QUE-20260107010101';
      const issue1 = 'ISS-NEXT-1';
      const issue2 = 'ISS-NEXT-2';
      const sol1 = 'SOL-ISS-NEXT-1-1';
      const sol2 = 'SOL-ISS-NEXT-2-1';

      issueModule.writeIssues([createMockIssue({ id: issue1, status: 'queued' }), createMockIssue({ id: issue2, status: 'queued' })]);
      issueModule.writeSolutions(issue1, [createMockSolution({ id: sol1, is_bound: false })]);
      issueModule.writeSolutions(issue2, [createMockSolution({ id: sol2, is_bound: false })]);

      issueModule.writeQueue({
        id: queueId,
        status: 'active',
        issue_ids: [issue1, issue2],
        tasks: [],
        solutions: [
          {
            item_id: 'S-1',
            issue_id: issue1,
            solution_id: sol1,
            status: 'pending',
            execution_order: 1,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            task_count: 1,
          },
          {
            item_id: 'S-2',
            issue_id: issue2,
            solution_id: sol2,
            status: 'pending',
            execution_order: 2,
            execution_group: 'P1',
            depends_on: ['S-1'],
            semantic_priority: 0.5,
            task_count: 1,
          },
        ],
        conflicts: [],
      });

      mock.restoreAll();
      const first = await runNext(queueId);
      assert.equal(first.item_id, 'S-1');

      // Mark S-1 complete so S-2 becomes ready.
      mock.restoreAll();
      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});
      await issueModule.issueCommand('done', ['S-1'], { queue: queueId });

      mock.restoreAll();
      const second = await runNext(queueId);
      assert.equal(second.item_id, 'S-2');
    });

    it('next selects lowest execution_order among ready items', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const queueId = 'QUE-20260107011111';
      const issue1 = 'ISS-ORDER-1';
      const issue2 = 'ISS-ORDER-2';
      const sol1 = 'SOL-ISS-ORDER-1-1';
      const sol2 = 'SOL-ISS-ORDER-2-1';

      issueModule.writeIssues([createMockIssue({ id: issue1, status: 'queued' }), createMockIssue({ id: issue2, status: 'queued' })]);
      issueModule.writeSolutions(issue1, [createMockSolution({ id: sol1, is_bound: false })]);
      issueModule.writeSolutions(issue2, [createMockSolution({ id: sol2, is_bound: false })]);

      issueModule.writeQueue({
        id: queueId,
        status: 'active',
        issue_ids: [issue1, issue2],
        tasks: [],
        solutions: [
          {
            item_id: 'S-1',
            issue_id: issue1,
            solution_id: sol1,
            status: 'pending',
            execution_order: 2,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            task_count: 1,
          },
          {
            item_id: 'S-2',
            issue_id: issue2,
            solution_id: sol2,
            status: 'pending',
            execution_order: 1,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            task_count: 1,
          },
        ],
        conflicts: [],
      });

      const next = await runNext(queueId);
      assert.equal(next.item_id, 'S-2');
    });

    it('next skips failed items when auto-selecting', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const queueId = 'QUE-20260107020202';
      const issue1 = 'ISS-SKIP-1';
      const issue2 = 'ISS-SKIP-2';
      const sol1 = 'SOL-ISS-SKIP-1-1';
      const sol2 = 'SOL-ISS-SKIP-2-1';

      issueModule.writeIssues([createMockIssue({ id: issue1, status: 'queued' }), createMockIssue({ id: issue2, status: 'queued' })]);
      issueModule.writeSolutions(issue1, [createMockSolution({ id: sol1, is_bound: false })]);
      issueModule.writeSolutions(issue2, [createMockSolution({ id: sol2, is_bound: false })]);

      issueModule.writeQueue({
        id: queueId,
        status: 'active',
        issue_ids: [issue1, issue2],
        tasks: [],
        solutions: [
          {
            item_id: 'S-1',
            issue_id: issue1,
            solution_id: sol1,
            status: 'failed',
            execution_order: 1,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            failure_reason: 'nope',
            task_count: 1,
          },
          {
            item_id: 'S-2',
            issue_id: issue2,
            solution_id: sol2,
            status: 'pending',
            execution_order: 2,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            task_count: 1,
          },
        ],
        conflicts: [],
      });

      const next = await runNext(queueId);
      assert.equal(next.item_id, 'S-2');
    });

    it('done stores parsed result JSON on the queue item', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});
      mock.method(console, 'warn', () => {});

      const queueId = 'QUE-20260107022222';
      const issueId = 'ISS-DONE-RESULT';
      const solutionId = 'SOL-ISS-DONE-RESULT-1';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'executing' })]);
      issueModule.writeQueue({
        id: queueId,
        status: 'active',
        issue_ids: [issueId],
        tasks: [],
        solutions: [
          {
            item_id: 'S-1',
            issue_id: issueId,
            solution_id: solutionId,
            status: 'executing',
            execution_order: 1,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            started_at: new Date().toISOString(),
            task_count: 1,
          },
        ],
        conflicts: [],
      });

      await issueModule.issueCommand('done', ['S-1'], { queue: queueId, result: '{"ok":true,"n":1}' });

      const updatedQueue = issueModule.readQueue(queueId);
      assert.equal(updatedQueue?.status, 'completed');
      const item = (updatedQueue?.solutions || []).find((i: any) => i.item_id === 'S-1');
      assert.equal(item?.status, 'completed');
      assert.ok(item?.completed_at);
      assert.deepEqual(item?.result, { ok: true, n: 1 });
    });

    it('retry resets failed items to pending and clears failure fields', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});
      mock.method(console, 'warn', () => {});

      const queueId = 'QUE-20260107030303';
      const issueId = 'ISS-RETRY-1';
      const solutionId = 'SOL-ISS-RETRY-1-1';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'failed' })]);
      issueModule.writeSolutions(issueId, [createMockSolution({ id: solutionId, is_bound: false })]);

      issueModule.writeQueue({
        id: queueId,
        status: 'failed',
        issue_ids: [issueId],
        tasks: [],
        solutions: [
          {
            item_id: 'S-1',
            issue_id: issueId,
            solution_id: solutionId,
            status: 'failed',
            execution_order: 1,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            failure_reason: 'boom',
            failure_details: { error_type: 'test_failure', message: 'boom', timestamp: new Date().toISOString() },
            task_count: 1,
          },
        ],
        conflicts: [],
      });

      await issueModule.issueCommand('retry', [issueId], { queue: queueId });

      const updatedQueue = issueModule.readQueue(queueId);
      const item = (updatedQueue?.solutions || []).find((i: any) => i.item_id === 'S-1');
      assert.equal(updatedQueue?.status, 'active');
      assert.equal(item?.status, 'pending');
      assert.equal(item?.failure_reason, undefined);
      assert.equal(item?.failure_details, undefined);
      assert.equal(Array.isArray(item?.failure_history), true);
      assert.equal(item.failure_history.length, 1);

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'queued');
    });

    it('update --from-queue syncs planned issues to queued', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      const logs: string[] = [];
      mock.method(console, 'log', (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
      mock.method(console, 'error', () => {});

      const queueId = 'QUE-20260107040404';
      const issueId = 'ISS-SYNC-1';
      const solutionId = 'SOL-ISS-SYNC-1-1';

      issueModule.writeIssues([createMockIssue({ id: issueId, status: 'planned', bound_solution_id: solutionId })]);
      issueModule.writeSolutions(issueId, [createMockSolution({ id: solutionId, is_bound: true })]);

      issueModule.writeQueue({
        id: queueId,
        status: 'active',
        issue_ids: [issueId],
        tasks: [],
        solutions: [
          {
            item_id: 'S-1',
            issue_id: issueId,
            solution_id: solutionId,
            status: 'pending',
            execution_order: 1,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            task_count: 1,
          },
        ],
        conflicts: [],
      });

      await issueModule.issueCommand('update', [], { fromQueue: true, json: true });
      const payload = JSON.parse(logs.at(-1) || '{}');
      assert.equal(payload.success, true);
      assert.deepEqual(payload.queued, [issueId]);

      const issue = issueModule.readIssues().find((i: any) => i.id === issueId);
      assert.equal(issue?.status, 'queued');
      assert.ok(issue?.queued_at);
    });

    it('marks queue as completed when all items are completed', async () => {
      issueModule ??= await import(issueCommandUrl);
      assert.ok(env);

      mock.method(console, 'log', () => {});
      mock.method(console, 'error', () => {});

      const queueId = 'QUE-20260107050505';
      const issue1 = 'ISS-QDONE-1';
      const issue2 = 'ISS-QDONE-2';
      const sol1 = 'SOL-ISS-QDONE-1-1';
      const sol2 = 'SOL-ISS-QDONE-2-1';

      issueModule.writeIssues([createMockIssue({ id: issue1, status: 'queued' }), createMockIssue({ id: issue2, status: 'queued' })]);
      issueModule.writeSolutions(issue1, [createMockSolution({ id: sol1, is_bound: false })]);
      issueModule.writeSolutions(issue2, [createMockSolution({ id: sol2, is_bound: false })]);

      issueModule.writeQueue({
        id: queueId,
        status: 'active',
        issue_ids: [issue1, issue2],
        tasks: [],
        solutions: [
          {
            item_id: 'S-1',
            issue_id: issue1,
            solution_id: sol1,
            status: 'pending',
            execution_order: 1,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            task_count: 1,
          },
          {
            item_id: 'S-2',
            issue_id: issue2,
            solution_id: sol2,
            status: 'pending',
            execution_order: 2,
            execution_group: 'P1',
            depends_on: [],
            semantic_priority: 0.5,
            task_count: 1,
          },
        ],
        conflicts: [],
      });

      // Complete both items.
      await issueModule.issueCommand('next', [], { queue: queueId });
      await issueModule.issueCommand('done', ['S-1'], { queue: queueId });
      assert.equal(issueModule.readQueue(queueId)?.status, 'active');

      await issueModule.issueCommand('next', [], { queue: queueId });
      await issueModule.issueCommand('done', ['S-2'], { queue: queueId });
      assert.equal(issueModule.readQueue(queueId)?.status, 'completed');
    });
  });
});
