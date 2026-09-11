import { Kysely } from 'kysely';
import crypto from 'node:crypto';
import {
  Database,
  ReliabilityRepository,
  ClaimLeaseResult,
  RecoverLeaseResult,
} from '@personal-os/db';
import {
  SyncJob,
  ProcessingLease,
  MAX_EXECUTION_ATTEMPTS,
  computeExponentialBackoffDelaySeconds,
  classifyReliabilityFailure,
  DomainError,
} from '@personal-os/domain';
import { ProviderReconciliationHandler } from './reconciliation';

// ============================================================================
// Types & Options
// ============================================================================

export interface ExecuteAttemptOptions<T = unknown> {
  db: Kysely<Database>;
  jobId: string;
  leaseOwner: string;
  requestHash: string;
  mutationFn: (job: SyncJob, lease: ProcessingLease) => Promise<T>;
  reconciliationHandler?: ProviderReconciliationHandler;
  now?: string; // Controlled time for tests
}

export interface ExecuteAttemptResult<T = unknown> {
  success: boolean;
  state:
    | 'COMPLETED'
    | 'RETRY_SCHEDULED'
    | 'DEAD_LETTER'
    | 'SKIPPED_IDEMPOTENT'
    | 'LEASE_ACQUISITION_FAILED';
  result?: T;
  cachedPayload?: string;
  error?: string;
  lease?: ProcessingLease;
}

export interface SweepRecoveryResult {
  jobId: string;
  outcome: 'RECOVERED_AND_REDISPATCHED' | 'RECOVERED_AND_COMPLETED' | 'RECOVERED_AND_FAILED' | 'TERMINAL_DEAD_LETTER' | 'SKIPPED';
}

// ============================================================================
// Core Reliability Engine Implementation
// ============================================================================

export class ReliabilityEngine {
  /**
   * Enqueues a sync job into the transactional outbox.
   */
  static async enqueueWork(db: Kysely<Database>, job: SyncJob): Promise<void> {
    await ReliabilityRepository.createSyncJob(db, job);
  }

  /**
   * Acquires a processing lease for an execution attempt.
   * Increments attempt_count exactly once atomically.
   */
  static async acquireProcessingLease(
    db: Kysely<Database>,
    jobId: string,
    leaseOwner: string,
    now?: string
  ): Promise<ClaimLeaseResult> {
    return ReliabilityRepository.claimProcessingLease(db, {
      jobId,
      leaseOwner,
      now,
    });
  }

