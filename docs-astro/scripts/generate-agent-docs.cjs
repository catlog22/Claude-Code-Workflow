#!/usr/bin/env node
/**
 * generate-agent-docs.cjs - Generate MDX documentation pages from CCW agent definitions.
 *
 * Reads all .md files from .claude/agents/ and generates documentation pages at
 * src/content/docs/en/api/agents/ with proper Astro content collection frontmatter.
 *
 * Usage:
 *   node docs-astro/scripts/generate-agent-docs.cjs [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(ROOT, '.claude', 'agents');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'content', 'docs', 'en', 'api', 'agents');

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { attrs: Record<string, string>, body: string }.
 */
function parseFrontmatter(content) {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = content.match(fmRegex);
  if (!match) {
    return { attrs: {}, body: content };
  }

  const attrs = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let currentValue = '';
  let inMultiline = false;

  for (const line of lines) {
    // Check for a new key-value pair (not indented)
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
      // Continuation of multiline value
      currentValue += '\n' + line;
    }
  }
  if (currentKey) {
    attrs[currentKey] = currentValue.trim();
  }

  const body = content.slice(match[0].length);
  return { attrs, body };
}

// ---------------------------------------------------------------------------
// Agent content extraction
// ---------------------------------------------------------------------------

/**
 * Extract tools/capabilities from the agent markdown body.
 * Looks for tool references in sections like "Tool Arsenal", "allowed-tools", etc.
 */
function extractTools(attrs, body) {
  const tools = new Set();

  // From frontmatter allowed-tools
  if (attrs['allowed-tools']) {
    attrs['allowed-tools'].split(',').forEach(t => {
      const trimmed = t.trim();
      if (trimmed) tools.add(trimmed);
    });
  }

  // From body: look for MCP tool references
  const mcpPattern = /mcp__\w+__\w+/g;
  let match;
  while ((match = mcpPattern.exec(body)) !== null) {
    tools.add(match[0]);
  }

  // From body: common tool references in backticks
  const toolPatterns = [
    /`(Read|Write|Edit|Bash|Grep|Glob|Task|TaskOutput|AskUserQuestion)\b/g,
    /\b(Read|Bash|Grep|Glob)\(\)/g,
  ];
  for (const pattern of toolPatterns) {
    while ((match = pattern.exec(body)) !== null) {
      tools.add(match[1]);
    }
  }

  return Array.from(tools).sort();
}

/**
 * Extract key capabilities from the agent body by looking for
 * bullet points under headings that contain "philosophy", "capabilities", "core".
 */
function extractCapabilities(body) {
  const capabilities = [];

  // Match bullet points that follow headings with relevant keywords
  const sections = body.split(/^##\s+/m);
  for (const section of sections) {
    const firstLine = section.split('\n')[0].toLowerCase();
    const isRelevant = /philosoph|capabilit|core|mission|execution/i.test(firstLine);
    if (!isRelevant) continue;

    const bullets = section.match(/^[-*]\s+\*\*(.+?)\*\*/gm);
    if (bullets) {
      for (const bullet of bullets) {
        const cleaned = bullet
          .replace(/^[-*]\s+/, '')
          .replace(/\*\*/g, '')
          .split(' - ')[0]
          .trim();
        if (cleaned.length > 0 && cleaned.length < 80) {
          capabilities.push(cleaned);
        }
      }
    }
  }

  return capabilities.slice(0, 8);
}

/**
 * Generate a human-readable title from the agent name.
 * e.g. "code-developer" -> "Code Developer"
 * e.g. "context-search-agent" -> "Context Search Agent"
 */
function formatTitle(name) {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate a display title, appending "Agent" only if not already present.
 */
function formatDisplayTitle(name) {
  const base = formatTitle(name);
  if (/agent$/i.test(base)) {
    return base;
  }
  return base + ' Agent';
}

/**
 * Extract the first paragraph of the description for use as the page description.
 */
function extractShortDescription(description) {
  if (!description) return '';
  // Take first sentence or first line
  const firstLine = description.split('\n')[0].trim();
  // Remove "Examples:" section if it starts with it
  const cleaned = firstLine.replace(/\s*Examples:.*$/s, '').trim();
  // Limit length
  if (cleaned.length > 160) {
    return cleaned.substring(0, 157) + '...';
  }
  return cleaned;
}

/**
 * Clean body content for MDX output.
 * Removes frontmatter-like content and adjusts heading levels.
 */
function cleanBodyForMdx(body) {
  let cleaned = body.trim();

  // Remove the first H1 if it just repeats the agent name
  cleaned = cleaned.replace(/^#\s+.+\n+/, '');

  // Escape any curly braces that might interfere with MDX
  // but not inside code blocks
  const lines = cleaned.split('\n');
  let inCodeBlock = false;
  const processedLines = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inCodeBlock) {
      // Escape curly braces outside code blocks, but not in JSX-like expressions
      processedLines.push(line.replace(/\{([^}]*)\}/g, (match, inner) => {
        // Keep simple variable references and code-like content as-is in code spans
        if (line.includes('`')) return match;
        return '\\{' + inner + '\\}';
      }));
    } else {
      processedLines.push(line);
    }
  }

  return processedLines.join('\n');
}

