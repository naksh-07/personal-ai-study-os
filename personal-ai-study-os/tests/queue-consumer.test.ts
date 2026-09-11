import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import { processQueueBatch } from '../apps/worker/src/queue/consumer';
import { runOutboxDualSweep, wrapJobInQueueEnvelope } from '../apps/worker/src/queue/outbox-dispatcher';
import { ReliabilityEngine, ConfigurableReconciliationHandler } from '@personal-os/core';
import { QueueMessageEnvelope, SyncJob, generateId } from '@personal-os/domain';

describe('Slice 4: Queue Consumer & Outbox Integration Test Suite', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestDatabase();

    // Seed default operator user
    await ctx.db
      .insertInto('users')
      .values({
        id: 'usr_operator',
        timezone: 'UTC',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();
  });

  function makeMockMessage(envelope: QueueMessageEnvelope) {
    let acknowledged = false;
    let retried = false;
    let retryOptions: any = null;

    return {
      id: 'msg_' + envelope.jobId,
      body: envelope,
      timestamp: new Date(),
      attempts: 1,
      ack: vi.fn(() => {
        acknowledged = true;
      }),
      retry: vi.fn((opts?: any) => {
        retried = true;
        retryOptions = opts;
      }),
      get isAcknowledged() {
        return acknowledged;
      },
      get isRetried() {
        return retried;
      },
      get retryOpts() {
        return retryOptions;
      },
    };
  }

  function makeMockBatch(messages: any[]) {
    return {
      queue: 'personal-sync-queue',
      messages,
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    };
  }

  // ==========================================================================
  // 1. Consumer Atomic Lease Claim & Single-Increment Attempt Counting
  // ==========================================================================
  describe('Consumer Lease & Attempt Count Semantics (Tests A, B, C, G, H, I)', () => {
    it('claims processing lease and increments attempt_count exactly once from 0 to 1 (Test A)', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_claim_test_1';
      const now = new Date().toISOString();

      // Seed a PENDING sync job
      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_001',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Study Task' }),
          status: 'PENDING',
          attempt_count: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();

      const envelope: QueueMessageEnvelope = {
        jobId,
        idempotencyKey: idempKey,
        targetSystem: 'google_tasks',
        entityType: 'task',
        entityId: 'task_001',
        operation: 'create',
        schemaVersion: 1,
        payload: { title: 'Study Task' },
        enqueuedAt: now,
      };

      const mockMsg = makeMockMessage(envelope);
      const batch = makeMockBatch([mockMsg]);

      // Mock fetch for Google Tasks API to return success
      global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'GET' || !init?.method) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ id: 'gtask_created', title: 'Study Task', status: 'needsAction' }),
          { status: 200 }
        );
      }) as any;

      await processQueueBatch(batch as any, { DB: ctx.d1 });

      expect(mockMsg.ack).toHaveBeenCalled();

      // Verify D1 state: COMPLETED, attempt_count = 1
      const job = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(job).toBeDefined();
      expect(job?.status).toBe('COMPLETED');
      expect(job?.attempt_count).toBe(1);

      // Verify idempotency record created with COMPLETED
      const idemp = await ctx.db
        .selectFrom('idempotency_records')
        .selectAll()
        .where('idempotency_key', '=', idempKey)
        .executeTakeFirst();
      expect(idemp?.status).toBe('COMPLETED');
    });

    it('processes delete operation for google_tasks and purges task_link', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_delete_test_1';
      const now = new Date().toISOString();

      // Seed task link
      await ctx.db
        .insertInto('task_links')
        .values({
          id: 'tasklink_del_1',
          provider: 'google_tasks',
          tasklist_id: '@default',
          task_id: 'gtask_del_1',
          entity_type: 'chapter',
          entity_id: 'chap_del_1',
          title_snapshot: 'To Delete',
          status_snapshot: 'needsAction',
          last_synced_at: now,
          created_at: now,
          updated_at: now,
        })
        .execute();

      // Seed PENDING delete job
      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'chap_del_1',
          operation: 'delete',
          payload_json: JSON.stringify({ tasklistId: '@default', taskId: 'gtask_del_1' }),
          status: 'PENDING',
          attempt_count: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();

      const envelope: QueueMessageEnvelope = {
        jobId,
        idempotencyKey: idempKey,
        targetSystem: 'google_tasks',
        entityType: 'task',
        entityId: 'chap_del_1',
        operation: 'delete',
        schemaVersion: 1,
        payload: { tasklistId: '@default', taskId: 'gtask_del_1' },
        enqueuedAt: now,
      };

      const mockMsg = makeMockMessage(envelope);
      const batch = makeMockBatch([mockMsg]);

      let deleteFetchCalled = false;
      global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          deleteFetchCalled = true;
          return new Response(null, { status: 204 });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      await processQueueBatch(batch as any, { DB: ctx.d1 });

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(deleteFetchCalled).toBe(true);

      // Verify task_link was purged
      const link = await ctx.db
        .selectFrom('task_links')
        .selectAll()
        .where('task_id', '=', 'gtask_del_1')
        .executeTakeFirst();
      expect(link).toBeUndefined();

      // Verify sync_jobs completed
      const job = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();
      expect(job?.status).toBe('COMPLETED');
    });

    it('preserves attempt_count (+0) and schedules exponential backoff on transient failure (Test B)', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_transient_test';
      const now = new Date().toISOString();

      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_transient',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Task Rate Limit' }),
          status: 'PENDING',
          attempt_count: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();

      const envelope: QueueMessageEnvelope = {
        jobId,
        idempotencyKey: idempKey,
        targetSystem: 'google_tasks',
        entityType: 'task',
        entityId: 'task_transient',
        operation: 'create',
        schemaVersion: 1,
        payload: { title: 'Task Rate Limit' },
        enqueuedAt: now,
      };

      const mockMsg = makeMockMessage(envelope);
      const batch = makeMockBatch([mockMsg]);

      // Mock fetch to simulate HTTP 429 Rate Limit
      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ error: { message: 'Rate Limit 429' } }), { status: 429 });
      }) as any;

      await processQueueBatch(batch as any, { DB: ctx.d1 });

      expect(mockMsg.retry).toHaveBeenCalled();
      expect(mockMsg.retryOpts).toEqual({ delaySeconds: 5 }); // 5 * 2^0 = 5s backoff for attempt 1

      const job = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(job?.status).toBe('FAILED');
      // CRITICAL: attempt_count remains 1 (NOT 2). Zero double-increment on failure!
      expect(job?.attempt_count).toBe(1);
      expect(job?.next_attempt_at).toBeDefined();
    });

    it('redispatches failed job and increments attempt_count to 2 on subsequent claim (Test C)', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_retry_claim_test';
      const pastTime = new Date(Date.now() - 60000).toISOString();

      // Seed job in FAILED state from attempt 1
      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_retry',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Task Retry' }),
          status: 'FAILED',
          attempt_count: 1,
          next_attempt_at: pastTime, // Backoff elapsed
          created_at: pastTime,
          updated_at: pastTime,
        })
        .execute();

      // Sweep query redispatches it to DISPATCHED
      const sentEnvelopes: QueueMessageEnvelope[] = [];
      const mockQueue = {
        send: vi.fn(async (env: QueueMessageEnvelope) => {
          sentEnvelopes.push(env);
        }),
      };

      const sweepResult = await runOutboxDualSweep({ DB: ctx.d1, SYNC_QUEUE: mockQueue } as any);
      expect(sweepResult.dispatchedCount).toBe(1);

      const dispatchedJob = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();
      expect(dispatchedJob?.status).toBe('DISPATCHED');
      expect(dispatchedJob?.attempt_count).toBe(1);

      // Now consumer claims it -> attempt_count becomes 2
      const envelope = sentEnvelopes[0];
      const mockMsg = makeMockMessage(envelope);
      const batch = makeMockBatch([mockMsg]);

      global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'GET' || !init?.method) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: 'gtask_success_2', title: 'Task Retry' }), { status: 200 });
      }) as any;

      await processQueueBatch(batch as any, { DB: ctx.d1 });

      const finalJob = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(finalJob?.status).toBe('COMPLETED');
      expect(finalJob?.attempt_count).toBe(2);
    });

    it('enforces 5-attempt ceiling and routes to DLQ on attempt 5 failure (Tests G, H, I)', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_dlq_test';
      const pastTime = new Date(Date.now() - 60000).toISOString();

      // Job already at attempt_count = 4 in FAILED state
      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_dlq',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Terminal Task' }),
          status: 'DISPATCHED',
          attempt_count: 4, // 4 attempts executed so far
          created_at: pastTime,
          updated_at: pastTime,
        })
        .execute();

      const dlqRouted: any[] = [];
      const mockDlq = {
        send: vi.fn(async (item: any) => {
          dlqRouted.push(item);
        }),
      };

      const envelope: QueueMessageEnvelope = {
        jobId,
        idempotencyKey: idempKey,
        targetSystem: 'google_tasks',
        entityType: 'task',
        entityId: 'task_dlq',
        operation: 'create',
        schemaVersion: 1,
        payload: { title: 'Terminal Task' },
        enqueuedAt: pastTime,
      };

      const mockMsg = makeMockMessage(envelope);
      const batch = makeMockBatch([mockMsg]);

      // Mock fetch to simulate 5th attempt failure
      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ error: { message: 'Persistent 503 Service Unavailable' } }), {
          status: 503,
        });
      }) as any;

      await processQueueBatch(batch as any, { DB: ctx.d1, DLQ: mockDlq } as any);

      // Attempt count was incremented to 5 during lease acquisition (Claim #5)
      // Since attempt 5 failed, it transitions to DEAD_LETTER and routes to DLQ
      const terminalJob = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(terminalJob?.status).toBe('DEAD_LETTER');
      expect(terminalJob?.attempt_count).toBe(5);
      expect(terminalJob?.last_error).toContain('MAX_ATTEMPTS_EXHAUSTED');
      expect(dlqRouted.length).toBe(1);
      expect(mockMsg.ack).toHaveBeenCalled(); // Acknowledged from primary queue to prevent redelivery loop
    });
  });

  // ==========================================================================
  // 2. Idempotency & Duplicate Delivery Protection
  // ==========================================================================
  describe('Idempotency & Duplicate Delivery', () => {
    it('silently acknowledges redelivered message when idempotency record is COMPLETED (Scenario 4 & 6)', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_already_completed';
      const now = new Date().toISOString();

      await ctx.db
        .insertInto('idempotency_records')
        .values({
          idempotency_key: idempKey,
          job_id: jobId,
          operation: 'google_tasks.task.create',
          source_system: 'queue_consumer',
          request_hash: 'hash_completed',
          status: 'COMPLETED',
          result_payload: JSON.stringify({ status: 'COMPLETED' }),
          created_at: now,
          updated_at: now,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        })
        .execute();

      const envelope: QueueMessageEnvelope = {
        jobId,
        idempotencyKey: idempKey,
        targetSystem: 'google_tasks',
        entityType: 'task',
        entityId: 'task_dup',
        operation: 'create',
        schemaVersion: 1,
        payload: { title: 'Dup Task' },
        enqueuedAt: now,
      };

      const mockMsg = makeMockMessage(envelope);
      const batch = makeMockBatch([mockMsg]);

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;

      await processQueueBatch(batch as any, { DB: ctx.d1 });

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled(); // Zero external API calls made!
    });

    it('yields and acknowledges if another consumer claimed the processing lease concurrently', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_concurrent_claim';
      const now = new Date().toISOString();

      // Job is already in PROCESSING state with another worker
      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_concurrent',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Concurrent' }),
          status: 'PROCESSING',
          attempt_count: 1,
          processing_started_at: now,
          lease_owner: 'other_worker_xyz',
          created_at: now,
          updated_at: now,
        })
        .execute();

      const envelope: QueueMessageEnvelope = {
        jobId,
        idempotencyKey: idempKey,
        targetSystem: 'google_tasks',
        entityType: 'task',
        entityId: 'task_concurrent',
        operation: 'create',
        schemaVersion: 1,
        payload: { title: 'Concurrent' },
        enqueuedAt: now,
      };

      const mockMsg = makeMockMessage(envelope);
      const batch = makeMockBatch([mockMsg]);

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;

      await processQueueBatch(batch as any, { DB: ctx.d1 });

      expect(mockMsg.ack).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 3. Stale PROCESSING Lease Recovery & Crash Scenario 7 Loop Breaker
  // ==========================================================================
  describe('Stale Recovery & Crash Scenario 7 Loop Breaker (Tests D, E, F)', () => {
    it('CAS stale recovery claim preserves attempt_count without increment (Test D)', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_stale_recovery';
      const staleTime = new Date(Date.now() - 130 * 1000).toISOString(); // 130s ago (> 120s lease)

      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_stale',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Stale Job' }),
          status: 'PROCESSING',
          attempt_count: 1,
          processing_started_at: staleTime,
          lease_owner: 'crashed_worker',
          created_at: staleTime,
          updated_at: staleTime,
        })
        .execute();

      // Recovery handler verifies provider mutation is ABSENT
      const handler = new ConfigurableReconciliationHandler('ABSENT');
      const sweepResults = await ReliabilityEngine.sweepStaleProcessingJobs(ctx.db, handler);

      expect(sweepResults.length).toBe(1);
      expect(sweepResults[0].outcome).toBe('RECOVERED_AND_REDISPATCHED');

      const job = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      expect(job?.status).toBe('DISPATCHED');
      // Stale recovery preserves counted attempt -> attempt_count remains 1!
      expect(job?.attempt_count).toBe(1);
    });

    it('terminates recovery crash loop when last_error is RECOVERY_IN_PROGRESS (Test F / Crash Scenario 7)', async () => {
      const jobId = generateId('sync');
      const idempKey = 'idemp_crash_loop';
      const staleTime = new Date(Date.now() - 130 * 1000).toISOString();

      // Job was claimed for recovery by a worker that crashed mid-reconciliation
      await ctx.db
        .insertInto('sync_jobs')
        .values({
          job_id: jobId,
          idempotency_key: idempKey,
          target_system: 'google_tasks',
          entity_type: 'task',
          entity_id: 'task_crash_loop',
          operation: 'create',
          payload_json: JSON.stringify({ title: 'Crash Loop' }),
          status: 'PROCESSING',
          attempt_count: 1,
          processing_started_at: staleTime,
          last_error: 'RECOVERY_IN_PROGRESS', // Prior recovery worker crashed
          created_at: staleTime,
          updated_at: staleTime,
        })
        .execute();

      const handler = new ConfigurableReconciliationHandler('ABSENT');
      const sweepResults = await ReliabilityEngine.sweepStaleProcessingJobs(ctx.db, handler);

      expect(sweepResults.length).toBe(1);
      expect(sweepResults[0].outcome).toBe('RECOVERED_AND_FAILED');

      const job = await ctx.db
        .selectFrom('sync_jobs')
        .selectAll()
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      // Transitioned to FAILED with backoff to break loop
      expect(job?.status).toBe('FAILED');
      expect(job?.last_error).toBe('RECOVERY_WORKER_CRASHED');
      expect(job?.attempt_count).toBe(1);
    });
  });
});
