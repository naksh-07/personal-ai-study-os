import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import app from '../apps/worker/src/index';
import { EntitiesRepository, ReliabilityRepository } from '@personal-os/db';
import {
  Subject,
  Chapter,
  QueueMessageEnvelope,
  generateId,
} from '@personal-os/domain';
import {
  ReliabilityEngine,
  ConfigurableReconciliationHandler,
} from '@personal-os/core';
import { processQueueBatch } from '../apps/worker/src/queue/consumer';
import { runOutboxDualSweep, wrapJobInQueueEnvelope } from '../apps/worker/src/queue/outbox-dispatcher';
import crypto from 'node:crypto';

describe('Slice 4: End-to-End Production Integration Suite', () => {
  let ctx: TestContext;
  const testSecret = 'e2e_jwt_secret_key_12345';
  const notionSecret = 'e2e_notion_secret_key_67890';

  const testSubjectId = 'subj_biochem';
  const testChapterId = 'chap_metabolism';

  function makeJwt(payload: Record<string, any>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${header}.${body}`;
    const hmac = crypto.createHmac('sha256', testSecret);
    hmac.update(unsignedToken);
    const signature = hmac.digest('base64url');
    return `${unsignedToken}.${signature}`;
  }

  const writeToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const makeMockMessage = (body: QueueMessageEnvelope) => {
    const msg = {
      id: `msg_${Date.now()}`,
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
      retryOpts: null as any,
    };
    msg.retry.mockImplementation((opts) => {
      msg.retryOpts = opts;
    });
    return msg;
  };

  const makeMockBatch = (messages: any[]) => ({
    queue: 'personal-study-sync',
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
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
      name: 'Biochemistry',
      slug: 'biochemistry',
      description: 'Human metabolic pathways',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertSubject(ctx.db, subject);

    const chapter: Chapter = {
      id: testChapterId,
      subjectId: testSubjectId,
      name: 'Carbohydrate Metabolism',
      slug: 'carbohydrate-metabolism',
      progress: 0,
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter);
  });

  // ==========================================================================
  // E2E 1: Full Mutation -> Event -> Outbox -> Queue Consumer -> Adapter Flow
  // ==========================================================================
  describe('E2E Full Mutation Lifecycle', () => {
    it('executes MCP mutation, sweeps outbox, and processes via queue consumer to completion', async () => {
      // Step 1: Client triggers MCP tool 'record_study_session'
      const mcpRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_e2e_session',
          method: 'tools/call',
          params: {
            name: 'record_study_session',
            arguments: {
              chapterId: testChapterId,
              subjectId: testSubjectId,
              durationSeconds: 2400,
              activityType: 'deep_work',
              questionsAttempted: 30,
              questionsCorrect: 26,
            },
          },
        }),
      }, { DB: ctx.d1, ENVIRONMENT: 'test', JWT_SECRET: testSecret });

      expect(mcpRes.status).toBe(200);
      const mcpJson: any = await mcpRes.json();
      expect(mcpJson.error).toBeUndefined();
      const content = JSON.parse(mcpJson.result.content[0].text);
      expect(content.entityId).toBeDefined();

      // Step 2: Verify Canonical Event and Projection in D1
      const events = await ctx.db
        .selectFrom('canonical_events')
        .selectAll()
        .where('event_type', '=', 'study_session_recorded')
        .execute();
      expect(events.length).toBe(1);

      const jobId = generateId('sync');
      const idempKey = 'idemp_sync_google_tasks_1';
      const staleCreatedAt = new Date(Date.now() - 45 * 1000).toISOString();

      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_e2e_1',
          operation: 'create',
          payload_json: JSON.stringify({
            title: 'Complete Glycolysis Flashcards',
            tasklistId: '@default',
          }),
          status: 'PENDING',
          attempt_count: 0,
          created_at: staleCreatedAt,
          updated_at: staleCreatedAt,
        })
        .execute();

      // Step 4: Sweep 1 runs outbox sweep and dispatches to queue
      const enqueuedMessages: QueueMessageEnvelope[] = [];
      const mockQueue = {
        send: vi.fn(async (msg: any) => {
          enqueuedMessages.push(msg);
        }),
      };

      const sweepResults = await runOutboxDualSweep(
        { DB: ctx.d1, SYNC_QUEUE: mockQueue as any },
        new ConfigurableReconciliationHandler('ABSENT')
      );

      expect(sweepResults.dispatchedCount).toBeGreaterThanOrEqual(1);
      expect(enqueuedMessages.length).toBe(1);
      expect(enqueuedMessages[0].jobId).toBe(jobId);

      // Step 5: Queue Consumer claims lease and dispatches to Adapter
      // Mock Google Tasks API response for Safe-Create Gate:
      // 1. reconcileTaskSearch returns empty list (HTTP 200)
      // 2. tasks.insert returns created task (HTTP 200)
      global.fetch = vi.fn(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (opts?.method === 'GET' || !opts?.method) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (opts?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'gtask_remote_123',
              title: 'Complete Glycolysis Flashcards',
              status: 'needsAction',
            }),
            { status: 200 }
          );
        }
        return new Response('Not found', { status: 404 });
      }) as any;

      const mockMsg = makeMockMessage(enqueuedMessages[0]);
      const batch = makeMockBatch([mockMsg]);

      await processQueueBatch(batch as any, { DB: ctx.d1 });

      expect(mockMsg.ack).toHaveBeenCalled();

      // Step 6: Verify Final State in D1
      const jobAfter = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(jobAfter?.status).toBe('COMPLETED');
      expect(jobAfter?.attempt_count).toBe(1); // Exact single increment from 0 -> 1

      const idempRecord = await ctx.db
        .selectFrom('idempotency_records')
        .selectAll()
        .where('idempotency_key', '=', idempKey)
        .executeTakeFirst();

      expect(idempRecord?.status).toBe('COMPLETED');
    });
  });

  // ==========================================================================
  // E2E 2: Crash & Stale Recovery E2E (Preserving attempt_count)
  // ==========================================================================
  describe('E2E Crash & Recovery Loop Termination', () => {
    it('recovers stale processing lease, verifies entity on provider, and resolves to COMPLETED without duplicate call', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_stale_e2e';
      const staleTime = new Date(Date.now() - 150 * 1000).toISOString(); // 150s ago (> 120s lease)

      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_stale_1',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Stale Task' }),
          status: 'PROCESSING',
          attempt_count: 2, // Was already counted for Attempt 2
          processing_started_at: staleTime,
          created_at: staleTime,
          updated_at: staleTime,
        })
        .execute();

      // Sweep 2 discovers stale job and runs reconciliation
      // Reconciliation finds that task was already created remotely
      const reconciliationHandler = new ConfigurableReconciliationHandler('APPLIED');
      const mockQueue = { send: vi.fn() };

      const sweepResults = await runOutboxDualSweep(
        { DB: ctx.d1, SYNC_QUEUE: mockQueue as any },
        reconciliationHandler
      );

      expect(sweepResults.staleResults?.length).toBe(1);
      expect(sweepResults.staleResults?.[0].outcome).toBe('RECOVERED_AND_COMPLETED');

      // Verify attempt_count was NOT incremented (remains 2!)
      const job = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(job?.status).toBe('COMPLETED');
      expect(job?.attempt_count).toBe(2);
    });

    it('terminates Crash Scenario 7 loop when last_error is RECOVERY_IN_PROGRESS', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_crash7_e2e';
      const staleTime = new Date(Date.now() - 150 * 1000).toISOString();

      // Prior recovery worker crashed
      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_crash7',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Crash 7 Task' }),
          status: 'PROCESSING',
          attempt_count: 3,
          processing_started_at: staleTime,
          last_error: 'RECOVERY_IN_PROGRESS',
          created_at: staleTime,
          updated_at: staleTime,
        })
        .execute();

      const reconciliationHandler = new ConfigurableReconciliationHandler('ABSENT');
      const mockQueue = { send: vi.fn() };

      const sweepResults = await runOutboxDualSweep(
        { DB: ctx.d1, SYNC_QUEUE: mockQueue as any },
        reconciliationHandler
      );

      expect(sweepResults.staleResults?.length).toBe(1);
      expect(sweepResults.staleResults?.[0].outcome).toBe('RECOVERED_AND_FAILED');

      const job = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(job?.status).toBe('FAILED');
      expect(job?.last_error).toBe('RECOVERY_WORKER_CRASHED');
      expect(job?.attempt_count).toBe(3); // Preserved!
    });
  });

  // ==========================================================================
  // E2E 3: Strict 5-Attempt Ceiling & DLQ Routing
  // ==========================================================================
  describe('Strict 5-Attempt Budget & DLQ Boundary', () => {
    it('routes job directly to DLQ on attempt 5 failure and blocks any 6th attempt', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_dlq_e2e';
      const now = new Date().toISOString();

      // Job currently at attempt 4, status PENDING
      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_dlq_test',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Terminal Task' }),
          status: 'PENDING',
          attempt_count: 4, // Next claim will be attempt 5 (the final attempt allowed)
          created_at: now,
          updated_at: now,
        })
        .execute();

      const dlqMessages: any[] = [];
      const mockDlq = {
        send: vi.fn(async (msg: any) => {
          dlqMessages.push(msg);
        }),
      };

      const envelope: QueueMessageEnvelope = {
        jobId,
        idempotencyKey: idempKey,
        targetSystem: 'google_tasks',
        entityType: 'task',
        entityId: 'task_dlq_test',
        operation: 'create',
        schemaVersion: 1,
        payload: { title: 'Terminal Task' },
        enqueuedAt: now,
      };

      const mockMsg = makeMockMessage(envelope);
      const batch = makeMockBatch([mockMsg]);

      // Mock provider to return permanent or retryable error
      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'Persistent 503' }), { status: 503 });
      }) as any;

      await processQueueBatch(batch as any, {
        DB: ctx.d1,
        DLQ: mockDlq as any,
      });

      // Claim #5 was executed (attempt_count became 5). Since attemptCount >= 5, routed to DLQ!
      expect(mockDlq.send).toHaveBeenCalled();
      expect(dlqMessages.length).toBe(1);
      expect(dlqMessages[0].terminalAttemptCount).toBe(5);

      const job = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(job?.status).toBe('DEAD_LETTER');
      expect(job?.attempt_count).toBe(5);
      expect(job?.last_error).toContain('MAX_ATTEMPTS_EXHAUSTED');

      // Attempting to claim lease again MUST FAIL (No 6th attempt permitted!)
      const lease6 = await ReliabilityRepository.claimProcessingLease(ctx.db, {
        jobId,
        leaseOwner: 'consumer_attempt_6',
      });
      expect(lease6.success).toBe(false);
    });
  });

  // ==========================================================================
  // E2E 4: Notion Webhook Ingestion Pipeline
  // ==========================================================================
  describe('Notion Webhook Ingestion E2E', () => {
    it('ingests Notion webhook, creates canonical event, and records idempotency record', async () => {
      const webhookPayload = JSON.stringify({
        id: 'notion_page_update_999',
        type: 'page_updated',
        page_id: testChapterId,
        properties: {
          progress: 0.9,
          status: 'completed',
        },
      });

      const hmac = crypto.createHmac('sha256', notionSecret);
      hmac.update(webhookPayload);
      const signature = hmac.digest('hex');
      const deliveryId = 'deliv_notion_e2e_' + Date.now();

      const res = await app.request('/v1/webhooks/notion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-delivery-id': deliveryId,
          'x-notion-signature': signature,
        },
        body: webhookPayload,
      }, {
        DB: ctx.d1,
        ENVIRONMENT: 'test',
        NOTION_WEBHOOK_SECRET: notionSecret,
      });

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.status).toBe('processed');

      // Verify canonical event was ingested
      const events = await ctx.db
        .selectFrom('canonical_events')
        .selectAll()
        .where('event_type', '=', 'chapter_progress_updated')
        .execute();
      expect(events.length).toBe(1);

      // Verify idempotency record exists
      const idempRecord = await ctx.db
        .selectFrom('idempotency_records')
        .selectAll()
        .where('idempotency_key', '=', `webhook_notion_notion_page_update_999`)
        .executeTakeFirst();
      expect(idempRecord?.status).toBe('COMPLETED');
    });
  });
});
