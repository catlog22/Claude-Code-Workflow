/**
 * Smart Search Tool - Unified intelligent search with CodexLens integration
 *
 * Features:
 * - Fuzzy mode: FTS + ripgrep fusion with RRF ranking (default)
 * - Semantic mode: Dense coarse retrieval + cross-encoder reranking
 * - CodexLens integration (init, dense_rerank, fts)
 * - Ripgrep fallback for exact mode
 * - Index status checking and warnings
 * - Multi-backend search routing with RRF ranking
 *
 * Actions:
 * - init: Initialize CodexLens index
 * - search: Intelligent search with fuzzy (default) or semantic mode
 * - status: Check index status
 * - update: Incremental index update for changed files
 * - watch: Start file watcher for automatic updates
 */

import { z } from 'zod';
import type { ToolSchema, ToolResult } from '../types/tool.js';
import { spawn, execSync } from 'child_process';
import {
  ensureReady as ensureCodexLensReady,
  executeCodexLens,
} from './codex-lens.js';
import type { ProgressInfo } from './codex-lens.js';
import { getProjectRoot } from '../utils/path-validator.js';
import { EXEC_TIMEOUTS } from '../utils/exec-constants.js';

// Timing utilities for performance analysis
const TIMING_ENABLED = process.env.SMART_SEARCH_TIMING === '1' || process.env.DEBUG?.includes('timing');

interface TimingData {
  [key: string]: number;
}

function createTimer(): { mark: (name: string) => void; getTimings: () => TimingData; log: () => void } {
  const startTime = performance.now();
  const marks: { name: string; time: number }[] = [];
  let lastMark = startTime;

  return {
    mark(name: string) {
      const now = performance.now();
      marks.push({ name, time: now - lastMark });
      lastMark = now;
    },
    getTimings(): TimingData {
      const timings: TimingData = {};
      marks.forEach(m => { timings[m.name] = Math.round(m.time * 100) / 100; });
      timings['_total'] = Math.round((performance.now() - startTime) * 100) / 100;
      return timings;
    },
    log() {
      if (TIMING_ENABLED) {
        const timings = this.getTimings();
        console.error(`[TIMING] smart-search: ${JSON.stringify(timings)}`);
      }
    }
  };
}

// Define Zod schema for validation
const ParamsSchema = z.object({
  // Action: search (content), find_files (path/name pattern), init, init_force, status, update (incremental), watch
  // Note: search_files is deprecated, use search with output_mode='files_only'
  // init: incremental index (skip existing), init_force: force full rebuild (delete and recreate)
  action: z.enum(['init', 'init_force', 'search', 'search_files', 'find_files', 'status', 'update', 'watch']).default('search'),
  query: z.string().optional().describe('Content search query (for action="search")'),
  pattern: z.string().optional().describe('Glob pattern for path matching (for action="find_files")'),
  mode: z.enum(['fuzzy', 'semantic']).default('fuzzy'),
  output_mode: z.enum(['full', 'files_only', 'count']).default('full'),
  path: z.string().optional(),
  paths: z.array(z.string()).default([]),
  contextLines: z.number().default(0),
  maxResults: z.number().default(5),  // Default 5 with full content
  includeHidden: z.boolean().default(false),
  languages: z.array(z.string()).optional(),
  limit: z.number().default(5),  // Default 5 with full content
  extraFilesCount: z.number().default(10),  // Additional file-only results
  maxContentLength: z.number().default(200),  // Max content length for truncation (50-2000)
  offset: z.number().default(0),  // NEW: Pagination offset (start_index)
  enrich: z.boolean().default(false),
  // Search modifiers for ripgrep mode
  regex: z.boolean().default(true),            // Use regex pattern matching (default: enabled)
  caseSensitive: z.boolean().default(true),    // Case sensitivity (default: case-sensitive)
  tokenize: z.boolean().default(true),         // Tokenize multi-word queries for OR matching (default: enabled)
  // File type filtering (default: code only)
  excludeExtensions: z.array(z.string()).optional().describe('File extensions to exclude from results (e.g., ["md", "txt"])'),
  codeOnly: z.boolean().default(true).describe('Only return code files (excludes md, txt, json, yaml, xml, etc.). Default: true'),
  withDoc: z.boolean().default(false).describe('Include documentation files (md, txt, rst, etc.). Overrides codeOnly when true'),
  // Watcher options
  debounce: z.number().default(1000).describe('Debounce interval in ms for watch action'),
  // Fuzzy matching is implicit in hybrid mode (RRF fusion)
});

type Params = z.infer<typeof ParamsSchema>;

// Search mode constants
const SEARCH_MODES = ['fuzzy', 'semantic'] as const;

// Classification confidence threshold
const CONFIDENCE_THRESHOLD = 0.7;

// File filtering configuration (ported from code-index)
const FILTER_CONFIG = {
  exclude_directories: new Set([
    '.git', '.svn', '.hg', '.bzr',
    'node_modules', '__pycache__', '.venv', 'venv', 'vendor', 'bower_components',
    'dist', 'build', 'target', 'out', 'bin', 'obj',
    '.idea', '.vscode', '.vs', '.sublime-workspace',
    '.pytest_cache', '.coverage', '.tox', '.nyc_output', 'coverage', 'htmlcov',
    '.next', '.nuxt', '.cache', '.parcel-cache',
    '.DS_Store', 'Thumbs.db',
  ]),
  exclude_files: new Set([
    '*.tmp', '*.temp', '*.swp', '*.swo', '*.bak', '*~', '*.orig', '*.log',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Pipfile.lock',
  ]),
  // Windows device files - must use **/ pattern to match in any directory
  // These cause "os error 1" on Windows when accessed
  windows_device_files: new Set([
    'nul', 'con', 'aux', 'prn',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
  ]),
};

function buildExcludeArgs(): string[] {
  const args: string[] = [];
  for (const dir of FILTER_CONFIG.exclude_directories) {
    args.push('--glob', `!**/${dir}/**`);
  }
  for (const pattern of FILTER_CONFIG.exclude_files) {
    args.push('--glob', `!${pattern}`);
  }
  // Windows device files need case-insensitive matching in any directory
  for (const device of FILTER_CONFIG.windows_device_files) {
    args.push('--glob', `!**/${device}`);
    args.push('--glob', `!**/${device.toUpperCase()}`);
  }
  return args;
}

/**
 * Tokenize query for multi-word OR matching
 * Splits on whitespace and common delimiters, filters stop words and short tokens
 * @param query - The search query
 * @returns Array of tokens
 */
function tokenizeQuery(query: string): string[] {
  // Stop words for filtering (common English + programming keywords)
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for', 'on',
    'with', 'at', 'by', 'from', 'as', 'into', 'through', 'and', 'but', 'if',
    'or', 'not', 'this', 'that', 'these', 'those', 'it', 'its', 'how', 'what',
    'where', 'when', 'why', 'which', 'who', 'whom',
  ]);

  // Split on whitespace and common delimiters, keep meaningful tokens
  const tokens = query
    .split(/[\s,;:]+/)
    .map(token => token.trim())
    .filter(token => {
      // Keep tokens that are:
      // - At least 2 characters long
      // - Not a stop word (case-insensitive)
      // - Or look like identifiers (contain underscore/camelCase)
      if (token.length < 2) return false;
      if (stopWords.has(token.toLowerCase()) && !token.includes('_') && !/[A-Z]/.test(token)) {
        return false;
      }
      return true;
    });

  return tokens;
}

/**
 * Score results based on token match count for ranking
 * @param results - Search results
 * @param tokens - Query tokens
 * @returns Results with match scores
 */
function scoreByTokenMatch(results: ExactMatch[], tokens: string[]): ExactMatch[] {
  if (tokens.length <= 1) return results;

  // Create case-insensitive patterns for each token
  const tokenPatterns = tokens.map(t => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  });

  return results.map(r => {
    const content = r.content || '';
    const file = r.file || '';
    const searchText = `${file} ${content}`;

    // Count how many tokens match
    let matchCount = 0;
    for (const pattern of tokenPatterns) {
      if (pattern.test(searchText)) {
        matchCount++;
      }
    }

    // Calculate match ratio (0 to 1)
    const matchRatio = matchCount / tokens.length;

    return {
      ...r,
      matchScore: matchRatio,
      matchCount,
    };
  }).sort((a, b) => {
    // Sort by match ratio (descending), then by line number
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    return (a.line || 0) - (b.line || 0);
  });
}

interface Classification {
  mode: string;
  confidence: number;
  reasoning: string;
}

interface ExactMatch {
  file: string;
  line: number;
  column: number;
  content: string;
  matchScore?: number;  // Token match ratio (0-1) for multi-word queries
  matchCount?: number;  // Number of tokens matched
}

interface RelationshipInfo {
  type: string;           // 'calls', 'imports', 'called_by', 'imported_by'
  direction: 'outgoing' | 'incoming';
  target?: string;        // Target symbol name (for outgoing)
  source?: string;        // Source symbol name (for incoming)
  file: string;           // File path
  line?: number;          // Line number
}

interface SemanticMatch {
  file: string;
  score: number;
  content: string;
  symbol: string | null;
  relationships?: RelationshipInfo[];
}

interface GraphMatch {
  file: string;
  symbols: unknown;
  relationships: unknown[];
}

// File match for find_files action (path-based search)
interface FileMatch {
  path: string;
  type: 'file' | 'directory';
  name: string;       // Filename only
  extension?: string; // File extension (without dot)
}

interface PaginationInfo {
  offset: number;     // Starting index of returned results
  limit: number;      // Number of results requested
  total: number;      // Total number of results found
  has_more: boolean;  // True if more results are available
}

