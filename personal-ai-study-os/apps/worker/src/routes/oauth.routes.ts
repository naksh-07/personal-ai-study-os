import { Hono, Context } from 'hono';
import { AppContext, Env } from '../types';

export const oauthRoutes = new Hono<AppContext>();

// In-memory set for tracking used authorization codes (fast replay protection)
const usedCodes = new Set<string>();

/**
 * Portable base64url encoder from Uint8Array.
 */
function bufferToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Portable base64url string encoder.
 */
function strToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return bufferToBase64Url(bytes);
}

/**
 * Portable base64url string decoder.
 */
function base64UrlToStr(b64url: string): string {
  const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  if (typeof atob !== 'undefined') {
    return decodeURIComponent(escape(atob(padded)));
  }
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Constant-time string equality check to prevent timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Computes HMAC-SHA256 signature using WebCrypto.
 */
async function hmacSha256(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bufferToBase64Url(new Uint8Array(signature));
}

/**
 * Computes SHA-256 base64url digest for PKCE S256 verification.
 */
async function sha256Base64Url(str: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return bufferToBase64Url(new Uint8Array(digest));
}

/**
 * Extracts origin from incoming request URL.
 */
function getOrigin(c: Context<AppContext>): string {
  try {
    const url = new URL(c.req.url);
    return url.origin;
  } catch {
    return 'https://personal-ai-study-os-staging.riyasaksena502.workers.dev';
  }
}

/**
 * Validates whether the redirect_uri is authorized.
 */
export function isAuthorizedRedirectUri(redirectUri: string, env: Env): boolean {
  if (!redirectUri || typeof redirectUri !== 'string') return false;

  try {
    const url = new URL(redirectUri);

    // Exact match with configured environment variable
    if (env?.SPARK_REDIRECT_URI && redirectUri === env.SPARK_REDIRECT_URI) {
      return true;
    }

    // Google / Gemini OAuth callback hosts
    const host = url.hostname.toLowerCase();
    if (
      host === 'gemini.google.com' ||
      host === 'bard.google.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.googleusercontent.com')
    ) {
      return true;
    }

    // Local & test harness redirect URIs
    if (
      env?.ENVIRONMENT === 'test' ||
      env?.ENVIRONMENT === 'development' ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === 'example.com'
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validates client credentials.
 */
export function validateClient(
  clientId: string,
  clientSecret: string | undefined,
  env: Env
): boolean {
  const allowedClientId = env?.SPARK_CLIENT_ID || 'gemini-spark';
  if (clientId !== allowedClientId && clientId !== 'gemini-spark' && clientId !== 'gemini') {
    return false;
  }

  // If a client secret is configured or passed, validate it
  const expectedSecret = env?.SPARK_CLIENT_SECRET || 'personal-study-os-spark-secret';
  if (clientSecret !== undefined) {
    return constantTimeEqual(clientSecret, expectedSecret);
  }

  // If no secret provided (e.g. public PKCE client), client_id check was sufficient
  return true;
}

// ============================================================================
// 1. RFC 8414: OAuth 2.0 Authorization Server Metadata
// ============================================================================
const handleOAuthServerMetadata = (c: Context<AppContext>) => {
  const origin = getOrigin(c);
  return c.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256', 'plain'],
      scopes_supported: ['read', 'write'],
      service_documentation: `${origin}/docs`,
    },
    200,
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    }
  );
};

oauthRoutes.get('/.well-known/oauth-authorization-server', handleOAuthServerMetadata);
oauthRoutes.get('/.well-known/oauth-authorization-server/mcp', handleOAuthServerMetadata);
oauthRoutes.get('/.well-known/openid-configuration', handleOAuthServerMetadata);

// ============================================================================
// 2. RFC 9728: OAuth 2.0 Protected Resource Metadata
// ============================================================================
const handleProtectedResourceMetadata = (c: Context<AppContext>) => {
  const origin = getOrigin(c);
  return c.json(
    {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
      resource_documentation: `${origin}/docs`,
    },
    200,
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    }
  );
};

oauthRoutes.get('/.well-known/oauth-protected-resource', handleProtectedResourceMetadata);
oauthRoutes.get('/.well-known/oauth-protected-resource/mcp', handleProtectedResourceMetadata);
oauthRoutes.get('/mcp/.well-known/oauth-protected-resource', handleProtectedResourceMetadata);

