/**
 * Lightweight client-side API helper for React Islands.
 *
 * Design goals:
 * - No global state dependencies (no Zustand, no context required)
 * - Safe, typed fetch wrappers with timeouts
 * - Graceful degradation when the CCW API is unavailable in docs builds
 *
 * The docs site expects these endpoints (relative to site origin):
 * - GET /api/sessions
 * - GET /api/cli-executions
 */

export type ApiErrorReason =
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid_json'
  | 'aborted';

export class ApiClientError extends Error {
  public readonly reason: ApiErrorReason;
  public readonly status?: number;
  public readonly url: string;

  constructor(args: { message: string; reason: ApiErrorReason; url: string; status?: number }) {
    super(args.message);
    this.name = 'ApiClientError';
    this.reason = args.reason;
    this.url = args.url;
    this.status = args.status;
  }
}

export interface ApiClientOptions {
  /**
   * Base URL for API calls.
   *
   * Use '' (default) to call same-origin endpoints like `/api/sessions`.
   */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 5000). */
  timeoutMs?: number;
}

export interface SessionMetadata {
  session_id: string;
  title?: string;
  description?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  type?: string;
}

export interface SessionsResponse {
  activeSessions: SessionMetadata[];
  archivedSessions: SessionMetadata[];
}

export interface CliExecution {
  id: string;
  tool?: string;
  status: string;
  command?: string;
  cwd?: string;
  started_at?: string;
  ended_at?: string;
  exit_code?: number | null;
}

export interface CliExecutionsResponse {
  executions: CliExecution[];
}

const DEFAULT_TIMEOUT_MS = 5000;

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const displayPath = getDisplayPath(url);
    const response = await fetch(url, {
      ...init,
      signal: init.signal ? mergeSignals(init.signal, controller.signal) : controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.headers || {}),
      },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new ApiClientError({
        message: `Request failed (${response.status}) for ${displayPath}`,
        reason: 'http',
        status: response.status,
        url,
      });
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiClientError({
        message: `Invalid JSON response for ${displayPath}`,
        reason: 'invalid_json',
        url,
      });
    }
  } catch (error) {
    if (error instanceof ApiClientError) throw error;

    if (isAbortError(error)) {
      throw new ApiClientError({
        message: `Request aborted for ${getDisplayPath(url)}`,
        reason: init.signal?.aborted ? 'aborted' : 'timeout',
        url,
      });
    }

    throw new ApiClientError({
      message: `Network error for ${getDisplayPath(url)}`,
      reason: 'network',
      url,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getDisplayPath(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
}

function mergeSignals(external: AbortSignal, internal: AbortSignal): AbortSignal {
  if (external.aborted) return external;
  if (internal.aborted) return internal;

  const controller = new AbortController();
  const onAbort = () => controller.abort();

  external.addEventListener('abort', onAbort, { once: true });
  internal.addEventListener('abort', onAbort, { once: true });

  return controller.signal;
}

/**
 * Fetch workflow sessions for the dashboard.
 *
 * Expected endpoint: `GET /api/sessions`
 */
export async function fetchSessions(
  options: ApiClientOptions & { signal?: AbortSignal } = {}
): Promise<SessionsResponse> {
  const baseUrl = options.baseUrl ?? '';
  const url = joinUrl(baseUrl, '/api/sessions');
  const data = await fetchJson<unknown>(url, { timeoutMs: options.timeoutMs, signal: options.signal });

  // Be tolerant to backend variations so the docs site degrades gracefully.
  if (isSessionsResponse(data)) return data;
  if (Array.isArray(data)) {
    return { activeSessions: data.filter(isSessionMetadata), archivedSessions: [] };
  }

  return { activeSessions: [], archivedSessions: [] };
}

/**
 * Fetch recent CLI execution records.
 *
 * Expected endpoint: `GET /api/cli-executions`
 */
export async function fetchCliExecutions(
  options: ApiClientOptions & { signal?: AbortSignal } = {}
): Promise<CliExecutionsResponse> {
  const baseUrl = options.baseUrl ?? '';
  const url = joinUrl(baseUrl, '/api/cli-executions');
  const data = await fetchJson<unknown>(url, { timeoutMs: options.timeoutMs, signal: options.signal });

  if (isCliExecutionsResponse(data)) return data;
  if (Array.isArray(data)) {
    return { executions: data.filter(isCliExecution) };
  }

  return { executions: [] };
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

function isSessionMetadata(value: unknown): value is SessionMetadata {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SessionMetadata>;
  return typeof v.session_id === 'string';
}

function isSessionsResponse(value: unknown): value is SessionsResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SessionsResponse>;
  return Array.isArray(v.activeSessions) && Array.isArray(v.archivedSessions);
}

function isCliExecution(value: unknown): value is CliExecution {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CliExecution>;
  return typeof v.id === 'string' && typeof v.status === 'string';
}

function isCliExecutionsResponse(value: unknown): value is CliExecutionsResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CliExecutionsResponse>;
  return Array.isArray(v.executions);
}