  /**
   * Recovers a stale processing lease with Crash Scenario 7 loop elimination
   * and pre-retry provider reconciliation.
   */
  static async recoverStaleLease(
    db: Kysely<Database>,
    jobId: string,
    newLeaseOwner: string,
    reconciliationHandler: ProviderReconciliationHandler,
    now?: string
  ): Promise<RecoverLeaseResult & { reconciliationOutcome?: string }> {
    const claim = await ReliabilityRepository.recoverStaleLease(db, {
      jobId,
      newLeaseOwner,
      now,
    });

    // If crash loop was detected or recovery failed, return early
    if (!claim.success || !claim.recovered || !claim.lease) {
      return claim;
    }

    const job = await ReliabilityRepository.getSyncJob(db, jobId);
    if (!job) {
      return { ...claim, success: false, error: 'JOB_NOT_FOUND_AFTER_RECOVERY' };
    }

    // Provider Reconciliation Check (Section 9.3 B5 & Section 10.5)
    const outcome = await reconciliationHandler.reconcile(job);

    if (outcome === 'APPLIED') {
      // Mutation verified on provider: resolve to COMPLETED
      await ReliabilityRepository.markSucceeded(db, {
        jobId,
        leaseOwner: newLeaseOwner,
        completedAt: now,
      });
      await ReliabilityRepository.finalizeIdempotency(db, {
        idempotencyKey: job.idempotencyKey,
        status: 'COMPLETED',
        now,
      });
      return { ...claim, reconciliationOutcome: 'APPLIED' };
    }

    if (outcome === 'ABSENT') {
      // Mutation is absent on provider:
      if (job.attemptCount < MAX_EXECUTION_ATTEMPTS) {
        // Safe to schedule a new execution attempt: mark DISPATCHED (next claim will be Attempt N+1)
        await ReliabilityRepository.markRedispatched(db, {
          jobId,
          leaseOwner: newLeaseOwner,
          now,
        });
        return { ...claim, reconciliationOutcome: 'ABSENT' };
      } else {
        // Execution budget exhausted: route to DEAD_LETTER
        await ReliabilityRepository.markTerminalFailure(db, {
          jobId,
          leaseOwner: newLeaseOwner,
          error: 'MAX_ATTEMPTS_EXHAUSTED_MUTATION_ABSENT',
          completedAt: now,
        });
        return { ...claim, terminalDlq: true, reconciliationOutcome: 'ABSENT' };
      }
    }

    // outcome === 'UNCERTAIN'
    if (job.attemptCount < MAX_EXECUTION_ATTEMPTS) {
      const delay = computeExponentialBackoffDelaySeconds(job.attemptCount);
      const currentTime = now ? new Date(now).getTime() : Date.now();
      const nextAttemptAt = new Date(currentTime + delay * 1000).toISOString();
      await ReliabilityRepository.markRetryableFailure(db, {
        jobId,
        leaseOwner: newLeaseOwner,
        error: 'RECONCILIATION_UNCERTAIN: Provider returned timeout or error during reconciliation',
        nextAttemptAt,
        now,
      });
      return { ...claim, reconciliationOutcome: 'UNCERTAIN' };
    } else {
      await ReliabilityRepository.markTerminalFailure(db, {
        jobId,
        leaseOwner: newLeaseOwner,
        error: 'AMBIGUOUS_PROVIDER_STATE_MAX_ATTEMPTS_EXHAUSTED',
        completedAt: now,
      });
      return { ...claim, terminalDlq: true, reconciliationOutcome: 'UNCERTAIN' };
    }
  }

