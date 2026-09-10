import { SyncJobStatus } from './entities';
import { StateTransitionError } from './errors';

// ============================================================================
// Authoritative Reliability Constants (Spec v1.2.3)
// ============================================================================

export const PROCESSING_LEASE_SECONDS = 120;
export const MAX_EXECUTION_ATTEMPTS = 5;
export const OUTBOX_STALE_PENDING_SECONDS = 30;
export const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

// ============================================================================
// Reliability Domain Interfaces
// ============================================================================

export interface ProcessingLease {
  jobId: string;
  leaseOwner: string;
  acquiredAt: string; // ISO 8601 UTC
  expiresAt: string;  // ISO 8601 UTC
  attemptCount: number;
}

export type FailureCategory = 'TRANSIENT' | 'PERMANENT' | 'AMBIGUOUS';

export type ReconciliationOutcome = 'APPLIED' | 'ABSENT' | 'UNCERTAIN';

export interface ReliabilityFailure {
  category: FailureCategory;
  isRetryable: boolean;
  message: string;
  code?: string;
}

// ============================================================================
// State Machine Transitions
// ============================================================================

/**
 * Valid state transitions per v1.2.3 Section 9.4:
 * - PENDING    -> DISPATCHED, PROCESSING
 * - DISPATCHED -> PROCESSING
 * - PROCESSING -> COMPLETED, FAILED, DEAD_LETTER, DISPATCHED (via recovery)
 * - FAILED     -> DISPATCHED (via outbox sweep redispatch)
 * - COMPLETED  -> (terminal, no valid transitions)
 * - DEAD_LETTER-> (terminal, no valid transitions)
 */
const VALID_TRANSITIONS: Record<SyncJobStatus, readonly SyncJobStatus[]> = {
  PENDING: ['DISPATCHED', 'PROCESSING'],
  DISPATCHED: ['PROCESSING'],
  PROCESSING: ['COMPLETED', 'FAILED', 'DEAD_LETTER', 'DISPATCHED'],
  FAILED: ['DISPATCHED'],
  COMPLETED: [],
  DEAD_LETTER: [],
};

export function isValidSyncJobTransition(from: SyncJobStatus, to: SyncJobStatus): boolean {
  if (from === to) return true; // Idempotent no-op
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidSyncJobTransition(from: SyncJobStatus, to: SyncJobStatus): void {
  if (!isValidSyncJobTransition(from, to)) {
    throw new StateTransitionError(
      `Invalid sync job state transition from '${from}' to '${to}'. Terminal or illegal state transition prohibited.`
    );
  }
}

// ============================================================================
// Deterministic Exponential Backoff Formula (Spec v1.2.3 Sec 9.3 B7)
// ============================================================================

/**
 * Calculates delay in seconds before next execution attempt:
 * delaySeconds = 5 * (2 ^ (attemptCount - 1))
 * - Attempt 1 -> 5s
 * - Attempt 2 -> 10s
 * - Attempt 3 -> 20s
 * - Attempt 4 -> 40s
 * - Attempt >= 5 -> 0s (no retry, strictly terminal)
 */
export function computeExponentialBackoffDelaySeconds(attemptCount: number): number {
  if (attemptCount < 1) return 5;
  if (attemptCount >= MAX_EXECUTION_ATTEMPTS) return 0;
  return 5 * Math.pow(2, attemptCount - 1);
}

// ============================================================================
// Failure Classifier (Spec v1.2.3 Sec 9.3 B5 & Contracts v1.1 Sec 32)
// ============================================================================

export function classifyReliabilityFailure(error: unknown): ReliabilityFailure {
  if (!error) {
    return {
      category: 'PERMANENT',
      isRetryable: false,
      message: 'Unknown empty failure',
    };
  }

  const err = error as Record<string, unknown>;
  const message = typeof err.message === 'string' ? err.message : String(error);
  const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : undefined;
  const code = typeof err.code === 'string' ? err.code : undefined;

  // 1. Explicit Ambiguous Flags
  if (
    code === 'AMBIGUOUS_PROVIDER_STATE' ||
    message.includes('RECONCILIATION_UNCERTAIN') ||
    message.includes('IN_FLIGHT_TIMEOUT') ||
    message.includes('Ambiguous')
  ) {
    return {
      category: 'AMBIGUOUS',
      isRetryable: true,
      message,
      code: code ?? 'AMBIGUOUS_PROVIDER_STATE',
    };
  }

  // 2. HTTP Status Code Classification
  if (status !== undefined) {
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
      return {
        category: 'TRANSIENT',
        isRetryable: true,
        message,
        code: `HTTP_${status}`,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        category: 'PERMANENT',
        isRetryable: false,
        message,
        code: `HTTP_${status}`,
      };
    }
  }

  // 3. Network / Timeout Error Patterns
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('aborterror') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('rate limit')
  ) {
    return {
      category: 'TRANSIENT',
      isRetryable: true,
      message,
      code: code ?? 'NETWORK_TRANSIENT_ERROR',
    };
  }

  // 4. Domain / Validation Errors -> Permanent
  if (
    code === 'INVALID_EVENT_PAYLOAD' ||
    code === 'INVALID_EVENT_ENVELOPE' ||
    code === 'INVALID_ENTITY' ||
    code === 'MATHEMATICAL_CONSTRAINT_VIOLATION' ||
    code === 'IMMUTABLE_EVENT_MODIFICATION_PROHIBITED' ||
    code === 'IDEMPOTENCY_CONFLICT' ||
    code === 'SINGLE_TENANT_VIOLATION' ||
    code === 'INVALID_STATE_TRANSITION' ||
    code === 'ATTEMPT_CEILING_EXCEEDED'
  ) {
    return {
      category: 'PERMANENT',
      isRetryable: false,
      message,
      code,
    };
  }

  // Default fallback: permanent failure to avoid infinite loops on unexpected programming errors
  return {
    category: 'PERMANENT',
    isRetryable: false,
    message,
    code: code ?? 'UNCLASSIFIED_ERROR',
  };
}
