import { serveCommand } from './serve.js';
import { launchBrowser } from '../utils/browser-launcher.js';
import { validatePath } from '../utils/path-resolver.js';
import chalk from 'chalk';

interface ViewOptions {
  port?: number;
  path?: string;
  host?: string;
  browser?: boolean;
}

interface SwitchWorkspaceResult {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * Check if server is already running on the specified port
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} True if server is running
 */
async function isServerRunning(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);

    const response = await fetch(`http://localhost:${port}/api/health`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    // Authenticated APIs may return 401; any HTTP response means server is running.
    return response.status > 0;
  } catch {
    return false;
  }
}

/**
 * Switch workspace on running server
 * @param {number} port - Server port
 * @param {string} path - New workspace path
 * @returns {Promise<Object>} Result with success status
 */
async function switchWorkspace(port: number, path: string): Promise<SwitchWorkspaceResult> {
  try {
    const tokenResponse = await fetch(`http://localhost:${port}/api/auth/token`);
    const tokenData = await tokenResponse.json() as { token?: string };
    const token = tokenData.token;

    const response = await fetch(
      `http://localhost:${port}/api/switch-path?path=${encodeURIComponent(path)}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    );
    return await response.json() as SwitchWorkspaceResult;
  } catch (err) {
    const error = err as Error;
    return { success: false, error: error.message };
  }
}

/**
 * View command handler - opens dashboard for current workspace
 * If server is already running, switches workspace and opens browser
 * If not running, starts a new server
 * @param {Object} options - Command options
 */
export async function viewCommand(options: ViewOptions): Promise<void> {
  const port = options.port || 3456;
  const host = options.host || '127.0.0.1';
  const browserHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;

  // Resolve workspace path
  let workspacePath = process.cwd();
  if (options.path) {
    const pathValidation = validatePath(options.path, { mustExist: true });
    if (!pathValidation.valid || !pathValidation.path) {
      console.error(chalk.red(`\n  Error: ${pathValidation.error}\n`));
      process.exit(1);
    }
    workspacePath = pathValidation.path;
  }

  // Check if server is already running
  const serverRunning = await isServerRunning(port);

  if (serverRunning) {
    // Server is running - switch workspace and open browser
    console.log(chalk.blue.bold('\n  CCW Dashboard\n'));
    console.log(chalk.gray(`  Server already running on port ${port}`));
    console.log(chalk.cyan(`  Switching workspace to: ${workspacePath}`));

    const result = await switchWorkspace(port, workspacePath);

    if (result.success) {
      console.log(chalk.green(`  Workspace switched successfully`));

      // Open browser with the new path
      const url = `http://${browserHost}:${port}/?path=${encodeURIComponent(result.path!)}`;

      if (options.browser !== false) {
        console.log(chalk.cyan('  Opening in browser...'));
        try {
          await launchBrowser(url);
          console.log(chalk.green.bold('\n  Dashboard opened!\n'));
        } catch (err) {
          const error = err as Error;
          console.log(chalk.yellow(`\n  Could not open browser: ${error.message}`));
          console.log(chalk.gray(`  Open manually: ${url}\n`));
        }
      } else {
        console.log(chalk.gray(`\n  URL: ${url}\n`));
      }
    } else {
      console.error(chalk.red(`\n  Failed to switch workspace: ${result.error}\n`));
      process.exit(1);
    }
  } else {
    // Server not running - start new server
    await serveCommand({
      path: workspacePath,
      port: port,
      host,
      browser: options.browser
    });
  }
}
