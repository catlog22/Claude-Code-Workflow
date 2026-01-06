/**
 * Unit tests for Windows cmd.exe argument escaping (ccw/dist/utils/shell-escape.js)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const shellEscapeUrl = new URL('../dist/utils/shell-escape.js', import.meta.url).href;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

describe('escapeWindowsArg', async () => {
  mod = await import(shellEscapeUrl);

  it('escapes cmd.exe metacharacters with caret', () => {
    const cases: Array<{ input: string; expected: string }> = [
      { input: 'arg|command', expected: 'arg^|command' },
      { input: 'arg&command', expected: 'arg^&command' },
      { input: 'arg&&command', expected: 'arg^&^&command' },
      { input: 'arg||command', expected: 'arg^|^|command' },
      { input: 'arg>out.txt', expected: 'arg^>out.txt' },
      { input: 'arg>>out.txt', expected: 'arg^>^>out.txt' },
      { input: 'arg<input.txt', expected: 'arg^<input.txt' },
      { input: '(test)', expected: '^(test^)' },
      { input: '%PATH%', expected: '^%PATH^%' },
      { input: '!VAR!', expected: '^!VAR^!' },
      { input: 'arg"cmd', expected: 'arg^"cmd' },
      { input: 'a^b', expected: 'a^^b' },
    ];

    for (const { input, expected } of cases) {
      assert.equal(mod.escapeWindowsArg(input), expected, `escapeWindowsArg(${JSON.stringify(input)})`);
    }
  });

  it('wraps whitespace-containing args in double quotes', () => {
    assert.equal(mod.escapeWindowsArg('hello world'), '"hello world"');
    assert.equal(mod.escapeWindowsArg('test & echo'), '"test ^& echo"');
    assert.equal(mod.escapeWindowsArg('a|b c'), '"a^|b c"');
  });

  it('handles empty arguments', () => {
    assert.equal(mod.escapeWindowsArg(''), '""');
  });
});

