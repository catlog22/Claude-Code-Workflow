/**
 * Unit tests for CLI command module (ccw cli)
 *
 * Notes:
 * - Targets the runtime implementation shipped in `ccw/dist`.
 * - Uses Node's built-in test runner (node:test).
 * - Mocks external tool execution and dashboard notification.
 */

import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import inquirer from 'inquirer';

const TEST_CCW_HOME = mkdtempSync(join(tmpdir(), 'ccw-cli-command-'));
process.env.CCW_DATA_DIR = TEST_CCW_HOME;

const cliCommandPath = new URL('../dist/commands/cli.js', import.meta.url).href;
const cliExecutorPath = new URL('../dist/tools/cli-executor.js', import.meta.url).href;
const historyStorePath = new URL('../dist/tools/cli-history-store.js', import.meta.url).href;
const storageManagerPath = new URL('../dist/tools/storage-manager.js', import.meta.url).href;

function stubHttpRequest(): void {
  mock.method(http, 'request', () => {
    const req: {
      on: (event: string, handler: (arg?: any) => void) => typeof req;
      write: (data: any) => void;
      end: () => void;
      destroy: () => void;
    } = {
      on(event, handler) {
        if (event === 'socket') {
          handler({ unref() {} });
        }
        return req;
      },
      write() {},
      end() {},
      destroy() {},
    };
    return req as any;
  });
}

