import {
  FocusContainerId,
  FocusContainerDefinition,
  DayClassification,
  DayStateProfile,
  MIN_VIABLE_CONTAINER_DURATIONS,
  CanonicalEvent,
  generateId,
} from '@personal-os/domain';
import {
  EPIC_SHIT_OG_BLUEPRINT,
  EPIC_SHIT_OG_CONSTRAINTS,
  getUtcDayRange,
  getDayOfWeek,
} from './blueprint';
import { CanonicalEventEngine } from './event-engine';

// ============================================================================
// Types & Inputs for Dynamic Replanning
// ============================================================================

export interface ResolveDayStateInput {
  date?: string; // YYYY-MM-DD
  timezone?: string; // e.g. 'Asia/Kolkata'
  currentTime?: string; // ISO 8601
  declaredWake?: string; // ISO 8601 or 'HH:MM'
  declaredSleep?: string; // ISO 8601 or 'HH:MM'
  userEventsToday?: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
    payload?: any;
  }>;
  existingCalendarBlocks?: Array<{
    id?: string;
    calendarEventId: string;
    containerId?: string;
    title: string;
    startsAt: string;
    endsAt: string;
    isLocked?: boolean;
    statusSnapshot?: string;
  }>;
  completedStudySessions?: Array<{
    durationMinutes: number;
    startedAt: string;
    endedAt: string;
    activityType?: string;
  }>;
  isHumanAuthorized?: boolean;
}

export interface ScheduledContainerBlock {
  containerId: FocusContainerId;
  name: string;
  startsAt: string; // ISO 8601
  endsAt: string; // ISO 8601
  durationMinutes: number;
  calendarEventId?: string;
  isOptional: boolean;
  activityType: string;
}

export interface EvictedContainerRecord {
  containerId: FocusContainerId;
  name: string;
  action: 'dropped' | 'deferred';
  reason: string;
}

export interface DynamicReplanProposal {
  dayState: DayStateProfile;
  classifications: DayClassification[];
  isLocalRepair: boolean;
  repairType: 'NONE' | 'LOCAL_REPAIR' | 'WHOLE_DAY_REPLAN';
  plannedDeepWorkMinutes: number;
  scheduledContainers: ScheduledContainerBlock[];
  evictedContainers: EvictedContainerRecord[];
  warnings: string[];
  rationale: string;
  journalMarkdown: string;
}

export interface ExecuteReplanInput extends ResolveDayStateInput {
  isHumanAuthorized?: boolean;
  consecutiveDelayCount?: number;
  forceWholeDay?: boolean;
  allowPastEdit?: boolean;
}

// ============================================================================
// Helper: Timezone & Time Parsing
// ============================================================================

function parseTimeToLocalIso(dateStr: string, timeStr: string, timezone: string): string {
  if (timeStr.includes('T')) {
    return timeStr;
  }
  const [hours, minutes] = timeStr.split(':').map(Number);
  const [year, month, day] = dateStr.split('-').map(Number);

  const testDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(testDate);

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = parseInt(part.value, 10);
    }
  }

  const localAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour === 24 ? 0 : values.hour,
    values.minute,
    values.second
  );
  const offsetMs = localAsUtc - testDate.getTime();
  const actualUtcMs = testDate.getTime() - offsetMs;
  return new Date(actualUtcMs).toISOString();
}

function getLocalMinutesFromIso(iso: string, timezone: string): number {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);

  let h = 0;
  let m = 0;
  for (const part of parts) {
    if (part.type === 'hour') h = parseInt(part.value, 10);
    if (part.type === 'minute') m = parseInt(part.value, 10);
  }
  if (h === 24) h = 0;
  return h * 60 + m;
}

function snapTo15MinuteGrid(iso: string, timezone: string): string {
  const date = new Date(iso);
  const ms = date.getTime();
  const remainderMs = ms % (15 * 60 * 1000);
  if (remainderMs === 0) return iso;
  const snappedMs = ms - remainderMs + 15 * 60 * 1000;
  return new Date(snappedMs).toISOString();
}

