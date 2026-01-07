/**
 * Regression tests for killCurrentCliProcess timeout handling (DSC-007).
 *
 * Focus:
 * - Avoid stale SIGKILL timers killing a subsequent child process
 * - Ensure SIGKILL is sent when SIGTERM does not terminate the process
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
  killCalls: string[];
  close: (code?: number) => void;
};

type ToolChildBehavior = {
  closeOnSigterm: boolean;
};

describe('cli-executor: killCurrentCliProcess regression', async () => {
  const require = createRequire(import.meta.url);
  const childProcess = require('child_process');
  const originalSpawn = childProcess.spawn;
  const originalSetTimeout = globalThis.setTimeout;

  const envSnapshot: Record<string, string | undefined> = {};
  let ccwHome = '';
  let projectDir = '';

  const toolChildren: FakeChild[] = [];
  const plannedBehaviors: ToolChildBehavior[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cliExecutorModule: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let historyStoreModule: any;

  function unrefFastSetTimeout<TArgs extends unknown[]>(
    fn: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ): ReturnType<typeof setTimeout> {
    const t = originalSetTimeout(fn as (...args: unknown[]) => void, 25, ...args);
    (t as unknown as { unref?: () => void }).unref?.();
    return t;
  }

  function createFakeChild(behavior: ToolChildBehavior, pid: number): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.pid = pid;
    child.killed = false;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killCalls = [];

    let closed = false;
    child.close = (code: number = 0) => {
      if (closed) return;
      closed = true;
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code);
    };

    child.kill = (signal?: string) => {
      const sig = signal || 'SIGTERM';
      child.killCalls.push(sig);

      if (sig === 'SIGTERM') {
        if (behavior.closeOnSigterm) {
          child.killed = true;
          queueMicrotask(() => child.close(0));
        }
        return true;
      }

      if (sig === 'SIGKILL') {
        child.killed = true;
        queueMicrotask(() => child.close(0));
        return true;
      }

      return true;
    };

    return child;
  }

  before(async () => {
    envSnapshot.CCW_DATA_DIR = process.env.CCW_DATA_DIR;

    ccwHome = mkdtempSync(join(tmpdir(), 'ccw-cli-executor-kill-home-'));
    projectDir = mkdtempSync(join(tmpdir(), 'ccw-cli-executor-kill-project-'));
    process.env.CCW_DATA_DIR = ccwHome;

    globalThis.setTimeout = unrefFastSetTimeout as unknown as typeof setTimeout;

    childProcess.spawn = (command: unknown, args: unknown[], options: Record<string, unknown>) => {
      const cmd = String(command);
      const argv = Array.isArray(args) ? args.map((a) => String(a)) : [];

      // Tool lookup helpers.
      if (cmd === 'where' || cmd === 'which') {
        const child = createFakeChild({ closeOnSigterm: true }, 4000);
        queueMicrotask(() => {
          child.stdout.write(`C:\\\\fake\\\\${argv[0] || 'tool'}.cmd\r\n`);
          child.close(0);
        });
        return child;
      }

      const behavior = plannedBehaviors.shift() ?? { closeOnSigterm: true };
      const child = createFakeChild(behavior, 5000 + toolChildren.length);
      toolChildren.push(child);

      // Keep the process running until explicitly closed or killed.
      return child;
    };

    cliExecutorModule = await import(cliExecutorUrl);
    historyStoreModule = await import(historyStoreUrl);
  });

  after(async () => {
    childProcess.spawn = originalSpawn;
    globalThis.setTimeout = originalSetTimeout;

    try {
      historyStoreModule?.closeAllStores?.();
    } catch {
      // ignore
    }

    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (ccwHome) rmSync(ccwHome, { recursive: true, force: true });

    process.env.CCW_DATA_DIR = envSnapshot.CCW_DATA_DIR;
  });

  it('does not kill a subsequent child via a stale SIGKILL timeout', async () => {
    plannedBehaviors.push({ closeOnSigterm: true });
    plannedBehaviors.push({ closeOnSigterm: false });

    const run1 = cliExecutorModule.handler({ tool: 'codex', prompt: 'test', cd: projectDir });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(cliExecutorModule.killCurrentCliProcess(), true);
    await run1;

    const run2 = cliExecutorModule.handler({ tool: 'codex', prompt: 'test-2', cd: projectDir });
    await new Promise((resolve) => setImmediate(resolve));

    // Wait long enough for the (patched) kill timeout to fire if not cleared.
    await new Promise((resolve) => originalSetTimeout(resolve, 60));

    assert.equal(toolChildren.length >= 2, true);
    assert.deepEqual(toolChildren[1].killCalls, []);

    toolChildren[1].close(0);
    await run2;
  });

  it('sends SIGKILL when SIGTERM does not terminate the process', async () => {
    plannedBehaviors.push({ closeOnSigterm: false });

    const run = cliExecutorModule.handler({ tool: 'codex', prompt: 'timeout-test', cd: projectDir });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(cliExecutorModule.killCurrentCliProcess(), true);
    // Keep the event loop alive long enough for the (unref'd) timeout to fire.
    await new Promise((resolve) => originalSetTimeout(resolve, 60));
    await run;

    assert.equal(toolChildren.length >= 1, true);
    assert.ok(toolChildren[toolChildren.length - 1].killCalls.includes('SIGTERM'));
    assert.ok(toolChildren[toolChildren.length - 1].killCalls.includes('SIGKILL'));
  });
});
