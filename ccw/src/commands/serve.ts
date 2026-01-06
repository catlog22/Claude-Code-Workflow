import { startServer } from '../core/server.js';
import { launchBrowser } from '../utils/browser-launcher.js';
import { resolvePath, validatePath } from '../utils/path-resolver.js';
import chalk from 'chalk';
import type { Server } from 'http';

interface ServeOptions {
  port?: number;
  path?: string;
  host?: string;
  browser?: boolean;
}

/**
 * Serve command handler - starts dashboard server with live path switching
 * @param {Object} options - Command options
 */
export async function serveCommand(options: ServeOptions): Promise<void> {
  const port = options.port || 3456;
  const host = options.host || '127.0.0.1';

  // Validate project path
  let initialPath = process.cwd();
  if (options.path) {
    const pathValidation = validatePath(options.path, { mustExist: true });
    if (!pathValidation.valid || !pathValidation.path) {
      console.error(chalk.red(`\n  Error: ${pathValidation.error}\n`));
      process.exit(1);
    }
    initialPath = pathValidation.path;
  }

  console.log(chalk.blue.bold('\n  CCW Dashboard Server\n'));
  console.log(chalk.gray(`  Initial project: ${initialPath}`));
  console.log(chalk.gray(`  Host: ${host}`));
  console.log(chalk.gray(`  Port: ${port}\n`));

  try {
    // Start server
    console.log(chalk.cyan('  Starting server...'));
    const server = await startServer({ port, host, initialPath });

    const boundUrl = `http://${host}:${port}`;
    const browserUrl = host === '0.0.0.0' || host === '::' ? `http://localhost:${port}` : boundUrl;

    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      console.log(chalk.yellow(`\n  WARNING: Binding to ${host} exposes the server to network attacks.`));
      console.log(chalk.yellow('  Ensure firewall is configured and never expose tokens publicly.\n'));
    }

    console.log(chalk.green(`  Server running at ${boundUrl}`));

    // Open browser
    if (options.browser !== false) {
      console.log(chalk.cyan('  Opening in browser...'));
      try {
        await launchBrowser(browserUrl);
        console.log(chalk.green.bold('\n  Dashboard opened in browser!'));
      } catch (err) {
        const error = err as Error;
        console.log(chalk.yellow(`\n  Could not open browser: ${error.message}`));
        console.log(chalk.gray(`  Open manually: ${browserUrl}`));
      }
    }

    console.log(chalk.gray('\n  Press Ctrl+C to stop the server\n'));

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n  Shutting down server...'));
      server.close(() => {
        console.log(chalk.green('  Server stopped.\n'));
        process.exit(0);
      });
    });

  } catch (error) {
    const err = error as Error & { code?: string };
    console.error(chalk.red(`\n  Error: ${err.message}\n`));
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.yellow(`  Port ${port} is already in use.`));
      console.error(chalk.gray(`  Try a different port: ccw serve --port ${port + 1}\n`));
    }
    process.exit(1);
  }
}
