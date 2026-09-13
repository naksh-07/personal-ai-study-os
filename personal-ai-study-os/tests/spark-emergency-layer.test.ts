import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTestDatabase, TestContext } from './test-helper';
import { PersonalStateService } from '@personal-os/core';
import { EntitiesRepository } from '@personal-os/db';
import { Subject, Chapter } from '@personal-os/domain';
import app from '../apps/worker/src/index';

describe('Spark Emergency Layer — Operations & Normalizer Test Suite', () => {
  let ctx: TestContext;
  let service: PersonalStateService;
  const testJwtSecret = 'test-jwt-secret-key-at-least-32-chars-for-hmac-sha256';

  const testSubjectId = 'subj_rrb_math_emergency';
  const testChapterId = 'chap_lcm_hcf_emergency';

  function makeJwt(payload: Record<string, any>, secret: string = testJwtSecret): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsigned = `${header}.${body}`;
    const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
  }

  const writeToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const readToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const makeEnv = () => ({
    DB: ctx.d1,
    ENVIRONMENT: 'test',
    JWT_SECRET: testJwtSecret,
  });

  beforeEach(async () => {
    ctx = createTestDatabase();
    service = new PersonalStateService(ctx.d1, ctx.db);
    const now = new Date().toISOString();

    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'Asia/Kolkata',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    const subject: Subject = {
      id: testSubjectId,
      name: 'Mathematics',
      slug: 'mathematics',
      description: 'RRB ALP Mathematics Emergency Baseline',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertSubject(ctx.db, subject);

    const chapter: Chapter = {
      id: testChapterId,
      subjectId: testSubjectId,
      name: 'LCM & HCF',
      slug: 'lcm-hcf',
      status: 'in_progress',
      progress: 0.25,
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter);
  });

  // ==========================================================================
  // 1. SKILL DEFINITIONS & PROMPT DISCOVERY INTEGRITY
  // ==========================================================================
  describe('Skill Definitions & Prompt Discovery', () => {
    const rootPromptsDir = path.resolve(__dirname, '../docs/prompts');

    it('verifies spark-emergency-ops skill definition and safety boundaries', () => {
      const skillPath = path.join(rootPromptsDir, 'Emergency ops skill', 'SKILL.md');
      expect(fs.existsSync(skillPath)).toBe(true);

      const content = fs.readFileSync(skillPath, 'utf8');
      expect(content).toContain('name: spark-emergency-ops');
      expect(content).toContain('100% READ-ONLY');
      expect(content).toContain('personal-study-os:get_study_state');
      expect(content).toContain('personal-study-os:get_sync_status');
      expect(content).toContain('personal-study-os:get_schedule_context');
      expect(content).toContain('mutate or create Google Calendar events');
    });

    it('verifies spark-emergency-normalizer skill definition and confirmation gate', () => {
      const skillPath = path.join(rootPromptsDir, 'Emergency normalizer skill', 'SKILL.md');
      expect(fs.existsSync(skillPath)).toBe(true);

      const content = fs.readFileSync(skillPath, 'utf8');
      expect(content).toContain('name: spark-emergency-normalizer');
      expect(content).toContain('Mandatory Confirmation Gate');
      expect(content).toContain('personal-study-os:record_study_session');
      expect(content).toContain('norm_${date}_spark_emergency');
      expect(content).toContain('Zero Fabrication');
      expect(content).toContain('Human Field Immunity');
    });

    it('verifies prompt registry documentation registers both emergency skills', () => {
      const readmePath = path.join(rootPromptsDir, 'README.md');
      const content = fs.readFileSync(readmePath, 'utf8');
      expect(content).toContain('Emergency ops skill/');
      expect(content).toContain('Emergency normalizer skill/');
      expect(content).toContain('SPARK_EMERGENCY_OPS_SKILL.md');
      expect(content).toContain('SPARK_EMERGENCY_NORMALIZER_SKILL.md');
    });
  });

  // ==========================================================================
  // 2. READ-ONLY EMERGENCY OPS MCP TOOL CONTRACTS
  // ==========================================================================
  describe('Emergency Ops MCP Tool Routing (Read-Only)', () => {
    it('executes get_study_state and confirms zero mutations', async () => {
      const res = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${readToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mcp_ops_1',
            method: 'tools/call',
            params: {
              name: 'get_study_state',
              arguments: { timezone: 'Asia/Kolkata' },
            },
          }),
        },
        makeEnv()
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.result).toBeDefined();
      expect(json.result.isError).toBeFalsy();
      const content = JSON.parse(json.result.content[0].text);
      expect(content.blueprint).toBeDefined();
      expect(content.blueprint.maxDailyDeepWorkMinutes).toBe(270);
      expect(content.accuracy).toBeDefined();

      // Verify zero canonical events were created
      const events = await service.getRecentActivity({ limit: 10 });
      expect(events.length).toBe(0);
    });

    it('executes get_sync_status to inspect queue reliability', async () => {
      const res = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${readToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mcp_ops_2',
            method: 'tools/call',
            params: {
              name: 'get_sync_status',
              arguments: {},
            },
          }),
        },
        makeEnv()
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.result).toBeDefined();
      expect(json.result.isError).toBeFalsy();
      const content = JSON.parse(json.result.content[0].text);
      expect(content.pendingJobsCount).toBeDefined();
      expect(content.deadLetterJobsCount).toBeDefined();
    });

    it('executes get_schedule_context for calendar drift auditing', async () => {
      const res = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${readToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mcp_ops_3',
            method: 'tools/call',
            params: {
              name: 'get_schedule_context',
              arguments: { date: '2026-09-13', timezone: 'Asia/Kolkata' },
            },
          }),
        },
        makeEnv()
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.result).toBeDefined();
      expect(json.result.isError).toBeFalsy();
      const content = JSON.parse(json.result.content[0].text);
      expect(content.date).toBe('2026-09-13');
      expect(content.timezone).toBe('Asia/Kolkata');
      expect(content.calendarBlocks).toBeDefined();
    });
  });

  // ==========================================================================
  // 3. EMERGENCY NORMALIZER WORKFLOW & IDEMPOTENCY
  // ==========================================================================
  describe('Emergency Normalizer Workflow & Idempotency', () => {
    const idempotencyKey = 'norm_2026-09-13_spark_emergency';

    it('successfully commits canonical study session with valid emergency idempotency key', async () => {
      const res = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${writeToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mcp_norm_1',
            method: 'tools/call',
            params: {
              name: 'record_study_session',
              arguments: {
                chapterId: testChapterId,
                durationSeconds: 5400,
                activityType: 'deep_work',
                evidenceTier: 'user_reported',
                questionsAttempted: 25,
                questionsCorrect: 21,
                startedAt: '2026-09-13T09:00:00.000Z',
                endedAt: '2026-09-13T10:30:00.000Z',
                idempotency_key: idempotencyKey,
              },
            },
          }),
        },
        makeEnv()
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.result).toBeDefined();
      expect(json.result.isError).toBeFalsy();
      const content = JSON.parse(json.result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.operation).toBe('record_study_session');
      expect(content.entityId).toMatch(/^sess_/);
      expect(content.eventId).toMatch(/^evt_/);
      expect(content.replayed).toBeFalsy();

      // Verify canonical events were ingested into D1 (both study_session_recorded and questions_attempted)
      const activity = await service.getRecentActivity({ limit: 5 });
      expect(activity.length).toBe(2);
      const sessionEvent = activity.find(e => e.eventType === 'study_session_recorded');
      expect(sessionEvent).toBeDefined();
      expect(sessionEvent?.payload.durationSeconds).toBe(5400);
      const questionsEvent = activity.find(e => e.eventType === 'questions_attempted');
      expect(questionsEvent).toBeDefined();
      expect(questionsEvent?.payload.questionsAttempted).toBe(25);
    });

    it('enforces exact idempotency deduplication on duplicate emergency invocations', async () => {
      const payload = {
        chapterId: testChapterId,
        durationSeconds: 3600,
        activityType: 'deep_work',
        evidenceTier: 'user_reported',
        questionsAttempted: 15,
        questionsCorrect: 12,
        startedAt: '2026-09-13T14:00:00.000Z',
        endedAt: '2026-09-13T15:00:00.000Z',
        idempotency_key: idempotencyKey,
      };

      // Invocations 1: Primary commit
      const res1 = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${writeToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mcp_norm_first',
            method: 'tools/call',
            params: { name: 'record_study_session', arguments: payload },
          }),
        },
        makeEnv()
      );
      const json1 = (await res1.json()) as any;
      expect(json1.result).toBeDefined();
      expect(json1.result.isError).toBeFalsy();
      const content1 = JSON.parse(json1.result.content[0].text);
      expect(content1.success).toBe(true);
      expect(content1.replayed).toBeFalsy();
      const primarySessionId = content1.entityId;

      // Invocations 2: Replay with identical key and payload
      const res2 = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${writeToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mcp_norm_replay_1',
            method: 'tools/call',
            params: { name: 'record_study_session', arguments: payload },
          }),
        },
        makeEnv()
      );
      const json2 = (await res2.json()) as any;
      expect(json2.result).toBeDefined();
      expect(json2.result.isError).toBeFalsy();
      const content2 = JSON.parse(json2.result.content[0].text);
      expect(content2.success).toBe(true);
      expect(content2.replayed).toBe(true);
      expect(content2.entityId).toBe(primarySessionId);

      // Verify that D1 contains exactly the original events (zero duplicates created on replay)
      const activity = await service.getRecentActivity({ limit: 10 });
      expect(activity.length).toBe(2);
    });

    it('rejects mathematically invalid metrics (questionsCorrect > questionsAttempted)', async () => {
      const res = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${writeToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mcp_norm_invalid',
            method: 'tools/call',
            params: {
              name: 'record_study_session',
              arguments: {
                chapterId: testChapterId,
                durationSeconds: 3600,
                activityType: 'deep_work',
                questionsAttempted: 10,
                questionsCorrect: 15, // Invalid: correct > attempted
                idempotency_key: 'norm_invalid_metrics',
              },
            },
          }),
        },
        makeEnv()
      );

      const json = (await res.json()) as any;
      expect(json.result).toBeDefined();
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0].text).toContain('questionsCorrect cannot exceed questionsAttempted');
    });

    it('rejects unauthorized scope (readToken attempting record_study_session)', async () => {
      const res = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${readToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mcp_norm_unauthorized',
            method: 'tools/call',
            params: {
              name: 'record_study_session',
              arguments: {
                chapterId: testChapterId,
                durationSeconds: 3600,
                activityType: 'deep_work',
                idempotency_key: 'norm_unauth_key',
              },
            },
          }),
        },
        makeEnv()
      );

      const json = (await res.json()) as any;
      expect(json.error).toBeDefined();
      expect(json.error.message).toContain("requires 'write' scope");
    });
  });
});
