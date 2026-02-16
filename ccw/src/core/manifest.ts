import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Manifest directory location
const MANIFEST_DIR = join(homedir(), '.claude-manifests');

export interface ManifestFileEntry {
  path: string;
  type: 'File';
  timestamp: string;
}

export interface ManifestDirectoryEntry {
  path: string;
  type: 'Directory';
  timestamp: string;
}

export interface Manifest {
  manifest_id: string;
  version: string;
  installation_mode: string;
  installation_path: string;
  installation_scope?: 'all' | 'codex';
  installation_date: string;
  installer_version: string;
  files: ManifestFileEntry[];
  directories: ManifestDirectoryEntry[];
}

export interface ManifestWithMetadata extends Manifest {
  manifest_file: string;
  application_version: string;
  files_count: number;
  directories_count: number;
}

/**
 * Ensure manifest directory exists
 */
function ensureManifestDir(): void {
  if (!existsSync(MANIFEST_DIR)) {
    mkdirSync(MANIFEST_DIR, { recursive: true });
  }
}

/**
 * Create a new installation manifest
 * @param mode - Installation mode (Global/Path)
 * @param installPath - Installation path
 * @returns New manifest object
 */
export function createManifest(mode: string, installPath: string, scope: 'all' | 'codex' = 'all'): Manifest {
  ensureManifestDir();

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0];
  const modePrefix = mode === 'Global' ? 'manifest-global' : 'manifest-path';
  const manifestId = `${modePrefix}-${timestamp}`;

  return {
    manifest_id: manifestId,
    version: '1.0',
    installation_mode: mode,
    installation_path: installPath,
    installation_scope: scope,
    installation_date: new Date().toISOString(),
    installer_version: '1.0.0',
    files: [],
    directories: []
  };
}

/**
 * Add file entry to manifest
 * @param manifest - Manifest object
 * @param filePath - File path
 */
export function addFileEntry(manifest: Manifest, filePath: string): void {
  manifest.files.push({
    path: filePath,
    type: 'File',
    timestamp: new Date().toISOString()
  });
}

/**
 * Add directory entry to manifest
 * @param manifest - Manifest object
 * @param dirPath - Directory path
 */
export function addDirectoryEntry(manifest: Manifest, dirPath: string): void {
  manifest.directories.push({
    path: dirPath,
    type: 'Directory',
    timestamp: new Date().toISOString()
  });
}

/**
 * Save manifest to disk
 * @param manifest - Manifest object
 * @returns Path to saved manifest
 */
export function saveManifest(manifest: Manifest): string {
  ensureManifestDir();

  // Remove old manifests for same path and mode
  removeOldManifests(manifest.installation_path, manifest.installation_mode);

  const manifestPath = join(MANIFEST_DIR, `${manifest.manifest_id}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return manifestPath;
}

/**
 * Remove old manifests for the same installation path and mode
 * @param installPath - Installation path
 * @param mode - Installation mode
 */
function removeOldManifests(installPath: string, mode: string): void {
  if (!existsSync(MANIFEST_DIR)) return;

  const normalizedPath = installPath.toLowerCase().replace(/[\\/]+$/, '');

  try {
    const files = readdirSync(MANIFEST_DIR).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = join(MANIFEST_DIR, file);
        const content = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<Manifest>;

        const manifestPath = (content.installation_path || '').toLowerCase().replace(/[\\/]+$/, '');
        const manifestMode = content.installation_mode || 'Global';

        if (manifestPath === normalizedPath && manifestMode === mode) {
          unlinkSync(filePath);
        }
      } catch {
        // Skip invalid manifest files
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Get all installation manifests
 * @returns Array of manifest objects
 */
export function getAllManifests(): ManifestWithMetadata[] {
  if (!existsSync(MANIFEST_DIR)) return [];

  const manifests: ManifestWithMetadata[] = [];

  try {
    const files = readdirSync(MANIFEST_DIR).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = join(MANIFEST_DIR, file);
        const content = JSON.parse(readFileSync(filePath, 'utf8')) as Manifest;

        // Try to read version.json for application version
        // Prefer .claude first for backward compatibility, then fallback to .codex.
        let appVersion = 'unknown';
        try {
          const versionPaths = [
            join(content.installation_path, '.claude', 'version.json'),
            join(content.installation_path, '.codex', 'version.json')
          ];
          for (const versionPath of versionPaths) {
            if (!existsSync(versionPath)) {
              continue;
            }
            const versionInfo = JSON.parse(readFileSync(versionPath, 'utf8')) as { version?: string };
            appVersion = versionInfo.version || 'unknown';
            break;
          }
        } catch {
          // Ignore
        }

        manifests.push({
          ...content,
          manifest_file: filePath,
          application_version: appVersion,
          files_count: content.files?.length || 0,
          directories_count: content.directories?.length || 0
        });
      } catch {
        // Skip invalid manifest files
      }
    }

    // Sort by installation date (newest first)
    manifests.sort((a, b) => new Date(b.installation_date).getTime() - new Date(a.installation_date).getTime());

  } catch {
    // Ignore errors
  }

  return manifests;
}

/**
 * Find manifest for a specific path and mode
 * @param installPath - Installation path
 * @param mode - Installation mode
 * @returns Manifest or null
 */
export function findManifest(installPath: string, mode: string): ManifestWithMetadata | null {
  const manifests = getAllManifests();
  const normalizedPath = installPath.toLowerCase().replace(/[\\/]+$/, '');

  return manifests.find(m => {
    const manifestPath = (m.installation_path || '').toLowerCase().replace(/[\\/]+$/, '');
    return manifestPath === normalizedPath && m.installation_mode === mode;
  }) || null;
}

/**
 * Delete a manifest file
 * @param manifestFile - Path to manifest file
 */
export function deleteManifest(manifestFile: string): void {
  if (existsSync(manifestFile)) {
    unlinkSync(manifestFile);
  }
}

/**
 * Get manifest directory path
 * @returns Manifest directory path
 */
export function getManifestDir(): string {
  return MANIFEST_DIR;
}

/**
 * Get file reference counts across all manifests
 * Returns a map of file path -> array of manifest IDs that reference it
 * @param excludeManifestId - Optional manifest ID to exclude from counting
 * @returns Map of file paths to referencing manifest IDs
 */
export function getFileReferenceCounts(excludeManifestId?: string): Map<string, string[]> {
  const fileRefs = new Map<string, string[]>();
  const manifests = getAllManifests();

  for (const manifest of manifests) {
    // Skip the excluded manifest (usually the one being replaced)
    if (excludeManifestId && manifest.manifest_id === excludeManifestId) {
      continue;
    }

    for (const fileEntry of manifest.files || []) {
      const normalizedPath = fileEntry.path.toLowerCase().replace(/\\/g, '/');
      const refs = fileRefs.get(normalizedPath) || [];
      refs.push(manifest.manifest_id);
      fileRefs.set(normalizedPath, refs);
    }
  }

  return fileRefs;
}

/**
 * Check if a file is referenced by other installations
 * @param filePath - File path to check
 * @param excludeManifestId - Manifest ID to exclude from checking
 * @returns True if file is referenced by other installations
 */
export function isFileReferencedByOthers(filePath: string, excludeManifestId: string): boolean {
  const fileRefs = getFileReferenceCounts(excludeManifestId);
  const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');
  const refs = fileRefs.get(normalizedPath) || [];
  return refs.length > 0;
}
