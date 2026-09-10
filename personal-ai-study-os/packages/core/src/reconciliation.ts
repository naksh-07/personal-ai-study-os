import { SyncJob, ReconciliationOutcome } from '@personal-os/domain';

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
