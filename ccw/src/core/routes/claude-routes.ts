/**
 * CLAUDE.md Routes Module
 * Handles all CLAUDE.md memory rules management endpoints
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import type { RouteContext } from './types.js';

interface ClaudeFile {
  id: string;
  level: 'user' | 'project' | 'module';
  path: string;
  relativePath: string;
  name: string;
  content?: string;
  size: number;
  lastModified: string;
  frontmatter?: { paths?: string[] };
  stats?: { lines: number; words: number; characters: number };
  isMainFile: boolean;
  parentDirectory?: string;
  depth?: number;
}

interface ClaudeFilesHierarchy {
  user: { main: ClaudeFile | null };
  project: { main: ClaudeFile | null };
  modules: ClaudeFile[];
  summary: { totalFiles: number; totalSize: number; lastSync?: string };
}

/**
 * Parse frontmatter from markdown file
 * Reuses logic from rules-routes.ts
 */
function parseClaudeFrontmatter(content: string) {
  const result = {
    paths: [] as string[],
    content: content
  };

  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex > 0) {
      const frontmatter = content.substring(3, endIndex).trim();
      result.content = content.substring(endIndex + 3).trim();

      const lines = frontmatter.split('\n');
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();

          if (key === 'paths') {
            result.paths = value.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Calculate file statistics
 */
function calculateFileStats(content: string) {
  const lines = content.split('\n').length;
  const words = content.split(/\s+/).filter(w => w.length > 0).length;
  const characters = content.length;
  return { lines, words, characters };
}

/**
 * Create ClaudeFile object from file path
 */
function createClaudeFile(
  filePath: string,
  level: 'user' | 'project' | 'module',
  basePath: string,
  isMainFile: boolean,
  depth?: number
): ClaudeFile | null {
  try {
    if (!existsSync(filePath)) return null;

    const stat = statSync(filePath);
    const content = readFileSync(filePath, 'utf8');
    const parsed = parseClaudeFrontmatter(content);
    const relativePath = relative(basePath, filePath).replace(/\\/g, '/');
    const fileName = filePath.split(/[\\/]/).pop() || 'CLAUDE.md';

    // Parent directory for module-level files
    const parentDir = level === 'module'
      ? filePath.split(/[\\/]/).slice(-2, -1)[0]
      : undefined;

    return {
      id: `${level}-${relativePath}`,
      level,
      path: filePath,
      relativePath,
      name: fileName,
      content: parsed.content,
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
      frontmatter: { paths: parsed.paths },
      stats: calculateFileStats(content),
      isMainFile,
      parentDirectory: parentDir,
      depth
    };
  } catch (e) {
    console.error(`Error creating ClaudeFile for ${filePath}:`, e);
    return null;
  }
}

/**
 * Scan rules directory (recursive)
 * Adapted from rules-routes.ts::scanRulesDirectory
 */
function scanClaudeRulesDirectory(dirPath: string, level: 'user' | 'project', basePath: string): ClaudeFile[] {
  const files: ClaudeFile[] = [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isFile() && entry.name.endsWith('.md')) {
        const file = createClaudeFile(fullPath, level, basePath, false);
        if (file) files.push(file);
      } else if (entry.isDirectory()) {
        const subFiles = scanClaudeRulesDirectory(fullPath, level, basePath);
        files.push(...subFiles);
      }
    }
  } catch (e) {
    // Ignore errors
  }

  return files;
}

/**
 * Scan modules for CLAUDE.md files
 * Uses get-modules-by-depth logic
 */
