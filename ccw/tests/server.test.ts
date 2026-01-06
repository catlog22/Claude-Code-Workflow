/**
 * Unit tests for server binding defaults and host option plumbing.
 */

import { afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_ENV = { ...process.env };

const serverUrl = new URL('../dist/core/server.js', import.meta.url);
serverUrl.searchParams.set('t', String(Date.now()));

const serveUrl = new URL('../dist/commands/serve.js', import.meta.url);
serveUrl.searchParams.set('t', String(Date.now()));

describe('server binding', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serverMod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serveMod: any;

  before(async () => {
    serverMod = await import(serverUrl.href);
    serveMod = await import(serveUrl.href);
  });

  afterEach(() => {
    mock.restoreAll();
    process.env = ORIGINAL_ENV;
  });

  it('binds to 127.0.0.1 by default', async () => {
    const ccwHome = mkdtempSync(join(tmpdir(), 'ccw-server-bind-home-'));
    process.env = { ...ORIGINAL_ENV, CCW_DATA_DIR: ccwHome };

    const listenCalls: any[] = [];
    const originalListen = http.Server.prototype.listen;

    mock.method(http.Server.prototype as any, 'listen', function (this: any, ...args: any[]) {
      listenCalls.push(args);
      return (originalListen as any).apply(this, args);
    });

    const server: http.Server = await serverMod.startServer({ initialPath: process.cwd(), port: 0 });
    await new Promise<void>((resolve) => server.close(() => resolve()));

    rmSync(ccwHome, { recursive: true, force: true });

    assert.ok(listenCalls.length > 0, 'Expected server.listen to be called');
    assert.equal(listenCalls[0][1], '127.0.0.1');
  });

  it('passes host option through serve command', async () => {
    const ccwHome = mkdtempSync(join(tmpdir(), 'ccw-serve-bind-home-'));
    process.env = { ...ORIGINAL_ENV, CCW_DATA_DIR: ccwHome };

    mock.method(console, 'log', () => {});
    mock.method(console, 'error', () => {});

    let sigintHandler: (() => void) | null = null;
    const originalOn = process.on.bind(process);
    mock.method(process as any, 'on', (event: string, handler: any) => {
      if (event === 'SIGINT') {
        sigintHandler = handler;
        return process;
      }
      return originalOn(event, handler);
    });

    const exitCodes: Array<number | undefined> = [];
    mock.method(process as any, 'exit', (code?: number) => {
      exitCodes.push(code);
    });

    const listenCalls: any[] = [];
    const originalListen = http.Server.prototype.listen;
    mock.method(http.Server.prototype as any, 'listen', function (this: any, ...args: any[]) {
      listenCalls.push(args);
      return (originalListen as any).apply(this, args);
    });

    await serveMod.serveCommand({ port: 0, browser: false, path: process.cwd(), host: '0.0.0.0' });
    assert.ok(sigintHandler, 'Expected serveCommand to register SIGINT handler');

    sigintHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 300));

    rmSync(ccwHome, { recursive: true, force: true });

    assert.ok(exitCodes.includes(0));
    assert.ok(listenCalls.some((args) => args[1] === '0.0.0.0'));
  });
});

