import { Kysely, sql } from 'kysely';
import { Database, SyncJobsTable } from '../tables';
import {
  SyncJob,
  IdempotencyRecord,
  ProcessingLease,
  PROCESSING_LEASE_SECONDS,
  MAX_EXECUTION_ATTEMPTS,
  IDEMPOTENCY_TTL_SECONDS,
  DomainError,
} from '@personal-os/domain';
import { EntitiesRepository } from './entities.repository';

// ============================================================================
// Types & Result Interfaces
// ============================================================================

export interface ClaimLeaseParams {
  jobId: string;
  leaseOwner: string;
  now?: string; // ISO 8601 UTC
  leaseDurationSeconds?: number;
}

export interface ClaimLeaseResult {
  success: boolean;
  lease?: ProcessingLease;
  error?: string;
}

export interface RecoverLeaseParams {
  jobId: string;
  newLeaseOwner: string;
  now?: string; // ISO 8601 UTC
  leaseDurationSeconds?: number;
}

export interface RecoverLeaseResult {
  success: boolean;
  recovered: boolean;
  crashLoopDetected?: boolean;
  terminalDlq?: boolean;
  lease?: ProcessingLease;
  error?: string;
}

export interface ClaimIdempotencyParams {
  idempotencyKey: string;
  jobId?: string;
  operation: string;
  sourceSystem: string;
  requestHash: string;
  now?: string;
  ttlSeconds?: number;
}

export type ClaimIdempotencyResult =
  | { state: 'CLAIMED'; record: IdempotencyRecord }
  | { state: 'COMPLETED'; cachedPayload?: string; record: IdempotencyRecord }
  | { state: 'IN_PROGRESS'; record: IdempotencyRecord }
  | { state: 'FAILED'; record: IdempotencyRecord };

export interface FinalizeIdempotencyParams {
  idempotencyKey: string;
  status: 'COMPLETED' | 'FAILED';
  resultPayload?: string;
  resultHash?: string;
  now?: string;
}

