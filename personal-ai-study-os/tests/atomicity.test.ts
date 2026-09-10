import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import { AtomicWriter, CanonicalEventEngine } from '@personal-os/core';
import {
  CanonicalEventsRepository,
  ProjectionsRepository,
  EntitiesRepository,
  executeD1Batch,
} from '@personal-os/db';
import { generateId, DomainError } from '@personal-os/domain';

describe('Atomicity & D1 Batch Coordination', () => {
  let ctx: TestContext;
  let subjectId: string;
  let chapterId: string;

  beforeEach(async () => {
    ctx = createTestDatabase();
    subjectId = generateId('subj');
    chapterId = generateId('chap');

    await EntitiesRepository.insertUser(ctx.db, {
      id: generateId('usr'),
      timezone: 'UTC',
      status: 'active',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    await EntitiesRepository.insertSubject(ctx.db, {
      id: subjectId,
      name: 'Physics',
      slug: 'physics',
      status: 'active',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    await EntitiesRepository.insertChapter(ctx.db, {
      id: chapterId,
      subjectId,
      name: 'Electromagnetism',
      slug: 'electromagnetism',
      status: 'not_started',
      progress: 0.0,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });
  });

  it('canonical event + projection + outbox sync_job + idempotency record commit atomically together', async () => {
    const event = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      occurredAt: '2026-09-11T12:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId,
        subjectId,
        durationSeconds: 1800,
        activityType: 'deep_work',
      },
    });

    const syncJob = {
      jobId: generateId('sync'),
      idempotencyKey: generateId('idemp'),
      targetSystem: 'notion' as const,
      entityType: 'study_progress' as const,
      entityId: chapterId,
      operation: 'update' as const,
      payloadJson: JSON.stringify({ progress: 0.5 }),
      status: 'PENDING' as const,
      attemptCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const idempotencyRecord = {
      idempotencyKey: syncJob.idempotencyKey,
      jobId: syncJob.jobId,
      operation: 'study_completed',
      sourceSystem: 'chatgpt',
      requestHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'PENDING' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };

    const result = await AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, {
      event,
      syncJob,
      idempotencyRecord,
    });

    expect(result.success).toBe(true);

    // Verify all 4 components exist in database
    const savedEvent = await CanonicalEventsRepository.getById(ctx.db, event.eventId);
    expect(savedEvent).not.toBeNull();

    const savedProgress = await ProjectionsRepository.getStudyProgressByChapter(ctx.db, chapterId);
    expect(savedProgress).not.toBeNull();

    const savedJob = await EntitiesRepository.getSyncJob(ctx.db, syncJob.jobId);
    expect(savedJob).not.toBeNull();

    const savedIdemp = await EntitiesRepository.getIdempotencyRecord(ctx.db, idempotencyRecord.idempotencyKey);
    expect(savedIdemp).not.toBeNull();
  });

  it('all-or-nothing rollback: failed batch statement rolls back entire coordinated transaction', async () => {
    const event = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      occurredAt: '2026-09-11T12:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId,
        subjectId,
        durationSeconds: 1800,
        activityType: 'deep_work',
      },
    });

    // Valid canonical event insert query
    const insertEventQuery = CanonicalEventsRepository.createInsertQuery(ctx.db, event);

    // Deliberately broken query: invalid foreign key insertion in chapters
    const brokenQuery = ctx.db.insertInto('chapters').values({
      id: generateId('chap'),
      subject_id: 'subj_non_existent', // Violates foreign key
      name: 'Broken Chapter',
      slug: 'broken-slug',
      status: 'not_started',
      progress: 0.0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Batch execute [insertEventQuery, brokenQuery]
    await expect(
      executeD1Batch(ctx.d1, [insertEventQuery, brokenQuery])
    ).rejects.toThrow();

    // Verify that NO partial write survived: the canonical event MUST NOT exist
    const savedEvent = await CanonicalEventsRepository.getById(ctx.db, event.eventId);
    expect(savedEvent).toBeNull();
  });

  it('strictly prohibits explicit BEGIN, COMMIT, and ROLLBACK SQL statements', async () => {
    expect(() => {
      ctx.d1.prepare('BEGIN TRANSACTION').bind();
    }).toThrow();

    expect(() => {
      ctx.d1.prepare('COMMIT').bind();
    }).toThrow();

    expect(() => {
      ctx.d1.prepare('ROLLBACK').bind();
    }).toThrow();

    await expect(
      executeD1Batch(ctx.d1, [{ compile: () => ({ sql: 'BEGIN TRANSACTION', parameters: [] } as any) }])
    ).rejects.toThrow(DomainError);
  });
});
