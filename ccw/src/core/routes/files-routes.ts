/**
 * Files Routes Module
 * Handles all file browsing related API endpoints
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { validatePath as validateAllowedPath } from '../../utils/path-validator.js';
import type { RouteContext } from './types.js';

// ========================================
// Constants
// ========================================

// Directories to always exclude from file tree
const EXPLORER_EXCLUDE_DIRS = [
  '.git', '__pycache__', 'node_modules', '.venv', 'venv', 'env',
  'dist', 'build', '.cache', '.pytest_cache', '.mypy_cache',
  'coverage', '.nyc_output', 'logs', 'tmp', 'temp', '.next',
  '.nuxt', '.output', '.turbo', '.parcel-cache'
];

// File extensions to language mapping for syntax highlighting
const EXT_TO_LANGUAGE = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.json': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'nginx',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'plaintext',
  '.log': 'plaintext',
  '.env': 'bash',
  '.dockerfile': 'dockerfile',
  '.vue': 'html',
  '.svelte': 'html'
};

interface ExplorerFileEntry {
  name: string;
  type: 'directory' | 'file';
  path: string;
  hasClaudeMd?: boolean;
}

interface ExplorerDirectoryFilesResult {
  path?: string;
  files: ExplorerFileEntry[];
  gitignorePatterns?: string[];
  error?: string;
}

interface ExplorerFileContentResult {
  error?: string;
  content?: string;
  language?: string;
  isMarkdown?: boolean;
  fileName?: string;
  path?: string;
  size?: number;
  lines?: number;
}

interface UpdateClaudeMdResult {
  success?: boolean;
  error?: string;
  message?: string;
  output?: string;
  path?: string;
}

// ========================================
// Helper Functions
// ========================================

/**
 * Parse .gitignore file and return patterns
 * @param {string} gitignorePath - Path to .gitignore file
 * @returns {string[]} Array of gitignore patterns
 */