interface SearchMetadata {
  mode?: string;
  backend?: string;
  count?: number;
  query?: string;
  pattern?: string;  // For find_files action
  classified_as?: string;
  confidence?: number;
  reasoning?: string;
  embeddings_coverage_percent?: number;
  warning?: string;
  note?: string;
  index_status?: 'indexed' | 'not_indexed' | 'partial';
  fallback?: string;  // Fallback mode used (e.g., 'fuzzy')
  fallback_history?: string[];
  suggested_weights?: Record<string, number>;
  // Tokenization metadata (ripgrep mode)
  tokens?: string[];   // Query tokens used for multi-word search
  tokenized?: boolean; // Whether tokenization was applied
  // Pagination metadata
  pagination?: PaginationInfo;
  // Performance timing data (when SMART_SEARCH_TIMING=1 or DEBUG includes 'timing')
  timing?: TimingData;
  // Init action specific
  action?: string;
  path?: string;
  progress?: {
    stage: string;
    message: string;
    percent: number;
    filesProcessed?: number;
    totalFiles?: number;
  };
  progressHistory?: ProgressInfo[];
}

interface SearchResult {
  success: boolean;
  results?: ExactMatch[] | SemanticMatch[] | GraphMatch[] | FileMatch[] | unknown;
  extra_files?: string[];  // Additional file paths without content
  output?: string;
  metadata?: SearchMetadata;
  error?: string;
  status?: unknown;
  message?: string;
}

interface ModelInfo {
  model_profile?: string;
  model_name?: string;
  embedding_dim?: number;
  backend?: string;
  created_at?: string;
  updated_at?: string;
}

interface CodexLensConfig {
  config_file?: string;
  index_dir?: string;
  embedding_backend?: string;  // 'fastembed' (local) or 'litellm' (api)
  embedding_model?: string;
  reranker_enabled?: boolean;
  reranker_backend?: string;   // 'onnx' (local) or 'api'
  reranker_model?: string;
  reranker_top_k?: number;
}

interface IndexStatus {
  indexed: boolean;
  has_embeddings: boolean;
  file_count?: number;
  embeddings_coverage_percent?: number;
  total_chunks?: number;
  model_info?: ModelInfo | null;
  config?: CodexLensConfig | null;
  warning?: string;
}

/**
 * Strip ANSI color codes from string (for JSON parsing)
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Default maximum content length to return (avoid excessive output) */
const DEFAULT_MAX_CONTENT_LENGTH = 200;

/**
 * Truncate content to specified length with ellipsis
 * @param content - The content to truncate
 * @param maxLength - Maximum length (default: 200)
 */
function truncateContent(content: string | null | undefined, maxLength: number = DEFAULT_MAX_CONTENT_LENGTH): string {
  if (!content) return '';
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
}

/**
 * Split results into full content results and extra file-only results
 * Generic function supporting both SemanticMatch and ExactMatch types
 * @param allResults - All search results (must have 'file' property)
 * @param fullContentLimit - Number of results with full content (default: 5)
 * @param extraFilesCount - Number of additional file-only results (default: 10)
 */
function splitResultsWithExtraFiles<T extends { file: string }>(
  allResults: T[],
  fullContentLimit: number = 5,
  extraFilesCount: number = 10
): { results: T[]; extra_files: string[] } {
  // First N results with full content
  const results = allResults.slice(0, fullContentLimit);

  // Next M results as file paths only (deduplicated)
  const extraResults = allResults.slice(fullContentLimit, fullContentLimit + extraFilesCount);
  const extra_files = [...new Set(extraResults.map(r => r.file))];

  return { results, extra_files };
}

/**
 * Check if CodexLens index exists for current directory
 * @param path - Directory path to check
 * @returns Index status
 */
async function checkIndexStatus(path: string = '.'): Promise<IndexStatus> {
  try {
    // Fetch both status and config in parallel
    const [statusResult, configResult] = await Promise.all([
      executeCodexLens(['status', '--json'], { cwd: path }),
      executeCodexLens(['config', 'show', '--json'], { cwd: path }),
    ]);

    // Parse config
    let config: CodexLensConfig | null = null;
    if (configResult.success && configResult.output) {
      try {
        const cleanConfigOutput = stripAnsi(configResult.output);
        const parsedConfig = JSON.parse(cleanConfigOutput);
        const configData = parsedConfig.result || parsedConfig;
        config = {
          config_file: configData.config_file,
          index_dir: configData.index_dir,
          embedding_backend: configData.embedding_backend,
          embedding_model: configData.embedding_model,
          reranker_enabled: configData.reranker_enabled,
          reranker_backend: configData.reranker_backend,
          reranker_model: configData.reranker_model,
          reranker_top_k: configData.reranker_top_k,
        };
      } catch {
        // Config parse failed, continue without it
      }
    }

    if (!statusResult.success) {
      return {
        indexed: false,
        has_embeddings: false,
        config,
        warning: 'No CodexLens index found. Run smart_search(action="init") to create index for better search results.',
      };
    }

    // Parse status output
    try {
      // Strip ANSI color codes from JSON output
      const cleanOutput = stripAnsi(statusResult.output || '{}');
      const parsed = JSON.parse(cleanOutput);
      // Handle both direct and nested response formats (status returns {success, result: {...}})
      const status = parsed.result || parsed;
      const indexed = status.projects_count > 0 || status.total_files > 0;

      // Get embeddings coverage from comprehensive status
      const embeddingsData = status.embeddings || {};
      const embeddingsCoverage = embeddingsData.coverage_percent || 0;
      const has_embeddings = embeddingsCoverage >= 50; // Threshold: 50%
      const totalChunks = embeddingsData.total_chunks || 0;

      // Extract model info if available
      const modelInfoData = embeddingsData.model_info;
      const modelInfo: ModelInfo | undefined = modelInfoData ? {
        model_profile: modelInfoData.model_profile,
        model_name: modelInfoData.model_name,
        embedding_dim: modelInfoData.embedding_dim,
        backend: modelInfoData.backend,
        created_at: modelInfoData.created_at,
        updated_at: modelInfoData.updated_at,
      } : undefined;

      let warning: string | undefined;
      if (!indexed) {
        warning = 'No CodexLens index found. Run smart_search(action="init") to create index for better search results.';
      } else if (embeddingsCoverage === 0) {
        warning = 'Index exists but no embeddings generated. Run: codexlens embeddings-generate --recursive';
      } else if (embeddingsCoverage < 50) {
        warning = `Embeddings coverage is ${embeddingsCoverage.toFixed(1)}% (below 50%). Hybrid search will use exact mode. Run: codexlens embeddings-generate --recursive`;
      }

      return {
        indexed,
        has_embeddings,
        file_count: status.total_files,
        embeddings_coverage_percent: embeddingsCoverage,
        total_chunks: totalChunks,
        // Ensure model_info is null instead of undefined so it's included in JSON
        model_info: modelInfo ?? null,
        config,
        warning,
      };
    } catch {
      return {
        indexed: false,
        has_embeddings: false,
        config,
        warning: 'Failed to parse index status',
      };
    }
  } catch {
    return {
      indexed: false,
      has_embeddings: false,
      warning: 'CodexLens not available',
    };
  }
}

/**
 * Detection heuristics for intent classification
 */

/**
 * Detect literal string query (simple alphanumeric or quoted strings)
 */
