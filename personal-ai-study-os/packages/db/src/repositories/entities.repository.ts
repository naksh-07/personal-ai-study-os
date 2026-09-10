import { Kysely } from 'kysely';
import { Database } from '../tables';
import { User, Subject, Chapter, SyncJob, IdempotencyRecord } from '@personal-os/domain';

export class EntitiesRepository {
  // Users
  static async insertUser(db: Kysely<Database>, user: User) {
    return await db
      .insertInto('users')
      .values({
        id: user.id,
        timezone: user.timezone,
        status: user.status,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      })
      .execute();
  }

  static async getUser(db: Kysely<Database>, id: string): Promise<User | null> {
    const row = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      timezone: row.timezone,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Subjects
  static async insertSubject(db: Kysely<Database>, subject: Subject) {
    return await db
      .insertInto('subjects')
      .values({
        id: subject.id,
        name: subject.name,
        slug: subject.slug,
        description: subject.description ?? null,
        status: subject.status,
        created_at: subject.createdAt,
        updated_at: subject.updatedAt,
      })
      .execute();
  }

  static async getSubject(db: Kysely<Database>, id: string): Promise<Subject | null> {
    const row = await db.selectFrom('subjects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Chapters
  static async insertChapter(db: Kysely<Database>, chapter: Chapter) {
    return await db
      .insertInto('chapters')
      .values({
        id: chapter.id,
        subject_id: chapter.subjectId,
        name: chapter.name,
        slug: chapter.slug,
        parent_id: chapter.parentId ?? null,
        status: chapter.status,
        progress: chapter.progress,
        created_at: chapter.createdAt,
        updated_at: chapter.updatedAt,
      })
      .execute();
  }

  static async getChapter(db: Kysely<Database>, id: string): Promise<Chapter | null> {
    const row = await db.selectFrom('chapters').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      subjectId: row.subject_id,
      name: row.name,
      slug: row.slug,
      parentId: row.parent_id,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Sync Jobs (Outbox)
  static createInsertSyncJobQuery(db: Kysely<Database>, job: SyncJob) {
    return db.insertInto('sync_jobs').values({
      job_id: job.jobId,
      idempotency_key: job.idempotencyKey,
      target_system: job.targetSystem,
      entity_type: job.entityType,
      entity_id: job.entityId,
      operation: job.operation,
      payload_json: job.payloadJson,
      status: job.status,
      attempt_count: job.attemptCount,
      next_attempt_at: job.nextAttemptAt ?? null,
      dispatched_at: job.dispatchedAt ?? null,
      processing_started_at: job.processingStartedAt ?? null,
      lease_owner: job.leaseOwner ?? null,
      lease_expires_at: job.leaseExpiresAt ?? null,
      last_error: job.lastError ?? null,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      completed_at: job.completedAt ?? null,
    });
  }

  static async getSyncJob(db: Kysely<Database>, jobId: string): Promise<SyncJob | null> {
    const row = await db.selectFrom('sync_jobs').selectAll().where('job_id', '=', jobId).executeTakeFirst();
    if (!row) return null;
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

  // Idempotency Records
  static createInsertIdempotencyRecordQuery(db: Kysely<Database>, record: IdempotencyRecord) {
    return db.insertInto('idempotency_records').values({
      idempotency_key: record.idempotencyKey,
      job_id: record.jobId ?? null,
      operation: record.operation,
      source_system: record.sourceSystem,
      request_hash: record.requestHash,
      result_hash: record.resultHash ?? null,
      status: record.status,
      result_payload: record.resultPayload ?? null,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      expires_at: record.expiresAt,
    });
  }

  static async getIdempotencyRecord(db: Kysely<Database>, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const row = await db
      .selectFrom('idempotency_records')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    if (!row) return null;
    return {
      idempotencyKey: row.idempotency_key,
      jobId: row.job_id ?? undefined,
      operation: row.operation,
      sourceSystem: row.source_system,
      requestHash: row.request_hash,
      resultHash: row.result_hash ?? undefined,
      status: row.status,
      resultPayload: row.result_payload ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }
}
