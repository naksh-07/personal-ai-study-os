import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { createTestDatabase, TestContext } from './test-helper';
import {
  ReliabilityRepository,
  EntitiesRepository,
  CanonicalEventsRepository,
  executeD1Batch,
} from '@personal-os/db';
import {
  ReliabilityEngine,
  ConfigurableReconciliationHandler,
  AtomicWriter,
  CanonicalEventEngine,
} from '@personal-os/core';
import {
  generateId,
  SyncJob,
  StateTransitionError,
  DomainError,
  assertValidSyncJobTransition,
  isValidSyncJobTransition,
  classifyReliabilityFailure,
  computeExponentialBackoffDelaySeconds,
  MAX_EXECUTION_ATTEMPTS,
} from '@personal-os/domain';

function makeSyncJob(overrides: Partial<SyncJob> = {}): SyncJob {
  const now = '2026-09-11T10:00:00.000Z';
  return {
    jobId: generateId('sync'),
    idempotencyKey: generateId('idemp'),
    targetSystem: 'notion',
    entityType: 'chapter',
    entityId: 'chap_01',
    operation: 'sync',
    payloadJson: JSON.stringify({ title: 'Electromagnetism' }),
    status: 'PENDING',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Reliability Core: Idempotency, Crash Recovery, Classification, Atomicity & State Machine', () => {
  let ctx: TestContext;
  let subjectId: string;
  let chapterId: string;

  beforeEach(async () => {
    ctx = createTestDatabase();
    subjectId = generateId('subj');
    chapterId = generateId('chap');

    await EntitiesRepository.insertUser(ctx.db, {
      id: generateId('usr'),
      timezone: 'UTC',
      status: 'active',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    await EntitiesRepository.insertSubject(ctx.db, {
      id: subjectId,
      name: 'Physics',
      slug: 'physics',
      status: 'active',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    await EntitiesRepository.insertChapter(ctx.db, {
      id: chapterId,
      subjectId,
      name: 'Thermodynamics',
      slug: 'thermodynamics',
      status: 'not_started',
      progress: 0.0,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });
  });

  // ==========================================================================
  // 4. Idempotency
  // ==========================================================================

  it('15. Duplicate operation resolves to one logical mutation', async () => {
    const job = makeSyncJob();
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const requestPayload = JSON.stringify({ action: 'create_page', chapterId });
    const requestHash = crypto.createHash('sha256').update(requestPayload).digest('hex');

    let externalCallCount = 0;
    const mutation = async () => {
      externalCallCount++;
      return { externalPageId: 'notion_page_123' };
    };

    // First attempt
    const result1 = await ReliabilityEngine.executeAttempt({
      db: ctx.db,
      jobId: job.jobId,
      leaseOwner: 'worker_1',
      requestHash,
      mutationFn: mutation,
    });

    expect(result1.success).toBe(true);
    expect(result1.state).toBe('COMPLETED');
    expect(externalCallCount).toBe(1);

    // Duplicate attempt with same idempotency key and payload
    const result2 = await ReliabilityEngine.executeAttempt({
      db: ctx.db,
      jobId: job.jobId,
      leaseOwner: 'worker_2',
      requestHash,
      mutationFn: mutation,
    });

    expect(result2.success).toBe(true);
    expect(result2.state).toBe('SKIPPED_IDEMPOTENT');
    expect(result2.cachedPayload).toContain('notion_page_123');
    // Invariant: external provider mutation was called exactly ONCE
    expect(externalCallCount).toBe(1);
  });

  it('16. Concurrent idempotency claims have one winner and reject conflicts', async () => {
    const key = generateId('idemp');
    const hashA = crypto.createHash('sha256').update('payload_A').digest('hex');
    const hashB = crypto.createHash('sha256').update('payload_B').digest('hex');

    // Claim A
    const claimA = await ReliabilityRepository.claimIdempotency(ctx.db, {
      idempotencyKey: key,
      operation: 'test.op',
      sourceSystem: 'test',
      requestHash: hashA,
    });
    expect(claimA.state).toBe('CLAIMED');

    // Attempting same key with different hash must throw IDEMPOTENCY_CONFLICT
    await expect(
      ReliabilityRepository.claimIdempotency(ctx.db, {
        idempotencyKey: key,
        operation: 'test.op',
        sourceSystem: 'test',
        requestHash: hashB,
      })
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  });

  it('17. Existing successful idempotency record prevents duplicate mutation', async () => {
    const key = generateId('idemp');
    const hash = crypto.createHash('sha256').update('payload_data').digest('hex');
    const cachedResponse = JSON.stringify({ status: 'ok', id: 'ext_999' });

    // Seed completed idempotency record
    await EntitiesRepository.createInsertIdempotencyRecordQuery(ctx.db, {
      idempotencyKey: key,
      operation: 'test.op',
      sourceSystem: 'test',
      requestHash: hash,
      resultHash: crypto.createHash('sha256').update(cachedResponse).digest('hex'),
      status: 'COMPLETED',
      resultPayload: cachedResponse,
      createdAt: '2026-09-11T10:00:00.000Z',
      updatedAt: '2026-09-11T10:00:00.000Z',
      expiresAt: '2026-09-12T10:00:00.000Z',
    }).execute();

    const claim = await ReliabilityRepository.claimIdempotency(ctx.db, {
      idempotencyKey: key,
      operation: 'test.op',
      sourceSystem: 'test',
      requestHash: hash,
    });

    expect(claim.state).toBe('COMPLETED');
    expect((claim as any).cachedPayload).toBe(cachedResponse);
  });

  it('18. Ambiguous outcome enters reconciliation path before mutation', async () => {
    const job = makeSyncJob({
      status: 'DISPATCHED',
      attemptCount: 1,
      lastError: 'RECONCILIATION_UNCERTAIN: previous call timed out in-flight',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const requestHash = crypto.createHash('sha256').update('test_payload').digest('hex');
    const reconciler = new ConfigurableReconciliationHandler('APPLIED');

    let mutationCalled = false;
    const mutation = async () => {
      mutationCalled = true;
      return { created: true };
    };

    // Reconciler confirms APPLIED -> should complete without calling mutationFn!
    const result = await ReliabilityEngine.executeAttempt({
      db: ctx.db,
      jobId: job.jobId,
      leaseOwner: 'worker_recon',
      requestHash,
      mutationFn: mutation,
      reconciliationHandler: reconciler,
    });

    expect(result.success).toBe(true);
    expect(result.state).toBe('COMPLETED');
    expect(mutationCalled).toBe(false); // Blind mutation was prevented!
  });

  // ==========================================================================
  // 5. Crash Recovery (Normative Scenarios)
  // ==========================================================================

  it('19. Crash before provider call (Scenario 3): Stale recovery discovers job', async () => {
    const T0 = '2026-09-11T10:00:00.000Z';
    const T0_plus_130s = '2026-09-11T10:02:10.000Z';

    // Worker claimed lease at T0 then crashed before provider call
    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 1,
      leaseOwner: 'crashed_before_provider',
      processingStartedAt: T0,
      leaseExpiresAt: '2026-09-11T10:02:00.000Z',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Reconciler detects mutation was ABSENT
    const reconciler = new ConfigurableReconciliationHandler('ABSENT');
    const recovery = await ReliabilityEngine.recoverStaleLease(
      ctx.db,
      job.jobId,
      'recovery_worker_19',
      reconciler,
      T0_plus_130s
    );

    expect(recovery.success).toBe(true);
    expect(recovery.reconciliationOutcome).toBe('ABSENT');

    // Job transitions to DISPATCHED for a future counted attempt N+1
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('DISPATCHED');
    expect(stored?.attemptCount).toBe(1); // Preserved at 1 until next real claim
  });

  it('20. Crash during provider call (Scenario 4): Recovery reconciles before retry', async () => {
    const T0 = '2026-09-11T10:00:00.000Z';
    const T0_plus_130s = '2026-09-11T10:02:10.000Z';

    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 2,
      leaseOwner: 'crashed_mid_call',
      processingStartedAt: T0,
      leaseExpiresAt: '2026-09-11T10:02:00.000Z',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Reconciliation returns UNCERTAIN (e.g. provider returned 429 during check)
    const reconciler = new ConfigurableReconciliationHandler('UNCERTAIN');
    const recovery = await ReliabilityEngine.recoverStaleLease(
      ctx.db,
      job.jobId,
      'recovery_worker_20',
      reconciler,
      T0_plus_130s
    );

    expect(recovery.success).toBe(true);
    expect(recovery.reconciliationOutcome).toBe('UNCERTAIN');

    // Transitions to FAILED with exponential backoff scheduled
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.lastError).toContain('RECONCILIATION_UNCERTAIN');
    expect(stored?.attemptCount).toBe(2); // Preserved
  });

  it('21. Crash after provider success before local finalization (Scenario 5): Reconciliation verifies APPLIED -> COMPLETED', async () => {
    const T0 = '2026-09-11T10:00:00.000Z';
    const T0_plus_130s = '2026-09-11T10:02:10.000Z';

    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 1,
      leaseOwner: 'crashed_after_success',
      processingStartedAt: T0,
      leaseExpiresAt: '2026-09-11T10:02:00.000Z',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Reconciler inspects remote provider and finds the entity already created
    const reconciler = new ConfigurableReconciliationHandler('APPLIED');
    const recovery = await ReliabilityEngine.recoverStaleLease(
      ctx.db,
      job.jobId,
      'recovery_worker_21',
      reconciler,
      T0_plus_130s
    );

    expect(recovery.success).toBe(true);
    expect(recovery.reconciliationOutcome).toBe('APPLIED');

    // Marks COMPLETED without re-executing the provider call!
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.attemptCount).toBe(1);
  });

  it('22. Crash Scenario 7: Recovery worker crash loop elimination', async () => {
    const T0 = '2026-09-11T10:00:00.000Z';
    const T0_plus_130s = '2026-09-11T10:02:10.000Z';

    // A recovery worker crashed during previous attempt's recovery!
    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 2,
      leaseOwner: 'dead_recovery_worker',
      lastError: 'RECOVERY_IN_PROGRESS', // Prior recovery crashed!
      processingStartedAt: T0,
      leaseExpiresAt: '2026-09-11T10:02:00.000Z',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const reconciler = new ConfigurableReconciliationHandler('ABSENT');
    // Next sweep detects Crash Scenario 7
    const recovery = await ReliabilityEngine.recoverStaleLease(
      ctx.db,
      job.jobId,
      'new_recovery_runner',
      reconciler,
      T0_plus_130s
    );

    expect(recovery.success).toBe(true);
    expect(recovery.crashLoopDetected).toBe(true);
    expect(recovery.terminalDlq).toBe(false);

    // Breaks loop: transitions to FAILED with retry backoff
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.lastError).toBe('RECOVERY_WORKER_CRASHED');
  });

  // ==========================================================================
  // 6. Failure Classification & Retry Ceiling
  // ==========================================================================

  it('23. Transient failure retries with deterministic exponential backoff', async () => {
    expect(computeExponentialBackoffDelaySeconds(1)).toBe(5);
    expect(computeExponentialBackoffDelaySeconds(2)).toBe(10);
    expect(computeExponentialBackoffDelaySeconds(3)).toBe(20);
    expect(computeExponentialBackoffDelaySeconds(4)).toBe(40);
    expect(computeExponentialBackoffDelaySeconds(5)).toBe(0); // Ceiling

    const job = makeSyncJob({ status: 'PENDING', attemptCount: 0 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const requestHash = crypto.createHash('sha256').update('data').digest('hex');
    const result = await ReliabilityEngine.executeAttempt({
      db: ctx.db,
      jobId: job.jobId,
      leaseOwner: 'worker_retry',
      requestHash,
      mutationFn: async () => {
        const error = new Error('HTTP 503 Service Unavailable');
        (error as any).status = 503;
        throw error;
      },
    });

    expect(result.success).toBe(false);
    expect(result.state).toBe('RETRY_SCHEDULED');

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.attemptCount).toBe(1); // Single increment on claim
    expect(stored?.nextAttemptAt).toBeDefined();
  });

  it('24. Permanent failure terminates to DEAD_LETTER immediately without retry', async () => {
    const job = makeSyncJob({ status: 'PENDING', attemptCount: 0 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const requestHash = crypto.createHash('sha256').update('data').digest('hex');
    const result = await ReliabilityEngine.executeAttempt({
      db: ctx.db,
      jobId: job.jobId,
      leaseOwner: 'worker_perm_fail',
      requestHash,
      mutationFn: async () => {
        const error = new Error('HTTP 400 Bad Request: Invalid Entity ID');
        (error as any).status = 400;
        throw error;
      },
    });

    expect(result.success).toBe(false);
    expect(result.state).toBe('DEAD_LETTER');

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('DEAD_LETTER');
    expect(stored?.completedAt).toBeDefined();
  });

  it('25. Ambiguous failure classifies correctly and does not blind-create', () => {
    const classified = classifyReliabilityFailure(new Error('RECONCILIATION_UNCERTAIN: timeout'));
    expect(classified.category).toBe('AMBIGUOUS');
    expect(classified.isRetryable).toBe(true);

    const perm = classifyReliabilityFailure(new Error('HTTP 404 Not Found'));
    expect(perm.category).toBe('PERMANENT');
    expect(perm.isRetryable).toBe(false);
  });

  it('26. Retry ceiling terminates correctly after attempt 5', async () => {
    // Job already at attempt 4
    const job = makeSyncJob({ status: 'DISPATCHED', attemptCount: 4 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const requestHash = crypto.createHash('sha256').update('data').digest('hex');
    // Attempt 5 runs and fails transiently
    const result = await ReliabilityEngine.executeAttempt({
      db: ctx.db,
      jobId: job.jobId,
      leaseOwner: 'worker_attempt_5',
      requestHash,
      mutationFn: async () => {
        const err = new Error('HTTP 429 Rate limit');
        (err as any).status = 429;
        throw err;
      },
    });

    expect(result.success).toBe(false);
    // Invariant: attempt 5 failing transitions directly to DEAD_LETTER
    expect(result.state).toBe('DEAD_LETTER');

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('DEAD_LETTER');
    expect(stored?.attemptCount).toBe(5);
    expect(stored?.lastError).toContain('MAX_ATTEMPTS_EXHAUSTED');
  });

  // ==========================================================================
  // 7. Atomicity & Transactional Outbox
  // ==========================================================================

  it('27. Canonical event + sync job commit atomically in single db.batch()', async () => {
    const syncJob = makeSyncJob();
    const event = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      occurredAt: '2026-09-11T12:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId,
        subjectId,
        durationSeconds: 1200,
        questionsAttempted: 10,
        questionsCorrect: 8,
      },
    });

    const result = await AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, {
      event,
      syncJob,
    });

    expect(result.success).toBe(true);

    // Both canonical event and outbox sync job are durably committed in D1
    const storedEvent = await CanonicalEventsRepository.getById(ctx.db, event.eventId);
    const storedJob = await ReliabilityRepository.getSyncJob(ctx.db, syncJob.jobId);

    expect(storedEvent).toBeDefined();
    expect(storedJob).toBeDefined();
    expect(storedJob?.jobId).toBe(syncJob.jobId);
    expect(storedJob?.status).toBe('PENDING');
  });

  it('28. Failed batch leaves no orphan sync job', async () => {
    const syncJob = makeSyncJob();
    // Non-existent chapter will cause validation failure before batch execution
    const invalidEvent = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      occurredAt: '2026-09-11T12:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: 'chap_nonexistent_999',
        subjectId,
        durationSeconds: 1200,
      },
    });

    await expect(
      AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, {
        event: invalidEvent,
        syncJob,
      })
    ).rejects.toThrow();

    // No orphan sync job in D1
    const storedJob = await ReliabilityRepository.getSyncJob(ctx.db, syncJob.jobId);
    expect(storedJob).toBeNull();
  });

  it('29. Failed batch does not leave a canonical event without its required transactional work', async () => {
    // If the syncJob causes a unique constraint failure in D1, the entire batch must roll back
    const existingJob = makeSyncJob();
    await ReliabilityRepository.createSyncJob(ctx.db, existingJob);

    // Attempt to ingest an event with duplicate sync_job ID
    const duplicateJob = makeSyncJob({ jobId: existingJob.jobId });
    const event = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      occurredAt: '2026-09-11T12:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId,
        subjectId,
        durationSeconds: 1200,
      },
    });

    await expect(
      AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, {
        event,
        syncJob: duplicateJob,
      })
    ).rejects.toThrow();

    // The canonical event must NOT exist in the ledger (atomic rollback)
    const storedEvent = await CanonicalEventsRepository.getById(ctx.db, event.eventId);
    expect(storedEvent).toBeNull();
  });

  // ==========================================================================
  // 8. State Machine Invariants
  // ==========================================================================

  it('30. Invalid state transitions rejected with StateTransitionError', () => {
    expect(isValidSyncJobTransition('PENDING', 'DISPATCHED')).toBe(true);
    expect(isValidSyncJobTransition('PENDING', 'PROCESSING')).toBe(true);
    expect(isValidSyncJobTransition('DISPATCHED', 'PROCESSING')).toBe(true);
    expect(isValidSyncJobTransition('PROCESSING', 'COMPLETED')).toBe(true);
    expect(isValidSyncJobTransition('PROCESSING', 'FAILED')).toBe(true);
    expect(isValidSyncJobTransition('PROCESSING', 'DEAD_LETTER')).toBe(true);
    expect(isValidSyncJobTransition('FAILED', 'DISPATCHED')).toBe(true);

    // Illegal jumps
    expect(isValidSyncJobTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(isValidSyncJobTransition('DISPATCHED', 'COMPLETED')).toBe(false);
    expect(isValidSyncJobTransition('FAILED', 'COMPLETED')).toBe(false);

    expect(() => assertValidSyncJobTransition('PENDING', 'COMPLETED')).toThrow(
      StateTransitionError
    );
  });

  it('31. Terminal jobs (COMPLETED, DEAD_LETTER) cannot re-enter processing', () => {
    expect(isValidSyncJobTransition('COMPLETED', 'PENDING')).toBe(false);
    expect(isValidSyncJobTransition('COMPLETED', 'DISPATCHED')).toBe(false);
    expect(isValidSyncJobTransition('COMPLETED', 'PROCESSING')).toBe(false);

    expect(isValidSyncJobTransition('DEAD_LETTER', 'PENDING')).toBe(false);
    expect(isValidSyncJobTransition('DEAD_LETTER', 'DISPATCHED')).toBe(false);
    expect(isValidSyncJobTransition('DEAD_LETTER', 'PROCESSING')).toBe(false);

    expect(() => assertValidSyncJobTransition('COMPLETED', 'PROCESSING')).toThrow(
      StateTransitionError
    );
    expect(() => assertValidSyncJobTransition('DEAD_LETTER', 'PROCESSING')).toThrow(
      StateTransitionError
    );
  });

  it('32. Finalization requires valid lease ownership', async () => {
    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 1,
      leaseOwner: 'owner_primary',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Stranger attempts to mark succeeded
    const strangerFinalize = await ReliabilityRepository.markSucceeded(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'stranger_worker',
    });
    expect(strangerFinalize).toBe(false);

    // Stranger attempts to mark failed
    const strangerFail = await ReliabilityRepository.markRetryableFailure(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'stranger_worker',
      error: 'Some error',
      nextAttemptAt: '2026-09-11T10:05:00.000Z',
    });
    expect(strangerFail).toBe(false);

    // Job state remains intact under owner_primary
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('PROCESSING');
    expect(stored?.leaseOwner).toBe('owner_primary');
  });
});
