/**
 * Regression tests for command injection protections in cli-executor.
 *
 * Focus: ensure args are escaped on Windows when `shell: true` is required.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliExecutorUrl = new URL('../../dist/tools/cli-executor.js', import.meta.url).href;
const historyStoreUrl = new URL('../../dist/tools/cli-history-store.js', import.meta.url).href;
const shellEscapeUrl = new URL('../../dist/utils/shell-escape.js', import.meta.url).href;

describe('cli-executor: command injection regression', async () => {
  const isWindows = process.platform === 'win32';

  const require = createRequire(import.meta.url);
  const childProcess = require('child_process');
  const originalSpawn = childProcess.spawn;

  const originalSetTimeout = globalThis.setTimeout;

  const spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];

  const envSnapshot: Record<string, string | undefined> = {};
  let ccwHome = '';
  let projectDir = '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cliExecutorModule: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let historyStoreModule: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shellEscapeModule: any;

  function unrefSetTimeout<TArgs extends unknown[]>(
    fn: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ): ReturnType<typeof setTimeout> {
    const t = originalSetTimeout(fn as (...args: unknown[]) => void, delay as number, ...args);
    (t as unknown as { unref?: () => void }).unref?.();
    return t;
  }

  before(async () => {
    envSnapshot.CCW_DATA_DIR = process.env.CCW_DATA_DIR;
    envSnapshot.DEBUG = process.env.DEBUG;
    envSnapshot.CCW_DEBUG = process.env.CCW_DEBUG;

    ccwHome = mkdtempSync(join(tmpdir(), 'ccw-command-injection-home-'));
    projectDir = mkdtempSync(join(tmpdir(), 'ccw-command-injection-project-'));
    process.env.CCW_DATA_DIR = ccwHome;
    delete process.env.DEBUG;
    delete process.env.CCW_DEBUG;

    // Prevent long-lived timeouts in the module under test from delaying process exit.
    globalThis.setTimeout = unrefSetTimeout as unknown as typeof setTimeout;

    shellEscapeModule = await import(shellEscapeUrl);

    // Patch child_process.spawn BEFORE importing cli-executor (it captures spawn at module init).
    childProcess.spawn = (command: unknown, args: unknown[], options: Record<string, unknown>) => {
      const cmd = String(command);
      const argv = Array.isArray(args) ? args.map((a) => String(a)) : [];
      spawnCalls.push({ command: cmd, args: argv, options: options || {} });

      const child = new EventEmitter() as any;
      child.pid = 4242;
      child.killed = false;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();

      let closed = false;
      child.kill = () => {
        child.killed = true;
        if (!closed) {
          closed = true;
          child.stdout.end();
          child.stderr.end();
          child.emit('close', 0);
        }
        return true;
      };

      process.nextTick(() => {
        if (closed) return;
        if (cmd === 'where' || cmd === 'which') {
          const tool = argv[0] || 'tool';
          child.stdout.write(`C:\\\\fake\\\\${tool}.cmd\r\n`);
          child.stdout.end();
          child.stderr.end();
          closed = true;
          child.emit('close', 0);
          return;
        }

        child.stdout.write('ok\n');
        child.stdout.end();
        child.stderr.end();
        closed = true;
        child.emit('close', 0);
      });

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
    if (envSnapshot.DEBUG === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = envSnapshot.DEBUG;
    if (envSnapshot.CCW_DEBUG === undefined) delete process.env.CCW_DEBUG;
    else process.env.CCW_DEBUG = envSnapshot.CCW_DEBUG;
  });

  it('escapes dangerous metacharacters for Windows shell execution', async () => {
    const escapeWindowsArg = shellEscapeModule.escapeWindowsArg as (arg: string) => string;

    const cases: Array<{
      name: string;
      params: Record<string, unknown>;
      expectedCommand: string;
      expectedArgs: string[];
    }> = [
      {
        name: 'gemini: model includes &',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-model-amp', model: 'gpt-4 & calc' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', 'gpt-4 & calc'],
      },
      {
        name: 'gemini: model includes |',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-model-pipe', model: 'gpt|calc' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', 'gpt|calc'],
      },
      {
        name: 'gemini: model includes >',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-model-gt', model: 'gpt>out.txt' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', 'gpt>out.txt'],
      },
      {
        name: 'gemini: model includes <',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-model-lt', model: 'gpt<input.txt' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', 'gpt<input.txt'],
      },
      {
        name: 'gemini: model includes parentheses',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-model-paren', model: '(gpt)' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', '(gpt)'],
      },
      {
        name: 'gemini: model includes %',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-model-percent', model: '%PATH%' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', '%PATH%'],
      },
      {
        name: 'gemini: model includes !',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-model-bang', model: '!VAR!' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', '!VAR!'],
      },
      {
        name: 'gemini: model includes caret',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-model-caret', model: 'a^b' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', 'a^b'],
      },
      {
        name: 'gemini: includeDirs includes spaces and &',
        params: { tool: 'gemini', prompt: 'hi', cd: projectDir, id: 'case-gemini-include', includeDirs: 'C:\\Program Files\\A & B', model: 'test-model' },
        expectedCommand: 'gemini',
        expectedArgs: ['-m', 'test-model', '--include-directories', 'C:\\Program Files\\A & B'],
      },
      {
        name: 'qwen: model includes double quote',
        params: { tool: 'qwen', prompt: 'hi', cd: projectDir, id: 'case-qwen-model-quote', model: 'qwen\"model' },
        expectedCommand: 'qwen',
        expectedArgs: ['-m', 'qwen\"model'],
      },
      {
        name: 'qwen: includeDirs includes |',
        params: { tool: 'qwen', prompt: 'hi', cd: projectDir, id: 'case-qwen-include-pipe', includeDirs: 'C:\\a|b', model: 'test-model' },
        expectedCommand: 'qwen',
        expectedArgs: ['-m', 'test-model', '--include-directories', 'C:\\a|b'],
      },
      {
        name: 'codex: --add-dir values include metacharacters and spaces',
        params: { tool: 'codex', prompt: 'hi', cd: projectDir, id: 'case-codex-include', includeDirs: 'C:\\a&b,C:\\c d', model: 'gpt-4' },
        expectedCommand: 'codex',
        expectedArgs: ['exec', '--full-auto', '-m', 'gpt-4', '--add-dir', 'C:\\a&b', '--add-dir', 'C:\\c d', '-'],
      },
    ];

    for (const testCase of cases) {
      spawnCalls.length = 0;

      await cliExecutorModule.executeCliTool(testCase.params, null);

      const execCall = spawnCalls.find((c) => c.command === testCase.expectedCommand);
      assert.ok(execCall, `Expected spawn call for ${testCase.expectedCommand} (${testCase.name})`);

      assert.equal(
        execCall.options?.shell,
        isWindows,
        `Expected shell=${String(isWindows)} for ${testCase.expectedCommand} (${testCase.name})`
      );

      const expectedCommand = isWindows ? escapeWindowsArg(testCase.expectedCommand) : testCase.expectedCommand;
      const expectedArgs = isWindows ? testCase.expectedArgs.map(escapeWindowsArg) : testCase.expectedArgs;

      assert.equal(execCall.command, expectedCommand, `spawn command (${testCase.name})`);
      assert.deepEqual(execCall.args, expectedArgs, `spawn args (${testCase.name})`);
    }
  });
});
