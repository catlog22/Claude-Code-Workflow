/**
 * CodexLens route utilities.
 *
 * CodexLens CLI can emit logging + ANSI escapes even with --json, so helpers
 * here normalize output for reliable JSON parsing.
 */

/**
 * Strip ANSI color codes from string.
 * Rich library adds color codes even with --json flag.
 */
export function stripAnsiCodes(str: string): string {
  // ANSI escape code pattern: \x1b[...m or \x1b]...
  return str.replace(/\x1b\[[0-9;]*m/g, '')
            .replace(/\x1b\][0-9;]*\x07/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '');
}

/**
 * Format file size to human readable string.
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(i < 2 ? 0 : 1));
  return size + ' ' + units[i];
}

/**
 * Extract JSON from CLI output that may contain logging messages.
 * CodexLens CLI outputs logs like "INFO ..." before the JSON.
 * Also strips ANSI color codes that Rich library adds.
 * Handles trailing content after JSON (e.g., "INFO: Done" messages).
 */
export function extractJSON(output: string): any {
  // Strip ANSI color codes first
  const cleanOutput = stripAnsiCodes(output);

  // Find the first { or [ character (start of JSON)
  const jsonStart = cleanOutput.search(/[{\[]/);
  if (jsonStart === -1) {
    throw new Error('No JSON found in output');
  }

  const startChar = cleanOutput[jsonStart];
  const endChar = startChar === '{' ? '}' : ']';

  // Find matching closing brace/bracket using a simple counter
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let jsonEnd = -1;

  for (let i = jsonStart; i < cleanOutput.length; i++) {
    const char = cleanOutput[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === startChar) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }

  if (jsonEnd === -1) {
    // Fallback: try to parse from start to end (original behavior)
    const jsonString = cleanOutput.substring(jsonStart);
    return JSON.parse(jsonString);
  }

  const jsonString = cleanOutput.substring(jsonStart, jsonEnd);
  return JSON.parse(jsonString);
}

