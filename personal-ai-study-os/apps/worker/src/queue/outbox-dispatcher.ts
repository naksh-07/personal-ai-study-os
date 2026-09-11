import { createKyselyD1 } from '@personal-os/db';
import {
  ReliabilityEngine,
  ConfigurableReconciliationHandler,
  ProviderReconciliationHandler,
} from '@personal-os/core';
import { QueueMessageEnvelope, SyncJob } from '@personal-os/domain';
import { Env } from '../types';

export interface OutboxSweepResult {
  dispatchedCount: number;
  recoveredCount: number;
  terminalDlqCount: number;
  staleResults?: any[];
}

export function wrapJobInQueueEnvelope(job: SyncJob): QueueMessageEnvelope {
  let parsedPayload: Record<string, unknown> = {};
  if (typeof job.payloadJson === 'string') {
    try {
      parsedPayload = JSON.parse(job.payloadJson);
    } catch {
      parsedPayload = { raw: job.payloadJson };
    }
  }

  return {
    jobId: job.jobId,
    idempotencyKey: job.idempotencyKey,
    targetSystem: job.targetSystem,
    entityType: job.entityType,
    entityId: job.entityId,
    operation: job.operation,
    schemaVersion: 1,
    payload: parsedPayload,
    enqueuedAt: new Date().toISOString(),
  };
}

export async function runOutboxDualSweep(
  env: Env,
  reconciliationHandler?: ProviderReconciliationHandler,
  now?: string
): Promise<OutboxSweepResult> {
  const db = createKyselyD1(env.DB);
  const handler = reconciliationHandler ?? new ConfigurableReconciliationHandler('ABSENT');

  // Sweep 1: Undispatched Outbox and Ready Retry Candidates
  const dispatchedCount = await ReliabilityEngine.sweepUndispatchedAndFailedJobs(
    db,
    async (job: SyncJob) => {
      const envelope = wrapJobInQueueEnvelope(job);
      if (env.SYNC_QUEUE && typeof (env.SYNC_QUEUE as any).send === 'function') {
        await (env.SYNC_QUEUE as any).send(envelope);
      }
    },
    now
  );

  // Sweep 2: Stale PROCESSING Recovery (120s lease expiry, Crash Scenario 7 loop elimination)
  const staleResults = await ReliabilityEngine.sweepStaleProcessingJobs(
    db,
    handler,
    'cron_recovery_',
    now
  );

  const recoveredCount = staleResults.filter((r) => r.outcome.startsWith('RECOVERED')).length;
  const terminalDlqJobs = staleResults.filter((r) => r.outcome === 'TERMINAL_DEAD_LETTER');

  // Route any terminal DLQ jobs to env.DLQ if available
  const dlq = (env as any).DLQ || (env as any).SYNC_DLQ;
  if (dlq && typeof dlq.send === 'function' && terminalDlqJobs.length > 0) {
    for (const item of terminalDlqJobs) {
      await dlq.send({
        jobId: item.jobId,
        reason: 'TERMINAL_DEAD_LETTER_VIA_RECOVERY_SWEEP',
        routedAt: new Date().toISOString(),
      });
    }
  }

  return {
    dispatchedCount,
    recoveredCount,
    terminalDlqCount: terminalDlqJobs.length,
    staleResults,
  };
}
