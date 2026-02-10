import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Clock, FolderKanban } from 'lucide-react';
import WidgetCard from './WidgetCard';
import { fetchSessions, isApiClientError, type SessionsResponse, type SessionMetadata } from '../../utils/api-client';

export interface SessionOverviewProps {
  /**
   * Max items to show per tab (active/archived).
   *
   * Usage (Astro):
   * `<SessionOverview client:load maxItems={6} />`
   */
  maxItems?: number;
}

type SessionTab = 'active' | 'archived';

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return 'Unknown time';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function SessionRow({ session }: { session: SessionMetadata }) {
  const title = session.title || session.description || session.session_id;
  const status = session.status || 'unknown';
  const lastUpdated = session.updated_at || session.created_at;

  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
            {status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {session.session_id}
          {session.type ? `  -  ${session.type}` : ''}
        </p>
      </div>

      <div className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" />
        <span>{formatRelativeTime(lastUpdated)}</span>
      </div>
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="animate-pulse">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/2 mt-2" />
            </div>
            <div className="h-3 bg-muted rounded w-16 mt-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * SessionOverview - Recent session list for the docs dashboard.
 *
 * Data source: `/api/sessions` (client-side).
 * Degradation: renders an image + helpful message when the API is unavailable.
 */
export default function SessionOverview({ maxItems = 6 }: SessionOverviewProps) {
  const [tab, setTab] = useState<SessionTab>('active');
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetchSessions({ signal });
      setData(res);
    } catch (err) {
      if (signal?.aborted) return;

      if (isApiClientError(err)) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to load sessions.');
      }
      setData(null);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const sessions = useMemo(() => {
    if (!data) return [] as SessionMetadata[];
    const list = tab === 'active' ? data.activeSessions : data.archivedSessions;
    return list.slice(0, maxItems);
  }, [data, maxItems, tab]);

  const counts = useMemo(() => {
    return {
      active: data?.activeSessions.length ?? 0,
      archived: data?.archivedSessions.length ?? 0,
    };
  }, [data]);

  return (
    <WidgetCard
      title="Session Overview"
      description="Live workflow sessions (via /api/sessions)"
      icon={<FolderKanban className="w-4 h-4" />}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
          aria-label="Refresh sessions"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      }
      collapsible
    >
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          className={[
            'px-2.5 py-1.5 text-xs rounded-md border transition-colors',
            tab === 'active'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background border-border hover:bg-muted',
          ].join(' ')}
          onClick={() => setTab('active')}
        >
          Active ({counts.active})
        </button>
        <button
          type="button"
          className={[
            'px-2.5 py-1.5 text-xs rounded-md border transition-colors',
            tab === 'archived'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background border-border hover:bg-muted',
          ].join(' ')}
          onClick={() => setTab('archived')}
        >
          Archived ({counts.archived})
        </button>
      </div>

      {isLoading ? <ListSkeleton rows={Math.min(4, maxItems)} /> : null}

      {!isLoading && errorMessage ? (
        <div className="border border-border rounded-lg bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">CCW API unavailable</p>
              <p className="text-xs text-muted-foreground mt-1">
                This docs page can run without a backend. Start the CCW server to enable live data.
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
        <div className="border border-border rounded-lg bg-background">
          {sessions.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No sessions found.</div>
          ) : (
            <div className="px-3">
              {sessions.map((s) => (
                <SessionRow key={s.session_id} session={s} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </WidgetCard>
  );
}

