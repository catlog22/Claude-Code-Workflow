#!/usr/bin/env node
/**
 * generate-workflow-docs.cjs - Generate MDX documentation pages from CCW workflow
 * definitions and skill files.
 *
 * Sources:
 *   1. src/lib/workflows.ts - Structured workflow definitions (WORKFLOWS array)
 *   2. .claude/skills/ - Skill definitions (SKILL.md files)
 *
 * Outputs:
 *   - src/content/docs/en/workflows/reference/ - Workflow reference pages
 *   - src/content/docs/en/api/skills/ - Skill reference pages
 *
 * Usage:
 *   node docs-astro/scripts/generate-workflow-docs.cjs [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOWS_TS = path.join(__dirname, '..', 'src', 'lib', 'workflows.ts');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
const WORKFLOW_OUTPUT_DIR = path.join(__dirname, '..', 'src', 'content', 'docs', 'en', 'workflows', 'reference');
const SKILL_OUTPUT_DIR = path.join(__dirname, '..', 'src', 'content', 'docs', 'en', 'api', 'skills');

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Workflow type metadata
// ---------------------------------------------------------------------------

const TYPE_LABELS = {
  execution: 'Execution',
  planning: 'Planning',
  debugging: 'Debugging',
  testing: 'Testing',
  analysis: 'Analysis',
  brainstorm: 'Brainstorm',
  issue: 'Issue Management',
};

const COMPLEXITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

// ---------------------------------------------------------------------------
// Parse workflows.ts
// ---------------------------------------------------------------------------

/**
 * Extract top-level objects from the WORKFLOWS array using brace counting.
 * Returns array of string contents for each top-level object.
 */
function extractTopLevelObjects(arrayContent) {
  const objects = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < arrayContent.length; i++) {
    const ch = arrayContent[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        // Include the braces for context but extract inner content
        objects.push(arrayContent.substring(start + 1, i));
        start = -1;
      }
    }
  }

  return objects;
}

/**
 * Extract WORKFLOWS array from the TypeScript source file.
 * Uses brace-counting to correctly handle nested objects.
 */
function parseWorkflowsTs(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Extract the WORKFLOWS array content
  const arrayMatch = content.match(/export\s+const\s+WORKFLOWS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!arrayMatch) {
    console.error('Error: Could not find WORKFLOWS array in workflows.ts');
    return [];
  }

  const arrayContent = arrayMatch[1];
  const topLevelObjects = extractTopLevelObjects(arrayContent);
  const workflows = [];

  for (const objContent of topLevelObjects) {
    // Extract simple string fields
    const id = extractField(objContent, 'id');
    const name = extractField(objContent, 'name');
    const complexity = extractField(objContent, 'complexity');
    const type = extractField(objContent, 'type');

    // Extract Record<Locale, string> fields
    const descriptionEn = extractLocaleField(objContent, 'description', 'en');
    const descriptionZh = extractLocaleField(objContent, 'description', 'zh');
    const commandEn = extractLocaleField(objContent, 'command', 'en');
    const commandZh = extractLocaleField(objContent, 'command', 'zh');

    if (id && name) {
      workflows.push({
        id,
        name,
        complexity: complexity || 'medium',
        type: type || 'execution',
        description: { en: descriptionEn, zh: descriptionZh },
        command: { en: commandEn, zh: commandZh },
      });
    }
  }

  return workflows;
}

/**
 * Extract a simple string field value from an object literal string.
 */