// ============================================================================
// 1. DayStateResolver: Epistemic Hierarchy Day-State Resolution
// ============================================================================

export class DayStateResolver {
  /**
   * Resolves the 11 authoritative Day-State attributes.
   * Epistemic Hierarchy:
   * 1. User-Reported Fact (explicit parameter)
   * 2. Actually Available Telemetry (D1 user canonical events)
   * 3. Blueprint Fallback (07:00 nominal routine start)
   * PROHIBITION: Never infer wake from first calendar event.
   */
  static resolveDayState(input: ResolveDayStateInput): DayStateProfile {
    const timezone = input.timezone ?? 'Asia/Kolkata';
    const date = input.date ?? input.currentTime?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

    // 1. Resolve actualWake
    let actualWake: string;
    if (input.declaredWake) {
      actualWake = parseTimeToLocalIso(date, input.declaredWake, timezone);
    } else {
      // Check Tier 2: Actually Available Telemetry (day boundary shift or user sessions today)
      const boundaryShift = (input.userEventsToday ?? [])
        .filter(e => e.eventType === 'day_boundary_shifted')
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];

      if (boundaryShift?.payload?.wakeTime) {
        actualWake = boundaryShift.payload.wakeTime;
      } else if (boundaryShift?.payload?.newWakeTime) {
        actualWake = boundaryShift.payload.newWakeTime;
      } else {
        const userSessions = (input.userEventsToday ?? [])
          .filter(e => e.eventType === 'study_session_recorded' || e.eventType === 'study_completed')
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

        if (userSessions.length > 0) {
          actualWake = userSessions[0].occurredAt;
        } else {
          // Tier 3: Blueprint fallback (07:00 IST)
          actualWake = parseTimeToLocalIso(date, '07:00', timezone);
        }
      }
    }

    const currentTime = input.currentTime ?? actualWake;

    // 2. Resolve targetSleep & windDownStart
    let targetSleep: string;
    let windDownStart: string;

