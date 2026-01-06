import type http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { TokenManager } from './token-manager.js';

export interface AuthMiddlewareContext {
  pathname: string;
  req: IncomingMessage;
  res: ServerResponse;
  tokenManager: TokenManager;
  secretKey: string;
  unauthenticatedPaths?: Set<string>;
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

function getHeaderValue(header: string | string[] | undefined): string | null {
  if (!header) return null;
  if (Array.isArray(header)) return header[0] ?? null;
  return header;
}

export function extractAuthToken(req: IncomingMessage): string | null {
  const authorization = getHeaderValue(req.headers.authorization);
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  const cookies = parseCookieHeader(getHeaderValue(req.headers.cookie));
  if (cookies.auth_token) return cookies.auth_token;

  return null;
}

export function isLocalhostRequest(req: IncomingMessage): boolean {
  const remote = req.socket?.remoteAddress ?? '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

export function setAuthCookie(res: ServerResponse, token: string, expiresAt: Date): void {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

  const attributes = [
    `auth_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];

  res.setHeader('Set-Cookie', attributes.join('; '));
}

function writeJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function authMiddleware(ctx: AuthMiddlewareContext): boolean {
  const { pathname, req, res, tokenManager, secretKey, unauthenticatedPaths } = ctx;

  if (!pathname.startsWith('/api/')) return true;
  if (unauthenticatedPaths?.has(pathname)) return true;

  const token = extractAuthToken(req);
  if (!token) {
    writeJson(res, 401, { error: 'Unauthorized' });
    return false;
  }

  const ok = tokenManager.validateToken(token, secretKey);
  if (!ok) {
    writeJson(res, 401, { error: 'Unauthorized' });
    return false;
  }

  (req as http.IncomingMessage & { authenticated?: boolean }).authenticated = true;
  return true;
}
