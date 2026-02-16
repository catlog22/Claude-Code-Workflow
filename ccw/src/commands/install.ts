import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, appendFileSync, renameSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { showHeader, createSpinner, info, warning, error, summaryBox, divider } from '../utils/ui.js';
import { createManifest, addFileEntry, addDirectoryEntry, saveManifest, findManifest, getAllManifests } from '../core/manifest.js';
import { validatePath } from '../utils/path-resolver.js';
import type { Ora } from 'ora';

// Git Bash fix markers
const GITBASH_FIX_START = '# >>> ccw gitbash fix';
const GITBASH_FIX_END = '# <<< ccw gitbash fix';

// Supported shell configuration files
const SHELL_CONFIG_FILES = [
  { name: '.bashrc', description: 'Bash configuration (recommended for Git Bash)' },
  { name: '.bash_profile', description: 'Bash login shell configuration' },
  { name: '.profile', description: 'Generic shell profile' },
  { name: '.zshrc', description: 'Zsh configuration' }
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Source directories to install (includes .codex with prompts folder)
const SOURCE_DIRS = ['.claude', '.codex', '.gemini', '.qwen', '.ccw'] as const;
const CODEX_ONLY_SOURCE_DIRS = ['.codex'] as const;
type InstallationScope = 'all' | 'codex';

// Subdirectories that should always be installed to global (~/.claude/)
const GLOBAL_SUBDIRS = ['workflows', 'scripts', 'templates'];

// Files that should be excluded from cleanup (user-specific settings)
const EXCLUDED_FILES = ['settings.json', 'settings.local.json'];

interface InstallOptions {
  mode?: string;
  path?: string;
  force?: boolean;
  codexOnly?: boolean;
}

interface CopyResult {
  files: number;
  directories: number;
}

// Disabled item tracking for install process
interface DisabledItem {
  name: string;
  path: string;
  type: 'skill' | 'command';
}

interface DisabledItems {
  skills: DisabledItem[];
  commands: DisabledItem[];
}

function normalizeInstallationScope(codexOnly?: boolean): InstallationScope {
  return codexOnly ? 'codex' : 'all';
}

function getSourceDirsForScope(scope: InstallationScope): string[] {
  if (scope === 'codex') {
    return [...CODEX_ONLY_SOURCE_DIRS];
  }
  return [...SOURCE_DIRS];
}

function getVersionFilePath(installPath: string, installedDirs: string[]): string | null {
  if (installedDirs.includes('.claude')) {
    return join(installPath, '.claude', 'version.json');
  }
  if (installedDirs.includes('.codex')) {
    return join(installPath, '.codex', 'version.json');
  }
  return null;
}

/**
 * Scan for disabled skills and commands before installation
 * Skills: look for SKILL.md.disabled files
 * Commands: look for *.md.disabled files
 */
function scanDisabledItems(installPath: string, globalPath?: string): DisabledItems {
  const result: DisabledItems = { skills: [], commands: [] };
  const pathsToScan = [installPath];
  if (globalPath && globalPath !== installPath) {
    pathsToScan.push(globalPath);
  }

  for (const basePath of pathsToScan) {
    // Scan skills
    const skillsDir = join(basePath, '.claude', 'skills');
    if (existsSync(skillsDir)) {
      try {
        const entries = readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const disabledPath = join(skillsDir, entry.name, 'SKILL.md.disabled');
            if (existsSync(disabledPath)) {
              result.skills.push({
                name: entry.name,
                path: disabledPath,
                type: 'skill'
              });
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // Scan commands recursively
    const commandsDir = join(basePath, '.claude', 'commands');
    if (existsSync(commandsDir)) {
      scanDisabledCommandsRecursive(commandsDir, commandsDir, result.commands);
    }
  }

  return result;
}

/**
 * Recursively scan for disabled command files
 */
function scanDisabledCommandsRecursive(baseDir: string, currentDir: string, results: DisabledItem[]): void {
  try {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        scanDisabledCommandsRecursive(baseDir, fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('.md.disabled')) {
        const relativePath = fullPath.substring(baseDir.length + 1);
        const commandName = relativePath.replace(/\.disabled$/, '');
        results.push({
          name: commandName,
          path: fullPath,
          type: 'command'
        });
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Restore disabled state after installation
 * For each previously disabled item, if the enabled version exists, rename it back to disabled
 */
function restoreDisabledState(
  disabledItems: DisabledItems,
  installPath: string,
  globalPath?: string
): { skillsRestored: number; commandsRestored: number } {
  let skillsRestored = 0;
  let commandsRestored = 0;

  // Restore skills
  for (const skill of disabledItems.skills) {
    // Determine which path this skill belongs to
    const skillDir = dirname(skill.path);
    const enabledPath = join(skillDir, 'SKILL.md');
    const disabledPath = join(skillDir, 'SKILL.md.disabled');

    // If enabled version was installed, rename it to disabled
    if (existsSync(enabledPath)) {
      try {
        // Remove old disabled file if it still exists (shouldn't, but be safe)
        if (existsSync(disabledPath)) {
          unlinkSync(disabledPath);
        }
        renameSync(enabledPath, disabledPath);
        skillsRestored++;
      } catch {
        // Ignore errors
      }
    }
  }

  // Restore commands
  for (const command of disabledItems.commands) {
    const enabledPath = command.path.replace(/\.disabled$/, '');
    const disabledPath = command.path;

    // If enabled version was installed, rename it to disabled
    if (existsSync(enabledPath)) {
      try {
        // Remove old disabled file if it still exists
        if (existsSync(disabledPath)) {
          unlinkSync(disabledPath);
        }
        renameSync(enabledPath, disabledPath);
        commandsRestored++;
      } catch {
        // Ignore errors
      }
    }
  }

  return { skillsRestored, commandsRestored };
}

// Get package root directory (ccw/src/commands -> ccw)
function getPackageRoot(): string {
  return join(__dirname, '..', '..');
}

// Get source installation directory (parent of ccw)
function getSourceDir(): string {
  return join(getPackageRoot(), '..');
}

/**
 * Install command handler
 * @param {Object} options - Command options
 */
export async function installCommand(options: InstallOptions): Promise<void> {
  const version = getVersion();

  // Show beautiful header
  showHeader(version);

  // Check for existing installations
  const existingManifests = getAllManifests();
  if (existingManifests.length > 0 && !options.force) {
    info('Existing installations detected:');
    console.log('');
    existingManifests.forEach((m, i) => {
      console.log(chalk.gray(`  ${i + 1}. ${m.installation_mode} - ${m.installation_path}`));
      console.log(chalk.gray(`     Installed: ${new Date(m.installation_date).toLocaleDateString()}`));
    });
    console.log('');

    const { proceed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'proceed',
      message: 'Continue with new installation?',
      default: true
    }]);

    if (!proceed) {
      info('Installation cancelled');
      return;
    }
  }

  // Local installation from package source
  const sourceDir = getSourceDir();

  // Interactive mode selection
  const mode = options.mode || await selectMode();
  const installationScope = normalizeInstallationScope(options.codexOnly);

  let installPath: string;
  if (mode === 'Global') {
    installPath = homedir();
    info(`Global installation to: ${installPath}`);
  } else {
    const inputPath = options.path || await selectPath();

    // Validate the installation path
    const pathValidation = validatePath(inputPath, { mustExist: true });
    if (!pathValidation.valid || !pathValidation.path) {
      error(`Invalid installation path: ${pathValidation.error}`);
      process.exit(1);
    }

    installPath = pathValidation.path;
    info(`Path installation to: ${installPath}`);
  }

  const scopedSourceDirs = getSourceDirsForScope(installationScope);

  // Validate source directories exist
  const availableDirs = scopedSourceDirs.filter(dir => existsSync(join(sourceDir, dir)));

  if (availableDirs.length === 0) {
    error('No source directories found to install.');
    error(`Expected directories in: ${sourceDir}`);
    process.exit(1);
  }

  console.log('');
  info(`Found ${availableDirs.length} directories to install: ${availableDirs.join(', ')}`);
  info(`Installation scope: ${installationScope === 'codex' ? 'codex-only' : 'all'}`);

  // Show what will be installed including .codex subdirectories
  if (availableDirs.includes('.codex')) {
    const codexPath = join(sourceDir, '.codex');

    // Show prompts info
    const promptsPath = join(codexPath, 'prompts');
    if (existsSync(promptsPath)) {
      const promptFiles = readdirSync(promptsPath, { recursive: true }).filter(f =>
        statSync(join(promptsPath, f.toString())).isFile()
      );
      info(`  └─ .codex/prompts: ${promptFiles.length} files`);
    }

    // Show agents info
    const agentsPath = join(codexPath, 'agents');
    if (existsSync(agentsPath)) {
      const agentFiles = readdirSync(agentsPath).filter(f => f.endsWith('.md'));
      info(`  └─ .codex/agents: ${agentFiles.length} agent definitions`);
    }

    // Show skills info
    const skillsPath = join(codexPath, 'skills');
    if (existsSync(skillsPath)) {
      const skillDirs = readdirSync(skillsPath).filter(f =>
        statSync(join(skillsPath, f)).isDirectory()
      );
      info(`  └─ .codex/skills: ${skillDirs.length} skills`);
    }
  }

  divider();

  // Check for existing installation manifest
  const existingManifest = findManifest(installPath, mode);
  let cleanStats = { removed: 0, skipped: 0 };

  if (existingManifest) {
    // Has manifest - clean based on manifest records
    warning('Existing installation found at this location');
    info(`  Files in manifest: ${existingManifest.files?.length || 0}`);
    info(`  Installed: ${new Date(existingManifest.installation_date).toLocaleDateString()}`);

    const { backup } = await inquirer.prompt([{
      type: 'confirm',
      name: 'backup',
      message: 'Create backup before reinstalling?',
      default: true
    }]);

    if (backup) {
      await createBackup(existingManifest);
    }

    // Clean based on manifest records
    console.log('');
    const cleanSpinner = createSpinner('Cleaning previous installation...').start();

    try {
      cleanSpinner.text = 'Removing manifest files...';
      cleanStats = await cleanManifestFiles(existingManifest, cleanSpinner);

      if (cleanStats.removed > 0 || cleanStats.skipped > 0) {
        cleanSpinner.succeed(`Cleanup: ${cleanStats.removed} files removed, ${cleanStats.skipped} settings preserved`);
      } else {
        cleanSpinner.succeed('Cleanup: no files to remove');
      }
    } catch (err) {
      const errMsg = err as Error;
      cleanSpinner.warn(`Cleanup warning: ${errMsg.message}`);
    }
  } else {
    // No manifest - first install or manual install, just overwrite
    const existingDirs = scopedSourceDirs.filter(dir => existsSync(join(installPath, dir)));
    if (existingDirs.length > 0) {
      info('No installation manifest found, files will be overwritten');
      info(`  Existing directories: ${existingDirs.join(', ')}`);
    }
  }

  // Scan for disabled items before installation
  const globalPath = mode === 'Path' ? homedir() : undefined;
  const disabledItems = scanDisabledItems(installPath, globalPath);
  const totalDisabled = disabledItems.skills.length + disabledItems.commands.length;
  if (totalDisabled > 0) {
    info(`Found ${totalDisabled} disabled items (${disabledItems.skills.length} skills, ${disabledItems.commands.length} commands)`);
  }

  // Create manifest
  const manifest = createManifest(mode, installPath, installationScope);

  // Perform installation
  console.log('');
  const spinner = createSpinner('Installing files...').start();

  let totalFiles = 0;
  let totalDirs = 0;
  let restoreStats = { skillsRestored: 0, commandsRestored: 0 };

  try {
    // For Path mode, install workflows to global first
    if (mode === 'Path' && installationScope === 'all') {
      const globalPath = homedir();
      for (const subdir of GLOBAL_SUBDIRS) {
        const srcWorkflows = join(sourceDir, '.claude', subdir);
        if (existsSync(srcWorkflows)) {
          const destWorkflows = join(globalPath, '.claude', subdir);
          spinner.text = `Installing ${subdir} to global...`;
          const { files, directories } = await copyDirectory(srcWorkflows, destWorkflows, manifest);
          totalFiles += files;
          totalDirs += directories;
        }
      }
    }

    for (const dir of availableDirs) {
      const srcPath = join(sourceDir, dir);

      // .ccw always installs to global ~/.ccw/ regardless of mode
      const destBase = (mode === 'Path' && dir === '.ccw') ? homedir() : installPath;
      const destPath = join(destBase, dir);

      spinner.text = `Installing ${dir}...`;

      // For Path mode on .claude, exclude global subdirs (they're already installed to global)
      const excludeDirs = (mode === 'Path' && dir === '.claude') ? GLOBAL_SUBDIRS : [];
      const { files, directories } = await copyDirectory(srcPath, destPath, manifest, excludeDirs);
      totalFiles += files;
      totalDirs += directories;
    }

    // Create version.json
    const versionPath = getVersionFilePath(installPath, availableDirs);
    if (versionPath && existsSync(dirname(versionPath))) {
      const versionData = {
        version: version,
        installedAt: new Date().toISOString(),
        mode: mode,
        scope: installationScope,
        installer: 'ccw'
      };
      writeFileSync(versionPath, JSON.stringify(versionData, null, 2), 'utf8');
      addFileEntry(manifest, versionPath);
      totalFiles++;
    }

    spinner.succeed('Installation complete!');

    // Restore disabled state for previously disabled items
    if (totalDisabled > 0) {
      restoreStats = restoreDisabledState(disabledItems, installPath, globalPath);
      const totalRestored = restoreStats.skillsRestored + restoreStats.commandsRestored;
      if (totalRestored > 0) {
        info(`Restored ${totalRestored} disabled items (${restoreStats.skillsRestored} skills, ${restoreStats.commandsRestored} commands)`);
      }
    }

  } catch (err) {
    spinner.fail('Installation failed');
    const errMsg = err as Error;
    error(errMsg.message);
    process.exit(1);
  }

  // Save manifest
  const manifestPath = saveManifest(manifest);

  // Show summary
  console.log('');
  const summaryLines = [
    chalk.green.bold('✓ Installation Successful'),
    '',
    chalk.white(`Mode: ${chalk.cyan(mode)}`),
    chalk.white(`Scope: ${chalk.cyan(installationScope === 'codex' ? 'codex-only' : 'all')}`),
    chalk.white(`Path: ${chalk.cyan(installPath)}`),
    chalk.white(`Version: ${chalk.cyan(version)}`),
    '',
    chalk.gray(`Files installed: ${totalFiles}`),
    chalk.gray(`Directories created: ${totalDirs}`)
  ];

  // Add cleanup stats if any files were processed
  if (cleanStats.removed > 0 || cleanStats.skipped > 0) {
    summaryLines.push(chalk.gray(`Old files removed: ${cleanStats.removed}`));
    if (cleanStats.skipped > 0) {
      summaryLines.push(chalk.gray(`Settings preserved: ${cleanStats.skipped}`));
    }
  }

  // Add restore stats if any disabled items were restored
  if (restoreStats.skillsRestored > 0 || restoreStats.commandsRestored > 0) {
    const totalRestored = restoreStats.skillsRestored + restoreStats.commandsRestored;
    summaryLines.push(chalk.gray(`Disabled state restored: ${totalRestored} items`));
  }

  summaryLines.push('');
  summaryLines.push(chalk.gray(`Manifest: ${basename(manifestPath)}`));

  // Add codex components info if installed
  if (availableDirs.includes('.codex')) {
    const codexPath = join(installPath, '.codex');
    summaryLines.push('');
    summaryLines.push(chalk.cyan('Codex Components:'));

    // Prompts
    const promptsPath = join(codexPath, 'prompts');
    if (existsSync(promptsPath)) {
      summaryLines.push(chalk.gray(`  ✓ prompts: ${promptsPath}`));
    }

    // Agents
    const agentsPath = join(codexPath, 'agents');
    if (existsSync(agentsPath)) {
      const agentCount = readdirSync(agentsPath).filter(f => f.endsWith('.md')).length;
      summaryLines.push(chalk.gray(`  ✓ agents: ${agentCount} definitions`));
    }

    // Skills
    const skillsPath = join(codexPath, 'skills');
    if (existsSync(skillsPath)) {
      const skillCount = readdirSync(skillsPath).filter(f =>
        statSync(join(skillsPath, f)).isDirectory()
      ).length;
      summaryLines.push(chalk.gray(`  ✓ skills: ${skillCount} skills`));
    }
  }

  summaryBox({
    title: ' Installation Summary ',
    lines: summaryLines,
    borderColor: 'green'
  });

  // Install Git Bash fix on Windows
  if (platform() === 'win32') {
    console.log('');
    const { installFix } = await inquirer.prompt([{
      type: 'confirm',
      name: 'installFix',
      message: 'Install Git Bash multi-line prompt fix? (recommended for Git Bash users)',
      default: false
    }]);

    if (installFix) {
      // Let user select shell config file
      const selectedConfig = await selectShellConfig();
      const fixResult = await installGitBashFix(selectedConfig);

      if (fixResult.installed) {
        info(`Git Bash fix: ${fixResult.message}`);
        info(`  Run: source ${selectedConfig}  (to apply immediately)`);
      } else {
        warning(`Git Bash fix skipped: ${fixResult.message}`);
      }
    }
  }

  // Show next steps
  console.log('');
  info('Next steps:');
  console.log(chalk.gray('  1. Restart Claude Code or your IDE'));
  console.log(chalk.gray('  2. Run: ccw view - to open the workflow dashboard'));
  console.log(chalk.gray('  3. Run: ccw uninstall - to remove this installation'));
  console.log('');
}

/**
 * Interactive mode selection
 * @returns {Promise<string>} - Selected mode
 */
async function selectMode(): Promise<string> {
  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'Select installation mode:',
    choices: [
      {
        name: `${chalk.cyan('Global')} - Install to home directory (recommended)`,
        value: 'Global'
      },
      {
        name: `${chalk.yellow('Path')} - Install to specific project path`,
        value: 'Path'
      }
    ]
  }]);

  return mode;
}

/**
 * Interactive path selection
 * @returns {Promise<string>} - Selected path
 */
async function selectPath(): Promise<string> {
  const { path } = await inquirer.prompt([{
    type: 'input',
    name: 'path',
    message: 'Enter installation path:',
    default: process.cwd(),
    validate: (input: string) => {
      if (!input) return 'Path is required';
      if (!existsSync(input)) {
        return `Path does not exist: ${input}`;
      }
      return true;
    }
  }]);

  return path;
}

/**
 * Interactive shell configuration file selection
 * @returns {Promise<string>} - Selected config file path
 */
async function selectShellConfig(): Promise<string> {
  const home = homedir();

  // Build choices with status indicators
  const choices = SHELL_CONFIG_FILES.map(config => {
    const fullPath = join(home, config.name);
    const exists = existsSync(fullPath);
    const status = exists ? chalk.green('exists') : chalk.gray('will be created');
    const recommended = config.name === '.bashrc' ? chalk.yellow(' (recommended)') : '';

    return {
      name: `${chalk.cyan(config.name)}${recommended} - ${config.description} [${status}]`,
      value: fullPath
    };
  });

  // Add custom path option
  choices.push({
    name: chalk.yellow('Custom path...'),
    value: 'custom'
  });

  const { configPath } = await inquirer.prompt([{
    type: 'list',
    name: 'configPath',
    message: 'Select shell configuration file to install Git Bash fix:',
    choices
  }]);

  if (configPath === 'custom') {
    const { customPath } = await inquirer.prompt([{
      type: 'input',
      name: 'customPath',
      message: 'Enter custom shell config path:',
      default: join(home, '.bashrc'),
      validate: (input: string) => {
        if (!input) return 'Path is required';
        return true;
      }
    }]);
    return customPath;
  }

  return configPath;
}

/**
 * Clean files based on manifest record
 * Only removes files that were installed by the previous installation
 * @param manifest - Existing manifest with file records
 * @param spinner - Spinner for progress display
 * @returns Count of removed files and skipped files
 */
async function cleanManifestFiles(
  manifest: any,
  spinner: Ora
): Promise<{ removed: number; skipped: number }> {
  let removed = 0;
  let skipped = 0;

  const files = manifest.files || [];
  const directories = manifest.directories || [];

  // Remove files in reverse order (process deepest paths first)
  const sortedFiles = [...files].sort((a: any, b: any) => b.path.length - a.path.length);

  for (const fileEntry of sortedFiles) {
    const filePath = fileEntry.path;
    const fileName = basename(filePath);

    // Skip excluded files (user settings)
    if (EXCLUDED_FILES.includes(fileName)) {
      skipped++;
      continue;
    }

    try {
      if (existsSync(filePath)) {
        spinner.text = `Removing: ${fileName}`;
        unlinkSync(filePath);
        removed++;
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Clean up empty directories (deepest first)
  const sortedDirs = [...directories].sort((a: any, b: any) => b.path.length - a.path.length);

  for (const dirEntry of sortedDirs) {
    const dirPath = dirEntry.path;
    try {
      if (existsSync(dirPath)) {
        const contents = readdirSync(dirPath);
        if (contents.length === 0) {
          rmdirSync(dirPath);
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  return { removed, skipped };
}

/**
 * Create backup of files recorded in manifest
 * @param manifest - Existing manifest with file records
 */
async function createBackup(manifest: any): Promise<void> {
  const spinner = createSpinner('Creating backup...').start();

  try {
    const installPath = manifest.installation_path;
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0];
    const backupDir = join(installPath, `.claude-backup-${timestamp}`);

    const files = manifest.files || [];
    let backedUp = 0;

    for (const fileEntry of files) {
      const filePath = fileEntry.path;

      if (!existsSync(filePath)) continue;

      // Calculate relative path from install path
      const relativePath = filePath.replace(installPath, '').replace(/^[\\/]/, '');
      const backupPath = join(backupDir, relativePath);

      // Create directory structure
      const backupFileDir = dirname(backupPath);
      if (!existsSync(backupFileDir)) {
        mkdirSync(backupFileDir, { recursive: true });
      }

      // Copy file
      try {
        spinner.text = `Backing up: ${basename(filePath)}`;
        copyFileSync(filePath, backupPath);
        backedUp++;
      } catch {
        // Ignore individual file errors
      }
    }

    if (backedUp > 0) {
      spinner.succeed(`Backup created: ${backupDir} (${backedUp} files)`);
    } else {
      spinner.info('No files to backup');
      // Remove empty backup dir
      try { rmdirSync(backupDir); } catch { /* ignore */ }
    }
  } catch (err) {
    const errMsg = err as Error;
    spinner.warn(`Backup failed: ${errMsg.message}`);
  }
}

/**
 * Copy directory recursively
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @param {Object} manifest - Manifest to track files (optional)
 * @param {string[]} excludeDirs - Directory names to exclude (optional)
 * @returns {Object} - Count of files and directories
 */
async function copyDirectory(
  src: string,
  dest: string,
  manifest: any = null,
  excludeDirs: string[] = [],
  excludeFiles: string[] = EXCLUDED_FILES
): Promise<CopyResult> {
  let files = 0;
  let directories = 0;

  // Create destination directory
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
    directories++;
    if (manifest) addDirectoryEntry(manifest, dest);
  }

  const entries = readdirSync(src);

  for (const entry of entries) {
    // Skip excluded directories
    if (excludeDirs.includes(entry)) {
      continue;
    }

    // Skip excluded files
    if (excludeFiles.includes(entry)) {
      continue;
    }

    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      const result = await copyDirectory(srcPath, destPath, manifest, [], excludeFiles);
      files += result.files;
      directories += result.directories;
    } else {
      copyFileSync(srcPath, destPath);
      files++;
      if (manifest) addFileEntry(manifest, destPath);
    }
  }

  return { files, directories };
}

/**
 * Check if running in Git Bash on Windows
 */
function isGitBashOnWindows(): boolean {
  if (platform() !== 'win32') return false;

  // Check for MSYSTEM env var (set by Git Bash)
  const msystem = process.env.MSYSTEM;
  if (msystem && ['MINGW64', 'MINGW32', 'MSYS'].includes(msystem)) {
    return true;
  }

  // Check for typical Git Bash shell path
  const shell = process.env.SHELL || '';
  if (shell.includes('bash') || shell.includes('sh')) {
    return true;
  }

  return false;
}

/**
 * Get the ccw.js path for Git Bash fix
 */
function getCcwJsPath(): string | null {
  try {
    const npmPrefix = execSync('npm config get prefix', { encoding: 'utf8' }).trim();
    const ccwJsPath = join(npmPrefix, 'node_modules', 'claude-code-workflow', 'ccw', 'bin', 'ccw.js');

    if (existsSync(ccwJsPath)) {
      return ccwJsPath;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate Git Bash fix content for .bashrc
 */
function generateGitBashFix(ccwJsPath: string): string {
  // Use Windows path format for node (works in Git Bash)
  const windowsPath = ccwJsPath.replace(/\//g, '/');

  return `
${GITBASH_FIX_START}
# Fix for multi-line prompt arguments in Git Bash + Windows
# npm's shell wrapper cannot handle multi-line quoted strings correctly
ccw() {
    node "${windowsPath}" "$@"
}
${GITBASH_FIX_END}
`;
}

/**
 * Install Git Bash fix to user's shell config
 * @param targetConfigPath - Optional target config file path. If not provided, auto-detects.
 * @returns true if fix was installed, false otherwise
 */
export async function installGitBashFix(targetConfigPath?: string): Promise<{ installed: boolean; message: string }> {
  // Only applicable on Windows
  if (platform() !== 'win32') {
    return { installed: false, message: 'Not Windows platform' };
  }

  const ccwJsPath = getCcwJsPath();
  if (!ccwJsPath) {
    return { installed: false, message: 'ccw not found in npm global modules' };
  }

  let targetConfig: string;

  if (targetConfigPath) {
    // Use provided path
    targetConfig = targetConfigPath;
  } else {
    // Auto-detect: find existing shell config file
    const home = homedir();
    const configFiles = [
      join(home, '.bashrc'),
      join(home, '.bash_profile'),
      join(home, '.profile')
    ];

    let foundConfig: string | null = null;
    for (const configFile of configFiles) {
      if (existsSync(configFile)) {
        foundConfig = configFile;
        break;
      }
    }

    // If no config exists, default to .bashrc
    targetConfig = foundConfig || join(home, '.bashrc');
  }

  // Check if fix already exists in target file
  if (existsSync(targetConfig)) {
    const content = readFileSync(targetConfig, 'utf8');
    if (content.includes(GITBASH_FIX_START)) {
      // Update existing fix
      const fixContent = generateGitBashFix(ccwJsPath);
      const regex = new RegExp(`${GITBASH_FIX_START}[\\s\\S]*?${GITBASH_FIX_END}`, 'g');
      const newContent = content.replace(regex, fixContent.trim());
      writeFileSync(targetConfig, newContent, 'utf8');
      return { installed: true, message: `Updated in ${basename(targetConfig)}` };
    }
  }

  // Append fix to config file (creates file if not exists)
  const fixContent = generateGitBashFix(ccwJsPath);
  appendFileSync(targetConfig, fixContent, 'utf8');

  return { installed: true, message: `Added to ${basename(targetConfig)}` };
}

/**
 * Remove Git Bash fix from user's shell config
 * @returns true if fix was removed, false otherwise
 */
export function removeGitBashFix(): { removed: boolean; message: string } {
  const home = homedir();
  // Check all supported shell config files
  const configFiles = SHELL_CONFIG_FILES.map(config => join(home, config.name));

  let removed = false;
  let targetFile = '';

  for (const configFile of configFiles) {
    if (!existsSync(configFile)) continue;

    const content = readFileSync(configFile, 'utf8');
    if (content.includes(GITBASH_FIX_START)) {
      // Remove the fix block
      const regex = new RegExp(`\\n?${GITBASH_FIX_START}[\\s\\S]*?${GITBASH_FIX_END}\\n?`, 'g');
      const newContent = content.replace(regex, '\n');
      writeFileSync(configFile, newContent, 'utf8');
      removed = true;
      targetFile = basename(configFile);
    }
  }

  if (removed) {
    return { removed: true, message: `Removed from ${targetFile}` };
  }
  return { removed: false, message: 'No fix found to remove' };
}

/**
 * Get package version
 * @returns {string} - Version string
 */
function getVersion(): string {
  try {
    // First try root package.json (parent of ccw)
    const rootPkgPath = join(getSourceDir(), 'package.json');
    if (existsSync(rootPkgPath)) {
      const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
      if (pkg.version) return pkg.version;
    }
    // Fallback to ccw package.json
    const pkgPath = join(getPackageRoot(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}
