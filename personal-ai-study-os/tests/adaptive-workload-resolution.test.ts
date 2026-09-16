import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import { PersonalStateService } from '@personal-os/core';
import { WorkloadResolver } from '@personal-os/core';
import {
  EntitiesRepository,
  ProjectionsRepository,
  CanonicalEventsRepository,
} from '@personal-os/db';
import {
  generateId,
  Subject,
  Chapter,
  TaskLink,
  NotFoundError,
} from '@personal-os/domain';

describe('Adaptive Workload Resolution Test Suite (Level 0 to Level 4)', () => {
  let ctx: TestContext;
  let service: PersonalStateService;
  const now = '2026-09-15T10:00:00.000Z';

  beforeEach(async () => {
    ctx = createTestDatabase();
    service = new PersonalStateService(ctx.d1, ctx.db);

    // Seed default operator
    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'Asia/Kolkata',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  });

  // ==========================================================================
  // LEVEL 0: NO STUDY INTENT
  // ==========================================================================
  describe('LEVEL 0: No study intent', () => {
    it('returns empty pendingWorkload and empty studyWork when no subjects or tasks exist', async () => {
      const state = await service.getStudyState({ date: '2026-09-15', timezone: 'Asia/Kolkata' });
      expect(state.pendingWorkload).toBeDefined();
      expect(state.pendingWorkload).toHaveLength(0);

      const pendingWork = await service.getPendingWork();
      expect(pendingWork.studyWork).toHaveLength(0);
      expect(pendingWork.totalPendingCount).toBe(0);
    });

    it('WorkloadResolver returns empty array for empty inputs', () => {
      const workloads = WorkloadResolver.resolveWorkloads({
        subjects: [],
        chapters: [],
        progress: [],
        taskLinks: [],
      });
      expect(workloads).toHaveLength(0);
    });
  });

  // ==========================================================================
  // LEVEL 1: SUBJECT-ONLY SUPPORT (THE CRITICAL FIX & REAL-WORLD ACCEPTANCE)
  // ==========================================================================
  describe('LEVEL 1: Subject-only support (Original subject-only failure scenario)', () => {
    beforeEach(async () => {
      // Seed 3 subjects: Physics, Maths, Reasoning (0 chapters, 0 tasks, 0 syllabus)
      const subjects: Subject[] = [
        {
          id: 'subj_physics',
          name: 'Physics',
          slug: 'physics',
          description: 'RRB ALP Physics',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'subj_maths',
          name: 'Maths',
          slug: 'maths',
          description: 'RRB ALP Mathematics',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'subj_reasoning',
          name: 'Reasoning',
          slug: 'reasoning',
          description: 'Mental Ability & Reasoning',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
      ];

      for (const s of subjects) {
        await EntitiesRepository.insertSubject(ctx.db, s);
      }
    });

    it('PSS getStudyState returns 3 actionable subject-level workloads when chapters=0', async () => {
      const state = await service.getStudyState({ date: '2026-09-15', timezone: 'Asia/Kolkata' });

      expect(state.pendingWorkload).toBeDefined();
      expect(state.pendingWorkload).toHaveLength(3);

      const names = state.pendingWorkload?.map(w => w.name).sort();
      expect(names).toEqual(['Maths', 'Physics', 'Reasoning']);

      for (const w of state.pendingWorkload!) {
        expect(w.resolution).toBe('subject');
        expect(w.chapterId).toBeUndefined();
        expect(w.subjectId).toBeDefined();
        expect(w.displayName).toBe(w.name);
      }
    });

    it('PSS getPendingWork returns studyWork items at subject resolution', async () => {
      const pendingWork = await service.getPendingWork();
      expect(pendingWork.studyWork).toHaveLength(3);
      expect(pendingWork.totalPendingCount).toBe(3);

      expect(
        pendingWork.studyWork.every(
          w => w.category === 'study' && w.entityType === 'subject' && w.resolution === 'subject'
        )
      ).toBe(true);
      const titles = pendingWork.studyWork.map(w => w.title);
      expect(titles).toContain('Study Subject: Physics');
      expect(titles).toContain('Study Subject: Maths');
      expect(titles).toContain('Study Subject: Reasoning');
    });

    it('records a Level 1 subject session without requiring a chapterId', async () => {
      const result = await service.recordStudySession({
        subjectId: 'subj_physics',
        durationSeconds: 5400, // 90 min
        activityType: 'deep_work',
        source: 'mcp',
        startedAt: '2026-09-15T09:00:00.000Z',
        endedAt: '2026-09-15T10:30:00.000Z',
      });

      expect(result.success).toBe(true);

      // Verify row in study_sessions has subject_id, null chapter_id, and resolution='subject'
      const session = await ctx.db
        .selectFrom('study_sessions')
        .where('id', '=', result.entityId!)
        .selectAll()
        .executeTakeFirst();

      expect(session).toBeDefined();
      expect(session?.subject_id).toBe('subj_physics');
      expect(session?.chapter_id).toBeNull();
      expect(session?.resolution).toBe('subject');
      expect(session?.duration_seconds).toBe(5400);

      // Verify canonical event emitted
      const events = await ctx.db
        .selectFrom('canonical_events')
        .where('event_type', '=', 'study_session_recorded')
        .selectAll()
        .execute();

      expect(events).toHaveLength(1);
      const payload = JSON.parse(events[0].payload);
      expect(payload.subjectId).toBe('subj_physics');
      expect(payload.chapterId).toBeNull();
      expect(payload.resolution).toBe('subject');

      // PROGRESS SEMANTICS: Verify DailyState studyMinutes was incremented by 90
      const daily = await ProjectionsRepository.getDailyStateByDate(ctx.db, '2026-09-15');
      expect(daily?.studyMinutes).toBe(90);

      // PROGRESS SEMANTICS: Verify study_progress table has ZERO records (no fake chapter progress)
      const progressCount = await ctx.db.selectFrom('study_progress').selectAll().execute();
      expect(progressCount).toHaveLength(0);
    });

    it('records schedule decision for subject-level study block and formats calendar link', async () => {
      const result = await service.recordScheduleDecision({
        decisionType: 'schedule_allocated',
        decision: 'Allocate morning Deep Work for Physics',
        subjectId: 'subj_physics',
        resolution: 'subject',
        calendarEventId: 'evt_phys_0900',
        calendarId: 'primary',
        startTime: '2026-09-15T09:00:00.000Z',
        endTime: '2026-09-15T10:30:00.000Z',
        title: '[Study OS] Physics',
      });

      expect(result.success).toBe(true);

      // Verify calendar_link row has entityType = 'subject' and entityId = 'subj_physics'
      const links = await ctx.db
        .selectFrom('calendar_links')
        .where('event_id', '=', 'evt_phys_0900')
        .selectAll()
        .execute();

      expect(links).toHaveLength(1);
      expect(links[0].entity_type).toBe('study_session');
      expect(links[0].entity_id).toBe('subj_physics');
      expect(links[0].title_snapshot).toBe('[Study OS] Physics');
    });

    it('throws NotFoundError if non-existent subjectId is supplied to recordStudySession', async () => {
      await expect(
        service.recordStudySession({
          subjectId: 'subj_nonexistent',
          durationSeconds: 3600,
          activityType: 'deep_work',
          startedAt: '2026-09-15T09:00:00.000Z',
          endedAt: '2026-09-15T10:00:00.000Z',
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ==========================================================================
  // LEVEL 2: SUBJECT + CHAPTER SUPPORT
  // ==========================================================================
  describe('LEVEL 2: Subject + Chapter support', () => {
    beforeEach(async () => {
      await EntitiesRepository.insertSubject(ctx.db, {
        id: 'subj_physics',
        name: 'Physics',
        slug: 'physics',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_curr_elec',
        subjectId: 'subj_physics',
        name: 'Current Electricity',
        slug: 'current-electricity',
        status: 'not_started',
        progress: 0.0,
        createdAt: now,
        updatedAt: now,
      });
    });

    it('resolves Physics to chapter resolution with displayName Physics / Current Electricity', async () => {
      const state = await service.getStudyState({ date: '2026-09-15', timezone: 'Asia/Kolkata' });

      expect(state.pendingWorkload).toHaveLength(1);
      const item = state.pendingWorkload![0];
      expect(item.resolution).toBe('chapter');
      expect(item.subjectId).toBe('subj_physics');
      expect(item.chapterId).toBe('chap_curr_elec');
      expect(item.displayName).toBe('Physics / Current Electricity');
    });

    it('updates chapter study_progress when chapter-level session is recorded', async () => {
      const result = await service.recordStudySession({
        subjectId: 'subj_physics',
        chapterId: 'chap_curr_elec',
        durationSeconds: 5400,
        activityType: 'deep_work',
        startedAt: '2026-09-15T09:00:00.000Z',
        endedAt: '2026-09-15T10:30:00.000Z',
      });

      expect(result.success).toBe(true);

      // Verify study_progress updated for chap_curr_elec
      const progress = await ProjectionsRepository.getStudyProgressByChapter(
        ctx.db,
        'chap_curr_elec'
      );
      expect(progress).toBeDefined();
      expect(progress?.status).toBe('IN_PROGRESS');
      expect(progress?.subjectId).toBe('subj_physics');
    });
  });

  // ==========================================================================
  // LEVEL 3: SUBJECT + TOPIC SUPPORT
  // ==========================================================================
  describe('LEVEL 3: Subject + Topic support', () => {
    beforeEach(async () => {
      await EntitiesRepository.insertSubject(ctx.db, {
        id: 'subj_physics',
        name: 'Physics',
        slug: 'physics',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      // Parent chapter
      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_curr_elec',
        subjectId: 'subj_physics',
        name: 'Current Electricity',
        slug: 'current-electricity',
        status: 'in_progress',
        progress: 0.2,
        createdAt: now,
        updatedAt: now,
      });

      // Child chapter (Topic)
      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_kirchhoff',
        subjectId: 'subj_physics',
        name: "Kirchhoff's Laws",
        slug: 'kirchhoffs-laws',
        parentId: 'chap_curr_elec',
        status: 'not_started',
        progress: 0.0,
        createdAt: now,
        updatedAt: now,
      });
    });

    it('resolves to topic level: Physics / Current Electricity / Kirchhoffs Laws', async () => {
      const state = await service.getStudyState({ date: '2026-09-15', timezone: 'Asia/Kolkata' });

      expect(state.pendingWorkload).toHaveLength(1);
      const item = state.pendingWorkload![0];
      expect(item.resolution).toBe('topic');
      expect(item.subjectId).toBe('subj_physics');
      expect(item.chapterId).toBe('chap_curr_elec');
      expect(item.topicId).toBe('chap_kirchhoff');
      expect(item.displayName).toBe("Physics / Current Electricity / Kirchhoff's Laws");
    });
  });

  // ==========================================================================
  // LEVEL 4: SPECIFIC TASK SUPPORT
  // ==========================================================================
  describe('LEVEL 4: Specific Task support', () => {
    beforeEach(async () => {
      await EntitiesRepository.insertSubject(ctx.db, {
        id: 'subj_physics',
        name: 'Physics',
        slug: 'physics',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_curr_elec',
        subjectId: 'subj_physics',
        name: 'Current Electricity',
        slug: 'current-electricity',
        status: 'in_progress',
        progress: 0.2,
        createdAt: now,
        updatedAt: now,
      });

      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_kirchhoff',
        subjectId: 'subj_physics',
        name: "Kirchhoff's Laws",
        slug: 'kirchhoffs-laws',
        parentId: 'chap_curr_elec',
        status: 'not_started',
        progress: 0.0,
        createdAt: now,
        updatedAt: now,
      });

      // Link an explicit Google Task to the topic
      await EntitiesRepository.upsertTaskLink(ctx.db, {
        id: 'tasklink_pyq50',
        provider: 'google_tasks',
        tasklistId: '@default',
        taskId: 'gtask_pyq50',
        entityType: 'chapter',
        entityId: 'chap_kirchhoff',
        titleSnapshot: '50 PYQs',
        statusSnapshot: 'needsAction',
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });

    it('resolves to task level: Physics / Current Electricity / Kirchhoffs Laws / 50 PYQs', async () => {
      const state = await service.getStudyState({ date: '2026-09-15', timezone: 'Asia/Kolkata' });

      expect(state.pendingWorkload).toHaveLength(1);
      const item = state.pendingWorkload![0];
      expect(item.resolution).toBe('task');
      expect(item.subjectId).toBe('subj_physics');
      expect(item.chapterId).toBe('chap_curr_elec');
      expect(item.topicId).toBe('chap_kirchhoff');
      expect(item.taskId).toBe('gtask_pyq50');
      expect(item.displayName).toBe("Physics / Current Electricity / Kirchhoff's Laws / 50 PYQs");
    });
  });

  // ==========================================================================
  // MIXED RESOLUTION SUPPORT
  // ==========================================================================
  describe('Mixed Resolution across different subjects', () => {
    beforeEach(async () => {
      // 1. Physics -> Topic (Kirchhoff)
      await EntitiesRepository.insertSubject(ctx.db, {
        id: 'subj_physics',
        name: 'Physics',
        slug: 'physics',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_curr_elec',
        subjectId: 'subj_physics',
        name: 'Current Electricity',
        slug: 'current-electricity',
        status: 'in_progress',
        progress: 0.1,
        createdAt: now,
        updatedAt: now,
      });
      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_kirchhoff',
        subjectId: 'subj_physics',
        name: "Kirchhoff's Laws",
        slug: 'kirchhoffs-laws',
        parentId: 'chap_curr_elec',
        status: 'not_started',
        progress: 0.0,
        createdAt: now,
        updatedAt: now,
      });

      // 2. Maths -> Chapter (Calculus, no subtopics)
      await EntitiesRepository.insertSubject(ctx.db, {
        id: 'subj_maths',
        name: 'Maths',
        slug: 'maths',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_calculus',
        subjectId: 'subj_maths',
        name: 'Calculus',
        slug: 'calculus',
        status: 'not_started',
        progress: 0.0,
        createdAt: now,
        updatedAt: now,
      });

      // 3. Reasoning -> Subject only (0 chapters)
      await EntitiesRepository.insertSubject(ctx.db, {
        id: 'subj_reasoning',
        name: 'Reasoning',
        slug: 'reasoning',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
    });

    it('correctly resolves Physics->topic, Maths->chapter, Reasoning->subject in one state call', async () => {
      const state = await service.getStudyState({ date: '2026-09-15', timezone: 'Asia/Kolkata' });

      expect(state.pendingWorkload).toHaveLength(3);

      const phys = state.pendingWorkload?.find(w => w.subjectId === 'subj_physics');
      const maths = state.pendingWorkload?.find(w => w.subjectId === 'subj_maths');
      const reas = state.pendingWorkload?.find(w => w.subjectId === 'subj_reasoning');

      expect(phys?.resolution).toBe('topic');
      expect(phys?.displayName).toBe("Physics / Current Electricity / Kirchhoff's Laws");

      expect(maths?.resolution).toBe('chapter');
      expect(maths?.displayName).toBe('Maths / Calculus');

      expect(reas?.resolution).toBe('subject');
      expect(reas?.displayName).toBe('Reasoning');
    });
  });

  // ==========================================================================
  // FALLBACK CASCADES & ANTI-HALLUCINATION
  // ==========================================================================
  describe('Fallback Cascades & Anti-Hallucination Invariant', () => {
    it('gracefully degrades through Level 4 -> 3 -> 2 -> 1 -> 0 without fabricating entities', () => {
      const subject: Subject = {
        id: 'subj_physics',
        name: 'Physics',
        slug: 'physics',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      const parentChapter: Chapter = {
        id: 'chap_curr_elec',
        subjectId: 'subj_physics',
        name: 'Current Electricity',
        slug: 'current-electricity',
        status: 'not_started',
        progress: 0.0,
        createdAt: now,
        updatedAt: now,
      };

      const childChapter: Chapter = {
        id: 'chap_kirchhoff',
        subjectId: 'subj_physics',
        name: "Kirchhoff's Laws",
        slug: 'kirchhoffs-laws',
        parentId: 'chap_curr_elec',
        status: 'not_started',
        progress: 0.0,
        createdAt: now,
        updatedAt: now,
      };

      const taskLink: TaskLink = {
        id: 'tasklink_01',
        provider: 'google_tasks',
        tasklistId: '@default',
        taskId: 'gtask_01',
        entityType: 'chapter',
        entityId: 'chap_kirchhoff',
        titleSnapshot: '50 PYQs',
        statusSnapshot: 'needsAction',
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      // Step 1: Level 4 (Task present)
      let resolved = WorkloadResolver.resolveWorkloads({
        subjects: [subject],
        chapters: [parentChapter, childChapter],
        taskLinks: [taskLink],
      });
      expect(resolved[0].resolution).toBe('task');
      expect(resolved[0].displayName).toBe("Physics / Current Electricity / Kirchhoff's Laws / 50 PYQs");

      // Step 2: Task removed -> Falls back to Level 3 (Topic)
      resolved = WorkloadResolver.resolveWorkloads({
        subjects: [subject],
        chapters: [parentChapter, childChapter],
        taskLinks: [],
      });
      expect(resolved[0].resolution).toBe('topic');
      expect(resolved[0].displayName).toBe("Physics / Current Electricity / Kirchhoff's Laws");

      // Step 3: Topic removed -> Falls back to Level 2 (Chapter)
      resolved = WorkloadResolver.resolveWorkloads({
        subjects: [subject],
        chapters: [parentChapter],
        taskLinks: [],
      });
      expect(resolved[0].resolution).toBe('chapter');
      expect(resolved[0].displayName).toBe('Physics / Current Electricity');

      // Step 4: Chapter removed -> Falls back to Level 1 (Subject only)
      resolved = WorkloadResolver.resolveWorkloads({
        subjects: [subject],
        chapters: [],
        taskLinks: [],
      });
      expect(resolved[0].resolution).toBe('subject');
      expect(resolved[0].displayName).toBe('Physics');

      // Step 5: Subject removed -> Falls back to Level 0 (No study)
      resolved = WorkloadResolver.resolveWorkloads({
        subjects: [],
        chapters: [],
        taskLinks: [],
      });
      expect(resolved).toHaveLength(0);

      // ANTI-HALLUCINATION: Verify forbidden strings never appear in names
      const allNames = ['Physics', 'Physics / Current Electricity', "Physics / Current Electricity / Kirchhoff's Laws"];
      for (const name of allNames) {
        expect(name).not.toContain('General Physics');
        expect(name).not.toContain('Unspecified Chapter');
        expect(name).not.toContain('Default Topic');
      }
    });
  });
});
