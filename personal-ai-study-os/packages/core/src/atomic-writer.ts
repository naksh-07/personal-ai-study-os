import { Kysely } from 'kysely';
import {
  Database,
  D1Database,
  executeD1Batch,
  CanonicalEventsRepository,
  EntitiesRepository,
  Compilable,
} from '@personal-os/db';
import {
  CanonicalEvent,
  SyncJob,
  IdempotencyRecord,
} from '@personal-os/domain';
import { CanonicalEventEngine, CreateCanonicalEventInput } from './event-engine';
import { ProjectionEngine } from './projection-engine';

export interface AtomicIngestParams {
  event: CanonicalEvent | CreateCanonicalEventInput;
  userTimezone?: string;
  syncJob?: SyncJob;
  idempotencyRecord?: IdempotencyRecord;
}

export interface AtomicIngestResult {
  event: CanonicalEvent;
  success: boolean;
  queriesCount: number;
}

export class AtomicWriter {
  /**
   * Executes the canonical event ingestion and projection updates atomically inside db.batch().
   * Sequence:
   * 1. Validate canonical event envelope & payload.
   * 2. Validate entity references (subject, chapter, causation event).
   * 3. Compute projection queries (study_progress, daily_states).
   * 4. Assemble atomic batch: [canonical_event, ...projections, sync_job?, idempotency_record?].
   * 5. Execute batch atomically via Cloudflare D1 db.batch().
   */
  static async ingestAndProjectAtomic(
    d1: D1Database,
    db: Kysely<Database>,
    params: AtomicIngestParams
  ): Promise<AtomicIngestResult> {
    // 1. Prepare and validate canonical event
    const event: CanonicalEvent =
      'eventId' in params.event
        ? CanonicalEventEngine.validate(params.event)
        : CanonicalEventEngine.createEvent(params.event);

    // 2. Validate entity references
    await CanonicalEventEngine.validateEntityReferences(db, event);

    // 3. Resolve user timezone if not specified
    let timezone = params.userTimezone;
    if (!timezone) {
      const user = await db.selectFrom('users').select('timezone').executeTakeFirst();
      timezone = user?.timezone ?? 'UTC';
    }

    // 4. Compute projection updates
    const projectionQueries = await ProjectionEngine.computeProjectionQueries(
      db,
      event,
      timezone
    );

    // 5. Build atomic D1 batch
    const batch: Compilable[] = [
      CanonicalEventsRepository.createInsertQuery(db, event),
      ...projectionQueries,
    ];

    if (params.syncJob) {
      batch.push(EntitiesRepository.createInsertSyncJobQuery(db, params.syncJob));
    }

    if (params.idempotencyRecord) {
      batch.push(EntitiesRepository.createInsertIdempotencyRecordQuery(db, params.idempotencyRecord));
    }

    // 6. Execute coordinated atomic batch
    await executeD1Batch(d1, batch);

    return {
      event,
      success: true,
      queriesCount: batch.length,
    };
  }
}
