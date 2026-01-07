/**
 * Graph Routes Module
 * Handles graph visualization API endpoints for codex-lens data
 */
import { homedir } from 'os';
import { join, resolve, normalize } from 'path';
import { existsSync, readdirSync } from 'fs';
import Database from 'better-sqlite3';
import { validatePath as validateAllowedPath } from '../../utils/path-validator.js';
import type { RouteContext } from './types.js';

/**
 * PathMapper utility class (simplified from codex-lens Python implementation)
 * Maps source paths to index database paths
 */
class PathMapper {
  private indexRoot: string;

  constructor(indexRoot?: string) {
    this.indexRoot = indexRoot || join(homedir(), '.codexlens', 'indexes');
  }

  /**
   * Normalize path to cross-platform storage format
   * Windows: D:\path\to\dir → D/path/to/dir
   * Unix: /home/user/path → home/user/path
   */
  normalizePath(sourcePath: string): string {
    const resolved = sourcePath.replace(/\\/g, '/');

    // Handle Windows paths with drive letters
    if (process.platform === 'win32' && /^[A-Za-z]:/.test(resolved)) {
      const drive = resolved[0]; // D
      const rest = resolved.slice(2); // /path/to/dir
      return `${drive}${rest}`.replace(/^\//, '');
    }

    // Handle Unix paths - remove leading slash
    return resolved.replace(/^\//, '');
  }

  /**
   * Convert source path to index database path
   */
  sourceToIndexDb(sourcePath: string): string {
    const normalized = this.normalizePath(sourcePath);
    return join(this.indexRoot, normalized, '_index.db');
  }
}

interface GraphNode {
  id: string;
  name: string;
  type: string;
  file: string;
  line: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  sourceLine: number;
  sourceFile: string;
}

interface ImpactAnalysis {
  directDependents: string[];
  affectedFiles: string[];
}

/**
 * Validate and sanitize project path to prevent path traversal attacks
 * @returns sanitized absolute path or null if invalid
 */
type ProjectPathValidationResult =
  | { path: string; status: 200 }
  | { path: null; status: number; error: string };

async function validateProjectPath(projectPath: string, initialPath: string): Promise<ProjectPathValidationResult> {
  const candidate = projectPath || initialPath;

  try {
    const validated = await validateAllowedPath(candidate, { mustExist: true, allowedDirectories: [initialPath] });
    return { path: validated, status: 200 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Access denied') ? 403 : 400;
    console.error(`[Graph] Project path validation failed: ${message}`);
    return { path: null, status, error: status === 403 ? 'Access denied' : 'Invalid project path' };
  }
}

/**
 * Find all _index.db files recursively in a directory
 * @param dir Directory to search
 * @returns Array of absolute paths to _index.db files
 */
function findAllIndexDbs(dir: string): string[] {
  const dbs: string[] = [];

  function traverse(currentDir: string): void {
    const dbPath = join(currentDir, '_index.db');
    if (existsSync(dbPath)) {
      dbs.push(dbPath);
    }

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          traverse(join(currentDir, entry.name));
        }
      }
    } catch {
      // Silently skip directories we can't read
    }
  }

  traverse(dir);
  return dbs;
}

/**
 * Map codex-lens symbol kinds to graph node types
 * Returns null for non-code symbols (markdown headings, etc.)
 */
function mapSymbolKind(kind: string): string | null {
  const kindLower = kind.toLowerCase();

  // Exclude markdown headings
  if (/^h[1-6]$/.test(kindLower)) {
    return null;
  }

  const kindMap: Record<string, string> = {
    'function': 'FUNCTION',
    'class': 'CLASS',
    'method': 'METHOD',
    'variable': 'VARIABLE',
    'module': 'MODULE',
    'interface': 'CLASS', // TypeScript interfaces as CLASS
    'type': 'CLASS', // Type aliases as CLASS
    'constant': 'VARIABLE',
    'property': 'VARIABLE',
    'parameter': 'VARIABLE',
    'import': 'MODULE',
    'export': 'MODULE',
  };
  return kindMap[kindLower] || 'VARIABLE';
}

/**
 * Map codex-lens relationship types to graph edge types
 */
function mapRelationType(relType: string): string {
  const typeMap: Record<string, string> = {
    'call': 'CALLS',
    'import': 'IMPORTS',
    'inherits': 'INHERITS',
    'uses': 'CALLS', // Fallback uses → CALLS
  };
  return typeMap[relType.toLowerCase()] || 'CALLS';
}