// ---------------------------------------------------------------------------
// MDX generation
// ---------------------------------------------------------------------------

/**
 * Generate MDX content for a single agent.
 */
function generateAgentMdx(agentFile, order) {
  const content = fs.readFileSync(agentFile, 'utf-8');
  const { attrs, body } = parseFrontmatter(content);

  const name = attrs.name || path.basename(agentFile, '.md');
  const displayTitle = formatDisplayTitle(name);
  const description = extractShortDescription(attrs.description);
  const tools = extractTools(attrs, body);
  const capabilities = extractCapabilities(body);
  const color = attrs.color || 'blue';

  // Build frontmatter
  const frontmatter = [
    '---',
    `title: "${displayTitle}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    'category: "api"',
    'locale: "en"',
    `order: ${order}`,
    '---',
  ].join('\n');

  // Build MDX body
  const mdxParts = [frontmatter, ''];

  // Title and description section
  mdxParts.push(`# ${displayTitle}`);
  mdxParts.push('');

  if (attrs.description) {
    // Use only the main description, not examples
    const mainDesc = attrs.description.split(/\n\s*Examples:/)[0].trim();
    mdxParts.push(mainDesc);
    mdxParts.push('');
  }

  // Agent metadata table
  mdxParts.push('## Overview');
  mdxParts.push('');
  mdxParts.push('| Property | Value |');
  mdxParts.push('|----------|-------|');
  mdxParts.push(`| **Name** | \`${name}\` |`);
  mdxParts.push(`| **Color** | ${color} |`);
  if (tools.length > 0) {
    mdxParts.push(`| **Tools** | ${tools.map(t => '`' + t + '`').join(', ')} |`);
  }
  mdxParts.push('');

  // Capabilities
  if (capabilities.length > 0) {
    mdxParts.push('## Key Capabilities');
    mdxParts.push('');
    for (const cap of capabilities) {
      mdxParts.push(`- ${cap}`);
    }
    mdxParts.push('');
  }

  // Include the full body content (cleaned)
  const cleanedBody = cleanBodyForMdx(body);
  if (cleanedBody.trim().length > 0) {
    mdxParts.push('## Detailed Reference');
    mdxParts.push('');
    mdxParts.push(cleanedBody);
  }

  return { name, mdx: mdxParts.join('\n') };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('=== Generate Agent Documentation ===');
  console.log(`Source: ${AGENTS_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  if (DRY_RUN) console.log('(dry run - no files will be written)');
  console.log('');

  // Verify source directory exists
  if (!fs.existsSync(AGENTS_DIR)) {
    console.error(`Error: Agents directory not found: ${AGENTS_DIR}`);
    process.exit(1);
  }

  // Read all agent files
  const agentFiles = fs.readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  console.log(`Found ${agentFiles.length} agent definitions`);

  // Ensure output directory exists
  if (!DRY_RUN) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate index page
  const indexParts = [
    '---',
    'title: "Agents Reference"',
    'description: "Complete reference for all CCW agents - specialized AI assistants for different development tasks"',
    'category: "api"',
    'locale: "en"',
    'order: 1',
    '---',
    '',
    '# Agents Reference',
    '',
    'CCW provides specialized agents for different development tasks. Each agent is optimized for a specific role in the development workflow.',
    '',
    '## Available Agents',
    '',
    '| Agent | Description |',
    '|-------|-------------|',
  ];

  const generated = [];
  let order = 2; // Start at 2, index page is 1

  for (const file of agentFiles) {
    const filePath = path.join(AGENTS_DIR, file);
    try {
      const { name, mdx } = generateAgentMdx(filePath, order);
      const slug = name;
      const outputFile = path.join(OUTPUT_DIR, `${slug}.mdx`);

      // Read the description for the index
      const content = fs.readFileSync(filePath, 'utf-8');
      const { attrs } = parseFrontmatter(content);
      const shortDesc = extractShortDescription(attrs.description);

      indexParts.push(`| [${formatDisplayTitle(name)}](/en/docs/api/agents/${slug}) | ${shortDesc} |`);

      if (!DRY_RUN) {
        fs.writeFileSync(outputFile, mdx, 'utf-8');
      }
      generated.push({ name, outputFile });
      console.log(`  Generated: ${slug}.mdx`);
      order++;
    } catch (err) {
      console.error(`  Error processing ${file}: ${err.message}`);
    }
  }

  // Write index page
  const indexFile = path.join(OUTPUT_DIR, 'index.mdx');
  if (!DRY_RUN) {
    fs.writeFileSync(indexFile, indexParts.join('\n') + '\n', 'utf-8');
  }
  console.log(`  Generated: index.mdx`);

  console.log('');
  console.log(`Total: ${generated.length} agent pages + 1 index page generated`);
}

main();
