import type http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { getCsrfTokenManager } from './csrf-manager.js';

export interface CsrfMiddlewareContext {
  pathname: string;
  req: IncomingMessage;
  res: ServerResponse;
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

function envFlagEnabled(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const withCache = req as http.IncomingMessage & { __ccwRawBody?: string };
  if (typeof withCache.__ccwRawBody === 'string') return withCache.__ccwRawBody;

  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      withCache.__ccwRawBody = body;
      resolve(body);
    });
    req.on('error', reject);
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const withCache = req as http.IncomingMessage & { body?: unknown };
  if (withCache.body !== undefined) return withCache.body;

  const raw = await readRawBody(req);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;
    withCache.body = parsed;
    return parsed;
  } catch {
    return undefined;
  }
}

function extractCsrfTokenFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const token = record.csrfToken;
  return typeof token === 'string' && token ? token : null;
}

function writeJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export async function csrfValidation(ctx: CsrfMiddlewareContext): Promise<boolean> {
  const { pathname, req, res } = ctx;

  if (!pathname.startsWith('/api/')) return true;
  if (envFlagEnabled('CCW_DISABLE_CSRF')) return true;

  const method = (req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;

  // Always allow token acquisition routes.
  if (pathname === '/api/auth/token') return true;

  // Requests authenticated via Authorization header do not require CSRF protection.
  const authorization = getHeaderValue(req.headers.authorization);
  if (authorization && /^Bearer\s+.+$/i.test(authorization)) return true;

  const headerToken = getHeaderValue(req.headers['x-csrf-token']);
  const cookies = parseCookieHeader(getHeaderValue(req.headers.cookie));
  const cookieToken = cookies['XSRF-TOKEN'];

  let bodyToken: string | null = null;
  if (!headerToken && !cookieToken) {
    const body = await readJsonBody(req);
    bodyToken = extractCsrfTokenFromBody(body);
  }

  const token = headerToken || bodyToken || cookieToken || null;
  const sessionId = cookies.ccw_session_id;

  if (!token || !sessionId) {
    writeJson(res, 403, { error: 'CSRF validation failed' });
    return false;
  }

  const tokenManager = getCsrfTokenManager();
  const ok = tokenManager.validateToken(token, sessionId);
  if (!ok) {
    writeJson(res, 403, { error: 'CSRF validation failed' });
    return false;
  }

  const nextToken = tokenManager.generateToken(sessionId);
  res.setHeader('X-CSRF-Token', nextToken);
  setCsrfCookie(res, nextToken, 15 * 60);

  return true;
}
