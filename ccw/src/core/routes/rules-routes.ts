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
 * Infer rule context from file name and subdirectory for better prompt generation
 * @param {string} fileName - Rule file name
 * @param {string} subdirectory - Optional subdirectory path
 * @param {string} location - 'project' or 'user'
 * @returns {Object} Inferred context
 */
function inferRuleContext(fileName: string, subdirectory: string, location: string) {
  const normalizedName = fileName.replace(/\.md$/i, '').toLowerCase();
  const normalizedSubdir = (subdirectory || '').toLowerCase();

  // Rule category inference from file name and subdirectory
  const categories = {
    coding: ['coding', 'code', 'style', 'format', 'lint', 'convention'],
    testing: ['test', 'spec', 'jest', 'vitest', 'mocha', 'coverage'],
    security: ['security', 'auth', 'permission', 'access', 'secret', 'credential'],
    architecture: ['arch', 'design', 'pattern', 'structure', 'module', 'layer'],
    documentation: ['doc', 'comment', 'readme', 'jsdoc', 'api-doc'],
    performance: ['perf', 'performance', 'optimize', 'cache', 'memory'],
    workflow: ['workflow', 'ci', 'cd', 'deploy', 'build', 'release'],
    tooling: ['tool', 'cli', 'script', 'npm', 'yarn', 'pnpm'],
    error: ['error', 'exception', 'handling', 'logging', 'debug']
  };

  let inferredCategory = 'general';
  let inferredKeywords: string[] = [];

  for (const [category, keywords] of Object.entries(categories)) {
    for (const keyword of keywords) {
      if (normalizedName.includes(keyword) || normalizedSubdir.includes(keyword)) {
        inferredCategory = category;
        inferredKeywords = keywords;
        break;
      }
    }
    if (inferredCategory !== 'general') break;
  }

  // Scope inference from location
  const scopeHint = location === 'project'
    ? 'This rule applies to the current project only'
    : 'This rule applies globally to all projects';

  // Technology hints from file name
  const techPatterns = {
    typescript: ['ts', 'typescript', 'tsc'],
    javascript: ['js', 'javascript', 'node'],
    react: ['react', 'jsx', 'tsx', 'component'],
    vue: ['vue', 'vuex', 'pinia'],
    python: ['python', 'py', 'pip', 'poetry'],
    rust: ['rust', 'cargo', 'rs'],
    go: ['go', 'golang', 'mod'],
    java: ['java', 'maven', 'gradle', 'spring']
  };

  let inferredTech: string | null = null;
  for (const [tech, patterns] of Object.entries(techPatterns)) {
    if (patterns.some(p => normalizedName.includes(p) || normalizedSubdir.includes(p))) {
      inferredTech = tech;
      break;
    }
  }

  return {
    category: inferredCategory,
    keywords: inferredKeywords,
    scopeHint,
    technology: inferredTech,
    isConditional: normalizedSubdir.length > 0
  };
}

/**
 * Build structured prompt for rule generation
 * @param {Object} params
 * @returns {string} Structured prompt
 */
