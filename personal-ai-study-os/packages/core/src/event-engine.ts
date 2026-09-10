import { Kysely } from 'kysely';
import { Database, CanonicalEventsRepository } from '@personal-os/db';
import {
  CanonicalEvent,
  CanonicalEventSchema,
  EventPayloadError,
  DomainError,
  generateId,
} from '@personal-os/domain';

export interface CreateCanonicalEventInput<T = unknown> {
  eventType: string;
  schemaVersion?: number;
  occurredAt?: string;
  actor: {
    type: 'user' | 'agent' | 'system';
    id: string;
  };
  source: {
    system: 'chatgpt' | 'spark' | 'antigravity' | 'notion' | 'google_tasks' | 'google_calendar' | 'system';
    interface: 'natural_language' | 'mcp' | 'rest' | 'webhook';
  };
  payload: T;
  correlationId?: string;
  causationId?: string;
}

export class CanonicalEventEngine {
  /**
   * Validates a raw or constructed event envelope and payload using Zod.
   */
  static validate(event: unknown): CanonicalEvent {
    const result = CanonicalEventSchema.safeParse(event);
    if (!result.success) {
      const issueMessages = (result.error.issues || []).map(
        e => `${e.path.map(p => String(p)).join('.')}: ${e.message}`
      );
      throw new EventPayloadError(
        `Canonical event validation failed: ${issueMessages.join(', ')}`,
        result.error.format()
      );
    }
    return result.data;
  }

  /**
   * Creates and validates a new canonical event with standard system fields.
   */
  static createEvent(input: CreateCanonicalEventInput): CanonicalEvent {
    const now = new Date().toISOString();
    const rawEvent = {
      eventId: generateId('evt'),
      eventType: input.eventType,
      schemaVersion: input.schemaVersion ?? 1,
      occurredAt: input.occurredAt ?? now,
      recordedAt: now,
      actor: input.actor,
      source: input.source,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
      causationId: input.causationId ?? null,
    };

    return this.validate(rawEvent);
  }

  /**
   * Validates that entities referenced by the event exist in the database.
   */
  static async validateEntityReferences(db: Kysely<Database>, event: CanonicalEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;

    // If chapterId is present in payload, verify chapter exists
    if (payload && typeof payload.chapterId === 'string') {
      const chapter = await db
        .selectFrom('chapters')
        .select('id')
        .where('id', '=', payload.chapterId)
        .executeTakeFirst();

      if (!chapter) {
        throw new DomainError(
          'CHAPTER_NOT_FOUND',
          `Referenced chapter '${payload.chapterId}' does not exist in canonical syllabus.`
        );
      }
    }

    // If subjectId is present in payload, verify subject exists
    if (payload && typeof payload.subjectId === 'string') {
      const subject = await db
        .selectFrom('subjects')
        .select('id')
        .where('id', '=', payload.subjectId)
        .executeTakeFirst();

      if (!subject) {
        throw new DomainError(
          'SUBJECT_NOT_FOUND',
          `Referenced subject '${payload.subjectId}' does not exist in canonical domain.`
        );
      }
    }

    // If causationId is present, verify referenced prior event exists (Correction lineage)
    if (event.causationId) {
      const priorEvent = await CanonicalEventsRepository.getById(db, event.causationId);
      if (!priorEvent) {
        throw new DomainError(
          'CORRECTION_TARGET_NOT_FOUND',
          `Causation event '${event.causationId}' does not exist in canonical event ledger.`
        );
      }
    }
  }
}
