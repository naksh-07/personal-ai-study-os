export type ErrorCode =
  | 'INVALID_EVENT_PAYLOAD'
  | 'INVALID_EVENT_ENVELOPE'
  | 'INVALID_ENTITY'
  | 'CHAPTER_NOT_FOUND'
  | 'SUBJECT_NOT_FOUND'
  | 'MATHEMATICAL_CONSTRAINT_VIOLATION'
  | 'IMMUTABLE_EVENT_MODIFICATION_PROHIBITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SINGLE_TENANT_VIOLATION'
  | 'INVALID_OPAQUE_ID'
  | 'CORRECTION_TARGET_NOT_FOUND'
  | 'PROJECTION_REBUILD_FAILED'
  | 'BATCH_EXECUTION_FAILED'
  | 'INVALID_STATE_TRANSITION'
  | 'LEASE_ACQUISITION_FAILED'
  | 'STALE_LEASE_RECOVERY_FAILED'
  | 'CAS_OWNERSHIP_MISMATCH'
  | 'ATTEMPT_CEILING_EXCEEDED'
  | 'RECONCILIATION_FAILED'
  | 'RELIABILITY_FAILURE';

export class DomainError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('INVALID_ENTITY', message, details);
    this.name = 'ValidationError';
  }
}

export class EventPayloadError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('INVALID_EVENT_PAYLOAD', message, details);
    this.name = 'EventPayloadError';
  }
}

export class MathematicalConstraintError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('MATHEMATICAL_CONSTRAINT_VIOLATION', message, details);
    this.name = 'MathematicalConstraintError';
  }
}

export class StateTransitionError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('INVALID_STATE_TRANSITION', message, details);
    this.name = 'StateTransitionError';
    Object.setPrototypeOf(this, StateTransitionError.prototype);
  }
}

export class LeaseOwnershipError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('CAS_OWNERSHIP_MISMATCH', message, details);
    this.name = 'LeaseOwnershipError';
    Object.setPrototypeOf(this, LeaseOwnershipError.prototype);
  }
}

export class AttemptCeilingError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('ATTEMPT_CEILING_EXCEEDED', message, details);
    this.name = 'AttemptCeilingError';
    Object.setPrototypeOf(this, AttemptCeilingError.prototype);
  }
}