/**
 * Query symbols from all codex-lens databases (hierarchical structure)
 * @param projectPath Root project path
 * @param fileFilter Optional file path filter (supports wildcards)
 * @param moduleFilter Optional module/directory filter
 */
async function querySymbols(projectPath: string, fileFilter?: string, moduleFilter?: string): Promise<GraphNode[]> {
  const mapper = new PathMapper();
  const rootDbPath = mapper.sourceToIndexDb(projectPath);
  const indexRoot = rootDbPath.replace(/[\\/]_index\.db$/, '');

  if (!existsSync(indexRoot)) {
    return [];
  }

  // Find all _index.db files recursively
  const dbPaths = findAllIndexDbs(indexRoot);

  if (dbPaths.length === 0) {
    return [];
  }

  const allNodes: GraphNode[] = [];

  for (const dbPath of dbPaths) {
    try {
      const db = Database(dbPath, { readonly: true });

      // Build WHERE clause for filtering
      let whereClause = '';
      const params: string[] = [];

      if (fileFilter) {
        const sanitized = sanitizeForLike(fileFilter);
        whereClause = 'WHERE f.full_path LIKE ?';
        params.push(`%${sanitized}%`);
      } else if (moduleFilter) {
        const sanitized = sanitizeForLike(moduleFilter);
        whereClause = 'WHERE f.full_path LIKE ?';
        params.push(`${sanitized}%`);
      }

      const query = `
        SELECT
          s.id,
          s.name,
          s.kind,
          s.start_line,
          f.full_path as file
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        ${whereClause}
        ORDER BY f.full_path, s.start_line
      `;

      const rows = params.length > 0 ? db.prepare(query).all(...params) : db.prepare(query).all();

      db.close();

      // Filter out non-code symbols (markdown headings, etc.)
      rows.forEach((row: any) => {
        const type = mapSymbolKind(row.kind);
        if (type !== null) {
          allNodes.push({
            id: `${row.file}:${row.name}:${row.start_line}`,
            name: row.name,
            type,
            file: row.file,
            line: row.start_line,
          });
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Graph] Failed to query symbols from ${dbPath}: ${message}`);
      // Continue with other databases even if one fails
    }
  }

  return allNodes;
}

/**
 * Query code relationships from all codex-lens databases (hierarchical structure)
 * @param projectPath Root project path
 * @param fileFilter Optional file path filter (supports wildcards)
 * @param moduleFilter Optional module/directory filter
 */
async function queryRelationships(projectPath: string, fileFilter?: string, moduleFilter?: string): Promise<GraphEdge[]> {
  const mapper = new PathMapper();
  const rootDbPath = mapper.sourceToIndexDb(projectPath);
  const indexRoot = rootDbPath.replace(/[\\/]_index\.db$/, '');

  if (!existsSync(indexRoot)) {
    return [];
  }

  // Find all _index.db files recursively
  const dbPaths = findAllIndexDbs(indexRoot);

  if (dbPaths.length === 0) {
    return [];
  }

  const allEdges: GraphEdge[] = [];

  for (const dbPath of dbPaths) {
    try {
      const db = Database(dbPath, { readonly: true });

      // Build WHERE clause for filtering
      let whereClause = '';
      const params: string[] = [];

      if (fileFilter) {
        const sanitized = sanitizeForLike(fileFilter);
        whereClause = 'WHERE f.full_path LIKE ?';
        params.push(`%${sanitized}%`);
      } else if (moduleFilter) {
        const sanitized = sanitizeForLike(moduleFilter);
        whereClause = 'WHERE f.full_path LIKE ?';
        params.push(`${sanitized}%`);
      }

      const query = `
        SELECT
          s.name as source_name,
          s.start_line as source_line,
          f.full_path as source_file,
          r.target_qualified_name,
          r.relationship_type,
          r.target_file
        FROM code_relationships r
        JOIN symbols s ON r.source_symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        ${whereClause}
        ORDER BY f.full_path, s.start_line
      `;

      const rows = params.length > 0 ? db.prepare(query).all(...params) : db.prepare(query).all();

      db.close();

      allEdges.push(...rows.map((row: any) => ({
        source: `${row.source_file}:${row.source_name}:${row.source_line}`,
        target: row.target_qualified_name,
        type: mapRelationType(row.relationship_type),
        sourceLine: row.source_line,
        sourceFile: row.source_file,
      })));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Graph] Failed to query relationships from ${dbPath}: ${message}`);
      // Continue with other databases even if one fails
    }
  }

  return allEdges;
}

/**
 * Sanitize a string for use in SQL LIKE patterns
 * Escapes special characters: %, _, [, ]
 */
function sanitizeForLike(input: string): string {
  return input
    .replace(/\[/g, '[[]')  // Escape [ first
    .replace(/%/g, '[%]')   // Escape %
    .replace(/_/g, '[_]');  // Escape _
}

/**
 * Validate and parse symbol ID format
 * Expected format: file:name:line or just symbolName
 * @returns sanitized symbol name or null if invalid
 */
function parseSymbolId(symbolId: string): string | null {
  if (!symbolId || symbolId.length > 500) {
    return null;
  }

  // Remove any potentially dangerous characters
  const sanitized = symbolId.replace(/[<>'";&|`$\\]/g, '');

  // Parse the format: file:name:line
  const parts = sanitized.split(':');
  if (parts.length >= 2) {
    // Return the name part (second element)
    const name = parts[1].trim();
    return name.length > 0 ? name : null;
  }

  // If no colons, use the whole string as name
  return sanitized.trim() || null;
}

/**
 * Perform impact analysis for a symbol
 * Find all symbols that depend on this symbol (direct and transitive)
 */
async function analyzeImpact(projectPath: string, symbolId: string): Promise<ImpactAnalysis> {
  const mapper = new PathMapper();
  const dbPath = mapper.sourceToIndexDb(projectPath);

  if (!existsSync(dbPath)) {
    return { directDependents: [], affectedFiles: [] };
  }

  // Parse and validate symbol ID
  const symbolName = parseSymbolId(symbolId);
  if (!symbolName) {
    console.error(`[Graph] Invalid symbol ID format: ${symbolId}`);
    return { directDependents: [], affectedFiles: [] };
  }

  try {
    const db = Database(dbPath, { readonly: true });

    // Sanitize for LIKE query to prevent injection via special characters
    const sanitizedName = sanitizeForLike(symbolName);

    // Find all symbols that reference this symbol
    const rows = db.prepare(`
      SELECT DISTINCT
        s.name as dependent_name,
        f.full_path as dependent_file,
        s.start_line as dependent_line
      FROM code_relationships r
      JOIN symbols s ON r.source_symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE r.target_qualified_name LIKE ?
    `).all(`%${sanitizedName}%`);

    db.close();

    const directDependents = rows.map((row: any) =>
      `${row.dependent_file}:${row.dependent_name}:${row.dependent_line}`
    );

    const affectedFiles = [...new Set(rows.map((row: any) => row.dependent_file))];

    return {
      directDependents,
      affectedFiles,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Graph] Failed to analyze impact: ${message}`);
    return { directDependents: [], affectedFiles: [] };
  }
}

/**
 * Handle Graph routes
 * @returns true if route was handled, false otherwise
 */
export async function handleGraphRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath } = ctx;

  // API: Graph Nodes - Get all symbols as graph nodes
  if (pathname === '/api/graph/nodes') {
    const rawPath = url.searchParams.get('path') || initialPath;
    const projectPathResult = await validateProjectPath(rawPath, initialPath);
    const limitStr = url.searchParams.get('limit') || '1000';
    const limit = Math.min(parseInt(limitStr, 10) || 1000, 5000); // Max 5000 nodes
    const fileFilter = url.searchParams.get('file') || undefined;
    const moduleFilter = url.searchParams.get('module') || undefined;

    if (projectPathResult.path === null) {
      res.writeHead(projectPathResult.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: projectPathResult.error, nodes: [] }));
      return true;
    }

    const projectPath = projectPathResult.path;

    try {
      const allNodes = await querySymbols(projectPath, fileFilter, moduleFilter);
      const nodes = allNodes.slice(0, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        nodes,
        total: allNodes.length,
        limit,
        hasMore: allNodes.length > limit,
        filters: { file: fileFilter, module: moduleFilter }
      }));
    } catch (err) {
      console.error(`[Graph] Error fetching nodes:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch graph nodes', nodes: [] }));
    }
    return true;
  }

  // API: Graph Edges - Get all relationships as graph edges
  if (pathname === '/api/graph/edges') {
    const rawPath = url.searchParams.get('path') || initialPath;
    const projectPathResult = await validateProjectPath(rawPath, initialPath);
    const limitStr = url.searchParams.get('limit') || '2000';
    const limit = Math.min(parseInt(limitStr, 10) || 2000, 10000); // Max 10000 edges
    const fileFilter = url.searchParams.get('file') || undefined;
    const moduleFilter = url.searchParams.get('module') || undefined;

    if (projectPathResult.path === null) {
      res.writeHead(projectPathResult.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: projectPathResult.error, edges: [] }));
      return true;
    }

    const projectPath = projectPathResult.path;

    try {
      const allEdges = await queryRelationships(projectPath, fileFilter, moduleFilter);
      const edges = allEdges.slice(0, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        edges,
        total: allEdges.length,
        limit,
        hasMore: allEdges.length > limit,
        filters: { file: fileFilter, module: moduleFilter }
      }));
    } catch (err) {
      console.error(`[Graph] Error fetching edges:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch graph edges', edges: [] }));
    }
    return true;
  }

  // API: Get available files and modules for filtering
  if (pathname === '/api/graph/files') {
    const rawPath = url.searchParams.get('path') || initialPath;
    const projectPathResult = await validateProjectPath(rawPath, initialPath);

    if (projectPathResult.path === null) {
      res.writeHead(projectPathResult.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: projectPathResult.error, files: [], modules: [] }));
      return true;
    }

    const projectPath = projectPathResult.path;

    try {
      const mapper = new PathMapper();
      const rootDbPath = mapper.sourceToIndexDb(projectPath);
      const indexRoot = rootDbPath.replace(/[\\/]_index\.db$/, '');

      if (!existsSync(indexRoot)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files: [], modules: [] }));
        return true;
      }

      const dbPaths = findAllIndexDbs(indexRoot);
      const filesSet = new Set<string>();
      const modulesSet = new Set<string>();

      for (const dbPath of dbPaths) {
        try {
          const db = Database(dbPath, { readonly: true });
          const rows = db.prepare(`SELECT DISTINCT full_path FROM files`).all();
          db.close();

          rows.forEach((row: any) => {
            const filePath = row.full_path;
            filesSet.add(filePath);

            // Extract module path (directory)
            const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
            if (lastSlash > 0) {
              const modulePath = filePath.substring(0, lastSlash);
              modulesSet.add(modulePath);
            }
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[Graph] Failed to query files from ${dbPath}: ${message}`);
        }
      }

      const files = Array.from(filesSet).sort();
      const modules = Array.from(modulesSet).sort();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files, modules }));
    } catch (err) {
      console.error(`[Graph] Error fetching files:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch files and modules', files: [], modules: [] }));
    }
    return true;
  }

  // API: Impact Analysis - Get impact analysis for a symbol
  if (pathname === '/api/graph/impact') {
    const rawPath = url.searchParams.get('path') || initialPath;
    const projectPathResult = await validateProjectPath(rawPath, initialPath);
    const symbolId = url.searchParams.get('symbol');

    if (projectPathResult.path === null) {
      res.writeHead(projectPathResult.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: projectPathResult.error, directDependents: [], affectedFiles: [] }));
      return true;
    }

    const projectPath = projectPathResult.path;

    if (!symbolId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'symbol parameter is required', directDependents: [], affectedFiles: [] }));
      return true;
    }

    try {
      const impact = await analyzeImpact(projectPath, symbolId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(impact));
    } catch (err) {
      console.error(`[Graph] Error analyzing impact:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Failed to analyze impact',
        directDependents: [],
        affectedFiles: []
      }));
    }
    return true;
  }

  // API: Search Process - Get search pipeline visualization data (placeholder)
  if (pathname === '/api/graph/search-process') {
    // This endpoint returns mock data for the search process visualization
    // In a real implementation, this would integrate with codex-lens search pipeline
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      stages: [
        { id: 1, name: 'Query Parsing', duration: 0, status: 'pending' },
        { id: 2, name: 'Vector Search', duration: 0, status: 'pending' },
        { id: 3, name: 'Graph Enrichment', duration: 0, status: 'pending' },
        { id: 4, name: 'Chunk Hierarchy', duration: 0, status: 'pending' },
        { id: 5, name: 'Result Ranking', duration: 0, status: 'pending' }
      ],
      chunks: [],
      callers: [],
      callees: [],
      message: 'Search process visualization requires an active search query'
    }));
    return true;
  }

  return false;
}
