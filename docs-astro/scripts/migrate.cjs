#!/usr/bin/env node
/**
 * migrate.mjs - Migrate Docusaurus docs to Astro content collection format.
 *
 * Usage:
 *   node docs-astro/scripts/migrate.mjs [--dry-run]
 *
 * Source: ccw/docs-site/docs/
 * Target: docs-astro/src/content/docs/en/
 *
 * Transforms:
 *   - Frontmatter: sidebar_position -> order, adds locale/category, ensures description
 *   - Removes Docusaurus imports (Mermaid, Link, Details, lucide-react)
 *   - Converts <Mermaid chart={`...`} /> to fenced ```mermaid blocks
 *   - Converts <Link to="...">text</Link> to [text](url) markdown links
 *   - Converts <Details><summary>text</summary>content</Details> to <details> HTML
 *   - Strips Docusaurus-only JSX (className divs, card layouts) to plain markdown
 *   - Removes slug: / from frontmatter (index pages get it from file path)
 */

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'ccw', 'docs-site', 'docs');
const DST_DIR = path.join(ROOT, 'docs-astro', 'src', 'content', 'docs', 'en');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Mapping from source relative path to { target dir (relative to DST_DIR), category }.
 * Order matters: first match wins.
 */
const PATH_RULES = [
  { match: /^commands\/general\//, targetDir: 'cli-commands/general', category: 'cli-commands' },
  { match: /^commands\/cli\//,     targetDir: 'cli-commands/cli',     category: 'cli-commands' },
  { match: /^commands\/issue\//,   targetDir: 'cli-commands/issue',   category: 'cli-commands' },
  { match: /^commands\/memory\//,  targetDir: 'cli-commands/memory',  category: 'cli-commands' },
  { match: /^workflows\//,        targetDir: 'workflows',            category: 'workflows' },
  // Root-level files go to getting-started
  { match: /^[^/]+$/,             targetDir: 'getting-started',      category: 'getting-started' },
];

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { attrs: Record<string,string>, body: string }.
 */
function parseFrontmatter(content) {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = content.match(fmRegex);
  if (!match) {
    return { attrs: {}, body: content };
  }
  const raw = match[1];
  const attrs = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    attrs[key] = value;
  }
  const body = content.slice(match[0].length);
  return { attrs, body };
}

/**
 * Serialize frontmatter attrs + body back to a string.
 */
function serializeFrontmatter(attrs, body) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    // Numbers don't need quotes
    if (typeof value === 'number' || /^\d+$/.test(value)) {
      lines.push(key + ': ' + value);
    } else {
      // Quote values that contain special YAML characters
      const needsQuote = /[:#\[\]{}|>&*!%@`,]/.test(value) || value === '';
      if (needsQuote) {
        lines.push(key + ': "' + value.replace(/"/g, '\\"') + '"');
      } else {
        lines.push(key + ': ' + value);
      }
    }
  }
  lines.push('---');
  lines.push('');
  return lines.join('\n') + body;
}

// ---------------------------------------------------------------------------
// Content transformations
// ---------------------------------------------------------------------------

/**
 * Remove Docusaurus-specific import lines.
 */
function removeImports(body) {
  return body.replace(/^import\s+.*?from\s+['"](@theme\/|@docusaurus\/|lucide-react).*['"];?\s*\n?/gm, '');
}

/**
 * Convert <Mermaid chart={`...`} /> to ```mermaid fenced blocks.
 * Handles multi-line chart props.
 */
function convertMermaid(body) {
  // Pattern: <Mermaid\n  chart={`\n ... \n  `}\n/>
  const mermaidRegex = /<Mermaid\s*\n?\s*chart=\{`\n?([\s\S]*?)`\}\s*\n?\s*\/>/g;
  return body.replace(mermaidRegex, function(_, chartContent) {
    // Dedent chart content: find minimum indentation and strip it
    const lines = chartContent.split('\n');
    const nonEmpty = lines.filter(function(l) { return l.trim().length > 0; });
    if (nonEmpty.length === 0) return '';
    const minIndent = Math.min.apply(null, nonEmpty.map(function(l) {
      return l.match(/^(\s*)/)[1].length;
    }));
    const dedented = lines.map(function(l) { return l.slice(minIndent); }).join('\n').trim();
    return '```mermaid\n' + dedented + '\n```';
  });
}

/**
 * Convert <Link to="url">text</Link> to [text](url).
 * For card-style Links with nested HTML, extract a clean title + description.
 */
function convertLinks(body) {
  const linkRegex = /<Link\s+to="([^"]*)"(?:\s+className="[^"]*")?>\s*([\s\S]*?)\s*<\/Link>/g;
  return body.replace(linkRegex, function(_, url, content) {
    // Strip all HTML tags, collapse whitespace
    var textContent = content
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!textContent) return '';
    // For card-like content with "Title Description", use "Title - Description"
    var parts = textContent.split(/\s{2,}/);
    if (parts.length > 1) {
      textContent = parts[0] + ' - ' + parts.slice(1).join(' ');
    }
    return '[' + textContent + '](' + url + ')';
  });
}

/**
 * Convert <Details><summary>text</summary>content</Details> to HTML <details>.
 */
function convertDetails(body) {
  // Replace <Details> with <details> (case conversion)
  var result = body.replace(/<Details>/g, '<details>');
  result = result.replace(/<\/Details>/g, '</details>');
  return result;
}

/**
 * Strip Docusaurus-specific JSX layout divs.
 * Converts card grids to simple link lists.
 */
function stripDocusaurusJsx(body) {
  var result = body;

  // Remove any HTML tags with className attribute (div, h3, span, etc.)
  result = result.replace(/<(\w+)\s+className="[^"]*"(?:\s+aria-hidden="[^"]*")?>\s*\n?/g, function(match, tag) {
    // For heading tags, convert to markdown equivalent
    if (tag === 'h3') return '### ';
    if (tag === 'h2') return '## ';
    if (tag === 'h1') return '# ';
    return '';
  });
  // Remove closing tags for stripped elements (divs, headings with className)
  result = result.replace(/^\s*<\/div>\s*$/gm, '');
  result = result.replace(/<\/h[1-6]>/g, '');

  // Remove lucide-react component tags like <Workflow />, <Terminal />, etc.
  result = result.replace(/<(?:Workflow|Terminal|HelpCircle|Sparkles|Code)\s*\/>/g, '');

  // Convert remaining JSX-style HTML to markdown where possible:
  // <h3>text</h3> -> ### text
  result = result.replace(/<h3>(.*?)<\/h3>/g, '### $1');
  result = result.replace(/<h2>(.*?)<\/h2>/g, '## $1');
  // <p>text</p> -> text (on its own line)
  result = result.replace(/<p>([\s\S]*?)<\/p>/g, '$1');
  // <strong>text</strong> -> **text**
  result = result.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
  // <ul> and <li> -> markdown list
  result = result.replace(/<\/?ul>\s*\n?/g, '\n');
  result = result.replace(/\s*<li>([\s\S]*?)<\/li>/g, '\n- $1');

  // Clean up excessive blank lines
  result = result.replace(/\n{4,}/g, '\n\n\n');

  return result;
}

/**
 * Convert Docusaurus internal links to Astro-compatible paths.
 * /workflows/introduction -> /en/workflows/introduction
 * /commands/general/ccw -> /en/cli-commands/general/ccw
 */
function convertInternalLinks(body) {
  return body.replace(/\]\(\/(?!en\/)(.*?)\)/g, function(match, p) {
    var newPath = p;
    if (newPath.startsWith('commands/')) {
      newPath = 'cli-commands/' + newPath.slice('commands/'.length);
    }
    return '](/en/' + newPath + ')';
  });
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .md / .mdx files under a directory.
 */
function collectFiles(dir, base) {
  var results = [];
  var entries = fs.readdirSync(dir);
  for (var i = 0; i < entries.length; i++) {
    var full = path.join(dir, entries[i]);
    var stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(collectFiles(full, base));
    } else if (/\.(mdx|md)$/.test(entries[i])) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main migration logic
// ---------------------------------------------------------------------------

function migrate() {
  var files = collectFiles(SRC_DIR, SRC_DIR);
  console.log('Found ' + files.length + ' source files to migrate.\n');

  var migrated = 0;
  var skipped = 0;

  files.sort();
  for (var i = 0; i < files.length; i++) {
    var relPath = files[i];
    var srcPath = path.join(SRC_DIR, relPath);
    var content = fs.readFileSync(srcPath, 'utf-8');
    var parsed = parseFrontmatter(content);
    var attrs = parsed.attrs;
    var body = parsed.body;

    // Determine target dir and category
    var rule = null;
    for (var j = 0; j < PATH_RULES.length; j++) {
      if (PATH_RULES[j].match.test(relPath)) {
        rule = PATH_RULES[j];
        break;
      }
    }
    if (!rule) {
      console.log('  SKIP (no rule): ' + relPath);
      skipped++;
      continue;
    }

    // Build new frontmatter
    var newAttrs = {};
    newAttrs.title = attrs.title || path.basename(relPath, path.extname(relPath));
    newAttrs.description = attrs.description || ('Documentation for ' + newAttrs.title);
    newAttrs.category = rule.category;
    if (attrs.sidebar_position) {
      newAttrs.order = parseInt(attrs.sidebar_position, 10);
    }
    newAttrs.locale = 'en';

    // Apply body transformations
    var newBody = body;
    newBody = removeImports(newBody);
    newBody = convertMermaid(newBody);
    newBody = convertLinks(newBody);
    newBody = convertDetails(newBody);
    newBody = stripDocusaurusJsx(newBody);
    newBody = convertInternalLinks(newBody);

    // Clean up leading blank lines after import removal
    newBody = newBody.replace(/^\n+/, '\n');

    // Determine output filename - keep .mdx for all
    var srcFilename = path.basename(relPath);
    var dstFilename = srcFilename.replace(/\.md$/, '.mdx');
    var dstDir = path.join(DST_DIR, rule.targetDir);
    var dstPath = path.join(dstDir, dstFilename);

    var output = serializeFrontmatter(newAttrs, newBody);

    if (DRY_RUN) {
      console.log('  DRY-RUN: ' + relPath + ' -> ' + path.relative(ROOT, dstPath));
      console.log('    title: ' + newAttrs.title);
      console.log('    category: ' + newAttrs.category);
      console.log('    order: ' + (newAttrs.order || '(none)'));
    } else {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.writeFileSync(dstPath, output, 'utf-8');
      console.log('  OK: ' + relPath + ' -> ' + path.relative(ROOT, dstPath));
    }
    migrated++;
  }

  console.log('\nMigration complete: ' + migrated + ' migrated, ' + skipped + ' skipped.');
  if (DRY_RUN) {
    console.log('(dry-run mode - no files written)');
  }
}

migrate();
