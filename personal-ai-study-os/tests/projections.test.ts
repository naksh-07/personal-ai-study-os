import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import { ProjectionEngine, AtomicWriter, CanonicalEventEngine } from '@personal-os/core';
import {
  ProjectionsRepository,
  EntitiesRepository,
  CanonicalEventsRepository,
} from '@personal-os/db';
import { generateId } from '@personal-os/domain';

describe('Projection Engine & Deterministic Rebuilds', () => {
  let ctx: TestContext;
  let subjectId: string;
  let chapter1Id: string;
  let chapter2Id: string;

  beforeEach(async () => {
    ctx = createTestDatabase();
    subjectId = generateId('subj');
    chapter1Id = generateId('chap');
    chapter2Id = generateId('chap');

    await EntitiesRepository.insertUser(ctx.db, {
      id: generateId('usr'),
      timezone: 'UTC',
      status: 'active',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    await EntitiesRepository.insertSubject(ctx.db, {
      id: subjectId,
      name: 'Mathematics',
      slug: 'mathematics',
      status: 'active',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    await EntitiesRepository.insertChapter(ctx.db, {
      id: chapter1Id,
      subjectId,
      name: 'Differential Calculus',
      slug: 'diff-calculus',
      status: 'not_started',
      progress: 0.0,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    await EntitiesRepository.insertChapter(ctx.db, {
      id: chapter2Id,
      subjectId,
      name: 'Integral Calculus',
      slug: 'integral-calculus',
      status: 'not_started',
      progress: 0.0,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });
  });

  it('study_completed updates study_progress and daily_states minutes', async () => {
    const event = CanonicalEventEngine.createEvent({
      eventType: 'study_completed',
      occurredAt: '2026-09-11T10:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: chapter1Id,
        subjectId,
        durationSeconds: 3600, // 60 minutes
        activityType: 'deep_work',
      },
    });

    await AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, { event });

    // Verify study_progress
    const progress = await ProjectionsRepository.getStudyProgressByChapter(ctx.db, chapter1Id);
    expect(progress).not.toBeNull();
    expect(progress?.status).toBe('IN_PROGRESS');
    expect(progress?.lastStudiedAt).toBe('2026-09-11T10:00:00.000Z');

    // Verify daily_states
    const daily = await ProjectionsRepository.getDailyStateByDate(ctx.db, '2026-09-11');
    expect(daily).not.toBeNull();
    expect(daily?.studyMinutes).toBe(60);
  });

  it('questions_attempted correctly updates cumulative counts and accuracy in both projections', async () => {
    // Attempt 1: 20 attempted, 15 correct
    const event1 = CanonicalEventEngine.createEvent({
      eventType: 'questions_attempted',
      occurredAt: '2026-09-11T11:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: chapter1Id,
        subjectId,
        questionsAttempted: 20,
        questionsCorrect: 15,
      },
    });
    await AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, { event: event1 });

    // Attempt 2: 30 attempted, 25 correct
    const event2 = CanonicalEventEngine.createEvent({
      eventType: 'questions_attempted',
      occurredAt: '2026-09-11T14:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: chapter1Id,
        subjectId,
        questionsAttempted: 30,
        questionsCorrect: 25,
      },
    });
    await AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, { event: event2 });

    // Total: 50 attempted, 40 correct => accuracy 0.8
    const progress = await ProjectionsRepository.getStudyProgressByChapter(ctx.db, chapter1Id);
    expect(progress?.questionsAttempted).toBe(50);
    expect(progress?.questionsCorrect).toBe(40);
    expect(progress?.accuracy).toBe(0.8);

    const daily = await ProjectionsRepository.getDailyStateByDate(ctx.db, '2026-09-11');
    expect(daily?.questionsAttempted).toBe(50);
    expect(daily?.questionsCorrect).toBe(40);
    expect(daily?.accuracy).toBe(0.8);
  });

  it('chapter_completed marks study_progress completed and increments daily_states completed_chapters', async () => {
    const event = CanonicalEventEngine.createEvent({
      eventType: 'chapter_completed',
      occurredAt: '2026-09-11T16:00:00.000Z',
      actor: { type: 'user', id: 'usr_01' },
      source: { system: 'chatgpt', interface: 'natural_language' },
      payload: {
        chapterId: chapter1Id,
        subjectId,
      },
    });

    await AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, { event });

    const progress = await ProjectionsRepository.getStudyProgressByChapter(ctx.db, chapter1Id);
    expect(progress?.status).toBe('COMPLETED');
    expect(progress?.progressPercent).toBe(1.0);
    expect(progress?.lastCompletedAt).toBe('2026-09-11T16:00:00.000Z');

    const daily = await ProjectionsRepository.getDailyStateByDate(ctx.db, '2026-09-11');
    expect(daily?.completedChapters).toBe(1);
  });

  it('projection rebuild produces 100% identical state from canonical event ledger', async () => {
    // 1. Generate a sequence of events across chapters and days
    const events = [
      CanonicalEventEngine.createEvent({
        eventType: 'study_completed',
        occurredAt: '2026-09-10T09:00:00.000Z',
        actor: { type: 'user', id: 'usr_01' },
        source: { system: 'chatgpt', interface: 'natural_language' },
        payload: { chapterId: chapter1Id, subjectId, durationSeconds: 5400, activityType: 'deep_work' },
      }),
      CanonicalEventEngine.createEvent({
        eventType: 'questions_attempted',
        occurredAt: '2026-09-10T11:00:00.000Z',
        actor: { type: 'user', id: 'usr_01' },
        source: { system: 'chatgpt', interface: 'natural_language' },
        payload: { chapterId: chapter1Id, subjectId, questionsAttempted: 40, questionsCorrect: 32 },
      }),
      CanonicalEventEngine.createEvent({
        eventType: 'study_completed',
        occurredAt: '2026-09-11T08:00:00.000Z',
        actor: { type: 'user', id: 'usr_01' },
        source: { system: 'chatgpt', interface: 'natural_language' },
        payload: { chapterId: chapter2Id, subjectId, durationSeconds: 7200, activityType: 'deep_work' },
      }),
      CanonicalEventEngine.createEvent({
        eventType: 'questions_attempted',
        occurredAt: '2026-09-11T10:00:00.000Z',
        actor: { type: 'user', id: 'usr_01' },
        source: { system: 'chatgpt', interface: 'natural_language' },
        payload: { chapterId: chapter2Id, subjectId, questionsAttempted: 25, questionsCorrect: 20 },
      }),
      CanonicalEventEngine.createEvent({
        eventType: 'chapter_completed',
        occurredAt: '2026-09-11T12:00:00.000Z',
        actor: { type: 'user', id: 'usr_01' },
        source: { system: 'chatgpt', interface: 'natural_language' },
        payload: { chapterId: chapter1Id, subjectId },
      }),
      CanonicalEventEngine.createEvent({
        eventType: 'schedule_missed',
        occurredAt: '2026-09-11T15:00:00.000Z',
        actor: { type: 'system', id: 'system' },
        source: { system: 'spark', interface: 'webhook' },
        payload: {
          calendarEventId: 'cal_01',
          scheduledStart: '2026-09-11T15:00:00.000Z',
          scheduledEnd: '2026-09-11T16:00:00.000Z',
        },
      }),
    ];

    for (const ev of events) {
      await AtomicWriter.ingestAndProjectAtomic(ctx.d1, ctx.db, { event: ev });
    }

    // Capture incremental projection state
    const originalProgressRows = await ProjectionsRepository.getAllStudyProgress(ctx.db);
    const originalDailyRows = await ProjectionsRepository.getAllDailyStates(ctx.db);

    expect(originalProgressRows.length).toBe(2);
    expect(originalDailyRows.length).toBe(2);

    // 2. Perform Rebuild from Canonical Events
    const rebuildResult = await ProjectionEngine.rebuildProjections(ctx.d1, ctx.db);
    expect(rebuildResult.eventsProcessed).toBe(6);
    expect(rebuildResult.progressCount).toBe(2);
    expect(rebuildResult.dailyCount).toBe(2);

    // 3. Compare Rebuilt State vs Original State
    const rebuiltProgressRows = await ProjectionsRepository.getAllStudyProgress(ctx.db);
    const rebuiltDailyRows = await ProjectionsRepository.getAllDailyStates(ctx.db);

    // Verify chapter 1 progress matches identically
    const origP1 = originalProgressRows.find(p => p.chapterId === chapter1Id)!;
    const rebP1 = rebuiltProgressRows.find(p => p.chapterId === chapter1Id)!;
    expect(rebP1.status).toBe(origP1.status);
    expect(rebP1.progressPercent).toBe(origP1.progressPercent);
    expect(rebP1.questionsAttempted).toBe(origP1.questionsAttempted);
    expect(rebP1.questionsCorrect).toBe(origP1.questionsCorrect);
    expect(rebP1.accuracy).toBe(origP1.accuracy);
    expect(rebP1.lastStudiedAt).toBe(origP1.lastStudiedAt);
    expect(rebP1.lastCompletedAt).toBe(origP1.lastCompletedAt);

    // Verify chapter 2 progress matches identically
    const origP2 = originalProgressRows.find(p => p.chapterId === chapter2Id)!;
    const rebP2 = rebuiltProgressRows.find(p => p.chapterId === chapter2Id)!;
    expect(rebP2.status).toBe(origP2.status);
    expect(rebP2.questionsAttempted).toBe(origP2.questionsAttempted);
    expect(rebP2.questionsCorrect).toBe(origP2.questionsCorrect);
    expect(rebP2.accuracy).toBe(origP2.accuracy);

    // Verify daily states match identically
    const origD11 = originalDailyRows.find(d => d.date === '2026-09-11')!;
    const rebD11 = rebuiltDailyRows.find(d => d.date === '2026-09-11')!;
    expect(rebD11.studyMinutes).toBe(origD11.studyMinutes);
    expect(rebD11.completedChapters).toBe(origD11.completedChapters);
    expect(rebD11.questionsAttempted).toBe(origD11.questionsAttempted);
    expect(rebD11.questionsCorrect).toBe(origD11.questionsCorrect);
    expect(rebD11.accuracy).toBe(origD11.accuracy);
    expect(rebD11.missedSessions).toBe(origD11.missedSessions);
  });
});
