/**
 * Python detection and version compatibility utilities
 * Shared module for consistent Python discovery across the application
 */

import { execSync } from 'child_process';
import { EXEC_TIMEOUTS } from './exec-constants.js';

function isExecTimeoutError(error: unknown): boolean {
  const err = error as { code?: unknown; errno?: unknown; message?: unknown } | null;
  const code = err?.code ?? err?.errno;
  if (code === 'ETIMEDOUT') return true;
  const message = typeof err?.message === 'string' ? err.message : '';
  return message.includes('ETIMEDOUT');
}

/**
 * Parse Python version string to major.minor numbers
 * @param versionStr - Version string like "Python 3.11.5"
 * @returns Object with major and minor version numbers, or null if parsing fails
 */
export function parsePythonVersion(versionStr: string): { major: number; minor: number } | null {
  const match = versionStr.match(/Python\s+(\d+)\.(\d+)/);
  if (match) {
    return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
  }
  return null;
}

/**
 * Check if Python version is compatible with onnxruntime (3.9-3.12)
 * @param major - Major version number
 * @param minor - Minor version number
 * @returns true if compatible
 */
export function isPythonVersionCompatible(major: number, minor: number): boolean {
  // onnxruntime currently supports Python 3.9-3.12
  return major === 3 && minor >= 9 && minor <= 12;
}

/**
 * Detect available Python 3 executable
 * Supports CCW_PYTHON environment variable for custom Python path
 * On Windows, uses py launcher to find compatible versions
 * @returns Python executable command
 */
export function getSystemPython(): string {
  // Check for user-specified Python via environment variable
  const customPython = process.env.CCW_PYTHON;
  if (customPython) {
    try {
      const version = execSync(`"${customPython}" --version 2>&1`, { encoding: 'utf8', timeout: EXEC_TIMEOUTS.PYTHON_VERSION });
      if (version.includes('Python 3')) {
        const parsed = parsePythonVersion(version);
        if (parsed && !isPythonVersionCompatible(parsed.major, parsed.minor)) {
          console.warn(`[Python] Warning: CCW_PYTHON points to Python ${parsed.major}.${parsed.minor}, which may not be compatible with onnxruntime (requires 3.9-3.12)`);
        }
        return `"${customPython}"`;
      }
    } catch (err: unknown) {
      if (isExecTimeoutError(err)) {
        console.warn(`[Python] Warning: CCW_PYTHON version check timed out after ${EXEC_TIMEOUTS.PYTHON_VERSION}ms, falling back to system Python`);
      } else {
        console.warn(`[Python] Warning: CCW_PYTHON="${customPython}" is not a valid Python executable, falling back to system Python`);
      }
    }
  }

  // On Windows, try py launcher with specific versions first (3.12, 3.11, 3.10, 3.9)
  if (process.platform === 'win32') {
    const compatibleVersions = ['3.12', '3.11', '3.10', '3.9'];
    for (const ver of compatibleVersions) {
      try {
        const version = execSync(`py -${ver} --version 2>&1`, { encoding: 'utf8', timeout: EXEC_TIMEOUTS.PYTHON_VERSION });
        if (version.includes(`Python ${ver}`)) {
          console.log(`[Python] Found compatible Python ${ver} via py launcher`);
          return `py -${ver}`;
        }
      } catch (err: unknown) {
        if (isExecTimeoutError(err)) {
          console.warn(`[Python] Warning: py -${ver} version check timed out after ${EXEC_TIMEOUTS.PYTHON_VERSION}ms`);
        }
        // Version not installed, try next
      }
    }
  }

  const commands = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  let fallbackCmd: string | null = null;
  let fallbackVersion: { major: number; minor: number } | null = null;

  for (const cmd of commands) {
    try {
      const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf8', timeout: EXEC_TIMEOUTS.PYTHON_VERSION });
      if (version.includes('Python 3')) {
        const parsed = parsePythonVersion(version);
        if (parsed) {
          // Prefer compatible version (3.9-3.12)
          if (isPythonVersionCompatible(parsed.major, parsed.minor)) {
            return cmd;
          }
          // Keep track of first Python 3 found as fallback
          if (!fallbackCmd) {
            fallbackCmd = cmd;
            fallbackVersion = parsed;
          }
        }
      }
    } catch (err: unknown) {
      if (isExecTimeoutError(err)) {
        console.warn(`[Python] Warning: ${cmd} --version timed out after ${EXEC_TIMEOUTS.PYTHON_VERSION}ms`);
      }
      // Try next command
    }
  }

  // If no compatible version found, use fallback with warning
  if (fallbackCmd && fallbackVersion) {
    console.warn(`[Python] Warning: Only Python ${fallbackVersion.major}.${fallbackVersion.minor} found, which may not be compatible with onnxruntime (requires 3.9-3.12).`);
    console.warn('[Python] To use a specific Python version, set CCW_PYTHON environment variable:');
    console.warn('  Windows: set CCW_PYTHON=C:\\path\\to\\python.exe');
    console.warn('  Unix: export CCW_PYTHON=/path/to/python3.11');
    console.warn('[Python] Alternatively, use LiteLLM embedding backend which has no Python version restrictions.');
    return fallbackCmd;
  }

  throw new Error('Python 3 not found. Please install Python 3.9-3.12 and ensure it is in PATH, or set CCW_PYTHON environment variable.');
}

/**
 * Get the Python command for pip operations (uses -m pip for reliability)
 * @returns Array of command arguments for spawn
 */
export function getPipCommand(): { pythonCmd: string; pipArgs: string[] } {
  const pythonCmd = getSystemPython();
  return {
    pythonCmd,
    pipArgs: ['-m', 'pip']
  };
}