function detectLiteral(query: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(query) || /^["'].*["']$/.test(query);
}

/**
 * Detect regex pattern (contains regex metacharacters)
 */
function detectRegex(query: string): boolean {
  return /[.*+?^${}()|[\]\\]/.test(query);
}

/**
 * Detect natural language query (sentence structure, questions, multi-word phrases)
 */
function detectNaturalLanguage(query: string): boolean {
  return query.split(/\s+/).length >= 3 || /\?$/.test(query);
}

/**
 * Detect file path query (path separators, file extensions)
 */
function detectFilePath(query: string): boolean {
  return /[/\\]/.test(query) || /\.[a-z]{2,4}$/i.test(query);
}

/**
 * Detect relationship query (import, export, dependency keywords)
 */
function detectRelationship(query: string): boolean {
  return /(import|export|uses?|depends?|calls?|extends?)\s/i.test(query);
}

function looksLikeCodeQuery(query: string): boolean {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(query)) return true;
  if (/[:.<>\-=(){}[\]]/.test(query) && query.split(/\s+/).length <= 2) return true;
  if (/\.\*|\\\(|\\\[|\\s/.test(query)) return true;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(query)) return true;
  return false;
}

/**
 * Classify query intent and recommend search mode
 * Simple mapping: hybrid (NL + index + embeddings) | exact (index or insufficient embeddings) | ripgrep (no index)
 * @param query - Search query string
 * @param hasIndex - Whether CodexLens index exists
 * @param hasSufficientEmbeddings - Whether embeddings coverage >= 50%
 * @returns Classification result
 */
function classifyIntent(query: string, hasIndex: boolean = false, hasSufficientEmbeddings: boolean = false): Classification {
  const isNaturalLanguage = detectNaturalLanguage(query);
  const isCodeQuery = looksLikeCodeQuery(query);
  const isRegexPattern = detectRegex(query);

  let mode: string;
  let confidence: number;

  if (!hasIndex) {
    mode = 'ripgrep';
    confidence = 1.0;
  } else if (isCodeQuery || isRegexPattern) {
    mode = 'exact';
    confidence = 0.95;
  } else if (isNaturalLanguage && hasSufficientEmbeddings) {
    mode = 'hybrid';
    confidence = 0.9;
  } else {
    mode = 'exact';
    confidence = 0.8;
  }

  const detectedPatterns: string[] = [];
  if (detectLiteral(query)) detectedPatterns.push('literal');
  if (detectRegex(query)) detectedPatterns.push('regex');
  if (detectNaturalLanguage(query)) detectedPatterns.push('natural language');
  if (detectFilePath(query)) detectedPatterns.push('file path');
  if (detectRelationship(query)) detectedPatterns.push('relationship');
  if (isCodeQuery) detectedPatterns.push('code identifier');

  const reasoning = `Query classified as ${mode} (confidence: ${confidence.toFixed(2)}, detected: ${detectedPatterns.join(', ')}, index: ${hasIndex ? 'available' : 'not available'}, embeddings: ${hasSufficientEmbeddings ? 'sufficient' : 'insufficient'})`;

  return { mode, confidence, reasoning };
}

/**
 * Check if a tool is available in PATH
 * @param toolName - Tool executable name
 * @returns True if available
 */
function checkToolAvailability(toolName: string): boolean {
  try {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'where' : 'which';
    execSync(`${command} ${toolName}`, { stdio: 'ignore', timeout: EXEC_TIMEOUTS.SYSTEM_INFO });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build ripgrep command arguments
 * Supports tokenized multi-word queries with OR matching
 * @param params - Search parameters
 * @returns Command, arguments, and tokens used
 */
function buildRipgrepCommand(params: {
  query: string;
  paths: string[];
  contextLines: number;
  maxResults: number;
  includeHidden: boolean;
  regex?: boolean;
  caseSensitive?: boolean;
  tokenize?: boolean;
}): { command: string; args: string[]; tokens: string[] } {
  const { query, paths = ['.'], contextLines = 0, maxResults = 10, includeHidden = false, regex = false, caseSensitive = true, tokenize = true } = params;

  const args = [
    '-n',
    '--color=never',
    '--json',
  ];

  // Add file filtering (unless includeHidden is true)
  if (!includeHidden) {
    args.push(...buildExcludeArgs());
  }

  // Case sensitivity
  if (!caseSensitive) {
    args.push('--ignore-case');
  }

  if (contextLines > 0) {
    args.push('-C', contextLines.toString());
  }

  if (maxResults > 0) {
    args.push('--max-count', maxResults.toString());
  }

  if (includeHidden) {
    args.push('--hidden');
  }

  // Tokenize query for multi-word OR matching
  const tokens = tokenize ? tokenizeQuery(query) : [query];

  if (tokens.length > 1) {
    // Multi-token: use multiple -e patterns (OR matching)
    // Each token is escaped for regex safety unless regex mode is enabled
    for (const token of tokens) {
      if (regex) {
        args.push('-e', token);
      } else {
        // Escape regex special chars for literal matching
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        args.push('-e', escaped);
      }
    }
  } else {
    // Single token or no tokenization: use original behavior
    if (regex) {
      args.push('-e', query);
    } else {
      args.push('-F', query);
    }
  }

  args.push(...paths);

  return { command: 'rg', args, tokens };
}

/**
 * Action: init - Initialize CodexLens index (FTS only, no embeddings)
 * For semantic/vector search, use ccw view dashboard or codexlens CLI directly
 * @param params - Search parameters
 * @param force - If true, force full rebuild (delete existing index first)
 */
async function executeInitAction(params: Params, force: boolean = false): Promise<SearchResult> {
  const { path = '.', languages } = params;

  // Check CodexLens availability
  const readyStatus = await ensureCodexLensReady();
  if (!readyStatus.ready) {
    return {
      success: false,
      error: `CodexLens not available: ${readyStatus.error}. CodexLens will be auto-installed on first use.`,
    };
  }

  // Build args with --no-embeddings for FTS-only index (faster)
  // Use 'index init' subcommand (new CLI structure)
  const args = ['index', 'init', path, '--no-embeddings'];
  if (force) {
    args.push('--force');  // Force full rebuild
  }
  if (languages && languages.length > 0) {
    args.push('--language', languages.join(','));
  }

  // Track progress updates
  const progressUpdates: ProgressInfo[] = [];
  let lastProgress: ProgressInfo | null = null;

  const result = await executeCodexLens(args, {
    cwd: path,
    timeout: 1800000, // 30 minutes for large codebases
    onProgress: (progress: ProgressInfo) => {
      progressUpdates.push(progress);
      lastProgress = progress;
    },
  });

  // Build metadata with progress info
  const metadata: SearchMetadata = {
    action: force ? 'init_force' : 'init',
    path,
  };

  if (lastProgress !== null) {
    const p = lastProgress as ProgressInfo;
    metadata.progress = {
      stage: p.stage,
      message: p.message,
      percent: p.percent,
      filesProcessed: p.filesProcessed,
      totalFiles: p.totalFiles,
    };
  }

  if (progressUpdates.length > 0) {
    metadata.progressHistory = progressUpdates.slice(-5); // Keep last 5 progress updates
  }

  const actionLabel = force ? 'rebuilt (force)' : 'created';
  const successMessage = result.success
    ? `FTS index ${actionLabel} for ${path}. Note: For semantic/vector search, create vector index via "ccw view" dashboard or run "codexlens init ${path}" (without --no-embeddings).`
    : undefined;

  return {
    success: result.success,
    error: result.error,
    message: successMessage,
    metadata,
  };
}

/**
 * Action: status - Check CodexLens index status
 */
async function executeStatusAction(params: Params): Promise<SearchResult> {
  const { path = '.' } = params;

  const indexStatus = await checkIndexStatus(path);

  // Build detailed status message
  const statusParts: string[] = [];

  // Index status
  statusParts.push(`Index: ${indexStatus.indexed ? 'indexed' : 'not indexed'}`);
  if (indexStatus.file_count) {
    statusParts.push(`Files: ${indexStatus.file_count}`);
  }

  // Embeddings status
  if (indexStatus.embeddings_coverage_percent !== undefined) {
    statusParts.push(`Embeddings: ${indexStatus.embeddings_coverage_percent.toFixed(1)}%`);
  }
  if (indexStatus.total_chunks) {
    statusParts.push(`Chunks: ${indexStatus.total_chunks}`);
  }

  // Config summary
  if (indexStatus.config) {
    const cfg = indexStatus.config;
    // Embedding backend info
    const embeddingType = cfg.embedding_backend === 'litellm' ? 'API' : 'Local';
    statusParts.push(`Embedding: ${embeddingType} (${cfg.embedding_model || 'default'})`);

    // Reranker info
    if (cfg.reranker_enabled) {
      const rerankerType = cfg.reranker_backend === 'onnx' ? 'Local' : 'API';
      statusParts.push(`Reranker: ${rerankerType} (${cfg.reranker_model || 'default'})`);
    } else {
      statusParts.push('Reranker: disabled');
    }
  }

  return {
    success: true,
    status: indexStatus,
    message: indexStatus.warning || statusParts.join(' | '),
  };
}

/**
 * Action: update - Incremental index update
 * Updates index for changed files without full rebuild
 */
async function executeUpdateAction(params: Params): Promise<SearchResult> {
  const { path = '.', languages } = params;

  // Check CodexLens availability
  const readyStatus = await ensureCodexLensReady();
  if (!readyStatus.ready) {
    return {
      success: false,
      error: `CodexLens not available: ${readyStatus.error}`,
    };
  }

  // Check if index exists first
  const indexStatus = await checkIndexStatus(path);
  if (!indexStatus.indexed) {
    return {
      success: false,
      error: `Directory not indexed. Run smart_search(action="init") first.`,
    };
  }

  // Build args for incremental init (without --force)
  // Use 'index init' subcommand (new CLI structure)
  const args = ['index', 'init', path];
  if (languages && languages.length > 0) {
    args.push('--language', languages.join(','));
  }

  // Track progress updates
  const progressUpdates: ProgressInfo[] = [];
  let lastProgress: ProgressInfo | null = null;

  const result = await executeCodexLens(args, {
    cwd: path,
    timeout: 600000, // 10 minutes for incremental updates
    onProgress: (progress: ProgressInfo) => {
      progressUpdates.push(progress);
      lastProgress = progress;
    },
  });

  // Build metadata with progress info
  const metadata: SearchMetadata = {
    action: 'update',
    path,
  };

  if (lastProgress !== null) {
    const p = lastProgress as ProgressInfo;
    metadata.progress = {
      stage: p.stage,
      message: p.message,
      percent: p.percent,
      filesProcessed: p.filesProcessed,
      totalFiles: p.totalFiles,
    };
  }

  if (progressUpdates.length > 0) {
    metadata.progressHistory = progressUpdates.slice(-5);
  }

  return {
    success: result.success,
    error: result.error,
    message: result.success
      ? `Incremental update completed for ${path}`
      : undefined,
    metadata,
  };
}

/**
 * Action: watch - Start file watcher for automatic incremental updates
 * Note: This starts a background process, returns immediately with status
 */
async function executeWatchAction(params: Params): Promise<SearchResult> {
  const { path = '.', languages, debounce = 1000 } = params;

  // Check CodexLens availability
  const readyStatus = await ensureCodexLensReady();
  if (!readyStatus.ready) {
    return {
      success: false,
      error: `CodexLens not available: ${readyStatus.error}`,
    };
  }

  // Check if index exists first
  const indexStatus = await checkIndexStatus(path);
  if (!indexStatus.indexed) {
    return {
      success: false,
      error: `Directory not indexed. Run smart_search(action="init") first.`,
    };
  }

  // Build args for watch command
  const args = ['watch', path, '--debounce', debounce.toString()];
  if (languages && languages.length > 0) {
    args.push('--language', languages.join(','));
  }

  // Start watcher in background (non-blocking)
  // Note: The watcher runs until manually stopped
  const result = await executeCodexLens(args, {
    cwd: path,
    timeout: 5000, // Short timeout for initial startup check
  });

  return {
    success: true,
    message: `File watcher started for ${path}. Use Ctrl+C or kill the process to stop.`,
    metadata: {
      action: 'watch',
      path,
      note: 'Watcher runs in background. Changes are indexed automatically with debounce.',
    },
  };
}

/**
 * Mode: fuzzy - FTS + ripgrep fusion with RRF ranking
 * Runs both exact (FTS) and ripgrep searches in parallel, merges and ranks results
 */
async function executeFuzzyMode(params: Params): Promise<SearchResult> {
  const { query, path = '.', maxResults = 5, extraFilesCount = 10, codeOnly = true, withDoc = false, excludeExtensions } = params;
  // withDoc overrides codeOnly
  const effectiveCodeOnly = withDoc ? false : codeOnly;

  if (!query) {
    return {
      success: false,
      error: 'Query is required for search',
    };
  }

  const timer = createTimer();

  // Run both searches in parallel
  const [ftsResult, ripgrepResult] = await Promise.allSettled([
    executeCodexLensExactMode(params),
    executeRipgrepMode(params),
  ]);
  timer.mark('parallel_search');

  // Collect results from both sources
  const resultsMap = new Map<string, any[]>();
  
  // Add FTS results if successful
  if (ftsResult.status === 'fulfilled' && ftsResult.value.success && ftsResult.value.results) {
    resultsMap.set('exact', ftsResult.value.results as any[]);
  }

  // Add ripgrep results if successful
  if (ripgrepResult.status === 'fulfilled' && ripgrepResult.value.success && ripgrepResult.value.results) {
    resultsMap.set('ripgrep', ripgrepResult.value.results as any[]);
  }

  // If both failed, return error
  if (resultsMap.size === 0) {
    const errors: string[] = [];
    if (ftsResult.status === 'rejected') errors.push(`FTS: ${ftsResult.reason}`);
    if (ripgrepResult.status === 'rejected') errors.push(`Ripgrep: ${ripgrepResult.reason}`);
    return {
      success: false,
      error: `Both search backends failed: ${errors.join('; ')}`,
    };
  }

  // Apply RRF fusion with fuzzy-optimized weights
  // Fuzzy mode: balanced between exact and ripgrep
  const fusionWeights = { exact: 0.5, ripgrep: 0.5 };
  const totalToFetch = maxResults + extraFilesCount;
  const fusedResults = applyRRFFusion(resultsMap, fusionWeights, totalToFetch);
  timer.mark('rrf_fusion');

  // Apply code-only and extension filtering after fusion
  const filteredFusedResults = filterNoisyFiles(fusedResults as any[], { codeOnly: effectiveCodeOnly, excludeExtensions });

  // Normalize results format
  const normalizedResults = filteredFusedResults.map((item: any) => ({
    file: item.file || item.path,
    line: item.line || 0,
    column: item.column || 0,
    content: item.content || '',
    score: item.fusion_score || 0,
    matchCount: item.matchCount,
    matchScore: item.matchScore,
  }));

  // Split results: first N with full content, rest as file paths only
  const { results, extra_files } = splitResultsWithExtraFiles(normalizedResults, maxResults, extraFilesCount);

  // Log timing
  timer.log();
  const timings = timer.getTimings();

  return {
    success: true,
    results,
    extra_files: extra_files.length > 0 ? extra_files : undefined,
    metadata: {
      mode: 'fuzzy',
      backend: 'fts+ripgrep',
      count: results.length,
      query,
      note: `Fuzzy search using RRF fusion of FTS and ripgrep (weights: exact=${fusionWeights.exact}, ripgrep=${fusionWeights.ripgrep})`,
      timing: TIMING_ENABLED ? timings : undefined,
    },
  };
}

/**
 * Mode: auto - Intent classification and mode selection
 * Routes to: hybrid (NL + index) | exact (index) | ripgrep (no index)
 */
async function executeAutoMode(params: Params): Promise<SearchResult> {
  const { query, path = '.' } = params;

  if (!query) {
    return {
      success: false,
      error: 'Query is required for search action',
    };
  }

  // Check index status
  const indexStatus = await checkIndexStatus(path);

  // Classify intent with index and embeddings awareness
  const classification = classifyIntent(
    query, 
    indexStatus.indexed, 
    indexStatus.has_embeddings  // This now considers 50% threshold
  );

  // Route to appropriate mode based on classification
  let result: SearchResult;

  switch (classification.mode) {
    case 'hybrid':
      result = await executeHybridMode(params);
      break;

    case 'exact':
      result = await executeCodexLensExactMode(params);
      break;

    case 'ripgrep':
      result = await executeRipgrepMode(params);
      break;

    default:
      // Fallback to ripgrep
      result = await executeRipgrepMode(params);
      break;
  }

  // Add classification metadata
  if (result.metadata) {
    result.metadata.classified_as = classification.mode;
    result.metadata.confidence = classification.confidence;
    result.metadata.reasoning = classification.reasoning;
    result.metadata.embeddings_coverage_percent = indexStatus.embeddings_coverage_percent;
    result.metadata.index_status = indexStatus.indexed
      ? (indexStatus.has_embeddings ? 'indexed' : 'partial')
      : 'not_indexed';

    // Add warning if needed
    if (indexStatus.warning) {
      result.metadata.warning = indexStatus.warning;
    }
  }

  return result;
}

/**
 * Mode: ripgrep - Fast literal string matching using ripgrep
 * No index required, fallback to CodexLens if ripgrep unavailable
 * Supports tokenized multi-word queries with OR matching and result ranking
 */
async function executeRipgrepMode(params: Params): Promise<SearchResult> {
  const { query, paths = [], contextLines = 0, maxResults = 5, extraFilesCount = 10, maxContentLength = 200, includeHidden = false, path = '.', regex = true, caseSensitive = true, tokenize = true, codeOnly = true, withDoc = false, excludeExtensions } = params;
  // withDoc overrides codeOnly
  const effectiveCodeOnly = withDoc ? false : codeOnly;

  if (!query) {
    return {
      success: false,
      error: 'Query is required for search',
    };
  }

  // Check if ripgrep is available
  const hasRipgrep = checkToolAvailability('rg');

  // Calculate total to fetch for split (full content + extra files)
  const totalToFetch = maxResults + extraFilesCount;

  // If ripgrep not available, fall back to CodexLens exact mode
  if (!hasRipgrep) {
    const readyStatus = await ensureCodexLensReady();
    if (!readyStatus.ready) {
      return {
        success: false,
        error: 'Neither ripgrep nor CodexLens available. Install ripgrep (rg) or CodexLens for search functionality.',
      };
    }

    // Use CodexLens fts mode as fallback
    const args = ['search', query, '--limit', totalToFetch.toString(), '--method', 'fts', '--json'];
    const result = await executeCodexLens(args, { cwd: path });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        metadata: {
          mode: 'ripgrep',
          backend: 'codexlens-fallback',
          count: 0,
          query,
        },
      };
    }

    // Parse results
    let allResults: SemanticMatch[] = [];
    try {
      const parsed = JSON.parse(stripAnsi(result.output || '{}'));
      const data = parsed.result?.results || parsed.results || parsed;
      allResults = (Array.isArray(data) ? data : []).map((item: any) => ({
        file: item.path || item.file,
        score: item.score || 0,
        content: truncateContent(item.content || item.excerpt, maxContentLength),
        symbol: item.symbol || null,
      }));
    } catch {
      // Keep empty results
    }

    // Split results: first N with full content, rest as file paths only
    const { results, extra_files } = splitResultsWithExtraFiles(allResults, maxResults, extraFilesCount);

    return {
      success: true,
      results,
      extra_files: extra_files.length > 0 ? extra_files : undefined,
      metadata: {
        mode: 'ripgrep',
        backend: 'codexlens-fallback',
        count: results.length,
        query,
        note: 'Using CodexLens exact mode (ripgrep not available)',
      },
    };
  }

  // Use ripgrep - request more results to support split
  const { command, args, tokens } = buildRipgrepCommand({
    query,
    paths: paths.length > 0 ? paths : [path],
    contextLines,
    maxResults: totalToFetch,  // Fetch more to support split
    includeHidden,
    regex,
    caseSensitive,
    tokenize,
  });

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: path || getProjectRoot(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resultLimitReached = false;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const allResults: ExactMatch[] = [];
      const lines = stdout.split('\n').filter((line) => line.trim());
      // Limit total results to prevent memory overflow (--max-count only limits per-file)
      const effectiveLimit = totalToFetch > 0 ? totalToFetch : 500;

      for (const line of lines) {
        // Stop collecting if we've reached the limit
        if (allResults.length >= effectiveLimit) {
          resultLimitReached = true;
          break;
        }

        try {
          const item = JSON.parse(line);

          if (item.type === 'match') {
            const match: ExactMatch = {
              file: item.data.path.text,
              line: item.data.line_number,
              column:
                item.data.submatches && item.data.submatches[0]
                  ? item.data.submatches[0].start + 1
                  : 1,
              content: item.data.lines.text.trim(),
            };
            allResults.push(match);
          }
        } catch {
          continue;
        }
      }

      // Handle Windows device file errors gracefully (os error 1)
      // If we have results despite the error, return them as partial success
      const isWindowsDeviceError = stderr.includes('os error 1') || stderr.includes('函数不正确');

      // Apply token-based scoring and sorting for multi-word queries
      // Results matching more tokens are ranked higher (exact matches first)
      const scoredResults = tokens.length > 1 ? scoreByTokenMatch(allResults, tokens) : allResults;

      // Apply code-only and extension filtering
      const filteredResults = filterNoisyFiles(scoredResults as any[], { codeOnly: effectiveCodeOnly, excludeExtensions });

      if (code === 0 || code === 1 || (isWindowsDeviceError && filteredResults.length > 0)) {
        // Split results: first N with full content, rest as file paths only
        const { results, extra_files } = splitResultsWithExtraFiles(filteredResults, maxResults, extraFilesCount);

        // Build warning message for various conditions
        const warnings: string[] = [];
        if (resultLimitReached) {
          warnings.push(`Result limit reached (${effectiveLimit}). Use a more specific query or increase limit.`);
        }
        if (isWindowsDeviceError) {
          warnings.push('Some Windows device files were skipped');
        }

        resolve({
          success: true,
          results,
          extra_files: extra_files.length > 0 ? extra_files : undefined,
          metadata: {
            mode: 'ripgrep',
            backend: 'ripgrep',
            count: results.length,
            query,
            tokens: tokens.length > 1 ? tokens : undefined,  // Include tokens in metadata for debugging
            tokenized: tokens.length > 1,
            ...(warnings.length > 0 && { warning: warnings.join('; ') }),
          },
        });
      } else if (isWindowsDeviceError && allResults.length === 0) {
        // Windows device error but no results - might be the only issue
        resolve({
          success: true,
          results: [],
          metadata: {
            mode: 'ripgrep',
            backend: 'ripgrep',
            count: 0,
            query,
            warning: 'No matches found (some Windows device files were skipped)',
          },
        });
      } else {
        resolve({
          success: false,
          error: `ripgrep execution failed with code ${code}: ${stderr}`,
          results: [],
        });
      }
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        error: `Failed to spawn ripgrep: ${error.message}`,
        results: [],
      });
    });
  });
}