    const nextDayDate = new Date(new Date(date + 'T12:00:00.000Z').getTime() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    if (input.declaredSleep) {
      let sleepDate = date;
      const [h] = input.declaredSleep.includes(':') ? input.declaredSleep.split(':').map(Number) : [23];
      if (h < 12) {
        sleepDate = nextDayDate;
      }
      targetSleep = parseTimeToLocalIso(sleepDate, input.declaredSleep, timezone);
      const sleepMs = new Date(targetSleep).getTime();
      windDownStart = new Date(sleepMs - 40 * 60 * 1000).toISOString();
    } else {
      targetSleep = parseTimeToLocalIso(date, '23:00', timezone);
      windDownStart = parseTimeToLocalIso(date, '22:20', timezone);
    }

    // 3. Available physical minutes: max(0, windDownStart - max(currentTime, readyAfterRoutineMs))
    const wakeMs = new Date(actualWake).getTime();
    const minRoutineMinutes = 45;
    const readyMs = wakeMs + minRoutineMinutes * 60 * 1000;
    const effStartMs = Math.max(new Date(currentTime).getTime(), readyMs);
    const windDownMs = new Date(windDownStart).getTime();
    const availablePhysicalMinutes = Math.max(0, Math.floor((windDownMs - effStartMs) / (60 * 1000)));

    // 4. Completed deep work minutes
    const completedDeepWorkMinutes = (input.completedStudySessions ?? []).reduce(
      (sum, s) => sum + s.durationMinutes,
      0
    );

    // 5. Remaining deep work capacity (ceiling: 270 minutes)
    const remainingDeepWorkCapacityMinutes = Math.max(0, 270 - completedDeepWorkMinutes);

    // 6. Categorize blueprint containers relative to currentTime
    const elapsedContainers: string[] = [];
    let activeContainer: string | null = null;
    const viableContainers: string[] = [];

    for (const container of EPIC_SHIT_OG_BLUEPRINT.containers) {
      const containerStartIso = parseTimeToLocalIso(date, container.defaultStartTime, timezone);
      const containerEndIso = parseTimeToLocalIso(date, container.defaultEndTime, timezone);

      if (currentTime >= containerEndIso) {
        elapsedContainers.push(container.containerId);
      } else if (currentTime >= containerStartIso && currentTime < containerEndIso) {
        activeContainer = container.containerId;
      } else {
        viableContainers.push(container.containerId);
      }
    }

    // 7. Detect locked calendar blocks (human locked + rolling freeze window)
    const freezeBoundaryMs = new Date(currentTime).getTime() + 120 * 60 * 1000;
    const lockedCalendarBlocks = (input.existingCalendarBlocks ?? [])
      .filter(b => {
        if (b.isLocked) return true;
        if (!input.isHumanAuthorized) {
          const bStartMs = new Date(b.startsAt).getTime();
          const currentMs = new Date(currentTime).getTime();
          if (bStartMs >= currentMs && bStartMs <= freezeBoundaryMs) {
            return true;
          }
        }
        return false;
      })
      .map(b => b.calendarEventId);

    // 8. Compute capacity-relative classifications
    const classifications = DynamicDayClassifier.classifyDay({
      date,
      timezone,
      actualWake,
      targetSleep,
      availablePhysicalMinutes,
      viableContainers,
    });

    return {
      date,
      timezone,
      currentTime,
      actualWake,
      windDownStart,
      targetSleep,
      availablePhysicalMinutes,
      completedDeepWorkMinutes,
      remainingDeepWorkCapacityMinutes,
      classifications,
      elapsedContainers,
      activeContainer,
      viableContainers,
      lockedCalendarBlocks,
    };
  }
}

// ============================================================================
// 2. DynamicDayClassifier: Capacity-Relative Day Classification
// ============================================================================

export class DynamicDayClassifier {
  static classifyDay(params: {
    date: string;
    timezone: string;
    actualWake: string;
    targetSleep: string;
    availablePhysicalMinutes: number;
    viableContainers: string[];
  }): DayClassification[] {
    const { date, timezone, actualWake, targetSleep, availablePhysicalMinutes, viableContainers } = params;
    const classifications: DayClassification[] = [];

    const wakeMinutes = getLocalMinutesFromIso(actualWake, timezone);
    const nominalStartMinutes = 7 * 60; // 07:00

    if (wakeMinutes > nominalStartMinutes + 15) {
      classifications.push('LATE_START');
    } else if (wakeMinutes < nominalStartMinutes - 15) {
      classifications.push('EARLY_START');
    }

    const sleepMinutes = getLocalMinutesFromIso(targetSleep, timezone);
    const nominalSleepMinutes = 23 * 60; // 23:00

    if (sleepMinutes > 30 && sleepMinutes < 12 * 60) {
      classifications.push('EXTENDED_DAY');
    }

    // SHORT_DAY: wake late >= 60m, sleep early >= 30m, or available physical minutes compressed
    if (wakeMinutes >= nominalStartMinutes + 60) {
      classifications.push('SHORT_DAY');
    } else if (sleepMinutes > 12 * 60 && sleepMinutes <= nominalSleepMinutes - 30) {
      classifications.push('SHORT_DAY');
    } else if (availablePhysicalMinutes < 720) {
      classifications.push('SHORT_DAY');
    }

    if (classifications.length === 0 || (classifications.length === 1 && classifications[0] === 'LATE_START' && wakeMinutes < nominalStartMinutes + 60)) {
      if (!classifications.includes('SHORT_DAY')) {
        classifications.push('NORMAL');
      }
    }

    return classifications;
  }
}

// ============================================================================
// 3. DynamicReplanningEngine: Policy v1.0 Deterministic Replanning
// ============================================================================

