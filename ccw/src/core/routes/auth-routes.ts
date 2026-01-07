import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { getCsrfTokenManager } from '../auth/csrf-manager.js';

export interface RouteContext {
  pathname: string;
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  initialPath: string;
  handlePostRequest: (req: IncomingMessage, res: ServerResponse, handler: (body: unknown) => Promise<any>) => void;
  broadcastToClients: (data: unknown) => void;
}

function getHeaderValue(header: string | string[] | undefined): string | null {
  if (!header) return null;
  if (Array.isArray(header)) return header[0] ?? null;
  return header;
}

function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string> {
  if (!cookieHeader) return {};

  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    if (!rawName) continue;
    const rawValue = rawValueParts.join('=');
    try {
      cookies[rawName] = decodeURIComponent(rawValue);
    } catch {
      cookies[rawName] = rawValue;
    }
  }
  return cookies;
}

function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
    return;
  }

  res.setHeader('Set-Cookie', [String(existing), cookie]);
}

function getOrCreateSessionId(req: IncomingMessage, res: ServerResponse): string {
  const cookies = parseCookieHeader(getHeaderValue(req.headers.cookie));
  const existing = cookies.ccw_session_id;
  if (existing) return existing;

  const created = randomBytes(16).toString('hex');
  const attributes = [
    `ccw_session_id=${encodeURIComponent(created)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${24 * 60 * 60}`,
  ];
  appendSetCookie(res, attributes.join('; '));
  return created;
}

function setCsrfCookie(res: ServerResponse, token: string, maxAgeSeconds: number): void {
  const attributes = [
    `XSRF-TOKEN=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  appendSetCookie(res, attributes.join('; '));
}

export async function handleAuthRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, req, res } = ctx;

  if (pathname === '/api/csrf-token' && req.method === 'GET') {
    const sessionId = getOrCreateSessionId(req, res);
    const tokenManager = getCsrfTokenManager();
    const csrfToken = tokenManager.generateToken(sessionId);

    res.setHeader('X-CSRF-Token', csrfToken);
    setCsrfCookie(res, csrfToken, 15 * 60);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ csrfToken }));
    return true;
  }

  return false;
}