function buildStructuredRulePrompt(params: {
  description: string;
  fileName: string;
  subdirectory: string;
  location: string;
  context: ReturnType<typeof inferRuleContext>;
  enableReview?: boolean;
}) {
  const { description, fileName, subdirectory, location, context, enableReview } = params;

  // Build category-specific guidance
  const categoryGuidance = {
    coding: 'Focus on code style, naming conventions, and formatting rules. Include specific examples of correct and incorrect patterns.',
    testing: 'Emphasize test structure, coverage expectations, mocking strategies, and assertion patterns.',
    security: 'Highlight security best practices, input validation, authentication requirements, and sensitive data handling.',
    architecture: 'Define module boundaries, dependency rules, layer responsibilities, and design pattern usage.',
    documentation: 'Specify documentation requirements, comment styles, and API documentation standards.',
    performance: 'Address caching strategies, optimization guidelines, resource management, and performance metrics.',
    workflow: 'Define CI/CD requirements, deployment procedures, and release management rules.',
    tooling: 'Specify tool configurations, script conventions, and dependency management rules.',
    error: 'Define error handling patterns, logging requirements, and exception management.',
    general: 'Provide clear, actionable guidelines that Claude can follow consistently.'
  };

  const guidance = categoryGuidance[context.category] || categoryGuidance.general;

  // Build technology-specific hint
  const techHint = context.technology
    ? `\nTECHNOLOGY CONTEXT: This rule is for ${context.technology} development. Use ${context.technology}-specific best practices and terminology.`
    : '';

  // Build subdirectory context
  const subdirHint = subdirectory
    ? `\nORGANIZATION: This rule will be placed in the "${subdirectory}" subdirectory, indicating its category/scope.`
    : '';

  // Build review instruction if enabled
  const reviewInstruction = enableReview
    ? `\n\nAFTER GENERATION:
- Verify the rule is specific and actionable
- Check for ambiguous language that could be misinterpreted
- Ensure examples are clear and relevant
- Validate markdown formatting is correct`
    : '';

  return `PURPOSE: Generate a high-quality Claude Code memory rule that will guide Claude's behavior when working in this codebase
SUCCESS CRITERIA: The rule must be (1) specific and actionable, (2) include concrete examples, (3) avoid ambiguous language, (4) follow Claude Code rule format

TASK:
• Parse the user's description to identify core requirements
• Infer additional context from file name "${fileName}" and category "${context.category}"
• Generate structured markdown content with clear instructions
• Include DO and DON'T examples where appropriate
• ${context.isConditional ? 'Consider if frontmatter paths are needed for conditional activation' : 'Create as a global rule'}

MODE: write

RULE CATEGORY: ${context.category}
CATEGORY GUIDANCE: ${guidance}
${techHint}
${subdirHint}
SCOPE: ${context.scopeHint}

EXPECTED OUTPUT FORMAT:
\`\`\`markdown
${context.isConditional ? `---
paths: [specific/path/patterns/**/*]
---

` : ''}# Rule Title

Brief description of what this rule enforces.

## Guidelines

1. **First guideline** - Explanation
2. **Second guideline** - Explanation

## Examples

### ✅ Correct
\`\`\`language
// Good example
\`\`\`

### ❌ Incorrect
\`\`\`language
// Bad example
\`\`\`

## Exceptions

- When this rule may not apply
\`\`\`

USER DESCRIPTION:
${description}

FILE NAME: ${fileName}
${subdirectory ? `SUBDIRECTORY: ${subdirectory}` : ''}
${reviewInstruction}

RULES: $(cat ~/.claude/workflows/cli-templates/prompts/universal/00-universal-rigorous-style.txt) | Generate ONLY the rule content in markdown | No additional commentary | Do NOT use any tools | Output raw markdown text directly | write=CREATE`;
}

/**
 * Build structured prompt for code extraction
 * @param {Object} params
 * @returns {string} Structured prompt
 */
function buildExtractPrompt(params: {
  extractScope: string;
  extractFocus: string;
  fileName: string;
  subdirectory: string;
  context: ReturnType<typeof inferRuleContext>;
}) {
  const { extractScope, extractFocus, fileName, subdirectory, context } = params;

  const scope = extractScope || '**/*';
  const focus = extractFocus || 'naming conventions, error handling, code structure, patterns';

  return `PURPOSE: Extract and document coding conventions from the existing codebase to create a Claude Code memory rule
SUCCESS CRITERIA: The rule must reflect ACTUAL patterns found in the code, not theoretical best practices

TASK:
• Scan files matching "${scope}" for recurring patterns
• Identify ${focus.split(',').length} or more distinct conventions
• Document each pattern with real code examples from the codebase
• Create actionable rules based on observed practices
• Note any inconsistencies found (optional section)

MODE: analysis

ANALYSIS SCOPE: @${scope}
FOCUS AREAS: ${focus}

EXTRACTION STRATEGY:
1. **Pattern Recognition**: Look for repeated code structures, naming patterns, file organization
2. **Consistency Check**: Identify which patterns are consistently followed vs. occasionally violated
3. **Frequency Analysis**: Prioritize patterns that appear most frequently
4. **Context Awareness**: Consider why certain patterns are used (performance, readability, etc.)

EXPECTED OUTPUT FORMAT:
\`\`\`markdown
# ${fileName.replace(/\.md$/i, '')} Conventions

Conventions extracted from codebase analysis of \`${scope}\`.

## Naming Conventions

- **Pattern name**: Description with example
  \`\`\`language
  // Actual code from codebase
  \`\`\`

## Code Structure

- **Pattern name**: Description with example

## Error Handling

- **Pattern name**: Description with example

## Notes

- Any inconsistencies or variations observed
\`\`\`

FILE NAME: ${fileName}
${subdirectory ? `SUBDIRECTORY: ${subdirectory}` : ''}
INFERRED CATEGORY: ${context.category}

RULES: $(cat ~/.claude/workflows/cli-templates/prompts/analysis/02-analyze-code-patterns.txt) | Extract REAL patterns from code | Include actual code snippets as examples | Do NOT use any tools | Output raw markdown text directly | analysis=READ-ONLY`;
}

/**
 * Build review prompt for validating and improving generated rules
 * @param {string} content - Generated rule content to review
 * @param {string} fileName - Target file name
 * @param {Object} context - Inferred context
 * @returns {string} Review prompt
 */
