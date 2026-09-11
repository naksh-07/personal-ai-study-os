import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createTestDatabase, TestContext } from './test-helper';
import app from '../apps/worker/src/index';
import { EntitiesRepository } from '@personal-os/db';
import { Subject, Chapter } from '@personal-os/domain';

describe('Phase 4C: Gemini Spark OAuth Compatibility & Security Test Suite', () => {
  let ctx: TestContext;
  const testSecret = 'super_secure_test_jwt_secret_key_12345!';
  const testClientId = 'gemini-spark';
  const testClientSecret = 'personal-study-os-spark-secret';
  const testRedirectUri = 'https://gemini.google.com/oauth/callback';

  const makeEnv = (overrides?: Record<string, any>) => ({
    DB: ctx.d1,
    ENVIRONMENT: 'test',
    JWT_SECRET: testSecret,
    AUTH_ISSUER: 'personal-study-os-api',
    SPARK_CLIENT_ID: testClientId,
    SPARK_CLIENT_SECRET: testClientSecret,
    SPARK_REDIRECT_URI: testRedirectUri,
    ...overrides,
  });

  // Helper to generate signed JWTs
  async function makeSignedJwt(payload: Record<string, any>, secret: string = testSecret): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${b64Header}.${b64Payload}`;

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(unsignedToken);
    const signature = hmac.digest('base64url');
    return `${unsignedToken}.${signature}`;
  }

  // Helper to compute S256 PKCE challenge
  function computeS256(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  beforeEach(async () => {
    ctx = createTestDatabase();
    const now = new Date().toISOString();

    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'UTC',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    const subject: Subject = {
      id: 'subj_pathology',
      name: 'General Pathology',
      slug: 'general-pathology',
      description: 'Pathology fundamentals',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertSubject(ctx.db, subject);

    const chapter: Chapter = {
      id: 'chap_hemodynamics',
      subjectId: 'subj_pathology',
      name: 'Hemodynamic Disorders',
      slug: 'hemodynamic-disorders',
      progress: 0.4,
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter);
  });

  // ==========================================================================
  // Test 1: OAuth Metadata Discovery (RFC 8414)
  // ==========================================================================
  it('1. discovers OAuth 2.0 authorization server metadata via /.well-known/oauth-authorization-server', async () => {
    const res = await app.request('/.well-known/oauth-authorization-server', {
      method: 'GET',
    }, makeEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.authorization_endpoint).toContain('/oauth/authorize');
    expect(json.token_endpoint).toContain('/oauth/token');
    expect(json.grant_types_supported).toContain('authorization_code');
    expect(json.grant_types_supported).toContain('refresh_token');
    expect(json.response_types_supported).toContain('code');
    expect(json.code_challenge_methods_supported).toContain('S256');
    expect(json.scopes_supported).toEqual(['read', 'write']);

    // Also verify openid-configuration alias
    const openidRes = await app.request('/.well-known/openid-configuration', {
      method: 'GET',
    }, makeEnv());
    expect(openidRes.status).toBe(200);
  });

  // ==========================================================================
  // Test 2: Protected Resource Metadata (RFC 9728) & WWW-Authenticate
  // ==========================================================================
  it('2. discovers protected resource metadata and returns WWW-Authenticate on 401 unauthenticated probe', async () => {
    const res = await app.request('/.well-known/oauth-protected-resource', {
      method: 'GET',
    }, makeEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.resource).toContain('/mcp');
    expect(json.scopes_supported).toEqual(['read', 'write']);
    expect(json.bearer_methods_supported).toContain('header');

    // Verify GET /mcp without auth returns 401 with WWW-Authenticate pointing to metadata
    const mcpProbe = await app.request('/mcp', { method: 'GET' }, makeEnv());
    expect(mcpProbe.status).toBe(401);
    expect(mcpProbe.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    expect(mcpProbe.headers.get('Link')).toContain('rel="oauth-protected-resource"');
  });

  // ==========================================================================
  // Test 3: Valid Authorization Request
  // ==========================================================================
  it('3. handles authorization request and returns 302 redirect with code and state', async () => {
    const res = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}&state=csrf_state_123&scope=read+write`,
      { method: 'GET' },
      makeEnv()
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).toBeDefined();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(testRedirectUri);
    expect(redirectUrl.searchParams.get('state')).toBe('csrf_state_123');
    expect(redirectUrl.searchParams.get('code')).toBeDefined();
    expect(redirectUrl.searchParams.get('code')!.split('.').length).toBe(2);
  });

  // ==========================================================================
  // Test 4: Invalid Client Rejection
  // ==========================================================================
  it('4. rejects invalid client in authorize and token endpoints', async () => {
    // In /oauth/authorize
    const authRes = await app.request(
      `/oauth/authorize?response_type=code&client_id=unauthorized_client&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}&state=state1`,
      { method: 'GET' },
      makeEnv()
    );
    expect(authRes.status).toBe(400);
    const authJson: any = await authRes.json();
    expect(authJson.error).toBe('unauthorized_client');

    // In /oauth/token with wrong client_secret
    const tokenRes = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: 'wrong_secret_123',
        code: 'some.code',
      }),
    }, makeEnv());
    expect(tokenRes.status).toBe(401);
    const tokenJson: any = await tokenRes.json();
    expect(tokenJson.error).toBe('invalid_client');
  });

  // ==========================================================================
  // Test 5: Invalid Redirect URI Rejection
  // ==========================================================================
  it('5. rejects unauthorized redirect_uri', async () => {
    const res = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=https://evil-attacker.com/callback&state=state1`,
      { method: 'GET' },
      makeEnv({ ENVIRONMENT: 'production' })
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toBe('invalid_request');
    expect(json.error_description).toContain('Redirect URI');
  });

  // ==========================================================================
  // Test 6: Invalid State Rejection
  // ==========================================================================
  it('6. rejects authorization request with missing or empty state', async () => {
    const res = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}`,
      { method: 'GET' },
      makeEnv()
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toBe('invalid_request');
    expect(json.error_description).toContain('state');
  });

  // ==========================================================================
  // Test 7: PKCE S256 Validation
  // ==========================================================================
  it('7. verifies PKCE S256 code challenge and rejects mismatched verifier', async () => {
    const verifier = 'secure_random_pkce_verifier_string_1234567890!';
    const challenge = computeS256(verifier);

    // 1. Authorize with code_challenge
    const authRes = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}&state=state_pkce&code_challenge=${challenge}&code_challenge_method=S256`,
      { method: 'GET' },
      makeEnv()
    );
    expect(authRes.status).toBe(302);
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code')!;

    // 2. Token exchange with incorrect verifier
    const failRes = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: testClientSecret,
        code,
        redirect_uri: testRedirectUri,
        code_verifier: 'wrong_verifier_string',
      }),
    }, makeEnv());
    expect(failRes.status).toBe(400);
    const failJson: any = await failRes.json();
    expect(failJson.error).toBe('invalid_grant');
    expect(failJson.error_description).toContain('PKCE');

    // 3. Obtain fresh authorization code for successful token exchange
    const authResSuccess = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}&state=state_pkce_success&code_challenge=${challenge}&code_challenge_method=S256`,
      { method: 'GET' },
      makeEnv()
    );
    expect(authResSuccess.status).toBe(302);
    const successCode = new URL(authResSuccess.headers.get('Location')!).searchParams.get('code')!;

    const successRes = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: testClientSecret,
        code: successCode,
        redirect_uri: testRedirectUri,
        code_verifier: verifier,
      }),
    }, makeEnv());
    expect(successRes.status).toBe(200);
    const successJson: any = await successRes.json();
    expect(successJson.access_token).toBeDefined();
    expect(successJson.token_type).toBe('Bearer');
  });

  // ==========================================================================
  // Test 8: Invalid Authorization Code
  // ==========================================================================
  it('8. rejects forged, tampered, or expired authorization code', async () => {
    // Forged code with invalid signature
    const forgedCode = 'eyJhbGciOiJIUzI1NiJ9.invalid_signature';
    const res1 = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: testClientSecret,
        code: forgedCode,
      }),
    }, makeEnv());
    expect(res1.status).toBe(400);
    const json1: any = await res1.json();
    expect(json1.error).toBe('invalid_grant');

    // Expired code
    const expiredPayload = {
      typ: 'auth_code',
      client_id: testClientId,
      redirect_uri: testRedirectUri,
      scope: 'read write',
      exp: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
      jti: 'code_expired_1',
    };
    const b64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const sig = crypto.createHmac('sha256', testSecret).update(b64).digest('base64url');
    const expiredCode = `${b64}.${sig}`;

    const res2 = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: testClientSecret,
        code: expiredCode,
      }),
    }, makeEnv());
    expect(res2.status).toBe(400);
    const json2: any = await res2.json();
    expect(json2.error).toBe('invalid_grant');
    expect(json2.error_description).toContain('expired');
  });

  // ==========================================================================
  // Test 9: Complete Token Exchange & Refresh Token
  // ==========================================================================
  it('9. completes authorization_code exchange and refresh_token flow', async () => {
    // Authorize
    const authRes = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}&state=st_123&scope=read+write`,
      { method: 'GET' },
      makeEnv()
    );
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code')!;

    // Exchange via Basic Auth
    const basicHeader = 'Basic ' + Buffer.from(`${testClientId}:${testClientSecret}`).toString('base64');
    const tokenRes = await app.request('/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: basicHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(testRedirectUri)}`,
    }, makeEnv());

    expect(tokenRes.status).toBe(200);
    const tokenData: any = await tokenRes.json();
    expect(tokenData.access_token).toBeDefined();
    expect(tokenData.token_type).toBe('Bearer');
    expect(tokenData.expires_in).toBe(3600);
    expect(tokenData.refresh_token).toBeDefined();

    // Use refresh token to obtain a new access token
    const refreshRes = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: testClientId,
        client_secret: testClientSecret,
        refresh_token: tokenData.refresh_token,
      }),
    }, makeEnv());

    expect(refreshRes.status).toBe(200);
    const refreshData: any = await refreshRes.json();
    expect(refreshData.access_token).toBeDefined();
  });

  // ==========================================================================
  // Test 10: Expired Access Token Rejection
  // ==========================================================================
  it('10. rejects expired access token on /mcp with 401 and WWW-Authenticate', async () => {
    const expiredJwt = await makeSignedJwt({
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: 'personal-study-os-api',
      scope: 'read write',
      exp: Math.floor(Date.now() / 1000) - 60, // expired 60s ago
    });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${expiredJwt}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'ping' }),
    }, makeEnv());

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    const json: any = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  // ==========================================================================
  // Test 11: Invalid Audience Rejection
  // ==========================================================================
  it('11. rejects invalid token audience with 403 AUDIENCE_MISMATCH on /mcp', async () => {
    const badAudJwt = await makeSignedJwt({
      sub: 'usr_operator',
      aud: 'https://evil-unauthorized-service.com',
      iss: 'personal-study-os-api',
      scope: 'read write',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${badAudJwt}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'ping' }),
    }, makeEnv());

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.error.code).toBe('AUDIENCE_MISMATCH');
  });

  // ==========================================================================
  // Test 12: Missing Read Scope Rejection
  // ==========================================================================
  it('12. rejects get_study_state when token lacks read scope', async () => {
    const writeOnlyJwt = await makeSignedJwt({
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: 'personal-study-os-api',
      scope: 'write', // no read
      scp: ['write'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${writeOnlyJwt}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req_call_1',
        method: 'tools/call',
        params: { name: 'get_study_state', arguments: {} },
      }),
    }, makeEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.error).toBeDefined();
    expect(json.error.message).toContain('read');
  });

  // ==========================================================================
  // Test 13: Missing Write Scope Rejection
  // ==========================================================================
  it('13. rejects record_schedule_decision when token lacks write scope', async () => {
    const readOnlyJwt = await makeSignedJwt({
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: 'personal-study-os-api',
      scope: 'read', // no write
      scp: ['read'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readOnlyJwt}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req_call_write',
        method: 'tools/call',
        params: {
          name: 'record_schedule_decision',
          arguments: { decision: 'Adjusted study slot' },
        },
      }),
    }, makeEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.error).toBeDefined();
    expect(json.error.message).toContain('write');
  });

  // ==========================================================================
  // Test 14: Valid Read Authorization
  // ==========================================================================
  it('14. permits read tools when authorized with read scope', async () => {
    const readJwt = await makeSignedJwt({
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: 'personal-study-os-api',
      scope: 'read',
      scp: ['read'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readJwt}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req_tools',
        method: 'tools/list',
      }),
    }, makeEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.result.tools).toBeDefined();
  });

  // ==========================================================================
  // Test 15: Valid Write Authorization
  // ==========================================================================
  it('15. permits mutation tools when authorized with write scope', async () => {
    const writeJwt = await makeSignedJwt({
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: 'personal-study-os-api',
      scope: 'read write',
      scp: ['read', 'write'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${writeJwt}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req_write',
        method: 'tools/call',
        params: {
          name: 'record_schedule_decision',
          arguments: {
            decision: 'Allocated 2 hours for Pathology',
            decisionType: 'schedule_allocated',
            chapterId: 'chap_hemodynamics',
          },
        },
      }),
    }, makeEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.result).toBeDefined();
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.operation).toBe('record_schedule_decision');
    expect(payload.entityId).toBeDefined();
  });

  // ==========================================================================
  // Test 16: get_study_state through Authorized MCP (Gemini Flow)
  // ==========================================================================
  it('16. executes get_study_state through complete OAuth token exchange', async () => {
    // 1. Authorize
    const authRes = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}&state=spark_state&scope=read+write`,
      { method: 'GET' },
      makeEnv()
    );
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code')!;

    // 2. Token
    const tokenRes = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: testClientSecret,
        code,
        redirect_uri: testRedirectUri,
      }),
    }, makeEnv());
    const tokenData: any = await tokenRes.json();
    const token = tokenData.access_token;

    // 3. Call get_study_state
    const mcpRes = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'spark_study_state_1',
        method: 'tools/call',
        params: {
          name: 'get_study_state',
          arguments: { date: '2026-09-12', timezone: 'UTC' },
        },
      }),
    }, makeEnv());

    expect(mcpRes.status).toBe(200);
    const mcpJson: any = await mcpRes.json();
    expect(mcpJson.result).toBeDefined();
    const resultPayload = JSON.parse(mcpJson.result.content[0].text);
    expect(resultPayload.totalChaptersCount).toBeDefined();
    expect(resultPayload.pendingWorkload).toBeDefined();
    expect(resultPayload.targetStudyWindows).toBeDefined();
  });

  // ==========================================================================
  // Test 17: record_schedule_decision through Authorized MCP
  // ==========================================================================
  it('17. executes record_schedule_decision through complete OAuth token exchange', async () => {
    // Authorize & Exchange
    const authRes = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}&state=spark_state_2&scope=read+write`,
      { method: 'GET' },
      makeEnv()
    );
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code')!;

    const tokenRes = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: testClientSecret,
        code,
        redirect_uri: testRedirectUri,
      }),
    }, makeEnv());
    const token = (await tokenRes.json() as any).access_token;

    const mcpRes = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'spark_schedule_decision_1',
        method: 'tools/call',
        params: {
          name: 'record_schedule_decision',
          arguments: {
            decisionType: 'schedule_adjusted',
            decision: 'Shifted Hemodynamics review to 14:00',
            rationale: 'Conflict detected with clinical rounds',
            chapterId: 'chap_hemodynamics',
            startTime: '2026-09-12T14:00:00Z',
            endTime: '2026-09-12T16:00:00Z',
            idempotencyKey: 'idemp_spark_decision_99',
          },
        },
      }),
    }, makeEnv());

    expect(mcpRes.status).toBe(200);
    const mcpJson: any = await mcpRes.json();
    const result = JSON.parse(mcpJson.result.content[0].text);
    expect(result.success).toBe(true);
    expect(result.operation).toBe('record_schedule_decision');
    expect(result.data.decisionType).toBe('schedule_adjusted');
    expect(result.data.decisionId).toBeDefined();
  });

  // ==========================================================================
  // Test 18: Idempotent Replay Enforcement
  // ==========================================================================
  it('18. enforces idempotent replay on duplicate decisions and single-use authorization codes', async () => {
    // 1. Replaying the exact same authorization code is rejected
    const authRes = await app.request(
      `/oauth/authorize?response_type=code&client_id=${testClientId}&redirect_uri=${encodeURIComponent(
        testRedirectUri
      )}&state=spark_replay&scope=read+write`,
      { method: 'GET' },
      makeEnv()
    );
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code')!;

    const tokenRes1 = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: testClientSecret,
        code,
        redirect_uri: testRedirectUri,
      }),
    }, makeEnv());
    expect(tokenRes1.status).toBe(200);

    // Second exchange of same code MUST fail
    const tokenRes2 = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: testClientId,
        client_secret: testClientSecret,
        code,
        redirect_uri: testRedirectUri,
      }),
    }, makeEnv());
    expect(tokenRes2.status).toBe(400);
    const json2: any = await tokenRes2.json();
    expect(json2.error_description).toContain('already been used');

    // 2. Replaying record_schedule_decision with same idempotency key returns cached result
    const token = (await tokenRes1.json() as any).access_token;
    const callArgs = {
      decisionType: 'schedule_allocated',
      decision: 'Initial slot allocation',
      idempotency_key: 'idemp_spark_unique_101',
    };

    const firstCall = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/call',
        params: { name: 'record_schedule_decision', arguments: callArgs },
      }),
    }, makeEnv());
    const res1 = JSON.parse((await firstCall.json() as any).result.content[0].text);

    const secondCall = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        method: 'tools/call',
        params: { name: 'record_schedule_decision', arguments: callArgs },
      }),
    }, makeEnv());
    const res2 = JSON.parse((await secondCall.json() as any).result.content[0].text);

    expect(res2.replayed).toBe(true);
    expect(res2.decisionId).toBe(res1.decisionId);
  });

  // ==========================================================================
  // Test 19: Raw SQL Rejection Gate
  // ==========================================================================
  it('19. rejects raw SQL queries and sql injection attempts in MCP parameters', async () => {
    const validJwt = await makeSignedJwt({
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: 'personal-study-os-api',
      scope: 'read write',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const sqlAttempts = [
      { name: 'query_sql', arguments: {} },
      { name: 'get_study_state', arguments: { date: '2026-09-12; SELECT * FROM canonical_events;' } },
      { name: 'record_schedule_decision', arguments: { decision: 'DROP TABLE users;--' } },
    ];

    for (const attempt of sqlAttempts) {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validJwt}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'sql_test',
          method: 'tools/call',
          params: attempt,
        }),
      }, makeEnv());

      const json: any = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.message).toContain('forbidden');
    }
  });

  // ==========================================================================
  // Test 20: Gemini Spark Tool Surface Isolation
  // ==========================================================================
  it('20. restricts Gemini Spark client strictly to get_study_state and record_schedule_decision', async () => {
    // Issue token with client_id: 'gemini-spark'
    const sparkJwt = await makeSignedJwt({
      sub: 'usr_operator',
      aud: 'https://api.personal-os.com/mcp',
      iss: 'personal-study-os-api',
      client_id: 'gemini-spark',
      scope: 'read write',
      scp: ['read', 'write'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    // 1. tools/list should strictly return exactly 2 tools for Gemini Spark
    const listRes = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sparkJwt}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'list_spark',
        method: 'tools/list',
      }),
    }, makeEnv());

    expect(listRes.status).toBe(200);
    const listJson: any = await listRes.json();
    const toolNames = listJson.result.tools.map((t: any) => t.name);
    expect(toolNames).toHaveLength(2);
    expect(toolNames).toEqual(['get_study_state', 'record_schedule_decision']);

    // 2. Calling an unauthorized tool (e.g. checkpoint) is blocked
    const callRes = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sparkJwt}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call_checkpoint',
        method: 'tools/call',
        params: { name: 'checkpoint', arguments: { action: 'list' } },
      }),
    }, makeEnv());

    expect(callRes.status).toBe(200);
    const callJson: any = await callRes.json();
    expect(callJson.error).toBeDefined();
    expect(callJson.error.message).toContain('Forbidden: Tool \'checkpoint\' is not permitted for Gemini Spark client');
  });
});
