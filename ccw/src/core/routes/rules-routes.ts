/**
 * Rules Routes Module
 * Handles all Rules-related API endpoints
 */
import { readFileSync, existsSync, readdirSync, unlinkSync, promises as fsPromises } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { executeCliTool } from '../../tools/cli-executor.js';
import type { RouteContext } from './types.js';

interface ParsedRuleFrontmatter {
  paths: string[];
  content: string;
}

interface RuleDetail {
  name: string;
  paths: string[];
  content: string;
  location: string;
  path: string;
  subdirectory: string | null;
}

interface RuleConfigResult {
  projectRules: RuleDetail[];
  userRules: RuleDetail[];
}

interface RuleCreateParams {
  fileName: string;
  content: string;
  paths: string[];
  location: string;
  subdirectory: string;
  projectPath: string;
}

interface RuleGenerateParams {
  generationType: string;
  description?: string;
  templateType?: string;
  extractScope?: string;
  extractFocus?: string;
  fileName: string;
  location: string;
  subdirectory: string;
  projectPath: string;
}

/**
 * Parse rule frontmatter
 * @param {string} content
 * @returns {Object}
 */
function parseRuleFrontmatter(content: string): ParsedRuleFrontmatter {
  const result: ParsedRuleFrontmatter = {
    paths: [],
    content: content
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

          if (key === 'paths') {
            // Parse as comma-separated or YAML array
            result.paths = value.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Recursively scan rules directory for .md files
 * @param {string} dirPath
 * @param {string} location
 * @param {string} subdirectory
 * @returns {Object[]}
 */
function scanRulesDirectory(dirPath: string, location: string, subdirectory: string): RuleDetail[] {
  const rules: RuleDetail[] = [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = readFileSync(fullPath, 'utf8');
        const parsed = parseRuleFrontmatter(content);

        rules.push({
          name: entry.name,
          paths: parsed.paths,
          content: parsed.content,
          location,
          path: fullPath,
          subdirectory: subdirectory || null
        });
      } else if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subRules = scanRulesDirectory(fullPath, location, subdirectory ? `${subdirectory}/${entry.name}` : entry.name);
        rules.push(...subRules);
      }
    }
  } catch (e) {
    // Ignore errors
  }

  return rules;
}

/**
 * Get rules configuration from project and user directories
 * @param {string} projectPath
 * @returns {Object}
 */
function getRulesConfig(projectPath: string): RuleConfigResult {
  const result: RuleConfigResult = {
    projectRules: [],
    userRules: []
  };

  try {
    // Project rules: .claude/rules/
    const projectRulesDir = join(projectPath, '.claude', 'rules');
    if (existsSync(projectRulesDir)) {
      const rules = scanRulesDirectory(projectRulesDir, 'project', '');
      result.projectRules = rules;
    }

    // User rules: ~/.claude/rules/
    const userRulesDir = join(homedir(), '.claude', 'rules');
    if (existsSync(userRulesDir)) {
      const rules = scanRulesDirectory(userRulesDir, 'user', '');
      result.userRules = rules;
    }
  } catch (error) {
    console.error('Error reading rules config:', error);
  }

  return result;
}

/**
 * Find rule file in directory (including subdirectories)
 * @param {string} baseDir
 * @param {string} ruleName
 * @returns {string|null}
 */