function buildReviewPrompt(
  content: string,
  fileName: string,
  context: ReturnType<typeof inferRuleContext>
) {
  return `PURPOSE: Review and improve a Claude Code memory rule for quality, clarity, and actionability
SUCCESS CRITERIA: Output an improved version that is (1) more specific, (2) includes better examples, (3) has no ambiguous language

TASK:
• Analyze the rule for clarity and specificity
• Check if guidelines are actionable (Claude can follow them)
• Verify examples are concrete and helpful
• Remove any ambiguous or vague language
• Ensure markdown formatting is correct
• Improve structure if needed
• Keep the core intent and requirements intact

MODE: write

REVIEW CRITERIA:
1. **Specificity**: Each guideline should be specific enough to follow without interpretation
2. **Actionability**: Guidelines should tell Claude exactly what to do or not do
3. **Examples**: Good and bad examples should be clearly different and illustrative
4. **Consistency**: Formatting and style should be consistent throughout
5. **Completeness**: All necessary aspects of the rule should be covered
6. **Conciseness**: No unnecessary verbosity or repetition

RULE CATEGORY: ${context.category}
FILE NAME: ${fileName}

ORIGINAL RULE CONTENT:
\`\`\`markdown
${content}
\`\`\`

EXPECTED OUTPUT:
- Output ONLY the improved rule content in markdown format
- Do NOT include any commentary, explanation, or meta-text
- If the original is already high quality, return it unchanged
- Preserve any frontmatter (---paths---) if present

RULES: $(cat ~/.claude/workflows/cli-templates/prompts/universal/00-universal-rigorous-style.txt) | Output ONLY improved markdown content | No additional text | Do NOT use any tools | Output raw markdown text directly | write=CREATE`;
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
 * @param {boolean} params.enableReview - Optional: enable secondary review
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
      projectPath,
      enableReview
    } = params;

    let prompt = '';
    let mode = 'analysis';
    let workingDir = projectPath;

    // Infer context from file name and subdirectory
    const context = inferRuleContext(fileName, subdirectory || '', location);

    // Build prompt based on generation type
    if (generationType === 'description') {
      mode = 'write';
      prompt = buildStructuredRulePrompt({
        description,
        fileName,
        subdirectory: subdirectory || '',
        location,
        context,
        enableReview
      });
    } else if (generationType === 'template') {
      mode = 'write';
      prompt = `PURPOSE: Generate Claude Code rule from template type
TASK: • Create rule based on ${templateType} template • Generate structured markdown content
MODE: write
EXPECTED: Complete rule content in markdown format following template structure
RULES: $(cat ~/.claude/workflows/cli-templates/prompts/universal/00-universal-rigorous-style.txt) | Follow Claude Code rule format | Use ${templateType} template patterns | Do NOT use any tools | Output raw markdown text directly | write=CREATE

TEMPLATE TYPE: ${templateType}
FILE NAME: ${fileName}`;
    } else if (generationType === 'extract') {
      mode = 'analysis';
      prompt = buildExtractPrompt({
        extractScope: extractScope || '',
        extractFocus: extractFocus || '',
        fileName,
        subdirectory: subdirectory || '',
        context
      });
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

    // Extract generated content - prefer parsedOutput (extracted text from stream JSON)
    let generatedContent = (result.parsedOutput || result.stdout || '').trim();

    // Remove markdown code block wrapper if present (e.g., ```markdown...```)
    if (generatedContent.startsWith('```markdown')) {
      generatedContent = generatedContent.replace(/^```markdown\s*\n?/, '').replace(/\n?```\s*$/, '');
    } else if (generatedContent.startsWith('```')) {
      generatedContent = generatedContent.replace(/^```\w*\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    if (!generatedContent) {
      return {
        error: 'CLI execution returned empty content',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    // Optional review step - verify and improve the generated rule
    let reviewResult = null;
    if (enableReview) {
      const reviewPrompt = buildReviewPrompt(generatedContent, fileName, context);

      const reviewExecution = await executeCliTool({
        tool: 'claude',
        prompt: reviewPrompt,
        mode: 'write',
        cd: workingDir,
        timeout: 300000, // 5 minutes for review
        category: 'internal'
      });

      if (reviewExecution.success) {
        let reviewedContent = (reviewExecution.parsedOutput || reviewExecution.stdout || '').trim();
        // Remove markdown code block wrapper if present
        if (reviewedContent.startsWith('```markdown')) {
          reviewedContent = reviewedContent.replace(/^```markdown\s*\n?/, '').replace(/\n?```\s*$/, '');
        } else if (reviewedContent.startsWith('```')) {
          reviewedContent = reviewedContent.replace(/^```\w*\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        // Only use reviewed content if it's valid and different
        if (reviewedContent.length > 50 && reviewedContent !== generatedContent) {
          generatedContent = reviewedContent;
          reviewResult = {
            reviewed: true,
            originalLength: (result.parsedOutput || result.stdout || '').trim().length,
            reviewedLength: reviewedContent.length
          };
        }
      }
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
      executionId: result.conversation?.id,
      review: reviewResult
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
