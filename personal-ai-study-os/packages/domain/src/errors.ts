export type ErrorCode =
  | 'INVALID_EVENT_PAYLOAD'
  | 'INVALID_EVENT_ENVELOPE'
  | 'INVALID_ENTITY'
  | 'VALIDATION_FAILED'
  | 'CHAPTER_NOT_FOUND'
  | 'SUBJECT_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'ENTITY_NOT_FOUND'
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
  | 'RELIABILITY_FAILURE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR';

export type ErrorCategory =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'idempotency_conflict'
  | 'state_transition'
  | 'authorization'
  | 'internal';

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
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class EventPayloadError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('INVALID_EVENT_PAYLOAD', message, details);
    this.name = 'EventPayloadError';
    Object.setPrototypeOf(this, EventPayloadError.prototype);
  }
}

export class MathematicalConstraintError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('MATHEMATICAL_CONSTRAINT_VIOLATION', message, details);
    this.name = 'MathematicalConstraintError';
    Object.setPrototypeOf(this, MathematicalConstraintError.prototype);
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

export class NotFoundError extends DomainError {
  constructor(code: ErrorCode = 'ENTITY_NOT_FOUND', message: string, details?: unknown) {
    super(code, message, details);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends DomainError {
  constructor(code: ErrorCode = 'IDEMPOTENCY_CONFLICT', message: string, details?: unknown) {
    super(code, message, details);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string = 'Unauthorized: Missing or invalid authentication token', details?: unknown) {
    super('UNAUTHORIZED', message, details);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string = 'Forbidden: Insufficient permissions for requested operation', details?: unknown) {
    super('FORBIDDEN', message, details);
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export interface ClassifiedError {
  category: ErrorCategory;
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof DomainError) {
    switch (err.code) {
      case 'INVALID_EVENT_PAYLOAD':
      case 'INVALID_EVENT_ENVELOPE':
      case 'INVALID_ENTITY':
      case 'VALIDATION_FAILED':
      case 'MATHEMATICAL_CONSTRAINT_VIOLATION':
      case 'INVALID_OPAQUE_ID':
        return {
          category: 'validation',
          status: 400,
          code: err.code,
          message: err.message,
          details: err.details,
        };

      case 'CHAPTER_NOT_FOUND':
      case 'SUBJECT_NOT_FOUND':
      case 'PROJECT_NOT_FOUND':
      case 'TASK_NOT_FOUND':
      case 'ENTITY_NOT_FOUND':
      case 'CORRECTION_TARGET_NOT_FOUND':
        return {
          category: 'not_found',
          status: 404,
          code: err.code,
          message: err.message,
          details: err.details,
        };

      case 'IDEMPOTENCY_CONFLICT':
        return {
          category: 'idempotency_conflict',
          status: 409,
          code: err.code,
          message: err.message,
          details: err.details,
        };

      case 'INVALID_STATE_TRANSITION':
      case 'LEASE_ACQUISITION_FAILED':
      case 'STALE_LEASE_RECOVERY_FAILED':
      case 'CAS_OWNERSHIP_MISMATCH':
      case 'ATTEMPT_CEILING_EXCEEDED':
      case 'SINGLE_TENANT_VIOLATION':
        return {
          category: 'state_transition',
          status: 409,
          code: err.code,
          message: err.message,
          details: err.details,
        };

      case 'UNAUTHORIZED':
        return {
          category: 'authorization',
          status: 401,
          code: err.code,
          message: err.message,
          details: err.details,
        };

      case 'FORBIDDEN':
        return {
          category: 'authorization',
          status: 403,
          code: err.code,
          message: err.message,
          details: err.details,
        };

      case 'IMMUTABLE_EVENT_MODIFICATION_PROHIBITED':
        return {
          category: 'conflict',
          status: 409,
          code: err.code,
          message: err.message,
          details: err.details,
        };

      default:
        return {
          category: 'internal',
          status: 500,
          code: err.code,
          message: err.message,
          details: err.details,
        };
    }
  }

  // Generic or unknown errors: never leak stack traces or internal secrets
  return {
    category: 'internal',
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An internal error occurred.',
    details: null,
  };
}