function extractField(objContent, fieldName) {
  const regex = new RegExp(`${fieldName}:\\s*'([^']*)'`);
  const match = objContent.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract a locale-specific value from a Record<Locale, string> field.
 */
function extractLocaleField(objContent, fieldName, locale) {
  // Match the field block: fieldName: { ... }
  // Use brace counting to find the full nested object
  const fieldStart = objContent.indexOf(`${fieldName}:`);
  if (fieldStart === -1) return '';

  const afterField = objContent.substring(fieldStart);
  const braceStart = afterField.indexOf('{');
  if (braceStart === -1) return '';

  let depth = 0;
  let blockEnd = -1;
  for (let i = braceStart; i < afterField.length; i++) {
    if (afterField[i] === '{') depth++;
    else if (afterField[i] === '}') {
      depth--;
      if (depth === 0) {
        blockEnd = i;
        break;
      }
    }
  }

  if (blockEnd === -1) return '';
  const block = afterField.substring(braceStart + 1, blockEnd);

  const localeRegex = new RegExp(`${locale}:\\s*'([^']*)'`);
  const localeMatch = block.match(localeRegex);
  return localeMatch ? localeMatch[1] : '';
}

// ---------------------------------------------------------------------------
// Skill parsing
// ---------------------------------------------------------------------------

/**
 * Parse SKILL.md frontmatter and extract metadata.
 */
function parseSkillFile(skillDir) {
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) return null;

  const content = fs.readFileSync(skillFile, 'utf-8');
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = content.match(fmRegex);

  if (!match) return null;

  const attrs = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let currentValue = '';
  let inMultiline = false;

  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch && !inMultiline) {
      if (currentKey) {
        attrs[currentKey] = currentValue.trim();
      }
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === '|' || val === '>') {
        inMultiline = true;
        currentValue = '';
      } else {
        currentValue = val;
        inMultiline = false;
      }
    } else if (inMultiline && currentKey) {
      currentValue += (currentValue ? '\n' : '') + line;
    } else if (currentKey && line.startsWith('  ')) {
      currentValue += '\n' + line;
    }
  }
  if (currentKey) {
    attrs[currentKey] = currentValue.trim();
  }

  const body = content.slice(match[0].length);

  return { attrs, body, dirName: path.basename(skillDir) };
}

/**
 * Extract key sections from skill body content.
 */
