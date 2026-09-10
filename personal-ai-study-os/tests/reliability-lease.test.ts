import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import {
  ReliabilityRepository,
  EntitiesRepository,
} from '@personal-os/db';
import {
  ReliabilityEngine,
} from '@personal-os/core';
import {
  generateId,
  SyncJob,
  PROCESSING_LEASE_SECONDS,
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
    payloadJson: JSON.stringify({ title: 'Physics' }),
    status: 'PENDING',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Reliability Core: Lease Acquisition, Ownership & Attempt Semantics', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestDatabase();
  });

  // ==========================================================================
  // 1. Lease Acquisition
  // ==========================================================================

  it('1. PENDING -> PROCESSING transition on lease acquisition', async () => {
    const job = makeSyncJob({ status: 'PENDING', attemptCount: 0 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const now = '2026-09-11T10:00:00.000Z';
    const result = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_alpha',
      now,
    });

    expect(result.success).toBe(true);
    expect(result.lease).toBeDefined();
    expect(result.lease?.jobId).toBe(job.jobId);
    expect(result.lease?.leaseOwner).toBe('worker_alpha');
    expect(result.lease?.attemptCount).toBe(1);
    expect(result.lease?.acquiredAt).toBe(now);
    expect(result.lease?.expiresAt).toBe('2026-09-11T10:02:00.000Z'); // 120s later

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('PROCESSING');
    expect(stored?.leaseOwner).toBe('worker_alpha');
    expect(stored?.attemptCount).toBe(1);
    expect(stored?.processingStartedAt).toBe(now);
    expect(stored?.leaseExpiresAt).toBe('2026-09-11T10:02:00.000Z');
  });

  it('2. DISPATCHED -> PROCESSING transition on lease acquisition', async () => {
    const job = makeSyncJob({
      status: 'DISPATCHED',
      dispatchedAt: '2026-09-11T10:00:00.000Z',
      attemptCount: 0,
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const now = '2026-09-11T10:00:05.000Z';
    const result = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_beta',
      now,
    });

    expect(result.success).toBe(true);
    expect(result.lease?.attemptCount).toBe(1);

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('PROCESSING');
    expect(stored?.leaseOwner).toBe('worker_beta');
  });

  it('3. Concurrent consumers cannot both acquire the same lease (CAS fencing)', async () => {
    const job = makeSyncJob({ status: 'PENDING', attemptCount: 0 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const now = '2026-09-11T10:00:00.000Z';
    // Worker 1 claims
    const claim1 = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_1',
      now,
    });
    // Worker 2 attempts concurrent claim on already-claimed job
    const claim2 = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_2',
      now,
    });

    expect(claim1.success).toBe(true);
    expect(claim2.success).toBe(false);
    expect(claim2.error).toBe('INVALID_STATUS_FOR_CLAIM');

    // Only worker_1 holds the lease
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.leaseOwner).toBe('worker_1');
    expect(stored?.attemptCount).toBe(1);
  });

  it('4. Successful lease acquisition increments attempt_count exactly once', async () => {
    const job = makeSyncJob({ status: 'PENDING', attemptCount: 2 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const result = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_gamma',
      now: '2026-09-11T10:00:00.000Z',
    });

    expect(result.success).toBe(true);
    expect(result.lease?.attemptCount).toBe(3);

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.attemptCount).toBe(3);
  });

  // ==========================================================================
  // 2. Attempt Semantics
  // ==========================================================================

  it('5. Duplicate queue delivery / consumer redelivery does not increment attempt_count by itself', async () => {
    const job = makeSyncJob({ status: 'PENDING', attemptCount: 0 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Initial delivery claims lease
    const claim1 = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_consumer_1',
      now: '2026-09-11T10:00:00.000Z',
    });
    expect(claim1.success).toBe(true);
    expect(claim1.lease?.attemptCount).toBe(1);

    // Duplicate message delivery arrives while job is in PROCESSING
    const claimDuplicate = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_consumer_2',
      now: '2026-09-11T10:00:01.000Z',
    });
    expect(claimDuplicate.success).toBe(false);

    // attempt_count MUST remain 1
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.attemptCount).toBe(1);
  });

  it('6. Transient failure does not double-increment attempt_count', async () => {
    const job = makeSyncJob({ status: 'PENDING', attemptCount: 0 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Lease acquired -> attempt 1
    await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_transient',
      now: '2026-09-11T10:00:00.000Z',
    });

    // Transient failure occurs (HTTP 429 / 503)
    const marked = await ReliabilityRepository.markRetryableFailure(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_transient',
      error: 'HTTP 429 Too Many Requests',
      nextAttemptAt: '2026-09-11T10:00:05.000Z',
      now: '2026-09-11T10:00:01.000Z',
    });
    expect(marked).toBe(true);

    // Invariant: attempt_count remains 1 (+0 increment on transient failure)
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.attemptCount).toBe(1);
    expect(stored?.lastError).toBe('HTTP 429 Too Many Requests');
  });

  it('7. Stale recovery does not increment attempt_count', async () => {
    const T0 = '2026-09-11T10:00:00.000Z';
    const T0_plus_125s = '2026-09-11T10:02:05.000Z'; // Past 120s lease

    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 3,
      leaseOwner: 'worker_crashed',
      processingStartedAt: T0,
      leaseExpiresAt: '2026-09-11T10:02:00.000Z',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Sweep 2 discovers stale job and claims CAS recovery
    const recoveryResult = await ReliabilityRepository.recoverStaleLease(ctx.db, {
      jobId: job.jobId,
      newLeaseOwner: 'recovery_runner',
      now: T0_plus_125s,
    });

    expect(recoveryResult.success).toBe(true);
    expect(recoveryResult.recovered).toBe(true);
    // Invariant: attempt_count MUST remain 3
    expect(recoveryResult.lease?.attemptCount).toBe(3);

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.attemptCount).toBe(3);
    expect(stored?.leaseOwner).toBe('recovery_runner');
    expect(stored?.lastError).toBe('RECOVERY_IN_PROGRESS');
  });

  it('8. Next real execution attempt increments attempt_count from N to N+1', async () => {
    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 2,
      leaseOwner: 'recovery_runner',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Remote mutation was absent, so recovery runner re-dispatched job
    await ReliabilityRepository.markRedispatched(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'recovery_runner',
      now: '2026-09-11T10:05:00.000Z',
    });

    const redispatched = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(redispatched?.status).toBe('DISPATCHED');
    expect(redispatched?.attemptCount).toBe(2); // Still 2

    // Now a real consumer claims the next attempt
    const nextClaim = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_next_attempt',
      now: '2026-09-11T10:05:05.000Z',
    });

    expect(nextClaim.success).toBe(true);
    expect(nextClaim.lease?.attemptCount).toBe(3); // Increments to 3!

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('PROCESSING');
    expect(stored?.attemptCount).toBe(3);
  });

  it('9. Attempt 5 is allowed (Claim #5 reaches attempt_count = 5)', async () => {
    const job = makeSyncJob({ status: 'DISPATCHED', attemptCount: 4 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const result = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_final_attempt',
      now: '2026-09-11T10:00:00.000Z',
    });

    expect(result.success).toBe(true);
    expect(result.lease?.attemptCount).toBe(5);

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.attemptCount).toBe(5);
  });

  it('10. Attempt 6 is strictly impossible (attempt_count = 5 blocks further claims)', async () => {
    const job = makeSyncJob({ status: 'DISPATCHED', attemptCount: 5 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const result = await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_illegal_attempt_6',
      now: '2026-09-11T10:00:00.000Z',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('MAX_ATTEMPTS_EXCEEDED');

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.attemptCount).toBe(5);
    expect(stored?.status).toBe('DISPATCHED');
  });

  // ==========================================================================
  // 3. Lease Ownership & CAS Fencing
  // ==========================================================================

  it('11. Current lease owner can finalize (markSucceeded)', async () => {
    const job = makeSyncJob({ status: 'PENDING', attemptCount: 0 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'legitimate_owner',
      now: '2026-09-11T10:00:00.000Z',
    });

    const finalized = await ReliabilityRepository.markSucceeded(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'legitimate_owner',
      completedAt: '2026-09-11T10:00:10.000Z',
    });

    expect(finalized).toBe(true);
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.completedAt).toBe('2026-09-11T10:00:10.000Z');
  });

  it('12. Expired / lost lease owner cannot finalize', async () => {
    const job = makeSyncJob({ status: 'PENDING', attemptCount: 0 });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    // Worker 1 claims
    await ReliabilityRepository.claimProcessingLease(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_1',
      now: '2026-09-11T10:00:00.000Z',
    });

    // Stale recovery takes ownership for worker_recovery
    await ReliabilityRepository.recoverStaleLease(ctx.db, {
      jobId: job.jobId,
      newLeaseOwner: 'worker_recovery',
      now: '2026-09-11T10:02:05.000Z',
    });

    // Zombie worker_1 now wakes up and attempts to finalize
    const zombieFinalize = await ReliabilityRepository.markSucceeded(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'worker_1', // Stale owner!
      completedAt: '2026-09-11T10:02:10.000Z',
    });

    expect(zombieFinalize).toBe(false);

    // Job remains under worker_recovery ownership, NOT completed by zombie
    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('PROCESSING');
    expect(stored?.leaseOwner).toBe('worker_recovery');
  });

  it('13. Recovered owner can finalize', async () => {
    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 1,
      leaseOwner: 'crashed_worker',
      processingStartedAt: '2026-09-11T10:00:00.000Z',
      leaseExpiresAt: '2026-09-11T10:02:00.000Z',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const recovery = await ReliabilityRepository.recoverStaleLease(ctx.db, {
      jobId: job.jobId,
      newLeaseOwner: 'authorized_recovery_owner',
      now: '2026-09-11T10:02:05.000Z',
    });
    expect(recovery.success).toBe(true);

    const finalized = await ReliabilityRepository.markSucceeded(ctx.db, {
      jobId: job.jobId,
      leaseOwner: 'authorized_recovery_owner',
      completedAt: '2026-09-11T10:02:10.000Z',
    });
    expect(finalized).toBe(true);

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.leaseOwner).toBe('authorized_recovery_owner');
  });

  it('14. Concurrent stale recovery has exactly one winner', async () => {
    const job = makeSyncJob({
      status: 'PROCESSING',
      attemptCount: 1,
      leaseOwner: 'worker_crashed',
      processingStartedAt: '2026-09-11T10:00:00.000Z',
      leaseExpiresAt: '2026-09-11T10:02:00.000Z',
    });
    await ReliabilityRepository.createSyncJob(ctx.db, job);

    const now = '2026-09-11T10:02:05.000Z';
    // Recovery runner A claims
    const claimA = await ReliabilityRepository.recoverStaleLease(ctx.db, {
      jobId: job.jobId,
      newLeaseOwner: 'runner_A',
      now,
    });
    // Recovery runner B concurrently attempts claim
    const claimB = await ReliabilityRepository.recoverStaleLease(ctx.db, {
      jobId: job.jobId,
      newLeaseOwner: 'runner_B',
      now,
    });

    expect(claimA.success).toBe(true);
    expect(claimA.recovered).toBe(true);

    // Runner B must fail because the lease is no longer stale (runner A updated lease_expires_at)
    expect(claimB.success).toBe(false);
    expect(claimB.recovered).toBe(false);

    const stored = await ReliabilityRepository.getSyncJob(ctx.db, job.jobId);
    expect(stored?.leaseOwner).toBe('runner_A');
  });
});