function scanModules(projectPath: string): ClaudeFile[] {
  const modules: ClaudeFile[] = [];
  const visited = new Set<string>();

  // Directories to exclude (from get-modules-by-depth.ts)
  const SYSTEM_EXCLUDES = [
    '.git', '.svn', '.hg', '__pycache__', 'node_modules', '.npm', '.yarn',
    'dist', 'build', 'out', '.cache', '.venv', 'venv', 'env', 'coverage'
  ];

  function scanDirectory(dirPath: string, depth: number) {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      // Check for CLAUDE.md in current directory
      const claudePath = join(dirPath, 'CLAUDE.md');
      if (existsSync(claudePath) && !visited.has(claudePath)) {
        visited.add(claudePath);
        const file = createClaudeFile(claudePath, 'module', projectPath, true, depth);
        if (file) modules.push(file);
      }

      // Recurse into subdirectories
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SYSTEM_EXCLUDES.includes(entry.name)) continue;

        const fullPath = join(dirPath, entry.name);
        scanDirectory(fullPath, depth + 1);
      }
    } catch (e) {
      // Ignore permission errors
    }
  }

  scanDirectory(projectPath, 0);
  return modules.sort((a, b) => (b.depth || 0) - (a.depth || 0)); // Deepest first
}

/**
 * Scan all CLAUDE.md files
 */
function scanAllClaudeFiles(projectPath: string): ClaudeFilesHierarchy {
  const result: ClaudeFilesHierarchy = {
    user: { main: null },
    project: { main: null },
    modules: [],
    summary: { totalFiles: 0, totalSize: 0 }
  };

  // User-level files (only main CLAUDE.md, no rules)
  const userHome = homedir();
  const userClaudeDir = join(userHome, '.claude');
  const userClaudePath = join(userClaudeDir, 'CLAUDE.md');

  if (existsSync(userClaudePath)) {
    result.user.main = createClaudeFile(userClaudePath, 'user', userHome, true);
  }

  // Project-level files (only main CLAUDE.md, no rules)
  const projectClaudeDir = join(projectPath, '.claude');
  const projectClaudePath = join(projectClaudeDir, 'CLAUDE.md');

  if (existsSync(projectClaudePath)) {
    result.project.main = createClaudeFile(projectClaudePath, 'project', projectPath, true);
  }

  // Module-level files
  result.modules = scanModules(projectPath);

  // Calculate summary (only main CLAUDE.md files, no rules)
  const allFiles = [
    result.user.main,
    result.project.main,
    ...result.modules
  ].filter(f => f !== null) as ClaudeFile[];

  result.summary = {
    totalFiles: allFiles.length,
    totalSize: allFiles.reduce((sum, f) => sum + f.size, 0),
    lastSync: new Date().toISOString()
  };

  return result;
}

/**
 * Get single file content
 */
function getClaudeFile(filePath: string): ClaudeFile | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const stat = statSync(filePath);
    const content = readFileSync(filePath, 'utf8');
    const parsed = parseClaudeFrontmatter(content);

    // Determine level based on path
    let level: 'user' | 'project' | 'module' = 'module';
    if (filePath.includes(join(homedir(), '.claude'))) {
      level = 'user';
    } else if (filePath.includes('.claude')) {
      level = 'project';
    }

    const isMainFile = filePath.endsWith('CLAUDE.md') && !filePath.includes('rules');

    return {
      id: `${level}-${filePath}`,
      level,
      path: filePath,
      relativePath: filePath,
      name: filePath.split(/[\\/]/).pop() || 'CLAUDE.md',
      content: parsed.content,
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
      frontmatter: { paths: parsed.paths },
      stats: calculateFileStats(content),
      isMainFile
    };
  } catch (error) {
    console.error('Error reading CLAUDE.md file:', error);
    return null;
  }
}

/**
 * Save file content
 */
