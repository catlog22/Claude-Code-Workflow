import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Filter, Network, RefreshCw, Search } from 'lucide-react';
import WidgetCard from './WidgetCard';
import { fetchSessions, isApiClientError, type SessionMetadata } from '../../utils/api-client';

type ViewMode = 'list' | 'graph';

interface GraphNode {
  id: string;
  label: string;
  kind: 'session' | 'status';
  meta?: Record<string, string | undefined>;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

const GraphCanvas = lazy(() => import('./graph-explorer/GraphCanvas'));

function normalizeStatus(status?: string): string {
  if (!status) return 'unknown';
  return status.toLowerCase().trim().replace(/\s+/g, '_');
}

function ListSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 bg-muted rounded" />
      <div className="h-10 bg-muted rounded" />
      <div className="h-10 bg-muted rounded" />
      <div className="h-10 bg-muted rounded" />
    </div>
  );
}

/**
 * GraphExplorer - Lightweight graph-style explorer for sessions.
 *
 * Hydration directive (Astro):
 * `<GraphExplorer client:idle />`
 *
 * Bundle strategy:
 * - The SVG graph renderer is code-split via React.lazy to keep the initial
 *   island chunk smaller.
 */
export default function GraphExplorer() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ViewMode>('list');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetchSessions({ signal });
      const merged = [...res.activeSessions, ...res.archivedSessions];
      setSessions(merged);
    } catch (err) {
      if (signal?.aborted) return;
      setSessions([]);
      if (isApiClientError(err)) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to load graph data.');
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const title = (s.title || s.description || s.session_id).toLowerCase();
      return title.includes(q) || s.session_id.toLowerCase().includes(q);
    });
  }, [query, sessions]);

  const graph = useMemo(() => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const statusSet = new Set<string>();
    for (const s of filteredSessions) statusSet.add(normalizeStatus(s.status));

    const statusNodes = Array.from(statusSet).sort().map((status) => ({
      id: `status:${status}`,
      label: status,
      kind: 'status' as const,
    }));
    nodes.push(...statusNodes);

    for (const s of filteredSessions) {
      const status = normalizeStatus(s.status);
      const sessionId = `session:${s.session_id}`;
      nodes.push({
        id: sessionId,
        label: s.title || s.description || s.session_id,
        kind: 'session',
        meta: {
          session_id: s.session_id,
          status,
          type: s.type,
        },
      });
      edges.push({
        id: `edge:${s.session_id}:${status}`,
        from: sessionId,
        to: `status:${status}`,
      });
    }

    return { nodes, edges };
  }, [filteredSessions]);

  const selected = useMemo(() => {
    if (!selectedNodeId) return null;
    return graph.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [graph.nodes, selectedNodeId]);

  return (
    <WidgetCard
      title="Graph Explorer"
      description="Explore sessions as a dependency-style graph (docs-friendly SVG renderer)"
      icon={<Network className="w-4 h-4" />}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
          aria-label="Refresh graph data"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      }
      collapsible
      defaultCollapsed={true}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-muted-foreground absolute left-2 top-2.5" />
              <input
                className="w-full pl-8 pr-2 py-2 text-sm rounded-md border border-border bg-background"
                placeholder="Search sessions..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> {filteredSessions.length} items
            </span>
            <button
              type="button"
              className={[
                'px-2.5 py-2 text-xs rounded-md border transition-colors',
                mode === 'list'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted',
              ].join(' ')}
              onClick={() => setMode('list')}
            >
              List
            </button>
            <button
              type="button"
              className={[
                'px-2.5 py-2 text-xs rounded-md border transition-colors',
                mode === 'graph'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted',
              ].join(' ')}
              onClick={() => setMode('graph')}
            >
              Graph
            </button>
          </div>
        </div>

        {isLoading ? <ListSkeleton /> : null}

        {!isLoading && errorMessage ? (
          <div className="border border-border rounded-lg bg-muted/20 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Graph API unavailable</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This widget uses `/api/sessions` and renders a simplified graph for documentation.
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
          <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
            <div className="border border-border rounded-lg bg-background overflow-hidden">
              {mode === 'list' ? (
                <div className="divide-y divide-border">
                  {filteredSessions.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No sessions match your search.</div>
                  ) : (
                    filteredSessions.slice(0, 10).map((s) => {
                      const id = `session:${s.session_id}`;
                      const title = s.title || s.description || s.session_id;
                      return (
                        <button
                          key={s.session_id}
                          type="button"
                          onClick={() => setSelectedNodeId(id)}
                          className={[
                            'w-full text-left p-3 hover:bg-muted/40 transition-colors',
                            selectedNodeId === id ? 'bg-muted/40' : '',
                          ].join(' ')}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.session_id}</p>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
                              {normalizeStatus(s.status)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="p-3">
                  <Suspense
                    fallback={
                      <div className="animate-pulse">
                        <div className="h-6 bg-muted rounded w-40" />
                        <div className="h-48 bg-muted rounded mt-3" />
                      </div>
                    }
                  >
                    <GraphCanvas
                      nodes={graph.nodes}
                      edges={graph.edges}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={setSelectedNodeId}
                    />
                  </Suspense>
                </div>
              )}
            </div>

            <div className="border border-border rounded-lg bg-background p-3">
              <p className="text-xs text-muted-foreground">Selection</p>
              {selected ? (
                <div className="mt-2">
                  <p className="text-sm font-semibold text-foreground break-words">{selected.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">kind: {selected.kind}</p>
                  {selected.meta ? (
                    <pre className="mt-2 text-[11px] font-mono bg-muted/40 border border-border rounded-md p-2 overflow-x-auto">
                      {JSON.stringify(selected.meta, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">Click a node to inspect details.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </WidgetCard>
  );
}