describe('cli command module', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cliModule: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cliExecutorModule: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let historyStoreModule: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storageManagerModule: any;

  before(async () => {
    cliModule = await import(cliCommandPath);
    cliExecutorModule = await import(cliExecutorPath);
    historyStoreModule = await import(historyStorePath);
    storageManagerModule = await import(storageManagerPath);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  after(() => {
    try {
      historyStoreModule?.closeAllStores?.();
    } catch {
      // ignore
    }
    rmSync(TEST_CCW_HOME, { recursive: true, force: true });
  });

  it('executes tool (gemini/qwen/codex) and passes parameters to executor', async () => {
    stubHttpRequest();
    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});

    const calls: any[] = [];
    mock.method(cliExecutorModule.cliExecutorTool, 'execute', async (params: any) => {
      calls.push(params);
      return {
        success: true,
        stdout: 'ok',
        stderr: '',
        execution: { id: 'EXEC-1', duration_ms: 12, status: 'success' },
        conversation: { turn_count: 1, total_duration_ms: 12 },
      };
    });

    const exitCodes: Array<number | undefined> = [];
    mock.method(process as any, 'exit', (code?: number) => {
      exitCodes.push(code);
    });

    for (const tool of ['gemini', 'qwen', 'codex']) {
      await cliModule.cliCommand('exec', [], { prompt: 'Hello', tool });
    }

    // `ccw/dist` schedules process exit with a small timeout for "fire-and-forget" dashboard notification.
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.deepEqual(
      calls.map((c) => c.tool),
      ['gemini', 'qwen', 'codex'],
    );
    for (const call of calls) {
      assert.equal(call.prompt, 'Hello');
      assert.equal(call.mode, 'analysis');
      assert.equal(call.stream, false);
      assert.equal(call.timeout, 0);
    }
    assert.deepEqual(exitCodes, [0, 0, 0]);
  });

  it('prints full output hint immediately after stderr truncation (no troubleshooting duplicate)', async () => {
    stubHttpRequest();

    const logs: string[] = [];
    mock.method(console, 'log', (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    });
    mock.method(console, 'error', (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    });

    mock.method(cliExecutorModule.cliExecutorTool, 'execute', async () => {
      const stderr = Array.from({ length: 31 }, (_, i) => `stderr-line-${i}`).join('\n');
      return {
        success: false,
        stdout: '',
        stderr,
        execution: { id: 'EXEC-ERR', duration_ms: 12, status: 'error', exit_code: 1 },
        conversation: { turn_count: 1, total_duration_ms: 12 },
      };
    });

    const exitCodes: Array<number | undefined> = [];
    mock.method(process as any, 'exit', (code?: number) => {
      exitCodes.push(code);
    });

    await cliModule.cliCommand('exec', [], { prompt: 'Hello', tool: 'gemini', stream: true });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const truncationIndex = logs.findIndex((l) => l.includes('... 1 more lines'));
    const hintIndex = logs.findIndex((l) => l.includes('💡 View full output: ccw cli output EXEC-ERR'));
    assert.ok(truncationIndex >= 0);
    assert.ok(hintIndex >= 0);
    assert.equal(hintIndex, truncationIndex + 1);

    assert.equal(logs.filter((l) => l.includes('View full output: ccw cli output EXEC-ERR')).length, 1);
    assert.equal(logs.filter((l) => l.includes('• View full output')).length, 0);
    assert.deepEqual(exitCodes, [1]);
  });

  it('supports resume with conversation ID and latest (no prompt required)', async () => {
    stubHttpRequest();
    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});

    const resumes: any[] = [];
    mock.method(cliExecutorModule.cliExecutorTool, 'execute', async (params: any) => {
      resumes.push(params.resume);
      return {
        success: true,
        stdout: '',
        stderr: '',
        execution: { id: 'EXEC-R', duration_ms: 1, status: 'success' },
        conversation: { turn_count: 2, total_duration_ms: 1 },
      };
    });

    const exitCodes: Array<number | undefined> = [];
    mock.method(process as any, 'exit', (code?: number) => {
      exitCodes.push(code);
    });

    await cliModule.cliCommand('exec', [], { tool: 'gemini', resume: true });
    await cliModule.cliCommand('exec', [], { tool: 'gemini', resume: 'CONV-123' });

    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.deepEqual(resumes, [true, 'CONV-123']);
    assert.deepEqual(exitCodes, [0, 0]);
  });

  it('validates prompt requirement when not resuming', async () => {
    stubHttpRequest();

    class ExitError extends Error {
      code?: number;

      constructor(code?: number) {
        super(`process.exit(${code ?? 'undefined'})`);
        this.code = code;
      }
    }

    let executed = false;
    mock.method(cliExecutorModule.cliExecutorTool, 'execute', async () => {
      executed = true;
      return {
        success: true,
        stdout: '',
        stderr: '',
        execution: { id: 'EXEC-NEVER', duration_ms: 1, status: 'success' },
        conversation: { turn_count: 1, total_duration_ms: 1 },
      };
    });

    // Use a non-subcommand-looking value so it won't be treated as a positional prompt.
    // `resume: false` forces execAction path without satisfying "resuming" condition.
    mock.method(process as any, 'exit', (code?: number) => {
      throw new ExitError(code);
    });

    await assert.rejects(
      cliModule.cliCommand('-ignored', [], { tool: 'gemini', resume: false }),
      (err: any) => err instanceof ExitError && err.code === 1,
    );

    assert.equal(executed, false);
  });

  it('prompts for confirmation before cleaning all storage (and cancels safely)', async () => {
    const projectRoot = join(TEST_CCW_HOME, 'projects', 'test-project-cancel');
    const markerDir = join(projectRoot, 'cli-history');
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, 'dummy.txt'), '1234');

    const stats = storageManagerModule.getStorageStats();
    const expectedSize = storageManagerModule.formatBytes(stats.totalSize);

    const promptCalls: any[] = [];
    mock.method(inquirer, 'prompt', async (questions: any) => {
      promptCalls.push(questions);
      return { proceed: false };
    });

    const logs: string[] = [];
    mock.method(console, 'log', (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    });
    mock.method(console, 'error', (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    });

    await cliModule.cliCommand('storage', ['clean'], { force: false });

    assert.equal(promptCalls.length, 1);
    assert.equal(promptCalls[0][0].type, 'confirm');
    assert.equal(promptCalls[0][0].default, false);
    assert.ok(promptCalls[0][0].message.includes(`${stats.projectCount} projects`));
    assert.ok(promptCalls[0][0].message.includes(`(${expectedSize})`));

    assert.ok(logs.some((l) => l.includes('Storage clean cancelled')));
    assert.equal(existsSync(projectRoot), true);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('bypasses confirmation prompt when --force is set for storage clean', async () => {
    const projectRoot = join(TEST_CCW_HOME, 'projects', 'test-project-force');
    const markerDir = join(projectRoot, 'cli-history');
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, 'dummy.txt'), '1234');

    mock.method(inquirer, 'prompt', async () => {
      throw new Error('inquirer.prompt should not be called when --force is set');
    });

    await cliModule.cliCommand('storage', ['clean'], { force: true });
    assert.equal(existsSync(projectRoot), false);
  });

  it('deletes all storage after interactive confirmation', async () => {
    const projectRoot = join(TEST_CCW_HOME, 'projects', 'test-project-confirm');
    const markerDir = join(projectRoot, 'cli-history');
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, 'dummy.txt'), '1234');

    mock.method(inquirer, 'prompt', async () => ({ proceed: true }));

    await cliModule.cliCommand('storage', ['clean'], { force: false });
    assert.equal(existsSync(projectRoot), false);
  });

  it('prints history and retrieves conversation detail from SQLite store', async () => {
    stubHttpRequest();

    const logs: string[] = [];
    mock.method(console, 'log', (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    });
    mock.method(console, 'error', (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    });

    const store = historyStoreModule.getHistoryStore(process.cwd());
    store.saveConversation({
      id: 'CONV-CLI-1',
      created_at: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      updated_at: new Date('2025-01-01T00:00:01.000Z').toISOString(),
      tool: 'gemini',
      model: 'default',
      mode: 'analysis',
      category: 'user',
      total_duration_ms: 123,
      turn_count: 1,
      latest_status: 'success',
      turns: [
        {
          turn: 1,
          timestamp: new Date('2025-01-01T00:00:00.000Z').toISOString(),
          prompt: 'Test prompt',
          duration_ms: 123,
          status: 'success',
          exit_code: 0,
          output: { stdout: 'OK', stderr: '', truncated: false, cached: false },
        },
      ],
    });

    await cliModule.cliCommand('history', [], { limit: '20' });
    assert.ok(logs.some((l) => l.includes('CONV-CLI-1')));

    // Ensure cli-executor SQLite module is initialized for sync detail retrieval
    await cliExecutorModule.getExecutionHistoryAsync(process.cwd(), { limit: 1 });

    logs.length = 0;
    await cliModule.cliCommand('detail', ['CONV-CLI-1'], {});
    assert.ok(logs.some((l) => l.includes('Conversation Detail')));
    assert.ok(logs.some((l) => l.includes('CONV-CLI-1')));
    assert.ok(logs.some((l) => l.includes('Test prompt')));
  });
});
