import { Kysely } from 'kysely';
import { Database } from '../tables';
import { CanonicalEvent } from '@personal-os/domain';

export class CanonicalEventsRepository {
  /**
   * Generates a Kysely insert query for a canonical event.
   * Can be executed directly or included in a `db.batch()` call.
   */
  static createInsertQuery(db: Kysely<Database>, event: CanonicalEvent) {
    return db.insertInto('canonical_events').values({
      event_id: event.eventId,
      event_type: event.eventType,
      schema_version: event.schemaVersion,
      occurred_at: event.occurredAt,
      recorded_at: event.recordedAt,
      actor_type: event.actor.type,
      actor_id: event.actor.id,
      source_system: event.source.system,
      source_interface: event.source.interface,
      payload: JSON.stringify(event.payload),
      correlation_id: event.correlationId ?? null,
      causation_id: event.causationId ?? null,
    });
  }

  /**
   * Fetches an event by its ID.
   */
  static async getById(db: Kysely<Database>, eventId: string): Promise<CanonicalEvent | null> {
    const row = await db
      .selectFrom('canonical_events')
      .selectAll()
      .where('event_id', '=', eventId)
      .executeTakeFirst();

    if (!row) return null;

    return {
      eventId: row.event_id,
      eventType: row.event_type as any,
      schemaVersion: row.schema_version,
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at,
      actor: {
        type: row.actor_type,
        id: row.actor_id,
      },
      source: {
        system: row.source_system as any,
        interface: row.source_interface as any,
      },
      payload: JSON.parse(row.payload),
      correlationId: row.correlation_id ?? undefined,
      causationId: row.causation_id ?? undefined,
    };
  }

  /**
   * Streams/fetches all canonical events in strictly chronological order (`occurred_at ASC`).
   * Used for deterministic projection rebuilding.
   */
  static async getAllChronological(db: Kysely<Database>): Promise<CanonicalEvent[]> {
    const rows = await db
      .selectFrom('canonical_events')
      .selectAll()
      .orderBy('occurred_at', 'asc')
      .execute();

    return rows.map(row => ({
      eventId: row.event_id,
      eventType: row.event_type as any,
      schemaVersion: row.schema_version,
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at,
      actor: {
        type: row.actor_type,
        id: row.actor_id,
      },
      source: {
        system: row.source_system as any,
        interface: row.source_interface as any,
      },
      payload: JSON.parse(row.payload),
      correlationId: row.correlation_id ?? undefined,
      causationId: row.causation_id ?? undefined,
    }));
  }

  /**
   * Counts total recorded canonical events.
   */
  static async count(db: Kysely<Database>): Promise<number> {
    const result = await db
      .selectFrom('canonical_events')
      .select(db.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }
}
