import {
  StudyActivityType,
  FocusContainerId,
  FocusContainerDefinition,
  ScheduleBlueprintConfig,
  ScheduleBlueprint,
  ScheduleTimeMap,
  ScheduleConstraint,
  RuntimePolicyContext,
} from '@personal-os/domain';

export type {
  FocusContainerId,
  FocusContainerDefinition,
  ScheduleBlueprintConfig,
  ScheduleBlueprint,
  ScheduleTimeMap,
  ScheduleConstraint,
  RuntimePolicyContext,
};

/**
 * Authoritative default Schedule Blueprint specification adhering to
 * SCHEDULING-ARCHITECTURE-v1.0.md Section 3.
 * Default timezone reconciled to operator timezone (Asia/Kolkata).
 */
export const DEFAULT_SCHEDULE_BLUEPRINT: ScheduleBlueprintConfig = {
  timezone: 'Asia/Kolkata',
  maxDailyFocusContainers: 3,
  maxDailyDeepWorkMinutes: 270,
  maxContinuousSessionMinutes: 90,
  defaultDecompressionBufferMinutes: 15,
  freezeWindowMinutes: 120,
  bufferDays: [0], // Sunday
  containers: [
    {
      containerId: 'morning_focus',
      name: 'Morning Deep Focus Block',
      defaultStartTime: '09:00',
      defaultEndTime: '11:30',
      maxDurationMinutes: 150,
      permittedActivityTypes: ['deep_work'],
      isOptional: false,
    },
    {
      containerId: 'afternoon_practice',
      name: 'Afternoon Practice & Problem Solving Block',
      defaultStartTime: '14:30',
      defaultEndTime: '17:00',
      maxDurationMinutes: 150,
      permittedActivityTypes: ['pyq_practice', 'revision'],
      isOptional: false,
    },
    {
      containerId: 'evening_consolidation',
      name: 'Evening Consolidation & Review Block',
      defaultStartTime: '19:30',
      defaultEndTime: '21:30',
      maxDurationMinutes: 120,
      permittedActivityTypes: ['revision', 'lecture'],
      isOptional: true,
    },
  ],
};

/**
 * Checks if a given day-of-week index is marked as a buffer/recovery day.
 */
export function isBufferDay(
  dayOfWeek: number,
  blueprint: ScheduleBlueprintConfig = DEFAULT_SCHEDULE_BLUEPRINT
): boolean {
  return blueprint.bufferDays.includes(dayOfWeek);
}

/**
 * Computes the timezone offset in milliseconds between UTC and the specified IANA timezone.
 */
function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);

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

  return localAsUtc - date.getTime();
}

/**
 * Returns the exact UTC start and end timestamps (ISO 8601) for a given local calendar date (YYYY-MM-DD)
 * in the specified IANA timezone.
 *
 * Example:
 *   dateStr = '2026-09-12', timezone = 'Asia/Kolkata' (UTC+5:30)
 *   startUtc: '2026-09-11T18:30:00.000Z' (00:00:00 IST)
 *   endUtc:   '2026-09-12T18:29:59.999Z' (23:59:59.999 IST)
 */
export function getUtcDayRange(
  dateStr: string,
  timezone: string = 'Asia/Kolkata'
): { startUtc: string; endUtc: string } {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const baseDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const offsetMs = getTimezoneOffsetMs(baseDate, timezone);

    const startUtcMs = baseDate.getTime() - offsetMs;
    const startUtc = new Date(startUtcMs).toISOString();

    const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
    const endUtc = new Date(endUtcMs).toISOString();

    return { startUtc, endUtc };
  } catch {
    return {
      startUtc: `${dateStr}T00:00:00.000Z`,
      endUtc: `${dateStr}T23:59:59.999Z`,
    };
  }
}

/**
 * Returns the day of week (0=Sunday, 6=Saturday) for a given YYYY-MM-DD date in the specified timezone.
 */
export function getDayOfWeek(
  dateStr: string,
  timezone: string = 'Asia/Kolkata'
): number {
  try {
    const { startUtc } = getUtcDayRange(dateStr, timezone);
    const date = new Date(startUtc);
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
    const dayName = formatter.format(date);
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return dayMap[dayName] ?? date.getUTCDay();
  } catch {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }
}

/**
 * Authoritative "THE EPIC SHIT — OG Personal Timetable Blueprint v0.1" specification.
 * Translates the dynamic container architecture into a typed Schedule Blueprint configuration.
 *
 * SKELETON:
 * - 07:00 - 08:30: Morning Routine (Biological Invariant / Routine constraint)
 * - 08:30 - 10:15: Maths Anchor (105m Deep Work, non-optional)
 * - 10:15 - 10:30: Decompression Buffer (15m)
 * - 10:30 - 12:00: Reasoning Anchor (90m PYQ Practice, non-optional)
 * - 12:00 - 13:30: Lunch & Reset (Biological Invariant constraint)
 * - 13:30 - 15:00: Academic Rotation A (90m Deep Work, non-optional, common subject pool)
 * - 15:00 - 15:20: Mental Break (20m)
 * - 15:20 - 16:50: Academic Rotation B (90m Deep Work, non-optional, common subject pool)
 * - 16:50 - 17:30: Physical Movement / Tea / Reset (Personal Routine constraint)
 * - 17:30 - 18:15: Consolidation Layer (45m Revision / Retrieval / Anki, non-optional)
 * - 18:15 - 19:30: Downtime / Transition (Personal Routine constraint)
 * - 19:30 - 20:30: Secondary Activity Pool (60m Deep Work, optional: coding / project / language)
 * - 20:30 - 21:15: Dinner & Wind-Down (Biological Invariant constraint)
 * - 21:15 - 22:00: Night Retrieval / Light Practice (45m Revision / Mixed Quiz, non-optional)
 * - 22:00 - 22:20: Shutdown Routine (Personal Routine constraint)
 * - 22:20 - 07:00: Sleep Curfew (Biological Invariant constraint)
 */