/**
 * Mode: exact - CodexLens exact/FTS search
 * Requires index
 */
async function executeCodexLensExactMode(params: Params): Promise<SearchResult> {
  const { query, path = '.', maxResults = 5, extraFilesCount = 10, maxContentLength = 200, enrich = false, excludeExtensions, codeOnly = true, withDoc = false, offset = 0 } = params;
  // withDoc overrides codeOnly
  const effectiveCodeOnly = withDoc ? false : codeOnly;

  if (!query) {
    return {
      success: false,
      error: 'Query is required for search',
    };
  }

  // Check CodexLens availability
  const readyStatus = await ensureCodexLensReady();
  if (!readyStatus.ready) {
    return {
      success: false,
      error: `CodexLens not available: ${readyStatus.error}`,
    };
  }

  // Check index status
  const indexStatus = await checkIndexStatus(path);

  // Request more results to support split (full content + extra files)
  const totalToFetch = maxResults + extraFilesCount;
  const args = ['search', query, '--limit', totalToFetch.toString(), '--offset', offset.toString(), '--method', 'fts', '--json'];
  if (enrich) {
    args.push('--enrich');
  }
  // Add code_only filter if requested (default: true)
  if (effectiveCodeOnly) {
    args.push('--code-only');
  }
  // Add exclude_extensions filter if provided
  if (excludeExtensions && excludeExtensions.length > 0) {
    args.push('--exclude-extensions', excludeExtensions.join(','));
  }
  const result = await executeCodexLens(args, { cwd: path });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      metadata: {
        mode: 'exact',
        backend: 'codexlens',
        count: 0,
        query,
        warning: indexStatus.warning,
      },
    };
  }

  // Parse results
  let allResults: SemanticMatch[] = [];
  try {
    const parsed = JSON.parse(stripAnsi(result.output || '{}'));
    const data = parsed.result?.results || parsed.results || parsed;
    allResults = (Array.isArray(data) ? data : []).map((item: any) => ({
      file: item.path || item.file,
      score: item.score || 0,
      content: truncateContent(item.content || item.excerpt, maxContentLength),
      symbol: item.symbol || null,
    }));
  } catch {
    // Keep empty results
  }

  // Fallback to fuzzy mode if exact returns no results
  if (allResults.length === 0) {
    const fuzzyArgs = ['search', query, '--limit', totalToFetch.toString(), '--offset', offset.toString(), '--method', 'fts', '--use-fuzzy', '--json'];
    if (enrich) {
      fuzzyArgs.push('--enrich');
    }
    // Add code_only filter if requested (default: true)
    if (effectiveCodeOnly) {
      fuzzyArgs.push('--code-only');
    }
    // Add exclude_extensions filter if provided
    if (excludeExtensions && excludeExtensions.length > 0) {
      fuzzyArgs.push('--exclude-extensions', excludeExtensions.join(','));
    }
    const fuzzyResult = await executeCodexLens(fuzzyArgs, { cwd: path });

    if (fuzzyResult.success) {
      try {
        const parsed = JSON.parse(stripAnsi(fuzzyResult.output || '{}'));
        const data = parsed.result?.results || parsed.results || parsed;
        allResults = (Array.isArray(data) ? data : []).map((item: any) => ({
          file: item.path || item.file,
          score: item.score || 0,
          content: truncateContent(item.content || item.excerpt, maxContentLength),
          symbol: item.symbol || null,
        }));
      } catch {
        // Keep empty results
      }

      if (allResults.length > 0) {
        // Split results: first N with full content, rest as file paths only
        const { results, extra_files } = splitResultsWithExtraFiles(allResults, maxResults, extraFilesCount);
        return {
          success: true,
          results,
          extra_files: extra_files.length > 0 ? extra_files : undefined,
          metadata: {
            mode: 'exact',
            backend: 'codexlens',
            count: results.length,
            query,
            warning: indexStatus.warning,
            note: 'No exact matches found, showing fuzzy results',
            fallback: 'fuzzy',
          },
        };
      }
    }
  }

  // Split results: first N with full content, rest as file paths only
  const { results, extra_files } = splitResultsWithExtraFiles(allResults, maxResults, extraFilesCount);

  return {
    success: true,
    results,
    extra_files: extra_files.length > 0 ? extra_files : undefined,
    metadata: {
      mode: 'exact',
      backend: 'codexlens',
      count: results.length,
      query,
      warning: indexStatus.warning,
    },
  };
}

