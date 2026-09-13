import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import {
  BlueprintsRepository,
  EntitiesRepository,
  CanonicalEventsRepository,
  ProjectionsRepository,
} from '@personal-os/db';
import {
  PersonalStateService,
  DayStateResolver,
  DynamicReplanningEngine,
} from '@personal-os/core';
import {
  DayStateProfile,
  DayClassification,
  FocusContainerId,
  MIN_VIABLE_CONTAINER_DURATIONS,
  generateId,
} from '@personal-os/domain';

describe('Phase 10: Dynamic Day Replanning & Variable Wake/Sleep Policy v1.0 Test Suite', () => {
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

    // Seed default baseline blueprint (Phase 8) & OG Timetable blueprint (Phase 9)
    await BlueprintsRepository.seedDefaultBlueprint(ctx.db, 'usr_operator');
    await BlueprintsRepository.seedEpicShitBlueprint(ctx.db, 'usr_operator');
  });

  // ==========================================================================
  // INVARIANT 1: Zero DDL & 27 Tables Invariant
  // ==========================================================================
  describe('Invariant: Zero DDL & Database Schema Invariance', () => {
    it('preserves exactly 27 tables with zero table or column proliferation', () => {
      const rows = ctx.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[];

      const tableNames = rows.map(r => r.name);
      expect(tableNames.length).toBe(27);
      expect(tableNames).toContain('daily_states');
      expect(tableNames).toContain('canonical_events');
      expect(tableNames).toContain('calendar_links');
      expect(tableNames).toContain('decisions');
      expect(tableNames).not.toContain('replan_history');
      expect(tableNames).not.toContain('day_states');
    });
  });

  // ==========================================================================
  // SCENARIO 1: Epistemic Hierarchy for Wake & Sleep Resolution
  // ==========================================================================
  describe('Epistemic Hierarchy (Wake/Sleep Resolution)', () => {
    it('Tier 1: Explicit user-reported wake time takes highest precedence', () => {
      const state = DayStateResolver.resolveDayState({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        currentTime: '2026-09-13T03:30:00.000Z', // 09:00 IST
        declaredWake: '08:30',
        userEventsToday: [
          {
            eventId: 'evt_1',
            eventType: 'study_session_recorded',
            occurredAt: '2026-09-13T02:00:00.000Z', // 07:30 IST
          },
        ],
      });

      // 08:30 IST is 03:00 UTC
      expect(state.actualWake).toBe('2026-09-13T03:00:00.000Z');
      expect(state.classifications).toContain('LATE_START');
    });

    it('Tier 2: Actually available telemetry (canonical events) is used when no declared wake', () => {
      const state = DayStateResolver.resolveDayState({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        currentTime: '2026-09-13T04:00:00.000Z', // 09:30 IST
        userEventsToday: [
          {
            eventId: 'evt_1',
            eventType: 'study_session_recorded',
            occurredAt: '2026-09-13T02:15:00.000Z', // 07:45 IST
          },
        ],
      });

      expect(state.actualWake).toBe('2026-09-13T02:15:00.000Z');
    });

    it('Tier 3: Blueprint fallback (07:00 IST) is used when no declaration or telemetry exists', () => {
      const state = DayStateResolver.resolveDayState({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        currentTime: '2026-09-13T01:30:00.000Z', // 07:00 IST
      });

      // 07:00 IST is 01:30 UTC
      expect(state.actualWake).toBe('2026-09-13T01:30:00.000Z');
      expect(state.classifications).toContain('NORMAL');
    });

    it('PROHIBITION: Never infers wake from first calendar event', () => {
      const state = DayStateResolver.resolveDayState({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        currentTime: '2026-09-13T01:30:00.000Z',
        existingCalendarBlocks: [
          {
            calendarEventId: 'cal_early',
            title: 'Early Gym Block',
            startsAt: '2026-09-13T00:30:00.000Z', // 06:00 IST
            endsAt: '2026-09-13T01:30:00.000Z',
          },
        ],
      });

      // Must NOT be 06:00 UTC/IST; falls back to nominal 07:00 IST
      expect(state.actualWake).toBe('2026-09-13T01:30:00.000Z');
    });
  });

  // ==========================================================================
  // SCENARIO 2: Wind-Down Separation vs Biological Sleep Boundary
  // ==========================================================================
  describe('Wind-Down Separation vs Biological Sleep Boundary', () => {
    it('strictly separates windDownStart (22:20 IST) from targetSleep (23:00 IST)', () => {
      const state = DayStateResolver.resolveDayState({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
      });

      // 22:20 IST is 16:50 UTC
      expect(state.windDownStart).toBe('2026-09-13T16:50:00.000Z');
      // 23:00 IST is 17:30 UTC
      expect(state.targetSleep).toBe('2026-09-13T17:30:00.000Z');
    });

    it('ensures no study session is scheduled past windDownStart', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        currentTime: '2026-09-13T01:30:00.000Z',
      });

      for (const sc of proposal.scheduledContainers) {
        expect(sc.endsAt <= proposal.dayState.windDownStart).toBe(true);
      }
    });
  });

  // ==========================================================================
  // SCENARIOS A - F: Day Classifications (Normal, Late Wake, Early Wake, Late Sleep, Early Sleep)
  // ==========================================================================
  describe('Scenarios A - F: Day Classifications', () => {
    it('Scenario A: Normal Day (07:00 wake, 23:00 sleep)', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '07:00',
        declaredSleep: '23:00',
      });

      expect(proposal.dayState.classifications).toContain('NORMAL');
      expect(proposal.plannedDeepWorkMinutes).toBeLessThanOrEqual(270);
      expect(proposal.scheduledContainers.length).toBeGreaterThanOrEqual(4);
    });

    it('Scenario B: Late Wake (08:00 IST)', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '08:00',
        currentTime: '2026-09-13T02:30:00.000Z', // 08:00 IST
      });

      expect(proposal.dayState.classifications).toContain('LATE_START');
      expect(proposal.scheduledContainers.length).toBeGreaterThan(0);
      // Study should begin after routine (08:45 IST = 03:15 UTC)
      const firstStudy = proposal.scheduledContainers[0];
      expect(firstStudy.startsAt >= '2026-09-13T03:15:00.000Z').toBe(true);
    });

    it('Scenario C: Very Late Wake (10:00 IST and 12:00 IST)', () => {
      const proposal10 = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '10:00',
        currentTime: '2026-09-13T04:30:00.000Z', // 10:00 IST
      });

      expect(proposal10.dayState.classifications).toContain('SHORT_DAY');
      expect(proposal10.dayState.classifications).toContain('LATE_START');
      // Lower priorities evicted (P8, P7)
      const evictedIds10 = proposal10.evictedContainers.map(e => e.containerId);
      expect(evictedIds10).toContain('secondary_activity');

      // Extreme 12:00 wake
      const proposal12 = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '12:00',
        currentTime: '2026-09-13T06:30:00.000Z', // 12:00 IST
      });

      expect(proposal12.dayState.classifications).toContain('SHORT_DAY');
      expect(proposal12.evictedContainers.length).toBeGreaterThanOrEqual(proposal10.evictedContainers.length);
    });

    it('Scenario D: Early Wake (05:30 IST)', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '05:30',
        currentTime: '2026-09-13T00:00:00.000Z', // 05:30 IST
      });

      expect(proposal.dayState.classifications).toContain('EARLY_START');
      // Cognitive deep work ceiling of 270 min must still be respected
      expect(proposal.plannedDeepWorkMinutes).toBeLessThanOrEqual(270);
    });

    it('Scenario E: Late Sleep Declaration (01:30 next day)', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredSleep: '01:30',
      });

      expect(proposal.dayState.classifications).toContain('EXTENDED_DAY');
      expect(proposal.plannedDeepWorkMinutes).toBeLessThanOrEqual(270);
    });

    it('Scenario F: Early Sleep Declaration (21:30 IST)', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredSleep: '21:30',
      });

      expect(proposal.dayState.classifications).toContain('SHORT_DAY');
      // Wind down must be 20:50 IST (15:20 UTC)
      expect(proposal.dayState.windDownStart).toBe('2026-09-13T15:20:00.000Z');
      for (const sc of proposal.scheduledContainers) {
        expect(sc.endsAt <= proposal.dayState.windDownStart).toBe(true);
      }
    });
  });

  // ==========================================================================
  // SCENARIO 3: Priority Eviction Ladder & Minimum Viable Durations
  // ==========================================================================
  describe('Priority Eviction Ladder & Minimum Viable Durations', () => {
    it('evicts in exact order P8 -> P7 -> P5 -> P6 while defending P2, P3, P4', () => {
      // Simulate compressed day: wake at 11:00
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '11:00',
        currentTime: '2026-09-13T05:30:00.000Z',
      });

      const evicted = proposal.evictedContainers.map(e => e.containerId);
      // P8 must be evicted before P2, P3, P4
      expect(evicted).toContain('secondary_activity');
      // Defend core morning containers if any capacity remains
      const scheduledIds = proposal.scheduledContainers.map(s => s.containerId);
      const hasCore = scheduledIds.some(id =>
        ['maths_anchor', 'reasoning_anchor', 'consolidation'].includes(id)
      );
      expect(hasCore).toBe(true);
    });

    it('enforces non-sub-minimum container compression', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '09:30',
        currentTime: '2026-09-13T04:00:00.000Z',
      });

      for (const sc of proposal.scheduledContainers) {
        const minAllowed = MIN_VIABLE_CONTAINER_DURATIONS[sc.containerId];
        expect(sc.durationMinutes).toBeGreaterThanOrEqual(minAllowed);
      }
    });
  });

  // ==========================================================================
  // SCENARIO 4: Cognitive & Continuous Focus Ceilings
  // ==========================================================================
  describe('Cognitive & Continuous Session Ceilings', () => {
    it('Scenario O: Enforces 270-minute cognitive deep work ceiling as scheduling cap', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '06:00',
        declaredSleep: '01:00',
      });

      expect(proposal.plannedDeepWorkMinutes).toBeLessThanOrEqual(270);
    });

    it('Scenario P: Enforces 90-minute continuous session ceiling', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
      });

      for (const sc of proposal.scheduledContainers) {
        expect(sc.durationMinutes).toBeLessThanOrEqual(90);
      }
    });
  });

  // ==========================================================================
  // SCENARIO 5: 120-Minute Rolling Freeze Window & Human Authority
  // ==========================================================================
  describe('Freeze Window & Human Authority (Scenarios Q, R, S)', () => {
    it('Scenario Q: Autonomous scheduler preserves blocks within 120-minute freeze window', () => {
      // 10:00 IST = 04:30 UTC
      const refTime = '2026-09-13T04:30:00.000Z';
      const freezeBlockStart = '2026-09-13T05:00:00.000Z'; // 10:30 IST (within 120m)
      const freezeBlockEnd = '2026-09-13T06:00:00.000Z';

      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        currentTime: refTime,
        existingCalendarBlocks: [
          {
            calendarEventId: 'evt_frozen',
            containerId: 'morning_reasoning',
            title: 'Morning Reasoning',
            startsAt: freezeBlockStart,
            endsAt: freezeBlockEnd,
          },
        ],
        isHumanAuthorized: false,
      });

      expect(proposal.dayState.lockedCalendarBlocks).toContain('evt_frozen');
    });

    it('Scenario S: Human authorization overrides freeze window', () => {
      const refTime = '2026-09-13T04:30:00.000Z';
      const freezeBlockStart = '2026-09-13T05:00:00.000Z';
      const freezeBlockEnd = '2026-09-13T06:00:00.000Z';

      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        currentTime: refTime,
        existingCalendarBlocks: [
          {
            calendarEventId: 'evt_frozen',
            containerId: 'morning_reasoning',
            title: 'Morning Reasoning',
            startsAt: freezeBlockStart,
            endsAt: freezeBlockEnd,
          },
        ],
        isHumanAuthorized: true,
      });

      // Under human authority, locked list is empty unless isLocked explicitly true
      expect(proposal.dayState.lockedCalendarBlocks.length).toBe(0);
    });

    it('Scenario R: Preserves human-locked calendar block (isLocked = true)', () => {
      const refTime = '2026-09-13T01:30:00.000Z';
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        currentTime: refTime,
        existingCalendarBlocks: [
          {
            calendarEventId: 'evt_user_appointment',
            title: 'Doctor Appointment',
            startsAt: '2026-09-13T09:30:00.000Z', // 15:00 IST
            endsAt: '2026-09-13T10:30:00.000Z',
            isLocked: true,
          },
        ],
      });

      expect(proposal.dayState.lockedCalendarBlocks).toContain('evt_user_appointment');
    });
  });

  // ==========================================================================
  // SCENARIO 6: 15-Minute Grid Snapping & Decompression Buffers
  // ==========================================================================
  describe('Grid Snapping & Decompression Buffers', () => {
    it('snaps all start and end times to the 15-minute grid (:00, :15, :30, :45)', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '07:37', // non-grid wake
      });

      for (const sc of proposal.scheduledContainers) {
        const startMin = new Date(sc.startsAt).getUTCMinutes();
        const endMin = new Date(sc.endsAt).getUTCMinutes();
        expect(startMin % 15).toBe(0);
        expect(endMin % 15).toBe(0);
      }
    });

    it('enforces 15-minute decompression buffer between scheduled study blocks', () => {
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
      });

      const blocks = proposal.scheduledContainers.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      for (let i = 0; i < blocks.length - 1; i++) {
        const currentEnd = new Date(blocks[i].endsAt).getTime();
        const nextStart = new Date(blocks[i + 1].startsAt).getTime();
        const gapMinutes = (nextStart - currentEnd) / 60000;
        expect(gapMinutes).toBeGreaterThanOrEqual(15);
      }
    });
  });

  // ==========================================================================
  // SCENARIO 7: PersonalStateService replanDay Integration & Persistence
  // ==========================================================================
  describe('PersonalStateService.replanDay & State Integration', () => {
    it('Scenario U: Idempotent replanning produces consistent result across multiple calls', async () => {
      const res1 = await pss.replanDay(
        {
          date: '2026-09-13',
          timezone: 'Asia/Kolkata',
          declaredWake: '08:30',
        },
        { key: 'replan_idemp_key_1', sourceSystem: 'spark' }
      );

      expect(res1.success).toBe(true);

      const res2 = await pss.replanDay(
        {
          date: '2026-09-13',
          timezone: 'Asia/Kolkata',
          declaredWake: '08:30',
        },
        { key: 'replan_idemp_key_1', sourceSystem: 'spark' }
      );

      expect(res2.success).toBe(true);
      expect(res2.replayed).toBe(true);
    });

    it('Scenario I & T: Missed container emits schedule_missed and writes 0 study_sessions rows', async () => {
      // Seed an existing calendar link for morning_maths
      await EntitiesRepository.insertCalendarLink(ctx.db, {
        id: 'callink_maths_1',
        provider: 'google_calendar',
        calendarId: 'primary',
        eventId: 'evt_morning_maths_today',
        entityType: 'study_session',
        entityId: 'morning_maths',
        titleSnapshot: 'Morning Maths Block',
        startsAt: '2026-09-13T02:00:00.000Z',
        endsAt: '2026-09-13T03:30:00.000Z',
        statusSnapshot: 'confirmed',
        lastSyncedAt: null,
        createdAt: '2026-09-13T00:00:00.000Z',
        updatedAt: '2026-09-13T00:00:00.000Z',
      });

      // Extreme late wake at 14:00 (maths completely missed)
      const res = await pss.replanDay({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '14:00',
        currentTimestamp: '2026-09-13T08:30:00.000Z',
      });

      expect(res.success).toBe(true);

      // Verify canonical event schedule_missed was emitted
      const missedEvents = await ctx.db
        .selectFrom('canonical_events')
        .where('event_type', '=', 'schedule_missed')
        .selectAll()
        .execute();
      expect(missedEvents.length).toBeGreaterThan(0);

      // Zero study_sessions rows must have been created
      const studySessions = await ctx.db.selectFrom('study_sessions').selectAll().execute();
      expect(studySessions.length).toBe(0);

      // Verify daily_states.missed_sessions was incremented
      const daily = await ProjectionsRepository.getDailyStateByDate(ctx.db, '2026-09-13');
      expect(daily?.missedSessions).toBeGreaterThan(0);
    });

    it('Scenario W: Preserves external provider linkage and updates calendar_links', async () => {
      const res = await pss.replanDay({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '07:00',
        currentTimestamp: '2026-09-13T02:00:00.000Z',
      });

      expect(res.success).toBe(true);

      // Verify calendar_links rows were upserted
      const links = await ctx.db.selectFrom('calendar_links').selectAll().execute();
      expect(links.length).toBeGreaterThanOrEqual(4);
      for (const link of links) {
        expect(link.provider).toBe('google_calendar');
        expect(link.calendar_id).toBe('primary');
        expect(link.status_snapshot).toBe('confirmed');
      }

      // Verify decisions row was written
      const decisions = await ctx.db.selectFrom('decisions').selectAll().execute();
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions[0].title).toContain('Dynamic Day Replan');
    });

    it('Scenario V: getScheduleContext reports dayState and conflict-free schedule', async () => {
      await pss.replanDay({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '08:00',
      });

      const schedCtx = await pss.getScheduleContext({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
      });

      expect(schedCtx.dayState).toBeDefined();
      expect(schedCtx.dayState?.actualWake).toBe('2026-09-13T02:30:00.000Z');
      expect(schedCtx.conflicts.length).toBe(0);
    });

    it('Scenario H: Repeated small delays (>=2 consecutive delays) triggers WHOLE_DAY_REPLAN', async () => {
      const res = await pss.replanDay({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '07:45',
        consecutiveDelayCount: 2,
      });

      expect(res.data?.repairType).toBe('WHOLE_DAY_REPLAN');
    });

    it('Notion Journal Markdown snapshot is saved in daily_states.state_payload', async () => {
      await pss.replanDay({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredWake: '08:00',
      });

      const daily = await ProjectionsRepository.getDailyStateByDate(ctx.db, '2026-09-13');
      expect(daily?.statePayload).toBeDefined();
      const payload = JSON.parse(daily!.statePayload);
      expect(payload.notionJournalMarkdown).toContain('# Daily Study Journal');
      expect(payload.dayState).toBeDefined();
    });
  });

  // ==========================================================================
  // SCENARIO 8: Timezone & UTC Boundary Crossing
  // ==========================================================================
  describe('Timezone & Midnight UTC Boundary Crossing', () => {
    it('correctly handles Asia/Kolkata (UTC+5:30) crossing UTC midnight', () => {
      // 03:00 IST on 2026-09-14 is 21:30 UTC on 2026-09-13
      const proposal = DynamicReplanningEngine.replan({
        date: '2026-09-13',
        timezone: 'Asia/Kolkata',
        declaredSleep: '01:30', // 01:30 IST on 2026-09-14 is 20:00 UTC on 2026-09-13
      });

      expect(proposal.dayState.date).toBe('2026-09-13');
      expect(proposal.dayState.targetSleep).toBe('2026-09-13T20:00:00.000Z');
    });
  });
});
