import { describe, expect, it, vi } from 'vitest';
import {
  ApiClientError,
  fetchCliExecutions,
  fetchSessions,
  isApiClientError,
} from './api-client';

function createResponse(args: { ok: boolean; status: number; json: () => unknown | Promise<unknown> }): Response {
  return {
    ok: args.ok,
    status: args.status,
    json: args.json,
  } as unknown as Response;
}

describe('api-client', () => {
  it('fetchSessions returns typed sessions response on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse({
        ok: true,
        status: 200,
        json: async () => ({
          activeSessions: [{ session_id: 'S1', title: 'Session 1' }],
          archivedSessions: [],
        }),
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchSessions({ timeoutMs: 50 });
    expect(res.activeSessions).toHaveLength(1);
    expect(res.activeSessions[0]?.session_id).toBe('S1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetchSessions tolerates an array response as active sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createResponse({
          ok: true,
          status: 200,
          json: async () => [{ session_id: 'S2' }, { not_a_session: true }],
        })
      )
    );

    const res = await fetchSessions({ timeoutMs: 50 });
    expect(res.activeSessions.map(s => s.session_id)).toEqual(['S2']);
    expect(res.archivedSessions).toEqual([]);
  });

  it('fetchCliExecutions tolerates an array response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createResponse({
          ok: true,
          status: 200,
          json: async () => [{ id: 'E1', status: 'completed' }, { id: 123 }],
        })
      )
    );

    const res = await fetchCliExecutions({ timeoutMs: 50 });
    expect(res.executions.map(e => e.id)).toEqual(['E1']);
  });

  it('throws ApiClientError for http errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createResponse({
          ok: false,
          status: 503,
          json: async () => ({}),
        })
      )
    );

    await expect(fetchSessions({ timeoutMs: 50 })).rejects.toBeInstanceOf(ApiClientError);

    try {
      await fetchSessions({ timeoutMs: 50 });
    } catch (err) {
      expect(isApiClientError(err)).toBe(true);
      const e = err as ApiClientError;
      expect(e.reason).toBe('http');
      expect(e.status).toBe(503);
    }
  });

  it('throws ApiClientError for invalid json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createResponse({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('bad json');
          },
        })
      )
    );

    await expect(fetchSessions({ timeoutMs: 50 })).rejects.toMatchObject({ reason: 'invalid_json' });
  });

  it('throws ApiClientError for network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(fetchSessions({ timeoutMs: 50 })).rejects.toMatchObject({ reason: 'network' });
  });

  it('aborts with timeout when fetch does not resolve', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;

        const onAbort = () => {
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSessions({ timeoutMs: 10 })).rejects.toMatchObject({ reason: 'timeout' });
  });
});