/**
 * Mode: hybrid - Best quality semantic search
 * Uses CodexLens dense_rerank method (dense coarse + cross-encoder rerank)
 * Requires index with embeddings
 */
async function executeHybridMode(params: Params): Promise<SearchResult> {
  const timer = createTimer();
  const { query, path = '.', maxResults = 5, extraFilesCount = 10, maxContentLength = 200, enrich = false, excludeExtensions, codeOnly = true, withDoc = false, offset = 0 } = params;
  // withDoc overrides codeOnly
  const effectiveCodeOnly = withDoc ? false : codeOnly;

  if (!query) {
    return {
      success: false,
      error: 'Query is required for search',
    };
  }

  // Check CodexLens availability
  const readyStatus = await ensureCodexLensReady();
  timer.mark('codexlens_ready_check');
  if (!readyStatus.ready) {
    return {
      success: false,
      error: `CodexLens not available: ${readyStatus.error}`,
    };
  }

  // Check index status
  const indexStatus = await checkIndexStatus(path);
  timer.mark('index_status_check');

  // Request more results to support split (full content + extra files)
  const totalToFetch = maxResults + extraFilesCount;
  const args = ['search', query, '--limit', totalToFetch.toString(), '--offset', offset.toString(), '--method', 'dense_rerank', '--json'];
  if (enrich) {
    args.push('--enrich');
  }
  // Add code_only filter if requested (default: true)
  if (effectiveCodeOnly) {
    args.push('--code-only');
  }
  // Add exclude_extensions filter if provided
  if (excludeExtensions && excludeExtensions.length > 0) {
    args.push('--exclude-extensions', excludeExtensions.join(','));
  }
  const result = await executeCodexLens(args, { cwd: path });
  timer.mark('codexlens_search');

  if (!result.success) {
    timer.log();
    return {
      success: false,
      error: result.error,
      metadata: {
        mode: 'hybrid',
        backend: 'codexlens',
        count: 0,
        query,
        warning: indexStatus.warning,
      },
    };
  }

  // Parse results
  let allResults: SemanticMatch[] = [];
  let baselineInfo: { score: number; count: number } | null = null;
  let initialCount = 0;

  try {
    const parsed = JSON.parse(stripAnsi(result.output || '{}'));
    const data = parsed.result?.results || parsed.results || parsed;
    allResults = (Array.isArray(data) ? data : []).map((item: any) => {
      const rawScore = item.score || 0;
      // Hybrid mode returns distance scores (lower is better).
      // Convert to similarity scores (higher is better) for consistency.
      // Formula: similarity = 1 / (1 + distance)
      const similarityScore = rawScore > 0 ? 1 / (1 + rawScore) : 1;
      return {
        file: item.path || item.file,
        score: similarityScore,
        content: truncateContent(item.content || item.excerpt, maxContentLength),
        symbol: item.symbol || null,
      };
    });
    timer.mark('parse_results');

    initialCount = allResults.length;

    // Post-processing pipeline to improve semantic search quality
    // 0. Filter dominant baseline scores (hot spot detection)
    const baselineResult = filterDominantBaselineScores(allResults);
    allResults = baselineResult.filteredResults;
    baselineInfo = baselineResult.baselineInfo;

    // 1. Filter noisy directories (node_modules, etc.)
    // NOTE: Extension filtering is now done engine-side via --code-only and --exclude-extensions
    allResults = filterNoisyFiles(allResults, {});
    // 2. Boost results containing query keywords
    allResults = applyKeywordBoosting(allResults, query);
    // 3. Enforce score diversity (penalize identical scores)
    allResults = enforceScoreDiversity(allResults);
    // 4. Re-sort by adjusted scores
    allResults.sort((a, b) => b.score - a.score);
    timer.mark('post_processing');
  } catch {
    return {
      success: true,
      results: [],
      output: result.output,
      metadata: {
        mode: 'hybrid',
        backend: 'codexlens',
        count: 0,
        query,
        warning: indexStatus.warning || 'Failed to parse JSON output',
      },
    };
  }

  // Split results: first N with full content, rest as file paths only
  const { results, extra_files } = splitResultsWithExtraFiles(allResults, maxResults, extraFilesCount);
  timer.mark('split_results');

  // Build metadata with baseline info if detected
  let note = 'Using dense_rerank (dense coarse + cross-encoder rerank) for semantic search';
  if (baselineInfo) {
    note += ` | Filtered ${initialCount - allResults.length} hot-spot results with baseline score ~${baselineInfo.score.toFixed(4)}`;
  }

  // Log timing data
  timer.log();
  const timings = timer.getTimings();

  return {
    success: true,
    results,
    extra_files: extra_files.length > 0 ? extra_files : undefined,
    metadata: {
      mode: 'hybrid',
      backend: 'codexlens',
      count: results.length,
      query,
      note,
      warning: indexStatus.warning,
      suggested_weights: getRRFWeights(query),
      timing: TIMING_ENABLED ? timings : undefined,
    },
  };
}

