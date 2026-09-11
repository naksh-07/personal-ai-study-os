import { SyncJob, ReconciliationOutcome, generateDeterministicCalendarEventId } from '@personal-os/domain';
import { ProviderAdapters } from '@personal-os/adapters';
import { Kysely } from 'kysely';
import { Database } from '@personal-os/db';

// ============================================================================
// Provider Reconciliation Boundary (Spec v1.2.3 Sec 9.3 B5 & Sec 10.5)
// ============================================================================

export interface ProviderReconciliationHandler {
  /**
   * Reconciles external provider state for a stale or recovering sync job.
   * Returns:
   * - 'APPLIED':   The external mutation was verified to exist on the remote provider.
   * - 'ABSENT':    The remote provider was exhaustively searched and the mutation does NOT exist. Safe to retry.
   * - 'UNCERTAIN': The provider could not be reached or returned 429/5xx/timeout. Blind mutation strictly prohibited.
   */
  reconcile(job: SyncJob): Promise<ReconciliationOutcome>;
}

export class ConfigurableReconciliationHandler implements ProviderReconciliationHandler {
  constructor(private outcome: ReconciliationOutcome = 'ABSENT') {}

  setOutcome(outcome: ReconciliationOutcome): void {
    this.outcome = outcome;
  }

  async reconcile(_job: SyncJob): Promise<ReconciliationOutcome> {
    return this.outcome;
  }
}

// ============================================================================
// Cross-Provider Stale Recovery Reconciliation (Spec v1.2.3 Sec 10.5)
// ============================================================================

/**
 * Reconciles provider state for a recovering stale job per Spec v1.2.3 Section 10.5:
 * - google_calendar: Uses deterministic base32hex ID to check event presence.
 * - google_tasks: Uses 4-tier expanding window search with metadata token.
 * - notion: Uses OS_Entity_ID query filter against database.
 * Returns 'APPLIED' | 'ABSENT' | 'UNCERTAIN'.
 */
export async function reconcileStaleJob(
  job: SyncJob,
  adapters: ProviderAdapters,
  _db?: Kysely<Database>
): Promise<ReconciliationOutcome> {
  try {
    let payload: Record<string, any> = {};
    if ((job as any).payload && typeof (job as any).payload === 'object') {
      payload = (job as any).payload;
    } else if (job.payloadJson) {
      try {
        payload = JSON.parse(job.payloadJson);
      } catch {
        payload = {};
      }
    }

    switch (job.targetSystem) {
      case 'google_calendar': {
        const calendarId = payload.calendarId ?? 'primary';
        const deterministicId = generateDeterministicCalendarEventId(job.idempotencyKey);
        const result = await adapters.calendar.getEvent(calendarId, deterministicId);
        if (result.status === 200) {
          return 'APPLIED';
        }
        if (result.status === 404) {
          return 'ABSENT';
        }
        return 'UNCERTAIN';
      }

      case 'google_tasks': {
        const tasklistId = payload.tasklistId ?? '@default';
        const result = await adapters.tasks.reconcileTaskSearch(
          tasklistId,
          job.entityId,
          job.idempotencyKey,
          job.createdAt,
          job.attemptCount
        );
        if (result.matchedTask) {
          return 'APPLIED';
        }
        if (result.exhaustivelyNotFound) {
          return 'ABSENT';
        }
        return 'UNCERTAIN';
      }

      case 'notion': {
        const databaseId = payload.databaseId ?? payload.database_id ?? '';
        const result = await adapters.notion.queryByEntityId(databaseId, job.entityId);
        if (result.foundPage) {
          return 'APPLIED';
        }
        if (result.exhaustivelyNotFound) {
          return 'ABSENT';
        }
        return 'UNCERTAIN';
      }

      default:
        return 'UNCERTAIN';
    }
  } catch (_err) {
    return 'UNCERTAIN';
  }
}

/**
 * Unified provider reconciliation handler wiring all external provider adapters
 * to the recovery runner in accordance with Spec v1.2.3 Section 10.5.
 */
export class UnifiedProviderReconciliationHandler implements ProviderReconciliationHandler {
  constructor(
    private readonly adapters: ProviderAdapters,
    private readonly db?: Kysely<Database>
  ) {}

  async reconcile(job: SyncJob): Promise<ReconciliationOutcome> {
    return reconcileStaleJob(job, this.adapters, this.db);
  }
}

