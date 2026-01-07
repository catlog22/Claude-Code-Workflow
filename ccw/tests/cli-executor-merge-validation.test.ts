/**
 * Regression tests for conversation merge validation (DSC-008).
 *
 * Focus:
 * - Merge with all invalid IDs returns a descriptive error including attempted IDs
 * - Merge proceeds when at least one source conversation is valid
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliExecutorUrl = new URL('../dist/tools/cli-executor.js', import.meta.url).href;
const historyStoreUrl = new URL('../dist/tools/cli-history-store.js', import.meta.url).href;

type FakeChild = EventEmitter & {
  pid?: number;
  killed: boolean;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: string) => boolean;
  close: (code?: number) => void;
};

function createFakeChild(pid: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.killed = false;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  let closed = false;
  child.close = (code: number = 0) => {
    if (closed) return;
    closed = true;
    child.stdout.end();
    child.stderr.end();
    child.emit('close', code);
  };

  child.kill = (signal?: string) => {
    child.killed = true;
    queueMicrotask(() => child.close(0));
    return true;
  };

  return child;
}

describe('cli-executor: merge validation regression', async () => {
  const require = createRequire(import.meta.url);
  const childProcess = require('child_process');
  const originalSpawn = childProcess.spawn;

  const envSnapshot: Record<string, string | undefined> = {};
  let ccwHome = '';
  let projectDir = '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cliExecutorModule: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let historyStoreModule: any;

  before(async () => {
    envSnapshot.CCW_DATA_DIR = process.env.CCW_DATA_DIR;

    ccwHome = mkdtempSync(join(tmpdir(), 'ccw-cli-executor-merge-home-'));
    projectDir = mkdtempSync(join(tmpdir(), 'ccw-cli-executor-merge-project-'));
    process.env.CCW_DATA_DIR = ccwHome;

    childProcess.spawn = (command: unknown, args: unknown[]) => {
      const cmd = String(command);
      const argv = Array.isArray(args) ? args.map((a) => String(a)) : [];

      // Tool lookup helpers.
      if (cmd === 'where' || cmd === 'which') {
        const child = createFakeChild(4000);
        queueMicrotask(() => {
          child.stdout.write(`C:\\\\fake\\\\${argv[0] || 'tool'}.cmd\r\n`);
          child.close(0);
        });
        return child;
      }

      const child = createFakeChild(5000);
      queueMicrotask(() => {
        child.stdout.write('OK\n');
        child.close(0);
      });
      return child;
    };

    historyStoreModule = await import(historyStoreUrl);
    cliExecutorModule = await import(cliExecutorUrl);
  });

  after(() => {
    childProcess.spawn = originalSpawn;

    try {
      historyStoreModule?.closeAllStores?.();
    } catch {
      // ignore
    }

    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (ccwHome) rmSync(ccwHome, { recursive: true, force: true });
    process.env.CCW_DATA_DIR = envSnapshot.CCW_DATA_DIR;
  });

  it('throws a descriptive error when all merge IDs are invalid', async () => {
    await assert.rejects(
      () => cliExecutorModule.cliExecutorTool.execute({
        tool: 'codex',
        prompt: 'test',
        cd: projectDir,
        resume: 'MISSING-1, MISSING-2'
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('No valid conversations found for merge'));
        assert.ok(err.message.includes('MISSING-1'));
        assert.ok(err.message.includes('MISSING-2'));
        return true;
      }
    );
  });

  it('merges when at least one source conversation is valid', async () => {
    const store = historyStoreModule.getHistoryStore(projectDir);
    store.saveConversation({
      id: 'CONV-MERGE-VALID-1',
      created_at: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      updated_at: new Date('2025-01-01T00:00:01.000Z').toISOString(),
      tool: 'codex',
      model: 'default',
      mode: 'analysis',
      category: 'user',
      total_duration_ms: 1,
      turn_count: 1,
      latest_status: 'success',
      turns: [
        {
          turn: 1,
          timestamp: new Date('2025-01-01T00:00:00.000Z').toISOString(),
          prompt: 'Previous prompt',
          duration_ms: 1,
          status: 'success',
          exit_code: 0,
          output: { stdout: 'Previous output', stderr: '', truncated: false, cached: false }
        }
      ]
    });

    const result = await cliExecutorModule.cliExecutorTool.execute({
      tool: 'codex',
      prompt: 'Next prompt',
      cd: projectDir,
      resume: 'CONV-MERGE-VALID-1, MISSING-99'
    });

    assert.equal(result.success, true);
    assert.ok(result.execution?.id);
  });
});

