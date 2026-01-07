import { randomBytes } from 'crypto';

export interface CsrfTokenManagerOptions {
  tokenTtlMs?: number;
  cleanupIntervalMs?: number;
}

type CsrfTokenRecord = {
  sessionId: string;
  expiresAtMs: number;
  used: boolean;
};

const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class CsrfTokenManager {
  private readonly tokenTtlMs: number;
  private readonly records = new Map<string, CsrfTokenRecord>();
  private readonly cleanupTimer: NodeJS.Timeout | null;

  constructor(options: CsrfTokenManagerOptions = {}) {
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;

    const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpiredTokens();
      }, cleanupIntervalMs);

      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    } else {
      this.cleanupTimer = null;
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.records.clear();
  }

  generateToken(sessionId: string): string {
    const token = randomBytes(32).toString('hex');
    this.records.set(token, {
      sessionId,
      expiresAtMs: Date.now() + this.tokenTtlMs,
      used: false,
    });
    return token;
  }

  validateToken(token: string, sessionId: string): boolean {
    const record = this.records.get(token);
    if (!record) return false;
    if (record.used) return false;
    if (record.sessionId !== sessionId) return false;

    if (Date.now() > record.expiresAtMs) {
      this.records.delete(token);
      return false;
    }

    record.used = true;
    return true;
  }

  cleanupExpiredTokens(nowMs: number = Date.now()): number {
    let removed = 0;

    for (const [token, record] of this.records.entries()) {
      if (record.used || nowMs > record.expiresAtMs) {
        this.records.delete(token);
        removed += 1;
      }
    }

    return removed;
  }

  getActiveTokenCount(): number {
    return this.records.size;
  }
}

let csrfManagerInstance: CsrfTokenManager | null = null;

export function getCsrfTokenManager(options?: CsrfTokenManagerOptions): CsrfTokenManager {
  if (!csrfManagerInstance) {
    csrfManagerInstance = new CsrfTokenManager(options);
  }
  return csrfManagerInstance;
}

export function resetCsrfTokenManager(): void {
  if (csrfManagerInstance) {
    csrfManagerInstance.dispose();
  }
  csrfManagerInstance = null;
}

