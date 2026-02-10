import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, RefreshCw, Settings2 } from 'lucide-react';
import WidgetCard from './WidgetCard';

interface CodexLensStatus {
  ready?: boolean;
  version?: string;
  pythonVersion?: string;
  venvPath?: string;
}

interface CodexLensConfigDraft {
  enabled: boolean;
  projectPath: string;
  indexDir: string;
  maxDepth: number;
}

const ConfigEditor = lazy(() => import('./codexlens/ConfigEditor'));

async function fetchCodexLensStatus(signal?: AbortSignal): Promise<CodexLensStatus> {
  // The CCW dashboard exposes CodexLens endpoints, but docs builds may not.
  const res = await fetch('/api/codexlens/status', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for /api/codexlens/status`);
  }

  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object') return {};

  const v = data as Partial<CodexLensStatus>;
  return {
    ready: typeof v.ready === 'boolean' ? v.ready : undefined,
    version: typeof v.version === 'string' ? v.version : undefined,
    pythonVersion: typeof v.pythonVersion === 'string' ? v.pythonVersion : undefined,
    venvPath: typeof v.venvPath === 'string' ? v.venvPath : undefined,
  };
}

/**
 * CodexLens - Docs-friendly CodexLens status widget (React Island).
 *
 * Hydration directive (Astro):
 * `<CodexLens client:visible />`
 *
 * Notes:
 * - This component does not depend on Zustand or dashboard-only hooks.
 * - It attempts to call `/api/codexlens/status` on the client and falls back
 *   to a static placeholder when the API is not available.
 */
export default function CodexLens() {
  const [status, setStatus] = useState<CodexLensStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [configDraft, setConfigDraft] = useState<CodexLensConfigDraft>({
    enabled: true,
    projectPath: '/workspace/my-project',
    indexDir: '~/.codexlens/indexes',
    maxDepth: 3,
  });
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const s = await fetchCodexLensStatus(signal);
      setStatus(s);
    } catch (err) {
      if (signal?.aborted) return;
      setStatus(null);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load CodexLens status.');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const badge = useMemo(() => {
    const ready = status?.ready;
    if (ready === true) return { label: 'ready', className: 'bg-green-500/10 text-green-700 border-green-600/20' };
    if (ready === false) return { label: 'not ready', className: 'bg-amber-500/10 text-amber-700 border-amber-600/20' };
    return { label: 'unknown', className: 'bg-muted text-muted-foreground border-border' };
  }, [status?.ready]);

  return (
    <WidgetCard
      title="CodexLens"
      description="Local semantic index + tooling status (via /api/codexlens/status)"
      icon={<Database className="w-4 h-4" />}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
          aria-label="Refresh CodexLens status"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      }
      collapsible
      defaultCollapsed={false}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
            onClick={() => setIsConfigOpen(v => !v)}
          >
            <Settings2 className="w-3.5 h-3.5" />
            {isConfigOpen ? 'Hide config' : 'Show config'}
          </button>

          <span className="text-[11px] text-muted-foreground font-mono">
            maxDepth={configDraft.maxDepth}
          </span>
        </div>
      }
    >
      {isLoading ? (
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-40" />
          <div className="h-3 bg-muted rounded w-64 mt-3" />
          <div className="h-3 bg-muted rounded w-56 mt-2" />
        </div>
      ) : null}

      {!isLoading && errorMessage ? (
        <div className="border border-border rounded-lg bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">CodexLens API unavailable</p>
              <p className="text-xs text-muted-foreground mt-1">
                This widget shows a static config preview in docs-only builds.
              </p>
              <p className="text-xs text-muted-foreground mt-2 font-mono break-words">{errorMessage}</p>
              <img
                className="mt-3 w-full max-w-[360px] border border-border rounded-md bg-background"
                src="/images/dashboard/api-unavailable.svg"
                alt="API unavailable placeholder"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </div>
      ) : null}

      {!isLoading && !errorMessage ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border border-border rounded-lg bg-background p-3">
            <p className="text-xs text-muted-foreground">Status</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={['text-[11px] px-2 py-0.5 rounded border', badge.className].join(' ')}>
                {badge.label}
              </span>
              <span className="text-xs text-muted-foreground">{status?.version ? `v${status.version}` : 'version n/a'}</span>
            </div>
          </div>

          <div className="border border-border rounded-lg bg-background p-3">
            <p className="text-xs text-muted-foreground">Environment</p>
            <p className="text-xs mt-1 font-mono text-foreground truncate" title={status?.venvPath || ''}>
              {status?.pythonVersion ? `python ${status.pythonVersion}` : 'python n/a'}
            </p>
            <p className="text-[11px] text-muted-foreground truncate" title={status?.venvPath || ''}>
              {status?.venvPath || 'venv path n/a'}
            </p>
          </div>
        </div>
      ) : null}

      {isConfigOpen ? (
        <div className="mt-4">
          <Suspense
            fallback={
              <div className="animate-pulse border border-border rounded-lg bg-background p-4">
                <div className="h-4 bg-muted rounded w-24" />
                <div className="h-3 bg-muted rounded w-64 mt-3" />
                <div className="h-3 bg-muted rounded w-56 mt-2" />
              </div>
            }
          >
            <ConfigEditor config={configDraft} onChange={setConfigDraft} />
          </Suspense>
        </div>
      ) : null}

      <div className="mt-4 text-[11px] text-muted-foreground">
        Tip: In the full dashboard, CodexLens controls are backed by persistent settings and server-side operations.
      </div>
    </WidgetCard>
  );
}