/**
 * Query intent used to adapt RRF weights (Python parity).
 *
 * Keep this logic aligned with CodexLens Python hybrid search:
 * `codex-lens/src/codexlens/search/hybrid_search.py`
 */
export type QueryIntent = 'keyword' | 'semantic' | 'mixed';

// Python default: vector 60%, exact 30%, fuzzy 10%
const DEFAULT_RRF_WEIGHTS = {
  exact: 0.3,
  fuzzy: 0.1,
  vector: 0.6,
} as const;

function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((acc, v) => acc + v, 0);
  if (!Number.isFinite(sum) || sum <= 0) return { ...weights };
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / sum]));
}

/**
 * Detect query intent using the same heuristic signals as Python:
 * - Code patterns: `.`, `::`, `->`, CamelCase, snake_case, common code keywords
 * - Natural language patterns: >5 words, question marks, interrogatives, common verbs
 */
export function detectQueryIntent(query: string): QueryIntent {
  const trimmed = query.trim();
  if (!trimmed) return 'mixed';

  const lower = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  const hasCodeSignals =
    /(::|->|\.)/.test(trimmed) ||
    /[A-Z][a-z]+[A-Z]/.test(trimmed) ||
    /\b\w+_\w+\b/.test(trimmed) ||
    /\b(def|class|function|const|let|var|import|from|return|async|await|interface|type)\b/i.test(lower);

  const hasNaturalSignals =
    wordCount > 5 ||
    /\?/.test(trimmed) ||
    /\b(how|what|why|when|where)\b/i.test(trimmed) ||
    /\b(handle|explain|fix|implement|create|build|use|find|search|convert|parse|generate|support)\b/i.test(trimmed);

  if (hasCodeSignals && hasNaturalSignals) return 'mixed';
  if (hasCodeSignals) return 'keyword';
  if (hasNaturalSignals) return 'semantic';
  return 'mixed';
}

/**
 * Intent → weights mapping (Python parity).
 * - keyword: exact-heavy
 * - semantic: vector-heavy
 * - mixed: keep defaults
 */
export function adjustWeightsByIntent(
  intent: QueryIntent,
  baseWeights: Record<string, number>,
): Record<string, number> {
  if (intent === 'keyword') return normalizeWeights({ exact: 0.5, fuzzy: 0.1, vector: 0.4 });
  if (intent === 'semantic') return normalizeWeights({ exact: 0.2, fuzzy: 0.1, vector: 0.7 });
  return normalizeWeights({ ...baseWeights });
}

export function getRRFWeights(
  query: string,
  baseWeights: Record<string, number> = DEFAULT_RRF_WEIGHTS,
): Record<string, number> {
  return adjustWeightsByIntent(detectQueryIntent(query), baseWeights);
}

/**
 * Post-processing: Filter noisy files from semantic search results
 * Uses FILTER_CONFIG patterns to remove irrelevant files.
 * Optimized: pre-compiled regexes, accurate path segment matching.
 */
// Pre-compile file exclusion regexes once (avoid recompilation in loop)
const FILE_EXCLUDE_REGEXES = [...FILTER_CONFIG.exclude_files].map(pattern =>
  new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$')
);

// Non-code file extensions (for codeOnly filter)
const NON_CODE_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'xml', 'csv', 'log',
  'ini', 'cfg', 'conf', 'toml', 'env', 'properties',
  'html', 'htm', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'lock', 'sum', 'mod',
]);

interface FilterOptions {
  excludeExtensions?: string[];
  codeOnly?: boolean;
}

