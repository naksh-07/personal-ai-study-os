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
