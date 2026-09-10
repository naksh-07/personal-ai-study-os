import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import app from '../apps/worker/src/index';
import { EntitiesRepository } from '@personal-os/db';
import { Subject, Chapter, Project } from '@personal-os/domain';
import crypto from 'node:crypto';

describe('Slice 3: Semantic REST State API', () => {
  let ctx: TestContext;
  const envSecret = 'test_notion_secret_key';

  const testSubjectId = 'subj_cardio';
  const testChapterId = 'chap_ecg';
  const testProjectId = 'proj_ai_study';

  function makeJwt(payload: Record<string, any>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.mock_signature`;
  }

  const readToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const writeToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const adminToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const invalidAudienceToken = makeJwt({
    sub: 'usr_operator',
    aud: 'https://evil.api.attacker.com',
    scope: 'read write admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const expiredToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write admin',
    exp: Math.floor(Date.now() / 1000) - 3600,
  });

  const makeEnv = () => ({
    DB: ctx.d1,
    ENVIRONMENT: 'test',
    NOTION_WEBHOOK_SECRET: envSecret,
  });

  beforeEach(async () => {
    ctx = createTestDatabase();
    const now = new Date().toISOString();

    // Seed operator user
    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'UTC',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    // Seed Subject
    const subject: Subject = {
      id: testSubjectId,
      name: 'Cardiology',
      slug: 'cardiology',
      description: 'Cardiovascular Medicine',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertSubject(ctx.db, subject);

    // Seed Chapter
    const chapter: Chapter = {
      id: testChapterId,
      subjectId: testSubjectId,
      name: 'Electrocardiogram',
      slug: 'ecg',
      status: 'not_started',
      progress: 0.0,
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter);

    // Seed Project
    const project: Project = {
      id: testProjectId,
      name: 'AI Study Assistant',
      description: 'Personal study companion',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertProject(ctx.db, project);
  });

  describe('1. Health and Status Endpoints', () => {
    it('GET /health returns 200 with healthy status', async () => {
      const res = await app.request('/health', {}, makeEnv());
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.status).toBe('healthy');
      expect(json.environment).toBe('test');
    });

    it('GET /v1/status returns 200 with system status and event count', async () => {
      const res = await app.request('/v1/status', {}, makeEnv());
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.system).toBe('Personal AI Study OS');
      expect(json.operatorConfigured).toBe(true);
      expect(json.status).toBe('online');
    });
  });

  describe('2. OAuth 2.1 Audience and Scope Validation', () => {
    it('rejects unauthenticated requests to protected endpoints with 401', async () => {
      const res = await app.request('/v1/state/today', {}, makeEnv());
      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.category).toBe('authorization');
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.meta.requestId).toBeDefined();
    });

    it('rejects expired token with 401', async () => {
      const res = await app.request(
        '/v1/state/today',
        { headers: { Authorization: `Bearer ${expiredToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('expired');
    });

    it('rejects unauthorized audience token with 403', async () => {
      const res = await app.request(
        '/v1/state/today',
        { headers: { Authorization: `Bearer ${invalidAudienceToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.category).toBe('authorization');
      expect(json.error.message).toContain('audience');
    });

    it('rejects read-only token on write mutation endpoint with 403', async () => {
      const res = await app.request(
        '/v1/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${readToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            eventType: 'note_created',
            payload: { noteId: 'note_1' },
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.category).toBe('authorization');
      expect(json.error.message).toContain('write');
    });

    it('accepts valid write token on write endpoint', async () => {
      const res = await app.request(
        '/v1/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            eventType: 'study_started',
            payload: { chapterId: testChapterId, subjectId: testSubjectId },
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.eventId).toBeDefined();
    });

    it('supports mock token bypass for tests (mock-read, mock-write, mock-admin)', async () => {
      const res = await app.request(
        '/v1/state/today',
        { headers: { Authorization: 'Bearer mock-read' } },
        makeEnv()
      );
      expect(res.status).toBe(200);
    });
  });

  describe('3. Semantic Read Endpoints & Dual Route Aliases', () => {
    it('1. GET /v1/state/today returns today state envelope', async () => {
      const res = await app.request(
        '/v1/state/today?date=2026-09-11',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.date).toBe('2026-09-11');
      expect(json.meta.requestId).toBeDefined();
      expect(json.meta.correlationId).toBeDefined();
    });

    it('2. GET /v1/state/study & GET /v1/study/progress returns study state', async () => {
      const res1 = await app.request(
        '/v1/state/study',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res1.status).toBe(200);
      const json1: any = await res1.json();
      expect(json1.data.subjectSummaries.length).toBeGreaterThanOrEqual(1);

      const res2 = await app.request(
        '/v1/study/progress',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res2.status).toBe(200);
      const json2: any = await res2.json();
      expect(json2.data.subjectSummaries.length).toBe(json1.data.subjectSummaries.length);
    });

    it('3. GET /v1/state/subjects/:id returns subject state, 404 for unknown', async () => {
      const res = await app.request(
        `/v1/state/subjects/${testSubjectId}`,
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.subject.id).toBe(testSubjectId);

      const res404 = await app.request(
        '/v1/state/subjects/subj_missing',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res404.status).toBe(404);
    });

    it('4. GET /v1/state/chapters/:id returns chapter state, 404 for unknown', async () => {
      const res = await app.request(
        `/v1/state/chapters/${testChapterId}`,
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.chapter.id).toBe(testChapterId);

      const res404 = await app.request(
        '/v1/state/chapters/chap_missing',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res404.status).toBe(404);
    });

    it('5. Dual aliases: /v1/activity/recent and /v1/state/activity', async () => {
      const res1 = await app.request(
        '/v1/activity/recent?limit=5',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res1.status).toBe(200);

      const res2 = await app.request(
        '/v1/state/activity?limit=5',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res2.status).toBe(200);
    });

    it('6. Dual aliases: /v1/work/pending and /v1/state/work', async () => {
      const res1 = await app.request(
        '/v1/work/pending',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res1.status).toBe(200);

      const res2 = await app.request(
        '/v1/state/work',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res2.status).toBe(200);
    });

    it('7. Dual aliases: /v1/schedule/context and /v1/state/schedule', async () => {
      const res1 = await app.request(
        '/v1/schedule/context?date=2026-09-11',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res1.status).toBe(200);

      const res2 = await app.request(
        '/v1/state/schedule?date=2026-09-11',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res2.status).toBe(200);
    });

    it('8. GET /v1/memory/search returns memory facts search envelope', async () => {
      const res = await app.request(
        '/v1/memory/search?q=cardiology',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(Array.isArray(json.data.items)).toBe(true);
    });

    it('9. Dual aliases: /v1/projects/:id and /v1/state/projects/:id', async () => {
      const res1 = await app.request(
        `/v1/projects/${testProjectId}`,
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res1.status).toBe(200);
      const json1: any = await res1.json();
      expect(json1.data.project.id).toBe(testProjectId);

      const res2 = await app.request(
        `/v1/state/projects/${testProjectId}`,
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res2.status).toBe(200);
    });

    it('10. GET /v1/sync/status returns sync status and queue metrics', async () => {
      const res = await app.request(
        '/v1/sync/status',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.healthy).toBeDefined();
      expect(json.data.activeJobs).toBeDefined();
    });
  });

  describe('4. Semantic Mutation Endpoints & Idempotency Header', () => {
    it('recordStudySession creates session and produces 201', async () => {
      const res = await app.request(
        '/v1/study/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chapterId: testChapterId,
            subjectId: testSubjectId,
            startedAt: '2026-09-11T10:00:00.000Z',
            endedAt: '2026-09-11T10:30:00.000Z',
            durationSeconds: 1800,
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.success).toBe(true);
      expect(json.data.operation).toBe('record_study_session');
    });

    it('updateProgress updates chapter progress with 200', async () => {
      const res = await app.request(
        '/v1/study/progress',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chapterId: testChapterId,
            progress: 0.5,
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.success).toBe(true);
      expect(json.data.data.progress).toBe(0.5);
    });

    it('completeChapter completes chapter (supports dual aliases)', async () => {
      const res = await app.request(
        `/v1/chapters/${testChapterId}/complete`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subjectId: testSubjectId,
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.data.status).toBe('completed');
    });

    it('recordResearch creates research event with 201', async () => {
      const res = await app.request(
        '/v1/research',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            topic: 'Arrhythmia Diagnostics',
            source: 'PubMed Review',
            summary: 'WPW syndrome delta wave findings indicate bypass tract.',
            takeaways: ['Delta wave indicates pre-excitation'],
            chapterId: testChapterId,
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.success).toBe(true);
      expect(json.data.operation).toBe('record_research');
    });

    it('recordDecision logs decision with 201', async () => {
      const res = await app.request(
        '/v1/decisions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: 'Spaced repetition scheduling algorithm',
            context: 'Optimal retention for board examination prep',
            decision: 'Adopt Anki SM-2 spaced repetition algorithm',
            consequences: 'Requires daily scheduled reviews',
            projectId: testProjectId,
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.success).toBe(true);
      expect(json.data.operation).toBe('record_decision');
    });

    it('linkTask links external task with 201', async () => {
      const res = await app.request(
        '/v1/links/tasks',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: 'notion',
            tasklistId: 'list_study_todos',
            taskId: 'task_ecg_interpret_01',
            entityType: 'chapter',
            entityId: testChapterId,
            titleSnapshot: 'Complete ECG Interpretation practice set',
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.success).toBe(true);
      expect(json.data.operation).toBe('link_task');
    });

    it('linkCalendar links calendar event with 201', async () => {
      const res = await app.request(
        '/v1/links/calendar',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: 'google_calendar',
            calendarId: 'primary',
            eventId: 'cal_event_9988',
            entityType: 'study_session',
            entityId: testChapterId,
            titleSnapshot: 'Cardiology Block Review',
            startsAt: '2026-09-11T14:00:00.000Z',
            endsAt: '2026-09-11T15:00:00.000Z',
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.success).toBe(true);
      expect(json.data.operation).toBe('link_calendar_event');
    });

    it('verifies Idempotency-Key deduplication, cached 200 replay, and 409 conflict', async () => {
      const idemKey = 'ik_unique_rest_req_123';
      const initialPayload = {
        chapterId: testChapterId,
        subjectId: testSubjectId,
        startedAt: '2026-09-11T09:00:00.000Z',
        endedAt: '2026-09-11T09:15:00.000Z',
        durationSeconds: 900,
      };

      // 1. Initial Request -> 201 Created
      const res1 = await app.request(
        '/v1/study/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idemKey,
          },
          body: JSON.stringify(initialPayload),
        },
        makeEnv()
      );
      expect(res1.status).toBe(201);
      const json1: any = await res1.json();
      expect(json1.data.eventId).toBeDefined();

      // 2. Identical Replay Request -> 200 OK with cached response
      const res2 = await app.request(
        '/v1/study/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idemKey,
          },
          body: JSON.stringify(initialPayload),
        },
        makeEnv()
      );
      expect(res2.status).toBe(200);
      const json2: any = await res2.json();
      expect(json2.data.eventId).toBe(json1.data.eventId);

      // 3. Divergent Payload with same Idempotency-Key -> 409 Conflict
      const res3 = await app.request(
        '/v1/study/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idemKey,
          },
          body: JSON.stringify({
            chapterId: testChapterId,
            subjectId: testSubjectId,
            startedAt: '2026-09-11T09:00:00.000Z',
            endedAt: '2026-09-11T11:46:39.000Z',
            durationSeconds: 9999, // Divergent!
          }),
        },
        makeEnv()
      );
      expect(res3.status).toBe(409);
      const json3: any = await res3.json();
      expect(json3.error.category).toBe('idempotency_conflict');
      expect(json3.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  describe('5. Notion Webhook HMAC & Deduplication', () => {
    it('verifies valid HMAC signature and processes webhook', async () => {
      const webhookPayload = JSON.stringify({
        id: 'notion_evt_1001',
        type: 'page_updated',
        page_id: 'pg_123',
      });
      const validHmac = crypto
        .createHmac('sha256', envSecret)
        .update(webhookPayload)
        .digest('hex');

      const res = await app.request(
        '/v1/webhooks/notion',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Notion-Signature': validHmac,
          },
          body: webhookPayload,
        },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.status).toBe('processed');

      // Duplicate webhook delivery -> deduplicated
      const resDup = await app.request(
        '/v1/webhooks/notion',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Notion-Signature': validHmac,
          },
          body: webhookPayload,
        },
        makeEnv()
      );
      expect(resDup.status).toBe(200);
      const jsonDup: any = await resDup.json();
      expect(jsonDup.status).toBe('deduplicated');
    });

    it('rejects webhook with invalid HMAC signature with 401', async () => {
      const res = await app.request(
        '/v1/webhooks/notion',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Notion-Signature': 'invalid_signature_hex',
          },
          body: JSON.stringify({ id: 'evt_bad' }),
        },
        makeEnv()
      );
      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error.message).toContain('Invalid Notion webhook signature');
    });
  });

  describe('6. Admin Endpoints & Projection Rebuild', () => {
    it('executes projection rebuild when called with admin token', async () => {
      const res = await app.request(
        '/v1/admin/rebuild-projections',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.status).toBe('success');
      expect(json.data.eventsProcessed).toBeDefined();
    });

    it('rejects projection rebuild when called with non-admin token with 403', async () => {
      const res = await app.request(
        '/v1/admin/rebuild-projections',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${writeToken}` },
        },
        makeEnv()
      );
      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.category).toBe('authorization');
    });

    it('executes outbox sweep when called with admin token', async () => {
      const res = await app.request(
        '/v1/admin/dispatch-outbox',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        },
        makeEnv()
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.dispatchedCount).toBeDefined();
    });
  });

  describe('7. RFC 7807 Error Safety and Format Invariants', () => {
    it('returns structured 404 for unknown endpoints', async () => {
      const res = await app.request(
        '/v1/non-existent-endpoint',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(404);
      const json: any = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.category).toBe('not_found');
      expect(json.meta.requestId).toBeDefined();
      expect(json.meta.correlationId).toBeDefined();
    });

    it('returns structured 400 validation error for malformed input payloads', async () => {
      const res = await app.request(
        '/v1/study/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${writeToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chapterId: '', // Invalid empty chapterId
            subjectId: testSubjectId,
            durationSeconds: -100, // Invalid negative duration
          }),
        },
        makeEnv()
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error.category).toBe('validation');
      expect(json.meta.requestId).toBeDefined();
    });

    it('never leaks stack traces or secrets in error responses', async () => {
      const res = await app.request(
        '/v1/state/subjects/subj_missing_one',
        { headers: { Authorization: `Bearer ${readToken}` } },
        makeEnv()
      );
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain('stack');
      expect(text).not.toContain('at Object');
      expect(text).not.toContain(envSecret);
    });
  });
});