function parseGitignore(gitignorePath: string): string[] {
  try {
    if (!existsSync(gitignorePath)) return [];
    const content = readFileSync(gitignorePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Check if a file/directory should be ignored based on gitignore patterns
 * Simple pattern matching (supports basic glob patterns)
 * @param {string} name - File or directory name
 * @param {string[]} patterns - Gitignore patterns
 * @param {boolean} isDirectory - Whether the entry is a directory
 * @returns {boolean}
 */
function shouldIgnore(name: string, patterns: string[], isDirectory: boolean): boolean {
  // Always exclude certain directories
  if (isDirectory && EXPLORER_EXCLUDE_DIRS.includes(name)) {
    return true;
  }

  // Skip hidden files/directories (starting with .)
  if (name.startsWith('.') && name !== '.claude' && name !== '.workflow') {
    return true;
  }

  for (const pattern of patterns) {
    let p = pattern;

    // Handle negation patterns (we skip them for simplicity)
    if (p.startsWith('!')) continue;

    // Handle directory-only patterns
    if (p.endsWith('/')) {
      if (!isDirectory) continue;
      p = p.slice(0, -1);
    }

    // Simple pattern matching
    if (p === name) return true;

    // Handle wildcard patterns
    if (p.includes('*')) {
      const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (regex.test(name)) return true;
    }

    // Handle extension patterns like *.log
    if (p.startsWith('*.')) {
      const ext = p.slice(1);
      if (name.endsWith(ext)) return true;
    }
  }

  return false;
}

/**
 * List directory files with .gitignore filtering
 * @param {string} dirPath - Directory path to list
 * @returns {Promise<Object>}
 */
async function listDirectoryFiles(dirPath: string): Promise<ExplorerDirectoryFilesResult> {
  try {
    // Normalize path
    let normalizedPath = dirPath.replace(/\\/g, '/');
    if (normalizedPath.match(/^\/[a-zA-Z]\//)) {
      normalizedPath = normalizedPath.charAt(1).toUpperCase() + ':' + normalizedPath.slice(2);
    }

    if (!existsSync(normalizedPath)) {
      return { error: 'Directory not found', files: [] };
    }

    if (!statSync(normalizedPath).isDirectory()) {
      return { error: 'Not a directory', files: [] };
    }

    // Parse .gitignore patterns
    const gitignorePath = join(normalizedPath, '.gitignore');
    const gitignorePatterns = parseGitignore(gitignorePath);

    // Read directory entries
    const entries = readdirSync(normalizedPath, { withFileTypes: true });

    const files: ExplorerFileEntry[] = [];
    for (const entry of entries) {
      const isDirectory = entry.isDirectory();

      // Check if should be ignored
      if (shouldIgnore(entry.name, gitignorePatterns, isDirectory)) {
        continue;
      }

      const entryPath = join(normalizedPath, entry.name);
      const fileInfo: ExplorerFileEntry = {
        name: entry.name,
        type: isDirectory ? 'directory' : 'file',
        path: entryPath.replace(/\\/g, '/')
      };

      // Check if directory has CLAUDE.md
      if (isDirectory) {
        const claudeMdPath = join(entryPath, 'CLAUDE.md');
        fileInfo.hasClaudeMd = existsSync(claudeMdPath);
      }

      files.push(fileInfo);
    }

    // Sort: directories first, then alphabetically
    files.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      path: normalizedPath.replace(/\\/g, '/'),
      files,
      gitignorePatterns
    };
  } catch (error: unknown) {
    console.error('Error listing directory:', error);
    return { error: (error as Error).message, files: [] };
  }
}

/**
 * Get file content for preview
 * @param {string} filePath - Path to file
 * @returns {Promise<Object>}
 */
async function getFileContent(filePath: string): Promise<ExplorerFileContentResult> {
  try {
    // Normalize path
    let normalizedPath = filePath.replace(/\\/g, '/');
    if (normalizedPath.match(/^\/[a-zA-Z]\//)) {
      normalizedPath = normalizedPath.charAt(1).toUpperCase() + ':' + normalizedPath.slice(2);
    }

    if (!existsSync(normalizedPath)) {
      return { error: 'File not found' };
    }

    const stats = statSync(normalizedPath);
    if (stats.isDirectory()) {
      return { error: 'Cannot read directory' };
    }

    // Check file size (limit to 1MB for preview)
    if (stats.size > 1024 * 1024) {
      return { error: 'File too large for preview (max 1MB)', size: stats.size };
    }

    // Read file content
    const content = readFileSync(normalizedPath, 'utf8');
    const ext = normalizedPath.substring(normalizedPath.lastIndexOf('.')).toLowerCase();
    const language = Object.prototype.hasOwnProperty.call(EXT_TO_LANGUAGE, ext)
      ? EXT_TO_LANGUAGE[ext as keyof typeof EXT_TO_LANGUAGE]
      : 'plaintext';
    const isMarkdown = ext === '.md' || ext === '.markdown';
    const fileName = normalizedPath.split('/').pop() ?? normalizedPath;

    return {
      content,
      language,
      isMarkdown,
      fileName,
      path: normalizedPath,
      size: stats.size,
      lines: content.split('\n').length
    };
  } catch (error: unknown) {
    console.error('Error reading file:', error);
    return { error: (error as Error).message };
  }
}

/**
 * Trigger update-module-claude tool (async execution)
 * @param {string} targetPath - Directory path to update
 * @param {string} tool - CLI tool to use (gemini, qwen, codex, claude)
 * @param {string} strategy - Update strategy (single-layer, multi-layer)
 * @returns {Promise<Object>}
 */
async function triggerUpdateClaudeMd(targetPath: string, tool: string, strategy: string): Promise<UpdateClaudeMdResult> {
  const { spawn } = await import('child_process');

  // Normalize path
  let normalizedPath = targetPath.replace(/\\/g, '/');
  if (normalizedPath.match(/^\/[a-zA-Z]\//)) {
    normalizedPath = normalizedPath.charAt(1).toUpperCase() + ':' + normalizedPath.slice(2);
  }

  if (!existsSync(normalizedPath)) {
    return { error: 'Directory not found' };
  }

  if (!statSync(normalizedPath).isDirectory()) {
    return { error: 'Not a directory' };
  }

  // Build ccw tool command with JSON parameters
  const params = JSON.stringify({
    strategy,
    path: normalizedPath,
    tool
  });

  console.log(`[Explorer] Running async: ccw tool exec update_module_claude with ${tool} (${strategy})`);

  return new Promise<UpdateClaudeMdResult>((resolve) => {
    const isWindows = process.platform === 'win32';

    // Spawn the process
    const child = spawn('ccw', ['tool', 'exec', 'update_module_claude', params], {
      cwd: normalizedPath,
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        // Parse the JSON output from the tool
        let result: unknown;
        try {
          result = JSON.parse(stdout);
        } catch {
          result = { output: stdout };
        }

        const parsed = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : null;
        const parsedSuccess = typeof parsed?.success === 'boolean' ? parsed.success : undefined;
        const parsedError = typeof parsed?.error === 'string' ? parsed.error : undefined;
        const parsedMessage = typeof parsed?.message === 'string' ? parsed.message : undefined;

        if (parsedSuccess === false || parsedError) {
          resolve({
            success: false,
            error: parsedError || parsedMessage || 'Update failed',
            output: stdout
          });
        } else {
          resolve({
            success: true,
            message: parsedMessage || `CLAUDE.md updated successfully using ${tool} (${strategy})`,
            output: stdout,
            path: normalizedPath
          });
        }
      } else {
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`,
          output: stdout + stderr
        });
      }
    });

    child.on('error', (error: unknown) => {
      console.error('Error spawning process:', error);
      resolve({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        output: ''
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        error: 'Timeout: Process took longer than 5 minutes',
        output: stdout
      });
    }, 300000);
  });
}

// ========================================
// Route Handler
// ========================================

/**
 * Handle files routes
 * @returns true if route was handled, false otherwise
 */
export async function handleFilesRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest } = ctx;

  // API: List directory files with .gitignore filtering (Explorer view)
  if (pathname === '/api/files') {
    const dirPath = url.searchParams.get('path') || initialPath;

    try {
      const validatedDir = await validateAllowedPath(dirPath, { mustExist: true, allowedDirectories: [initialPath] });
      const filesData = await listDirectoryFiles(validatedDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(filesData));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('Access denied') ? 403 : 400;
      console.error(`[Files] Path validation failed: ${message}`);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 403 ? 'Access denied' : 'Invalid path', files: [] }));
    }
    return true;
  }

  // API: Get file content for preview (Explorer view)
  if (pathname === '/api/file-content') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File path is required' }));
      return true;
    }

    try {
      const validatedFile = await validateAllowedPath(filePath, { mustExist: true, allowedDirectories: [initialPath] });
      const fileData = await getFileContent(validatedFile);
      res.writeHead(fileData.error ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fileData));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('Access denied') ? 403 : 400;
      console.error(`[Files] Path validation failed: ${message}`);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 403 ? 'Access denied' : 'Invalid path' }));
    }
    return true;
  }

  // API: Update CLAUDE.md using CLI tools (Explorer view)
  if (pathname === '/api/update-claude-md' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      if (typeof body !== 'object' || body === null) {
        return { error: 'Invalid request body', status: 400 };
      }

      const {
        path: targetPath,
        tool = 'gemini',
        strategy = 'single-layer'
      } = body as { path?: unknown; tool?: unknown; strategy?: unknown };

      if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
        return { error: 'path is required', status: 400 };
      }

      try {
        const validatedPath = await validateAllowedPath(targetPath, { mustExist: true, allowedDirectories: [initialPath] });
        return await triggerUpdateClaudeMd(
          validatedPath,
          typeof tool === 'string' ? tool : 'gemini',
          typeof strategy === 'string' ? strategy : 'single-layer'
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes('Access denied') ? 403 : 400;
        console.error(`[Files] Path validation failed: ${message}`);
        return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
      }
    });
    return true;
  }

  return false;
}
