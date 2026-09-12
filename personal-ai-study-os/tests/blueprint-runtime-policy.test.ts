import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import {
  BlueprintsRepository,
  EntitiesRepository,
} from '@personal-os/db';
import {
  PersonalStateService,
  getUtcDayRange,
  getDayOfWeek,
  isBufferDay,
  DEFAULT_SCHEDULE_BLUEPRINT,
} from '@personal-os/core';
import {
  ScheduleBlueprintSchema,
  ScheduleTimeMapSchema,
  ScheduleConstraintSchema,
  RuntimePolicyContextSchema,
} from '@personal-os/domain';

describe('Runtime Policy & Schedule Blueprint Layer', () => {
  let ctx: TestContext;
  let pss: PersonalStateService;

  beforeEach(async () => {
    ctx = createTestDatabase();
    pss = new PersonalStateService(ctx.d1, ctx.db);

    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'Asia/Kolkata',
      status: 'active',
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    });
    await BlueprintsRepository.seedDefaultBlueprint(ctx.db, 'usr_operator');
  });

  describe('BlueprintsRepository CRUD & Invariants', () => {
    it('retrieves the active blueprint seeded in migration 0002', async () => {
      const activeBp = await BlueprintsRepository.getActiveBlueprint(ctx.db, 'usr_operator');
      expect(activeBp).toBeDefined();
      expect(activeBp?.id).toBe('bp_default_academic');
      expect(activeBp?.name).toBe('Standard Academic Blueprint');
      expect(activeBp?.timezone).toBe('Asia/Kolkata');
      expect(activeBp?.isActive).toBe(true);
      expect(activeBp?.maxDailyFocusContainers).toBe(3);
      expect(activeBp?.maxDailyDeepWorkMinutes).toBe(270);
      expect(activeBp?.bufferDays).toEqual([0]);

      // Validate Zod schema
      const parseResult = ScheduleBlueprintSchema.safeParse(activeBp);
      expect(parseResult.success).toBe(true);
    });

    it('retrieves time maps for specific day and daily wildcards', async () => {
      const allTimeMaps = await BlueprintsRepository.getTimeMaps(ctx.db, 'bp_default_academic');
      expect(allTimeMaps.length).toBe(3);

      // Insert a Wednesday-specific time map (day_of_week = 3)
      await BlueprintsRepository.insertTimeMap(ctx.db, {
        id: 'tm_wednesday_special',
        blueprintId: 'bp_default_academic',
        dayOfWeek: 3,
        startTime: '10:00',
        endTime: '12:00',
        activityType: 'deep_work',
        containerId: 'morning_special',
        isOptional: false,
        createdAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      });

      // Query for Wednesday (3): Should return 3 wildcard maps + 1 Wednesday map = 4
      const wednesdayMaps = await BlueprintsRepository.getTimeMaps(ctx.db, 'bp_default_academic', 3);
      expect(wednesdayMaps.length).toBe(4);
      expect(wednesdayMaps.map(m => m.id)).toContain('tm_wednesday_special');

      // Query for Monday (1): Should return only the 3 wildcard maps
      const mondayMaps = await BlueprintsRepository.getTimeMaps(ctx.db, 'bp_default_academic', 1);
      expect(mondayMaps.length).toBe(3);
      expect(mondayMaps.map(m => m.id)).not.toContain('tm_wednesday_special');

      for (const tm of wednesdayMaps) {
        expect(ScheduleTimeMapSchema.safeParse(tm).success).toBe(true);
      }
    });

    it('separates biological invariants (is_hard=true) from soft personal constraints', async () => {
      const constraints = await BlueprintsRepository.getConstraints(ctx.db, 'bp_default_academic');
      expect(constraints.length).toBe(4);

      const hardConstraints = constraints.filter(c => c.isHard);
      const softConstraints = constraints.filter(c => !c.isHard);

      expect(hardConstraints.length).toBe(3); // Sleep, Lunch, Dinner
      expect(softConstraints.length).toBe(1); // Physical exercise

      const sleep = hardConstraints.find(c => c.id === 'sc_sleep_window');
      expect(sleep).toBeDefined();
      expect(sleep?.constraintType).toBe('biological_invariant');
      expect(sleep?.startTime).toBe('23:00');
      expect(sleep?.endTime).toBe('07:00');

      const gym = softConstraints.find(c => c.id === 'sc_physical_exercise');
      expect(gym).toBeDefined();
      expect(gym?.constraintType).toBe('personal_routine');
      expect(gym?.isHard).toBe(false);

      for (const c of constraints) {
        expect(ScheduleConstraintSchema.safeParse(c).success).toBe(true);
      }
    });

    it('allows toggling active blueprints atomically', async () => {
      // Create a second blueprint
      await BlueprintsRepository.insertBlueprint(ctx.db, {
        id: 'bp_intense_sprint',
        userId: 'usr_operator',
        name: 'Intense Exam Sprint',
        timezone: 'Asia/Kolkata',
        isActive: false,
        version: 1,
        maxDailyDeepWorkMinutes: 360,
        maxDailyFocusContainers: 4,
        maxContinuousSessionMinutes: 120,
        defaultDecompressionBufferMinutes: 20,
        freezeWindowMinutes: 60,
        bufferDays: [6], // Saturday
        createdAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      });

      // Switch active blueprint to bp_intense_sprint
      await BlueprintsRepository.setActiveBlueprint(ctx.db, 'usr_operator', 'bp_intense_sprint');

      const active = await BlueprintsRepository.getActiveBlueprint(ctx.db, 'usr_operator');
      expect(active?.id).toBe('bp_intense_sprint');
      expect(active?.maxDailyFocusContainers).toBe(4);

      // Verify old blueprint is deactivated
      const oldBp = await BlueprintsRepository.getBlueprint(ctx.db, 'bp_default_academic');
      expect(oldBp?.isActive).toBe(false);
    });
  });

  describe('Timezone & Boundary Helper Math', () => {
    it('computes exact UTC day range for Asia/Kolkata (+05:30)', () => {
      // 2026-09-12 in Asia/Kolkata starts at 2026-09-11 18:30:00.000Z and ends at 2026-09-12 18:29:59.999Z
      const range = getUtcDayRange('2026-09-12', 'Asia/Kolkata');
      expect(range.startUtc).toBe('2026-09-11T18:30:00.000Z');
      expect(range.endUtc).toBe('2026-09-12T18:29:59.999Z');
    });

    it('computes exact UTC day range for UTC', () => {
      const range = getUtcDayRange('2026-09-12', 'UTC');
      expect(range.startUtc).toBe('2026-09-12T00:00:00.000Z');
      expect(range.endUtc).toBe('2026-09-12T23:59:59.999Z');
    });

    it('computes exact day of week for localized dates', () => {
      // 2026-09-12 was a Saturday (6)
      expect(getDayOfWeek('2026-09-12', 'Asia/Kolkata')).toBe(6);
      // 2026-09-13 was a Sunday (0)
      expect(getDayOfWeek('2026-09-13', 'Asia/Kolkata')).toBe(0);
      // 2026-09-14 was a Monday (1)
      expect(getDayOfWeek('2026-09-14', 'Asia/Kolkata')).toBe(1);
    });

    it('determines buffer days accurately', () => {
      const sundayIdx = getDayOfWeek('2026-09-13', 'Asia/Kolkata'); // 0
      const saturdayIdx = getDayOfWeek('2026-09-12', 'Asia/Kolkata'); // 6
      const testConfig = { ...DEFAULT_SCHEDULE_BLUEPRINT, bufferDays: [0] };

      expect(isBufferDay(sundayIdx, testConfig)).toBe(true);
      expect(isBufferDay(saturdayIdx, testConfig)).toBe(false);
    });
  });

  describe('PersonalStateService.getStudyState Projection for Spark', () => {
    it('returns sanitized active blueprint, time maps, and constraints with zero leaked secrets or raw SQL', async () => {
      const state = await pss.getStudyState({ date: '2026-09-12', timezone: 'Asia/Kolkata' });

      expect(state.timezone).toBe('Asia/Kolkata');
      expect(state.activeBlueprint).toBeDefined();
      expect(state.activeBlueprint?.id).toBe('bp_default_academic');
      expect(state.activeBlueprint?.name).toBe('Standard Academic Blueprint');

      // Runtime Policy
      expect(state.runtimePolicy).toBeDefined();
      expect(state.runtimePolicy?.timezone).toBe('Asia/Kolkata');
      expect(state.runtimePolicy?.maxDailyFocusContainers).toBe(3);
      expect(state.runtimePolicy?.maxDailyDeepWorkMinutes).toBe(270);
      expect(RuntimePolicyContextSchema.safeParse(state.runtimePolicy).success).toBe(true);

      // Time maps for Saturday (day 6): 3 daily wildcard maps
      expect(state.timeMaps).toBeDefined();
      expect(state.timeMaps?.length).toBe(3);

      // Constraints: 4 total constraints (3 biological invariants, 1 routine)
      expect(state.constraints).toBeDefined();
      expect(state.constraints?.length).toBe(4);

      // Verify no raw DB or internal structures leaked
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain('sqlite_');
      expect(serialized).not.toContain('PRAGMA');
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('token');
    });

    it('falls back cleanly to DEFAULT_SCHEDULE_BLUEPRINT when no D1 blueprint is active', async () => {
      // Deactivate all blueprints
      await ctx.db.updateTable('schedule_blueprints').set({ is_active: 0 }).execute();

      const state = await pss.getStudyState({ date: '2026-09-12', timezone: 'Asia/Kolkata' });
      expect(state.activeBlueprint).toBeUndefined();
      expect(state.timeMaps).toEqual([]);
      expect(state.constraints).toEqual([]);
      expect(state.runtimePolicy).toBeDefined();
      expect(state.runtimePolicy?.maxDailyFocusContainers).toBe(DEFAULT_SCHEDULE_BLUEPRINT.maxDailyFocusContainers);
      expect(state.blueprint?.maxDailyFocusContainers).toBe(DEFAULT_SCHEDULE_BLUEPRINT.maxDailyFocusContainers);
    });
  });

  describe('PersonalStateService.getScheduleContext Projection', () => {
    it('returns schedule context with active blueprint and time maps', async () => {
      const context = await pss.getScheduleContext({
        date: '2026-09-12',
        timezone: 'Asia/Kolkata',
      });

      expect(context.timezone).toBe('Asia/Kolkata');
      expect(context.activeBlueprint).toBeDefined();
      expect(context.activeBlueprint?.id).toBe('bp_default_academic');
      expect(context.timeMaps?.length).toBe(3);
      expect(context.constraints?.length).toBe(4);
      expect(context.blueprint?.maxDailyFocusContainers).toBe(3);
    });
  });

  describe('Dynamic Capacity Ceiling Enforcement in recordScheduleDecision', () => {
    it('records decision successfully when within daily focus container limit', async () => {
      // Seed a chapter
      await EntitiesRepository.insertSubject(ctx.db, {
        id: 'subj_test',
        name: 'Physics',
        slug: 'physics',
        status: 'active',
        createdAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      });
      await EntitiesRepository.insertChapter(ctx.db, {
        id: 'chap_test_01',
        subjectId: 'subj_test',
        name: 'Optics',
        slug: 'optics',
        status: 'in_progress',
        progress: 0.2,
        createdAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      });

      const result = await pss.recordScheduleDecision({
        decisionType: 'schedule_adjusted',
        decision: 'Scheduled Optics session',
        calendarEventId: 'cal_evt_01',
        startTime: '2026-09-12T09:00:00.000Z',
        endTime: '2026-09-12T11:00:00.000Z',
        chapterId: 'chap_test_01',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as any).warning).toBeUndefined();
    });

    it('issues warning when scheduled containers exceed active blueprint maxDailyFocusContainers', async () => {
      // Seed 3 existing calendar links for 2026-09-12 in Asia/Kolkata day range
      for (let i = 1; i <= 3; i++) {
        await EntitiesRepository.insertCalendarLink(ctx.db, {
          id: `callink_seeded_${i}`,
          provider: 'google_calendar',
          calendarId: 'primary',
          eventId: `evt_existing_${i}`,
          entityType: 'study_session',
          entityId: `sess_${i}`,
          startsAt: `2026-09-12T0${8 + i * 2}:00:00.000Z`,
          endsAt: `2026-09-12T0${9 + i * 2}:00:00.000Z`,
          createdAt: '2026-09-12T00:00:00.000Z',
          updatedAt: '2026-09-12T00:00:00.000Z',
        });
      }

      // Record a 4th container on the same day when max is 3
      const result = await pss.recordScheduleDecision({
        decisionType: 'schedule_adjusted',
        decision: 'Overcapacity test session',
        calendarEventId: 'evt_overflow_4',
        startTime: '2026-09-12T16:00:00.000Z',
        endTime: '2026-09-12T18:00:00.000Z',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).warning).toBeDefined();
      expect((result.data as any).warning).toContain('Schedule exceeds maximum daily focus containers (3). Scheduled: 4.');
    });
  });
});
