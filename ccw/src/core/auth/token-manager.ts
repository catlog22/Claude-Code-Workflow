import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import jwt from 'jsonwebtoken';
import type { Algorithm } from 'jsonwebtoken';
import { getCCWHome } from '../../config/storage-paths.js';

export interface TokenResult {
  token: string;
  expiresAt: Date;
}

export interface TokenInfo extends TokenResult {
  issuedAt: Date;
  revokedAt?: Date;
  rotatedAt?: Date;
  replacedBy?: string;
}

export interface TokenManagerOptions {
  authDir?: string;
  secretKeyPath?: string;
  tokenPath?: string;
  tokenTtlMs?: number;
  rotateBeforeExpiryMs?: number;
}

const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ROTATE_BEFORE_EXPIRY_MS = 60 * 60 * 1000;
const JWT_ALGORITHM: Algorithm = 'HS256';

function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function bestEffortRestrictPermissions(filePath: string, mode: number): void {
  try {
    chmodSync(filePath, mode);
  } catch {
    // Ignore permission errors (e.g., Windows or restrictive environments)
  }
}

function writeSecretFile(filePath: string, content: string): void {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  bestEffortRestrictPermissions(filePath, 0o600);
}

function writeTokenFile(filePath: string, content: string): void {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  bestEffortRestrictPermissions(filePath, 0o600);
}

function parseJwtExpiry(token: string): Date | null {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== 'object') return null;
  if (typeof decoded.exp !== 'number') return null;
  return new Date(decoded.exp * 1000);
}

export class TokenManager {
  private readonly authDir: string;
  private readonly secretKeyPath: string;
  private readonly tokenPath: string;
  private readonly tokenTtlMs: number;
  private readonly rotateBeforeExpiryMs: number;

  private secretKey: string | null = null;
  private readonly activeTokens = new Map<string, TokenInfo>();

  constructor(options: TokenManagerOptions = {}) {
    this.authDir = options.authDir ?? join(getCCWHome(), 'auth');
    this.secretKeyPath = options.secretKeyPath ?? join(this.authDir, 'secret.key');
    this.tokenPath = options.tokenPath ?? join(this.authDir, 'token.jwt');
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.rotateBeforeExpiryMs = options.rotateBeforeExpiryMs ?? DEFAULT_ROTATE_BEFORE_EXPIRY_MS;
  }

  getSecretKey(): string {
    if (this.secretKey) return this.secretKey;

    ensureDirectory(this.authDir);
    if (existsSync(this.secretKeyPath)) {
      const loaded = readFileSync(this.secretKeyPath, 'utf8').trim();
      if (!loaded) {
        throw new Error('Auth secret key file is empty');
      }
      this.secretKey = loaded;
      return loaded;
    }

    const generated = randomBytes(32).toString('hex');
    writeSecretFile(this.secretKeyPath, generated);
    this.secretKey = generated;
    return generated;
  }

  generateToken(secretKey: string): TokenResult {
    const token = jwt.sign(
      {
        typ: 'ccw-api',
        jti: randomBytes(16).toString('hex'),
      },
      secretKey,
      {
        algorithm: JWT_ALGORITHM,
        expiresIn: Math.floor(this.tokenTtlMs / 1000),
      }
    );

    const expiresAt = parseJwtExpiry(token) ?? new Date(Date.now() + this.tokenTtlMs);
    this.activeTokens.set(token, { token, expiresAt, issuedAt: new Date() });
    return { token, expiresAt };
  }

  validateToken(token: string, secretKey: string): boolean {
    const info = this.activeTokens.get(token);
    if (info?.revokedAt) return false;

    try {
      jwt.verify(token, secretKey, { algorithms: [JWT_ALGORITHM] });
      return true;
    } catch {
      return false;
    }
  }

  refreshToken(token: string, secretKey: string): TokenResult {
    const existing = this.activeTokens.get(token);
    if (existing) {
      existing.revokedAt = new Date();
    }

    const next = this.generateToken(secretKey);
    if (existing) {
      existing.rotatedAt = new Date();
      existing.replacedBy = next.token;
    }
    return next;
  }

  /**
   * Read an existing persisted token or create a new one.
   * If the existing token is nearing expiry, rotate it.
   */
  getOrCreateAuthToken(): TokenResult {
    const secretKey = this.getSecretKey();

    if (existsSync(this.tokenPath)) {
      const persisted = readFileSync(this.tokenPath, 'utf8').trim();
      if (persisted && this.validateToken(persisted, secretKey)) {
        const expiresAt = parseJwtExpiry(persisted);
        if (expiresAt) {
          // Ensure persisted token is tracked for revocation support
          if (!this.activeTokens.has(persisted)) {
            this.activeTokens.set(persisted, { token: persisted, expiresAt, issuedAt: new Date() });
          }

          const msUntilExpiry = expiresAt.getTime() - Date.now();
          if (msUntilExpiry > this.rotateBeforeExpiryMs) {
            return { token: persisted, expiresAt };
          }
        }

        // Token exists but is expiring soon (or expiry missing) → rotate
        const rotated = this.generateToken(secretKey);
        writeTokenFile(this.tokenPath, rotated.token);

        const existing = this.activeTokens.get(persisted);
        if (existing) {
          existing.rotatedAt = new Date();
          existing.replacedBy = rotated.token;
        }

        return rotated;
      }
    }

    const created = this.generateToken(secretKey);
    writeTokenFile(this.tokenPath, created.token);
    return created;
  }

  revokeToken(token: string): void {
    const info = this.activeTokens.get(token);
    if (info) {
      info.revokedAt = new Date();
    } else {
      this.activeTokens.set(token, {
        token,
        issuedAt: new Date(),
        expiresAt: new Date(0),
        revokedAt: new Date(),
      });
    }
  }
}

let tokenManagerInstance: TokenManager | null = null;

export function getTokenManager(options?: TokenManagerOptions): TokenManager {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new TokenManager(options);
  }
  return tokenManagerInstance;
}

export function resetTokenManager(): void {
  tokenManagerInstance = null;
}

export function getOrCreateAuthToken(): TokenResult {
  return getTokenManager().getOrCreateAuthToken();
}

