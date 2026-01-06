import { resolve, join, relative, isAbsolute } from 'path';
import { existsSync, mkdirSync, realpathSync, statSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { StoragePaths, ensureStorageDir, LegacyPaths } from '../config/storage-paths.js';

/**
 * Validation result for path operations
 */
export interface PathValidationResult {
  valid: boolean;
  path: string | null;
  error: string | null;
}

/**
 * Options for path validation
 */
export interface ValidatePathOptions {
  baseDir?: string | null;
  mustExist?: boolean;
  allowHome?: boolean;
}

/**
 * Resolve a path, handling ~ for home directory
 * @param inputPath - Path to resolve
 * @returns Absolute path
 */
export function resolvePath(inputPath: string): string {
  if (!inputPath) return process.cwd();

  // Handle ~ for home directory
  if (inputPath.startsWith('~')) {
    return join(homedir(), inputPath.slice(1));
  }

  return resolve(inputPath);
}

/**
 * Validate and sanitize a user-provided path
 * Prevents path traversal attacks and validates path is within allowed boundaries
 * @param inputPath - User-provided path
 * @param options - Validation options
 * @returns Validation result with path or error
 */
export function validatePath(inputPath: string, options: ValidatePathOptions = {}): PathValidationResult {
  const { baseDir = null, mustExist = false, allowHome = true } = options;

  // Check for empty/null input
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, path: null, error: 'Path is required' };
  }

  // Trim whitespace
  const trimmedPath = inputPath.trim();

  // Check for suspicious patterns (null bytes, control characters)
  if (/[\x00-\x1f]/.test(trimmedPath)) {
    return { valid: false, path: null, error: 'Path contains invalid characters' };
  }

  // Resolve the path
  let resolvedPath: string;
  try {
    resolvedPath = resolvePath(trimmedPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, path: null, error: `Invalid path: ${message}` };
  }

  // Check if within base directory when specified (pre-symlink resolution)
  const resolvedBase = baseDir ? resolvePath(baseDir) : null;
  if (resolvedBase) {
    const relativePath = relative(resolvedBase, resolvedPath);

    // Path traversal detection: relative path should not start with '..'
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return {
        valid: false,
        path: null,
        error: `Path must be within ${resolvedBase}`
      };
    }
  }

  // Check if path exists when required
  if (mustExist && !existsSync(resolvedPath)) {
    return { valid: false, path: null, error: `Path does not exist: ${resolvedPath}` };
  }

  // Get real path if it exists (resolves symlinks)
  let realPath = resolvedPath;
  if (existsSync(resolvedPath)) {
    try {
      realPath = realpathSync(resolvedPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, path: null, error: `Cannot resolve path: ${message}` };
    }
  } else if (resolvedBase) {
    // For non-existent paths, resolve the nearest existing ancestor to prevent symlink-based escapes
    // (e.g., baseDir/link/newfile where baseDir/link is a symlink to a disallowed location).
    let existingPath = resolvedPath;
    while (!existsSync(existingPath)) {
      const parent = resolve(existingPath, '..');
      if (parent === existingPath) break;
      existingPath = parent;
    }

    if (existsSync(existingPath)) {
      try {
        const realExisting = realpathSync(existingPath);
        const remainder = relative(existingPath, resolvedPath);
        realPath = remainder && remainder !== '.' ? join(realExisting, remainder) : realExisting;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { valid: false, path: null, error: `Cannot resolve path: ${message}` };
      }
    }
  }

  // Check if within base directory when specified (post-symlink resolution)
  if (resolvedBase) {
    const relativePath = relative(resolvedBase, realPath);

    // Path traversal detection: relative path should not start with '..'
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return {
        valid: false,
        path: null,
        error: `Path must be within ${resolvedBase}`
      };
    }
  }

  // Check home directory restriction
  if (!allowHome) {
    const home = homedir();
    if (realPath === home || realPath.startsWith(home + '/') || realPath.startsWith(home + '\\')) {
      // This is fine, we're just checking if it's explicitly the home dir itself
    }
  }

  return { valid: true, path: realPath, error: null };
}

/**
 * Validate output file path for writing
 * @param outputPath - Output file path
 * @param defaultDir - Default directory if path is relative
 * @returns Validation result with path or error
 */
