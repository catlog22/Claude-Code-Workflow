/**
 * CodexLens Tool - Bridge between CCW and CodexLens Python package
 * Provides code indexing and semantic search via spawned Python process
 *
 * Features:
 * - Automatic venv bootstrap at ~/.codexlens/venv
 * - JSON protocol communication
 * - Symbol extraction and semantic search
 * - FTS5 full-text search
 */

import { z } from 'zod';
import type { ToolSchema, ToolResult } from '../types/tool.js';
import { spawn, execSync, exec } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { getSystemPython } from '../utils/python-utils.js';
import { EXEC_TIMEOUTS } from '../utils/exec-constants.js';

// Get directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CodexLens configuration
const CODEXLENS_DATA_DIR = join(homedir(), '.codexlens');
const CODEXLENS_VENV = join(CODEXLENS_DATA_DIR, 'venv');
const VENV_PYTHON =
  process.platform === 'win32'
    ? join(CODEXLENS_VENV, 'Scripts', 'python.exe')
    : join(CODEXLENS_VENV, 'bin', 'python');

// Bootstrap status cache
let bootstrapChecked = false;
let bootstrapReady = false;

// Venv status cache with TTL
interface VenvStatusCache {
  status: ReadyStatus;
  timestamp: number;
}
let venvStatusCache: VenvStatusCache | null = null;
const VENV_STATUS_TTL = 5 * 60 * 1000; // 5 minutes TTL

// Track running indexing process for cancellation
let currentIndexingProcess: ReturnType<typeof spawn> | null = null;
let currentIndexingAborted = false;

