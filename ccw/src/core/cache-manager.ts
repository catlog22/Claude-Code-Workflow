import { readFile, readdir, stat, unlink, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { StoragePaths } from '../config/storage-paths.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  fileHashes: Map<string, number>; // file path -> mtime
  ttl?: number;
}

interface CacheOptions {
  ttl?: number; // Time-to-live in milliseconds (default: 5 minutes)
  cacheDir?: string; // Cache directory (default: .ccw-cache)
}

/**
 * CacheManager class for storing and retrieving dashboard data
 * Tracks file modification times to detect changes and invalidate cache
 */
export class CacheManager<T> {
  private cacheFile: string;
  private ttl: number;
  private cacheDir: string;

  /**
   * Create a new CacheManager instance
   * @param cacheKey - Unique identifier for this cache (e.g., 'dashboard-data')
   * @param options - Cache configuration options
   */
  constructor(cacheKey: string, options: CacheOptions = {}) {
    if (!options.cacheDir) {
      throw new Error('CacheManager requires cacheDir option. Use StoragePaths.project(path).cache');
    }
    this.ttl = options.ttl || 5 * 60 * 1000; // Default: 5 minutes
    this.cacheDir = options.cacheDir;
    this.cacheFile = join(this.cacheDir, `${cacheKey}.json`);
  }

  /**
   * Get cached data if valid, otherwise return null
   * @param watchPaths - Array of file/directory paths to check for modifications
   * @returns Cached data or null if invalid/expired
   */
  async get(watchPaths: string[] = []): Promise<T | null> {
    let content: string;
    try {
      content = await readFile(this.cacheFile, 'utf8');
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      console.warn(`Cache read error for ${this.cacheFile}:`, err?.message || String(err));
      return null;
    }

    try {
      const entry: CacheEntry<T> = JSON.parse(content, (key, value) => {
        // Revive Map objects from JSON
        if (key === 'fileHashes' && value && typeof value === 'object') {
          return new Map(Object.entries(value));
        }
        return value;
      });

      // Check TTL expiration
      if (this.ttl > 0) {
        const age = Date.now() - entry.timestamp;
        if (age > this.ttl) {
          return null;
        }
      }

      // Check if any watched files have changed
      if (watchPaths.length > 0) {
        const currentHashes = await this.computeFileHashes(watchPaths);
        if (!this.hashesMatch(entry.fileHashes, currentHashes)) {
          return null;
        }
      }

      return entry.data;
    } catch (err: any) {
      // If cache file is corrupted or unreadable, treat as invalid
      console.warn(`Cache parse error for ${this.cacheFile}:`, err?.message || String(err));
      return null;
    }
  }