function extractSkillSections(body) {
  const sections = [];
  const parts = body.split(/^(##\s+.+)$/m);

  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].replace(/^##\s+/, '').trim();
    const content = (parts[i + 1] || '').trim();
    sections.push({ heading, content });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Clean body for MDX
// ---------------------------------------------------------------------------

/**
 * Clean body content for MDX output.
 */
function cleanBodyForMdx(body) {
  let cleaned = body.trim();

  // Remove the first H1 if present
  cleaned = cleaned.replace(/^#\s+.+\n+/, '');

  const lines = cleaned.split('\n');
  let inCodeBlock = false;
  const processedLines = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inCodeBlock) {
      processedLines.push(line.replace(/\{([^}]*)\}/g, (match) => {
        if (line.includes('`')) return match;
        return match.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
      }));
    } else {
      processedLines.push(line);
    }
  }

  return processedLines.join('\n');
}

// ---------------------------------------------------------------------------
// MDX generation - Workflows
// ---------------------------------------------------------------------------

/**
 * Generate MDX page for a single workflow definition.
 */
function generateWorkflowMdx(workflow, order) {
  const typeLabel = TYPE_LABELS[workflow.type] || workflow.type;
  const complexityLabel = COMPLEXITY_LABELS[workflow.complexity] || workflow.complexity;

  const frontmatter = [
    '---',
    `title: "${workflow.name}"`,
    `description: "${workflow.description.en.replace(/"/g, '\\"')}"`,
    'category: "workflows"',
    'locale: "en"',
    `order: ${order}`,
    '---',
  ].join('\n');

  const parts = [frontmatter, ''];

  parts.push(`# ${workflow.name}`);
  parts.push('');
  parts.push(workflow.description.en);
  parts.push('');

  // Metadata table
  parts.push('## Overview');
  parts.push('');
  parts.push('| Property | Value |');
  parts.push('|----------|-------|');
  parts.push(`| **ID** | \`${workflow.id}\` |`);
  parts.push(`| **Type** | ${typeLabel} |`);
  parts.push(`| **Complexity** | ${complexityLabel} |`);
  parts.push('');

  // Usage section
  parts.push('## Usage');
  parts.push('');
  if (workflow.command.en) {
    const commands = workflow.command.en.split('\\n');
    parts.push('```bash');
    for (const cmd of commands) {
      parts.push(cmd);
    }
    parts.push('```');
    parts.push('');
  }

  // Chinese description for reference
  if (workflow.description.zh) {
    parts.push('## Description (Chinese)');
    parts.push('');
    parts.push(workflow.description.zh);
    parts.push('');
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// MDX generation - Skills
// ---------------------------------------------------------------------------

/**
 * Generate MDX page for a single skill.
 */
function generateSkillMdx(skill, order) {
  const { attrs, body, dirName } = skill;
  const name = attrs.name || dirName;
  const title = name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  // Extract short description (first sentence)
  const description = (attrs.description || '')
    .split('.')[0]
    .trim()
    .substring(0, 160);

  const frontmatter = [
    '---',
    `title: "${title}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    'category: "api"',
    'locale: "en"',
    `order: ${order}`,
    '---',
  ].join('\n');

  const parts = [frontmatter, ''];

  parts.push(`# ${title}`);
  parts.push('');

  if (attrs.description) {
    parts.push(attrs.description);
    parts.push('');
  }

  // Metadata table
  parts.push('## Overview');
  parts.push('');
  parts.push('| Property | Value |');
  parts.push('|----------|-------|');
  parts.push(`| **Name** | \`${name}\` |`);
  if (attrs.version) {
    parts.push(`| **Version** | ${attrs.version} |`);
  }
  if (attrs['allowed-tools']) {
    const tools = attrs['allowed-tools'].split(',').map(t => '`' + t.trim() + '`').join(', ');
    parts.push(`| **Tools** | ${tools} |`);
  }
  parts.push('');

  // Include cleaned body
  const cleanedBody = cleanBodyForMdx(body);
  if (cleanedBody.trim().length > 0) {
    parts.push('## Reference');
    parts.push('');
    parts.push(cleanedBody);
  }

  return { name, mdx: parts.join('\n') };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('=== Generate Workflow & Skill Documentation ===');
  if (DRY_RUN) console.log('(dry run - no files will be written)');
  console.log('');

  // --- Part 1: Workflow reference pages ---
  console.log('--- Workflows ---');
  console.log(`Source: ${WORKFLOWS_TS}`);
  console.log(`Output: ${WORKFLOW_OUTPUT_DIR}`);

  if (!fs.existsSync(WORKFLOWS_TS)) {
    console.error(`Error: Workflows file not found: ${WORKFLOWS_TS}`);
    process.exit(1);
  }

  const workflows = parseWorkflowsTs(WORKFLOWS_TS);
  console.log(`Found ${workflows.length} workflow definitions`);

  if (!DRY_RUN) {
    fs.mkdirSync(WORKFLOW_OUTPUT_DIR, { recursive: true });
  }

  // Generate workflow index page
  const wfIndexParts = [
    '---',
    'title: "Workflow Reference"',
    'description: "Complete reference for all CCW workflows with usage examples and configuration"',
    'category: "workflows"',
    'locale: "en"',
    'order: 10',
    '---',
    '',
    '# Workflow Reference',
    '',
    'Detailed reference for each CCW workflow. For an overview and selection guide, see the [Workflow Introduction](/en/docs/workflows/introduction).',
    '',
    '## Workflows by Type',
    '',
  ];

  // Group workflows by type
  const byType = {};
  for (const wf of workflows) {
    const typeLabel = TYPE_LABELS[wf.type] || wf.type;
    if (!byType[typeLabel]) byType[typeLabel] = [];
    byType[typeLabel].push(wf);
  }

  for (const [typeLabel, wfs] of Object.entries(byType)) {
    wfIndexParts.push(`### ${typeLabel}`);
    wfIndexParts.push('');
    wfIndexParts.push('| Workflow | Complexity | Description |');
    wfIndexParts.push('|----------|-----------|-------------|');
    for (const wf of wfs) {
      const compLabel = COMPLEXITY_LABELS[wf.complexity] || wf.complexity;
      wfIndexParts.push(`| [${wf.name}](/en/docs/workflows/reference/${wf.id}) | ${compLabel} | ${wf.description.en} |`);
    }
    wfIndexParts.push('');
  }

  // Write workflow index
  const wfIndexFile = path.join(WORKFLOW_OUTPUT_DIR, 'index.mdx');
  if (!DRY_RUN) {
    fs.writeFileSync(wfIndexFile, wfIndexParts.join('\n'), 'utf-8');
  }
  console.log('  Generated: index.mdx');

  // Generate individual workflow pages
  let wfOrder = 11;
  for (const wf of workflows) {
    const outputFile = path.join(WORKFLOW_OUTPUT_DIR, `${wf.id}.mdx`);
    const mdx = generateWorkflowMdx(wf, wfOrder);
    if (!DRY_RUN) {
      fs.writeFileSync(outputFile, mdx, 'utf-8');
    }
    console.log(`  Generated: ${wf.id}.mdx`);
    wfOrder++;
  }

  console.log(`  Total: ${workflows.length} workflow pages + 1 index`);
  console.log('');

  // --- Part 2: Skill reference pages ---
  console.log('--- Skills ---');
  console.log(`Source: ${SKILLS_DIR}`);
  console.log(`Output: ${SKILL_OUTPUT_DIR}`);

  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`Error: Skills directory not found: ${SKILLS_DIR}`);
    process.exit(1);
  }

  if (!DRY_RUN) {
    fs.mkdirSync(SKILL_OUTPUT_DIR, { recursive: true });
  }

  // Read all skill directories
  const skillDirs = fs.readdirSync(SKILLS_DIR)
    .filter(d => {
      const fullPath = path.join(SKILLS_DIR, d);
      return fs.statSync(fullPath).isDirectory() && !d.startsWith('_');
    })
    .sort();

  console.log(`Found ${skillDirs.length} skill directories`);

  // Skill index page
  const skIndexParts = [
    '---',
    'title: "Skills Reference"',
    'description: "Complete reference for all CCW skills - reusable capabilities for development workflows"',
    'category: "api"',
    'locale: "en"',
    'order: 1',
    '---',
    '',
    '# Skills Reference',
    '',
    'CCW skills are reusable capabilities that can be triggered by slash commands or keyword phrases. Each skill encapsulates a specific development workflow pattern.',
    '',
    '## Available Skills',
    '',
    '| Skill | Description |',
    '|-------|-------------|',
  ];

  let skOrder = 2;
  const generatedSkills = [];

  for (const dir of skillDirs) {
    const skillPath = path.join(SKILLS_DIR, dir);
    const skill = parseSkillFile(skillPath);
    if (!skill) {
      console.log(`  Skipped: ${dir} (no SKILL.md)`);
      continue;
    }

    const { name, mdx } = generateSkillMdx(skill, skOrder);
    const slug = name;
    const outputFile = path.join(SKILL_OUTPUT_DIR, `${slug}.mdx`);

    // Short description for index
    const shortDesc = (skill.attrs.description || '')
      .split('.')[0]
      .trim()
      .substring(0, 100);
    const title = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    skIndexParts.push(`| [${title}](/en/docs/api/skills/${slug}) | ${shortDesc} |`);

    if (!DRY_RUN) {
      fs.writeFileSync(outputFile, mdx, 'utf-8');
    }
    generatedSkills.push({ name, outputFile });
    console.log(`  Generated: ${slug}.mdx`);
    skOrder++;
  }

  // Write skill index
  const skIndexFile = path.join(SKILL_OUTPUT_DIR, 'index.mdx');
  if (!DRY_RUN) {
    fs.writeFileSync(skIndexFile, skIndexParts.join('\n') + '\n', 'utf-8');
  }
  console.log('  Generated: index.mdx');

  console.log(`  Total: ${generatedSkills.length} skill pages + 1 index`);
  console.log('');
  console.log('=== Complete ===');
}

main();
