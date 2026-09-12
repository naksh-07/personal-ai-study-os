import {
  StudyActivityType,
  FocusContainerId,
  FocusContainerDefinition,
  ScheduleBlueprintConfig,
} from '@personal-os/domain';

export type { FocusContainerId, FocusContainerDefinition, ScheduleBlueprintConfig };

/**
 * Authoritative default Schedule Blueprint specification adhering to
 * SCHEDULING-ARCHITECTURE-v1.0.md Section 3.
 */
export const DEFAULT_SCHEDULE_BLUEPRINT: ScheduleBlueprintConfig = {
  timezone: 'UTC',
  maxDailyFocusContainers: 3,
  maxDailyDeepWorkMinutes: 270,
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
export function isBufferDay(dayOfWeek: number, blueprint: ScheduleBlueprintConfig = DEFAULT_SCHEDULE_BLUEPRINT): boolean {
  return blueprint.bufferDays.includes(dayOfWeek);
}
