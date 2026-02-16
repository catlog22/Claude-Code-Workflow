import { join } from 'path';

export const SOURCE_DIRS = ['.claude', '.codex', '.gemini', '.qwen', '.ccw'] as const;
export const CODEX_ONLY_SOURCE_DIRS = ['.codex'] as const;

export type InstallationScope = 'all' | 'codex';

export function scopeFromInstallFlag(codexOnly?: boolean): InstallationScope {
  return codexOnly ? 'codex' : 'all';
}

export function scopeFromManifest(scope?: string): InstallationScope {
  return scope === 'codex' ? 'codex' : 'all';
}

export function getSourceDirsForScope(scope: InstallationScope): string[] {
  if (scope === 'codex') {
    return [...CODEX_ONLY_SOURCE_DIRS];
  }
  return [...SOURCE_DIRS];
}

export function getVersionFilePath(installPath: string, installedDirs: string[]): string | null {
  if (installedDirs.includes('.claude')) {
    return join(installPath, '.claude', 'version.json');
  }
  if (installedDirs.includes('.codex')) {
    return join(installPath, '.codex', 'version.json');
  }
  return null;
}

export function getVersionCandidatePaths(installPath: string): string[] {
  return [
    join(installPath, '.claude', 'version.json'),
    join(installPath, '.codex', 'version.json')
  ];
}