function mapSyncJobRow(row: SyncJobsTable): SyncJob {
  return {
    jobId: row.job_id,
    idempotencyKey: row.idempotency_key,
    targetSystem: row.target_system,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payloadJson: row.payload_json,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    dispatchedAt: row.dispatched_at ?? undefined,
    processingStartedAt: row.processing_started_at ?? undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

// ============================================================================
// Reliability Repository Implementation
// ============================================================================

export class ReliabilityRepository {
  /**
   * Inserts a new sync job into sync_jobs.
   */
  static async createSyncJob(db: Kysely<Database>, job: SyncJob): Promise<void> {
    await EntitiesRepository.createInsertSyncJobQuery(db, job).execute();
  }

  /**
   * Retrieves a sync job by its job_id.
   */
  static async getSyncJob(db: Kysely<Database>, jobId: string): Promise<SyncJob | null> {
    return EntitiesRepository.getSyncJob(db, jobId);
  }

  /**
   * Atomically claims an execution lease via CAS:
   * Condition: status IN ('PENDING', 'DISPATCHED') AND attempt_count < 5
   * Updates: status = 'PROCESSING', lease_owner, processing_started_at, lease_expires_at, attempt_count + 1
   * Single-Increment Invariant: attempt_count increments exclusively upon successful claim.
   */
  static async claimProcessingLease(
    db: Kysely<Database>,
    params: ClaimLeaseParams
  ): Promise<ClaimLeaseResult> {
    const currentTime = params.now ?? new Date().toISOString();
    const leaseDuration = params.leaseDurationSeconds ?? PROCESSING_LEASE_SECONDS;
    const expiresAt = new Date(new Date(currentTime).getTime() + leaseDuration * 1000).toISOString();

    const job = await EntitiesRepository.getSyncJob(db, params.jobId);
    if (!job) {
      return { success: false, error: 'JOB_NOT_FOUND' };
    }

    if (job.attemptCount >= MAX_EXECUTION_ATTEMPTS) {
      return { success: false, error: 'MAX_ATTEMPTS_EXCEEDED' };
    }

    if (job.status !== 'PENDING' && job.status !== 'DISPATCHED') {
      return { success: false, error: 'INVALID_STATUS_FOR_CLAIM' };
    }

    const updateResult = await db
      .updateTable('sync_jobs')
      .set({
        status: 'PROCESSING',
        lease_owner: params.leaseOwner,
        processing_started_at: currentTime,
        lease_expires_at: expiresAt,
        attempt_count: sql`attempt_count + 1`,
        last_error: null,
        updated_at: currentTime,
      })
      .where('job_id', '=', params.jobId)
      .where('status', 'in', ['PENDING', 'DISPATCHED'])
      .where('attempt_count', '<', MAX_EXECUTION_ATTEMPTS)
      .executeTakeFirst();

    const numUpdated = Number(updateResult.numUpdatedRows ?? 0);
    if (numUpdated === 1) {
      return {
        success: true,
        lease: {
          jobId: params.jobId,
          leaseOwner: params.leaseOwner,
          acquiredAt: currentTime,
          expiresAt,
          attemptCount: job.attemptCount + 1,
        },
      };
    }

    return { success: false, error: 'LEASE_ACQUISITION_CONFLICT' };
  }

  /**
   * Atomically recovers a stale PROCESSING lease via CAS:
   * Stale Predicate: status = 'PROCESSING' AND (lease_expires_at <= now OR processing_started_at <= now - 120s)
   * Critical Invariant: attempt_count MUST NOT increment (+0).
   * Crash Scenario 7: If last_error = 'RECOVERY_IN_PROGRESS', a prior recovery worker crashed!
   * Breaks the loop by marking DEAD_LETTER (if attemptCount >= 5) or FAILED with retry (if attemptCount < 5).
   */
  static async recoverStaleLease(
    db: Kysely<Database>,
    params: RecoverLeaseParams
  ): Promise<RecoverLeaseResult> {
    const currentTime = params.now ?? new Date().toISOString();
    const leaseDuration = params.leaseDurationSeconds ?? PROCESSING_LEASE_SECONDS;
    const expiresAt = new Date(new Date(currentTime).getTime() + leaseDuration * 1000).toISOString();
    const staleThreshold = new Date(new Date(currentTime).getTime() - leaseDuration * 1000).toISOString();

    const job = await EntitiesRepository.getSyncJob(db, params.jobId);
    if (!job) {
      return { success: false, recovered: false, error: 'JOB_NOT_FOUND' };
    }

    if (job.status !== 'PROCESSING') {
      return { success: false, recovered: false, error: 'JOB_NOT_PROCESSING' };
    }

    const isStale =
      (job.leaseExpiresAt && job.leaseExpiresAt <= currentTime) ||
      (job.processingStartedAt && job.processingStartedAt <= staleThreshold);

    if (!isStale) {
      return { success: false, recovered: false, error: 'JOB_NOT_STALE' };
    }

    // Crash Scenario 7: Prior recovery worker crashed while recovering this attempt
    if (job.lastError === 'RECOVERY_IN_PROGRESS') {
      if (job.attemptCount >= MAX_EXECUTION_ATTEMPTS) {
        await db
          .updateTable('sync_jobs')
          .set({
            status: 'DEAD_LETTER',
            last_error: 'RECOVERY_CRASH_LOOP_MAX_ATTEMPTS',
            completed_at: currentTime,
            updated_at: currentTime,
          })
          .where('job_id', '=', params.jobId)
          .where('status', '=', 'PROCESSING')
          .executeTakeFirst();
        return { success: true, recovered: false, crashLoopDetected: true, terminalDlq: true };
      } else {
        const nextAttempt = new Date(new Date(currentTime).getTime() + 30 * 1000).toISOString();
        await db
          .updateTable('sync_jobs')
          .set({
            status: 'FAILED',
            last_error: 'RECOVERY_WORKER_CRASHED',
            next_attempt_at: nextAttempt,
            updated_at: currentTime,
          })
          .where('job_id', '=', params.jobId)
          .where('status', '=', 'PROCESSING')
          .executeTakeFirst();
        return { success: true, recovered: false, crashLoopDetected: true, terminalDlq: false };
      }
    }

    // Atomic CAS Claim: only one recovery runner wins
    const updateResult = await db
      .updateTable('sync_jobs')
      .set({
        lease_owner: params.newLeaseOwner,
        processing_started_at: currentTime,
        lease_expires_at: expiresAt,
        last_error: 'RECOVERY_IN_PROGRESS',
        updated_at: currentTime,
      })
      .where('job_id', '=', params.jobId)
      .where('status', '=', 'PROCESSING')
      .where((eb) =>
        eb.or([
          eb('lease_expires_at', '<=', currentTime),
          eb('processing_started_at', '<=', staleThreshold),
        ])
      )
      .executeTakeFirst();

    const numUpdated = Number(updateResult.numUpdatedRows ?? 0);
    if (numUpdated === 1) {
      return {
        success: true,
        recovered: true,
        lease: {
          jobId: params.jobId,
          leaseOwner: params.newLeaseOwner,
          acquiredAt: currentTime,
          expiresAt,
          attemptCount: job.attemptCount, // attempt_count preserved (+0)
        },
      };
    }

    return { success: false, recovered: false, error: 'RECOVERY_CONFLICT' };
  }

  /**
   * Finalizes successful execution:
   * CAS Ownership verified: job_id = ? AND status = 'PROCESSING' AND lease_owner = ?
   */
  static async markSucceeded(
    db: Kysely<Database>,
    params: { jobId: string; leaseOwner: string; completedAt?: string }
  ): Promise<boolean> {
    const currentTime = params.completedAt ?? new Date().toISOString();
    const res = await db
      .updateTable('sync_jobs')
      .set({
        status: 'COMPLETED',
        completed_at: currentTime,
        updated_at: currentTime,
      })
      .where('job_id', '=', params.jobId)
      .where('status', '=', 'PROCESSING')
      .where('lease_owner', '=', params.leaseOwner)
      .executeTakeFirst();

    return Number(res.numUpdatedRows ?? 0) === 1;
  }

  /**
   * Marks retryable failure:
   * CAS Ownership verified: job_id = ? AND status = 'PROCESSING' AND lease_owner = ?
   * Invariant: attempt_count is NOT incremented (+0).
   */
  static async markRetryableFailure(
    db: Kysely<Database>,
    params: { jobId: string; leaseOwner: string; error: string; nextAttemptAt: string; now?: string }
  ): Promise<boolean> {
    const currentTime = params.now ?? new Date().toISOString();
    const res = await db
      .updateTable('sync_jobs')
      .set({
        status: 'FAILED',
        last_error: params.error,
        next_attempt_at: params.nextAttemptAt,
        updated_at: currentTime,
      })
      .where('job_id', '=', params.jobId)
      .where('status', '=', 'PROCESSING')
      .where('lease_owner', '=', params.leaseOwner)
      .executeTakeFirst();

    return Number(res.numUpdatedRows ?? 0) === 1;
  }

  /**
   * Marks terminal failure (DEAD_LETTER):
   * CAS Ownership verified: job_id = ? AND status = 'PROCESSING' (and lease_owner if provided)
   */
  static async markTerminalFailure(
    db: Kysely<Database>,
    params: { jobId: string; leaseOwner?: string; error: string; completedAt?: string }
  ): Promise<boolean> {
    const currentTime = params.completedAt ?? new Date().toISOString();
    let query = db
      .updateTable('sync_jobs')
      .set({
        status: 'DEAD_LETTER',
        last_error: params.error,
        completed_at: currentTime,
        updated_at: currentTime,
      })
      .where('job_id', '=', params.jobId)
      .where('status', '=', 'PROCESSING');

    if (params.leaseOwner) {
      query = query.where('lease_owner', '=', params.leaseOwner);
    }

    const res = await query.executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0) === 1;
  }

  /**
   * Resets recovered job whose external mutation was confirmed absent back to DISPATCHED
   * so that the next execution claim initiates attempt N+1.
   */
  static async markRedispatched(
    db: Kysely<Database>,
    params: { jobId: string; leaseOwner: string; now?: string }
  ): Promise<boolean> {
    const currentTime = params.now ?? new Date().toISOString();
    const res = await db
      .updateTable('sync_jobs')
      .set({
        status: 'DISPATCHED',
        dispatched_at: currentTime,
        updated_at: currentTime,
      })
      .where('job_id', '=', params.jobId)
      .where('status', '=', 'PROCESSING')
      .where('lease_owner', '=', params.leaseOwner)
      .executeTakeFirst();

    return Number(res.numUpdatedRows ?? 0) === 1;
  }

  /**
   * Sweep Query 1: Find undispatched outbox jobs and retry candidates whose backoff elapsed.
   */
  static async findProcessableJobs(
    db: Kysely<Database>,
    params?: { now?: string; limit?: number }
  ): Promise<SyncJob[]> {
    const currentTime = params?.now ?? new Date().toISOString();
    const stalePendingThreshold = new Date(new Date(currentTime).getTime() - 30 * 1000).toISOString();
    const limit = params?.limit ?? 50;

    const rows = await db
      .selectFrom('sync_jobs')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb.and([
            eb('status', '=', 'PENDING'),
            eb('dispatched_at', 'is', null),
            eb('created_at', '<=', stalePendingThreshold),
          ]),
          eb.and([
            eb('status', '=', 'FAILED'),
            eb('next_attempt_at', 'is not', null),
            eb('next_attempt_at', '<=', currentTime),
          ]),
        ])
      )
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map(mapSyncJobRow);
  }

  /**
   * Sweep Query 2: Find stale PROCESSING jobs whose 120-second lease has elapsed.
   */
  static async findStaleProcessingJobs(
    db: Kysely<Database>,
    params?: { now?: string; limit?: number; leaseDurationSeconds?: number }
  ): Promise<SyncJob[]> {
    const currentTime = params?.now ?? new Date().toISOString();
    const leaseDuration = params?.leaseDurationSeconds ?? PROCESSING_LEASE_SECONDS;
    const staleThreshold = new Date(new Date(currentTime).getTime() - leaseDuration * 1000).toISOString();
    const limit = params?.limit ?? 50;

    const rows = await db
      .selectFrom('sync_jobs')
      .selectAll()
      .where('status', '=', 'PROCESSING')
      .where((eb) =>
        eb.or([
          eb('lease_expires_at', '<=', currentTime),
          eb('processing_started_at', '<=', staleThreshold),
        ])
      )
      .orderBy('processing_started_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map(mapSyncJobRow);
  }

  /**
   * Atomically checks or claims an idempotency record:
   * - If existing COMPLETED: returns cached response for replay
   * - If existing request_hash mismatch: throws IDEMPOTENCY_CONFLICT
   * - If existing PENDING: returns IN_PROGRESS
   * - If not found: inserts PENDING record with 24h TTL and returns CLAIMED
   */
  static async claimIdempotency(
    db: Kysely<Database>,
    params: ClaimIdempotencyParams
  ): Promise<ClaimIdempotencyResult> {
    const currentTime = params.now ?? new Date().toISOString();
    const ttl = params.ttlSeconds ?? IDEMPOTENCY_TTL_SECONDS;
    const expiresAt = new Date(new Date(currentTime).getTime() + ttl * 1000).toISOString();

    const existing = await EntitiesRepository.getIdempotencyRecord(db, params.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== params.requestHash) {
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          `IDEMPOTENCY_CONFLICT: Idempotency key '${params.idempotencyKey}' was already used with a different request payload.`
        );
      }

      if (existing.status === 'COMPLETED') {
        return {
          state: 'COMPLETED',
          cachedPayload: existing.resultPayload ?? undefined,
          record: existing,
        };
      }

      if (existing.status === 'PENDING') {
        return {
          state: 'IN_PROGRESS',
          record: existing,
        };
      }

      return {
        state: 'FAILED',
        record: existing,
      };
    }

    const newRecord: IdempotencyRecord = {
      idempotencyKey: params.idempotencyKey,
      jobId: params.jobId,
      operation: params.operation,
      sourceSystem: params.sourceSystem,
      requestHash: params.requestHash,
      status: 'PENDING',
      createdAt: currentTime,
      updatedAt: currentTime,
      expiresAt,
    };

    try {
      await EntitiesRepository.createInsertIdempotencyRecordQuery(db, newRecord).execute();
      return { state: 'CLAIMED', record: newRecord };
    } catch (err) {
      // Race condition: another worker inserted concurrently
      const concurrent = await EntitiesRepository.getIdempotencyRecord(db, params.idempotencyKey);
      if (concurrent) {
        if (concurrent.requestHash !== params.requestHash) {
          throw new DomainError(
            'IDEMPOTENCY_CONFLICT',
            `IDEMPOTENCY_CONFLICT: Idempotency key '${params.idempotencyKey}' was already used with a different request payload.`
          );
        }
        if (concurrent.status === 'COMPLETED') {
          return { state: 'COMPLETED', cachedPayload: concurrent.resultPayload ?? undefined, record: concurrent };
        }
        return { state: 'IN_PROGRESS', record: concurrent };
      }
      throw err;
    }
  }

  /**
   * Finalizes idempotency record status and payload.
   */
  static async finalizeIdempotency(
    db: Kysely<Database>,
    params: FinalizeIdempotencyParams
  ): Promise<void> {
    const currentTime = params.now ?? new Date().toISOString();
    await db
      .updateTable('idempotency_records')
      .set({
        status: params.status,
        result_payload: params.resultPayload ?? null,
        result_hash: params.resultHash ?? null,
        updated_at: currentTime,
      })
      .where('idempotency_key', '=', params.idempotencyKey)
      .execute();
  }
}
