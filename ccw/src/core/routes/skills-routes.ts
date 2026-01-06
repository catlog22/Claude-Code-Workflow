// @ts-nocheck
/**
 * Skills Routes Module
 * Handles all Skills-related API endpoints
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, readdirSync, statSync, unlinkSync, promises as fsPromises } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { executeCliTool } from '../../tools/cli-executor.js';
import { validatePath as validateAllowedPath } from '../../utils/path-validator.js';

export interface RouteContext {
  pathname: string;
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  initialPath: string;
  handlePostRequest: (req: IncomingMessage, res: ServerResponse, handler: (body: unknown) => Promise<any>) => void;
  broadcastToClients: (data: unknown) => void;
}

// ========== Skills Helper Functions ==========

/**
 * Parse skill frontmatter (YAML header)
 * @param {string} content - Skill file content
 * @returns {Object} Parsed frontmatter and content
 */
function parseSkillFrontmatter(content) {
  const result = {
    name: '',
    description: '',
    version: null,
    allowedTools: [],
    content: ''
  };

  // Check for YAML frontmatter
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex > 0) {
      const frontmatter = content.substring(3, endIndex).trim();
      result.content = content.substring(endIndex + 3).trim();

      // Parse frontmatter lines
      const lines = frontmatter.split('\n');
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();

          if (key === 'name') {
            result.name = value.replace(/^["']|["']$/g, '');
          } else if (key === 'description') {
            result.description = value.replace(/^["']|["']$/g, '');
          } else if (key === 'version') {
            result.version = value.replace(/^["']|["']$/g, '');
          } else if (key === 'allowed-tools' || key === 'allowedtools') {
            // Parse as comma-separated or YAML array
            result.allowedTools = value.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean);
          }
        }
      }
    }
  } else {
    result.content = content;
  }

  return result;
}

/**
 * Get list of supporting files for a skill
 * @param {string} skillDir
 * @returns {string[]}
 */
function getSupportingFiles(skillDir) {
  const files = [];
  try {
    const entries = readdirSync(skillDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name !== 'SKILL.md') {
        if (entry.isFile()) {
          files.push(entry.name);
        } else if (entry.isDirectory()) {
          files.push(entry.name + '/');
        }
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return files;
}

/**
 * Get skills configuration from project and user directories
 * @param {string} projectPath
 * @returns {Object}
 */
function getSkillsConfig(projectPath) {
  const result = {
    projectSkills: [],
    userSkills: []
  };

  try {
    // Project skills: .claude/skills/
    const projectSkillsDir = join(projectPath, '.claude', 'skills');
    if (existsSync(projectSkillsDir)) {
      const skills = readdirSync(projectSkillsDir, { withFileTypes: true });
      for (const skill of skills) {
        if (skill.isDirectory()) {
          const skillMdPath = join(projectSkillsDir, skill.name, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            const content = readFileSync(skillMdPath, 'utf8');
            const parsed = parseSkillFrontmatter(content);

            // Get supporting files
            const skillDir = join(projectSkillsDir, skill.name);
            const supportingFiles = getSupportingFiles(skillDir);

            result.projectSkills.push({
              name: parsed.name || skill.name,
              folderName: skill.name,  // Actual folder name for API queries
              description: parsed.description,
              version: parsed.version,
              allowedTools: parsed.allowedTools,
              location: 'project',
              path: skillDir,
              supportingFiles
            });
          }
        }
      }
    }

    // User skills: ~/.claude/skills/
    const userSkillsDir = join(homedir(), '.claude', 'skills');
    if (existsSync(userSkillsDir)) {
      const skills = readdirSync(userSkillsDir, { withFileTypes: true });
      for (const skill of skills) {
        if (skill.isDirectory()) {
          const skillMdPath = join(userSkillsDir, skill.name, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            const content = readFileSync(skillMdPath, 'utf8');
            const parsed = parseSkillFrontmatter(content);

            // Get supporting files
            const skillDir = join(userSkillsDir, skill.name);
            const supportingFiles = getSupportingFiles(skillDir);

            result.userSkills.push({
              name: parsed.name || skill.name,
              folderName: skill.name,  // Actual folder name for API queries
              description: parsed.description,
              version: parsed.version,
              allowedTools: parsed.allowedTools,
              location: 'user',
              path: skillDir,
              supportingFiles
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error reading skills config:', error);
  }

  return result;
}

/**
 * Get single skill detail
 * @param {string} skillName
 * @param {string} location - 'project' or 'user'
 * @param {string} projectPath
 * @returns {Object}
 */
async function getSkillDetail(skillName, location, projectPath, initialPath) {
  try {
    if (skillName.includes('/') || skillName.includes('\\')) {
      return { error: 'Access denied', status: 403 };
    }
    if (skillName.includes('..')) {
      return { error: 'Invalid skill name', status: 400 };
    }

    let baseDir;
    if (location === 'project') {
      try {
        const validatedProjectPath = await validateAllowedPath(projectPath, { mustExist: true, allowedDirectories: [initialPath] });
        baseDir = join(validatedProjectPath, '.claude', 'skills');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes('Access denied') ? 403 : 400;
        console.error(`[Skills] Project path validation failed: ${message}`);
        return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
      }
    } else {
      baseDir = join(homedir(), '.claude', 'skills');
    }

    const skillDir = join(baseDir, skillName);
    const skillMdCandidate = join(skillDir, 'SKILL.md');

    let skillMdPath;
    try {
      skillMdPath = await validateAllowedPath(skillMdCandidate, { mustExist: true, allowedDirectories: [skillDir] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('File not found')) {
        return { error: 'Skill not found', status: 404 };
      }
      const status = message.includes('Access denied') ? 403 : 400;
      console.error(`[Skills] Path validation failed: ${message}`);
      return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
    }

    const content = readFileSync(skillMdPath, 'utf8');
    const parsed = parseSkillFrontmatter(content);
    const supportingFiles = getSupportingFiles(skillDir);

    return {
      skill: {
        name: parsed.name || skillName,
        folderName: skillName,  // Actual folder name for API queries
        description: parsed.description,
        version: parsed.version,
        allowedTools: parsed.allowedTools,
        content: parsed.content,
        location,
        path: skillDir,
        supportingFiles
      }
    };
  } catch (error) {
    return { error: (error as Error).message, status: 500 };
  }
}

/**
 * Delete a skill
 * @param {string} skillName
 * @param {string} location
 * @param {string} projectPath
 * @returns {Object}
 */
async function deleteSkill(skillName, location, projectPath, initialPath) {
  try {
    if (skillName.includes('/') || skillName.includes('\\')) {
      return { error: 'Access denied', status: 403 };
    }
    if (skillName.includes('..')) {
      return { error: 'Invalid skill name', status: 400 };
    }

    let baseDir;
    if (location === 'project') {
      try {
        const validatedProjectPath = await validateAllowedPath(projectPath, { mustExist: true, allowedDirectories: [initialPath] });
        baseDir = join(validatedProjectPath, '.claude', 'skills');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes('Access denied') ? 403 : 400;
        console.error(`[Skills] Project path validation failed: ${message}`);
        return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
      }
    } else {
      baseDir = join(homedir(), '.claude', 'skills');
    }

    const skillDirCandidate = join(baseDir, skillName);

    let skillDir;
    try {
      skillDir = await validateAllowedPath(skillDirCandidate, { mustExist: true, allowedDirectories: [baseDir] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('File not found')) {
        return { error: 'Skill not found', status: 404 };
      }
      const status = message.includes('Access denied') ? 403 : 400;
      console.error(`[Skills] Path validation failed: ${message}`);
      return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
    }

    await fsPromises.rm(skillDir, { recursive: true, force: true });

    return { success: true, skillName, location };
  } catch (error) {
    return { error: (error as Error).message, status: 500 };
  }
}

/**
 * Validate skill folder structure
 * @param {string} folderPath - Path to skill folder
 * @returns {Object} Validation result with skill info
 */
function validateSkillFolder(folderPath) {
  const errors = [];

  // Check if folder exists
  if (!existsSync(folderPath)) {
    return { valid: false, errors: ['Folder does not exist'], skillInfo: null };
  }

  // Check if it's a directory
  try {
    const stat = statSync(folderPath);
    if (!stat.isDirectory()) {
      return { valid: false, errors: ['Path is not a directory'], skillInfo: null };
    }
  } catch (e) {
    return { valid: false, errors: ['Cannot access folder'], skillInfo: null };
  }

  // Check SKILL.md exists
  const skillMdPath = join(folderPath, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    errors.push('SKILL.md file not found');
    return { valid: false, errors, skillInfo: null };
  }

  // Parse and validate frontmatter
  try {
    const content = readFileSync(skillMdPath, 'utf8');
    const parsed = parseSkillFrontmatter(content);

    if (!parsed.name) {
      errors.push('name field is required in frontmatter');
    }
    if (!parsed.description) {
      errors.push('description field is required in frontmatter');
    }

    // Get supporting files
    const supportingFiles = getSupportingFiles(folderPath);

    // If validation passed
    if (errors.length === 0) {
      return {
        valid: true,
        errors: [],
        skillInfo: {
          name: parsed.name,
          description: parsed.description,
          version: parsed.version,
          allowedTools: parsed.allowedTools,
          supportingFiles
        }
      };
    } else {
      return { valid: false, errors, skillInfo: null };
    }
  } catch (error) {
    return { valid: false, errors: ['Failed to parse SKILL.md: ' + (error as Error).message], skillInfo: null };
  }
}

/**
 * Recursively copy directory
 * @param {string} source - Source directory path
 * @param {string} target - Target directory path
 */
async function copyDirectoryRecursive(source, target) {
  await fsPromises.mkdir(target, { recursive: true });

  const entries = await fsPromises.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      await fsPromises.copyFile(sourcePath, targetPath);
    }
  }
}

/**
 * Import skill from folder
 * @param {string} sourcePath - Source skill folder path
 * @param {string} location - 'project' or 'user'
 * @param {string} projectPath - Project root path
 * @param {string} customName - Optional custom name for skill
 * @returns {Object}
 */
async function importSkill(sourcePath, location, projectPath, customName) {
  try {
    // Validate source folder
    const validation = validateSkillFolder(sourcePath);
    if (!validation.valid) {
      return { error: validation.errors.join(', ') };
    }

    const baseDir = location === 'project'
      ? join(projectPath, '.claude', 'skills')
      : join(homedir(), '.claude', 'skills');

    // Ensure base directory exists
    if (!existsSync(baseDir)) {
      await fsPromises.mkdir(baseDir, { recursive: true });
    }

    // Determine target folder name
    const skillName = customName || validation.skillInfo.name;
    if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
      return { error: 'Invalid skill name', status: 400 };
    }
    const targetPath = join(baseDir, skillName);

    // Check if already exists
    if (existsSync(targetPath)) {
      return { error: `Skill '${skillName}' already exists in ${location} location` };
    }

    // Copy entire folder recursively
    await copyDirectoryRecursive(sourcePath, targetPath);

    return {
      success: true,
      skillName,
      location,
      path: targetPath
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Generate skill via CLI tool (Claude)
 * @param {Object} params - Generation parameters
 * @param {string} params.generationType - 'description' or 'template'
 * @param {string} params.description - Skill description from user
 * @param {string} params.skillName - Name for the skill
 * @param {string} params.location - 'project' or 'user'
 * @param {string} params.projectPath - Project root path
 * @returns {Object}
 */
async function generateSkillViaCLI({ generationType, description, skillName, location, projectPath }) {
  try {
    // Validate inputs
    if (!skillName) {
      return { error: 'Skill name is required' };
    }
    if (generationType === 'description' && !description) {
      return { error: 'Description is required for description-based generation' };
    }

    // Determine target directory
    const baseDir = location === 'project'
      ? join(projectPath, '.claude', 'skills')
      : join(homedir(), '.claude', 'skills');

    const targetPath = join(baseDir, skillName);

    // Check if already exists
    if (existsSync(targetPath)) {
      return { error: `Skill '${skillName}' already exists in ${location} location` };
    }

    // Ensure base directory exists
    if (!existsSync(baseDir)) {
      await fsPromises.mkdir(baseDir, { recursive: true });
    }

    // Build CLI prompt
    const targetLocationDisplay = location === 'project'
      ? '.claude/skills/'
      : '~/.claude/skills/';

    const prompt = `PURPOSE: Generate a complete Claude Code skill from description
TASK: • Parse skill requirements • Create SKILL.md with proper frontmatter (name, description, version, allowed-tools) • Generate supporting files if needed in skill folder
MODE: write
CONTEXT: @**/*
EXPECTED: Complete skill folder structure with SKILL.md and all necessary files
RULES: $(cat ~/.claude/workflows/cli-templates/prompts/universal/00-universal-rigorous-style.txt) | Follow Claude Code skill format | Include name, description in frontmatter | write=CREATE

SKILL DESCRIPTION:
${description || 'Generate a basic skill template'}

SKILL NAME: ${skillName}
TARGET LOCATION: ${targetLocationDisplay}
TARGET PATH: ${targetPath}

REQUIREMENTS:
1. Create SKILL.md with frontmatter containing:
   - name: "${skillName}"
   - description: Brief description of the skill
   - version: "1.0.0"
   - allowed-tools: List of tools this skill can use (e.g., [Read, Write, Edit, Bash])
2. Add skill content below frontmatter explaining what the skill does and how to use it
3. If the skill requires supporting files (e.g., templates, scripts), create them in the skill folder
4. Ensure all files are properly formatted and follow best practices`;

    // Execute CLI tool (Claude) with write mode
    const result = await executeCliTool({
      tool: 'claude',
      prompt,
      mode: 'write',
      cd: baseDir,
      timeout: 600000, // 10 minutes
      category: 'internal'
    });

    // Check if execution was successful
    if (!result.success) {
      return {
        error: `CLI generation failed: ${result.stderr || 'Unknown error'}`,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    // Validate the generated skill
    const validation = validateSkillFolder(targetPath);
    if (!validation.valid) {
      return {
        error: `Generated skill is invalid: ${validation.errors.join(', ')}`,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    return {
      success: true,
      skillName: validation.skillInfo.name,
      location,
      path: targetPath,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

// ========== Skills API Routes ==========

/**
 * Handle Skills routes
 * @returns true if route was handled, false otherwise
 */
export async function handleSkillsRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest } = ctx;

  // API: Get all skills (project and user)
  if (pathname === '/api/skills') {
    const projectPathParam = url.searchParams.get('path') || initialPath;

    try {
      const validatedProjectPath = await validateAllowedPath(projectPathParam, { mustExist: true, allowedDirectories: [initialPath] });
      const skillsData = getSkillsConfig(validatedProjectPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(skillsData));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('Access denied') ? 403 : 400;
      console.error(`[Skills] Project path validation failed: ${message}`);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 403 ? 'Access denied' : 'Invalid path', projectSkills: [], userSkills: [] }));
    }
    return true;
  }

  // API: List skill directory contents
  if (pathname.match(/^\/api\/skills\/[^/]+\/dir$/) && req.method === 'GET') {
    const pathParts = pathname.split('/');
    const skillName = decodeURIComponent(pathParts[3]);
    const subPath = url.searchParams.get('subpath') || '';
    const location = url.searchParams.get('location') || 'project';
    const projectPathParam = url.searchParams.get('path') || initialPath;

    if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid skill name' }));
      return true;
    }

    let baseDir: string;
    if (location === 'project') {
      try {
        const validatedProjectPath = await validateAllowedPath(projectPathParam, { mustExist: true, allowedDirectories: [initialPath] });
        baseDir = join(validatedProjectPath, '.claude', 'skills');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes('Access denied') ? 403 : 400;
        console.error(`[Skills] Project path validation failed: ${message}`);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: status === 403 ? 'Access denied' : 'Invalid path' }));
        return true;
      }
    } else {
      baseDir = join(homedir(), '.claude', 'skills');
    }

    const skillRoot = join(baseDir, skillName);
    const requestedDir = subPath ? join(skillRoot, subPath) : skillRoot;

    let dirPath: string;
    try {
      dirPath = await validateAllowedPath(requestedDir, { mustExist: true, allowedDirectories: [skillRoot] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('File not found')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Directory not found' }));
        return true;
      }
      const status = message.includes('Access denied') ? 403 : 400;
      console.error(`[Skills] Path validation failed: ${message}`);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 403 ? 'Access denied' : 'Invalid path' }));
      return true;
    }

    if (!existsSync(dirPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Directory not found' }));
      return true;
    }

    try {
      const stat = statSync(dirPath);
      if (!stat.isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path is not a directory' }));
        return true;
      }

      const entries = readdirSync(dirPath, { withFileTypes: true });
      const files = entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: subPath ? `${subPath}/${entry.name}` : entry.name
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files, subPath, skillName }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Read skill file content
  if (pathname.match(/^\/api\/skills\/[^/]+\/file$/) && req.method === 'GET') {
    const pathParts = pathname.split('/');
    const skillName = decodeURIComponent(pathParts[3]);
    const fileName = url.searchParams.get('filename');
    const location = url.searchParams.get('location') || 'project';
    const projectPathParam = url.searchParams.get('path') || initialPath;

    if (!fileName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'filename parameter is required' }));
      return true;
    }

    if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid skill name' }));
      return true;
    }

    let baseDir: string;
    if (location === 'project') {
      try {
        const validatedProjectPath = await validateAllowedPath(projectPathParam, { mustExist: true, allowedDirectories: [initialPath] });
        baseDir = join(validatedProjectPath, '.claude', 'skills');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes('Access denied') ? 403 : 400;
        console.error(`[Skills] Project path validation failed: ${message}`);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: status === 403 ? 'Access denied' : 'Invalid path' }));
        return true;
      }
    } else {
      baseDir = join(homedir(), '.claude', 'skills');
    }

    const skillRoot = join(baseDir, skillName);
    const requestedFile = join(skillRoot, fileName);

    let filePath: string;
    try {
      filePath = await validateAllowedPath(requestedFile, { mustExist: true, allowedDirectories: [skillRoot] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('File not found')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return true;
      }
      const status = message.includes('Access denied') ? 403 : 400;
      console.error(`[Skills] Path validation failed: ${message}`);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 403 ? 'Access denied' : 'Invalid path' }));
      return true;
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return true;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content, fileName, path: filePath }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Write skill file content
  if (pathname.match(/^\/api\/skills\/[^/]+\/file$/) && req.method === 'POST') {
    const pathParts = pathname.split('/');
    const skillName = decodeURIComponent(pathParts[3]);

    handlePostRequest(req, res, async (body) => {
      const { fileName, content, location, projectPath: projectPathParam } = body;

      if (!fileName) {
        return { error: 'fileName is required' };
      }

      if (content === undefined) {
        return { error: 'content is required' };
      }

      if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
        return { error: 'Invalid skill name', status: 400 };
      }

      let baseDir: string;
      if (location === 'project') {
        try {
          const projectRoot = projectPathParam || initialPath;
          const validatedProjectPath = await validateAllowedPath(projectRoot, { mustExist: true, allowedDirectories: [initialPath] });
          baseDir = join(validatedProjectPath, '.claude', 'skills');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = message.includes('Access denied') ? 403 : 400;
          console.error(`[Skills] Project path validation failed: ${message}`);
          return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
        }
      } else {
        baseDir = join(homedir(), '.claude', 'skills');
      }

      const skillRoot = join(baseDir, skillName);
      const requestedFile = join(skillRoot, fileName);

      let filePath: string;
      try {
        filePath = await validateAllowedPath(requestedFile, { allowedDirectories: [skillRoot] });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes('Access denied') ? 403 : 400;
        console.error(`[Skills] Path validation failed: ${message}`);
        return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
      }

      try {
        await fsPromises.writeFile(filePath, content, 'utf8');
        return { success: true, fileName, path: filePath };
      } catch (error) {
        return { error: (error as Error).message };
      }
    });
    return true;
  }

  // API: Get single skill detail (exclude /dir and /file sub-routes)
  if (pathname.startsWith('/api/skills/') && req.method === 'GET' &&
      !pathname.endsWith('/skills/') && !pathname.endsWith('/dir') && !pathname.endsWith('/file')) {
    const skillName = decodeURIComponent(pathname.replace('/api/skills/', ''));
    const location = url.searchParams.get('location') || 'project';
    const projectPathParam = url.searchParams.get('path') || initialPath;
    const skillDetail = await getSkillDetail(skillName, location, projectPathParam, initialPath);
    if (skillDetail.error) {
      res.writeHead(skillDetail.status || 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: skillDetail.error }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(skillDetail));
    return true;
  }

  // API: Delete skill
  if (pathname.startsWith('/api/skills/') && req.method === 'DELETE') {
    const skillName = decodeURIComponent(pathname.replace('/api/skills/', ''));
    if (skillName.includes('/') || skillName.includes('\\')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return true;
    }
    if (skillName.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid skill name' }));
      return true;
    }
    handlePostRequest(req, res, async (body) => {
      const { location, projectPath: projectPathParam } = body;
      return deleteSkill(skillName, location, projectPathParam || initialPath, initialPath);
    });
    return true;
  }

  // API: Validate skill import
  if (pathname === '/api/skills/validate-import' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { sourcePath } = body;
      if (!sourcePath) {
        return { valid: false, errors: ['Source path is required'], skillInfo: null };
      }

      try {
        const validatedSourcePath = await validateAllowedPath(sourcePath, { mustExist: true });
        return validateSkillFolder(validatedSourcePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes('Access denied') ? 403 : 400;
        console.error(`[Skills] Path validation failed: ${message}`);
        return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
      }
    });
    return true;
  }

  // API: Create/Import skill
  if (pathname === '/api/skills/create' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { mode, location, sourcePath, skillName, description, generationType, projectPath: projectPathParam } = body;

      if (!mode) {
        return { error: 'Mode is required (import or cli-generate)' };
      }

      if (!location) {
        return { error: 'Location is required (project or user)' };
      }

      const projectPath = projectPathParam || initialPath;

      let validatedProjectPath = projectPath;
      if (location === 'project') {
        try {
          validatedProjectPath = await validateAllowedPath(projectPath, { mustExist: true, allowedDirectories: [initialPath] });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = message.includes('Access denied') ? 403 : 400;
          console.error(`[Skills] Project path validation failed: ${message}`);
          return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
        }
      }

      if (mode === 'import') {
        // Import mode: copy existing skill folder
        if (!sourcePath) {
          return { error: 'Source path is required for import mode' };
        }

        if (skillName && (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..'))) {
          return { error: 'Invalid skill name', status: 400 };
        }

        let validatedSourcePath;
        try {
          validatedSourcePath = await validateAllowedPath(sourcePath, { mustExist: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = message.includes('Access denied') ? 403 : 400;
          console.error(`[Skills] Path validation failed: ${message}`);
          return { error: status === 403 ? 'Access denied' : 'Invalid path', status };
        }

        return await importSkill(validatedSourcePath, location, validatedProjectPath, skillName);
      } else if (mode === 'cli-generate') {
        // CLI generate mode: use Claude to generate skill
        if (!skillName) {
          return { error: 'Skill name is required for CLI generation mode' };
        }
        if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
          return { error: 'Invalid skill name', status: 400 };
        }

        return await generateSkillViaCLI({
          generationType: generationType || 'description',
          description,
          skillName,
          location,
          projectPath: validatedProjectPath
        });
      } else {
        return { error: 'Invalid mode. Must be "import" or "cli-generate"' };
      }
    });
    return true;
  }

  return false;
}
