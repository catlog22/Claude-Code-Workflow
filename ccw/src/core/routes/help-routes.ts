/**
 * Help Routes Module
 * Handles all Help-related API endpoints for command guide and CodexLens docs
 */
import { readFileSync, existsSync, watch } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { RouteContext } from './types.js';

// ========== In-Memory Cache ==========
interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 300000; // 5 minutes

/**
 * Get cached data or load from file
 */
function getCachedData(key: string, filePath: string): any {
  const now = Date.now();
  const cached = cache.get(key);

  // Return cached data if valid
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  // Load fresh data
  try {
    if (!existsSync(filePath)) {
      console.error(`Help data file not found: ${filePath}`);
      return null;
    }

    const content = readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);

    // Update cache
    cache.set(key, { data, timestamp: now });

    return data;
  } catch (error) {
    console.error(`Failed to load help data from ${filePath}:`, error);
    return null;
  }
}

/**
 * Invalidate cache for a specific key
 */
function invalidateCache(key: string): void {
  cache.delete(key);
  console.log(`Cache invalidated: ${key}`);
}

// ========== File Watchers ==========
let watchersInitialized = false;

/**
 * Initialize file watchers for JSON indexes
 */
function initializeFileWatchers(): void {
  if (watchersInitialized) return;

  const indexDir = join(homedir(), '.claude', 'skills', 'command-guide', 'index');

  if (!existsSync(indexDir)) {
    console.warn(`Command guide index directory not found: ${indexDir}`);
    return;
  }

  try {
    // Watch all JSON files in index directory
    const watcher = watch(indexDir, { recursive: false }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;

      console.log(`File change detected: ${filename} (${eventType})`);

      // Invalidate relevant cache entries
      if (filename === 'all-commands.json') {
        invalidateCache('all-commands');
      } else if (filename === 'command-relationships.json') {
        invalidateCache('command-relationships');
      } else if (filename === 'by-category.json') {
        invalidateCache('by-category');
      }
    });

    watchersInitialized = true;
    (watcher as any).unref?.();
    console.log(`File watchers initialized for: ${indexDir}`);
  } catch (error) {
    console.error('Failed to initialize file watchers:', error);
  }
}

// ========== Helper Functions ==========

/**
 * Filter commands by search query
 */
function filterCommands(commands: any[], query: string): any[] {
  if (!query) return commands;

  const lowerQuery = query.toLowerCase();
  return commands.filter(cmd =>
    cmd.name?.toLowerCase().includes(lowerQuery) ||
    cmd.command?.toLowerCase().includes(lowerQuery) ||
    cmd.description?.toLowerCase().includes(lowerQuery) ||
    cmd.category?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Group commands by category with subcategories
 */
function groupCommandsByCategory(commands: any[]): any {
  const grouped: any = {};

  for (const cmd of commands) {
    const category = cmd.category || 'general';
    const subcategory = cmd.subcategory || null;

    if (!grouped[category]) {
      grouped[category] = {
        name: category,
        commands: [],
        subcategories: {}
      };
    }

    if (subcategory) {
      if (!grouped[category].subcategories[subcategory]) {
        grouped[category].subcategories[subcategory] = [];
      }
      grouped[category].subcategories[subcategory].push(cmd);
    } else {
      grouped[category].commands.push(cmd);
    }
  }

  return grouped;
}

// ========== API Routes ==========

/**
 * Handle Help routes
 * @returns true if route was handled, false otherwise
 */
export async function handleHelpRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res } = ctx;

  // Initialize file watchers on first request
  initializeFileWatchers();

  const indexDir = join(homedir(), '.claude', 'skills', 'command-guide', 'index');

  // API: Get all commands with optional search
  if (pathname === '/api/help/commands') {
    const searchQuery = url.searchParams.get('q') || '';
    const filePath = join(indexDir, 'all-commands.json');

    let commands = getCachedData('all-commands', filePath);

    if (!commands) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Commands data not found' }));
      return true;
    }

    // Filter by search query if provided
    if (searchQuery) {
      commands = filterCommands(commands, searchQuery);
    }

    // Group by category
    const grouped = groupCommandsByCategory(commands);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      commands: commands,
      grouped: grouped,
      total: commands.length
    }));
    return true;
  }

  // API: Get workflow command relationships
  if (pathname === '/api/help/workflows') {
    const filePath = join(indexDir, 'command-relationships.json');
    const relationships = getCachedData('command-relationships', filePath);

    if (!relationships) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Workflow relationships not found' }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(relationships));
    return true;
  }

  // API: Get commands by category
  if (pathname === '/api/help/commands/by-category') {
    const filePath = join(indexDir, 'by-category.json');
    const byCategory = getCachedData('by-category', filePath);

    if (!byCategory) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Category data not found' }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(byCategory));
    return true;
  }

  // API: Get CodexLens documentation metadata
  if (pathname === '/api/help/codexlens') {
    // Return CodexLens quick-start guide data
    const codexLensData = {
      title: 'CodexLens Quick Start',
      description: 'Fast code indexing and semantic search for large codebases',
      sections: [
        {
          title: 'Key Concepts',
          items: [
            {
              name: 'Indexing',
              description: 'CodexLens builds a semantic index of your codebase for fast retrieval',
              command: 'codex_lens(action="init", path=".")'
            },
            {
              name: 'Search Modes',
              description: 'Text search for exact matches, semantic search for concept-based queries',
              command: 'codex_lens(action="search", query="authentication logic", mode="semantic")'
            },
            {
              name: 'Symbol Navigation',
              description: 'Extract and navigate code symbols (functions, classes, interfaces)',
              command: 'codex_lens(action="symbol", file="path/to/file.py")'
            }
          ]
        },
        {
          title: 'Common Commands',
          items: [
            {
              name: 'Initialize Index',
              command: 'codex_lens(action="init", path=".")',
              description: 'Index the current directory'
            },
            {
              name: 'Text Search',
              command: 'codex_lens(action="search", query="function name", path=".")',
              description: 'Search for exact text matches'
            },
            {
              name: 'Semantic Search',
              command: 'codex_lens(action="search", query="user authentication", mode="semantic")',
              description: 'Search by concept or meaning'
            },
            {
              name: 'Check Status',
              command: 'codex_lens(action="status")',
              description: 'View indexing status for all projects'
            }
          ]
        },
        {
          title: 'Best Practices',
          items: [
            { description: 'Index large codebases (>500 files) for optimal performance' },
            { description: 'Use semantic search for exploratory tasks' },
            { description: 'Combine with smart_search for medium-sized projects' },
            { description: 'Re-index after major code changes'  }
          ]
        }
      ],
      links: [
        { text: 'Full Documentation', url: 'https://github.com/yourusername/codex-lens' },
        { text: 'Tool Selection Guide', url: '/.claude/rules/tool-selection.md' }
      ]
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(codexLensData));
    return true;
  }

  return false;
}
