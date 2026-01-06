/**
 * Security tests for credential handling (DSC-004).
 *
 * Notes:
 * - Targets runtime implementation shipped in `ccw/dist`.
 * - Uses an isolated CCW data directory (CCW_DATA_DIR) to avoid touching real user config.
 */

import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CCW_HOME = mkdtempSync(path.join(tmpdir(), 'ccw-credential-tests-home-'));
const PROJECT_ROOT = mkdtempSync(path.join(tmpdir(), 'ccw-credential-tests-project-'));
const CONFIG_DIR = path.join(CCW_HOME, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'litellm-api-config.json');

const originalEnv = {
  CCW_DATA_DIR: process.env.CCW_DATA_DIR,
  TEST_API_KEY: process.env.TEST_API_KEY,
};

process.env.CCW_DATA_DIR = CCW_HOME;

const configManagerUrl = new URL('../../dist/config/litellm-api-config-manager.js', import.meta.url);
configManagerUrl.searchParams.set('t', String(Date.now()));

const litellmRoutesUrl = new URL('../../dist/core/routes/litellm-api-routes.js', import.meta.url);
litellmRoutesUrl.searchParams.set('t', String(Date.now()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routes: any;

type JsonResponse = { status: number; json: any; text: string };

async function requestJson(baseUrl: string, method: string, reqPath: string, body?: unknown): Promise<JsonResponse> {
  const url = new URL(reqPath, baseUrl);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          let json: any = null;
          try {
            json = responseBody ? JSON.parse(responseBody) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, json, text: responseBody });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function handlePostRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handler: (body: unknown) => Promise<any>,
): void {
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

async function createServer(initialPath: string): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    const ctx = {
      pathname,
      url,
      req,
      res,
      initialPath,
      handlePostRequest,
      broadcastToClients() {},
    };

    try {
      const handled = await routes.handleLiteLLMApiRoutes(ctx);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function loadMaskApiKey(): (apiKey: string) => string {
  const filePath = new URL('../../src/templates/dashboard-js/views/api-settings.js', import.meta.url);
  const source = readFileSync(filePath, 'utf8');

  const match = source.match(/function\s+maskApiKey\(apiKey\)\s*\{[\s\S]*?\r?\n\}/);
  if (!match) {
    throw new Error('maskApiKey function not found in api-settings.js');
  }

  // eslint-disable-next-line no-new-func
  const fn = new Function(`${match[0]}; return maskApiKey;`) as () => (apiKey: string) => string;
  return fn();
}

describe('security: credential handling', async () => {
  const maskApiKey = loadMaskApiKey();

  function listFilesRecursive(dirPath: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) results.push(...listFilesRecursive(fullPath));
      else if (entry.isFile()) results.push(fullPath);
    }
    return results;
  }

  before(async () => {
    mod = await import(configManagerUrl.href);
    routes = await import(litellmRoutesUrl.href);
  });

  beforeEach(() => {
    process.env.TEST_API_KEY = originalEnv.TEST_API_KEY;
    rmSync(CONFIG_PATH, { force: true });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  after(() => {
    process.env.CCW_DATA_DIR = originalEnv.CCW_DATA_DIR;
    process.env.TEST_API_KEY = originalEnv.TEST_API_KEY;
    rmSync(CCW_HOME, { recursive: true, force: true });
    rmSync(PROJECT_ROOT, { recursive: true, force: true });
  });

  it('resolveEnvVar returns input unchanged when not ${ENV_VAR}', () => {
    assert.equal(mod.resolveEnvVar('sk-test-1234'), 'sk-test-1234');
    assert.equal(mod.resolveEnvVar(''), '');
  });

  it('resolveEnvVar resolves ${ENV_VAR} syntax', () => {
    process.env.TEST_API_KEY = 'sk-test-resolved';
    assert.equal(mod.resolveEnvVar('${TEST_API_KEY}'), 'sk-test-resolved');
  });

  it('resolveEnvVar returns empty string when env var is missing', () => {
    delete process.env.TEST_API_KEY;
    assert.equal(mod.resolveEnvVar('${TEST_API_KEY}'), '');
  });

  it('getProviderWithResolvedEnvVars returns provider with resolvedApiKey', () => {
    process.env.TEST_API_KEY = 'sk-test-resolved';

    const provider = mod.addProvider(PROJECT_ROOT, {
      name: 'Test Provider',
      type: 'openai',
      apiKey: '${TEST_API_KEY}',
      apiBase: undefined,
      enabled: true,
    });

    const resolved = mod.getProviderWithResolvedEnvVars(PROJECT_ROOT, provider.id);
    assert.ok(resolved);
    assert.equal(resolved.id, provider.id);
    assert.equal(resolved.resolvedApiKey, 'sk-test-resolved');
  });

  it('resolveEnvVar does not log resolved credential values', () => {
    const secret = 'sk-test-secret-1234567890';
    process.env.TEST_API_KEY = secret;

    const calls: string[] = [];
    mock.method(console, 'log', (...args: unknown[]) => calls.push(args.map(String).join(' ')));
    mock.method(console, 'error', (...args: unknown[]) => calls.push(args.map(String).join(' ')));

    assert.equal(mod.resolveEnvVar('${TEST_API_KEY}'), secret);
    assert.equal(calls.some((line) => line.includes(secret)), false);
  });

  it('getProviderWithResolvedEnvVars does not log resolved credential values', () => {
    const secret = 'sk-test-secret-abcdef123456';
    process.env.TEST_API_KEY = secret;

    const calls: string[] = [];
    mock.method(console, 'log', (...args: unknown[]) => calls.push(args.map(String).join(' ')));
    mock.method(console, 'error', (...args: unknown[]) => calls.push(args.map(String).join(' ')));

    const provider = mod.addProvider(PROJECT_ROOT, {
      name: 'Test Provider',
      type: 'openai',
      apiKey: '${TEST_API_KEY}',
      apiBase: undefined,
      enabled: true,
    });

    const resolved = mod.getProviderWithResolvedEnvVars(PROJECT_ROOT, provider.id);
    assert.ok(resolved);
    assert.equal(resolved.resolvedApiKey, secret);
    assert.equal(calls.some((line) => line.includes(secret)), false);
  });

  it('loadLiteLLMApiConfig logs parse errors without leaking credentials', () => {
    const secret = 'sk-test-secret-in-file-1234';
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, `{\"providers\":[{\"apiKey\":\"${secret}\"`, 'utf8');

    const calls: string[] = [];
    mock.method(console, 'error', (...args: unknown[]) => calls.push(args.map(String).join(' ')));

    const config = mod.loadLiteLLMApiConfig(PROJECT_ROOT);
    assert.equal(Array.isArray(config.providers), true);
    assert.equal(config.providers.length, 0);
    assert.equal(calls.length > 0, true);
    assert.equal(calls.some((line) => line.includes(secret)), false);
  });

  it('loadLiteLLMApiConfig stack traces do not include raw credentials', () => {
    const secret = 'sk-test-secret-stack-9999';
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, `{\"providers\":[{\"apiKey\":\"${secret}\"`, 'utf8');

    const errorArgs: unknown[][] = [];
    mock.method(console, 'error', (...args: unknown[]) => errorArgs.push(args));

    mod.loadLiteLLMApiConfig(PROJECT_ROOT);

    const errorObj = errorArgs.flat().find((arg) => arg instanceof Error) as Error | undefined;
    assert.ok(errorObj);
    assert.equal(String(errorObj.stack ?? '').includes(secret), false);
  });

  it('maskApiKey hides raw keys but keeps env var references readable', () => {
    assert.equal(maskApiKey(''), '');
    assert.equal(maskApiKey('${TEST_API_KEY}'), '${TEST_API_KEY}');
    assert.equal(maskApiKey('short'), '***');
    assert.equal(maskApiKey('sk-test-1234567890'), 'sk-t...7890');
  });

  it('getProviderWithResolvedEnvVars is safe to stringify (no env var syntax or resolved secrets)', () => {
    const secret = 'sk-test-secret-json-0000';
    process.env.TEST_API_KEY = secret;

    const provider = mod.addProvider(PROJECT_ROOT, {
      name: 'Test Provider',
      type: 'openai',
      apiKey: '${TEST_API_KEY}',
      apiBase: undefined,
      enabled: true,
    });

    const resolved = mod.getProviderWithResolvedEnvVars(PROJECT_ROOT, provider.id);
    assert.ok(resolved);

    const payload = JSON.stringify(resolved);
    assert.equal(payload.includes(secret), false);
    assert.equal(payload.includes('${TEST_API_KEY}'), false);
    assert.equal(payload.includes('resolvedApiKey'), false);
  });

  it('API responses do not expose env var syntax for provider apiKey', async () => {
    process.env.TEST_API_KEY = 'sk-test-secret-api-1111';

    mod.addProvider(PROJECT_ROOT, {
      name: 'Test Provider',
      type: 'openai',
      apiKey: '${TEST_API_KEY}',
      apiBase: undefined,
      enabled: true,
    });

    const { server, baseUrl } = await createServer(PROJECT_ROOT);
    try {
      const res = await requestJson(baseUrl, 'GET', '/api/litellm-api/providers');
      assert.equal(res.status, 200);
      assert.ok(res.json?.providers);

      assert.equal(res.text.includes('${TEST_API_KEY}'), false);
      assert.equal(res.text.includes('${'), false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('API responses do not expose resolved secrets in generated rotation endpoints', async () => {
    const secret = 'sk-test-secret-rotation-2222';
    process.env.TEST_API_KEY = secret;

    const provider = mod.addProvider(PROJECT_ROOT, {
      name: 'Embed Provider',
      type: 'openai',
      apiKey: '${TEST_API_KEY}',
      apiBase: undefined,
      enabled: true,
    });

    // Ensure provider has an enabled embedding model.
    mod.updateProvider(PROJECT_ROOT, provider.id, {
      embeddingModels: [{
        id: 'emb-1',
        name: 'text-embedding-test',
        type: 'embedding',
        series: 'Test',
        enabled: true,
      }],
    });

    // Configure legacy rotation directly in the config file (avoid auto-sync side effects).
    mkdirSync(CONFIG_DIR, { recursive: true });
    const config = mod.loadLiteLLMApiConfig(PROJECT_ROOT);
    config.codexlensEmbeddingRotation = {
      enabled: true,
      strategy: 'round_robin',
      defaultCooldown: 60,
      targetModel: 'text-embedding-test',
      providers: [{
        providerId: provider.id,
        modelId: 'emb-1',
        useAllKeys: true,
        weight: 1.0,
        maxConcurrentPerKey: 4,
        enabled: true,
      }],
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    const { server, baseUrl } = await createServer(PROJECT_ROOT);
    try {
      const res = await requestJson(baseUrl, 'GET', '/api/litellm-api/codexlens/rotation/endpoints');
      assert.equal(res.status, 200);
      assert.ok(res.json?.endpoints);

      assert.equal(res.text.includes(secret), false);
      assert.equal(res.text.includes('${TEST_API_KEY}'), false);
      assert.equal(res.text.includes('${'), false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('stores env var references without persisting resolved secrets when available', () => {
    const secret = 'sk-test-secret-storage-3333';
    process.env.TEST_API_KEY = secret;

    mod.addProvider(PROJECT_ROOT, {
      name: 'Stored Provider',
      type: 'openai',
      apiKey: '${TEST_API_KEY}',
      apiBase: undefined,
      enabled: true,
    });

    const content = readFileSync(CONFIG_PATH, 'utf8');
    assert.equal(content.includes('${TEST_API_KEY}'), true);
    assert.equal(content.includes(secret), false);
  });

  it('does not write resolved secrets into ancillary files under CCW_DATA_DIR', () => {
    const secret = 'sk-test-secret-storage-scan-4444';
    process.env.TEST_API_KEY = secret;

    mod.addProvider(PROJECT_ROOT, {
      name: 'Stored Provider',
      type: 'openai',
      apiKey: '${TEST_API_KEY}',
      apiBase: undefined,
      enabled: true,
    });

    const files = listFilesRecursive(CCW_HOME);
    assert.ok(files.length > 0);

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf8');
      assert.equal(content.includes(secret), false);
    }
  });

  it('writes config file with restrictive permissions where supported', () => {
    mod.addProvider(PROJECT_ROOT, {
      name: 'Perms Provider',
      type: 'openai',
      apiKey: 'sk-test-raw-key',
      apiBase: undefined,
      enabled: true,
    });

    const stat = statSync(CONFIG_PATH);
    assert.equal(stat.isFile(), true);

    if (process.platform === 'win32') return;

    // Require no permissions for group/others (0600).
    const mode = stat.mode & 0o777;
    assert.equal(mode & 0o077, 0);
  });
});