function saveClaudeFile(filePath: string, content: string, createBackup: boolean = false): { success: boolean; error?: string } {
  try {
    if (!existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    // Create backup if requested
    if (createBackup) {
      const backupPath = `${filePath}.backup-${Date.now()}`;
      const originalContent = readFileSync(filePath, 'utf8');
      writeFileSync(backupPath, originalContent, 'utf8');
    }

    // Write new content
    writeFileSync(filePath, content, 'utf8');

    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Generate CLI prompt for syncing CLAUDE.md files
 */
function generateSyncPrompt(level: 'user' | 'project' | 'module', modulePath?: string): string {
  if (level === 'module' && modulePath) {
    // Module-level prompt
    return `PURPOSE: Generate module-level CLAUDE.md for ${modulePath}
TASK: • Analyze module's purpose and responsibilities • Document public APIs and interfaces • Identify dependencies and integration points • Note testing patterns and conventions
MODE: analysis
CONTEXT: @${modulePath}/**/* | Memory: Project conventions from .claude/CLAUDE.md
EXPECTED: Module-level CLAUDE.md with: - Module purpose (1-2 sentences) - Key files and their roles - Public API documentation - Integration points - Testing approach
RULES: $(cat ~/.claude/workflows/cli-templates/prompts/planning/02-design-component-spec.txt) | Module-level perspective only | Concrete examples | analysis=READ-ONLY`;
  } else {
    // User/Project level prompt
    const contextPath = level === 'user' ? '~/.claude' : '.claude';
    return `PURPOSE: Update CLAUDE.md with current ${level} understanding
TASK: • Analyze ${level} configuration and conventions • Identify common patterns and anti-patterns • Generate concise, actionable rules • Maintain existing structure and formatting
MODE: analysis
CONTEXT: @${contextPath}/**/*
EXPECTED: Updated CLAUDE.md content with: - Preserved existing sections - New insights appended to relevant sections - Timestamp header - Focus on ${level}-level concerns
RULES: $(cat ~/.claude/workflows/cli-templates/prompts/analysis/02-analyze-code-patterns.txt) | Maintain existing CLAUDE.md structure | Focus on actionable rules | analysis=READ-ONLY`;
  }
}

/**
 * Smart merge CLAUDE.md content (update mode)
 */
function smartMergeContent(existingContent: string, cliOutput: string): string {
  // For now, use simple append strategy
  // TODO: Implement intelligent section-based merging
  const timestamp = new Date().toISOString();
  const separator = '\n\n---\n\n';
  const header = `## Updated: ${timestamp}\n\n`;

  return existingContent + separator + header + cliOutput;
}

/**
 * Scan all files in project directory
 */
function scanAllProjectFiles(projectPath: string): any {
  const SYSTEM_EXCLUDES = [
    '.git', '.svn', '.hg', '__pycache__', 'node_modules', '.npm', '.yarn',
    'dist', 'build', 'out', '.cache', '.venv', 'venv', 'env', 'coverage',
    '.next', '.nuxt', '.output', '.turbo', '.parcel-cache', 'logs', 'tmp', 'temp'
  ];

  const results: any = {
    files: [],
    summary: { totalFiles: 0, totalDirectories: 0, totalSize: 0 }
  };

  function scanDir(dirPath: string, depth: number = 0): any[] {
    if (depth > 10) return []; // Max depth limit

    const files: any[] = [];

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip system excludes and hidden files (except .claude and .workflow)
        if (SYSTEM_EXCLUDES.includes(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.claude' && entry.name !== '.workflow') continue;

        const fullPath = join(dirPath, entry.name);
        const relativePath = relative(projectPath, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          results.summary.totalDirectories++;

          const dirNode: any = {
            path: fullPath,
            name: entry.name,
            type: 'directory',
            depth,
            children: scanDir(fullPath, depth + 1)
          };

          files.push(dirNode);
        } else {
          const stat = statSync(fullPath);
          results.summary.totalFiles++;
          results.summary.totalSize += stat.size;

          files.push({
            path: fullPath,
            name: entry.name,
            type: 'file',
            size: stat.size,
            lastModified: stat.mtime.toISOString(),
            depth
          });
        }
      }
    } catch (e) {
      // Ignore permission errors
    }

    return files;
  }

  results.files = scanDir(projectPath);
  return results;
}

/**
 * Read single file content
 */
function readSingleFile(filePath: string): { content: string; size: number; lastModified: string } | null {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    const content = readFileSync(filePath, 'utf8');
    return {
      content,
      size: stat.size,
      lastModified: stat.mtime.toISOString()
    };
  } catch (e) {
    return null;
  }
}

/**
 * Delete CLAUDE.md file
 */
function deleteClaudeFile(filePath: string): { success: boolean; error?: string } {
  try {
    if (!existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    // Create backup before deletion
    const backupPath = `${filePath}.deleted-${Date.now()}`;
    const content = readFileSync(filePath, 'utf8');
    writeFileSync(backupPath, content, 'utf8');

    // Delete original file
    unlinkSync(filePath);

    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Create new CLAUDE.md file with template
 */
function createNewClaudeFile(level: 'user' | 'project' | 'module', template: string, pathParam?: string): { success: boolean; path?: string; error?: string } {
  try {
    let filePath: string;
    let content: string;

    // Determine file path
    if (level === 'user') {
      filePath = join(homedir(), '.claude', 'CLAUDE.md');
    } else if (level === 'project' && pathParam) {
      filePath = join(pathParam, '.claude', 'CLAUDE.md');
    } else if (level === 'module' && pathParam) {
      filePath = join(pathParam, 'CLAUDE.md');
    } else {
      return { success: false, error: 'Invalid parameters' };
    }

    // Check if file already exists
    if (existsSync(filePath)) {
      return { success: false, error: 'File already exists' };
    }

    // Generate content based on template
    const timestamp = new Date().toISOString();

    if (template === 'minimal') {
      content = `# CLAUDE.md (${level.toUpperCase()} Level)\n\n> Created: ${timestamp}\n\n## Purpose\n\n[Describe the purpose of this ${level}-level context]\n\n## Guidelines\n\n- [Add guideline 1]\n- [Add guideline 2]\n`;
    } else if (template === 'comprehensive') {
      content = `# CLAUDE.md (${level.toUpperCase()} Level)\n\n> Created: ${timestamp}\n\n## Purpose\n\n[Describe the purpose and scope]\n\n## Architecture\n\n[Describe key architectural decisions]\n\n## Coding Conventions\n\n### Naming\n\n- [Convention 1]\n- [Convention 2]\n\n### Patterns\n\n- [Pattern 1]\n- [Pattern 2]\n\n## Testing Guidelines\n\n[Testing approach and conventions]\n\n## Dependencies\n\n[Key dependencies and integration points]\n\n## Common Tasks\n\n### Task 1\n\n[Steps for task 1]\n\n### Task 2\n\n[Steps for task 2]\n`;
    } else {
      // default template
      content = `# CLAUDE.md (${level.toUpperCase()} Level)\n\n> Created: ${timestamp}\n\n## Overview\n\n[Brief description of this ${level}-level context]\n\n## Key Conventions\n\n- [Convention 1]\n- [Convention 2]\n- [Convention 3]\n\n## Guidelines\n\n### Code Style\n\n[Style guidelines]\n\n### Best Practices\n\n[Best practices]\n`;
    }

    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf('/') || filePath.lastIndexOf('\\'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write file
    writeFileSync(filePath, content, 'utf8');

    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Handle CLAUDE.md routes
 */
export async function handleClaudeRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest, broadcastToClients } = ctx;

  // API: Scan all CLAUDE.md files
  if (pathname === '/api/memory/claude/scan') {
    const projectPathParam = url.searchParams.get('path') || initialPath;
    const filesData = scanAllClaudeFiles(projectPathParam);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(filesData));
    return true;
  }

  // API: Scan all project files (not just CLAUDE.md)
  if (pathname === '/api/memory/claude/scan-all') {
    const projectPathParam = url.searchParams.get('path') || initialPath;
    const filesData = scanAllProjectFiles(projectPathParam);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(filesData));
    return true;
  }

  // API: Read single file
  if (pathname === '/api/memory/claude/read-file' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return true;
    }

    const fileData = readSingleFile(filePath);
    if (!fileData) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fileData));
    return true;
  }

  // API: CLI Sync (analyze and update CLAUDE.md using CLI tools)
  if (pathname === '/api/memory/claude/sync' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: any) => {
      const { level, path: modulePath, tool = 'gemini', mode = 'update', targets } = body;

      if (!level) {
        return { error: 'Missing level parameter', status: 400 };
      }

      try {
        // Import CLI executor
        const { executeCliTool } = await import('../../tools/cli-executor.js');

        // Determine file path based on level
        let filePath: string;
        let workingDir: string;

        if (level === 'user') {
          filePath = join(homedir(), '.claude', 'CLAUDE.md');
          workingDir = join(homedir(), '.claude');
        } else if (level === 'project') {
          filePath = join(initialPath, '.claude', 'CLAUDE.md');
          workingDir = join(initialPath, '.claude');
        } else if (level === 'module' && modulePath) {
          filePath = join(modulePath, 'CLAUDE.md');
          workingDir = modulePath;
        } else {
          return { error: 'Invalid level or missing path for module level', status: 400 };
        }

        // Check if file exists (for update/append modes)
        const fileExists = existsSync(filePath);
        if (!fileExists && mode !== 'generate') {
          return { error: 'File does not exist. Use generate mode to create it.', status: 404 };
        }

        // Read existing content
        const existingContent = fileExists ? readFileSync(filePath, 'utf8') : '';

        // Generate CLI prompt
        const cliPrompt = generateSyncPrompt(level, modulePath);

        // Execute CLI tool
        const syncId = `claude-sync-${level}-${Date.now()}`;
        const result = await executeCliTool({
          tool: tool === 'qwen' ? 'qwen' : 'gemini',
          prompt: cliPrompt,
          mode: 'analysis',
          format: 'plain',
          cd: workingDir,
          timeout: 600000, // 10 minutes
          stream: false,
          category: 'internal',
          id: syncId
        });

        if (!result.success || !result.execution?.output) {
          return {
            error: 'CLI execution failed',
            details: result.stderr || result.execution?.output?.stderr || 'No output received',
            status: 500
          };
        }

        // Extract CLI output
        const cliOutput = typeof result.execution.output === 'string'
          ? result.execution.output
          : result.execution.output.stdout || '';

        if (!cliOutput || cliOutput.trim().length === 0) {
          return { error: 'CLI returned empty output', status: 500 };
        }

        // Process content based on mode
        let finalContent: string;

        if (mode === 'generate') {
          // Full replace
          const timestamp = new Date().toISOString();
          finalContent = `# CLAUDE.md (${level.toUpperCase()} Level)\n\n> Auto-generated using ${tool.toUpperCase()}\n> Last updated: ${timestamp}\n\n---\n\n${cliOutput}`;
        } else if (mode === 'append') {
          // Simple append
          const timestamp = new Date().toISOString();
          finalContent = existingContent + `\n\n---\n\n## Updated: ${timestamp}\n\n${cliOutput}`;
        } else {
          // Smart merge (update mode)
          finalContent = smartMergeContent(existingContent, cliOutput);
        }

        // Write updated content
        writeFileSync(filePath, finalContent, 'utf8');

        // Mark file as updated for freshness tracking
        try {
          const { markFileAsUpdated } = await import('../claude-freshness.js');
          markFileAsUpdated(filePath, level, 'cli_sync', initialPath, { tool, mode });
        } catch (e) {
          console.error('Failed to mark file as updated:', e);
        }

        // Broadcast WebSocket event
        broadcastToClients({
          type: 'CLAUDE_FILE_SYNCED',
          payload: {
            path: filePath,
            level,
            tool,
            mode,
            executionId: syncId,
            timestamp: new Date().toISOString()
          }
        });

        return {
          success: true,
          path: filePath,
          executionId: syncId,
          mode,
          tool
        };

      } catch (error) {
        console.error('Error syncing CLAUDE.md file:', error);
        return {
          error: 'Sync failed',
          details: (error as Error).message,
          status: 500
        };
      }
    });
    return true;
  }

  // API: Get single file
  if (pathname === '/api/memory/claude/file' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return true;
    }

    const file = getClaudeFile(filePath);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(file));
    return true;
  }

  // API: Save file
  if (pathname === '/api/memory/claude/file' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: any) => {
      const { path: filePath, content, createBackup } = body;

      if (!filePath || content === undefined) {
        return { error: 'Missing path or content parameter', status: 400 };
      }

      const result = saveClaudeFile(filePath, content, createBackup);

      if (result.success) {
        // Broadcast update to all clients
        ctx.broadcastToClients({
          type: 'CLAUDE_FILE_UPDATED',
          data: { path: filePath }
        });
        return { success: true, path: filePath };
      } else {
        return { error: result.error, status: 500 };
      }
    });
    return true;
  }

  // API: Delete file
  if (pathname === '/api/memory/claude/file' && req.method === 'DELETE') {
    const filePath = url.searchParams.get('path');
    const confirm = url.searchParams.get('confirm');

    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return true;
    }

    if (confirm !== 'true') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Confirmation required' }));
      return true;
    }

    const result = deleteClaudeFile(filePath);

    if (result.success) {
      broadcastToClients({
        type: 'CLAUDE_FILE_DELETED',
        data: { path: filePath }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
    }
    return true;
  }

  // API: Create file
  if (pathname === '/api/memory/claude/create' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: any) => {
      const { level, path, template = 'default' } = body;

      if (!level) {
        return { error: 'Missing level parameter', status: 400 };
      }

      let result: any;

      if (level === 'project') {
        // For project level, use initialPath
        const filePath = join(initialPath, '.claude', 'CLAUDE.md');
        result = createNewClaudeFile(level, template, initialPath);
      } else if (level === 'module') {
        if (!path) {
          return { error: 'Module path required', status: 400 };
        }
        result = createNewClaudeFile(level, template, path);
      } else {
        result = createNewClaudeFile(level, template);
      }

      if (result.success) {
        broadcastToClients({
          type: 'CLAUDE_FILE_CREATED',
          data: { path: result.path, level }
        });
        return { success: true, path: result.path };
      } else {
        return { error: result.error, status: 500 };
      }
    });
    return true;
  }

  // API: Get Chinese response setting status
  if (pathname === '/api/language/chinese-response' && req.method === 'GET') {
    try {
      const userClaudePath = join(homedir(), '.claude', 'CLAUDE.md');
      const chineseRefPattern = /@.*chinese-response\.md/i;

      let enabled = false;
      let guidelinesPath = '';

      // Check if user CLAUDE.md exists and contains Chinese response reference
      if (existsSync(userClaudePath)) {
        const content = readFileSync(userClaudePath, 'utf8');
        enabled = chineseRefPattern.test(content);
      }

      // Find guidelines file path - always use user-level path
      const userGuidelinesPath = join(homedir(), '.claude', 'workflows', 'chinese-response.md');

      if (existsSync(userGuidelinesPath)) {
        guidelinesPath = userGuidelinesPath;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        enabled,
        guidelinesPath,
        guidelinesExists: !!guidelinesPath,
        userClaudeMdExists: existsSync(userClaudePath)
      }));
      return true;
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
      return true;
    }
  }

  // API: Toggle Chinese response setting
  if (pathname === '/api/language/chinese-response' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: any) => {
      const { enabled } = body;

      if (typeof enabled !== 'boolean') {
        return { error: 'Missing or invalid enabled parameter', status: 400 };
      }

      try {
        const userClaudePath = join(homedir(), '.claude', 'CLAUDE.md');
        const userClaudeDir = join(homedir(), '.claude');

        // Find guidelines file path - always use user-level path with ~ shorthand
        const userGuidelinesPath = join(homedir(), '.claude', 'workflows', 'chinese-response.md');

        if (!existsSync(userGuidelinesPath)) {
          return { error: 'Chinese response guidelines file not found at ~/.claude/workflows/chinese-response.md', status: 404 };
        }

        const guidelinesRef = '~/.claude/workflows/chinese-response.md';

        const chineseRefLine = `- **中文回复准则**: @${guidelinesRef}`;
        const chineseRefPattern = /^- \*\*中文回复准则\*\*:.*chinese-response\.md.*$/gm;

        // Ensure user .claude directory exists
        if (!existsSync(userClaudeDir)) {
          const fs = require('fs');
          fs.mkdirSync(userClaudeDir, { recursive: true });
        }

        let content = '';
        if (existsSync(userClaudePath)) {
          content = readFileSync(userClaudePath, 'utf8');
        } else {
          // Create new CLAUDE.md with header
          content = '# Claude Instructions\n\n';
        }

        if (enabled) {
          // Check if reference already exists
          if (chineseRefPattern.test(content)) {
            return { success: true, message: 'Already enabled' };
          }

          // Add reference after the header line or at the beginning
          const headerMatch = content.match(/^# Claude Instructions\n\n?/);
          if (headerMatch) {
            const insertPosition = headerMatch[0].length;
            content = content.slice(0, insertPosition) + chineseRefLine + '\n' + content.slice(insertPosition);
          } else {
            // Add header and reference
            content = '# Claude Instructions\n\n' + chineseRefLine + '\n' + content;
          }
        } else {
          // Remove reference
          content = content.replace(chineseRefPattern, '').replace(/\n{3,}/g, '\n\n').trim();
          if (content) content += '\n';
        }

        writeFileSync(userClaudePath, content, 'utf8');

        // Broadcast update
        broadcastToClients({
          type: 'LANGUAGE_SETTING_CHANGED',
          data: { chineseResponse: enabled }
        });

        return { success: true, enabled };
      } catch (error) {
        return { error: (error as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Get Windows platform setting status
  if (pathname === '/api/language/windows-platform' && req.method === 'GET') {
    try {
      const userClaudePath = join(homedir(), '.claude', 'CLAUDE.md');
      const windowsRefPattern = /@.*windows-platform\.md/i;

      let enabled = false;
      let guidelinesPath = '';

      // Check if user CLAUDE.md exists and contains Windows platform reference
      if (existsSync(userClaudePath)) {
        const content = readFileSync(userClaudePath, 'utf8');
        enabled = windowsRefPattern.test(content);
      }

      // Find guidelines file path - always use user-level path
      const userGuidelinesPath = join(homedir(), '.claude', 'workflows', 'windows-platform.md');

      if (existsSync(userGuidelinesPath)) {
        guidelinesPath = userGuidelinesPath;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        enabled,
        guidelinesPath,
        guidelinesExists: !!guidelinesPath,
        userClaudeMdExists: existsSync(userClaudePath)
      }));
      return true;
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
      return true;
    }
  }

  // API: Toggle Windows platform setting
  if (pathname === '/api/language/windows-platform' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: any) => {
      const { enabled } = body;

      if (typeof enabled !== 'boolean') {
        return { error: 'Missing or invalid enabled parameter', status: 400 };
      }

      try {
        const userClaudePath = join(homedir(), '.claude', 'CLAUDE.md');
        const userClaudeDir = join(homedir(), '.claude');

        // Find guidelines file path - always use user-level path with ~ shorthand
        const userGuidelinesPath = join(homedir(), '.claude', 'workflows', 'windows-platform.md');

        if (!existsSync(userGuidelinesPath)) {
          return { error: 'Windows platform guidelines file not found at ~/.claude/workflows/windows-platform.md', status: 404 };
        }

        const guidelinesRef = '~/.claude/workflows/windows-platform.md';

        const windowsRefLine = `- **Windows Platform**: @${guidelinesRef}`;
        const windowsRefPattern = /^- \*\*Windows Platform\*\*:.*windows-platform\.md.*$/gm;

        // Ensure user .claude directory exists
        if (!existsSync(userClaudeDir)) {
          const fs = require('fs');
          fs.mkdirSync(userClaudeDir, { recursive: true });
        }

        let content = '';
        if (existsSync(userClaudePath)) {
          content = readFileSync(userClaudePath, 'utf8');
        } else {
          // Create new CLAUDE.md with header
          content = '# Claude Instructions\n\n';
        }

        if (enabled) {
          // Check if reference already exists
          if (windowsRefPattern.test(content)) {
            return { success: true, message: 'Already enabled' };
          }

          // Add reference after the header line or at the beginning
          const headerMatch = content.match(/^# Claude Instructions\n\n?/);
          if (headerMatch) {
            const insertPosition = headerMatch[0].length;
            content = content.slice(0, insertPosition) + windowsRefLine + '\n' + content.slice(insertPosition);
          } else {
            // Add header and reference
            content = '# Claude Instructions\n\n' + windowsRefLine + '\n' + content;
          }
        } else {
          // Remove reference
          content = content.replace(windowsRefPattern, '').replace(/\n{3,}/g, '\n\n').trim();
          if (content) content += '\n';
        }

        writeFileSync(userClaudePath, content, 'utf8');

        // Broadcast update
        broadcastToClients({
          type: 'LANGUAGE_SETTING_CHANGED',
          data: { windowsPlatform: enabled }
        });

        return { success: true, enabled };
      } catch (error) {
        return { error: (error as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Get freshness scores for all CLAUDE.md files
  if (pathname === '/api/memory/claude/freshness' && req.method === 'GET') {
    try {
      const { calculateAllFreshness } = await import('../claude-freshness.js');

      const projectPathParam = url.searchParams.get('path') || initialPath;
      const threshold = parseInt(url.searchParams.get('threshold') || '20', 10);

      // Get all CLAUDE.md files
      const filesData = scanAllClaudeFiles(projectPathParam);

      // Prepare file list for freshness calculation
      const claudeFiles: Array<{
        path: string;
        level: 'user' | 'project' | 'module';
        lastModified: string;
      }> = [];

      if (filesData.user.main) {
        claudeFiles.push({
          path: filesData.user.main.path,
          level: 'user',
          lastModified: filesData.user.main.lastModified
        });
      }

      if (filesData.project.main) {
        claudeFiles.push({
          path: filesData.project.main.path,
          level: 'project',
          lastModified: filesData.project.main.lastModified
        });
      }

      for (const module of filesData.modules) {
        claudeFiles.push({
          path: module.path,
          level: 'module',
          lastModified: module.lastModified
        });
      }

      // Calculate freshness
      const freshnessData = calculateAllFreshness(claudeFiles, projectPathParam, threshold);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(freshnessData));
      return true;
    } catch (error) {
      console.error('Error calculating freshness:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
      return true;
    }
  }

  // API: Mark a CLAUDE.md file as updated
  if (pathname === '/api/memory/claude/mark-updated' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: any) => {
      const { path: filePath, source, metadata } = body;

      if (!filePath) {
        return { error: 'Missing path parameter', status: 400 };
      }

      if (!source || !['manual', 'cli_sync', 'dashboard', 'api'].includes(source)) {
        return { error: 'Invalid or missing source parameter', status: 400 };
      }

      try {
        const { markFileAsUpdated } = await import('../claude-freshness.js');

        // Determine file level
        let level: 'user' | 'project' | 'module' = 'module';
        if (filePath.includes(join(homedir(), '.claude'))) {
          level = 'user';
        } else if (filePath.includes('.claude')) {
          level = 'project';
        }

        const record = markFileAsUpdated(filePath, level, source, initialPath, metadata);

        // Broadcast update
        broadcastToClients({
          type: 'CLAUDE_FRESHNESS_UPDATED',
          data: {
            path: filePath,
            level,
            updatedAt: record.updated_at,
            source
          }
        });

        return {
          success: true,
          record: {
            id: record.id,
            updated_at: record.updated_at,
            filesChangedBeforeUpdate: record.files_changed_before_update
          }
        };
      } catch (error) {
        console.error('Error marking file as updated:', error);
        return { error: (error as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Get update history for a CLAUDE.md file
  if (pathname === '/api/memory/claude/history' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return true;
    }

    try {
      const { getUpdateHistory } = await import('../claude-freshness.js');

      const records = getUpdateHistory(filePath, initialPath, limit);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        records: records.map(r => ({
          id: r.id,
          updated_at: r.updated_at,
          update_source: r.update_source,
          git_commit_hash: r.git_commit_hash,
          files_changed_before_update: r.files_changed_before_update,
          metadata: r.metadata ? JSON.parse(r.metadata) : undefined
        }))
      }));
      return true;
    } catch (error) {
      console.error('Error getting update history:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
      return true;
    }
  }

  return false;
}