// Define Zod schema for validation
const ParamsSchema = z.object({
  action: z.enum([
    'init',
    'search',
    'search_files',
    'status',
    'symbol',
    'check',
    'update',
    'bootstrap',
  ]),
  path: z.string().optional(),
  query: z.string().optional(),
  mode: z.enum(['auto', 'text', 'semantic', 'exact', 'fuzzy', 'hybrid', 'vector', 'pure-vector']).default('auto'),
  format: z.enum(['json', 'text', 'pretty']).default('json'),
  languages: z.array(z.string()).optional(),
  limit: z.number().default(20),
  enrich: z.boolean().default(false),
  // Additional fields for internal functions
  file: z.string().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
  newPath: z.string().optional(),
  all: z.boolean().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

interface ReadyStatus {
  ready: boolean;
  error?: string;
  version?: string;
}

interface SemanticStatus {
  available: boolean;
  backend?: string;
  accelerator?: string;
  providers?: string[];
  litellmAvailable?: boolean;
  error?: string;
}

interface BootstrapResult {
  success: boolean;
  error?: string;
  message?: string;
}

interface ExecuteResult {
  success: boolean;
  output?: string;
  error?: string;
  message?: string;
  results?: unknown;
  files?: unknown;
  symbols?: unknown;
  status?: unknown;
  config?: unknown;
  cleanResult?: unknown;
  ready?: boolean;
  version?: string;
}

interface ExecuteOptions {
  timeout?: number;
  cwd?: string;
  onProgress?: (progress: ProgressInfo) => void;
}

interface ProgressInfo {
  stage: string;
  message: string;
  percent: number;
  filesProcessed?: number;
  totalFiles?: number;
}

/**
 * Clear venv status cache (call after install/uninstall operations)
 */
function clearVenvStatusCache(): void {
  venvStatusCache = null;
}

// Python detection functions imported from ../utils/python-utils.js

/**
 * Check if CodexLens venv exists and has required packages
 * @param force - Force refresh cache (default: false)
 * @returns Ready status
 */
async function checkVenvStatus(force = false): Promise<ReadyStatus> {
  // Use cached result if available and not expired
  if (!force && venvStatusCache && (Date.now() - venvStatusCache.timestamp < VENV_STATUS_TTL)) {
    return venvStatusCache.status;
  }

  // Check venv exists
  if (!existsSync(CODEXLENS_VENV)) {
    const result = { ready: false, error: 'Venv not found' };
    venvStatusCache = { status: result, timestamp: Date.now() };
    return result;
  }

  // Check python executable exists
  if (!existsSync(VENV_PYTHON)) {
    const result = { ready: false, error: 'Python executable not found in venv' };
    venvStatusCache = { status: result, timestamp: Date.now() };
    return result;
  }

  // Check codexlens is importable
  return new Promise((resolve) => {
    const child = spawn(VENV_PYTHON, ['-c', 'import codexlens; print(codexlens.__version__)'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
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
      let result: ReadyStatus;
      if (code === 0) {
        result = { ready: true, version: stdout.trim() };
      } else {
        result = { ready: false, error: `CodexLens not installed: ${stderr}` };
      }
      // Cache the result
      venvStatusCache = { status: result, timestamp: Date.now() };
      resolve(result);
    });

    child.on('error', (err) => {
      const result = { ready: false, error: `Failed to check venv: ${err.message}` };
      venvStatusCache = { status: result, timestamp: Date.now() };
      resolve(result);
    });
  });
}

/**
 * Check if semantic search dependencies are installed
 * @returns Semantic status
 */
async function checkSemanticStatus(): Promise<SemanticStatus> {
  // First check if CodexLens is installed
  const venvStatus = await checkVenvStatus();
  if (!venvStatus.ready) {
    return { available: false, error: 'CodexLens not installed' };
  }

  // Check semantic module availability and accelerator info
  return new Promise((resolve) => {
    const checkCode = `
import sys
import json
try:
    import codexlens.semantic as semantic
    SEMANTIC_AVAILABLE = bool(getattr(semantic, "SEMANTIC_AVAILABLE", False))
    SEMANTIC_BACKEND = getattr(semantic, "SEMANTIC_BACKEND", None)
    LITELLM_AVAILABLE = bool(getattr(semantic, "LITELLM_AVAILABLE", False))
    result = {
        "available": SEMANTIC_AVAILABLE,
        "backend": SEMANTIC_BACKEND if SEMANTIC_AVAILABLE else None,
        "litellm_available": LITELLM_AVAILABLE,
    }

    # Get ONNX providers for accelerator info
    try:
        import onnxruntime
        providers = onnxruntime.get_available_providers()
        result["providers"] = providers

        # Determine accelerator type
        if "CUDAExecutionProvider" in providers or "TensorrtExecutionProvider" in providers:
            result["accelerator"] = "CUDA"
        elif "DmlExecutionProvider" in providers:
            result["accelerator"] = "DirectML"
        elif "CoreMLExecutionProvider" in providers:
            result["accelerator"] = "CoreML"
        elif "ROCMExecutionProvider" in providers:
            result["accelerator"] = "ROCm"
        else:
            result["accelerator"] = "CPU"
    except:
        result["providers"] = []
        result["accelerator"] = "CPU"

    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"available": False, "error": str(e)}))
`;
    const child = spawn(VENV_PYTHON, ['-c', checkCode], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
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
      const output = stdout.trim();
      try {
        const result = JSON.parse(output);
        resolve({
          available: result.available || false,
          backend: result.backend,
          accelerator: result.accelerator || 'CPU',
          providers: result.providers || [],
          litellmAvailable: result.litellm_available || false,
          error: result.error
        });
      } catch {
        resolve({ available: false, error: output || stderr || 'Unknown error' });
      }
    });

    child.on('error', (err) => {
      resolve({ available: false, error: `Check failed: ${err.message}` });
    });
  });
}

/**
 * Ensure LiteLLM embedder dependencies are available in the CodexLens venv.
 * Installs ccw-litellm into the venv if needed.
 */
async function ensureLiteLLMEmbedderReady(): Promise<BootstrapResult> {
  // Ensure CodexLens venv exists and CodexLens is installed.
  const readyStatus = await ensureReady();
  if (!readyStatus.ready) {
    return { success: false, error: readyStatus.error || 'CodexLens not ready' };
  }

  // Check if ccw_litellm can be imported
  const importStatus = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const child = spawn(VENV_PYTHON, ['-c', 'import ccw_litellm; print("OK")'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ ok: code === 0, error: stderr.trim() || undefined });
    });

    child.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
  });

  if (importStatus.ok) {
    return { success: true };
  }

  const pipPath =
    process.platform === 'win32'
      ? join(CODEXLENS_VENV, 'Scripts', 'pip.exe')
      : join(CODEXLENS_VENV, 'bin', 'pip');

  try {
    console.log('[CodexLens] Installing ccw-litellm for LiteLLM embedding backend...');

    const possiblePaths = [
      join(process.cwd(), 'ccw-litellm'),
      join(__dirname, '..', '..', '..', 'ccw-litellm'), // ccw/src/tools -> project root
      join(homedir(), 'ccw-litellm'),
    ];

    let installed = false;
    for (const localPath of possiblePaths) {
      if (existsSync(join(localPath, 'pyproject.toml'))) {
        console.log(`[CodexLens] Installing ccw-litellm from local path: ${localPath}`);
        execSync(`"${pipPath}" install -e "${localPath}"`, { stdio: 'inherit', timeout: EXEC_TIMEOUTS.PACKAGE_INSTALL });
        installed = true;
        break;
      }
    }

    if (!installed) {
      console.log('[CodexLens] Installing ccw-litellm from PyPI...');
      execSync(`"${pipPath}" install ccw-litellm`, { stdio: 'inherit', timeout: EXEC_TIMEOUTS.PACKAGE_INSTALL });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to install ccw-litellm: ${(err as Error).message}` };
  }
}

/**
 * GPU acceleration mode for semantic search
 */
type GpuMode = 'cpu' | 'cuda' | 'directml';

/**
 * Python environment info for compatibility checks
 */
interface PythonEnvInfo {
  version: string;        // e.g., "3.11.5"
  majorMinor: string;     // e.g., "3.11"
  architecture: number;   // 32 or 64
  compatible: boolean;    // true if 64-bit and Python 3.8-3.12
  error?: string;
}

/**
 * Check Python environment in venv for DirectML compatibility
 * DirectML requires: 64-bit Python, version 3.8-3.12
 */
async function checkPythonEnvForDirectML(): Promise<PythonEnvInfo> {
  const pythonPath =
    process.platform === 'win32'
      ? join(CODEXLENS_VENV, 'Scripts', 'python.exe')
      : join(CODEXLENS_VENV, 'bin', 'python');

  if (!existsSync(pythonPath)) {
    return { version: '', majorMinor: '', architecture: 0, compatible: false, error: 'Python not found in venv' };
  }

  try {
    // Get Python version and architecture in one call
    // Use % formatting instead of f-string to avoid Windows shell escaping issues with curly braces
    const checkScript = `import sys, struct; print('%d.%d.%d|%d' % (sys.version_info.major, sys.version_info.minor, sys.version_info.micro, struct.calcsize('P') * 8))`;
    const result = execSync(`"${pythonPath}" -c "${checkScript}"`, { encoding: 'utf-8', timeout: 10000 }).trim();
    const [version, archStr] = result.split('|');
    const architecture = parseInt(archStr, 10);
    const [major, minor] = version.split('.').map(Number);
    const majorMinor = `${major}.${minor}`;

    // DirectML wheels available for Python 3.8-3.12, 64-bit only
    const versionCompatible = major === 3 && minor >= 8 && minor <= 12;
    const archCompatible = architecture === 64;
    const compatible = versionCompatible && archCompatible;

    let error: string | undefined;
    if (!archCompatible) {
      error = `Python is ${architecture}-bit. onnxruntime-directml requires 64-bit Python. Please reinstall Python as 64-bit.`;
    } else if (!versionCompatible) {
      error = `Python ${majorMinor} is not supported. onnxruntime-directml requires Python 3.8-3.12.`;
    }

    return { version, majorMinor, architecture, compatible, error };
  } catch (e) {
    return { version: '', majorMinor: '', architecture: 0, compatible: false, error: `Failed to check Python: ${(e as Error).message}` };
  }
}

/**
 * Detect available GPU acceleration
 * @returns Detected GPU mode and info
 */
async function detectGpuSupport(): Promise<{ mode: GpuMode; available: GpuMode[]; info: string; pythonEnv?: PythonEnvInfo }> {
  const available: GpuMode[] = ['cpu'];
  let detectedInfo = 'CPU only';

  // Check for NVIDIA GPU (CUDA)
  try {
    if (process.platform === 'win32') {
      execSync('nvidia-smi', { stdio: 'pipe', timeout: EXEC_TIMEOUTS.SYSTEM_INFO });
      available.push('cuda');
      detectedInfo = 'NVIDIA GPU detected (CUDA available)';
    } else {
      execSync('which nvidia-smi', { stdio: 'pipe', timeout: EXEC_TIMEOUTS.SYSTEM_INFO });
      available.push('cuda');
      detectedInfo = 'NVIDIA GPU detected (CUDA available)';
    }
  } catch {
    // NVIDIA not available
  }

  // On Windows, DirectML requires 64-bit Python 3.8-3.12
  let pythonEnv: PythonEnvInfo | undefined;
  if (process.platform === 'win32') {
    pythonEnv = await checkPythonEnvForDirectML();
    if (pythonEnv.compatible) {
      available.push('directml');
      if (available.includes('cuda')) {
        detectedInfo = 'NVIDIA GPU detected (CUDA & DirectML available)';
      } else {
        detectedInfo = 'DirectML available (Windows GPU acceleration)';
      }
    } else if (pythonEnv.error) {
      // DirectML not available due to Python environment
      console.log(`[CodexLens] DirectML unavailable: ${pythonEnv.error}`);
    }
  }

  // Recommend best available mode
  let recommendedMode: GpuMode = 'cpu';
  if (process.platform === 'win32' && available.includes('directml')) {
    recommendedMode = 'directml'; // DirectML is easier on Windows (no CUDA toolkit needed)
  } else if (available.includes('cuda')) {
    recommendedMode = 'cuda';
  }

  return { mode: recommendedMode, available, info: detectedInfo, pythonEnv };
}

/**
 * Install semantic search dependencies with optional GPU acceleration
 * @param gpuMode - GPU acceleration mode: 'cpu', 'cuda', or 'directml'
 * @returns Bootstrap result
 */
async function installSemantic(gpuMode: GpuMode = 'cpu'): Promise<BootstrapResult> {
  // First ensure CodexLens is installed
  const venvStatus = await checkVenvStatus();
  if (!venvStatus.ready) {
    return { success: false, error: 'CodexLens not installed. Install CodexLens first.' };
  }

  // Check Python environment compatibility for DirectML
  if (gpuMode === 'directml') {
    const pythonEnv = await checkPythonEnvForDirectML();
    if (!pythonEnv.compatible) {
      const errorDetails = pythonEnv.error || 'Unknown compatibility issue';
      return {
        success: false,
        error: `DirectML installation failed: ${errorDetails}\n\nTo fix this:\n1. Uninstall current Python\n2. Install 64-bit Python 3.10, 3.11, or 3.12 from python.org\n3. Delete ~/.codexlens/venv folder\n4. Reinstall CodexLens`
      };
    }
    console.log(`[CodexLens] Python ${pythonEnv.version} (${pythonEnv.architecture}-bit) - DirectML compatible`);
  }

  const pipPath =
    process.platform === 'win32'
      ? join(CODEXLENS_VENV, 'Scripts', 'pip.exe')
      : join(CODEXLENS_VENV, 'bin', 'pip');

  // IMPORTANT: Uninstall all onnxruntime variants first to prevent conflicts
  // Having multiple onnxruntime packages causes provider detection issues
  const onnxVariants = ['onnxruntime', 'onnxruntime-gpu', 'onnxruntime-directml'];
  console.log(`[CodexLens] Cleaning up existing ONNX Runtime packages...`);

  for (const pkg of onnxVariants) {
    try {
      execSync(`"${pipPath}" uninstall ${pkg} -y`, { stdio: 'pipe', timeout: EXEC_TIMEOUTS.PACKAGE_INSTALL });
      console.log(`[CodexLens] Removed ${pkg}`);
    } catch {
      // Package not installed, ignore
    }
  }

  // Build package list based on GPU mode
  const packages = ['numpy>=1.24', 'fastembed>=0.5', 'hnswlib>=0.8.0'];

  let modeDescription = 'CPU (ONNX Runtime)';
  let onnxPackage = 'onnxruntime>=1.18.0'; // Default CPU

  if (gpuMode === 'cuda') {
    onnxPackage = 'onnxruntime-gpu>=1.18.0';
    modeDescription = 'NVIDIA CUDA GPU acceleration';
  } else if (gpuMode === 'directml') {
    onnxPackage = 'onnxruntime-directml>=1.18.0';
    modeDescription = 'Windows DirectML GPU acceleration';
  }

  return new Promise((resolve) => {
    console.log(`[CodexLens] Installing semantic search dependencies...`);
    console.log(`[CodexLens] Mode: ${modeDescription}`);
    console.log(`[CodexLens] ONNX Runtime: ${onnxPackage}`);
    console.log(`[CodexLens] Packages: ${packages.join(', ')}`);

    // Install ONNX Runtime first with force-reinstall to ensure clean state
    const installOnnx = spawn(pipPath, ['install', '--force-reinstall', onnxPackage], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600000, // 10 minutes for GPU packages
    });

    let onnxStdout = '';
    let onnxStderr = '';

    installOnnx.stdout.on('data', (data) => {
      onnxStdout += data.toString();
      const line = data.toString().trim();
      if (line.includes('Downloading') || line.includes('Installing')) {
        console.log(`[CodexLens] ${line}`);
      }
    });

    installOnnx.stderr.on('data', (data) => {
      onnxStderr += data.toString();
    });

    installOnnx.on('close', (onnxCode) => {
      if (onnxCode !== 0) {
        resolve({ success: false, error: `Failed to install ${onnxPackage}: ${onnxStderr || onnxStdout}` });
        return;
      }

      console.log(`[CodexLens] ${onnxPackage} installed successfully`);

      // Now install remaining packages
      const child = spawn(pipPath, ['install', ...packages], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        const line = data.toString().trim();
        if (line.includes('Downloading') || line.includes('Installing') || line.includes('Collecting')) {
          console.log(`[CodexLens] ${line}`);
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          // IMPORTANT: fastembed installs onnxruntime (CPU) as dependency, which conflicts
          // with onnxruntime-directml/gpu. Reinstall the GPU version to ensure it takes precedence.
          if (gpuMode !== 'cpu') {
            try {
              console.log(`[CodexLens] Reinstalling ${onnxPackage} to ensure GPU provider works...`);
              execSync(`"${pipPath}" install --force-reinstall ${onnxPackage}`, { stdio: 'pipe', timeout: EXEC_TIMEOUTS.PACKAGE_INSTALL });
              console.log(`[CodexLens] ${onnxPackage} reinstalled successfully`);
            } catch (e) {
              console.warn(`[CodexLens] Warning: Failed to reinstall ${onnxPackage}: ${(e as Error).message}`);
            }
          }
          console.log(`[CodexLens] Semantic dependencies installed successfully (${gpuMode} mode)`);
          resolve({ success: true, message: `Installed with ${modeDescription}` });
        } else {
          resolve({ success: false, error: `Installation failed: ${stderr || stdout}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: `Failed to run pip: ${err.message}` });
      });
    });

    installOnnx.on('error', (err) => {
      resolve({ success: false, error: `Failed to install ONNX Runtime: ${err.message}` });
    });
  });
}

