import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import { PersonalStateService } from '@personal-os/core';
import {
  EntitiesRepository,
  ProjectionsRepository,
  CanonicalEventsRepository,
} from '@personal-os/db';
import {
  generateId,
  Subject,
  Chapter,
  DomainError,
  MathematicalConstraintError,
} from '@personal-os/domain';

describe('Slice 3: PersonalStateService', () => {
  let ctx: TestContext;
  let service: PersonalStateService;
  const testDate = '2026-09-11';
  const testSubjectId = 'subj_anatomy';
  const testChapterId1 = 'chap_thorax';
  const testChapterId2 = 'chap_heart';

  beforeEach(async () => {
    ctx = createTestDatabase();
    service = new PersonalStateService(ctx.d1, ctx.db);

    const now = new Date().toISOString();

    // Seed default operator
    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'UTC',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    // Seed Subject
    const subject: Subject = {
      id: testSubjectId,
      name: 'Human Anatomy',
      slug: 'human-anatomy',
      description: 'Preclinical anatomy',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertSubject(ctx.db, subject);

    // Seed Chapter 1 (Parent)
    const chapter1: Chapter = {
      id: testChapterId1,
      subjectId: testSubjectId,
      name: 'Thorax',
      slug: 'thorax',
      status: 'not_started',
      progress: 0.0,
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter1);

    // Seed Chapter 2 (Child of Chapter 1)
    const chapter2: Chapter = {
      id: testChapterId2,
      subjectId: testSubjectId,
      name: 'Heart & Mediastinum',
      slug: 'heart-mediastinum',
      parentId: testChapterId1,
      status: 'not_started',
      progress: 0.0,
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter2);
  });

  // ==========================================================================
  // READS
  // ==========================================================================

  it('1. getTodayState returns structured state with zero defaults when no activity recorded', async () => {
    const state = await service.getTodayState({ date: testDate, timezone: 'UTC' });
    expect(state.date).toBe(testDate);
    expect(state.timezone).toBe('UTC');
    expect(state.studyProgress.studyMinutes).toBe(0);
    expect(state.studyProgress.completedChapters).toBe(0);
    expect(state.completedActivity.eventsCount).toBe(0);
    expect(state.pendingWork.pendingTasksCount).toBe(0);
    expect(state.synchronizationStatus.healthy).toBe(true);
    expect(state.warnings).toHaveLength(0);
  });

  it('2. getStudyState aggregates chapter progress and accuracy correctly', async () => {
    // Record study session on chapter 1 with questions
    const now = new Date().toISOString();
    await service.recordStudySession({
      subjectId: testSubjectId,
      chapterId: testChapterId1,
      startedAt: '2026-09-11T10:00:00.000Z',
      endedAt: '2026-09-11T11:00:00.000Z',
      durationSeconds: 3600,
      activityType: 'pyq_practice',
      source: 'test',
      questionsAttempted: 20,
      questionsCorrect: 16,
    });

    const studyState = await service.getStudyState();
    expect(studyState.totalStudyMinutes).toBe(60);
    expect(studyState.questionsAttempted).toBe(20);
    expect(studyState.questionsCorrect).toBe(16);
    expect(studyState.accuracy).toBe(0.8);
    expect(studyState.totalChaptersCount).toBe(2);
    expect(studyState.subjectSummaries).toHaveLength(1);
    expect(studyState.subjectSummaries[0].subjectId).toBe(testSubjectId);
    expect(studyState.recentActivity.length).toBeGreaterThan(0);
    expect(studyState.blueprint).toBeDefined();
    expect(studyState.blueprint?.containers).toHaveLength(3);
    expect(studyState.blueprint?.maxDailyFocusContainers).toBe(3);
  });

  it('3. getSubjectState returns recursive chapter tree and stable IDs', async () => {
    const subjectState = await service.getSubjectState(testSubjectId);
    expect(subjectState.subject.id).toBe(testSubjectId);
    expect(subjectState.subject.name).toBe('Human Anatomy');
    expect(subjectState.chapters).toHaveLength(1); // Thorax is top-level
    expect(subjectState.chapters[0].id).toBe(testChapterId1);
    expect(subjectState.chapters[0].children).toHaveLength(1); // Heart is child
    expect(subjectState.chapters[0].children![0].id).toBe(testChapterId2);
    expect(subjectState.completionState.isFullyCompleted).toBe(false);
    expect(subjectState.completionState.remainingChaptersCount).toBe(2);
  });

  it('4. getChapterState returns detailed chapter state and linked source mappings without fulltext', async () => {
    const now = new Date().toISOString();
    // Insert source, source_chapter, and source_mapping
    const sourceId = generateId('src');
    await EntitiesRepository.insertSource(ctx.db, {
      id: sourceId,
      title: "Gray's Anatomy 42nd Edition",
      sourceType: 'book',
      author: 'Standring',
      publisher: 'Elsevier',
      status: 'registered',
      createdAt: now,
      updatedAt: now,
    });

    const sourceChapId = generateId('srcchap');
    await EntitiesRepository.insertSourceChapter(ctx.db, {
      id: sourceChapId,
      sourceId,
      title: 'Chapter 54: The Thorax',
      chapterNumber: 54,
      locationReference: 'pp. 915-940',
      createdAt: now,
      updatedAt: now,
    });

    await EntitiesRepository.insertSourceMapping(ctx.db, {
      id: generateId('map'),
      sourceChapterId: sourceChapId,
      canonicalChapterId: testChapterId1,
      mappingType: 'direct',
      relevance: 'high',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    const chapterState = await service.getChapterState(testChapterId1);
    expect(chapterState.chapter.id).toBe(testChapterId1);
    expect(chapterState.subject.id).toBe(testSubjectId);
    expect(chapterState.parentChapter).toBeNull();
    expect(chapterState.linkedSourceMappings).toHaveLength(1);
    expect(chapterState.linkedSourceMappings[0].sourceTitle).toBe("Gray's Anatomy 42nd Edition");
    expect(chapterState.linkedSourceMappings[0].sourceChapterTitle).toBe('Chapter 54: The Thorax');
    // Ensure no copyrighted body text field exists
    expect((chapterState.linkedSourceMappings[0] as any).fullText).toBeUndefined();
  });

  it('5. getRecentActivity supports deterministic filtering by eventType and chapter', async () => {
    // Record two events
    await service.recordStudySession({
      subjectId: testSubjectId,
      chapterId: testChapterId1,
      startedAt: '2026-09-11T09:00:00.000Z',
      endedAt: '2026-09-11T09:30:00.000Z',
      durationSeconds: 1800,
      activityType: 'deep_work',
      source: 'test',
    });

    await service.updateProgress({
      chapterId: testChapterId1,
      progress: 0.5,
    });

    const allActivity = await service.getRecentActivity({ limit: 10 });
    expect(allActivity.length).toBeGreaterThanOrEqual(2);

    const filtered = await service.getRecentActivity({
      eventType: 'chapter_progress_updated',
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0].eventType).toBe('chapter_progress_updated');
  });

  it('6. getPendingWork combines study work, external tasks, and sync work', async () => {
    const now = new Date().toISOString();
    // 1. Mark chapter 1 in_progress
    await service.updateProgress({ chapterId: testChapterId1, progress: 0.4 });

    // 2. Insert external task needing action
    await EntitiesRepository.insertTaskLink(ctx.db, {
      id: generateId('tasklink'),
      provider: 'google_tasks',
      tasklistId: 'tl_today',
      taskId: 'task_review_notes',
      entityType: 'chapter',
      entityId: testChapterId1,
      titleSnapshot: 'Review mediastinum notes',
      statusSnapshot: 'needsAction',
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // 3. Insert failed sync job
    await EntitiesRepository.createInsertSyncJobQuery(ctx.db, {
      jobId: generateId('sync'),
      idempotencyKey: 'sync_key_1',
      targetSystem: 'notion',
      entityType: 'chapter',
      entityId: testChapterId1,
      operation: 'update',
      payloadJson: '{}',
      status: 'FAILED',
      attemptCount: 2,
      lastError: 'HTTP 504 Gateway Timeout',
      createdAt: now,
      updatedAt: now,
    }).execute();

    const pending = await service.getPendingWork();
    expect(pending.studyWork.length).toBe(1);
    expect(pending.studyWork[0].id).toBe(testChapterId1);
    expect(pending.externalTasks.length).toBe(1);
    expect(pending.externalTasks[0].title).toBe('Review mediastinum notes');
    expect(pending.syncWork.length).toBe(1);
    expect(pending.syncWork[0].lastError).toBe('HTTP 504 Gateway Timeout');
    expect(pending.totalPendingCount).toBe(3);
  });

  it('7. getScheduleContext detects overlapping block conflicts and missed sessions', async () => {
    const now = new Date().toISOString();
    // 1. Insert two overlapping calendar blocks
    await EntitiesRepository.insertCalendarLink(ctx.db, {
      id: generateId('callink'),
      provider: 'google_calendar',
      calendarId: 'primary',
      eventId: 'cal_event_1',
      entityType: 'study_session',
      entityId: testChapterId1,
      titleSnapshot: 'Thorax Revision Block 1',
      startsAt: '2026-09-11T14:00:00.000Z',
      endsAt: '2026-09-11T15:30:00.000Z',
      statusSnapshot: 'confirmed',
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await EntitiesRepository.insertCalendarLink(ctx.db, {
      id: generateId('callink'),
      provider: 'google_calendar',
      calendarId: 'primary',
      eventId: 'cal_event_2',
      entityType: 'study_session',
      entityId: testChapterId2,
      titleSnapshot: 'Heart Lecture (Conflict)',
      startsAt: '2026-09-11T15:00:00.000Z',
      endsAt: '2026-09-11T16:00:00.000Z',
      statusSnapshot: 'confirmed',
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Record schedule_missed event
    await service.recordEvent({
      eventType: 'schedule_missed',
      actor: { type: 'system', id: 'calendar_poller' },
      source: { system: 'google_calendar', interface: 'rest' },
      occurredAt: '2026-09-11T10:00:00.000Z',
      payload: {
        calendarEventId: 'cal_event_morning',
        scheduledStart: '2026-09-11T09:00:00.000Z',
        scheduledEnd: '2026-09-11T10:00:00.000Z',
        reason: 'Overslept',
      },
    });

    const context = await service.getScheduleContext({
      date: '2026-09-11',
      currentTimestamp: '2026-09-11T14:15:00.000Z',
    });

    expect(context.calendarBlocks).toHaveLength(2);
    expect(context.currentOrNextBlock?.calendarEventId).toBe('cal_event_1');
    expect(context.conflicts).toHaveLength(1);
    expect(context.conflicts[0].blockA.calendarEventId).toBe('cal_event_1');
    expect(context.conflicts[0].blockB.calendarEventId).toBe('cal_event_2');
    expect(context.missedSessions).toHaveLength(1);
    expect(context.missedSessions[0].reason).toBe('Overslept');
    expect(context.blueprint).toBeDefined();
    expect(context.blueprint?.containers).toHaveLength(3);
  });

  it('8. searchMemory retrieves facts with version history, decisions, and research', async () => {
    const now = new Date().toISOString();
    // 1. Insert fact with versions
    const factId = generateId('mem');
    await EntitiesRepository.insertMemoryFact(ctx.db, {
      id: factId,
      fact: 'Operator prefers spaced repetition in 25-minute Pomodoro blocks',
      category: 'preference',
      validAt: now,
      createdAt: now,
    });

    await EntitiesRepository.insertMemoryVersion(ctx.db, {
      id: generateId('memver'),
      memoryFactId: factId,
      operation: 'ADD',
      newFact: 'Operator prefers spaced repetition in 25-minute Pomodoro blocks',
      actorId: 'usr_operator',
      createdAt: now,
    });

    // 2. Record decision
    await service.recordDecision({
      title: 'Adopt Active Recall over Passive Reading',
      context: 'Initial diagnostic exam score was sub-optimal',
      decision: 'Switch to Anki flashcards for all histology concepts',
      consequences: 'Requires daily 20-minute review session',
    });

    // 3. Record research
    await service.recordResearch({
      topic: 'High-Yield Embryology Concepts',
      source: 'First Aid 2026',
      summary: 'Aortic arches and pharyngeal pouch derivatives appear consistently in Section 1',
      takeaways: ['Focus on 3rd and 4th aortic arch branches'],
    });

    const searchResult = await service.searchMemory({ query: 'repetition' });
    expect(searchResult.items).toHaveLength(1);
    expect(searchResult.items[0].type).toBe('fact');
    expect(searchResult.items[0].versionsCount).toBe(1);

    const searchAll = await service.searchMemory({});
    expect(searchAll.items.length).toBeGreaterThanOrEqual(3);
  });

  it('9. getProjectState returns machine state, events, decisions, and task links', async () => {
    const now = new Date().toISOString();
    const projectId = generateId('proj');
    await EntitiesRepository.insertProject(ctx.db, {
      id: projectId,
      name: 'USMLE Step 1 Preparation',
      description: 'Comprehensive study strategy',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    await EntitiesRepository.insertProjectEvent(ctx.db, {
      id: generateId('progevt'),
      projectId,
      eventType: 'milestone_reached',
      actor: 'usr_operator',
      payloadJson: JSON.stringify({ milestone: '50% of QBank completed' }),
      createdAt: now,
    });

    await service.recordDecision({
      projectId,
      title: 'Target Exam Date',
      context: 'Score plateau reached at 240',
      decision: 'Schedule exam for November 2026',
    });

    const state = await service.getProjectState(projectId);
    expect(state.project.id).toBe(projectId);
    expect(state.project.name).toBe('USMLE Step 1 Preparation');
    expect(state.recentEvents).toHaveLength(1);
    expect(state.decisions).toHaveLength(1);
    expect(state.latestProgress.milestonesCount).toBe(1);
  });

  it('10. getSyncStatus returns structured system health without exposing credentials', async () => {
    const status = await service.getSyncStatus();
    expect(status).toHaveProperty('healthy');
    expect(status).toHaveProperty('pendingJobsCount');
    expect(status).toHaveProperty('processingJobsCount');
    expect(status).toHaveProperty('failedJobsCount');
    expect(status).toHaveProperty('deadLetterJobsCount');
    expect(status).toHaveProperty('systemBreakdown');
    expect(status.systemBreakdown).toHaveProperty('notion');
    expect(status.systemBreakdown).toHaveProperty('google_tasks');
    expect(status.systemBreakdown).toHaveProperty('google_calendar');

    // Confirm no secrets or tokens exist
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('bearer');
  });

  // ==========================================================================
  // MUTATIONS
  // ==========================================================================

  it('11. recordEvent creates a canonical event and atomically updates daily_states projection', async () => {
    const result = await service.recordEvent({
      eventType: 'study_completed',
      actor: { type: 'user', id: 'usr_operator' },
      source: { system: 'chatgpt', interface: 'rest' },
      occurredAt: '2026-09-11T12:00:00.000Z',
      payload: {
        chapterId: testChapterId1,
        subjectId: testSubjectId,
        durationSeconds: 3600,
        activityType: 'deep_work',
      },
    });

    expect(result.success).toBe(true);
    expect(result.eventId).toBeDefined();

    const daily = await ProjectionsRepository.getDailyStateByDate(ctx.db, '2026-09-11');
    expect(daily).not.toBeNull();
    expect(daily?.studyMinutes).toBe(60);
  });

  it('12. recordStudySession enforces mathematical constraints and persists session', async () => {
    // Should fail when questionsCorrect > questionsAttempted
    await expect(
      service.recordStudySession({
        subjectId: testSubjectId,
        chapterId: testChapterId1,
        startedAt: '2026-09-11T14:00:00.000Z',
        endedAt: '2026-09-11T15:00:00.000Z',
        durationSeconds: 3600,
        activityType: 'pyq_practice',
        source: 'rest',
        questionsAttempted: 10,
        questionsCorrect: 12,
      })
    ).rejects.toThrow();

    // Should succeed with valid math
    const result = await service.recordStudySession({
      subjectId: testSubjectId,
      chapterId: testChapterId1,
      startedAt: '2026-09-11T14:00:00.000Z',
      endedAt: '2026-09-11T15:00:00.000Z',
      durationSeconds: 3600,
      activityType: 'pyq_practice',
      source: 'rest',
      questionsAttempted: 10,
      questionsCorrect: 8,
    });

    expect(result.success).toBe(true);
    expect(result.entityId).toBeDefined();

    const sessions = await ctx.db.selectFrom('study_sessions').selectAll().execute();
    expect(sessions).toHaveLength(1);
    expect((sessions[0] as any).questions_attempted).toBeUndefined(); // derived in events
  });

  it('13. updateProgress preserves event-first architecture and updates chapter state', async () => {
    const result = await service.updateProgress({
      chapterId: testChapterId1,
      progress: 0.75,
    });

    expect(result.success).toBe(true);

    const chapter = await EntitiesRepository.getChapter(ctx.db, testChapterId1);
    expect(chapter?.progress).toBe(0.75);
    expect(chapter?.status).toBe('in_progress');

    // Canonical event was recorded
    const events = await CanonicalEventsRepository.getRecentActivity(ctx.db, {
      chapterId: testChapterId1,
      eventType: 'chapter_progress_updated',
    });
    expect(events).toHaveLength(1);
    expect((events[0].payload as any).progress).toBe(0.75);
  });

  it('14. completeChapter records canonical chapter_completed event and updates projections', async () => {
    const result = await service.completeChapter({
      chapterId: testChapterId1,
      subjectId: testSubjectId,
    });

    expect(result.success).toBe(true);

    const chapter = await EntitiesRepository.getChapter(ctx.db, testChapterId1);
    expect(chapter?.status).toBe('completed');
    expect(chapter?.progress).toBe(1.0);

    const progress = await ProjectionsRepository.getStudyProgressByChapter(ctx.db, testChapterId1);
    expect(progress?.status).toBe('COMPLETED');
  });

  it('15. recordResearch persists structured research fact and emits canonical event', async () => {
    const result = await service.recordResearch({
      topic: 'Action potentials in ventricular myocytes',
      source: 'Costanzo Physiology 7e',
      summary: 'Phase 0 rapid depolarization driven by voltage-gated Na+ channels.',
      takeaways: ['Phase 2 plateau is calcium-dependent'],
    });

    expect(result.success).toBe(true);

    const research = await EntitiesRepository.getResearchEvents(ctx.db);
    expect(research).toHaveLength(1);
    expect(research[0].topic).toBe('Action potentials in ventricular myocytes');

    const events = await CanonicalEventsRepository.getRecentActivity(ctx.db, {
      eventType: 'research_completed',
    });
    expect(events).toHaveLength(1);
  });

  it('16. recordDecision captures durable operational conclusions', async () => {
    const result = await service.recordDecision({
      title: 'Clinical Rotations Schedule',
      context: 'Choice between Internal Medicine and Surgery first',
      decision: 'Elect Internal Medicine first to establish diagnostic baseline',
      consequences: 'Surgery postponed to Block 3',
    });

    expect(result.success).toBe(true);

    const decisions = await EntitiesRepository.getDecisions(ctx.db);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('Elect Internal Medicine first to establish diagnostic baseline');

    const events = await CanonicalEventsRepository.getRecentActivity(ctx.db, {
      eventType: 'decision_recorded',
    });
    expect(events).toHaveLength(1);
  });

  it('17. linkTask connects internal chapter to external Google Tasks identity', async () => {
    const result = await service.linkTask({
      provider: 'google_tasks',
      tasklistId: 'tl_anatomy',
      taskId: 'gtask_9988',
      entityType: 'chapter',
      entityId: testChapterId1,
      titleSnapshot: 'Complete thorax practice set',
    });

    expect(result.success).toBe(true);

    const links = await EntitiesRepository.getTaskLinks(ctx.db);
    expect(links).toHaveLength(1);
    expect(links[0].taskId).toBe('gtask_9988');
    expect(links[0].entityId).toBe(testChapterId1);

    const events = await CanonicalEventsRepository.getRecentActivity(ctx.db, {
      eventType: 'task_created',
    });
    expect(events).toHaveLength(1);
  });

  it('18. linkCalendarEvent establishes precision schedule linkage', async () => {
    const result = await service.linkCalendarEvent({
      provider: 'google_calendar',
      calendarId: 'primary',
      eventId: 'gcal_block_123',
      entityType: 'study_session',
      entityId: testChapterId1,
      titleSnapshot: 'Mediastinum Study Session',
      startsAt: '2026-09-11T16:00:00.000Z',
      endsAt: '2026-09-11T17:30:00.000Z',
    });

    expect(result.success).toBe(true);

    const calLinks = await EntitiesRepository.getCalendarLinks(ctx.db);
    expect(calLinks).toHaveLength(1);
    expect(calLinks[0].eventId).toBe('gcal_block_123');
  });

  // ==========================================================================
  // INTEGRITY & CONSTRAINTS
  // ==========================================================================

  it('19. rejects invalid canonical event envelope and payload schema', async () => {
    await expect(
      service.recordEvent({
        eventType: 'study_completed',
        actor: { type: 'user', id: 'usr_operator' },
        source: { system: 'chatgpt', interface: 'rest' },
        payload: {
          chapterId: testChapterId1,
          durationSeconds: -50, // Invalid duration
        },
      } as any)
    ).rejects.toThrow();
  });

  it('20. rejects operations referencing non-existent entities', async () => {
    await expect(
      service.getChapterState('chap_non_existent')
    ).rejects.toThrow(DomainError);

    await expect(
      service.updateProgress({
        chapterId: 'chap_non_existent',
        progress: 0.5,
      })
    ).rejects.toThrow(DomainError);
  });

  it('21. duplicate idempotent mutation replays cached response and detects payload conflicts', async () => {
    const idempotencyKey = 'idemp_session_record_test';
    const input = {
      subjectId: testSubjectId,
      chapterId: testChapterId1,
      startedAt: '2026-09-11T08:00:00.000Z',
      endedAt: '2026-09-11T09:00:00.000Z',
      durationSeconds: 3600,
      activityType: 'deep_work' as const,
      source: 'rest',
    };

    // First call: executes mutation
    const firstResult = await service.recordStudySession(input, {
      key: idempotencyKey,
      requestPayload: input,
    });
    expect(firstResult.success).toBe(true);

    // Count canonical events
    const countAfterFirst = await CanonicalEventsRepository.count(ctx.db);

    // Second call with same idempotency key and identical payload: replay cached response!
    const secondResult = await service.recordStudySession(input, {
      key: idempotencyKey,
      requestPayload: input,
    });
    expect(secondResult.success).toBe(true);
    expect(secondResult.entityId).toBe(firstResult.entityId);

    // Event count must not increment (no duplicate event!)
    const countAfterSecond = await CanonicalEventsRepository.count(ctx.db);
    expect(countAfterSecond).toBe(countAfterFirst);

    // Third call with same idempotency key but DIFFERENT payload: must throw IDEMPOTENCY_CONFLICT!
    const divergentInput = {
      ...input,
      durationSeconds: 7200,
    };
    await expect(
      service.recordStudySession(divergentInput, {
        key: idempotencyKey,
        requestPayload: divergentInput,
      })
    ).rejects.toThrow(DomainError);
  });

  it('22. preserves canonical event append-only invariant during multiple mutations', async () => {
    const c0 = await CanonicalEventsRepository.count(ctx.db);

    await service.updateProgress({ chapterId: testChapterId1, progress: 0.2 });
    const c1 = await CanonicalEventsRepository.count(ctx.db);
    expect(c1).toBe(c0 + 1);

    await service.updateProgress({ chapterId: testChapterId1, progress: 0.4 });
    const c2 = await CanonicalEventsRepository.count(ctx.db);
    expect(c2).toBe(c1 + 1);

    await service.completeChapter({ chapterId: testChapterId1 });
    const c3 = await CanonicalEventsRepository.count(ctx.db);
    expect(c3).toBe(c2 + 1);
  });

  it('23. preserves correlationId and causationId lineage through state service', async () => {
    const correlationId = 'corr_diagnostic_workflow_001';
    const result = await service.updateProgress({
      chapterId: testChapterId1,
      progress: 0.6,
      correlationId,
    });

    const event = await CanonicalEventsRepository.getById(ctx.db, result.eventId!);
    expect(event?.correlationId).toBe(correlationId);
  });

  it('24. recordScheduleDecision records schedule_adjusted decision and emits canonical event', async () => {
    const result = await service.recordScheduleDecision({
      decisionType: 'schedule_adjusted',
      decision: 'Shifted Chapter 1 revision to 14:00 due to meeting conflict',
      rationale: 'Operator calendar busy in morning window',
      calendarEventId: 'cal_event_spark_101',
      calendarId: 'primary',
      chapterId: testChapterId1,
      startTime: '2026-09-11T14:00:00.000Z',
      endTime: '2026-09-11T15:30:00.000Z',
      previousStart: '2026-09-11T10:00:00.000Z',
      previousEnd: '2026-09-11T11:30:00.000Z',
      title: 'Deep Work: Cell Structure Revision',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('record_schedule_decision');
    expect(result.eventId).toBeDefined();
    expect(result.entityId).toBeDefined();

    // Verify decision stored in decisions table
    const decision = await ctx.db
      .selectFrom('decisions')
      .selectAll()
      .where('id', '=', result.entityId!)
      .executeTakeFirst();
    expect(decision).toBeDefined();
    expect(decision?.decision).toContain('Shifted Chapter 1 revision');

    // Verify calendar link updated in calendar_links table
    const calLink = await ctx.db
      .selectFrom('calendar_links')
      .selectAll()
      .where('event_id', '=', 'cal_event_spark_101')
      .executeTakeFirst();
    expect(calLink).toBeDefined();
    expect(calLink?.starts_at).toBe('2026-09-11T14:00:00.000Z');
    expect(calLink?.ends_at).toBe('2026-09-11T15:30:00.000Z');

    // Verify canonical event
    const event = await CanonicalEventsRepository.getById(ctx.db, result.eventId!);
    expect(event).toBeDefined();
    expect(event?.eventType).toBe('schedule_adjusted');
    expect(event?.actor.id).toBe('agt_spark');
    expect(event?.source.system).toBe('spark');
  });

  it('25. recordScheduleDecision records schedule_missed decision and flags cancelled status', async () => {
    const result = await service.recordScheduleDecision({
      decisionType: 'schedule_missed',
      decision: 'Operator missed scheduled study block for Chapter 2',
      rationale: 'No activity detected during allocated window',
      calendarEventId: 'cal_event_spark_102',
      chapterId: testChapterId2,
      startTime: '2026-09-11T08:00:00.000Z',
      endTime: '2026-09-11T09:00:00.000Z',
    });

    expect(result.success).toBe(true);
    const event = await CanonicalEventsRepository.getById(ctx.db, result.eventId!);
    expect(event?.eventType).toBe('schedule_missed');

    const calLink = await ctx.db
      .selectFrom('calendar_links')
      .selectAll()
      .where('event_id', '=', 'cal_event_spark_102')
      .executeTakeFirst();
    expect(calLink?.status_snapshot).toBe('cancelled');
  });

  it('26. recordScheduleDecision validates chapter existence', async () => {
    await expect(
      service.recordScheduleDecision({
        decision: 'Allocate unknown chapter',
        chapterId: 'chap_nonexistent_999',
      })
    ).rejects.toThrow('not found');
  });

  it('27. recordScheduleDecision supports idempotent replay', async () => {
    const idempKey = 'idemp_spark_sched_test_001';
    const payload = {
      decision: 'Confirmed evening review block',
      calendarEventId: 'cal_event_spark_103',
      startTime: '2026-09-11T18:00:00.000Z',
      endTime: '2026-09-11T19:00:00.000Z',
    };

    const res1 = await service.recordScheduleDecision(payload, { key: idempKey, sourceSystem: 'spark' });
    expect(res1.success).toBe(true);

    const res2 = await service.recordScheduleDecision(payload, { key: idempKey, sourceSystem: 'spark' });
    expect(res2.success).toBe(true);
    expect(res2.replayed).toBe(true);
    expect(res2.entityId).toBe(res1.entityId);
  });

  it('28. recordStudySession records evidenceTier in canonical event payload', async () => {
    // 1. Session with explicit evidenceTier
    const res1 = await service.recordStudySession({
      subjectId: testSubjectId,
      chapterId: testChapterId1,
      startedAt: '2026-09-11T12:00:00.000Z',
      endedAt: '2026-09-11T13:00:00.000Z',
      durationSeconds: 3600,
      activityType: 'deep_work',
      source: 'google_calendar',
      evidenceTier: 'observed',
    });
    expect(res1.success).toBe(true);
    const event1 = await CanonicalEventsRepository.getById(ctx.db, res1.eventId!);
    expect(event1?.payload).toMatchObject({
      evidenceTier: 'observed',
    });

    // 2. Session with default evidenceTier
    const res2 = await service.recordStudySession({
      subjectId: testSubjectId,
      chapterId: testChapterId1,
      startedAt: '2026-09-11T13:00:00.000Z',
      endedAt: '2026-09-11T14:00:00.000Z',
      durationSeconds: 3600,
      activityType: 'revision',
      source: 'google_calendar',
    });
    expect(res2.success).toBe(true);
    const event2 = await CanonicalEventsRepository.getById(ctx.db, res2.eventId!);
    expect(event2?.payload).toMatchObject({
      evidenceTier: 'user_reported',
    });
  });

  it('29. recordScheduleDecision returns soft warning when scheduled containers exceed maxDailyFocusContainers', async () => {
    const targetDate = '2026-09-15';
    // Create 3 existing calendar links on this day (maxDailyFocusContainers is 3)
    for (let i = 1; i <= 3; i++) {
      await EntitiesRepository.upsertCalendarLink(ctx.db, {
        id: generateId('callink'),
        provider: 'google_calendar',
        calendarId: 'primary',
        eventId: `cal_event_existing_${i}`,
        entityType: 'study_session',
        entityId: testChapterId1,
        titleSnapshot: `Session ${i}`,
        startsAt: `${targetDate}T${String(8 + i * 2).padStart(2, '0')}:00:00.000Z`,
        endsAt: `${targetDate}T${String(9 + i * 2).padStart(2, '0')}:00:00.000Z`,
        statusSnapshot: 'confirmed',
        lastSyncedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Now record a 4th schedule decision on the same day -> triggers soft warning
    const res = await service.recordScheduleDecision({
      decision: 'Adding 4th block to target date',
      calendarEventId: 'cal_event_exceeding_4',
      startTime: `${targetDate}T18:00:00.000Z`,
      endTime: `${targetDate}T19:00:00.000Z`,
    });

    expect(res.success).toBe(true);
    expect((res.data as any)?.warning).toBeDefined();
    expect((res.data as any)?.warning).toContain('Schedule exceeds maximum daily focus containers');
  });

  it('30. mutateMemoryFact handles ADD operation, persisting fact, version, and canonical event', async () => {
    const res = await service.mutateMemoryFact({
      operation: 'ADD',
      category: 'preference',
      fact: 'Prefers Pomodoro 50/10 intervals for pharmacology',
      actorId: 'usr_operator',
    });

    expect(res.success).toBe(true);
    expect(res.operation).toBe('mutate_memory_fact');
    expect(res.entityId).toMatch(/^mem_/);

    // Verify row in memory_facts
    const fact = await EntitiesRepository.getMemoryFact(ctx.db, res.entityId!);
    expect(fact).not.toBeNull();
    expect(fact?.fact).toBe('Prefers Pomodoro 50/10 intervals for pharmacology');
    expect(fact?.category).toBe('preference');
    expect(fact?.invalidAt).toBeNull();

    // Verify row in memory_versions
    const versions = await EntitiesRepository.getMemoryVersions(ctx.db, res.entityId!);
    expect(versions).toHaveLength(1);
    expect(versions[0].operation).toBe('ADD');
    expect(versions[0].newFact).toBe('Prefers Pomodoro 50/10 intervals for pharmacology');

    // Verify canonical event
    const event = await CanonicalEventsRepository.getById(ctx.db, res.eventId!);
    expect(event?.eventType).toBe('memory_added');
    expect((event?.payload as any)?.factId).toBe(res.entityId);
  });

  it('31. mutateMemoryFact handles UPDATE operation, invalidating prior fact and persisting new fact + versions', async () => {
    // 1. ADD initial fact
    const addRes = await service.mutateMemoryFact({
      operation: 'ADD',
      category: 'convention',
      fact: 'Morning review begins at 08:30',
    });
    const originalFactId = addRes.entityId!;

    // 2. UPDATE fact
    const updateRes = await service.mutateMemoryFact({
      operation: 'UPDATE',
      factId: originalFactId,
      fact: 'Morning review begins at 09:00',
      reason: 'Shifted schedule for morning routine',
    });

    expect(updateRes.success).toBe(true);
    const newFactId = updateRes.entityId!;
    expect(newFactId).not.toBe(originalFactId);

    // Verify original fact invalidated
    const originalFact = await EntitiesRepository.getMemoryFact(ctx.db, originalFactId);
    expect(originalFact?.invalidAt).not.toBeNull();

    // Verify new fact is active
    const newFact = await EntitiesRepository.getMemoryFact(ctx.db, newFactId);
    expect(newFact?.fact).toBe('Morning review begins at 09:00');
    expect(newFact?.category).toBe('convention');
    expect(newFact?.invalidAt).toBeNull();

    // Verify versions logged
    const originalVersions = await EntitiesRepository.getMemoryVersions(ctx.db, originalFactId);
    expect(originalVersions.some(v => v.operation === 'UPDATE')).toBe(true);

    const newVersions = await EntitiesRepository.getMemoryVersions(ctx.db, newFactId);
    expect(newVersions.some(v => v.operation === 'UPDATE')).toBe(true);

    // Verify canonical event
    const event = await CanonicalEventsRepository.getById(ctx.db, updateRes.eventId!);
    expect(event?.eventType).toBe('memory_updated');
    expect((event?.payload as any)?.factId).toBe(originalFactId);
    expect((event?.payload as any)?.previousFact).toBe('Morning review begins at 08:30');
    expect((event?.payload as any)?.newFact).toBe('Morning review begins at 09:00');
  });

  it('32. mutateMemoryFact handles INVALIDATE operation, setting invalid_at and logging version', async () => {
    // 1. ADD initial fact
    const addRes = await service.mutateMemoryFact({
      operation: 'ADD',
      category: 'constraint',
      fact: 'Do not study after 22:00',
    });
    const factId = addRes.entityId!;

    // 2. INVALIDATE fact
    const invRes = await service.mutateMemoryFact({
      operation: 'INVALIDATE',
      factId,
      reason: 'Exam week crunch',
    });

    expect(invRes.success).toBe(true);
    expect(invRes.entityId).toBe(factId);

    // Verify invalidated in memory_facts
    const fact = await EntitiesRepository.getMemoryFact(ctx.db, factId);
    expect(fact?.invalidAt).not.toBeNull();

    // Verify version in memory_versions
    const versions = await EntitiesRepository.getMemoryVersions(ctx.db, factId);
    expect(versions.some(v => v.operation === 'INVALIDATE')).toBe(true);

    // Verify canonical event
    const event = await CanonicalEventsRepository.getById(ctx.db, invRes.eventId!);
    expect(event?.eventType).toBe('memory_invalidated');
    expect((event?.payload as any)?.factId).toBe(factId);
  });

  it('33. mutateMemoryFact supports idempotent replay', async () => {
    const idempKey = 'idemp_mem_test_replay_001';
    const payload = {
      operation: 'ADD' as const,
      category: 'pattern' as const,
      fact: 'High retention when testing within 24 hours of lecture',
    };

    const res1 = await service.mutateMemoryFact(payload, { key: idempKey, sourceSystem: 'mcp' });
    expect(res1.success).toBe(true);

    const res2 = await service.mutateMemoryFact(payload, { key: idempKey, sourceSystem: 'mcp' });
    expect(res2.success).toBe(true);
    expect(res2.replayed).toBe(true);
    expect(res2.entityId).toBe(res1.entityId);
  });

  it('34. mutateMemoryFact validates input parameters (missing fields, nonexistent fact)', async () => {
    // 1. ADD missing fact/category
    await expect(
      service.mutateMemoryFact({
        operation: 'ADD',
        fact: '',
      } as any)
    ).rejects.toThrow();

    // 2. UPDATE missing factId
    await expect(
      service.mutateMemoryFact({
        operation: 'UPDATE',
        fact: 'Updated fact text',
      } as any)
    ).rejects.toThrow();

    // 3. INVALIDATE non-existent fact
    await expect(
      service.mutateMemoryFact({
        operation: 'INVALIDATE',
        factId: 'mem_nonexistent_999',
      })
    ).rejects.toThrow('not found');
  });
});