// ============================================================================
// 3. Authorization Endpoint: GET & POST /oauth/authorize
// ============================================================================
oauthRoutes.get('/oauth/authorize', async (c) => {
  const query = c.req.query();
  const responseType = query.response_type;
  const clientId = query.client_id;
  const redirectUri = query.redirect_uri;
  const scope = query.scope || 'read write';
  const state = query.state;
  const codeChallenge = query.code_challenge;
  const codeChallengeMethod = query.code_challenge_method || (codeChallenge ? 'S256' : undefined);
  const prompt = query.prompt;

  // 1. Validate response_type
  if (responseType !== 'code') {
    return c.json(
      {
        error: 'unsupported_response_type',
        error_description: "Parameter 'response_type' must be 'code'",
      },
      400
    );
  }

  // 2. Validate client_id
  const allowedClientId = c.env?.SPARK_CLIENT_ID || 'gemini-spark';
  if (!clientId || (clientId !== allowedClientId && clientId !== 'gemini-spark' && clientId !== 'gemini')) {
    return c.json(
      {
        error: 'unauthorized_client',
        error_description: `Client '${clientId ?? 'unknown'}' is not recognized or authorized`,
      },
      400
    );
  }

  // 3. Validate redirect_uri
  if (!redirectUri || !isAuthorizedRedirectUri(redirectUri, c.env)) {
    return c.json(
      {
        error: 'invalid_request',
        error_description: `Redirect URI '${redirectUri ?? 'none'}' is not authorized`,
      },
      400
    );
  }

  // 4. Validate state
  if (!state || typeof state !== 'string' || state.trim() === '') {
    return c.json(
      {
        error: 'invalid_request',
        error_description: "Parameter 'state' is mandatory for CSRF prevention",
      },
      400
    );
  }

  // 5. Generate tamper-proof signed authorization code
  const jwtSecret = c.env?.JWT_SECRET || 'personal_ai_study_os_development_secret_only';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const codePayload = {
    typ: 'auth_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    exp: nowSeconds + 300, // 5 minutes code lifetime (RFC 6749)
    jti: crypto.randomUUID(),
  };

  const payloadStr = JSON.stringify(codePayload);
  const encodedPayload = strToBase64Url(payloadStr);
  const signature = await hmacSha256(encodedPayload, jwtSecret);
  const authCode = `${encodedPayload}.${signature}`;

  // 6. Build redirection target
  const targetUrl = new URL(redirectUri);
  targetUrl.searchParams.set('code', authCode);
  targetUrl.searchParams.set('state', state);

  // If prompt=consent explicitly requested, render interactive consent HTML
  if (prompt === 'consent') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Authorize Gemini Spark — Personal AI Study OS</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 60px auto; padding: 32px; border: 1px solid #dadce0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h2 { margin-top: 0; color: #202124; }
    p { color: #5f6368; line-height: 1.5; }
    .scopes { background: #f8f9fa; padding: 12px; border-radius: 4px; font-family: monospace; margin: 16px 0; }
    .btn { display: inline-block; background: #1a73e8; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 500; font-size: 14px; text-align: center; width: 100%; box-sizing: border-box; }
    .btn:hover { background: #1557b0; }
  </style>
</head>
<body>
  <h2>Authorize Gemini Spark</h2>
  <p>Gemini Spark is requesting authorization to connect to your Personal AI Study OS server.</p>
  <div class="scopes">Authorized Scopes: ${scope}</div>
  <a class="btn" href="${targetUrl.toString()}">Authorize Connection</a>
</body>
</html>`;
    return c.html(html);
  }

  // Standard OAuth 2.0 302 Redirection
  return c.redirect(targetUrl.toString(), 302);
});

// ============================================================================
// 4. Token Endpoint: POST /oauth/token
// ============================================================================
oauthRoutes.post('/oauth/token', async (c) => {
  let grantType = '';
  let code = '';
  let redirectUri = '';
  let clientId = '';
  let clientSecret: string | undefined = undefined;
  let codeVerifier = '';
  let refreshTokenParam = '';

  // Extract from Authorization header if client_secret_basic is used
  const authHeader = c.req.header('authorization') || c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const basicCredentials = base64UrlToStr(authHeader.substring(6).trim());
      const colonIdx = basicCredentials.indexOf(':');
      if (colonIdx !== -1) {
        clientId = basicCredentials.substring(0, colonIdx);
        clientSecret = basicCredentials.substring(colonIdx + 1);
      }
    } catch {
      // Ignored, fallback to body params
    }
  }

  // Parse body (supports application/x-www-form-urlencoded and application/json)
  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = await c.req.json();
      grantType = body.grant_type || '';
      code = body.code || '';
      redirectUri = body.redirect_uri || '';
      if (!clientId) clientId = body.client_id || '';
      if (clientSecret === undefined) clientSecret = body.client_secret;
      codeVerifier = body.code_verifier || '';
      refreshTokenParam = body.refresh_token || '';
    } catch {
      return c.json({ error: 'invalid_request', error_description: 'Malformed JSON body' }, 400);
    }
  } else {
    try {
      const formData = await c.req.parseBody();
      grantType = (formData.grant_type as string) || '';
      code = (formData.code as string) || '';
      redirectUri = (formData.redirect_uri as string) || '';
      if (!clientId) clientId = (formData.client_id as string) || '';
      if (clientSecret === undefined && formData.client_secret) {
        clientSecret = formData.client_secret as string;
      }
      codeVerifier = (formData.code_verifier as string) || '';
      refreshTokenParam = (formData.refresh_token as string) || '';
    } catch {
      return c.json({ error: 'invalid_request', error_description: 'Malformed form body' }, 400);
    }
  }

  // Validate Client Identity
  if (!clientId) {
    clientId = c.env?.SPARK_CLIENT_ID || 'gemini-spark';
  }

  if (!validateClient(clientId, clientSecret, c.env)) {
    return c.json(
      {
        error: 'invalid_client',
        error_description: 'Client authentication failed',
      },
      401,
      { 'WWW-Authenticate': 'Basic realm="personal-ai-study-os"' }
    );
  }

  const jwtSecret = c.env?.JWT_SECRET || 'personal_ai_study_os_development_secret_only';
  const origin = getOrigin(c);
  const issuer = c.env?.AUTH_ISSUER || origin;
  const nowSeconds = Math.floor(Date.now() / 1000);

  // --------------------------------------------------------------------------
  // Flow A: authorization_code exchange
  // --------------------------------------------------------------------------
  if (grantType === 'authorization_code') {
    if (!code) {
      return c.json(
        { error: 'invalid_request', error_description: "Missing 'code' parameter" },
        400
      );
    }

    const codeParts = code.split('.');
    if (codeParts.length !== 2) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Malformed authorization code' },
        400
      );
    }

    const [encodedPayload, receivedSig] = codeParts;
    const expectedSig = await hmacSha256(encodedPayload, jwtSecret);
    if (!constantTimeEqual(receivedSig, expectedSig)) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Invalid authorization code signature' },
        400
      );
    }

    let codeClaims: any;
    try {
      codeClaims = JSON.parse(base64UrlToStr(encodedPayload));
    } catch {
      return c.json(
        { error: 'invalid_grant', error_description: 'Corrupted authorization code payload' },
        400
      );
    }

    // Validate code type & expiration
    if (codeClaims.typ !== 'auth_code') {
      return c.json(
        { error: 'invalid_grant', error_description: 'Invalid authorization code type' },
        400
      );
    }

    if (!codeClaims.exp || codeClaims.exp < nowSeconds) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Authorization code has expired' },
        400
      );
    }

    // Validate client binding
    if (codeClaims.client_id !== clientId) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Authorization code client mismatch' },
        400
      );
    }

    // Validate redirect_uri binding
    if (redirectUri && codeClaims.redirect_uri !== redirectUri) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Redirect URI mismatch' },
        400
      );
    }

    // Replay Protection (Single-use enforcement)
    const codeId = codeClaims.jti || code;
    if (usedCodes.has(codeId)) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Authorization code has already been used' },
        400
      );
    }
    usedCodes.add(codeId);

    // Also persist code consumption in idempotency_records if D1 is available
    if (c.env?.DB) {
      try {
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO idempotency_records 
           (idempotency_key, operation, source_system, request_hash, status, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now', '+1 day'))`
        )
          .bind(`oauth_code_${codeId}`, 'oauth_token_exchange', 'spark', 'consumed', 'COMPLETED')
          .run();
      } catch {
        // Table insert best-effort, in-memory usedCodes protects execution
      }
    }

    // PKCE Verification (RFC 7636)
    if (codeClaims.code_challenge) {
      if (!codeVerifier) {
        return c.json(
          { error: 'invalid_grant', error_description: 'Missing code_verifier for PKCE' },
          400
        );
      }

      if (codeClaims.code_challenge_method === 'S256') {
        const computedChallenge = await sha256Base64Url(codeVerifier);
        if (!constantTimeEqual(computedChallenge, codeClaims.code_challenge)) {
          return c.json(
            { error: 'invalid_grant', error_description: 'PKCE S256 verification failed' },
            400
          );
        }
      } else if (codeClaims.code_challenge_method === 'plain') {
        if (!constantTimeEqual(codeVerifier, codeClaims.code_challenge)) {
          return c.json(
            { error: 'invalid_grant', error_description: 'PKCE plain verification failed' },
            400
          );
        }
      }
    }

    // Issue standard JWT access token & refresh token
    const scope = codeClaims.scope || 'read write';
    const scopesArray = scope.split(' ');

    const tokenHeader = { alg: 'HS256', typ: 'JWT' };
    const tokenClaims = {
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: issuer,
      client_id: clientId,
      scope,
      scp: scopesArray,
      iat: nowSeconds,
      exp: nowSeconds + 3600, // 1 hour access token
      jti: crypto.randomUUID(),
    };

    const b64Header = strToBase64Url(JSON.stringify(tokenHeader));
    const b64Payload = strToBase64Url(JSON.stringify(tokenClaims));
    const unsignedJwt = `${b64Header}.${b64Payload}`;
    const tokenSig = await hmacSha256(unsignedJwt, jwtSecret);
    const accessToken = `${unsignedJwt}.${tokenSig}`;

    // Generate refresh token (30 days validity)
    const refreshClaims = {
      typ: 'refresh_token',
      sub: 'usr_operator',
      client_id: clientId,
      scope,
      iat: nowSeconds,
      exp: nowSeconds + 30 * 86400,
      jti: crypto.randomUUID(),
    };
    const b64RefreshPayload = strToBase64Url(JSON.stringify(refreshClaims));
    const refreshSig = await hmacSha256(b64RefreshPayload, jwtSecret);
    const refreshToken = `${b64RefreshPayload}.${refreshSig}`;

    return c.json(
      {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshToken,
        scope,
      },
      200,
      {
        'Content-Type': 'application/json;charset=UTF-8',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      }
    );
  }

  // --------------------------------------------------------------------------
  // Flow B: refresh_token exchange
  // --------------------------------------------------------------------------
  if (grantType === 'refresh_token') {
    if (!refreshTokenParam) {
      return c.json(
        { error: 'invalid_request', error_description: "Missing 'refresh_token' parameter" },
        400
      );
    }

    const parts = refreshTokenParam.split('.');
    if (parts.length !== 2) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Malformed refresh token' },
        400
      );
    }

    const [encodedPayload, receivedSig] = parts;
    const expectedSig = await hmacSha256(encodedPayload, jwtSecret);
    if (!constantTimeEqual(receivedSig, expectedSig)) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Invalid refresh token signature' },
        400
      );
    }

    let refreshClaims: any;
    try {
      refreshClaims = JSON.parse(base64UrlToStr(encodedPayload));
    } catch {
      return c.json(
        { error: 'invalid_grant', error_description: 'Corrupted refresh token payload' },
        400
      );
    }

    if (refreshClaims.typ !== 'refresh_token' || refreshClaims.exp < nowSeconds) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Refresh token has expired' },
        400
      );
    }

    const scope = refreshClaims.scope || 'read write';
    const scopesArray = scope.split(' ');

    const tokenHeader = { alg: 'HS256', typ: 'JWT' };
    const tokenClaims = {
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: issuer,
      client_id: clientId,
      scope,
      scp: scopesArray,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      jti: crypto.randomUUID(),
    };

    const b64Header = strToBase64Url(JSON.stringify(tokenHeader));
    const b64Payload = strToBase64Url(JSON.stringify(tokenClaims));
    const unsignedJwt = `${b64Header}.${b64Payload}`;
    const tokenSig = await hmacSha256(unsignedJwt, jwtSecret);
    const accessToken = `${unsignedJwt}.${tokenSig}`;

    return c.json(
      {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshTokenParam,
        scope,
      },
      200,
      {
        'Content-Type': 'application/json;charset=UTF-8',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      }
    );
  }

  return c.json(
    {
      error: 'unsupported_grant_type',
      error_description: `Grant type '${grantType}' is not supported`,
    },
    400
  );
});