function filterNoisyFiles(results: SemanticMatch[], options: FilterOptions = {}): SemanticMatch[] {
  const { excludeExtensions = [], codeOnly = false } = options;

  // Build extension filter set
  const excludedExtSet = new Set(excludeExtensions.map(ext => ext.toLowerCase().replace(/^\./, '')));
  if (codeOnly) {
    NON_CODE_EXTENSIONS.forEach(ext => excludedExtSet.add(ext));
  }

  return results.filter(r => {
    // Support both 'file' and 'path' field names (different backends use different names)
    const filePath = r.file || (r as any).path || '';
    if (!filePath) return true;

    const segments: string[] = filePath.split(/[/\\]/);

    // Accurate directory check: segment must exactly match excluded directory
    if (segments.some((segment: string) => FILTER_CONFIG.exclude_directories.has(segment))) {
      return false;
    }

    // Accurate file check: pattern matches filename only (not full path)
    const filename = segments.pop() || '';
    if (FILE_EXCLUDE_REGEXES.some(regex => regex.test(filename))) {
      return false;
    }

    // Extension filter check
    if (excludedExtSet.size > 0) {
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      if (excludedExtSet.has(ext)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Post-processing: Boost results containing query keywords
 * Extracts keywords from query and boosts matching results.
 * Optimized: uses whole-word matching with regex for accuracy.
 */
// Helper to escape regex special characters
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyKeywordBoosting(results: SemanticMatch[], query: string): SemanticMatch[] {
  // Extract meaningful keywords (ignore common words)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'after', 'before', 'when', 'whenever', 'where', 'wherever', 'whether', 'which', 'who', 'whom', 'whose', 'what', 'whatever', 'whichever', 'whoever', 'whomever', 'this', 'that', 'these', 'those', 'it', 'its']);

  const keywords = query
    .toLowerCase()
    .split(/[\s,.;:()"{}[\]-]+/)  // More robust splitting on punctuation
    .filter(word => word.length > 2 && !stopWords.has(word));

  if (keywords.length === 0) return results;

  // Create case-insensitive regexes for whole-word matching
  const keywordRegexes = keywords.map(kw => new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i'));

  return results.map(r => {
    const content = r.content || '';
    const file = r.file || '';

    // Count keyword matches using whole-word regex
    let matchCount = 0;
    for (const regex of keywordRegexes) {
      if (regex.test(content) || regex.test(file)) {
        matchCount++;
      }
    }

    // Apply boost only if there are matches
    if (matchCount > 0) {
      const matchRatio = matchCount / keywords.length;
      const boost = 1 + (matchRatio * 0.3); // Up to 30% boost for full match
      return {
        ...r,
        score: r.score * boost,
      };
    }

    return r;
  });
}

/**
 * Post-processing: Enforce score diversity
 * Penalizes results with identical scores (indicates undifferentiated matching)
 */
function enforceScoreDiversity(results: SemanticMatch[]): SemanticMatch[] {
  if (results.length < 2) return results;

  // Count occurrences of each score (rounded to 3 decimal places for comparison)
  const scoreCounts = new Map<number, number>();
  for (const r of results) {
    const roundedScore = Math.round(r.score * 1000) / 1000;
    scoreCounts.set(roundedScore, (scoreCounts.get(roundedScore) || 0) + 1);
  }

  // Apply penalty to scores that appear more than twice
  return results.map(r => {
    const roundedScore = Math.round(r.score * 1000) / 1000;
    const count = scoreCounts.get(roundedScore) || 1;

    if (count > 2) {
      // Progressive penalty: more duplicates = bigger penalty
      const penalty = Math.max(0.7, 1 - (count * 0.05));
      return { ...r, score: r.score * penalty };
    }
    return r;
  });
}

/**
 * Post-processing: Filter results with dominant baseline score (hot spot detection)
 * When backend returns default "hot spot" files with identical high scores,
 * this function detects and removes them.
 *
 * Detection criteria:
 * - A single score appears in >50% of results
 * - That score is suspiciously high (>0.9)
 * - This indicates fallback mechanism returned placeholder results
 */
function filterDominantBaselineScores(
  results: SemanticMatch[]
): { filteredResults: SemanticMatch[]; baselineInfo: { score: number; count: number } | null } {
  if (results.length < 4) {
    return { filteredResults: results, baselineInfo: null };
  }

  // Count occurrences of each score (rounded to 4 decimal places)
  const scoreCounts = new Map<number, number>();
  results.forEach(r => {
    const rounded = Math.round(r.score * 10000) / 10000;
    scoreCounts.set(rounded, (scoreCounts.get(rounded) || 0) + 1);
  });

  // Find the most dominant score
  let dominantScore: number | null = null;
  let dominantCount = 0;
  scoreCounts.forEach((count, score) => {
    if (count > dominantCount) {
      dominantCount = count;
      dominantScore = score;
    }
  });

  // If a single score is present in >50% of results and is high (>0.9),
  // treat it as a suspicious baseline score and filter it out
  const BASELINE_THRESHOLD = 0.5;  // >50% of results have same score
  const HIGH_SCORE_THRESHOLD = 0.9; // Score above 0.9 is suspiciously high

  if (
    dominantScore !== null &&
    dominantCount > results.length * BASELINE_THRESHOLD &&
    dominantScore > HIGH_SCORE_THRESHOLD
  ) {
    const filteredResults = results.filter(r => {
      const rounded = Math.round(r.score * 10000) / 10000;
      return rounded !== dominantScore;
    });

    return {
      filteredResults,
      baselineInfo: { score: dominantScore, count: dominantCount },
    };
  }

  return { filteredResults: results, baselineInfo: null };
}

/**
 * TypeScript implementation of Reciprocal Rank Fusion
 * Reference: codex-lens/src/codexlens/search/ranking.py
 * Formula: score(d) = Σ weight_source / (k + rank_source(d))
 */
function applyRRFFusion(
  resultsMap: Map<string, any[]>,
  weightsOrQuery: Record<string, number> | string,
  limit: number,
  k: number = 60,
): any[] {
  const weights = typeof weightsOrQuery === 'string' ? getRRFWeights(weightsOrQuery) : weightsOrQuery;
  const pathScores = new Map<string, { score: number; result: any; sources: string[] }>();

  resultsMap.forEach((results, source) => {
    const weight = weights[source] || 0;
    if (weight === 0 || !results) return;

    results.forEach((result, rank) => {
      const path = result.file || result.path;
      if (!path) return;

      const rrfContribution = weight / (k + rank + 1);

      if (!pathScores.has(path)) {
        pathScores.set(path, { score: 0, result, sources: [] });
      }
      const entry = pathScores.get(path)!;
      entry.score += rrfContribution;
      if (!entry.sources.includes(source)) {
        entry.sources.push(source);
      }
    });
  });

  // Sort by fusion score descending
  return Array.from(pathScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => ({
      ...item.result,
      fusion_score: item.score,
      matched_backends: item.sources,
    }));
}

/**
 * Promise wrapper with timeout support
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param modeName - Name of the mode for error message
 * @returns A new promise that rejects on timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, modeName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`'${modeName}' search timed out after ${ms}ms`));
    }, ms);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

/**
 * Mode: priority - Fallback search strategy: hybrid -> exact -> ripgrep
 * Returns results from the first backend that succeeds and provides results.
 * More efficient than parallel mode - stops as soon as valid results are found.
 */
async function executePriorityFallbackMode(params: Params): Promise<SearchResult> {
  const { query, path = '.' } = params;
  const fallbackHistory: string[] = [];

  if (!query) {
    return { success: false, error: 'Query is required for search' };
  }

  // Check index status first
  const indexStatus = await checkIndexStatus(path);

  // 1. Try Hybrid search (highest priority) - 90s timeout for large indexes
  if (indexStatus.indexed && indexStatus.has_embeddings) {
    try {
      const hybridResult = await withTimeout(executeHybridMode(params), 90000, 'hybrid');
      if (hybridResult.success && hybridResult.results && (hybridResult.results as any[]).length > 0) {
        fallbackHistory.push('hybrid: success');
        return {
          ...hybridResult,
          metadata: {
            ...hybridResult.metadata,
            mode: 'priority',
            note: 'Result from hybrid search (semantic + vector).',
            fallback_history: fallbackHistory,
          },
        };
      }
      fallbackHistory.push('hybrid: no results');
    } catch (error) {
      fallbackHistory.push(`hybrid: ${(error as Error).message}`);
    }
  } else {
    fallbackHistory.push(`hybrid: skipped (${!indexStatus.indexed ? 'no index' : 'no embeddings'})`);
  }

  // 2. Fallback to Exact search - 10s timeout
  if (indexStatus.indexed) {
    try {
      const exactResult = await withTimeout(executeCodexLensExactMode(params), 10000, 'exact');
      if (exactResult.success && exactResult.results && (exactResult.results as any[]).length > 0) {
        fallbackHistory.push('exact: success');
        return {
          ...exactResult,
          metadata: {
            ...exactResult.metadata,
            mode: 'priority',
            note: 'Result from exact/FTS search (fallback from hybrid).',
            fallback_history: fallbackHistory,
          },
        };
      }
      fallbackHistory.push('exact: no results');
    } catch (error) {
      fallbackHistory.push(`exact: ${(error as Error).message}`);
    }
  } else {
    fallbackHistory.push('exact: skipped (no index)');
  }

  // 3. Final fallback to Ripgrep - 5s timeout
  try {
    const ripgrepResult = await withTimeout(executeRipgrepMode(params), 5000, 'ripgrep');
    fallbackHistory.push(ripgrepResult.success ? 'ripgrep: success' : 'ripgrep: failed');
    return {
      ...ripgrepResult,
      metadata: {
        ...ripgrepResult.metadata,
        mode: 'priority',
        note: 'Result from ripgrep search (final fallback).',
        fallback_history: fallbackHistory,
      },
    };
  } catch (error) {
    fallbackHistory.push(`ripgrep: ${(error as Error).message}`);
  }

  // All modes failed
  return {
    success: false,
    error: 'All search backends in priority mode failed or returned no results.',
    metadata: {
      mode: 'priority',
      query,
      fallback_history: fallbackHistory,
    } as any,
  };
}

// Tool schema for MCP
export const schema: ToolSchema = {
  name: 'smart_search',
  description: `Unified code search tool with content search, file discovery, and semantic search capabilities.

**Actions:**
- search: Search file content (default)
- find_files: Find files by path/name pattern (glob matching)
- init: Create FTS index (incremental - skips existing)
- init_force: Force full rebuild (delete and recreate index)
- status: Check index status
- update: Incremental index update (for changed files)
- watch: Start file watcher for automatic updates

**Content Search (action="search"):**
  smart_search(query="authentication logic")        # fuzzy mode (default) - FTS + ripgrep fusion
  smart_search(query="MyClass", mode="fuzzy")       # fuzzy mode - fast hybrid search
  smart_search(query="how to auth", mode="semantic")  # semantic mode - dense + reranker

**File Discovery (action="find_files"):**
  smart_search(action="find_files", pattern="*.ts")           # find all TypeScript files
  smart_search(action="find_files", pattern="src/**/*.js")    # recursive glob pattern
  smart_search(action="find_files", pattern="test_*.py")      # find test files
  smart_search(action="find_files", pattern="*.tsx", offset=20, limit=10)  # pagination

**Index Maintenance:**
  smart_search(action="update", path="/project")              # incremental index update
  smart_search(action="watch", path="/project")               # start file watcher
  smart_search(action="watch", debounce=2000)                 # custom debounce interval

**Pagination:** All actions support offset/limit for paginated results:
  smart_search(query="auth", limit=10, offset=0)    # first page
  smart_search(query="auth", limit=10, offset=10)   # second page

**Modes:** fuzzy (FTS + ripgrep fusion, default), semantic (dense + reranker)`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['init', 'init_force', 'search', 'find_files', 'status', 'update', 'watch', 'search_files'],
        description: 'Action: search (content search), find_files (path pattern matching), init (create index, incremental), init_force (force full rebuild), status (check index), update (incremental update), watch (auto-update). Note: search_files is deprecated.',
        default: 'search',
      },
      query: {
        type: 'string',
        description: 'Content search query (for action="search")',
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern for file discovery (for action="find_files"). Examples: "*.ts", "src/**/*.js", "test_*.py"',
      },
      mode: {
        type: 'string',
        enum: SEARCH_MODES,
        description: 'Search mode: fuzzy (FTS + ripgrep fusion, default), semantic (dense + reranker for natural language queries)',
        default: 'fuzzy',
      },
      output_mode: {
        type: 'string',
        enum: ['full', 'files_only', 'count'],
        description: 'Output format: full (default), files_only (paths only), count (per-file counts)',
        default: 'full',
      },
      path: {
        type: 'string',
        description: 'Directory path for init/search actions (default: current directory)',
      },
      paths: {
        type: 'array',
        description: 'Multiple paths to search within (for search action)',
        items: {
          type: 'string',
        },
        default: [],
      },
      contextLines: {
        type: 'number',
        description: 'Number of context lines around matches (exact mode only)',
        default: 0,
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 20)',
        default: 20,
      },
      limit: {
        type: 'number',
        description: 'Alias for maxResults (default: 20)',
        default: 20,
      },
      extraFilesCount: {
        type: 'number',
        description: 'Number of additional file-only results (paths without content)',
        default: 10,
      },
      maxContentLength: {
        type: 'number',
        description: 'Maximum content length for truncation (50-2000)',
        default: 200,
      },
      offset: {
        type: 'number',
        description: 'Pagination offset - skip first N results (default: 0)',
        default: 0,
      },
      includeHidden: {
        type: 'boolean',
        description: 'Include hidden files/directories',
        default: false,
      },
      languages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Languages to index (for init action). Example: ["javascript", "typescript"]',
      },
      enrich: {
        type: 'boolean',
        description: 'Enrich search results with code graph relationships (calls, imports, called_by, imported_by).',
        default: false,
      },
      regex: {
        type: 'boolean',
        description: 'Use regex pattern matching instead of literal string (ripgrep mode only). Default: enabled. Example: smart_search(query="class.*Builder")',
        default: true,
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case-sensitive search (default: true). Set to false for case-insensitive matching.',
        default: true,
      },
      tokenize: {
        type: 'boolean',
        description: 'Tokenize multi-word queries for OR matching (ripgrep mode). Default: true. Results are ranked by token match count (exact matches first).',
        default: true,
      },
    },
    required: [],
  },
};

/**
 * Action: find_files - Find files by path/name pattern (glob matching)
 * Unlike search which looks inside file content, find_files matches file paths
 */
async function executeFindFilesAction(params: Params): Promise<SearchResult> {
  const { pattern, path = '.', limit = 20, offset = 0, includeHidden = false, caseSensitive = true } = params;

  if (!pattern) {
    return {
      success: false,
      error: 'Pattern is required for find_files action. Use glob patterns like "*.ts", "src/**/*.js", or "test_*.py"',
    };
  }

  // Use ripgrep with --files flag for fast file listing with glob pattern
  const hasRipgrep = checkToolAvailability('rg');

  if (!hasRipgrep) {
    // Fallback to CodexLens file listing if available
    const readyStatus = await ensureCodexLensReady();
    if (!readyStatus.ready) {
      return {
        success: false,
        error: 'Neither ripgrep nor CodexLens available for file discovery.',
      };
    }

    // Try CodexLens file list command
    const args = ['list-files', '--json'];
    const result = await executeCodexLens(args, { cwd: path });

    if (!result.success) {
      return {
        success: false,
        error: `Failed to list files: ${result.error}`,
      };
    }

    // Parse and filter results by pattern
    let files: string[] = [];
    try {
      const parsed = JSON.parse(stripAnsi(result.output || '[]'));
      files = Array.isArray(parsed) ? parsed : (parsed.files || []);
    } catch {
      return {
        success: false,
        error: 'Failed to parse file list from CodexLens',
      };
    }

    // Apply glob pattern matching using minimatch-style regex
    const globRegex = globToRegex(pattern, caseSensitive);
    const matchedFiles = files.filter(f => globRegex.test(f));

    // Apply pagination
    const total = matchedFiles.length;
    const paginatedFiles = matchedFiles.slice(offset, offset + limit);

    const results: FileMatch[] = paginatedFiles.map(filePath => {
      const parts = filePath.split(/[/\\]/);
      const name = parts[parts.length - 1] || '';
      const ext = name.includes('.') ? name.split('.').pop() : undefined;
      return {
        path: filePath,
        type: 'file' as const,
        name,
        extension: ext,
      };
    });

    return {
      success: true,
      results,
      metadata: {
        pattern,
        backend: 'codexlens',
        count: results.length,
        pagination: {
          offset,
          limit,
          total,
          has_more: offset + limit < total,
        },
      },
    };
  }

  // Use ripgrep --files with glob pattern for fast file discovery
  return new Promise((resolve) => {
    const args = ['--files'];

    // Add exclude patterns
    if (!includeHidden) {
      args.push(...buildExcludeArgs());
    } else {
      args.push('--hidden');
    }

    // Add glob pattern
    args.push('--glob', pattern);

    // Case sensitivity for glob matching
    if (!caseSensitive) {
      args.push('--iglob', pattern);
      // Remove the case-sensitive glob and use iglob instead
      const globIndex = args.indexOf('--glob');
      if (globIndex !== -1) {
        args.splice(globIndex, 2);
      }
    }

    const child = spawn('rg', args, {
      cwd: path || getProjectRoot(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // ripgrep returns 1 when no matches found, which is not an error
      if (code !== 0 && code !== 1 && !stderr.includes('os error 1')) {
        resolve({
          success: false,
          error: `ripgrep file search failed: ${stderr}`,
        });
        return;
      }

      const allFiles = stdout.split('\n').filter(line => line.trim());
      const total = allFiles.length;

      // Apply pagination
      const paginatedFiles = allFiles.slice(offset, offset + limit);

      const results: FileMatch[] = paginatedFiles.map(filePath => {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const parts = normalizedPath.split('/');
        const name = parts[parts.length - 1] || '';
        const ext = name.includes('.') ? name.split('.').pop() : undefined;
        return {
          path: normalizedPath,
          type: 'file' as const,
          name,
          extension: ext,
        };
      });

      resolve({
        success: true,
        results,
        metadata: {
          pattern,
          backend: 'ripgrep',
          count: results.length,
          pagination: {
            offset,
            limit,
            total,
            has_more: offset + limit < total,
          },
        },
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        error: `Failed to spawn ripgrep: ${error.message}`,
      });
    });
  });
}

/**
 * Convert glob pattern to regex for file matching
 * Supports: *, **, ?, [abc], [!abc]
 */
function globToRegex(pattern: string, caseSensitive: boolean = true): RegExp {
  let i = 0;
  const out: string[] = [];
  const special = '.^$+{}|()';

  while (i < pattern.length) {
    const c = pattern[i];

    if (c === '*') {
      if (i + 1 < pattern.length && pattern[i + 1] === '*') {
        // ** matches any path including /
        out.push('.*');
        i += 2;
        // Skip following / if present
        if (pattern[i] === '/') {
          i++;
        }
        continue;
      } else {
        // * matches any character except /
        out.push('[^/]*');
      }
    } else if (c === '?') {
      out.push('[^/]');
    } else if (c === '[') {
      // Character class
      let j = i + 1;
      let negated = false;
      if (pattern[j] === '!' || pattern[j] === '^') {
        negated = true;
        j++;
      }
      let classContent = '';
      while (j < pattern.length && pattern[j] !== ']') {
        classContent += pattern[j];
        j++;
      }
      if (negated) {
        out.push(`[^${classContent}]`);
      } else {
        out.push(`[${classContent}]`);
      }
      i = j;
    } else if (special.includes(c)) {
      out.push('\\' + c);
    } else {
      out.push(c);
    }
    i++;
  }

  const flags = caseSensitive ? '' : 'i';
  return new RegExp('^' + out.join('') + '$', flags);
}

/**
 * Apply pagination to search results and add pagination metadata
 */
function applyPagination<T>(
  results: T[],
  offset: number,
  limit: number
): { paginatedResults: T[]; pagination: PaginationInfo } {
  const total = results.length;
  const paginatedResults = results.slice(offset, offset + limit);

  return {
    paginatedResults,
    pagination: {
      offset,
      limit,
      total,
      has_more: offset + limit < total,
    },
  };
}

/**
 * Transform results based on output_mode
 */
function transformOutput(
  results: ExactMatch[] | SemanticMatch[] | GraphMatch[] | unknown[],
  outputMode: 'full' | 'files_only' | 'count'
): unknown {
  if (!Array.isArray(results)) {
    return results;
  }

  switch (outputMode) {
    case 'files_only': {
      // Extract unique file paths
      const files = [...new Set(results.map((r: any) => r.file))].filter(Boolean);
      return { files, count: files.length };
    }
    case 'count': {
      // Count matches per file
      const counts: Record<string, number> = {};
      for (const r of results) {
        const file = (r as any).file;
        if (file) {
          counts[file] = (counts[file] || 0) + 1;
        }
      }
      return {
        files: Object.entries(counts).map(([file, count]) => ({ file, count })),
        total: results.length,
      };
    }
    case 'full':
    default:
      return results;
  }
}

// Handler function
export async function handler(params: Record<string, unknown>): Promise<ToolResult<SearchResult>> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  const { action, mode, output_mode, offset = 0 } = parsed.data;

  // Sync limit and maxResults - use the larger of the two if both provided
  // This ensures user-provided values take precedence over defaults
  const effectiveLimit = Math.max(parsed.data.limit || 20, parsed.data.maxResults || 20);
  parsed.data.maxResults = effectiveLimit;
  parsed.data.limit = effectiveLimit;

  // Track if search_files was used (deprecated)
  let deprecationWarning: string | undefined;

  try {
    let result: SearchResult;

    // Handle actions
    switch (action) {
      case 'init':
        result = await executeInitAction(parsed.data, false);
        break;

      case 'init_force':
        result = await executeInitAction(parsed.data, true);
        break;

      case 'status':
        result = await executeStatusAction(parsed.data);
        break;

      case 'find_files':
        // NEW: File path/name pattern matching (glob-based)
        result = await executeFindFilesAction(parsed.data);
        break;

      case 'update':
        // Incremental index update
        result = await executeUpdateAction(parsed.data);
        break;

      case 'watch':
        // Start file watcher (returns status, watcher runs in background)
        result = await executeWatchAction(parsed.data);
        break;

      case 'search_files':
        // DEPRECATED: Redirect to search with files_only output
        deprecationWarning = 'action="search_files" is deprecated. Use action="search" with output_mode="files_only" for content-to-files search, or action="find_files" for path pattern matching.';
        parsed.data.output_mode = 'files_only';
        // Fall through to search

      case 'search':
      default:
        // Handle search modes: fuzzy | semantic
        switch (mode) {
          case 'fuzzy':
            result = await executeFuzzyMode(parsed.data);
            break;
          case 'semantic':
            result = await executeHybridMode(parsed.data);
            break;
          default:
            throw new Error(`Unsupported mode: ${mode}. Use: fuzzy or semantic`);
        }
        break;
    }

    // Transform output based on output_mode (for search actions only)
    if (action === 'search' || action === 'search_files') {
      if (result.success && result.results && output_mode !== 'full') {
        result.results = transformOutput(result.results as any[], output_mode);
      }

      // Add pagination metadata for search results if not already present
      if (result.success && result.results && Array.isArray(result.results)) {
        const totalResults = (result.results as any[]).length;
        if (!result.metadata) {
          result.metadata = {};
        }
        if (!result.metadata.pagination) {
          result.metadata.pagination = {
            offset: 0,
            limit: effectiveLimit,
            total: totalResults,
            has_more: false,  // Already limited by backend
          };
        }
      }
    }

    // Add deprecation warning if applicable
    if (deprecationWarning && result.metadata) {
      result.metadata.warning = deprecationWarning;
    }

    return result.success ? { success: true, result } : { success: false, error: result.error };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Execute init action with external progress callback
 * Used by MCP server for streaming progress
 * @param params - Search parameters (path, languages, force)
 * @param onProgress - Optional callback for progress updates
 */
export async function executeInitWithProgress(
  params: Record<string, unknown>,
  onProgress?: (progress: ProgressInfo) => void
): Promise<SearchResult> {
  const path = (params.path as string) || '.';
  const languages = params.languages as string[] | undefined;
  const force = params.force as boolean || false;

  // Check CodexLens availability
  const readyStatus = await ensureCodexLensReady();
  if (!readyStatus.ready) {
    return {
      success: false,
      error: `CodexLens not available: ${readyStatus.error}. CodexLens will be auto-installed on first use.`,
    };
  }

  // Use 'index init' subcommand (new CLI structure)
  const args = ['index', 'init', path];
  if (force) {
    args.push('--force');  // Force full rebuild
  }
  if (languages && languages.length > 0) {
    args.push('--language', languages.join(','));
  }

  // Track progress updates
  const progressUpdates: ProgressInfo[] = [];
  let lastProgress: ProgressInfo | null = null;

  const result = await executeCodexLens(args, {
    cwd: path,
    timeout: 1800000, // 30 minutes for large codebases
    onProgress: (progress: ProgressInfo) => {
      progressUpdates.push(progress);
      lastProgress = progress;
      // Call external progress callback if provided
      if (onProgress) {
        onProgress(progress);
      }
    },
  });

  // Build metadata with progress info
  const metadata: SearchMetadata = {
    action: force ? 'init_force' : 'init',
    path,
  };

  if (lastProgress !== null) {
    const p = lastProgress as ProgressInfo;
    metadata.progress = {
      stage: p.stage,
      message: p.message,
      percent: p.percent,
      filesProcessed: p.filesProcessed,
      totalFiles: p.totalFiles,
    };
  }

  if (progressUpdates.length > 0) {
    metadata.progressHistory = progressUpdates.slice(-5);
  }

  const actionLabel = force ? 'rebuilt (force)' : 'created';
  return {
    success: result.success,
    error: result.error,
    message: result.success
      ? `CodexLens index ${actionLabel} successfully for ${path}`
      : undefined,
    metadata,
  };
}