  /**
   * Store data in cache with current timestamp and file hashes
   * @param data - Data to cache
   * @param watchPaths - Array of file/directory paths to track
   */
  async set(data: T, watchPaths: string[] = []): Promise<void> {
    try {
      // Ensure cache directory exists
      await mkdir(this.cacheDir, { recursive: true });

      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        fileHashes: await this.computeFileHashes(watchPaths),
        ttl: this.ttl
      };

      // Convert Map to plain object for JSON serialization
      const serializable = {
        ...entry,
        fileHashes: Object.fromEntries(entry.fileHashes)
      };

      await writeFile(this.cacheFile, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (err) {
      console.warn(`Cache write error for ${this.cacheFile}:`, (err as Error).message);
    }
  }

  /**
   * Invalidate (delete) the cache
   */
  async invalidate(): Promise<void> {
    try {
      await unlink(this.cacheFile);
    } catch (err) {
      if ((err as any)?.code === 'ENOENT') return;
      console.warn(`Cache invalidation error for ${this.cacheFile}:`, (err as Error).message);
    }
  }

  /**
   * Check if cache is valid without retrieving data
   * @param watchPaths - Array of file/directory paths to check
   * @returns True if cache exists and is valid
   */
  async isValid(watchPaths: string[] = []): Promise<boolean> {
    return (await this.get(watchPaths)) !== null;
  }

  /**
   * Compute file modification times for all watched paths
   * @param watchPaths - Array of file/directory paths
   * @returns Map of path to mtime
   */
  private async computeFileHashes(watchPaths: string[]): Promise<Map<string, number>> {
    const hashes = new Map<string, number>();

    await Promise.all(watchPaths.map(async (watchPath) => {
      try {
        const stats = await stat(watchPath);

        if (stats.isDirectory()) {
          // For directories, use directory mtime (detects file additions/deletions)
          hashes.set(watchPath, stats.mtimeMs);

          // Also recursively scan for workflow session files
          await this.scanDirectory(watchPath, hashes);
        } else {
          // For files, use file mtime
          hashes.set(watchPath, stats.mtimeMs);
        }
      } catch (err: any) {
        if (err?.code === 'ENOENT') return;
        // Skip paths that can't be accessed
        console.warn(`Cannot access path ${watchPath}:`, err?.message || String(err));
      }
    }));

    return hashes;
  }

  /**
   * Recursively scan directory for important files
   * @param dirPath - Directory to scan
   * @param hashes - Map to store file hashes
   * @param depth - Current recursion depth (max 3)
   */
  private async scanDirectory(dirPath: string, hashes: Map<string, number>, depth: number = 0): Promise<void> {
    if (depth > 3) return; // Limit recursion depth

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      await Promise.all(entries.map(async (entry) => {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Track important directories
          if (entry.name === '.task' || entry.name === '.review' || entry.name === '.summaries') {
            try {
              const stats = await stat(fullPath);
              hashes.set(fullPath, stats.mtimeMs);
              await this.scanDirectory(fullPath, hashes, depth + 1);
            } catch {
              // ignore
            }
          } else if (entry.name.startsWith('WFS-')) {
            // Scan WFS session directories
            try {
              const stats = await stat(fullPath);
              hashes.set(fullPath, stats.mtimeMs);
              await this.scanDirectory(fullPath, hashes, depth + 1);
            } catch {
              // ignore
            }
          }
        } else if (entry.isFile()) {
          // Track important files
          if (
            entry.name.endsWith('.json') ||
            entry.name === 'IMPL_PLAN.md' ||
            entry.name === 'TODO_LIST.md' ||
            entry.name === 'workflow-session.json'
          ) {
            try {
              const stats = await stat(fullPath);
              hashes.set(fullPath, stats.mtimeMs);
            } catch {
              // ignore
            }
          }
        }
      }));
    } catch (err) {
      // Skip directories that can't be read
      console.warn(`Cannot scan directory ${dirPath}:`, (err as Error).message);
    }
  }

  /**
   * Compare two file hash maps
   * @param oldHashes - Previous hashes
   * @param newHashes - Current hashes
   * @returns True if hashes match (no changes)
   */
  private hashesMatch(oldHashes: Map<string, number>, newHashes: Map<string, number>): boolean {
    // Check if any files were added or removed
    if (oldHashes.size !== newHashes.size) {
      return false;
    }

    // Check if any file mtimes changed
    const entries = Array.from(oldHashes.entries());
    for (let i = 0; i < entries.length; i++) {
      const path = entries[i][0];
      const oldMtime = entries[i][1];
      const newMtime = newHashes.get(path);
      if (newMtime === undefined || newMtime !== oldMtime) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get cache statistics
   * @returns Cache info object
   */
  async getStats(): Promise<{ exists: boolean; age?: number; fileCount?: number; size?: number }> {
    let fileStats;
    try {
      fileStats = await stat(this.cacheFile);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { exists: false };
      return { exists: false };
    }

    try {
      const content = await readFile(this.cacheFile, 'utf8');
      const entry = JSON.parse(content);

      return {
        exists: true,
        age: Date.now() - entry.timestamp,
        fileCount: Object.keys(entry.fileHashes || {}).length,
        size: fileStats.size
      };
    } catch {
      return { exists: false };
    }
  }
}

/**
 * Extract project path from workflow directory
 * @param workflowDir - Path to .workflow directory (e.g., /project/.workflow)
 * @returns Project root path
 */
function extractProjectPath(workflowDir: string): string {
  // workflowDir is typically {projectPath}/.workflow
  return workflowDir.replace(/[\/\\]\.workflow$/, '') || workflowDir;
}

/**
 * Create a cache manager for dashboard data
 * @param workflowDir - Path to .workflow directory
 * @param ttl - Optional TTL in milliseconds
 * @returns CacheManager instance
 */
export function createDashboardCache(workflowDir: string, ttl?: number): CacheManager<any> {
  // Use centralized storage path
  const projectPath = extractProjectPath(workflowDir);
  const cacheDir = StoragePaths.project(projectPath).cache;
  return new CacheManager('dashboard-data', { cacheDir, ttl });
}