export const EPIC_SHIT_OG_BLUEPRINT: ScheduleBlueprintConfig = {
  timezone: 'Asia/Kolkata',
  maxDailyFocusContainers: 7,
  maxDailyDeepWorkMinutes: 270, // Preserves authoritative Phase 8 cognitive deep-work ceiling (4.5h)
  maxContinuousSessionMinutes: 90, // Preserves authoritative cognitive limit for continuous focus (90m)
  defaultDecompressionBufferMinutes: 15,
  freezeWindowMinutes: 120,
  bufferDays: [0], // Sunday rebalancing & recovery
  containers: [
    {
      containerId: 'maths_anchor',
      name: 'Maths Daily Cognitive Anchor',
      defaultStartTime: '08:30',
      defaultEndTime: '10:15',
      maxDurationMinutes: 105,
      permittedActivityTypes: ['deep_work', 'pyq_practice'],
      isOptional: false,
    },
    {
      containerId: 'reasoning_anchor',
      name: 'Reasoning Daily Cognitive Anchor',
      defaultStartTime: '10:30',
      defaultEndTime: '12:00',
      maxDurationMinutes: 90,
      permittedActivityTypes: ['pyq_practice', 'deep_work'],
      isOptional: false,
    },
    {
      containerId: 'academic_rotation_a',
      name: 'Academic Rotation Block A',
      defaultStartTime: '13:30',
      defaultEndTime: '15:00',
      maxDurationMinutes: 90,
      permittedActivityTypes: ['deep_work', 'lecture'],
      isOptional: false,
    },
    {
      containerId: 'academic_rotation_b',
      name: 'Academic Rotation Block B',
      defaultStartTime: '15:20',
      defaultEndTime: '16:50',
      maxDurationMinutes: 90,
      permittedActivityTypes: ['deep_work', 'pyq_practice'],
      isOptional: false,
    },
    {
      containerId: 'consolidation',
      name: 'Daily Consolidation & Retrieval Layer',
      defaultStartTime: '17:30',
      defaultEndTime: '18:15',
      maxDurationMinutes: 45,
      permittedActivityTypes: ['revision'],
      isOptional: false,
    },
    {
      containerId: 'secondary_activity',
      name: 'Secondary Activity Pool (Coding / Project / Language)',
      defaultStartTime: '19:30',
      defaultEndTime: '20:30',
      maxDurationMinutes: 60,
      permittedActivityTypes: ['deep_work'],
      isOptional: true,
    },
    {
      containerId: 'night_retrieval',
      name: 'Night Retrieval & Formula Practice Anchor',
      defaultStartTime: '21:15',
      defaultEndTime: '22:00',
      maxDurationMinutes: 45,
      permittedActivityTypes: ['revision', 'pyq_practice'],
      isOptional: false,
    },
  ],
};

/**
 * Authoritative constraint definitions matching the OG timetable blueprint.
 */
export const EPIC_SHIT_OG_CONSTRAINTS = [
  {
    id: 'sc_og_sleep_curfew',
    name: 'Sleep & Biological Curfew',
    constraintType: 'biological_invariant' as const,
    startTime: '22:20',
    endTime: '07:00',
    isHard: true,
  },
  {
    id: 'sc_og_morning_routine',
    name: 'Morning Routine & Readiness',
    constraintType: 'personal_routine' as const,
    startTime: '07:00',
    endTime: '08:30',
    isHard: false,
  },
  {
    id: 'sc_og_lunch_break',
    name: 'Lunch, Reset & Digestion',
    constraintType: 'biological_invariant' as const,
    startTime: '12:00',
    endTime: '13:30',
    isHard: true,
  },
  {
    id: 'sc_og_physical_tea',
    name: 'Physical Movement, Tea & Mental Reset',
    constraintType: 'personal_routine' as const,
    startTime: '16:50',
    endTime: '17:30',
    isHard: false,
  },
  {
    id: 'sc_og_dinner_break',
    name: 'Dinner & Evening Break',
    constraintType: 'biological_invariant' as const,
    startTime: '20:30',
    endTime: '21:15',
    isHard: true,
  },
  {
    id: 'sc_og_shutdown_routine',
    name: 'Night Shutdown Routine & Wind-Down',
    constraintType: 'personal_routine' as const,
    startTime: '22:00',
    endTime: '22:20',
    isHard: false,
  },
];

/**
 * Classifies if a container ID represents a non-negotiable daily cognitive anchor.
 */
export function isAnchorContainer(containerId?: string | null): boolean {
  if (!containerId) return false;
  return ['maths_anchor', 'reasoning_anchor', 'night_retrieval'].includes(containerId);
}

/**
 * Classifies if a container ID represents a dynamic academic rotation slot.
 */
export function isRotationContainer(containerId?: string | null): boolean {
  if (!containerId) return false;
  return ['academic_rotation_a', 'academic_rotation_b'].includes(containerId);
}

/**
 * Classifies if a container ID represents the replaceable secondary activity pool.
 */
export function isSecondaryActivity(containerId?: string | null): boolean {
  if (!containerId) return false;
  return containerId === 'secondary_activity';
}

/**
 * Classifies if a container ID represents the dedicated consolidation layer.
 */
export function isConsolidationContainer(containerId?: string | null): boolean {
  if (!containerId) return false;
  return containerId === 'consolidation';
}

