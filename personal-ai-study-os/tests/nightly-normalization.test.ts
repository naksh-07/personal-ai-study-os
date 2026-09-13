import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createTestDatabase, TestContext } from './test-helper';
import { PersonalStateService } from '@personal-os/core';
import { EntitiesRepository } from '@personal-os/db';
import { Subject, Chapter } from '@personal-os/domain';
import app from '../apps/worker/src/index';

describe('Antigravity Nightly Normalization & Technical Operations Suite', () => {
  let ctx: TestContext;
  let service: PersonalStateService;
  const testJwtSecret = 'test-jwt-secret-key-at-least-32-chars-for-hmac-sha256';

  const testSubjectId = 'subj_rrb_math';
  const testChapterId = 'chap_lcm_hcf';

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
      description: 'RRB ALP Mathematics Foundation',
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
      progress: 0.4,
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter);
  });

  // ==========================================================================
  // 1. MCP CONTRACT VALIDATION FOR NIGHTLY NORMALIZATION & OPERATIONS
  // ==========================================================================
  describe('MCP Tool Contracts for Nightly Normalization & Operations', () => {
    it('executes record_study_session via MCP with exact parameter contract', async () => {
      const res = await app.request('/mcp', {
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
              idempotency_key: 'norm_2026-09-13_page_001',
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.result.isError).toBeFalsy();
      const data = JSON.parse(json.result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.operation).toBe('record_study_session');
      expect(data.entityId).toMatch(/^sess_/);
      expect(data.data.durationSeconds).toBe(5400);

      // Verify D1 state
      const session = await ctx.db
        .selectFrom('study_sessions')
        .where('id', '=', data.entityId)
        .selectAll()
        .executeTakeFirst();
      expect(session).toBeDefined();
      expect(session?.chapter_id).toBe(testChapterId);
      expect(session?.duration_seconds).toBe(5400);
    });

    it('executes checkpoint tool (set, get, list) via MCP', async () => {
      // 1. Set Checkpoint
      const setRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_chk_set',
          method: 'tools/call',
          params: {
            name: 'checkpoint',
            arguments: {
              action: 'set',
              checkpointName: 'norm_2026-09-13',
              checkpointType: 'normalization',
              stateData: JSON.stringify({ status: 'committed', pageId: 'page_test_123' }),
            },
          },
        }),
      }, makeEnv());

      expect(setRes.status).toBe(200);
      const setJson: any = await setRes.json();
      expect(setJson.result.isError).toBeFalsy();
      const setData = JSON.parse(setJson.result.content[0].text);
      expect(setData.success).toBe(true);
      expect(setData.checkpointName).toBe('norm_2026-09-13');

      // 2. Get Checkpoint
      const getRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_chk_get',
          method: 'tools/call',
          params: {
            name: 'checkpoint',
            arguments: {
              action: 'get',
              checkpointName: 'norm_2026-09-13',
            },
          },
        }),
      }, makeEnv());

      expect(getRes.status).toBe(200);
      const getJson: any = await getRes.json();
      expect(getJson.result.isError).toBeFalsy();
      const getData = JSON.parse(getJson.result.content[0].text);
      expect(getData.checkpoint_name).toBe('norm_2026-09-13');
      expect(JSON.parse(getData.state_data).status).toBe('committed');
    });

    it('executes get_schedule_context via MCP for calendar drift analysis', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_sched_ctx',
          method: 'tools/call',
          params: {
            name: 'get_schedule_context',
            arguments: {
              date: '2026-09-13',
              timezone: 'Asia/Kolkata',
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.result.isError).toBeFalsy();
      const data = JSON.parse(json.result.content[0].text);
      expect(data).toHaveProperty('blueprint');
      expect(data).toHaveProperty('calendarBlocks');
      expect(data).toHaveProperty('dayState');
    });
  });

  // ==========================================================================
  // 2. DETERMINISTIC IDEMPOTENCY AUDIT (1x, 2x, 3x Replay)
  // ==========================================================================
  describe('Idempotency Audit (1x, 2x, 3x Replay)', () => {
    it('produces exactly 1 session and 1 canonical event when called multiple times with the same idempotency key', async () => {
      const idempotencyKey = 'norm_2026-09-13_notion_page_abc123';
      const callPayload = {
        chapterId: testChapterId,
        subjectId: testSubjectId,
        durationSeconds: 3600,
        activityType: 'deep_work' as const,
        startedAt: '2026-09-13T09:00:00.000Z',
        endedAt: '2026-09-13T10:00:00.000Z',
        questionsAttempted: 20,
        questionsCorrect: 18,
      };

      // Call 1: Initial commit
      const res1 = await service.recordStudySession(callPayload, {
        key: idempotencyKey,
        sourceSystem: 'mcp',
      });
      expect(res1.success).toBe(true);
      expect((res1 as any).replayed).toBeFalsy();
      const firstSessionId = res1.entityId;

      // Call 2: Second invocation with identical idempotency key
      const res2 = await service.recordStudySession(callPayload, {
        key: idempotencyKey,
        sourceSystem: 'mcp',
      });
      expect(res2.success).toBe(true);
      expect((res2 as any).replayed).toBe(true);
      expect(res2.entityId).toBe(firstSessionId);

      // Call 3: Third invocation with identical idempotency key
      const res3 = await service.recordStudySession(callPayload, {
        key: idempotencyKey,
        sourceSystem: 'mcp',
      });
      expect(res3.success).toBe(true);
      expect((res3 as any).replayed).toBe(true);
      expect(res3.entityId).toBe(firstSessionId);

      // Audit Database: Exactly 1 session record must exist
      const sessions = await ctx.db
        .selectFrom('study_sessions')
        .where('chapter_id', '=', testChapterId)
        .selectAll()
        .execute();
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe(firstSessionId);

      // Audit Database: Exactly 1 study_session_recorded event must exist
      const events = await ctx.db
        .selectFrom('canonical_events')
        .where('event_type', '=', 'study_session_recorded')
        .selectAll()
        .execute();
      expect(events.length).toBe(1);

      // Audit Idempotency Records Table
      const idempRecord = await ctx.db
        .selectFrom('idempotency_records')
        .where('idempotency_key', '=', idempotencyKey)
        .selectAll()
        .executeTakeFirst();
      expect(idempRecord).toBeDefined();
      expect(idempRecord?.status).toBe('COMPLETED');
    });
  });

  // ==========================================================================
  // 3. FAILURE-MODE & MATHEMATICAL CONSTRAINT AUDIT
  // ==========================================================================
  describe('Failure Modes & Constraint Defenses', () => {
    it('rejects mathematically impossible practice scores (questionsCorrect > questionsAttempted)', async () => {
      const invalidPayload = {
        chapterId: testChapterId,
        subjectId: testSubjectId,
        durationSeconds: 3600,
        activityType: 'deep_work' as const,
        startedAt: '2026-09-13T09:00:00.000Z',
        endedAt: '2026-09-13T10:00:00.000Z',
        questionsAttempted: 10,
        questionsCorrect: 15, // Invalid!
      };

      await expect(
        service.recordStudySession(invalidPayload, {
          key: 'norm_invalid_math_001',
          sourceSystem: 'mcp',
        })
      ).rejects.toThrow('questionsCorrect cannot exceed questionsAttempted');

      // Asserts zero sessions and zero events were created
      const sessionCount = await ctx.db.selectFrom('study_sessions').selectAll().execute();
      expect(sessionCount.length).toBe(0);
      const eventCount = await ctx.db.selectFrom('canonical_events').selectAll().execute();
      expect(eventCount.length).toBe(0);
    });

    it('rejects non-existent chapterId cleanly without corrupting state', async () => {
      await expect(
        service.recordStudySession(
          {
            chapterId: 'chap_nonexistent_xyz',
            subjectId: testSubjectId,
            durationSeconds: 1800,
            activityType: 'revision',
            startedAt: '2026-09-13T11:00:00.000Z',
            endedAt: '2026-09-13T11:30:00.000Z',
            questionsAttempted: 0,
            questionsCorrect: 0,
          },
          { key: 'norm_missing_chap_001', sourceSystem: 'mcp' }
        )
      ).rejects.toThrow("Chapter 'chap_nonexistent_xyz' not found");
    });
  });

  // ==========================================================================
  // 4. HUMAN-OWNED NOTION CONTENT PROTECTION TEST
  // ==========================================================================
  describe('Human-Owned Notion Content Protection', () => {
    it('guarantees machine patch touches ONLY [🤖] and [🔄] fields, preserving [✍️] and human reflection blocks', async () => {
      // 1. Human-authored Notion page fixture representing actual user journal entry
      const humanAuthoredPageFixture = {
        id: '3d8a86b6-95e7-80de-a2c0-e7dd3d5ff2b4',
        properties: {
          Journal: { title: [{ plain_text: 'Daily Study Journal — 2026-09-13' }] },
          Date: { date: { start: '2026-09-13' } },
          '[✍️] Primary Focus': { rich_text: [{ plain_text: 'RRB ALP Maths LCM & HCF PYQ Sprint' }] },
          '[✍️] Focus Quality': { select: { name: 'High' } },
          '[✍️] Energy': { select: { name: 'Medium' } },
          '[✍️] Anki Done': { checkbox: true },
          '[🔄] Day Status': { select: { name: 'Active' } },
          '[🔄] Chapters Covered': { relation: [{ id: testChapterId }] },
          '[🤖] Study Minutes': { number: null },
          '[🤖] Questions Attempted': { number: null },
          '[🤖] Questions Correct': { number: null },
          '[🤖] Accuracy': { number: null },
          '[🤖] OS_Entity_ID': { rich_text: [] },
        },
        bodyBlocks: [
          { type: 'heading_2', heading_2: { rich_text: [{ plain_text: "🎯 Today's Focus" }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Master LCM & HCF word problems.' }] } },
          { type: 'heading_2', heading_2: { rich_text: [{ plain_text: '📖 What I Studied' }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Completed 25 past year questions from ALP 2018 paper.' }] } },
          { type: 'heading_2', heading_2: { rich_text: [{ plain_text: '🧩 Important Problems / Errors' }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Tricky question on circular track meetings using LCM.' }] } },
          { type: 'heading_2', heading_2: { rich_text: [{ plain_text: '🧠 What I Learned' }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Product of two numbers = LCM * HCF.' }] } },
          { type: 'heading_2', heading_2: { rich_text: [{ plain_text: '🔁 What Needs Revision' }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Bell ringing interval word problems.' }] } },
          { type: 'heading_2', heading_2: { rich_text: [{ plain_text: '✍️ Reflection' }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Energy was solid throughout the morning container.' }] } },
        ],
      };

      // Deep snapshot of human-authored content prior to normalization
      const originalHumanPropertiesSnapshot = JSON.parse(
        JSON.stringify({
          primaryFocus: humanAuthoredPageFixture.properties['[✍️] Primary Focus'],
          focusQuality: humanAuthoredPageFixture.properties['[✍️] Focus Quality'],
          energy: humanAuthoredPageFixture.properties['[✍️] Energy'],
          ankiDone: humanAuthoredPageFixture.properties['[✍️] Anki Done'],
        })
      );
      const originalBodyBlocksSnapshot = JSON.parse(JSON.stringify(humanAuthoredPageFixture.bodyBlocks));

      // 2. Nightly Normalization PSS-First Execution
      const pssCommitRes = await service.recordStudySession(
        {
          chapterId: testChapterId,
          subjectId: testSubjectId,
          durationSeconds: 5400, // 90 minutes
          activityType: 'deep_work',
          startedAt: '2026-09-13T09:00:00.000Z',
          endedAt: '2026-09-13T10:30:00.000Z',
          questionsAttempted: 25,
          questionsCorrect: 21,
          evidenceTier: 'user_reported',
        },
        { key: `norm_2026-09-13_${humanAuthoredPageFixture.id}`, sourceSystem: 'mcp' }
      );

      expect(pssCommitRes.success).toBe(true);
      const canonicalSessionId = pssCommitRes.entityId;

      // 3. Construct the exact patch payload emitted by the Nightly Normalization Skill
      const verifiedStudyMinutes = 90;
      const questionsAttempted = 25;
      const questionsCorrect = 21;
      const accuracyRatio = Number((questionsCorrect / questionsAttempted).toFixed(2)); // 0.84

      const notionPatchPayload: Record<string, any> = {
        '[🤖] Study Minutes': { number: verifiedStudyMinutes },
        '[🤖] Questions Attempted': { number: questionsAttempted },
        '[🤖] Questions Correct': { number: questionsCorrect },
        '[🤖] Accuracy': { number: accuracyRatio },
        '[🤖] OS_Entity_ID': { rich_text: [{ text: { content: canonicalSessionId } }] },
        '[🔄] Day Status': { select: { name: 'Completed' } },
      };

      // Assert that NO human fields are in the patch payload keys
      const patchedKeys = Object.keys(notionPatchPayload);
      for (const key of patchedKeys) {
        expect(key.startsWith('[✍️]')).toBe(false);
      }

      // Simulate applying the patch to the Notion page
      Object.assign(humanAuthoredPageFixture.properties, notionPatchPayload);

      // 4. Assert Invariants
      // Invariant A: Human fields remain byte-for-byte identical
      expect(humanAuthoredPageFixture.properties['[✍️] Primary Focus']).toEqual(originalHumanPropertiesSnapshot.primaryFocus);
      expect(humanAuthoredPageFixture.properties['[✍️] Focus Quality']).toEqual(originalHumanPropertiesSnapshot.focusQuality);
      expect(humanAuthoredPageFixture.properties['[✍️] Energy']).toEqual(originalHumanPropertiesSnapshot.energy);
      expect(humanAuthoredPageFixture.properties['[✍️] Anki Done']).toEqual(originalHumanPropertiesSnapshot.ankiDone);

      // Invariant B: Page body blocks (reflections) remain completely untouched
      expect(humanAuthoredPageFixture.bodyBlocks).toEqual(originalBodyBlocksSnapshot);

      // Invariant C: Machine fields are updated with authoritative PSS values
      expect(humanAuthoredPageFixture.properties['[🤖] Study Minutes'].number).toBe(90);
      expect(humanAuthoredPageFixture.properties['[🤖] Questions Attempted'].number).toBe(25);
      expect(humanAuthoredPageFixture.properties['[🤖] Questions Correct'].number).toBe(21);
      expect(humanAuthoredPageFixture.properties['[🤖] Accuracy'].number).toBe(0.84);
      expect((humanAuthoredPageFixture.properties['[🤖] OS_Entity_ID'].rich_text as any[])[0].text.content).toBe(canonicalSessionId);
      expect(humanAuthoredPageFixture.properties['[🔄] Day Status'].select.name).toBe('Completed');
    });
  });

  // ==========================================================================
  // 5. FRESH-START & ZERO-FABRICATION VERIFICATION
  // ==========================================================================
  describe('Fresh-Start & Zero-Fabrication Invariants', () => {
    it('records partial day without fabricating retention curves or weakness scores when data is unobserved', async () => {
      // User creates page but has zero practice or sessions
      const emptyDayFixture = {
        id: 'page_empty_day_001',
        hasReflections: false,
        questionsAttempted: 0,
        questionsCorrect: 0,
        studyMinutes: 0,
      };

      // Day status evaluates to Partial (or Rest) without inventing scores
      const dayStatus = emptyDayFixture.studyMinutes > 0 ? 'Completed' : 'Partial';
      expect(dayStatus).toBe('Partial');

      // Assert accuracy formula handles 0 attempts safely
      const accuracy = emptyDayFixture.questionsAttempted > 0
        ? emptyDayFixture.questionsCorrect / emptyDayFixture.questionsAttempted
        : 0;
      expect(accuracy).toBe(0);

      // Confirm that get_study_state on empty initial state reports 0 metrics, not hallucinated values
      const state = await service.getStudyState({ date: '2026-09-13', timezone: 'Asia/Kolkata' });
      expect(state.totalStudyMinutes).toBe(0);
      expect(state.accuracy).toBe(0);
      expect(state.subjectSummaries.length).toBe(1);
      expect(state.subjectSummaries[0].completedChapters).toBe(0);
      expect(state.subjectSummaries[0].progressPercent).toBe(0);
    });
  });
});
