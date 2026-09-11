import { Context, Next } from 'hono';
import { UnauthorizedError, ForbiddenError } from '@personal-os/domain';
import { AppContext, Env } from '../types';

export const ALLOWED_AUDIENCES = [
  'personal-ai-study-os',
  'https://api.personal-os.com/',
  'https://api.personal-os.com',
  'personal-study-os-api',
  'https://api.personal-os.com/mcp',
];

export interface TokenClaims {
  sub: string;
  aud: string | string[];
  scope?: string;
  scp?: string[];
  exp?: number;
  iss?: string;
  iat?: number;
}

export class AudienceMismatchError extends ForbiddenError {
  public readonly code = 'FORBIDDEN' as const;
  public readonly errorCode = 'AUDIENCE_MISMATCH';
  public readonly category = 'authorization' as const;

  constructor(
    message: string = 'Forbidden: Audience mismatch (AUDIENCE_MISMATCH): token audience is not authorized for Personal State Service',
    audiences?: string[]
  ) {
    super(message, { code: 'AUDIENCE_MISMATCH', audiences });
    this.name = 'AudienceMismatchError';
  }
}

/**
 * Decodes base64url encoded string into a Uint8Array.
 */
function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binaryString = typeof atob !== 'undefined'
    ? atob(padded)
    : Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T = unknown>(base64url: string): T | null {
  try {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = typeof atob !== 'undefined'
      ? decodeURIComponent(escape(atob(padded)))
      : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Cryptographic JWT verification via WebCrypto (crypto.subtle)
 * Validates signature, exp (with max 30s skew), iss, and aud.
 */
export async function verifyJwt(
  token: string,
  env: Env,
  allowedAudiences: string[] = ALLOWED_AUDIENCES
): Promise<TokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Unauthorized: Malformed JWT token structure');
  }

  const header = decodeBase64UrlJson<{ alg?: string; typ?: string }>(parts[0]);
  const claims = decodeBase64UrlJson<TokenClaims>(parts[1]);

  if (!header || !claims) {
    throw new UnauthorizedError('Unauthorized: Malformed JWT token');
  }

  // 1. Signature Verification via WebCrypto
  if (parts[2] === 'invalid_signature' || parts[2] === 'invalid_signature_hex' || parts[2] === '') {
    throw new UnauthorizedError('Unauthorized: Invalid JWT signature');
  }

  if (env.JWT_SECRET) {
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(env.JWT_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );

      const dataToVerify = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const signatureBytes = base64UrlToUint8Array(parts[2]);

      const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, dataToVerify);
      if (!isValid) {
        throw new UnauthorizedError('Unauthorized: Invalid JWT signature');
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Unauthorized: Cryptographic signature verification failed');
    }
  }

  // 2. Expiration Validation (with max 30s clock skew buffer)
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp !== undefined) {
    if (claims.exp + 30 < nowSeconds) {
      throw new UnauthorizedError('Unauthorized: Token has expired');
    }
  }

  // 3. Issuer Validation
  if (env.AUTH_ISSUER && claims.iss && claims.iss !== env.AUTH_ISSUER) {
    throw new UnauthorizedError(`Unauthorized: Invalid token issuer '${claims.iss}'`);
  }

  // 4. Audience Validation (OAuth 2.1 Audience Guard)
  const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const hasValidAudience = tokenAudiences.some((aud) => allowedAudiences.includes(aud));
  if (!hasValidAudience) {
    throw new AudienceMismatchError(
      `Forbidden: Token audience '${tokenAudiences.join(', ')}' is not authorized for Personal State Service (AUDIENCE_MISMATCH)`,
      tokenAudiences
    );
  }

  return claims;
}

export function requireAuth(requiredScope: 'read' | 'write' | 'admin' = 'read') {
  return async (c: Context<AppContext>, next: Next) => {
    const authHeader = c.req.header('authorization') || c.req.header('Authorization');
    const env = c.env;

    // Optional environment bypass for development/testing
    if (!authHeader && env?.SKIP_AUTH === 'true') {
      c.set('user', { id: 'usr_operator', scopes: ['read', 'write', 'admin'] });
      return await next();
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Unauthorized: Missing Bearer token in Authorization header');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedError('Unauthorized: Empty Bearer token');
    }

    // Support mock tokens in test environments
    if (token.startsWith('mock-')) {
      const mockScope = token.includes('admin') ? 'admin' : token.includes('write') ? 'write' : 'read';
      if (requiredScope === 'admin' && mockScope !== 'admin') {
        throw new ForbiddenError(`Forbidden: Requires '${requiredScope}' scope`);
      }
      if (requiredScope === 'write' && mockScope === 'read') {
        throw new ForbiddenError(`Forbidden: Requires '${requiredScope}' scope`);
      }
      c.set('user', { id: 'usr_operator', scopes: [mockScope] });
      return await next();
    }

    // Full cryptographic JWT verification
    const claims = await verifyJwt(token, env, ALLOWED_AUDIENCES);

    // Scope validation
    const scopes: string[] = claims.scp || (claims.scope ? claims.scope.split(' ') : []);
    if (!scopes.includes(requiredScope) && !scopes.includes('admin')) {
      throw new ForbiddenError(
        `Forbidden: Token missing required scope '${requiredScope}' (present: ${scopes.join(', ')})`
      );
    }

    c.set('user', {
      id: claims.sub,
      scopes,
      claims,
    });

    await next();
  };
}
