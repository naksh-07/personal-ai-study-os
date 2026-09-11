import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import app from '../apps/worker/src/index';
import { EntitiesRepository } from '@personal-os/db';
import { Subject, Chapter, classifyError } from '@personal-os/domain';
import crypto from 'node:crypto';

describe('Slice 4: Security & OAuth 2.1 Boundary Test Suite', () => {
  let ctx: TestContext;
  const testSecret = 'super_secure_test_jwt_secret_key_12345!';
  const notionSecret = 'test_notion_hmac_secret_key_98765';

  const testSubjectId = 'subj_pathology';
  const testChapterId = 'chap_inflammation';

  // Helper to create WebCrypto/HMAC signed JWTs
  async function createSignedJwt(payload: Record<string, any>, secret: string): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${b64Header}.${b64Payload}`;

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(unsignedToken);
    const signature = hmac.digest('base64url');

    return `${unsignedToken}.${signature}`;
  }

  // Helper to create JWTs with custom header (for alg testing)
  async function createCustomJwt(
    header: Record<string, any>,
    payload: Record<string, any>,
    secret?: string
  ): Promise<string> {
    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${b64Header}.${b64Payload}`;

    if (!secret) {
      return `${unsignedToken}.unsigned_mock_sig`;
    }
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(unsignedToken);
    const signature = hmac.digest('base64url');
    return `${unsignedToken}.${signature}`;
  }


  const makeEnv = (overrides?: Record<string, any>) => ({
    DB: ctx.d1,
    ENVIRONMENT: 'test',
    JWT_SECRET: testSecret,
    NOTION_WEBHOOK_SECRET: notionSecret,
    ...overrides,
  });

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
      id: testSubjectId,
      name: 'Pathology',
      slug: 'pathology',
      description: 'General pathology',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertSubject(ctx.db, subject);

    const chapter: Chapter = {
      id: testChapterId,
      subjectId: testSubjectId,
      name: 'Inflammation and Repair',
      slug: 'inflammation-repair',
      progress: 0,
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter);
  });

  // ==========================================================================
  // 1. Authentication & Signature Verification
  // ==========================================================================
  describe('OAuth 2.1 Bearer Token Authentication', () => {
    it('returns 401 UNAUTHORIZED when Authorization header is completely missing', async () => {
      const res = await app.request('/v1/state/today', {
        method: 'GET',
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED when Authorization header is malformed (not Bearer)', async () => {
      const res = await app.request('/v1/state/today', {
        method: 'GET',
        headers: { Authorization: 'Basic some_creds' },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED when token has invalid structure', async () => {
      const res = await app.request('/v1/state/today', {
        method: 'GET',
        headers: { Authorization: 'Bearer this.is.not.valid.jwt' },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED when token signature is explicitly invalid', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');
      const invalidToken = `${header}.${payload}.invalid_signature`;

      const res = await app.request('/v1/state/today', {
        method: 'GET',
        headers: { Authorization: `Bearer ${invalidToken}` },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED when token has expired beyond skew buffer', async () => {
      const expiredToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) - 60, // 60s expired (exceeds 30s skew)
      }, testSecret);

      const res = await app.request('/v1/state/today', {
        method: 'GET',
        headers: { Authorization: `Bearer ${expiredToken}` },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.error.message).toContain('expired');
    });

    it('validates genuine cryptographic HMAC-SHA256 signature against JWT_SECRET', async () => {
      const validToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/state/today', {
        method: 'GET',
        headers: { Authorization: `Bearer ${validToken}` },
      }, makeEnv());

      expect(res.status).toBe(200);
    });

    it('rejects token signed with wrong HMAC secret', async () => {
      const forgedToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read write admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, 'wrong_attacker_secret_key');

      const res = await app.request('/v1/state/today', {
        method: 'GET',
        headers: { Authorization: `Bearer ${forgedToken}` },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ==========================================================================
  // 2. Audience Validation (OAuth 2.1 Audience Guard)
  // ==========================================================================
  describe('Audience Guard (AUDIENCE_MISMATCH)', () => {
    it('allows all approved audience identifiers', async () => {
      const audiences = [
        'personal-ai-study-os',
        'https://api.personal-os.com/',
        'https://api.personal-os.com',
        'personal-study-os-api',
        'https://api.personal-os.com/mcp',
      ];

      for (const aud of audiences) {
        const token = await createSignedJwt({
          sub: 'usr_operator',
          aud,
          scope: 'read',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }, testSecret);

        const res = await app.request('/v1/state/today', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }, makeEnv());

        expect(res.status).toBe(200);
      }
    });

    it('strictly rejects unauthorized audience with 403 AUDIENCE_MISMATCH', async () => {
      const unauthorizedAudiences = [
        'https://evil.attacker.com',
        'google-cloud-project',
        'other-application-api',
      ];

      for (const aud of unauthorizedAudiences) {
        const token = await createSignedJwt({
          sub: 'usr_operator',
          aud,
          scope: 'read write admin',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }, testSecret);

        const res = await app.request('/v1/state/today', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }, makeEnv());

        expect(res.status).toBe(403);
        const json: any = await res.json();
        expect(json.error.category).toBe('authorization');
        expect(json.error.message).toContain('AUDIENCE_MISMATCH');
      }
    });
  });

  // ==========================================================================
  // 3. Scope Enforcement (read, write, admin)
  // ==========================================================================
  describe('Scope Enforcement Boundary', () => {
    it('rejects mutation endpoint when token has only read scope', async () => {
      const readToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/study/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          chapterId: testChapterId,
          subjectId: testSubjectId,
          durationSeconds: 1200,
          activityType: 'deep_work',
        }),
      }, makeEnv());

      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.category).toBe('authorization');
    });

    it('allows mutation endpoint when token has write scope', async () => {
      const writeToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read write',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/study/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          chapterId: testChapterId,
          subjectId: testSubjectId,
          durationSeconds: 1200,
          activityType: 'deep_work',
          startedAt: new Date(Date.now() - 1200000).toISOString(),
          endedAt: new Date().toISOString(),
          source: 'study_app',
        }),
      }, makeEnv());

      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.entityId).toBeDefined();
    });

    it('rejects admin route when token has write scope but lacks admin', async () => {
      const writeToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read write',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/admin/rebuild-projections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({}),
      }, makeEnv());

      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.category).toBe('authorization');
    });

    it('allows admin route when token has admin scope', async () => {
      const adminToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read write admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/admin/rebuild-projections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({}),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.status).toBe('success');
    });
  });

  // ==========================================================================
  // 4. Notion Webhook Security (6-Stage Ingestion Pipeline)
  // ==========================================================================
  describe('Notion Webhook Security Pipeline', () => {
    const rawBody = JSON.stringify({
      id: 'webhook_evt_1',
      type: 'page_updated',
      page_id: 'page_123',
      properties: {
        progress: 0.8,
      },
    });

    function generateHmac(body: string, secret: string): string {
      return crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    it('rejects webhook with 401 when x-notion-signature header is missing', async () => {
      const res = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-delivery-id': 'deliv_missing_sig',
        },
        body: rawBody,
      }, makeEnv());

      expect(res.status).toBe(401);
    });

    it('rejects webhook with 401 when x-notion-signature is forged or invalid', async () => {
      const res = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-delivery-id': 'deliv_forged_sig',
          'x-notion-signature': 'invalid_signature_hex_1234567890abcdef',
        },
        body: rawBody,
      }, makeEnv());

      expect(res.status).toBe(401);
    });

    it('accepts webhook with 200 when signature is valid', async () => {
      const validSig = generateHmac(rawBody, notionSecret);
      const deliveryId = 'deliv_valid_' + Date.now();

      const res = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-delivery-id': deliveryId,
          'x-notion-signature': validSig,
        },
        body: rawBody,
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.status).toBe('processed');
    });

    it('guarantees idempotency on duplicate webhook delivery (replayed delivery ID)', async () => {
      const validSig = generateHmac(rawBody, notionSecret);
      const deliveryId = 'deliv_replay_' + Date.now();

      // First delivery
      const res1 = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-delivery-id': deliveryId,
          'x-notion-signature': validSig,
        },
        body: rawBody,
      }, makeEnv());
      expect(res1.status).toBe(200);

      // Replay delivery with same body & ID
      const res2 = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-delivery-id': deliveryId,
          'x-notion-signature': validSig,
        },
        body: rawBody,
      }, makeEnv());

      expect(res2.status).toBe(200);
      const json2: any = await res2.json();
      expect(json2.status).toBe('deduplicated');
    });
  });

  // ==========================================================================
  // 5. SEC-01: Mock Token Backdoor Prevention
  // ==========================================================================
  describe('SEC-01: Mock Token Backdoor Prevention', () => {
    it('strictly rejects mock tokens in staging environment with 401', async () => {
      for (const token of ['mock-read', 'mock-write', 'mock-admin']) {
        const res = await app.request('/v1/state/today', {
          headers: { Authorization: `Bearer ${token}` },
        }, makeEnv({ ENVIRONMENT: 'staging' }));

        expect(res.status).toBe(401);
        const json: any = await res.json();
        expect(json.error.code).toBe('UNAUTHORIZED');
        expect(json.error.message).toContain('Mock tokens are only permitted in test environment');
      }
    });

    it('strictly rejects mock tokens in production environment with 401', async () => {
      const res = await app.request('/v1/state/today', {
        headers: { Authorization: 'Bearer mock-admin' },
      }, makeEnv({ ENVIRONMENT: 'production' }));

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.error.message).toContain('Mock tokens are only permitted in test environment');
    });

    it('strictly rejects mock tokens in development environment with 401', async () => {
      const res = await app.request('/v1/state/today', {
        headers: { Authorization: 'Bearer mock-read' },
      }, makeEnv({ ENVIRONMENT: 'development' }));

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts mock tokens strictly in test environment', async () => {
      const res = await app.request('/v1/state/today', {
        headers: { Authorization: 'Bearer mock-read' },
      }, makeEnv({ ENVIRONMENT: 'test' }));

      expect(res.status).toBe(200);
    });

    it('strictly rejects SKIP_AUTH in staging and production with 401', async () => {
      const stagingRes = await app.request('/v1/state/today', {}, makeEnv({
        ENVIRONMENT: 'staging',
        SKIP_AUTH: 'true',
      }));
      expect(stagingRes.status).toBe(401);
      const stagingJson: any = await stagingRes.json();
      expect(stagingJson.error.message).toContain('SKIP_AUTH is only permitted in test environment');

      const prodRes = await app.request('/v1/state/today', {}, makeEnv({
        ENVIRONMENT: 'production',
        SKIP_AUTH: 'true',
      }));
      expect(prodRes.status).toBe(401);
    });

    it('allows SKIP_AUTH strictly in test environment', async () => {
      const res = await app.request('/v1/state/today', {}, makeEnv({
        ENVIRONMENT: 'test',
        SKIP_AUTH: 'true',
      }));
      expect(res.status).toBe(200);
    });

    it('strictly rejects mock tokens on MCP streamable HTTP in staging with 401', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-read',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'mcp_sec_1', method: 'ping' }),
      }, makeEnv({ ENVIRONMENT: 'staging' }));

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Mock tokens are only permitted in test environment');
    });

    it('strictly rejects SKIP_AUTH on MCP streamable HTTP in staging with 401', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'mcp_sec_2', method: 'ping' }),
      }, makeEnv({ ENVIRONMENT: 'staging', SKIP_AUTH: 'true' }));

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('SKIP_AUTH is only permitted in test environment');
    });

    it('accepts mock tokens on MCP streamable HTTP strictly in test environment', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-read',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'mcp_sec_3', method: 'ping' }),
      }, makeEnv({ ENVIRONMENT: 'test' }));

      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // 6. SEC-02: JWT Verification Fail-Closed
  // ==========================================================================
  describe('SEC-02: JWT Verification Fail-Closed', () => {
    it('rejects authentication with 401 when JWT_SECRET is unconfigured (undefined)', async () => {
      const validToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${validToken}` },
      }, makeEnv({ JWT_SECRET: undefined }));

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.error.message).toContain('Server authentication secret is unconfigured');
    });

    it('rejects authentication with 401 when JWT_SECRET is empty string or whitespace', async () => {
      const validToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const resEmpty = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${validToken}` },
      }, makeEnv({ JWT_SECRET: '' }));
      expect(resEmpty.status).toBe(401);
      const jsonEmpty: any = await resEmpty.json();
      expect(jsonEmpty.error.message).toContain('Server authentication secret is unconfigured');

      const resWhitespace = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${validToken}` },
      }, makeEnv({ JWT_SECRET: '    ' }));
      expect(resWhitespace.status).toBe(401);
      const jsonWs: any = await resWhitespace.json();
      expect(jsonWs.error.message).toContain('Server authentication secret is unconfigured');
    });

    it('strictly rejects tokens with unsupported algorithms (alg=none, alg=RS256, etc.) with 401', async () => {
      const noneToken = await createCustomJwt(
        { alg: 'none', typ: 'JWT' },
        { sub: 'usr_operator', aud: 'personal-ai-study-os', scope: 'read', exp: Math.floor(Date.now() / 1000) + 3600 }
      );

      const resNone = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${noneToken}` },
      }, makeEnv());

      expect(resNone.status).toBe(401);
      const jsonNone: any = await resNone.json();
      expect(jsonNone.error.message).toContain("Unsupported token algorithm 'none' (expected HS256)");

      const rs256Token = await createCustomJwt(
        { alg: 'RS256', typ: 'JWT' },
        { sub: 'usr_operator', aud: 'personal-ai-study-os', scope: 'read', exp: Math.floor(Date.now() / 1000) + 3600 },
        testSecret
      );

      const resRs = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${rs256Token}` },
      }, makeEnv());

      expect(resRs.status).toBe(401);
      const jsonRs: any = await resRs.json();
      expect(jsonRs.error.message).toContain("Unsupported token algorithm 'RS256' (expected HS256)");
    });

    it('cryptographically rejects forged signatures via crypto.subtle.verify with 401', async () => {
      const validToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const parts = validToken.split('.');
      // Tamper signature by replacing last 4 characters
      const forgedSig = parts[2].substring(0, parts[2].length - 4) + 'AAAA';
      const forgedToken = `${parts[0]}.${parts[1]}.${forgedSig}`;

      const res = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${forgedToken}` },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.error.message).toBe('Unauthorized: Invalid JWT signature');
    });
  });

  // ==========================================================================
  // 7. SEC-06: Mandatory JWT Claims Enforcement
  // ==========================================================================
  describe('SEC-06: Mandatory JWT Claims Enforcement', () => {
    it('strictly rejects token without mandatory sub claim with 401', async () => {
      const token = await createSignedJwt({
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${token}` },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Token missing mandatory subject (sub) claim');
    });

    it('strictly rejects token with empty sub claim with 401', async () => {
      const token = await createSignedJwt({
        sub: '   ',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${token}` },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Token missing mandatory subject (sub) claim');
    });

    it('strictly rejects token without mandatory exp claim with 401', async () => {
      const token = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
      }, testSecret);

      const res = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${token}` },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Token missing mandatory expiration (exp) claim');
    });

    it('strictly rejects token with non-numeric exp claim with 401', async () => {
      const token = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: '2026-12-31T00:00:00Z',
      }, testSecret);

      const res = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${token}` },
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Token missing mandatory expiration (exp) claim');
    });

    it('enforces 30-second clock skew buffer for expired tokens', async () => {
      // 10s expired -> within 30s buffer -> ACCEPTED (200)
      const withinSkewToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) - 10,
      }, testSecret);

      const resWithin = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${withinSkewToken}` },
      }, makeEnv());
      expect(resWithin.status).toBe(200);

      // 35s expired -> exceeds 30s buffer -> REJECTED (401)
      const beyondSkewToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) - 35,
      }, testSecret);

      const resBeyond = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${beyondSkewToken}` },
      }, makeEnv());
      expect(resBeyond.status).toBe(401);
      const jsonBeyond: any = await resBeyond.json();
      expect(jsonBeyond.error.message).toContain('Token has expired');
    });

    it('validates issuer when AUTH_ISSUER is configured', async () => {
      const issuer = 'https://auth.personal-os.com';

      // Missing iss claim -> 401
      const tokenNoIss = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const resNoIss = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${tokenNoIss}` },
      }, makeEnv({ AUTH_ISSUER: issuer }));

      expect(resNoIss.status).toBe(401);
      const jsonNoIss: any = await resNoIss.json();
      expect(jsonNoIss.error.message).toContain("Invalid or missing token issuer 'none'");

      // Wrong iss claim -> 401
      const tokenWrongIss = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        iss: 'https://evil.idp.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const resWrongIss = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${tokenWrongIss}` },
      }, makeEnv({ AUTH_ISSUER: issuer }));

      expect(resWrongIss.status).toBe(401);
      const jsonWrongIss: any = await resWrongIss.json();
      expect(jsonWrongIss.error.message).toContain("Invalid or missing token issuer 'https://evil.idp.com'");

      // Valid matching iss claim -> 200
      const tokenValidIss = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read',
        iss: issuer,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const resValidIss = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${tokenValidIss}` },
      }, makeEnv({ AUTH_ISSUER: issuer }));

      expect(resValidIss.status).toBe(200);
    });

    it('strictly rejects token missing mandatory aud claim with 403 AUDIENCE_MISMATCH', async () => {
      const tokenNoAud = await createSignedJwt({
        sub: 'usr_operator',
        scope: 'read',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const res = await app.request('/v1/state/today', {
        headers: { Authorization: `Bearer ${tokenNoAud}` },
      }, makeEnv());

      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.category).toBe('authorization');
      expect(json.error.message).toContain('Token missing mandatory audience (aud) claim');
    });
  });


  // ==========================================================================
  // 8. SEC-03: Notion Webhook Fail-Closed & Fixed 32-Byte Constant-Time Check
  // ==========================================================================
  describe('SEC-03: Notion Webhook Fail-Closed Pipeline', () => {
    const rawBody = JSON.stringify({
      id: 'webhook_sec03_1',
      type: 'page_updated',
      page_id: 'page_sec_1',
    });

    it('rejects webhook with 401 when NOTION_WEBHOOK_SECRET is unconfigured (undefined)', async () => {
      const res = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-signature': 'a'.repeat(64),
        },
        body: rawBody,
      }, makeEnv({ NOTION_WEBHOOK_SECRET: undefined }));

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Notion webhook secret is unconfigured');
    });

    it('rejects webhook with 401 when NOTION_WEBHOOK_SECRET is empty string or whitespace', async () => {
      const resEmpty = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-signature': 'a'.repeat(64),
        },
        body: rawBody,
      }, makeEnv({ NOTION_WEBHOOK_SECRET: '' }));

      expect(resEmpty.status).toBe(401);
      const jsonEmpty: any = await resEmpty.json();
      expect(jsonEmpty.error.message).toContain('Notion webhook secret is unconfigured');

      const resWs = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-signature': 'a'.repeat(64),
        },
        body: rawBody,
      }, makeEnv({ NOTION_WEBHOOK_SECRET: '    ' }));

      expect(resWs.status).toBe(401);
    });

    it('rejects webhook with 401 when X-Notion-Signature is missing', async () => {
      const res = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Missing Notion webhook signature');
    });

    it('rejects webhook with 401 when signature length is invalid (not 32-byte SHA-256 buffer)', async () => {
      const shortSig = 'abcdef123456';
      const res = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-signature': shortSig,
        },
        body: rawBody,
      }, makeEnv());

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Invalid Notion webhook signature');
    });
  });

  // ==========================================================================
  // 9. SEC-07: Error Sanitization and Information Leakage Prevention
  // ==========================================================================
  describe('SEC-07: Error Sanitization and Information Leakage Prevention', () => {
    it('masks internal 500 error messages and details in staging environment', async () => {
      const adminToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read write admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      // Faulty DB mock simulating unhandled database crash leaking table and schema info
      const crashingDb = {
        prepare: () => {
          throw new Error('FATAL SQLITE ERROR: table canonical_events corrupted at offset 0xDEADBEEF; internal secret leaked');
        },
      };

      const res = await app.request('/v1/admin/rebuild-projections', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }, makeEnv({ DB: crashingDb, ENVIRONMENT: 'staging' }));

      expect(res.status).toBe(500);
      const json: any = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.category).toBe('internal');
      expect(json.error.message).toBe('An internal error occurred.');
      expect(json.error.details).toBeNull();

      const rawResponse = JSON.stringify(json);
      expect(rawResponse).not.toContain('FATAL SQLITE ERROR');
      expect(rawResponse).not.toContain('0xDEADBEEF');
      expect(rawResponse).not.toContain('canonical_events');
    });

    it('masks internal 500 error messages and details in production environment', async () => {
      const adminToken = await createSignedJwt({
        sub: 'usr_operator',
        aud: 'personal-ai-study-os',
        scope: 'read write admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }, testSecret);

      const crashingDb = {
        prepare: () => {
          throw new Error('CONNECTION TIMEOUT to d1-internal.cloudflare.com: token=secret_db_password');
        },
      };

      const res = await app.request('/v1/admin/rebuild-projections', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }, makeEnv({ DB: crashingDb, ENVIRONMENT: 'production' }));

      expect(res.status).toBe(500);
      const json: any = await res.json();
      expect(json.error.message).toBe('An internal error occurred.');
      expect(json.error.details).toBeNull();
      const rawText = JSON.stringify(json);
      expect(rawText).not.toContain('token=secret_db_password');
    });

    it('classifyError always defaults to generic safe message for unhandled errors', () => {
      const sensitiveError = new Error('Database password is: SuperSecretPassword123!');
      const classified = classifyError(sensitiveError);

      expect(classified.status).toBe(500);
      expect(classified.category).toBe('internal');
      expect(classified.code).toBe('INTERNAL_ERROR');
      expect(classified.message).toBe('An internal error occurred.');
      expect(classified.details).toBeNull();
      expect(classified.message).not.toContain('SuperSecretPassword123!');
    });
  });

});

