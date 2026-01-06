/**
 * Unit tests for CORS origin validation (ccw/dist/core/cors.js)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const corsUrl = new URL('../dist/core/cors.js', import.meta.url).href;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let corsMod: any;

describe('CORS origin validation', async () => {
  corsMod = await import(corsUrl);

  it('allows localhost origins on the server port', () => {
    assert.equal(corsMod.validateCorsOrigin('http://localhost:3456', 3456), true);
    assert.equal(corsMod.validateCorsOrigin('http://127.0.0.1:3456', 3456), true);
  });

  it('rejects external origins', () => {
    assert.equal(corsMod.validateCorsOrigin('http://evil.com', 3456), false);
    assert.equal(corsMod.validateCorsOrigin('http://localhost:3457', 3456), false);
  });

  it('defaults missing or rejected Origin to localhost', () => {
    assert.equal(corsMod.getCorsOrigin(undefined, 3456), 'http://localhost:3456');
    assert.equal(corsMod.getCorsOrigin('http://evil.com', 3456), 'http://localhost:3456');
  });
});

