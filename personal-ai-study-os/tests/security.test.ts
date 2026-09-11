import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import app from '../apps/worker/src/index';
import { EntitiesRepository } from '@personal-os/db';
import { Subject, Chapter } from '@personal-os/domain';
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
});
