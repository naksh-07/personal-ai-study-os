import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import {
  BlueprintsRepository,
  EntitiesRepository,
} from '@personal-os/db';
import {
  PersonalStateService,
  EPIC_SHIT_OG_BLUEPRINT,
  EPIC_SHIT_OG_CONSTRAINTS,
  isAnchorContainer,
  isRotationContainer,
  isSecondaryActivity,
  isConsolidationContainer,
  isBufferDay,
  getDayOfWeek,
} from '@personal-os/core';
import {
  ScheduleBlueprintSchema,
  ScheduleTimeMapSchema,
  ScheduleConstraintSchema,
  RuntimePolicyContextSchema,
} from '@personal-os/domain';

describe('Phase 9: The Epic Shit — OG Personal Timetable Blueprint v0.1 Integration', () => {
  let ctx: TestContext;
  let pss: PersonalStateService;

  beforeEach(async () => {
    ctx = createTestDatabase();
    pss = new PersonalStateService(ctx.d1, ctx.db);

    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'Asia/Kolkata',
      status: 'active',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    });

    // Seed default baseline blueprint (Phase 8)
    await BlueprintsRepository.seedDefaultBlueprint(ctx.db, 'usr_operator');

    // Seed OG Timetable blueprint (Phase 9)
    await BlueprintsRepository.seedEpicShitBlueprint(ctx.db, 'usr_operator');
  });

  describe('Database Invariant Check (Zero Table Proliferation)', () => {
    it('preserves exactly the 27 authoritative tables (24 baseline + 3 blueprint) with zero table proliferation', () => {
      const rows = ctx.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[];

      const tableNames = rows.map(r => r.name);
      expect(tableNames.length).toBe(27);
      expect(tableNames).toContain('schedule_blueprints');
      expect(tableNames).toContain('schedule_time_maps');
      expect(tableNames).toContain('schedule_constraints');
      expect(tableNames).not.toContain('monthly_plan');
      expect(tableNames).not.toContain('weekly_plan');
      expect(tableNames).not.toContain('daily_plan');
    });
  });

  describe('OG Blueprint Definition & Schema Invariants', () => {
    it('retrieves the OG timetable blueprint with exact parameters', async () => {
      const ogBp = await BlueprintsRepository.getBlueprint(ctx.db, 'bp_epic_shit_og');
      expect(ogBp).toBeDefined();
      expect(ogBp?.id).toBe('bp_epic_shit_og');
      expect(ogBp?.name).toBe('The Epic Shit — OG Personal Timetable Blueprint v0.1');
      expect(ogBp?.timezone).toBe('Asia/Kolkata');
      expect(ogBp?.maxDailyFocusContainers).toBe(7);
      expect(ogBp?.maxDailyDeepWorkMinutes).toBe(270);
      expect(ogBp?.maxContinuousSessionMinutes).toBe(90);
      expect(ogBp?.defaultDecompressionBufferMinutes).toBe(15);
      expect(ogBp?.freezeWindowMinutes).toBe(120);
      expect(ogBp?.bufferDays).toEqual([0]);

      // Validate Zod schema
      const parseResult = ScheduleBlueprintSchema.safeParse(ogBp);
      expect(parseResult.success).toBe(true);
    });

    it('retrieves exactly all 7 OG daily time maps adhering to the container architecture', async () => {
      const timeMaps = await BlueprintsRepository.getTimeMaps(ctx.db, 'bp_epic_shit_og');
      expect(timeMaps.length).toBe(7);

      // Verify all pass Zod schema validation
      for (const tm of timeMaps) {
        const parsed = ScheduleTimeMapSchema.safeParse(tm);
        expect(parsed.success).toBe(true);
      }

      // 1. Maths Daily Cognitive Anchor
      const maths = timeMaps.find(m => m.containerId === 'maths_anchor');
      expect(maths).toBeDefined();
      expect(maths?.startTime).toBe('08:30');
      expect(maths?.endTime).toBe('10:15');
      expect(maths?.activityType).toBe('deep_work');
      expect(maths?.isOptional).toBe(false);
      expect(isAnchorContainer(maths?.containerId)).toBe(true);

      // 2. Reasoning Daily Cognitive Anchor
      const reasoning = timeMaps.find(m => m.containerId === 'reasoning_anchor');
      expect(reasoning).toBeDefined();
      expect(reasoning?.startTime).toBe('10:30');
      expect(reasoning?.endTime).toBe('12:00');
      expect(reasoning?.activityType).toBe('pyq_practice');
      expect(reasoning?.isOptional).toBe(false);
      expect(isAnchorContainer(reasoning?.containerId)).toBe(true);

      // 3. Academic Rotation A (Common Subject Pool)
      const rotA = timeMaps.find(m => m.containerId === 'academic_rotation_a');
      expect(rotA).toBeDefined();
      expect(rotA?.startTime).toBe('13:30');
      expect(rotA?.endTime).toBe('15:00');
      expect(rotA?.activityType).toBe('deep_work');
      expect(rotA?.subjectId).toBeNull(); // dynamic pool
      expect(rotA?.isOptional).toBe(false);
      expect(isRotationContainer(rotA?.containerId)).toBe(true);

      // 4. Academic Rotation B (Common Subject Pool)
      const rotB = timeMaps.find(m => m.containerId === 'academic_rotation_b');
      expect(rotB).toBeDefined();
      expect(rotB?.startTime).toBe('15:20');
      expect(rotB?.endTime).toBe('16:50');
      expect(rotB?.activityType).toBe('deep_work');
      expect(rotB?.subjectId).toBeNull(); // dynamic pool
      expect(rotB?.isOptional).toBe(false);
      expect(isRotationContainer(rotB?.containerId)).toBe(true);

      // 5. Consolidation Layer
      const consolidation = timeMaps.find(m => m.containerId === 'consolidation');
      expect(consolidation).toBeDefined();
      expect(consolidation?.startTime).toBe('17:30');
      expect(consolidation?.endTime).toBe('18:15');
      expect(consolidation?.activityType).toBe('revision');
      expect(consolidation?.isOptional).toBe(false);
      expect(isConsolidationContainer(consolidation?.containerId)).toBe(true);

      // 6. Secondary Activity Pool (Replaceable: Coding / Language / Project)
      const secondary = timeMaps.find(m => m.containerId === 'secondary_activity');
      expect(secondary).toBeDefined();
      expect(secondary?.startTime).toBe('19:30');
      expect(secondary?.endTime).toBe('20:30');
      expect(secondary?.activityType).toBe('deep_work');
      expect(secondary?.subjectId).toBeNull(); // replaceable
      expect(secondary?.isOptional).toBe(true); // Optional / replaceable
      expect(isSecondaryActivity(secondary?.containerId)).toBe(true);

      // 7. Night Retrieval & Mixed Quiz Anchor
      const night = timeMaps.find(m => m.containerId === 'night_retrieval');
      expect(night).toBeDefined();
      expect(night?.startTime).toBe('21:15');
      expect(night?.endTime).toBe('22:00');
      expect(night?.activityType).toBe('revision');
      expect(night?.isOptional).toBe(false);
      expect(isAnchorContainer(night?.containerId)).toBe(true);
    });

    it('retrieves all 6 biological invariants and routine constraints', async () => {
      const constraints = await BlueprintsRepository.getConstraints(ctx.db, 'bp_epic_shit_og');
      expect(constraints.length).toBe(6);

      for (const c of constraints) {
        expect(ScheduleConstraintSchema.safeParse(c).success).toBe(true);
      }

      const hardConstraints = constraints.filter(c => c.isHard);
      const softConstraints = constraints.filter(c => !c.isHard);

      expect(hardConstraints.length).toBe(3); // Sleep, Lunch, Dinner
      expect(softConstraints.length).toBe(3); // Morning routine, Tea/movement, Shutdown

      const sleep = hardConstraints.find(c => c.id === 'sc_og_sleep_curfew');
      expect(sleep?.startTime).toBe('22:20');
      expect(sleep?.endTime).toBe('07:00');
      expect(sleep?.constraintType).toBe('biological_invariant');

      const lunch = hardConstraints.find(c => c.id === 'sc_og_lunch_break');
      expect(lunch?.startTime).toBe('12:00');
      expect(lunch?.endTime).toBe('13:30');

      const dinner = hardConstraints.find(c => c.id === 'sc_og_dinner_break');
      expect(dinner?.startTime).toBe('20:30');
      expect(dinner?.endTime).toBe('21:15');
    });

    it('supports switching active blueprint to OG blueprint atomically', async () => {
      // Activate OG blueprint
      await BlueprintsRepository.setActiveBlueprint(ctx.db, 'usr_operator', 'bp_epic_shit_og');

      const active = await BlueprintsRepository.getActiveBlueprint(ctx.db, 'usr_operator');
      expect(active?.id).toBe('bp_epic_shit_og');
      expect(active?.isActive).toBe(true);
      expect(active?.maxDailyFocusContainers).toBe(7);
      expect(active?.maxDailyDeepWorkMinutes).toBe(270);

      // Verify old blueprint is deactivated
      const oldBp = await BlueprintsRepository.getBlueprint(ctx.db, 'bp_default_academic');
      expect(oldBp?.isActive).toBe(false);
    });
  });

  describe('PersonalStateService.getStudyState with OG Blueprint', () => {
    beforeEach(async () => {
      await BlueprintsRepository.setActiveBlueprint(ctx.db, 'usr_operator', 'bp_epic_shit_og');
    });

    it('projects OG timetable parameters and sanitized context for Spark', async () => {
      const state = await pss.getStudyState({ date: '2026-09-14', timezone: 'Asia/Kolkata' });

      expect(state.timezone).toBe('Asia/Kolkata');
      expect(state.activeBlueprint?.id).toBe('bp_epic_shit_og');
      expect(state.runtimePolicy?.maxDailyFocusContainers).toBe(7);
      expect(state.runtimePolicy?.maxDailyDeepWorkMinutes).toBe(270);
      expect(state.runtimePolicy?.maxContinuousSessionMinutes).toBe(90);

      expect(state.timeMaps?.length).toBe(7);
      expect(state.constraints?.length).toBe(6);

      // Validate blueprint config projection
      expect(state.blueprint?.containers.length).toBe(7);
      expect(RuntimePolicyContextSchema.safeParse(state.runtimePolicy).success).toBe(true);

      // Ensure no internal DB structures leak
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain('sqlite_');
      expect(serialized).not.toContain('PRAGMA');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('token');
    });
  });

  describe('Capacity Ceiling Enforcement with OG Blueprint', () => {
    beforeEach(async () => {
      await BlueprintsRepository.setActiveBlueprint(ctx.db, 'usr_operator', 'bp_epic_shit_og');
    });

    it('allows scheduling up to 7 focus containers without overcapacity warning', async () => {
      // Seed 6 calendar links
      for (let i = 1; i <= 6; i++) {
        await EntitiesRepository.insertCalendarLink(ctx.db, {
          id: `callink_og_${i}`,
          provider: 'google_calendar',
          calendarId: 'primary',
          eventId: `evt_og_${i}`,
          entityType: 'study_session',
          entityId: `sess_og_${i}`,
          startsAt: `2026-09-14T0${7 + i}:00:00.000Z`,
          endsAt: `2026-09-14T0${8 + i}:00:00.000Z`,
          createdAt: '2026-09-13T00:00:00.000Z',
          updatedAt: '2026-09-13T00:00:00.000Z',
        });
      }

      // Schedule 7th container
      const result = await pss.recordScheduleDecision({
        decisionType: 'schedule_allocated',
        decision: 'Scheduled 7th focus container (Secondary Activity)',
        calendarEventId: 'evt_og_7',
        startTime: '2026-09-14T14:00:00.000Z',
        endTime: '2026-09-14T15:00:00.000Z',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).warning).toBeUndefined();
    });

    it('issues soft warning when scheduled containers exceed OG maxDailyFocusContainers (7 -> 8)', async () => {
      // Seed 7 calendar links
      for (let i = 1; i <= 7; i++) {
        await EntitiesRepository.insertCalendarLink(ctx.db, {
          id: `callink_og_seed_${i}`,
          provider: 'google_calendar',
          calendarId: 'primary',
          eventId: `evt_og_seed_${i}`,
          entityType: 'study_session',
          entityId: `sess_og_seed_${i}`,
          startsAt: `2026-09-14T0${i}:00:00.000Z`,
          endsAt: `2026-09-14T0${i + 1}:00:00.000Z`,
          createdAt: '2026-09-13T00:00:00.000Z',
          updatedAt: '2026-09-13T00:00:00.000Z',
        });
      }

      // Attempt to schedule an 8th container
      const result = await pss.recordScheduleDecision({
        decisionType: 'schedule_allocated',
        decision: 'Scheduled 8th container (overcapacity)',
        calendarEventId: 'evt_og_overflow_8',
        startTime: '2026-09-14T16:00:00.000Z',
        endTime: '2026-09-14T17:00:00.000Z',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).warning).toBeDefined();
      expect((result.data as any).warning).toContain(
        'Schedule exceeds maximum daily focus containers (7). Scheduled: 8.'
      );
    });
  });

  describe('Core Specification Export Alignment', () => {
    it('matches the exported EPIC_SHIT_OG_BLUEPRINT constant', () => {
      expect(EPIC_SHIT_OG_BLUEPRINT.timezone).toBe('Asia/Kolkata');
      expect(EPIC_SHIT_OG_BLUEPRINT.maxDailyFocusContainers).toBe(7);
      expect(EPIC_SHIT_OG_BLUEPRINT.maxDailyDeepWorkMinutes).toBe(270);
      expect(EPIC_SHIT_OG_BLUEPRINT.maxContinuousSessionMinutes).toBe(90);
      expect(EPIC_SHIT_OG_BLUEPRINT.containers.length).toBe(7);
      expect(EPIC_SHIT_OG_CONSTRAINTS.length).toBe(6);
    });
  });
});