/**
 * Bootstrap CodexLens venv with required packages
 * @returns Bootstrap result
 */
async function bootstrapVenv(): Promise<BootstrapResult> {
  // Ensure data directory exists
  if (!existsSync(CODEXLENS_DATA_DIR)) {
    mkdirSync(CODEXLENS_DATA_DIR, { recursive: true });
  }

  // Create venv if not exists
  if (!existsSync(CODEXLENS_VENV)) {
    try {
      console.log('[CodexLens] Creating virtual environment...');
      const pythonCmd = getSystemPython();
      execSync(`${pythonCmd} -m venv "${CODEXLENS_VENV}"`, { stdio: 'inherit', timeout: EXEC_TIMEOUTS.PROCESS_SPAWN });
    } catch (err) {
      return { success: false, error: `Failed to create venv: ${(err as Error).message}` };
    }
  }

  // Install codexlens with semantic extras
  try {
    console.log('[CodexLens] Installing codexlens package...');
    const pipPath =
      process.platform === 'win32'
        ? join(CODEXLENS_VENV, 'Scripts', 'pip.exe')
        : join(CODEXLENS_VENV, 'bin', 'pip');

    // Try multiple local paths, then fall back to PyPI
    const possiblePaths = [
      join(process.cwd(), 'codex-lens'),
      join(__dirname, '..', '..', '..', 'codex-lens'), // ccw/src/tools -> project root
      join(homedir(), 'codex-lens'),
    ];

    let installed = false;
    for (const localPath of possiblePaths) {
      if (existsSync(join(localPath, 'pyproject.toml'))) {
        console.log(`[CodexLens] Installing from local path: ${localPath}`);
        execSync(`"${pipPath}" install -e "${localPath}"`, { stdio: 'inherit', timeout: EXEC_TIMEOUTS.PACKAGE_INSTALL });
        installed = true;
        break;
      }
    }

    if (!installed) {
      console.log('[CodexLens] Installing from PyPI...');
      execSync(`"${pipPath}" install codexlens`, { stdio: 'inherit', timeout: EXEC_TIMEOUTS.PACKAGE_INSTALL });
    }

    // Clear cache after successful installation
    clearVenvStatusCache();
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to install codexlens: ${(err as Error).message}` };
  }
}

/**
 * Ensure CodexLens is ready to use
 * @returns Ready status
 */
async function ensureReady(): Promise<ReadyStatus> {
  // Use cached result if already checked
  if (bootstrapChecked && bootstrapReady) {
    return { ready: true };
  }

  // Check current status
  const status = await checkVenvStatus();
  if (status.ready) {
    bootstrapChecked = true;
    bootstrapReady = true;
    return { ready: true, version: status.version };
  }

  // Attempt bootstrap
  const bootstrap = await bootstrapVenv();
  if (!bootstrap.success) {
    return { ready: false, error: bootstrap.error };
  }

  // Verify after bootstrap
  const recheck = await checkVenvStatus();
  bootstrapChecked = true;
  bootstrapReady = recheck.ready;

  return recheck;
}

/**
 * Parse progress info from CodexLens output
 * @param line - Output line to parse
 * @returns Progress info or null
 */
function parseProgressLine(line: string): ProgressInfo | null {
  // Parse file processing progress: "Processing file X/Y: path"
  const fileMatch = line.match(/Processing file (\d+)\/(\d+):\s*(.+)/i);
  if (fileMatch) {
    const current = parseInt(fileMatch[1], 10);
    const total = parseInt(fileMatch[2], 10);
    return {
      stage: 'indexing',
      message: `Processing ${fileMatch[3]}`,
      percent: Math.round((current / total) * 80) + 10, // 10-90%
      filesProcessed: current,
      totalFiles: total,
    };
  }

  // Parse stage messages
  if (line.includes('Discovering files')) {
    return { stage: 'discover', message: 'Discovering files...', percent: 5 };
  }
  if (line.includes('Building index')) {
    return { stage: 'build', message: 'Building index...', percent: 10 };
  }
  if (line.includes('Extracting symbols')) {
    return { stage: 'symbols', message: 'Extracting symbols...', percent: 50 };
  }
  if (line.includes('Generating embeddings') || line.includes('Creating embeddings')) {
    return { stage: 'embeddings', message: 'Generating embeddings...', percent: 70 };
  }
  // Note: "Finalizing index" and "Building ANN" are handled separately below
  // Only match generic "Complete" here (not "Finalizing" which has specific handlers)

  // Parse indexed count: "Indexed X files" - FTS complete, but embeddings may follow
  const indexedMatch = line.match(/Indexed (\d+) files/i);
  if (indexedMatch) {
    return {
      stage: 'fts_complete',  // Not 'complete' - embeddings generation may still be pending
      message: `Indexed ${indexedMatch[1]} files, generating embeddings...`,
      percent: 60,  // FTS done, embeddings starting
      filesProcessed: parseInt(indexedMatch[1], 10),
    };
  }

  // Parse embedding batch progress: "Batch X: N files, M chunks"
  const batchMatch = line.match(/Batch (\d+):\s*(\d+) files,\s*(\d+) chunks/i);
  if (batchMatch) {
    return {
      stage: 'embeddings',
      message: `Embedding batch ${batchMatch[1]}: ${batchMatch[3]} chunks`,
      percent: 70,  // Stay at 70% during embedding batches
    };
  }

  // Parse embedding progress with file count
  const embedProgressMatch = line.match(/Processing (\d+) files/i);
  if (embedProgressMatch && line.toLowerCase().includes('embed')) {
    return {
      stage: 'embeddings',
      message: `Processing ${embedProgressMatch[1]} files for embeddings`,
      percent: 75,
    };
  }

  // Parse finalizing ANN index
  if (line.includes('Finalizing index') || line.includes('Building ANN')) {
    return { stage: 'finalizing', message: 'Finalizing vector index...', percent: 90 };
  }

  // Parse embeddings complete message
  const embedCompleteMatch = line.match(/Embeddings complete:\s*(\d+)\s*chunks/i);
  if (embedCompleteMatch) {
    return {
      stage: 'embeddings_complete',
      message: `Embeddings complete: ${embedCompleteMatch[1]} chunks`,
      percent: 95,
    };
  }

  // Parse generic completion (but not "Embeddings complete" which is handled above)
  if (line.includes('Complete') && !line.toLowerCase().includes('embeddings complete')) {
    return { stage: 'complete', message: 'Complete', percent: 98 };
  }

  return null;
}

/**
 * Execute CodexLens CLI command with real-time progress updates
 * @param args - CLI arguments
 * @param options - Execution options
 * @returns Execution result
 */
async function executeCodexLens(args: string[], options: ExecuteOptions = {}): Promise<ExecuteResult> {
  const { timeout = 300000, cwd = process.cwd(), onProgress } = options; // Default 5 min

  // Ensure ready
  const readyStatus = await ensureReady();
  if (!readyStatus.ready) {
    return { success: false, error: readyStatus.error };
  }

  return new Promise((resolve) => {
    // SECURITY: Use spawn without shell to prevent command injection
    // Pass arguments directly - no manual quoting needed
    // spawn's cwd option handles drive changes correctly on Windows
    const spawnArgs = ['-m', 'codexlens', ...args];

    const child = spawn(VENV_PYTHON, spawnArgs, {
      cwd,
      shell: false, // CRITICAL: Prevent command injection
      timeout,
      // Ensure proper encoding on Windows
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    // Track indexing process for cancellation (only for init commands)
    const isIndexingCommand = args.includes('init');
    if (isIndexingCommand) {
      currentIndexingProcess = child;
      currentIndexingAborted = false;
    }

    let stdout = '';
    let stderr = '';
    let stdoutLineBuffer = '';
    let stderrLineBuffer = '';
    let timeoutHandle: NodeJS.Timeout | null = null;
    let resolved = false;

    // Helper to safely resolve only once
    const safeResolve = (result: ExecuteResult) => {
      if (resolved) return;
      resolved = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      // Clear indexing process tracking
      if (isIndexingCommand) {
        currentIndexingProcess = null;
      }
      resolve(result);
    };

    // Set up timeout handler
    if (timeout > 0) {
      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          child.kill('SIGTERM');
          // Give it a moment to die gracefully, then force kill
          setTimeout(() => {
            if (!resolved) {
              child.kill('SIGKILL');
            }
          }, 5000);
          safeResolve({ success: false, error: 'Command timed out' });
        }
      }, timeout);
    }

    // Process stdout line by line for real-time progress
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdoutLineBuffer += chunk;
      stdout += chunk;

      // Process complete lines
      const lines = stdoutLineBuffer.split('\n');
      stdoutLineBuffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && onProgress) {
          const progress = parseProgressLine(trimmedLine);
          if (progress) {
            onProgress(progress);
          }
        }
      }
    });

    // Collect stderr
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderrLineBuffer += chunk;
      stderr += chunk;

      // Also check stderr for progress (some tools output progress to stderr)
      const lines = stderrLineBuffer.split('\n');
      stderrLineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && onProgress) {
          const progress = parseProgressLine(trimmedLine);
          if (progress) {
            onProgress(progress);
          }
        }
      }
    });

    // Handle process errors (spawn failure)
    child.on('error', (err) => {
      safeResolve({ success: false, error: `Failed to start process: ${err.message}` });
    });

    // Handle process completion
    child.on('close', (code) => {
      // Process any remaining buffered content
      if (stdoutLineBuffer.trim() && onProgress) {
        const progress = parseProgressLine(stdoutLineBuffer.trim());
        if (progress) {
          onProgress(progress);
        }
      }

      if (code === 0) {
        safeResolve({ success: true, output: stdout.trim() });
      } else {
        safeResolve({ success: false, error: stderr.trim() || `Process exited with code ${code}` });
      }
    });
  });
}

/**
 * Initialize CodexLens index for a directory
 * @param params - Parameters
 * @returns Execution result
 */
async function initIndex(params: Params): Promise<ExecuteResult> {
  const { path = '.', languages } = params;

  // Use 'index init' subcommand (new CLI structure)
  const args = ['index', 'init', path];
  if (languages && languages.length > 0) {
    args.push('--language', languages.join(','));
  }

  return executeCodexLens(args, { cwd: path });
}

/**
 * Search code using CodexLens
 * @param params - Search parameters
 * @returns Execution result
 */
async function searchCode(params: Params): Promise<ExecuteResult> {
  const { query, path = '.', limit = 20, mode = 'auto', enrich = false } = params;

  if (!query) {
    return { success: false, error: 'Query is required for search action' };
  }

  // Map MCP mode names to CLI mode names
  const modeMap: Record<string, string> = {
    'text': 'exact',
    'semantic': 'pure-vector',
    'auto': 'auto',
    'exact': 'exact',
    'fuzzy': 'fuzzy',
    'hybrid': 'hybrid',
    'vector': 'vector',
    'pure-vector': 'pure-vector',
  };

  const cliMode = modeMap[mode] || 'auto';
  const args = ['search', query, '--limit', limit.toString(), '--mode', cliMode, '--json'];

  if (enrich) {
    args.push('--enrich');
  }

  const result = await executeCodexLens(args, { cwd: path });

  if (result.success && result.output) {
    try {
      result.results = JSON.parse(result.output);
      delete result.output;
    } catch {
      // Keep raw output if JSON parse fails
    }
  }

  return result;
}

/**
 * Search code and return only file paths
 * @param params - Search parameters
 * @returns Execution result
 */
async function searchFiles(params: Params): Promise<ExecuteResult> {
  const { query, path = '.', limit = 20, mode = 'auto', enrich = false } = params;

  if (!query) {
    return { success: false, error: 'Query is required for search_files action' };
  }

  // Map MCP mode names to CLI mode names
  const modeMap: Record<string, string> = {
    'text': 'exact',
    'semantic': 'pure-vector',
    'auto': 'auto',
    'exact': 'exact',
    'fuzzy': 'fuzzy',
    'hybrid': 'hybrid',
    'vector': 'vector',
    'pure-vector': 'pure-vector',
  };

  const cliMode = modeMap[mode] || 'auto';
  const args = ['search', query, '--files-only', '--limit', limit.toString(), '--mode', cliMode, '--json'];

  if (enrich) {
    args.push('--enrich');
  }

  const result = await executeCodexLens(args, { cwd: path });

  if (result.success && result.output) {
    try {
      result.files = JSON.parse(result.output);
      delete result.output;
    } catch {
      // Keep raw output if JSON parse fails
    }
  }

  return result;
}

/**
 * Extract symbols from a file
 * @param params - Parameters
 * @returns Execution result
 */
async function extractSymbols(params: Params): Promise<ExecuteResult> {
  const { file } = params;

  if (!file) {
    return { success: false, error: 'File is required for symbol action' };
  }

  const args = ['symbol', file, '--json'];

  const result = await executeCodexLens(args);

  if (result.success && result.output) {
    try {
      result.symbols = JSON.parse(result.output);
      delete result.output;
    } catch {
      // Keep raw output if JSON parse fails
    }
  }

  return result;
}

/**
 * Get index status
 * @param params - Parameters
 * @returns Execution result
 */
async function getStatus(params: Params): Promise<ExecuteResult> {
  const { path = '.' } = params;

  const args = ['status', '--json'];

  const result = await executeCodexLens(args, { cwd: path });

  if (result.success && result.output) {
    try {
      result.status = JSON.parse(result.output);
      delete result.output;
    } catch {
      // Keep raw output if JSON parse fails
    }
  }

  return result;
}

/**
 * Show configuration
 * @param params - Parameters
 * @returns Execution result
 */
async function configShow(): Promise<ExecuteResult> {
  const args = ['config', 'show', '--json'];
  const result = await executeCodexLens(args);

  if (result.success && result.output) {
    try {
      result.config = JSON.parse(result.output);
      delete result.output;
    } catch {
      // Keep raw output if JSON parse fails
    }
  }

  return result;
}

/**
 * Set configuration value
 * @param params - Parameters
 * @returns Execution result
 */
async function configSet(params: Params): Promise<ExecuteResult> {
  const { key, value } = params;

  if (!key) {
    return { success: false, error: 'key is required for config_set action' };
  }
  if (!value) {
    return { success: false, error: 'value is required for config_set action' };
  }

  const args = ['config', 'set', key, value, '--json'];
  const result = await executeCodexLens(args);

  if (result.success && result.output) {
    try {
      result.config = JSON.parse(result.output);
      delete result.output;
    } catch {
      // Keep raw output if JSON parse fails
    }
  }

  return result;
}

/**
 * Migrate indexes to new location
 * @param params - Parameters
 * @returns Execution result
 */
async function configMigrate(params: Params): Promise<ExecuteResult> {
  const { newPath } = params;

  if (!newPath) {
    return { success: false, error: 'newPath is required for config_migrate action' };
  }

  const args = ['config', 'migrate', newPath, '--json'];
  const result = await executeCodexLens(args, { timeout: 300000 }); // 5 min for migration

  if (result.success && result.output) {
    try {
      result.config = JSON.parse(result.output);
      delete result.output;
    } catch {
      // Keep raw output if JSON parse fails
    }
  }

  return result;
}

/**
 * Clean indexes
 * @param params - Parameters
 * @returns Execution result
 */
async function cleanIndexes(params: Params): Promise<ExecuteResult> {
  const { path, all } = params;

  const args = ['clean'];

  if (all) {
    args.push('--all');
  } else if (path) {
    args.push(path);
  }

  args.push('--json');
  const result = await executeCodexLens(args);

  if (result.success && result.output) {
    try {
      result.cleanResult = JSON.parse(result.output);
      delete result.output;
    } catch {
      // Keep raw output if JSON parse fails
    }
  }

  return result;
}

// Tool schema for MCP
export const schema: ToolSchema = {
  name: 'codex_lens',
  description: `CodexLens - Code indexing and semantic search.

Usage:
  codex_lens(action="init", path=".")           # Index directory (auto-generates embeddings if available)
  codex_lens(action="search", query="func")     # Search code (auto: hybrid if embeddings exist, else exact)
  codex_lens(action="search", query="func", mode="hybrid")  # Force hybrid search
  codex_lens(action="search_files", query="x")  # Search, return paths only

Graph Enrichment:
  codex_lens(action="search", query="func", enrich=true)  # Enrich results with code relationships

Search Modes:
  - auto: Auto-detect (hybrid if embeddings exist, exact otherwise) [default]
  - exact/text: Exact FTS for code identifiers
  - hybrid: Exact + Fuzzy + Vector fusion (best results, requires embeddings)
  - fuzzy: Typo-tolerant search
  - vector: Semantic + keyword
  - pure-vector/semantic: Pure semantic search

Note: For advanced operations (config, status, clean), use CLI directly: codexlens --help`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'init',
          'search',
          'search_files',
          'status',
          'symbol',
          'check',
          'update',
          'bootstrap',
        ],
        description: 'Action to perform: init/update (index directory), search (search code), search_files (search files only), status (index status), symbol (extract symbols), check (check if ready), bootstrap (setup venv)',
      },
      path: {
        type: 'string',
        description: 'Target directory path (for init, search, search_files). Defaults to current directory.',
      },
      query: {
        type: 'string',
        description: 'Search query (required for search and search_files actions)',
      },
      mode: {
        type: 'string',
        enum: ['auto', 'text', 'semantic', 'exact', 'fuzzy', 'hybrid', 'vector', 'pure-vector'],
        description: 'Search mode: auto (default, hybrid if embeddings exist), text/exact (FTS), hybrid (best), fuzzy, vector, semantic/pure-vector',
        default: 'auto',
      },
      format: {
        type: 'string',
        enum: ['json', 'text', 'pretty'],
        description: 'Output format: json (default), text, pretty',
        default: 'json',
      },
      languages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Languages to index (for init action). Example: ["javascript", "typescript", "python"]',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of search results (for search and search_files actions)',
        default: 20,
      },
      enrich: {
        type: 'boolean',
        description: 'Enrich search results with code graph relationships (calls, imports)',
        default: false,
      },
    },
    required: ['action'],
  },
};

// Handler function
export async function handler(params: Record<string, unknown>): Promise<ToolResult<ExecuteResult>> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  const { action } = parsed.data;

  try {
    let result: ExecuteResult;

    switch (action) {
      case 'init':
        result = await initIndex(parsed.data);
        break;

      case 'search':
        result = await searchCode(parsed.data);
        break;

      case 'search_files':
        result = await searchFiles(parsed.data);
        break;

      case 'status':
        result = await getStatus(parsed.data);
        break;

      case 'symbol':
        result = await extractSymbols(parsed.data);
        break;

      case 'check':
        const checkStatus = await ensureReady();
        result = {
          success: checkStatus.ready,
          ready: checkStatus.ready,
          version: checkStatus.version,
          error: checkStatus.error,
        };
        break;

      case 'update':
        // Update is an alias for init (incremental update)
        result = await initIndex(parsed.data);
        break;

      case 'bootstrap':
        const bootstrapResult = await bootstrapVenv();
        result = {
          success: bootstrapResult.success,
          message: bootstrapResult.message,
          error: bootstrapResult.error,
        };
        break;

      default:
        throw new Error(
          `Unknown action: ${action}. Valid actions: init, search, search_files, status, symbol, check, update, bootstrap`
        );
    }

    return result.success ? { success: true, result } : { success: false, error: result.error };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Uninstall CodexLens by removing the venv directory
 * @returns Uninstall result
 */
async function uninstallCodexLens(): Promise<BootstrapResult> {
  try {
    // Check if venv exists
    if (!existsSync(CODEXLENS_VENV)) {
      return { success: false, error: 'CodexLens not installed (venv not found)' };
    }

    console.log('[CodexLens] Uninstalling CodexLens...');

    // On Windows, kill any Python processes that might be holding locks on .db files
    if (process.platform === 'win32') {
      console.log('[CodexLens] Killing any CodexLens Python processes...');
      const { execSync } = await import('child_process');
      try {
        // Kill any python processes from our venv that might be holding file locks
        execSync(`taskkill /F /IM python.exe /FI "MODULES eq sqlite3" 2>nul`, { stdio: 'ignore', timeout: EXEC_TIMEOUTS.SYSTEM_INFO });
      } catch {
        // Ignore errors - no processes to kill
      }
      // Small delay to allow file handles to be released
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`[CodexLens] Removing directory: ${CODEXLENS_DATA_DIR}`);

    // Remove the entire .codexlens directory with retry logic for locked files
    const fs = await import('fs');
    const path = await import('path');

    // Helper function to remove directory with retries (Windows EBUSY workaround)
    const removeWithRetry = async (dirPath: string, maxRetries = 3, delay = 1000): Promise<void> => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
          return;
        } catch (err: any) {
          if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'ENOTEMPTY') {
            console.log(`[CodexLens] Retry ${attempt}/${maxRetries} - file locked, waiting...`);
            if (attempt < maxRetries) {
              // On Windows, try to forcefully release file handles
              if (process.platform === 'win32' && err.path) {
                try {
                  const { execSync } = await import('child_process');
                  // Try to close handles on the specific file
                  execSync(`handle -c ${err.path} -y 2>nul`, { stdio: 'ignore', timeout: EXEC_TIMEOUTS.SYSTEM_INFO });
                } catch {
                  // handle.exe may not be installed, ignore
                }
              }
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
          throw err;
        }
      }
    };

    await removeWithRetry(CODEXLENS_DATA_DIR);

    // Reset bootstrap cache
    bootstrapChecked = false;
    bootstrapReady = false;
    clearVenvStatusCache();

    console.log('[CodexLens] CodexLens uninstalled successfully');
    return { success: true, message: 'CodexLens uninstalled successfully' };
  } catch (err) {
    const errorMsg = (err as Error).message;
    // Provide helpful message for Windows users with locked files
    if (errorMsg.includes('EBUSY') || errorMsg.includes('resource busy')) {
      return {
        success: false,
        error: `Failed to uninstall CodexLens: Files are locked. Please close any applications using CodexLens indexes (e.g., Claude Code, VS Code) and try again. Details: ${errorMsg}`
      };
    }
    return { success: false, error: `Failed to uninstall CodexLens: ${errorMsg}` };
  }
}

/**
 * Cancel the currently running indexing process
 * @returns Result indicating if cancellation was successful
 */
function cancelIndexing(): { success: boolean; message?: string; error?: string } {
  if (!currentIndexingProcess) {
    return { success: false, error: 'No indexing process is currently running' };
  }

  if (currentIndexingAborted) {
    return { success: false, error: 'Indexing process is already being cancelled' };
  }

  try {
    currentIndexingAborted = true;

    // Send SIGTERM first for graceful shutdown
    if (process.platform === 'win32') {
      // On Windows, use taskkill to kill the process tree
      const { execSync } = require('child_process');
      try {
        execSync(`taskkill /pid ${currentIndexingProcess.pid} /T /F`, { stdio: 'ignore', timeout: EXEC_TIMEOUTS.SYSTEM_INFO });
      } catch {
        // Process may have already exited
      }
    } else {
      // On Unix, send SIGTERM
      currentIndexingProcess.kill('SIGTERM');

      // Force kill after 3 seconds if still running
      setTimeout(() => {
        if (currentIndexingProcess) {
          currentIndexingProcess.kill('SIGKILL');
        }
      }, 3000);
    }

    console.log('[CodexLens] Indexing process cancelled');
    return { success: true, message: 'Indexing cancelled successfully' };
  } catch (err) {
    return { success: false, error: `Failed to cancel indexing: ${(err as Error).message}` };
  }
}

/**
 * Check if an indexing process is currently running
 * @returns True if indexing is in progress
 */
function isIndexingInProgress(): boolean {
  return currentIndexingProcess !== null && !currentIndexingAborted;
}

// Export types
export type { ProgressInfo, ExecuteOptions };

// Export for direct usage
export {
  ensureReady,
  executeCodexLens,
  checkVenvStatus,
  bootstrapVenv,
  checkSemanticStatus,
  ensureLiteLLMEmbedderReady,
  installSemantic,
  detectGpuSupport,
  uninstallCodexLens,
  cancelIndexing,
  isIndexingInProgress,
};

// Export Python path for direct spawn usage (e.g., watcher)
export function getVenvPythonPath(): string {
  return VENV_PYTHON;
}

export type { GpuMode, PythonEnvInfo };

// Backward-compatible export for tests
export const codexLensTool = {
  name: schema.name,
  description: schema.description,
  parameters: schema.inputSchema,
  execute: async (params: Record<string, unknown>) => {
    const result = await handler(params);
    // Return the result directly - tests expect {success: boolean, ...} format
    return result.success ? result.result : { success: false, error: result.error };
  }
};