export class DynamicReplanningEngine {
  static determineRepairScope(params: {
    delayMinutes: number;
    affectedContainersCount: number;
    consecutiveDelayCount?: number;
    forceWholeDay?: boolean;
  }): 'LOCAL_REPAIR' | 'WHOLE_DAY_REPLAN' {
    if (params.forceWholeDay) return 'WHOLE_DAY_REPLAN';
    if ((params.consecutiveDelayCount ?? 0) >= 2) return 'WHOLE_DAY_REPLAN';
    if (params.delayMinutes <= 60 && params.affectedContainersCount <= 1) {
      return 'LOCAL_REPAIR';
    }
    return 'WHOLE_DAY_REPLAN';
  }

  static replan(input: ExecuteReplanInput): DynamicReplanProposal {
    const dayState = DayStateResolver.resolveDayState(input);
    const timezone = dayState.timezone;
    const warnings: string[] = [];

    const wakeMinutes = getLocalMinutesFromIso(dayState.actualWake, timezone);
    const nominalStartMinutes = 7 * 60;
    const delayMinutes = Math.max(0, wakeMinutes - nominalStartMinutes);

    const repairType = this.determineRepairScope({
      delayMinutes,
      affectedContainersCount: delayMinutes > 60 ? 2 : (delayMinutes > 0 ? 1 : 0),
      consecutiveDelayCount: input.consecutiveDelayCount,
      forceWholeDay: input.forceWholeDay,
    });

    const isLocalRepair = repairType === 'LOCAL_REPAIR';

    const ogContainerIds: FocusContainerId[] = [
      'maths_anchor',
      'reasoning_anchor',
      'consolidation',
      'academic_rotation_a',
      'academic_rotation_b',
      'night_retrieval',
      'secondary_activity',
    ];

    let candidateContainerIds: FocusContainerId[];
    if (isLocalRepair) {
      candidateContainerIds = [];
      if (dayState.activeContainer) {
        candidateContainerIds.push(dayState.activeContainer as FocusContainerId);
      }
      for (const vId of dayState.viableContainers) {
        candidateContainerIds.push(vId as FocusContainerId);
      }
    } else {
      candidateContainerIds = ogContainerIds;
    }

    if ((input.consecutiveDelayCount ?? 0) >= 2) {
      warnings.push('Multiple consecutive delays detected today. Transitioned to structural day stabilization.');
    }

    const containerPool = candidateContainerIds.map(cId => {
      const def = EPIC_SHIT_OG_BLUEPRINT.containers.find(c => c.containerId === cId);
      const defaultDuration = def ? def.maxDurationMinutes : 60;
      const minDuration = MIN_VIABLE_CONTAINER_DURATIONS[cId] ?? 45;
      const activityType = def?.permittedActivityTypes[0] ?? 'deep_work';
      const name = def?.name ?? cId;
      const isOptional = def?.isOptional ?? false;

      return {
        containerId: cId,
        name,
        duration: defaultDuration,
        minDuration,
        activityType,
        isOptional,
        evicted: false,
        evictAction: 'dropped' as 'dropped' | 'deferred',
        evictReason: '',
      };
    });

    const lunchStartIso = parseTimeToLocalIso(dayState.date, '12:00', timezone);
    const lunchEndIso = parseTimeToLocalIso(dayState.date, '13:30', timezone);
    const dinnerStartIso = parseTimeToLocalIso(dayState.date, '20:30', timezone);
    const dinnerEndIso = parseTimeToLocalIso(dayState.date, '21:15', timezone);
    const windDownStartIso = dayState.windDownStart;

    const wakeMs = new Date(dayState.actualWake).getTime();
    const minRoutineMinutes = 45;
    const readyMs = wakeMs + minRoutineMinutes * 60 * 1000;
    const effStartMs = Math.max(new Date(dayState.currentTime).getTime(), readyMs);
    let currentCursorIso = snapTo15MinuteGrid(new Date(effStartMs).toISOString(), timezone);

    const nominalFirstStudyIso = parseTimeToLocalIso(dayState.date, '08:30', timezone);
    if (dayState.classifications.includes('EARLY_START') && currentCursorIso < nominalFirstStudyIso && !input.isHumanAuthorized) {
      currentCursorIso = nominalFirstStudyIso;
    }

    let survivingContainers = containerPool.filter(c => !c.evicted);

    const calculateNeededMinutes = (items: typeof survivingContainers) => {
      return items.reduce((sum, item) => sum + item.duration + 15, 0);
    };

    const maxDeepWork = Math.min(dayState.remainingDeepWorkCapacityMinutes, 270);
    const checkFeasibility = () => {
      const neededMinutes = calculateNeededMinutes(survivingContainers);
      const totalDeepWork = survivingContainers.reduce((sum, item) => sum + item.duration, 0);
      return neededMinutes <= dayState.availablePhysicalMinutes && totalDeepWork <= maxDeepWork;
    };

    if (!checkFeasibility()) {
      const sec = survivingContainers.find(c => c.containerId === 'secondary_activity');
      if (sec) {
        sec.evicted = true;
        sec.evictAction = 'dropped';
        sec.evictReason = 'Physical or cognitive capacity constrained. Secondary activity yielded per Priority Ladder (P8).';
      }
      survivingContainers = containerPool.filter(c => !c.evicted);
    }

    if (!checkFeasibility()) {
      const rotB = survivingContainers.find(c => c.containerId === 'academic_rotation_b');
      if (rotB) {
        rotB.evicted = true;
        rotB.evictAction = 'deferred';
        rotB.evictReason = 'Insufficient time before wind-down. Rotation B deferred to Google Tasks backlog per Priority Ladder (P7).';
      }
      survivingContainers = containerPool.filter(c => !c.evicted);
    }

    if (!checkFeasibility()) {
      const rotA = survivingContainers.find(c => c.containerId === 'academic_rotation_a');
      const nr = survivingContainers.find(c => c.containerId === 'night_retrieval');
      const maths = survivingContainers.find(c => c.containerId === 'maths_anchor');

      if (maths && maths.duration > 90) maths.duration = 90;
      if (rotA && rotA.duration > 60) rotA.duration = 60;
      if (nr && nr.duration > 30) nr.duration = 30;

      survivingContainers = containerPool.filter(c => !c.evicted);
    }

    if (!checkFeasibility()) {
      const rotA = survivingContainers.find(c => c.containerId === 'academic_rotation_a');
      const nr = survivingContainers.find(c => c.containerId === 'night_retrieval');
      if (rotA && rotA.duration > 45) rotA.duration = 45;
      if (nr && nr.duration > 30) nr.duration = 30;

      survivingContainers = containerPool.filter(c => !c.evicted);
    }

    if (!checkFeasibility()) {
      const rotA = survivingContainers.find(c => c.containerId === 'academic_rotation_a');
      if (rotA) {
        rotA.evicted = true;
        rotA.evictAction = 'deferred';
        rotA.evictReason = 'Severe schedule compression. Rotation A deferred to protect daily cognitive anchors (P5).';
      }
      survivingContainers = containerPool.filter(c => !c.evicted);
    }

    if (!checkFeasibility()) {
      const maths = survivingContainers.find(c => c.containerId === 'maths_anchor');
      const reas = survivingContainers.find(c => c.containerId === 'reasoning_anchor');
      const cons = survivingContainers.find(c => c.containerId === 'consolidation');

      if (maths) maths.duration = 60;
      if (reas) reas.duration = 60;
      if (cons) cons.duration = 30;

      survivingContainers = containerPool.filter(c => !c.evicted);
    }

    const scheduledContainers: ScheduledContainerBlock[] = [];
    const evictedContainers: EvictedContainerRecord[] = containerPool
      .filter(c => c.evicted)
      .map(c => ({
        containerId: c.containerId,
        name: c.name,
        action: c.evictAction,
        reason: c.evictReason,
      }));

    const freezeBoundaryIso = new Date(new Date(dayState.currentTime).getTime() + 120 * 60 * 1000).toISOString();

    for (const item of survivingContainers) {
      const startMs = new Date(currentCursorIso).getTime();
      const durationMs = item.duration * 60 * 1000;
      let endMs = startMs + durationMs;
      let endIso = new Date(endMs).toISOString();

      const lunchStartMs = new Date(lunchStartIso).getTime();
      const lunchEndMs = new Date(lunchEndIso).getTime();
      const dinnerStartMs = new Date(dinnerStartIso).getTime();
      const dinnerEndMs = new Date(dinnerEndIso).getTime();
      const windDownMs = new Date(windDownStartIso).getTime();

      if (startMs < lunchEndMs && endMs > lunchStartMs) {
        const maxAvailLunchMinutes = Math.floor(Math.floor((lunchStartMs - startMs) / (60 * 1000)) / 15) * 15;
        if (maxAvailLunchMinutes >= item.minDuration) {
          item.duration = maxAvailLunchMinutes;
          endMs = startMs + item.duration * 60 * 1000;
          endIso = new Date(endMs).toISOString();
        } else {
          currentCursorIso = snapTo15MinuteGrid(lunchEndIso, timezone);
          endMs = new Date(currentCursorIso).getTime() + item.duration * 60 * 1000;
          endIso = new Date(endMs).toISOString();
        }
      }

      const currentStartMs = new Date(currentCursorIso).getTime();
      if (currentStartMs < dinnerEndMs && endMs > dinnerStartMs) {
        const maxAvailDinnerMinutes = Math.floor(Math.floor((dinnerStartMs - currentStartMs) / (60 * 1000)) / 15) * 15;
        if (maxAvailDinnerMinutes >= item.minDuration) {
          item.duration = maxAvailDinnerMinutes;
          endMs = currentStartMs + item.duration * 60 * 1000;
          endIso = new Date(endMs).toISOString();
        } else {
          currentCursorIso = snapTo15MinuteGrid(dinnerEndIso, timezone);
          endMs = new Date(currentCursorIso).getTime() + item.duration * 60 * 1000;
          endIso = new Date(endMs).toISOString();
        }
      }

      const finalStartMs = new Date(currentCursorIso).getTime();
      const finalEndMs = finalStartMs + item.duration * 60 * 1000;

      if (finalEndMs > windDownMs) {
        const rawRemaining = Math.floor((windDownMs - finalStartMs) / (60 * 1000));
        const snappedRemaining = Math.floor(rawRemaining / 15) * 15;
        if (snappedRemaining >= item.minDuration) {
          item.duration = snappedRemaining;
          endMs = finalStartMs + item.duration * 60 * 1000;
          endIso = new Date(endMs).toISOString();
        } else {
          evictedContainers.push({
            containerId: item.containerId,
            name: item.name,
            action: item.isOptional ? 'dropped' : 'deferred',
            reason: `Terminates past mandatory wind-down boundary (${dayState.windDownStart}). Evicted to protect sleep hygiene.`,
          });
          continue;
        }
      }

      if (!input.isHumanAuthorized && currentCursorIso < freezeBoundaryIso && currentCursorIso > dayState.currentTime) {
        warnings.push(`Container '${item.name}' overlaps rolling 120-minute freeze window. Requires human authorization to shift.`);
      }

      const existingBlock = (input.existingCalendarBlocks ?? []).find(b => b.containerId === item.containerId);

      scheduledContainers.push({
        containerId: item.containerId,
        name: item.name,
        startsAt: currentCursorIso,
        endsAt: endIso,
        durationMinutes: item.duration,
        calendarEventId: existingBlock?.calendarEventId ?? generateId('callink'),
        isOptional: item.isOptional,
        activityType: item.activityType,
      });

      const nextMs = endMs + 15 * 60 * 1000;
      currentCursorIso = snapTo15MinuteGrid(new Date(nextMs).toISOString(), timezone);
    }

    const plannedDeepWorkMinutes = scheduledContainers.reduce((sum, c) => sum + c.durationMinutes, 0);
    const totalTodayDeepWork = dayState.completedDeepWorkMinutes + plannedDeepWorkMinutes;
    if (totalTodayDeepWork > 270) {
      warnings.push(`Daily study load exceeds cognitive ceiling (270 min). Total planned: ${totalTodayDeepWork} min.`);
    }

    let rationale = `Dynamic day replanning executed (${repairType}). `;
    if (dayState.classifications.includes('LATE_START')) {
      rationale += `Late start detected (${dayState.actualWake}). Anchors defended; `;
    }
    if (dayState.classifications.includes('SHORT_DAY')) {
      rationale += `Available time compressed to ${dayState.availablePhysicalMinutes}m. `;
    }
    if (evictedContainers.length > 0) {
      rationale += `Pruned ${evictedContainers.length} container(s): ${evictedContainers.map(e => e.name).join(', ')}. `;
    }
    rationale += `Study cutoff strictly defended at ${dayState.windDownStart}.`;

    const journalMarkdown = this.formatJournalMarkdown({
      dayState,
      classifications: dayState.classifications,
      scheduledContainers,
      evictedContainers,
      plannedDeepWorkMinutes,
      completedDeepWorkMinutes: dayState.completedDeepWorkMinutes,
      rationale,
    });

    return {
      dayState,
      classifications: dayState.classifications,
      isLocalRepair,
      repairType,
      plannedDeepWorkMinutes,
      scheduledContainers,
      evictedContainers,
      warnings,
      rationale,
      journalMarkdown,
    };
  }

