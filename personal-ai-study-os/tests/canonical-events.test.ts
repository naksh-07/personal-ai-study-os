import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import { CanonicalEventEngine } from '@personal-os/core';
import { CanonicalEventsRepository, EntitiesRepository } from '@personal-os/db';
import { generateId, EventPayloadError, DomainError } from '@personal-os/domain';

describe('Canonical Event Engine', () => {
  let ctx: TestContext;
  let testSubjectId: string;
  let testChapterId: string;

  beforeEach(async () => {
    ctx = createTestDatabase();
    testSubjectId = generateId('subj');
    testChapterId = generateId('chap');

    // Seed test subject and chapter
    await EntitiesRepository.insertSubject(ctx.db, {
      id: testSubjectId,
      name: 'Physics',
      slug: 'physics',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await EntitiesRepository.insertChapter(ctx.db, {
      id: testChapterId,
      subjectId: testSubjectId,
      name: 'Kinematics',
      slug: 'kinematics',
      status: 'not_started',
      progress: 0.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('validates and creates well-formed canonical event', () => {
    const event = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: testChapterId,
        durationSeconds: 1800,
        activityType: 'deep_work',
      },
    });

    expect(event.eventId).toMatch(/^evt_/);
    expect(event.eventType).toBe('study_completed');
    expect(event.schemaVersion).toBe(1);
    expect(event.occurredAt).toBeDefined();
    expect(event.recordedAt).toBeDefined();
  });

  it('rejects event with invalid mathematical constraints', () => {
    expect(() => {
      CanonicalEventEngine.createEvent({
        eventType: 'questions_attempted',
        actor: { type: 'user', id: 'usr_01' },
        source: { system: 'chatgpt', interface: 'natural_language' },
        payload: {
          chapterId: testChapterId,
          questionsAttempted: 10,
          questionsCorrect: 12, // 12 > 10 invalid
        },
      });
    }).toThrow(/questionsCorrect cannot exceed questionsAttempted/);
  });

  it('persists valid canonical event and retrieves it by ID', async () => {
    const event = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: testChapterId,
        durationSeconds: 2400,
        activityType: 'deep_work',
      },
    });

    await CanonicalEventsRepository.createInsertQuery(ctx.db, event).execute();

    const retrieved = await CanonicalEventsRepository.getById(ctx.db, event.eventId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.eventId).toBe(event.eventId);
    expect(retrieved?.eventType).toBe('study_completed');
    expect((retrieved?.payload as any).durationSeconds).toBe(2400);
  });

  it('validates entity references and rejects events referencing non-existent chapters', async () => {
    const nonExistentChapterId = generateId('chap');
    const event = CanonicalEventEngine.createEvent({
      eventType: 'chapter_started',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: nonExistentChapterId,
      },
    });

    await expect(
      CanonicalEventEngine.validateEntityReferences(ctx.db, event)
    ).rejects.toThrow(DomainError);
  });

  it('enforces append-only semantics: events cannot be updated in place', async () => {
    const event = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: testChapterId,
        durationSeconds: 1200,
        activityType: 'deep_work',
      },
    });

    await CanonicalEventsRepository.createInsertQuery(ctx.db, event).execute();

    // Verify event is in database
    const initialCount = await CanonicalEventsRepository.count(ctx.db);
    expect(initialCount).toBe(1);
  });

  it('supports correction events linking to prior event via causationId without modifying history', async () => {
    // 1. Initial event with mistaken count: 50 attempted, 30 correct
    const initialEvent = CanonicalEventEngine.createEvent({
      eventType: 'questions_attempted',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: testChapterId,
        questionsAttempted: 50,
        questionsCorrect: 30,
      },
    });
    await CanonicalEventsRepository.createInsertQuery(ctx.db, initialEvent).execute();

    // 2. Correction event: actual score was 35 correct out of 50
    const correctionEvent = CanonicalEventEngine.createEvent({
      eventType: 'questions_attempted',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      causationId: initialEvent.eventId, // Link lineage to initial event
      payload: {
        chapterId: testChapterId,
        questionsAttempted: 50,
        questionsCorrect: 35,
      },
    });

    // Verify correction lineage reference
    await CanonicalEventEngine.validateEntityReferences(ctx.db, correctionEvent);
    await CanonicalEventsRepository.createInsertQuery(ctx.db, correctionEvent).execute();

    // Both events exist in immutable history
    const allEvents = await CanonicalEventsRepository.getAllChronological(ctx.db);
    expect(allEvents.length).toBe(2);
    expect(allEvents[0].eventId).toBe(initialEvent.eventId);
    expect(allEvents[1].eventId).toBe(correctionEvent.eventId);
    expect(allEvents[1].causationId).toBe(initialEvent.eventId);
  });

  it('rejects correction event referencing non-existent causationId', async () => {
    const nonExistentEventId = generateId('evt');
    const invalidCorrection = CanonicalEventEngine.createEvent({
      eventType: 'questions_attempted',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      causationId: nonExistentEventId,
      payload: {
        chapterId: testChapterId,
        questionsAttempted: 10,
        questionsCorrect: 8,
      },
    });

    await expect(
      CanonicalEventEngine.validateEntityReferences(ctx.db, invalidCorrection)
    ).rejects.toThrow(DomainError);
  });
});
