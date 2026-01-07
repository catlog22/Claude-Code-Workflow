/**
 * Centralized timeout defaults for synchronous process execution.
 *
 * `execSync` blocks the Node.js event loop. Always provide a timeout so callers
 * fail fast instead of hanging indefinitely when external tools stall.
 *
 * Guidance:
 * - Use `GIT_QUICK` for lightweight git queries (rev-parse, status).
 * - Use `GIT_DIFF` for diff-based queries.
 * - Use `GIT_LOG` for log/history queries.
 * - Use `PYTHON_VERSION` for `python --version` style probes.
 * - Use `SYSTEM_INFO` for OS/hardware capability probes (wmic, nvidia-smi, which/where).
 * - Use `PROCESS_SPAWN` for short-lived spawn-style operations.
 * - Use `PACKAGE_INSTALL` for package manager operations that may take minutes.
 */
export const EXEC_TIMEOUTS = {
  GIT_QUICK: 5_000,
  GIT_DIFF: 10_000,
  GIT_LOG: 15_000,
  PYTHON_VERSION: 5_000,
  SYSTEM_INFO: 10_000,
  PROCESS_SPAWN: 30_000,
  PACKAGE_INSTALL: 300_000,
} as const;