  private static formatJournalMarkdown(params: {
    dayState: DayStateProfile;
    classifications: DayClassification[];
    scheduledContainers: ScheduledContainerBlock[];
    evictedContainers: EvictedContainerRecord[];
    plannedDeepWorkMinutes: number;
    completedDeepWorkMinutes: number;
    rationale: string;
  }): string {
    const {
      dayState,
      classifications,
      scheduledContainers,
      evictedContainers,
      plannedDeepWorkMinutes,
      completedDeepWorkMinutes,
      rationale,
    } = params;

    const modeStr = classifications.join(' | ');

    let md = `# Daily Study Journal — ${dayState.date}\n`;
    md += `**Mode**: ${modeStr}  \n`;
    md += `**Wake**: ${dayState.actualWake} | **Study Cutoff**: ${dayState.windDownStart} | **Target Sleep**: ${dayState.targetSleep}  \n\n`;

    md += `### Today's Focus Containers\n`;
    for (const c of scheduledContainers) {
      const startLocal = c.startsAt.slice(11, 16);
      const endLocal = c.endsAt.slice(11, 16);
      md += `- [ ] **${startLocal}–${endLocal} | ${c.name}** (${c.durationMinutes}m)\n`;
    }

    if (evictedContainers.length > 0) {
      md += `\n### Deferred / Evicted Containers\n`;
      for (const e of evictedContainers) {
        md += `- **[${e.action.toUpperCase()}] ${e.name}**: ${e.reason}\n`;
      }
    }

    md += `\n### Schedule Adjustments Today\n`;
    md += `- *${dayState.currentTime.slice(11, 16)}*: ${rationale}\n\n`;

    md += `### Daily Metrics\n`;
    md += `- **Deep Work Planned**: ${(plannedDeepWorkMinutes / 60).toFixed(1)}h | **Executed**: ${(completedDeepWorkMinutes / 60).toFixed(1)}h | **Missed Sessions**: ${evictedContainers.length}\n`;

    return md;
  }
}