function findRuleFile(baseDir: string, ruleName: string): string | null {
  try {
    // Direct path
    const directPath = join(baseDir, ruleName);
    if (existsSync(directPath)) {
      return directPath;
    }

    // Search in subdirectories
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = findRuleFile(join(baseDir, entry.name), ruleName);
        if (subPath) return subPath;
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

/**
 * Get single rule detail
 * @param {string} ruleName
 * @param {string} location - 'project' or 'user'
 * @param {string} projectPath
 * @returns {Object}
 */
function getRuleDetail(ruleName: string, location: string, projectPath: string): { rule?: RuleDetail; error?: string } {
  try {
    const baseDir = location === 'project'
      ? join(projectPath, '.claude', 'rules')
      : join(homedir(), '.claude', 'rules');

    // Find the rule file (could be in subdirectory)
    const rulePath = findRuleFile(baseDir, ruleName);

    if (!rulePath) {
      return { error: 'Rule not found' };
    }

    const content = readFileSync(rulePath, 'utf8');
    const parsed = parseRuleFrontmatter(content);

    const normalizedBaseDir = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedRulePath = rulePath.replace(/\\/g, '/');
    const relativePath = normalizedRulePath.startsWith(`${normalizedBaseDir}/`)
      ? normalizedRulePath.slice(normalizedBaseDir.length + 1)
      : ruleName;
    const relativeParts = relativePath.split('/');
    const subdirectory = relativeParts.length > 1 ? relativeParts.slice(0, -1).join('/') : null;

    return {
      rule: {
        name: ruleName,
        paths: parsed.paths,
        content: parsed.content,
        location,
        path: rulePath,
        subdirectory
      }
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Delete a rule
 * @param {string} ruleName
 * @param {string} location
 * @param {string} projectPath
 * @returns {Object}
 */
function deleteRule(
  ruleName: string,
  location: string,
  projectPath: string
): { success: true; ruleName: string; location: string } | { error: string; status?: number } {
  try {
    const baseDir = location === 'project'
      ? join(projectPath, '.claude', 'rules')
      : join(homedir(), '.claude', 'rules');

    const rulePath = findRuleFile(baseDir, ruleName);

    if (!rulePath) {
      return { error: 'Rule not found' };
    }

    unlinkSync(rulePath);

    return { success: true, ruleName, location };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Generate rule content via CLI tool
 * @param {Object} params
 * @param {string} params.generationType - 'description' | 'template' | 'extract'
 * @param {string} params.description - Rule description (for 'description' mode)
 * @param {string} params.templateType - Template type (for 'template' mode)
 * @param {string} params.extractScope - Scope pattern (for 'extract' mode)
 * @param {string} params.extractFocus - Focus areas (for 'extract' mode)
 * @param {string} params.fileName - Target file name
 * @param {string} params.location - 'project' or 'user'
 * @param {string} params.subdirectory - Optional subdirectory
 * @param {string} params.projectPath - Project root path
 * @returns {Object}
 */
async function generateRuleViaCLI(params: RuleGenerateParams): Promise<Record<string, unknown>> {
  try {
    const {
      generationType,
      description,
      templateType,
      extractScope,
      extractFocus,
      fileName,
      location,
      subdirectory,
      projectPath
    } = params;

    let prompt = '';
    let mode = 'analysis';
    let workingDir = projectPath;

    // Build prompt based on generation type
    if (generationType === 'description') {
      mode = 'write';
      prompt = `PURPOSE: Generate Claude Code memory rule from description to guide Claude's behavior
TASK: • Analyze rule requirements • Generate markdown content with clear instructions
MODE: write
EXPECTED: Complete rule content in markdown format
RULES: $(cat ~/.claude/workflows/cli-templates/prompts/universal/00-universal-rigorous-style.txt) | Follow Claude Code rule format | Use frontmatter for conditional rules if paths specified | write=CREATE

RULE DESCRIPTION:
${description}

FILE NAME: ${fileName}`;
    } else if (generationType === 'template') {
      mode = 'write';
      prompt = `PURPOSE: Generate Claude Code rule from template type
TASK: • Create rule based on ${templateType} template • Generate structured markdown content
MODE: write
EXPECTED: Complete rule content in markdown format following template structure
RULES: $(cat ~/.claude/workflows/cli-templates/prompts/universal/00-universal-rigorous-style.txt) | Follow Claude Code rule format | Use ${templateType} template patterns | write=CREATE

TEMPLATE TYPE: ${templateType}
FILE NAME: ${fileName}`;
    } else if (generationType === 'extract') {
      mode = 'analysis';
      prompt = `PURPOSE: Extract coding rules from existing codebase to document patterns and conventions
TASK: • Analyze code patterns in specified scope • Extract common conventions • Identify best practices
MODE: analysis
CONTEXT: @${extractScope || '**/*'}
EXPECTED: Rule content based on codebase analysis with examples
RULES: $(cat ~/.claude/workflows/cli-templates/prompts/analysis/02-analyze-code-patterns.txt) | Focus on actual patterns found | Include code examples | analysis=READ-ONLY

ANALYSIS SCOPE: ${extractScope || '**/*'}
FOCUS AREAS: ${extractFocus || 'naming conventions, error handling, code structure'}`;
    } else {
      return { error: `Unknown generation type: ${generationType}` };
    }

    // Execute CLI tool (Claude) with at least 10 minutes timeout
    const result = await executeCliTool({
      tool: 'claude',
      prompt,
      mode,
      cd: workingDir,
      timeout: 600000, // 10 minutes
      category: 'internal'
    });

    if (!result.success) {
      return {
        error: `CLI execution failed: ${result.stderr || 'Unknown error'}`,
        stderr: result.stderr
      };
    }

    // Extract generated content from stdout
    const generatedContent = result.stdout.trim();

    if (!generatedContent) {
      return {
        error: 'CLI execution returned empty content',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    // Create the rule using the generated content
    const createResult = await createRule({
      fileName,
      content: generatedContent,
      paths: [],
      location,
      subdirectory,
      projectPath
    });

    return {
      success: createResult.success || false,
      ...createResult,
      generatedContent,
      executionId: result.conversation?.id
    };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Create a new rule
 * @param {Object} params
 * @param {string} params.fileName - Rule file name (must end with .md)
 * @param {string} params.content - Rule content (markdown)
 * @param {string[]} params.paths - Optional paths for conditional rule
 * @param {string} params.location - 'project' or 'user'
 * @param {string} params.subdirectory - Optional subdirectory path
 * @param {string} params.projectPath - Project root path
 * @returns {Object}
 */
async function createRule(params: RuleCreateParams): Promise<Record<string, unknown>> {
  try {
    const { fileName, content, paths, location, subdirectory, projectPath } = params;

    // Validate file name
    if (!fileName || !fileName.endsWith('.md')) {
      return { error: 'File name must end with .md' };
    }

    // Build base directory
    const baseDir = location === 'project'
      ? join(projectPath, '.claude', 'rules')
      : join(homedir(), '.claude', 'rules');

    // Build target directory (with optional subdirectory)
    const targetDir = subdirectory
      ? join(baseDir, subdirectory)
      : baseDir;

    // Ensure target directory exists
    await fsPromises.mkdir(targetDir, { recursive: true });

    // Build complete file path
    const filePath = join(targetDir, fileName);

    // Check if file already exists
    if (existsSync(filePath)) {
      return { error: `Rule '${fileName}' already exists in ${location} location` };
    }

    // Build complete content with frontmatter if paths provided
    let completeContent = content;
    if (paths && paths.length > 0) {
      const frontmatter = `---
paths: [${paths.join(', ')}]
---

`;
      completeContent = frontmatter + content;
    }

    // Write rule file
    await fsPromises.writeFile(filePath, completeContent, 'utf8');

    return {
      success: true,
      fileName,
      location,
      path: filePath,
      subdirectory: subdirectory || null
    };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Handle Rules routes
 * @returns true if route was handled, false otherwise
 */
export async function handleRulesRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest } = ctx;

  // API: Get all rules
  if (pathname === '/api/rules') {
    const projectPathParam = url.searchParams.get('path') || initialPath;
    const rulesData = getRulesConfig(projectPathParam);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rulesData));
    return true;
  }

  // API: Get single rule detail
  if (pathname.startsWith('/api/rules/') && req.method === 'GET' && !pathname.endsWith('/rules/')) {
    const ruleName = decodeURIComponent(pathname.replace('/api/rules/', ''));
    const location = url.searchParams.get('location') || 'project';
    const projectPathParam = url.searchParams.get('path') || initialPath;
    const ruleDetail = getRuleDetail(ruleName, location, projectPathParam);
    if (ruleDetail.error) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ruleDetail));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ruleDetail));
    }
    return true;
  }

  // API: Delete rule
  if (pathname.startsWith('/api/rules/') && req.method === 'DELETE') {
    const ruleName = decodeURIComponent(pathname.replace('/api/rules/', ''));
    handlePostRequest(req, res, async (body) => {
      const { location, projectPath: projectPathParam } = body as { location?: unknown; projectPath?: unknown };
      const resolvedLocation = typeof location === 'string' && location.trim().length > 0 ? location : 'project';
      const resolvedProjectPath =
        typeof projectPathParam === 'string' && projectPathParam.trim().length > 0 ? projectPathParam : initialPath;
      return deleteRule(ruleName, resolvedLocation, resolvedProjectPath);
    });
    return true;
  }

  // API: Create rule
  if (pathname === '/api/rules/create' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const {
        mode,
        fileName,
        content,
        paths,
        location,
        subdirectory,
        projectPath: projectPathParam,
        generationType,
        description,
        templateType,
        extractScope,
        extractFocus
      } = body as {
        mode?: unknown;
        fileName?: unknown;
        content?: unknown;
        paths?: unknown;
        location?: unknown;
        subdirectory?: unknown;
        projectPath?: unknown;
        generationType?: unknown;
        description?: unknown;
        templateType?: unknown;
        extractScope?: unknown;
        extractFocus?: unknown;
      };

      const resolvedMode = typeof mode === 'string' ? mode : '';
      const resolvedFileName = typeof fileName === 'string' ? fileName : '';
      const resolvedContent = typeof content === 'string' ? content : '';
      const resolvedLocation = typeof location === 'string' && location.trim().length > 0 ? location : '';
      const resolvedSubdirectory = typeof subdirectory === 'string' ? subdirectory : '';
      const resolvedProjectPath =
        typeof projectPathParam === 'string' && projectPathParam.trim().length > 0 ? projectPathParam : initialPath;
      const resolvedGenerationType = typeof generationType === 'string' ? generationType : '';
      const resolvedDescription = typeof description === 'string' ? description : undefined;
      const resolvedTemplateType = typeof templateType === 'string' ? templateType : undefined;
      const resolvedExtractScope = typeof extractScope === 'string' ? extractScope : undefined;
      const resolvedExtractFocus = typeof extractFocus === 'string' ? extractFocus : undefined;
      const resolvedPaths = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [];

      if (!resolvedFileName) {
        return { error: 'File name is required' };
      }

      if (!resolvedLocation) {
        return { error: 'Location is required (project or user)' };
      }

      const projectPath = resolvedProjectPath;

      // CLI generation mode
      if (resolvedMode === 'cli-generate') {
        if (!resolvedGenerationType) {
          return { error: 'generationType is required for CLI generation mode' };
        }

        // Validate based on generation type
        if (resolvedGenerationType === 'description' && !resolvedDescription) {
          return { error: 'description is required for description-based generation' };
        }

        if (resolvedGenerationType === 'template' && !resolvedTemplateType) {
          return { error: 'templateType is required for template-based generation' };
        }

        return await generateRuleViaCLI({
          generationType: resolvedGenerationType,
          description: resolvedDescription,
          templateType: resolvedTemplateType,
          extractScope: resolvedExtractScope,
          extractFocus: resolvedExtractFocus,
          fileName: resolvedFileName,
          location: resolvedLocation,
          subdirectory: resolvedSubdirectory || '',
          projectPath
        });
      }

      // Manual creation mode
      if (!resolvedContent) {
        return { error: 'Content is required for manual creation' };
      }

      return await createRule({
        fileName: resolvedFileName,
        content: resolvedContent,
        paths: resolvedPaths,
        location: resolvedLocation,
        subdirectory: resolvedSubdirectory || '',
        projectPath
      });
    });
    return true;
  }

  return false;
}