  /**
   * Executes an end-to-end processing attempt:
   * 1. Check idempotency.
   * 2. Claim atomic processing lease (increments attempt_count exactly once).
   * 3. Reconcile ambiguous state if needed.
   * 4. Execute mutation.
   * 5. Finalize CAS ownership (mark COMPLETED or FAILED/DEAD_LETTER).
   */
  static async executeAttempt<T = unknown>(
    options: ExecuteAttemptOptions<T>
  ): Promise<ExecuteAttemptResult<T>> {
    const { db, jobId, leaseOwner, requestHash, mutationFn, reconciliationHandler, now } = options;
    const currentTime = now ?? new Date().toISOString();

    const job = await ReliabilityRepository.getSyncJob(db, jobId);
    if (!job) {
      return {
        success: false,
        state: 'LEASE_ACQUISITION_FAILED',
        error: `Sync job '${jobId}' not found`,
      };
    }

    // 1. Check / Claim Idempotency Record
    const idempClaim = await ReliabilityRepository.claimIdempotency(db, {
      idempotencyKey: job.idempotencyKey,
      jobId: job.jobId,
      operation: `${job.targetSystem}.${job.entityType}.${job.operation}`,
      sourceSystem: 'queue_consumer',
      requestHash,
      now: currentTime,
    });

    if (idempClaim.state === 'COMPLETED') {
      return {
        success: true,
        state: 'SKIPPED_IDEMPOTENT',
        cachedPayload: idempClaim.cachedPayload,
      };
    }

    // 2. Atomic Processing Lease Acquisition (Single attempt increment)
    const leaseClaim = await ReliabilityRepository.claimProcessingLease(db, {
      jobId,
      leaseOwner,
      now: currentTime,
    });

    if (!leaseClaim.success || !leaseClaim.lease) {
      return {
        success: false,
        state: 'LEASE_ACQUISITION_FAILED',
        error: leaseClaim.error ?? 'LEASE_ACQUISITION_FAILED',
      };
    }

    const lease = leaseClaim.lease;

    // 3. Pre-Mutation Provider Reconciliation Boundary
    // If the previous attempt failed ambiguously or was uncertain, inspect remote state first
    if (job.lastError?.includes('RECONCILIATION_UNCERTAIN') && reconciliationHandler) {
      const outcome = await reconciliationHandler.reconcile(job);
      if (outcome === 'APPLIED') {
        await ReliabilityRepository.markSucceeded(db, {
          jobId,
          leaseOwner,
          completedAt: currentTime,
        });
        await ReliabilityRepository.finalizeIdempotency(db, {
          idempotencyKey: job.idempotencyKey,
          status: 'COMPLETED',
          now: currentTime,
        });
        return {
          success: true,
          state: 'COMPLETED',
          lease,
        };
      }
      if (outcome === 'UNCERTAIN') {
        // Still uncertain: yield without mutating!
        if (lease.attemptCount < MAX_EXECUTION_ATTEMPTS) {
          const delay = computeExponentialBackoffDelaySeconds(lease.attemptCount);
          const nextAttemptAt = new Date(new Date(currentTime).getTime() + delay * 1000).toISOString();
          await ReliabilityRepository.markRetryableFailure(db, {
            jobId,
            leaseOwner,
            error: 'RECONCILIATION_UNCERTAIN: Indeterminate state before mutation',
            nextAttemptAt,
            now: currentTime,
          });
          return {
            success: false,
            state: 'RETRY_SCHEDULED',
            error: 'RECONCILIATION_UNCERTAIN',
            lease,
          };
        } else {
          await ReliabilityRepository.markTerminalFailure(db, {
            jobId,
            leaseOwner,
            error: 'AMBIGUOUS_PROVIDER_STATE_MAX_ATTEMPTS_EXHAUSTED',
            completedAt: currentTime,
          });
          return {
            success: false,
            state: 'DEAD_LETTER',
            error: 'AMBIGUOUS_PROVIDER_STATE_MAX_ATTEMPTS_EXHAUSTED',
            lease,
          };
        }
      }
    }

    // 4. Execute the external mutation
    try {
      const result = await mutationFn(job, lease);

      // Finalize CAS Success
      const serialized = JSON.stringify(result ?? {});
      const resultHash = crypto.createHash('sha256').update(serialized).digest('hex');

      const finalized = await ReliabilityRepository.markSucceeded(db, {
        jobId,
        leaseOwner,
        completedAt: currentTime,
      });

      if (!finalized) {
        // Lost lease to recovery worker during execution!
        return {
          success: false,
          state: 'LEASE_ACQUISITION_FAILED',
          error: 'LEASE_LOST_DURING_EXECUTION',
          lease,
        };
      }

      await ReliabilityRepository.finalizeIdempotency(db, {
        idempotencyKey: job.idempotencyKey,
        status: 'COMPLETED',
        resultPayload: serialized,
        resultHash,
        now: currentTime,
      });

      return {
        success: true,
        state: 'COMPLETED',
        result,
        lease,
      };
    } catch (err) {
      // 5. Failure Classification & Bounded Handling
      const failure = classifyReliabilityFailure(err);

      if (failure.category === 'TRANSIENT' && lease.attemptCount < MAX_EXECUTION_ATTEMPTS) {
        const delay = computeExponentialBackoffDelaySeconds(lease.attemptCount);
        const nextAttemptAt = new Date(new Date(currentTime).getTime() + delay * 1000).toISOString();

        await ReliabilityRepository.markRetryableFailure(db, {
          jobId,
          leaseOwner,
          error: failure.message,
          nextAttemptAt,
          now: currentTime,
        });

        return {
          success: false,
          state: 'RETRY_SCHEDULED',
          error: failure.message,
          lease,
        };
      }

      if (failure.category === 'AMBIGUOUS' && lease.attemptCount < MAX_EXECUTION_ATTEMPTS) {
        const delay = computeExponentialBackoffDelaySeconds(lease.attemptCount);
        const nextAttemptAt = new Date(new Date(currentTime).getTime() + delay * 1000).toISOString();

        await ReliabilityRepository.markRetryableFailure(db, {
          jobId,
          leaseOwner,
          error: `RECONCILIATION_UNCERTAIN: ${failure.message}`,
          nextAttemptAt,
          now: currentTime,
        });

        return {
          success: false,
          state: 'RETRY_SCHEDULED',
          error: failure.message,
          lease,
        };
      }

      // Permanent failure OR attemptCount >= MAX_EXECUTION_ATTEMPTS -> DEAD_LETTER
      const finalErrorReason =
        lease.attemptCount >= MAX_EXECUTION_ATTEMPTS
          ? `MAX_ATTEMPTS_EXHAUSTED: ${failure.message}`
          : failure.message;

      await ReliabilityRepository.markTerminalFailure(db, {
        jobId,
        leaseOwner,
        error: finalErrorReason,
        completedAt: currentTime,
      });

      await ReliabilityRepository.finalizeIdempotency(db, {
        idempotencyKey: job.idempotencyKey,
        status: 'FAILED',
        now: currentTime,
      });

      return {
        success: false,
        state: 'DEAD_LETTER',
        error: finalErrorReason,
        lease,
      };
    }
  }