export function validateOutputPath(outputPath: string, defaultDir: string = process.cwd()): PathValidationResult {
  if (!outputPath || typeof outputPath !== 'string') {
    return { valid: false, path: null, error: 'Output path is required' };
  }

  const trimmedPath = outputPath.trim();

  // Check for suspicious patterns
  if (/[\x00-\x1f]/.test(trimmedPath)) {
    return { valid: false, path: null, error: 'Output path contains invalid characters' };
  }

  // Resolve the path
  let resolvedPath: string;
  try {
    resolvedPath = isAbsolute(trimmedPath) ? trimmedPath : join(defaultDir, trimmedPath);
    resolvedPath = resolve(resolvedPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, path: null, error: `Invalid output path: ${message}` };
  }

  // Ensure it's not a directory
  if (existsSync(resolvedPath)) {
    try {
      const stat = statSync(resolvedPath);
      if (stat.isDirectory()) {
        return { valid: false, path: null, error: 'Output path is a directory, expected a file' };
      }
    } catch {
      // Ignore stat errors
    }
  }

  return { valid: true, path: resolvedPath, error: null };
}

/**
 * Get potential template locations
 * @returns Array of existing template directories
 */
export function getTemplateLocations(): string[] {
  const locations = [
    join(homedir(), '.claude', 'templates'),
    join(process.cwd(), '.claude', 'templates')
  ];

  return locations.filter(loc => existsSync(loc));
}

/**
 * Find a template file in known locations
 * @param templateName - Name of template file (e.g., 'workflow-dashboard.html')
 * @returns Path to template or null if not found
 */
export function findTemplate(templateName: string): string | null {
  const locations = getTemplateLocations();

  for (const loc of locations) {
    const templatePath = join(loc, templateName);
    if (existsSync(templatePath)) {
      return templatePath;
    }
  }

  return null;
}

/**
 * Ensure directory exists, creating if necessary
 * @param dirPath - Directory path to ensure
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Normalize path for display (handle Windows backslashes)
 * @param filePath - Path to normalize
 * @returns Normalized path with forward slashes
 */
export function normalizePathForDisplay(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

// Recent paths storage - uses centralized storage with backward compatibility
const MAX_RECENT_PATHS = 10;

/**
 * Get the recent paths file location
 * Uses new location but falls back to legacy location for backward compatibility
 */
function getRecentPathsFile(): string {
  const newPath = StoragePaths.global.recentPaths();
  const legacyPath = LegacyPaths.recentPaths();

  // Backward compatibility: use legacy if it exists and new doesn't
  if (!existsSync(newPath) && existsSync(legacyPath)) {
    return legacyPath;
  }
  return newPath;
}

/**
 * Recent paths data structure
 */
interface RecentPathsData {
  paths: string[];
}

/**
 * Get recent project paths
 * @returns Array of recent paths
 */
export function getRecentPaths(): string[] {
  try {
    const recentPathsFile = getRecentPathsFile();
    if (existsSync(recentPathsFile)) {
      const content = readFileSync(recentPathsFile, 'utf8');
      const data = JSON.parse(content) as RecentPathsData;
      return Array.isArray(data.paths) ? data.paths : [];
    }
  } catch {
    // Ignore errors, return empty array
  }
  return [];
}

/**
 * Track a project path (add to recent paths)
 * @param projectPath - Path to track
 */
export function trackRecentPath(projectPath: string): void {
  try {
    const normalized = normalizePathForDisplay(resolvePath(projectPath));
    let paths = getRecentPaths();

    // Remove if already exists (will be added to front)
    paths = paths.filter(p => normalizePathForDisplay(p) !== normalized);

    // Add to front
    paths.unshift(normalized);

    // Limit to max
    paths = paths.slice(0, MAX_RECENT_PATHS);

    // Save to new centralized location
    const recentPathsFile = StoragePaths.global.recentPaths();
    ensureStorageDir(StoragePaths.global.config());
    writeFileSync(recentPathsFile, JSON.stringify({ paths }, null, 2), 'utf8');
  } catch {
    // Ignore errors
  }
}

/**
 * Clear recent paths
 */
export function clearRecentPaths(): void {
  try {
    const recentPathsFile = StoragePaths.global.recentPaths();
    ensureStorageDir(StoragePaths.global.config());
    writeFileSync(recentPathsFile, JSON.stringify({ paths: [] }, null, 2), 'utf8');
  } catch {
    // Ignore errors
  }
}

/**
 * Remove a specific path from recent paths
 * @param pathToRemove - Path to remove
 * @returns True if removed, false if not found
 */
export function removeRecentPath(pathToRemove: string): boolean {
  try {
    const normalized = normalizePathForDisplay(resolvePath(pathToRemove));
    let paths = getRecentPaths();
    const originalLength = paths.length;

    // Filter out the path to remove
    paths = paths.filter(p => normalizePathForDisplay(p) !== normalized);

    if (paths.length < originalLength) {
      // Save updated list to new centralized location
      const recentPathsFile = StoragePaths.global.recentPaths();
      ensureStorageDir(StoragePaths.global.config());
      writeFileSync(recentPathsFile, JSON.stringify({ paths }, null, 2), 'utf8');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