  /**
   * Sweep 1: Outbox sweep for undispatched and ready retry candidates.
   */
  static async sweepUndispatchedAndFailedJobs(
    db: Kysely<Database>,
    queueDispatcher: (job: SyncJob) => Promise<void>,
    now?: string
  ): Promise<number> {
    const jobs = await ReliabilityRepository.findProcessableJobs(db, { now });
    let dispatchedCount = 0;

    for (const job of jobs) {
      await queueDispatcher(job);
      const currentTime = now ?? new Date().toISOString();
      await db
        .updateTable('sync_jobs')
        .set({
          status: 'DISPATCHED',
          dispatched_at: currentTime,
          updated_at: currentTime,
        })
        .where('job_id', '=', job.jobId)
        .where('status', 'in', ['PENDING', 'FAILED'])
        .execute();
      dispatchedCount++;
    }

    return dispatchedCount;
  }

  /**
   * Sweep 2: Stale lease recovery sweep.
   */
  static async sweepStaleProcessingJobs(
    db: Kysely<Database>,
    reconciliationHandler: ProviderReconciliationHandler,
    recoveryOwnerPrefix: string = 'recovery_worker_',
    now?: string
  ): Promise<SweepRecoveryResult[]> {
    const staleJobs = await ReliabilityRepository.findStaleProcessingJobs(db, { now });
    const results: SweepRecoveryResult[] = [];

    for (const job of staleJobs) {
      const recoveryOwner = `${recoveryOwnerPrefix}${crypto.randomUUID()}`;
      const outcome = await ReliabilityEngine.recoverStaleLease(
        db,
        job.jobId,
        recoveryOwner,
        reconciliationHandler,
        now
      );

      if (!outcome.success) {
        results.push({ jobId: job.jobId, outcome: 'SKIPPED' });
      } else if (outcome.terminalDlq) {
        results.push({ jobId: job.jobId, outcome: 'TERMINAL_DEAD_LETTER' });
      } else if (outcome.crashLoopDetected) {
        results.push({ jobId: job.jobId, outcome: 'RECOVERED_AND_FAILED' });
      } else if (outcome.reconciliationOutcome === 'APPLIED') {
        results.push({ jobId: job.jobId, outcome: 'RECOVERED_AND_COMPLETED' });
      } else if (outcome.reconciliationOutcome === 'ABSENT') {
        results.push({ jobId: job.jobId, outcome: 'RECOVERED_AND_REDISPATCHED' });
      } else if (outcome.reconciliationOutcome === 'UNCERTAIN') {
        results.push({ jobId: job.jobId, outcome: 'RECOVERED_AND_FAILED' });
      } else {
        results.push({ jobId: job.jobId, outcome: 'SKIPPED' });
      }
    }

    return results;
  }
}
